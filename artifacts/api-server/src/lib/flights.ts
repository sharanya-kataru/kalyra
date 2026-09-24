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

export interface FlightSearchResult {
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
  search_flights(input: FlightSearchInput): Promise<FlightSearchResult>;
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
const flightCache = new Map<string, { expiresAt: number; result: FlightSearchResult }>();

function finiteNonNegative(value: unknown): number | null {
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

function selectRecommendedOffer(offers: FlightOffer[]): FlightOffer | null {
  if (offers.length === 0) return null;
  return [...offers].sort((left, right) => {
    const leftValue = left.total_price_usd + (left.stop_count * 45) + ((left.total_duration_minutes ?? 0) / 60) * 8;
    const rightValue = right.total_price_usd + (right.stop_count * 45) + ((right.total_duration_minutes ?? 0) / 60) * 8;
    return leftValue - rightValue;
  })[0] ?? null;
}

function recommendationReason(offers: FlightOffer[], selected: FlightOffer): string {
  const cheapest = [...offers].sort((left, right) => left.total_price_usd - right.total_price_usd)[0];
  if (!cheapest || cheapest.provider_offer_id === selected.provider_offer_id) {
    return "Recommended using the best combined balance of price, stops, and total travel time.";
  }
  const priceDelta = Math.round(selected.total_price_usd - cheapest.total_price_usd);
  const stopDelta = cheapest.stop_count - selected.stop_count;
  const durationDelta = (cheapest.total_duration_minutes ?? 0) - (selected.total_duration_minutes ?? 0);
  const advantages = [
    stopDelta > 0 ? `${stopDelta} fewer connection${stopDelta === 1 ? "" : "s"}` : "",
    durationDelta > 0 ? `about ${Math.round(durationDelta / 60)} fewer travel hours` : "",
  ].filter(Boolean);
  return advantages.length > 0
    ? `Costs about $${priceDelta} more than the lowest fare but offers ${advantages.join(" and ")}.`
    : "Recommended using the best combined balance of price, stops, and total travel time.";
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

  async search_flights(
    input: FlightSearchInput,
    allowNearbyFallback = true,
  ): Promise<FlightSearchResult> {
    const cacheKey = JSON.stringify(input);
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
              if (price === null || currency !== "USD" || !id || !outbound || !inbound) return null;

              const allSegments = [...outbound.segments, ...inbound.segments];
              const carriers = [...new Set(allSegments.map((segment) => segment.airline).filter((item): item is string => Boolean(item)))];
              const departure = outbound.segments[0]?.departure_datetime ?? null;
              const arrival = inbound.segments[inbound.segments.length - 1]?.arrival_datetime ?? null;
              const duration = (outbound.duration_minutes ?? 0) + (inbound.duration_minutes ?? 0);
              return {
                provider_offer_id: id,
                total_price_usd: Math.round(price * 100) / 100,
                outbound,
                inbound,
                carriers,
                stop_count: Math.max(0, allSegments.length - 2),
                total_duration_minutes: duration > 0 ? duration : null,
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

      const selected = selectRecommendedOffer(offers);
      const result: FlightSearchResult = {
        status: "live",
        origin: input.origin,
        destination: input.destination,
        departure_date: input.departure_date,
        return_date: input.return_date,
        offers,
        selected_offer: selected,
        source_metadata: sourceMetadata,
        ...(selected ? { recommendation_reason: recommendationReason(offers, selected) } : {}),
      };
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
  return provider.search_flights(input);
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