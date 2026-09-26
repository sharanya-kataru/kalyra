import { buildFlightComparison } from "./flight-alternatives";
import { logger } from "./logger";
import {
  fallbackSource,
  liveSource,
  type DataSourceMetadata,
} from "./sources";

export interface FlightSearchInput {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  traveler_count: number;
  cabin_class?: "economy" | "premium_economy" | "business" | "first";
  market?: string;
  currency?: "USD";
}

export interface FlightSegment {
  origin_airport: string;
  destination_airport: string;
  departure_datetime: string | null;
  arrival_datetime: string | null;
  airline?: string;
  flight_number?: string;
  duration_minutes?: number;
}

export interface FlightLeg {
  carrier?: string;
  duration_minutes?: number;
  segments: FlightSegment[];
}

export interface FlightOffer {
  duration_complete?: boolean;
  stops_complete?: boolean;
  provider_offer_id: string;
  total_price_usd: number;
  outbound: FlightLeg;
  inbound: FlightLeg;
  carriers: string[];
  stop_count: number;
  total_duration_minutes: number | null;
  departure_datetime: string | null;
  arrival_datetime: string | null;
  booking_id?: string;
  source_metadata: DataSourceMetadata;
}

export interface FlightAlternative {
  kind: "cheapest" | "fastest";
  distinctions?: Array<"cheapest" | "fastest">;
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  offer: FlightOffer;
  reason: string;
}

export interface FlightSearchResult {
  alternatives?: FlightAlternative[];
  status: "live" | "unavailable";
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  offers: FlightOffer[];
  selected_offer: FlightOffer | null;
  source_metadata: DataSourceMetadata;
  recommendation_reason?: string;
  message?: string;
}

export interface FlightProvider {
  search_flights(
    input: FlightSearchInput,
    allowNearbyFallback?: boolean,
  ): Promise<FlightSearchResult>;
}

type IgnavSegment = {
  marketing_carrier_code?: unknown;
  flight_number?: unknown;
  operating_carrier_name?: unknown;
  departure_airport?: unknown;
  departure_time_local?: unknown;
  departure_time_utc?: unknown;
  arrival_airport?: unknown;
  arrival_time_local?: unknown;
  arrival_time_utc?: unknown;
  duration_minutes?: unknown;
};

type IgnavLeg = {
  carrier?: unknown;
  duration_minutes?: unknown;
  segments?: unknown;
};

type IgnavItinerary = {
  price?: { amount?: unknown; currency?: unknown; status?: unknown };
  outbound?: IgnavLeg;
  inbound?: IgnavLeg;
  cabin_class?: unknown;
  requires_self_transfer?: unknown;
  ignav_id?: unknown;
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const pendingFlights = new Map<string, Promise<FlightSearchResult>>();
const negativeFlights = new Map<string, { expiresAt: number; result: FlightSearchResult }>();
const unsupportedAirports = new Map<string, number>();
const flightCache = new Map<string, { expiresAt: number; result: FlightSearchResult }>();

function finiteNonNegative(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validTimestamp(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || Number.isNaN(Date.parse(candidate))) return null;
  return candidate;
}

function normalizeSegment(raw: unknown): FlightSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const segment = raw as IgnavSegment;
  const origin = text(segment.departure_airport);
  const destination = text(segment.arrival_airport);
  if (!origin || !destination) return null;

  const normalized: FlightSegment = {
    origin_airport: origin,
    destination_airport: destination,
    departure_datetime: validTimestamp(segment.departure_time_local ?? segment.departure_time_utc),
    arrival_datetime: validTimestamp(segment.arrival_time_local ?? segment.arrival_time_utc),
  };
  const airline = text(segment.operating_carrier_name) ?? text(segment.marketing_carrier_code);
  const flightNumber = text(segment.flight_number);
  const duration = finiteNonNegative(segment.duration_minutes);
  if (airline) normalized.airline = airline;
  if (flightNumber) normalized.flight_number = flightNumber;
  if (duration !== null) normalized.duration_minutes = Math.round(duration);
  return normalized;
}

