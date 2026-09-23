import type { ItineraryData, TripData } from "./ai";
import { searchFlights, type FlightSearchInput, type FlightSearchResult } from "./flights";
import { discoverNearbyAirports, resolveLocation } from "./places";
import { getWeatherForecast, type WeatherSearchInput } from "./weather";
import { fallbackSource } from "./sources";
import { calculateBudgetSummary, sanitizeAmount } from "./trip-utils";
import { logger } from "./logger";

const AIRPORT_ALIASES: Array<{ terms: string[]; code: string }> = [
  { terms: ["new york", "nyc", "jfk"], code: "JFK" },
  { terms: ["newark", "ewr"], code: "EWR" },
  { terms: ["boston", "bos"], code: "BOS" },
  { terms: ["chicago", "ord"], code: "ORD" },
  { terms: ["los angeles", "lax"], code: "LAX" },
  { terms: ["san francisco", "sfo"], code: "SFO" },
  { terms: ["washington", "dca", "iad"], code: "DCA" },
  { terms: ["atlanta", "atl"], code: "ATL" },
  { terms: ["miami", "mia"], code: "MIA" },
  { terms: ["rome", "roma", "fco"], code: "FCO" },
  { terms: ["milan", "mxp"], code: "MXP" },
  { terms: ["venice", "vce"], code: "VCE" },
  { terms: ["florence", "flr"], code: "FLR" },
  { terms: ["zurich", "zrh"], code: "ZRH" },
  { terms: ["geneva", "gva"], code: "GVA" },
  { terms: ["guatemala", "gua"], code: "GUA" },
  { terms: ["guatemala city"], code: "GUA" },
  { terms: ["edinburgh", "edi"], code: "EDI" },
  { terms: ["lisbon", "lis"], code: "LIS" },
  { terms: ["porto", "opo"], code: "OPO" },
  { terms: ["tokyo", "nrt", "hnd"], code: "NRT" },
  { terms: ["kyoto", "kix"], code: "KIX" },
];

const DESTINATION_AIRPORTS: Array<{ terms: string[]; code: string }> = [
  { terms: ["italy", "italian"], code: "MXP" },
  { terms: ["switzerland", "swiss"], code: "ZRH" },
  { terms: ["italy and switzerland", "italy & switzerland"], code: "MXP" },
  { terms: ["guatemala"], code: "GUA" },
  { terms: ["scotland"], code: "EDI" },
  { terms: ["portugal"], code: "LIS" },
  { terms: ["japan"], code: "NRT" },
  ...AIRPORT_ALIASES,
];

const DESTINATION_COORDINATES: Array<{ terms: string[]; latitude: number; longitude: number }> = [
  { terms: ["milan"], latitude: 45.4642, longitude: 9.19 },
  { terms: ["lake como", "como"], latitude: 45.987, longitude: 9.257 },
  { terms: ["florence"], latitude: 43.7696, longitude: 11.2558 },
  { terms: ["venice"], latitude: 45.4408, longitude: 12.3155 },
  { terms: ["rome"], latitude: 41.9028, longitude: 12.4964 },
  { terms: ["zermatt"], latitude: 46.0207, longitude: 7.7491 },
  { terms: ["interlaken"], latitude: 46.6863, longitude: 7.8632 },
  { terms: ["grindelwald"], latitude: 46.6242, longitude: 8.0414 },
  { terms: ["lucerne", "luzern"], latitude: 47.0502, longitude: 8.3093 },
  { terms: ["antigua"], latitude: 14.5586, longitude: -90.7295 },
  { terms: ["lake atitlan", "atitlan"], latitude: 14.6907, longitude: -91.2025 },
  { terms: ["flores", "tikal"], latitude: 16.927, longitude: -89.889 },
  { terms: ["guatemala city"], latitude: 14.6349, longitude: -90.5069 },
  { terms: ["edinburgh"], latitude: 55.9533, longitude: -3.1883 },
  { terms: ["scottish highlands"], latitude: 57.12, longitude: -4.71 },
  { terms: ["isle of skye", "skye"], latitude: 57.2736, longitude: -6.2155 },
  { terms: ["lisbon"], latitude: 38.7223, longitude: -9.1393 },
  { terms: ["porto"], latitude: 41.1579, longitude: -8.6291 },
  { terms: ["algarve"], latitude: 37.0179, longitude: -7.9304 },
  { terms: ["tokyo"], latitude: 35.6762, longitude: 139.6503 },
  { terms: ["kyoto"], latitude: 35.0116, longitude: 135.7681 },
  { terms: ["osaka"], latitude: 34.6937, longitude: 135.5023 },
];

function lookupCode(value: string, entries: Array<{ terms: string[]; code: string }>): string | null {
  const normalized = value.toLowerCase().trim();
  const found = entries.find((entry) => entry.terms.some((term) => normalized.includes(term)));
  if (found) return found.code;
  const exactIata = normalized.match(/\b[a-z]{3}\b/i)?.[0];
  return exactIata ? exactIata.toUpperCase() : null;
}

export function resolveAirportCode(value: string, destination = false): string | null {
  return lookupCode(value, destination ? DESTINATION_AIRPORTS : AIRPORT_ALIASES);
}

function normalizeLocationWithContext(location: string, context: string): string {
  const locTrimmed = location.trim().toLowerCase();
  const ctxTrimmed = context.trim().toLowerCase();

  // If location and context are identical, return location as-is (avoid duplication).
  if (locTrimmed === ctxTrimmed) return location.trim();

  // If context already ends with location (e.g., "Florence, Italy" contains "Florence"),
  // return context as-is to preserve the full geographic context.
  if (ctxTrimmed.endsWith(locTrimmed) || ctxTrimmed.includes(locTrimmed + ",")) {
    return context.trim();
  }

  // If location is already more specific than just the city name (e.g., "Florence, Italy"),
  // return location as-is (it already has context).
  if (location.trim().includes(",")) {
    return location.trim();
  }

  // Otherwise, append location to context to provide geographic context.
  return `${location.trim()}, ${context.trim()}`;
}

async function resolveDynamicAirportIata(locationString: string): Promise<string | null> {
  const trimmed = locationString.trim();
  if (!trimmed) return null;

  try {
    const resolved = await resolveLocation(trimmed);
    if (!resolved) return null;

    const airports = await discoverNearbyAirports(resolved);

    return airports.find((airport) => Boolean(airport.iata))?.iata ?? null;
  } catch {
    return null;
  }
}

async function resolveDynamicAirportIatas(
  locationString: string,
  maxAirports = 4
): Promise<string[]> {
  const trimmed = locationString.trim();
  if (!trimmed) return [];

  try {
    const resolved = await resolveLocation(trimmed);
    if (!resolved) return [];

    const airports = await discoverNearbyAirports(resolved);

    return airports
      .map((airport) => airport.iata)
      .filter((iata): iata is string => Boolean(iata))
      .slice(0, maxAirports);
  } catch (error) {
    logger.warn(
      {
        requestType: "airport_candidate_resolution",
        location: trimmed,
        error,
      },
      "Airport candidate resolution failed"
    );

    return [];
  }
}

export function resolveDestinationCoordinates(location: string): { latitude: number; longitude: number } | null {
  const normalized = location.toLowerCase().trim();
  return DESTINATION_COORDINATES.find((entry) => entry.terms.some((term) => normalized.includes(term))) ?? null;
}