function normalizeLeg(raw: unknown): FlightLeg | null {
  if (!raw || typeof raw !== "object") return null;
  const leg = raw as IgnavLeg;
  const segments = Array.isArray(leg.segments)
    ? leg.segments.map(normalizeSegment).filter((item): item is FlightSegment => item !== null)
    : [];
  if (segments.length === 0) return null;
  const duration = finiteNonNegative(leg.duration_minutes);
  const normalized: FlightLeg = { segments };
  const carrier = text(leg.carrier);
  if (carrier) normalized.carrier = carrier;
  if (duration !== null) normalized.duration_minutes = Math.round(duration);
  return normalized;
}

function emptyResult(input: FlightSearchInput, message: string): FlightSearchResult {
  return {
    status: "unavailable",
    origin: input.origin,
    destination: input.destination,
    departure_date: input.departure_date,
    return_date: input.return_date,
    offers: [],
    selected_offer: null,
    source_metadata: fallbackSource("flight_search"),
    message,
  };
}

function completeSegments(raw: IgnavLeg | undefined, leg: FlightLeg): boolean {
  return Array.isArray(raw?.segments) && raw.segments.length === leg.segments.length &&
    leg.segments.every((segment, i) => i === 0 || leg.segments[i - 1].destination_airport === segment.origin_airport);
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

class IgnavFlightProvider implements FlightProvider {
  private readonly apiKey: string;
  private readonly baseUrl = "https://ignav.com/api/fares/round-trip";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search_airports(query: string, limit = 3): Promise<string[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    try {
      const url = new URL("https://ignav.com/api/airports");
      url.searchParams.set("q", trimmed);
      url.searchParams.set("limit", String(limit));

      const response = await fetch(url, {
        signal: AbortSignal.timeout(6_000),
        headers: {
          "X-Api-Key": this.apiKey,
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        return [];
      }

      return data
        .map((airport: { iata?: unknown }) =>
          typeof airport.iata === "string" ? airport.iata.toUpperCase() : null
        )
        .filter((iata): iata is string => Boolean(iata))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  private async searchNearbyDates(
    input: FlightSearchInput,
  ): Promise<FlightOffer[]> {
    const offsets = [-7, -3, -1, 1, 3, 7];
    const tripLength =
      Math.round(
        (new Date(`${input.return_date}T00:00:00Z`).getTime() -
          new Date(`${input.departure_date}T00:00:00Z`).getTime()) /
          (24 * 60 * 60 * 1000),
      );

    const results = await Promise.all(
      offsets.map(async (offset) => {
        const departureDate = shiftDate(input.departure_date, offset);
        const returnDate = shiftDate(input.return_date, offset);

        const result = await this.search_flights(
          {
            ...input,
            departure_date: departureDate,
            return_date: returnDate,
          },
          false,
        );

        return result.offers;
      }),
    );

    return results.flat();
  }

  async search_flights(input: FlightSearchInput, allowNearbyFallback = true): Promise<FlightSearchResult> {
    input = { ...input, origin: input.origin.trim().toUpperCase(), destination: input.destination.trim().toUpperCase(),
      traveler_count: Math.min(Math.max(Math.round(input.traveler_count), 1), 9),
      cabin_class: input.cabin_class ?? "economy", market: input.market ?? "US", currency: input.currency ?? "USD" };
    // A provider-declared unsupported airport is independent of travel dates.
    // Do not infer this from empty offers, generic 400s, auth failures or timeouts.
    if ([input.origin, input.destination].some((iata) => (unsupportedAirports.get(`${this.apiKey}|${iata}`) ?? 0) > Date.now())) {
      return emptyResult(input, "This airport is not supported by the flight provider. Estimated costs are shown.");
    }
    const key = JSON.stringify([this.apiKey, input.origin, input.destination, input.departure_date, input.return_date,
      input.traveler_count, input.cabin_class, input.market, input.currency, allowNearbyFallback]);
    const cached = negativeFlights.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const existing = pendingFlights.get(key);
    if (existing) return existing;
    const pending = this.performSearch(input, allowNearbyFallback).then((result) => {
      if (result.status !== "live") {
        negativeFlights.set(key, { expiresAt: Date.now() + 60_000, result });
        while (negativeFlights.size > 500) negativeFlights.delete(negativeFlights.keys().next().value!);
      }
      return result;
    });
    pendingFlights.set(key, pending);
    try { return await pending; } finally { pendingFlights.delete(key); }
  }

  private async performSearch(
    input: FlightSearchInput,
    allowNearbyFallback = true,
  ): Promise<FlightSearchResult> {
    const cacheKey = JSON.stringify([this.apiKey, input.origin, input.destination, input.departure_date, input.return_date, input.traveler_count, input.cabin_class, input.market, input.currency]);
    const cached = flightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.info({ provider: "Ignav", requestType: "round_trip", cache: "hit", resultCount: cached.result.offers.length }, "Flight search cache hit");
      return cached.result;
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          origin: input.origin,
          destination: input.destination,
          departure_date: input.departure_date,
          return_date: input.return_date,
          adults: Math.min(Math.max(Math.round(input.traveler_count), 1), 9),
          cabin_class: input.cabin_class ?? "economy",
          market: input.market ?? "US",
        }),
        signal: AbortSignal.timeout(12_000),
      });

      if (!response.ok) {
        if (response.status === 400) {
          const body = await response.json().catch(() => null) as { error?: { code?: string; field?: string } } | null;
          const field = body?.error?.field;
          if (body?.error?.code === "invalid_airport_code" && (field === "origin" || field === "destination")) {
            unsupportedAirports.set(`${this.apiKey}|${input[field]}`, Date.now() + 6 * 60 * 60 * 1000);
            while (unsupportedAirports.size > 500) unsupportedAirports.delete(unsupportedAirports.keys().next().value!);
          }
        }
        logger.warn({ provider: "Ignav", requestType: "round_trip", statusCode: response.status, latencyMs: Date.now() - startedAt }, "Flight provider unavailable");
        return emptyResult(input, "Live flight information is temporarily unavailable. Kalyra is using estimated flight costs for this plan.");
      }

      const body = (await response.json()) as { itineraries?: unknown };
      const retrievedAt = new Date().toISOString();
      const sourceMetadata = liveSource("Ignav", "flight_search", retrievedAt);
      const offers = Array.isArray(body.itineraries)
        ? body.itineraries
            .map((raw): FlightOffer | null => {
              if (!raw || typeof raw !== "object") return null;
              const itinerary = raw as IgnavItinerary;
              const price = finiteNonNegative(itinerary.price?.amount);
              const currency = text(itinerary.price?.currency);
              const id = text(itinerary.ignav_id);
              const outbound = normalizeLeg(itinerary.outbound);
              const inbound = normalizeLeg(itinerary.inbound);
              if (price === null || price <= 0 || currency !== "USD" || !id || !outbound || !inbound) return null;

              const allSegments = [...outbound.segments, ...inbound.segments];
              const carriers = [...new Set(allSegments.map((segment) => segment.airline).filter((item): item is string => Boolean(item)))];
              const departure = outbound.segments[0]?.departure_datetime ?? null;
              const arrival = inbound.segments[inbound.segments.length - 1]?.arrival_datetime ?? null;
              const durationComplete = (outbound.duration_minutes ?? 0) > 0 && (inbound.duration_minutes ?? 0) > 0;
              const duration = durationComplete ? outbound.duration_minutes! + inbound.duration_minutes! : null;
              const stopsComplete = completeSegments(itinerary.outbound, outbound) && completeSegments(itinerary.inbound, inbound);
              return {
                provider_offer_id: id,
                total_price_usd: Math.round(price * 100) / 100,
                outbound,
                inbound,
                carriers,
                stop_count: Math.max(0, allSegments.length - 2),
                total_duration_minutes: duration,
                duration_complete: durationComplete,
                stops_complete: stopsComplete,
                departure_datetime: departure,
                arrival_datetime: arrival,
                booking_id: id,
                source_metadata: sourceMetadata,
              };
            })
            .filter((offer): offer is FlightOffer => offer !== null)
        : [];

      if (offers.length === 0) {
        logger.info(
          {
            provider: "Ignav",
            requestType: "round_trip",
            cache: "miss",
            resultCount: 0,
            latencyMs: Date.now() - startedAt,
          },
          "Flight provider returned no usable offers",
        );

        if (allowNearbyFallback) {
          logger.info(
            {
              provider: "Ignav",
              requestType: "nearby_date_estimate",
              origin: input.origin,
              destination: input.destination,
              departureDate: input.departure_date,
              returnDate: input.return_date,
            },
            "Attempting nearby-date flight estimate",
          );

          const nearbyOffers = await this.searchNearbyDates(input);
          const nearbyPrices = nearbyOffers.map((offer) => offer.total_price_usd);
          const estimatedPrice = median(nearbyPrices);

          logger.info(
            {
              provider: "Ignav",
              requestType: "nearby_date_estimate",
              nearbyOfferCount: nearbyOffers.length,
              nearbySearches: 6,
              estimatedPrice,
            },
            "Nearby-date flight estimate completed",
          );

          if (estimatedPrice !== null) {
            const estimatedOffer: FlightOffer = {
              provider_offer_id: `kalyra-nearby-estimate-${input.departure_date}-${input.return_date}`,
              total_price_usd: Math.round(estimatedPrice),
              outbound: {
                segments: [],
              },
              inbound: {
                segments: [],
              },
              carriers: [],
              stop_count: 0,
              total_duration_minutes: null,
              departure_datetime: null,
              arrival_datetime: null,
              source_metadata: fallbackSource("flight_search"),
            };

            return {
              status: "unavailable",
              origin: input.origin,
              destination: input.destination,
              departure_date: input.departure_date,
              return_date: input.return_date,
              offers: [],
              selected_offer: estimatedOffer,
              source_metadata: fallbackSource("flight_search"),
              recommendation_reason:
                "Estimated from live fares found on nearby travel dates because no usable fare was available for the exact dates.",
              message:
                "Live fares were unavailable for your exact dates. Kalyra estimated the flight cost using fares found on nearby dates.",
            };
          }
        }

        return emptyResult(
          input,
          "Live flight information was unavailable for these dates. Kalyra is using estimated flight costs for this plan.",
        );
      }

      const result = buildFlightComparison([{
        status: "live",
        origin: input.origin,
        destination: input.destination,
        departure_date: input.departure_date,
        return_date: input.return_date,
        offers,
        selected_offer: null,
        source_metadata: sourceMetadata,
      }])!;
      flightCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
      logger.info({ provider: "Ignav", requestType: "round_trip", cache: "miss", resultCount: offers.length, latencyMs: Date.now() - startedAt }, "Flight search completed");
      return result;
    } catch {
      logger.warn({ provider: "Ignav", requestType: "round_trip", latencyMs: Date.now() - startedAt }, "Flight provider request failed");
      return emptyResult(input, "Live flight information is temporarily unavailable. Kalyra is using estimated flight costs for this plan.");
    }
  }
}

export function getFlightProvider(): FlightProvider | null {
  const apiKey = process.env.IGNAV_API_KEY;
  return apiKey ? new IgnavFlightProvider(apiKey) : null;
}

export async function searchFlights(input: FlightSearchInput, allowNearbyFallback = true): Promise<FlightSearchResult> {
  const provider = getFlightProvider();
  if (!provider) return emptyResult(input, "Live flight information is not configured. Kalyra is using estimated flight costs for this plan.");
  return provider.search_flights(input, allowNearbyFallback);
}

export async function searchAirports(
  query: string,
  limit = 3
): Promise<string[]> {
  const provider = getFlightProvider();

  if (!(provider instanceof IgnavFlightProvider)) {
    return [];
  }

  return provider.search_airports(query, limit);
}