function noFlightResult(input: FlightSearchInput, message: string): FlightSearchResult {
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

async function buildFlightInputs(
  trip: TripData,
  itinerary: ItineraryData
): Promise<FlightSearchInput[]> {
  const firstDestination = itinerary.route[0]?.location ?? trip.destination;

  const destinationWithContext = normalizeLocationWithContext(
    firstDestination,
    trip.destination
  );

  logger.info(
    {
      firstDestination,
      tripDestination: trip.destination,
      destinationWithContext,
    },
    "Destination context resolved"
  );

  let [origins, destinations] = await Promise.all([
    resolveDynamicAirportIatas(trip.starting_location, 6),
    resolveDynamicAirportIatas(destinationWithContext, 2),
  ]);

  if (origins.length === 0) {
    const fallbackOrigin = resolveAirportCode(trip.starting_location);
    if (fallbackOrigin) origins = [fallbackOrigin];
  }

  if (destinations.length === 0) {
    const fallbackDestination =
      resolveAirportCode(firstDestination, true) ??
      resolveAirportCode(trip.destination, true);

    if (fallbackDestination) destinations = [fallbackDestination];
  }

  if (origins.length === 0 || destinations.length === 0) {
    return [];
  }

  logger.info(
    {
      origins,
      destinations,
      departureDate: trip.start_date,
      returnDate: trip.end_date,
      requestType: "flight_inputs",
    },
    "Flight inputs resolved"
  );

  return destinations.flatMap((destination) =>
    origins.map((origin) => ({
      origin,
      destination,
      departure_date: trip.start_date,
      return_date: trip.end_date,
      traveler_count: trip.traveler_count,
      cabin_class: "economy" as const,
      market: "US",
      currency: "USD" as const,
    }))
  );
}

function attachFlightBudget(itinerary: ItineraryData, trip: TripData, result: FlightSearchResult): ItineraryData {
  const selected = result.selected_offer;
  if (!selected) return itinerary;
  const budgetBreakdown = itinerary.budget_breakdown.map((item) =>
    /flight|air/i.test(item.category)
      ? {
          ...item,
          estimated_amount: sanitizeAmount(selected.total_price_usd),
          description: `Round-trip fare for ${selected.carriers.join(" + ") || "selected carriers"}; ${selected.stop_count} stop${selected.stop_count === 1 ? "" : "s"}.`,
          source_metadata: selected.source_metadata,
        }
      : item
  );
  return {
    ...itinerary,
    budget_breakdown: budgetBreakdown,
    budget_summary: calculateBudgetSummary(trip.budget, budgetBreakdown),
  };
}

function localHour(value: string | null): number | null {
  const match = value?.match(/T(\d{2}):/);
  return match ? Number(match[1]) : null;
}

function applyFlightTimingContext(itinerary: ItineraryData, result: FlightSearchResult): { itinerary: ItineraryData; planningNote?: string } {
  const selected = result.selected_offer;
  if (!selected) return { itinerary };
  const arrival = selected.outbound.segments[selected.outbound.segments.length - 1]?.arrival_datetime ?? null;
  const departure = selected.inbound.segments[0]?.departure_datetime ?? null;
  const arrivalHour = localHour(arrival);
  const departureHour = localHour(departure);
  let planningNote: string | undefined;
  let dailyItinerary = itinerary.daily_itinerary;

  if (arrivalHour !== null && arrivalHour >= 19 && dailyItinerary[0]) {
    dailyItinerary = dailyItinerary.map((day, index) =>
      index === 0
        ? {
            ...day,
            evening: {
              ...day.evening,
              activity: "Arrive, settle in, and keep the first evening unhurried",
              description: "The recommended flight arrives late, so Kalyra protected the evening from a rushed activity.",
            },
          }
        : day
    );
    planningNote = `The recommended flight arrives around ${String(arrivalHour).padStart(2, "0")}:00, so the first evening is kept light.`;
  }

  if (departureHour !== null && departureHour < 8 && dailyItinerary.length > 0) {
    const lastIndex = dailyItinerary.length - 1;
    dailyItinerary = dailyItinerary.map((day, index) =>
      index === lastIndex
        ? {
            ...day,
            morning: {
              ...day.morning,
              activity: "Early departure buffer",
              description: "The recommended return flight leaves early, so the final morning is reserved for the airport and transfer.",
            },
          }
        : day
    );
    planningNote = `${planningNote ? `${planningNote} ` : ""}The return departs early, so the final morning includes an airport buffer.`;
  }

  return {
    itinerary: dailyItinerary === itinerary.daily_itinerary ? itinerary : { ...itinerary, daily_itinerary: dailyItinerary },
    planningNote,
  };
}

async function searchFlightCandidates(
  inputs: FlightSearchInput[]
): Promise<FlightSearchResult | null> {
  if (inputs.length === 0) return null;

  const batchSize = 3;

  for (let index = 0; index < inputs.length; index += batchSize) {
    const batch = inputs.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map((input) => searchFlights(input))
    );

    const liveResults = results.filter(
      (result) =>
        result.status === "live" &&
        result.selected_offer !== null
    );

    if (liveResults.length > 0) {
      const rankedResults = liveResults.sort((left, right) => {
        const leftOffer = left.selected_offer!;
        const rightOffer = right.selected_offer!;

        const leftScore =
          leftOffer.total_price_usd +
          leftOffer.stop_count * 45 +
          ((leftOffer.total_duration_minutes ?? 0) / 60) * 8;

        const rightScore =
          rightOffer.total_price_usd +
          rightOffer.stop_count * 45 +
          ((rightOffer.total_duration_minutes ?? 0) / 60) * 8;

        return leftScore - rightScore;
      });

      const selected = rankedResults[0];

      logger.info(
        {
          origin: selected.origin,
          destination: selected.destination,
          price: selected.selected_offer?.total_price_usd,
          stops: selected.selected_offer?.stop_count,
          durationMinutes: selected.selected_offer?.total_duration_minutes,
          candidatesCompared: liveResults.length,
        },
        "Flight route selected"
      );

      return selected;
    }
  }

  return null;
}

export async function enrichItineraryWithLiveData(
  itinerary: ItineraryData,
  trip: TripData
): Promise<ItineraryData> {
  const weatherPromise = Promise.all(
  [...new Set(itinerary.daily_itinerary.map((day) => day.location))]
    .map((location) => {
      const coordinates = resolveDestinationCoordinates(location);

      if (!coordinates) return null;

      const input: WeatherSearchInput = {
        location,
        ...coordinates,
        start_date: trip.start_date,
        end_date: trip.end_date,
      };

      return getWeatherForecast(input);
    })
    .filter(
      (
        result
      ): result is Promise<
        Awaited<ReturnType<typeof getWeatherForecast>>
      > => result !== null
    )
);

const flightInputs = await buildFlightInputs(trip, itinerary);
const liveFlightSearch = await searchFlightCandidates(flightInputs);

const flightSearch =
  liveFlightSearch ??
  noFlightResult(
    flightInputs[0] ?? {
      origin: "unknown",
      destination: "unknown",
      departure_date: trip.start_date,
      return_date: trip.end_date,
      traveler_count: trip.traveler_count,
    },
    flightInputs.length > 0
      ? "Live flight information was unavailable for the discovered airports. Kalyra is using estimated flight costs for this plan."
      : "Kalyra could not resolve airport codes for this route. Estimated flight costs are shown."
  );

let enriched = attachFlightBudget(itinerary, trip, flightSearch);

const timingContext = applyFlightTimingContext(enriched, flightSearch);
enriched = timingContext.itinerary;

const weatherResults = await weatherPromise;
  const weather = weatherResults.flatMap((result) => result.summaries);
  const weatherByDay = new Map(weather.map((summary) => [`${summary.location}|${summary.date}`, summary]));
  enriched = {
    ...enriched,
    daily_itinerary: enriched.daily_itinerary.map((day) => ({
      ...day,
      ...(weatherByDay.has(`${day.location}|${day.date}`)
        ? { weather: weatherByDay.get(`${day.location}|${day.date}`) }
        : {}),
    })),
    live_data: {
      flight_search: flightSearch,
      weather,
      refreshed_at: new Date().toISOString(),
      ...(timingContext.planningNote ? { planning_note: timingContext.planningNote } : {}),
    },
  };
  return enriched;
}