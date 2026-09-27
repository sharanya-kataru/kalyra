import { buildFlightComparison } from "./flight-alternatives";
import { hasPreparedWeather } from "./itinerary-weather";
import { createBaseItinerary, generateItinerary, type ItineraryData, type TripData } from "./ai";
import { enrichWalkingLegs } from "./walking";
import {
  searchFlights,
  type FlightSearchInput,
  type FlightSearchResult,
} from "./flights";
import {
  discoverNearbyAirports,
  getPlacesProvider,
  resolveLocation,
} from "./places";
import { getWeatherForecast, type WeatherSearchInput } from "./weather";
import { fallbackSource } from "./sources";
import { calculateBudgetSummary, sanitizeAmount } from "./trip-utils";
import { logger } from "./logger";
import { getRouteCandidatePool } from "./destinations";
import { distributeRestaurants } from "./restaurant-recommendations";

function normalizeLocationWithContext(
  location: string,
  context: string
): string {
  const trimmedLocation = location.trim();
  const trimmedContext = context.trim();

  if (!trimmedLocation) return trimmedContext;
  if (!trimmedContext) return trimmedLocation;

  const locationKey = trimmedLocation.toLowerCase();
  const contextKey = trimmedContext.toLowerCase();

  // Already fully contextualized.
  if (trimmedLocation.includes(",")) {
    return trimmedLocation;
  }

  if (locationKey === contextKey) {
    return trimmedLocation;
  }

  // Prefer the country attached to this specific destination candidate.
  // This keeps multi-country trips geographically unambiguous without
  // hardcoding individual destinations here.
  const routeCandidates = getRouteCandidatePool(trimmedContext);

  const matchingCandidate = routeCandidates.find(
    (candidate) => candidate.name.trim().toLowerCase() === locationKey
  );

  if (matchingCandidate?.country) {
    return `${trimmedLocation}, ${matchingCandidate.country}`;
  }

  // Preserve a context that already identifies this location.
  if (
    contextKey.endsWith(locationKey) ||
    contextKey.includes(`${locationKey},`)
  ) {
    return trimmedContext;
  }

  // Generic fallback for destinations not represented in the candidate pool.
  return `${trimmedLocation}, ${trimmedContext}`;
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

    const airports = await discoverNearbyAirports(resolved, maxAirports);

    // Rank explicit international gateways before applying the search cap;
    // nearby local airfields can otherwise crowd out usable passenger routes.
    const iataCodes = [...airports]
      .sort((a, b) => Number(Boolean(b.international)) - Number(Boolean(a.international))
        || a.distance_km - b.distance_km)
      .map((airport) => airport.iata)
      .filter((iata): iata is string => Boolean(iata));

    return [...new Set(iataCodes)].slice(0, maxAirports);
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

  const routeCandidate = getRouteCandidatePool(trip.destination).find(
    (candidate) =>
      candidate.name.toLowerCase().trim() === firstDestination.toLowerCase().trim()
  );

  const destinationContext = routeCandidate?.country ?? trip.destination;

  const destinationWithContext = normalizeLocationWithContext(
    firstDestination,
    destinationContext
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
    resolveDynamicAirportIatas(trip.starting_location, 5),
    resolveDynamicAirportIatas(destinationWithContext, 4),
  ]);

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

  const inputs: FlightSearchInput[] = [];

  const maxRank = Math.max(origins.length, destinations.length - 1);

  for (let rank = 0; rank < maxRank; rank++) {
    for (let destinationIndex = 0; destinationIndex <= rank; destinationIndex++) {
      const originIndex = rank - destinationIndex;

      const origin = origins[originIndex];
      const destination = destinations[destinationIndex];

      if (!origin || !destination || origin === destination) continue;

      inputs.push({
        origin,
        destination,
        departure_date: trip.start_date,
        return_date: trip.end_date,
        traveler_count: trip.traveler_count,
        cabin_class: "economy",
        market: "US",
        currency: "USD",
      });
    }
  }

  return inputs;
}

function attachFlightBudget(itinerary: ItineraryData, trip: TripData, result: FlightSearchResult): ItineraryData {
  const selected = result.selected_offer;
  if (!selected) return itinerary;
  const budgetBreakdown = itinerary.budget_breakdown.map((item) =>
    /flight|air/i.test(item.category)
      ? {
          ...item,
          estimated_amount: sanitizeAmount(selected.total_price_usd),
          description:
            result.status === "live"
              ? `Round-trip fare for ${selected.carriers.join(" + ") || "selected carriers"}; ${selected.stop_count} stop${selected.stop_count === 1 ? "" : "s"}.`
              : "Estimated round-trip airfare based on live fares found for nearby travel dates.",
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

export async function searchFlightCandidates(
  inputs: FlightSearchInput[],
  search: typeof searchFlights = searchFlights,
  comparisonDeadlineMs = 8_000,
  totalComparisonDeadlineMs = 12_000,
  fallbackDeadlineMs = 4_000
): Promise<FlightSearchResult | null> {
  if (inputs.length === 0) return null;

  const liveResults: FlightSearchResult[] = [];
  let bestEstimatedResult: FlightSearchResult | null = null;

  // Collect completed routes by input slot; the shared helper applies canonical score ties.
  const completed: Array<FlightSearchResult | undefined> = new Array(inputs.length);
  let acceptingResults = true;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = performance.now();
  let deadlineAt = startedAt + comparisonDeadlineMs;
  let pending = inputs.length;
  const allSettled = Promise.all(inputs.map(async (input, index) => {
    try {
      const result = await search(input, false);
      if (acceptingResults && performance.now() < deadlineAt &&
          result.origin === input.origin && result.destination === input.destination &&
          result.departure_date === input.departure_date && result.return_date === input.return_date) completed[index] = result;
    } catch {
      // A failed candidate must not prevent other routes from being compared.
    } finally {
      pending--;
    }
  }));
  async function waitUntilDeadline() {
    try {
      await Promise.race([
        allSettled,
        new Promise<void>((resolve) => {
          deadlineTimer = setTimeout(resolve, Math.max(0, deadlineAt - performance.now()));
        }),
      ]);
    } finally {
      clearTimeout(deadlineTimer);
    }
  }
  try {
    await waitUntilDeadline();
    const primarySelection = buildFlightComparison(
      completed.filter((result): result is FlightSearchResult => result !== undefined)
    );
    // Keep the normal fast path. Only an empty comparison gets additional time,
    // using the same requests and a deadline measured from the original start.
    if (!primarySelection && pending > 0) {
      deadlineAt = startedAt + totalComparisonDeadlineMs;
      await waitUntilDeadline();
    }
  } finally {
    acceptingResults = false;
  }
  const results = completed.filter((result): result is FlightSearchResult => result !== undefined);

  for (const result of results) {
      if (
        result.status === "live"
      ) {
        liveResults.push(result);
        continue;
      }

      if (
        result.status === "unavailable" &&
        result.selected_offer !== null
      ) {
        if (
          !bestEstimatedResult ||
          result.selected_offer.total_price_usd <
            bestEstimatedResult.selected_offer!.total_price_usd
        ) {
          bestEstimatedResult = result;
        }
      }
    }

  const selected = buildFlightComparison(liveResults);
  if (selected) {
    logger.info({ origin: selected.origin, destination: selected.destination,
      price: selected.selected_offer?.total_price_usd, stops: selected.selected_offer?.stop_count,
      durationMinutes: selected.selected_offer?.total_duration_minutes, candidatesCompared: liveResults.length,
      alternatives: selected.alternatives?.length ?? 0 }, "Flight route selected");
    return selected;
  }

  const fallbackInput = inputs[0];

  // Nearby-date estimates must not add another unbounded search stage after
  // the exact-date comparison. Late results may still populate provider caches.
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let nearbyResult: FlightSearchResult | null;
  try {
    nearbyResult = await Promise.race([
      Promise.resolve().then(() => search(fallbackInput, true)).catch(() => null),
      new Promise<null>((resolve) => { fallbackTimer = setTimeout(() => resolve(null), fallbackDeadlineMs); }),
    ]);
  } finally { clearTimeout(fallbackTimer); }
  if (!nearbyResult) return bestEstimatedResult;

  const recheckedLive = buildFlightComparison([nearbyResult]);
  if (recheckedLive) return recheckedLive;

  if (
    nearbyResult.status === "unavailable" &&
    nearbyResult.selected_offer !== null
  ) {
    return nearbyResult;
  }

  return bestEstimatedResult;
}

async function searchItineraryFlights(itinerary: ItineraryData, trip: TripData): Promise<FlightSearchResult> {
  const flightInputs = await buildFlightInputs(trip, itinerary);
  const liveFlightSearch = await searchFlightCandidates(flightInputs);

  return liveFlightSearch ??
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
}

/** Flights depend on the route and dates, not on weather or activity discovery. */
export async function generateEnrichedItinerary(trip: TripData): Promise<ItineraryData> {
  const base = createBaseItinerary(trip);
  const [itinerary, flightSearch] = await Promise.all([
    generateItinerary(trip, base),
    searchItineraryFlights(base, trip),
  ]);
  return enrichItineraryWithLiveData(itinerary, trip, { flightSearch });
}

export async function enrichItineraryWithLiveData(
  itinerary: ItineraryData,
  trip: TripData,
  options: { flightSearch?: FlightSearchResult; reuseWeather?: boolean } = {}
): Promise<ItineraryData> {
  // Start independent flight discovery/search before awaiting restaurants.
  const flightPromise = options.flightSearch ? Promise.resolve(options.flightSearch) : searchItineraryFlights(itinerary, trip);
  const resolvedLocations = new Map<string, { location: string; lat: number; lon: number }>();
  const weatherPromise = Promise.all(
    [...new Set(itinerary.daily_itinerary.map((day) => day.location))]
      .map(async (location) => {
        const locationWithContext = normalizeLocationWithContext(
          location,
          trip.destination
        );
        const resolved = await resolveLocation(locationWithContext);

        const days = itinerary.daily_itinerary.filter((day) => day.location === location);
        const reusable = options.reuseWeather && days.every((day) => day.weather?.location === location
          && day.weather.date === day.date && Date.now() - Date.parse(day.weather.source_metadata.retrieved_at ?? "") < 60 * 60 * 1000);
        const preparedWeather = hasPreparedWeather(itinerary) || reusable
          ? { summaries: days.flatMap((day) => day.weather ? [day.weather] : []) } : null;
        if (!resolved) return preparedWeather;
        resolvedLocations.set(location, { location, lat: resolved.lat, lon: resolved.lon });

        const input: WeatherSearchInput = {
          location,
          latitude: resolved.lat,
          longitude: resolved.lon,
          start_date: trip.start_date,
          end_date: trip.end_date,
        };

        if (preparedWeather) return preparedWeather;
        return getWeatherForecast(input);
      })

);

const placesProvider = getPlacesProvider();

const restaurantEntries = placesProvider
  ? await Promise.all(
      [...new Set(itinerary.daily_itinerary.map((day) => day.location))].map(
        async (location) => {
          const locationWithContext = normalizeLocationWithContext(
            location,
            trip.destination
          );

          const restaurants = await placesProvider.search_restaurants(
            locationWithContext,
            10
          );

          return [location, restaurants] as const;
        }
      )
    )
  : [];

const restaurantsByLocation = new Map(
  restaurantEntries.map(([location, restaurants]) => [
    location,
    restaurants.map((restaurant) => restaurant.name),
  ])
);

const flightSearch = await flightPromise;

let enriched = attachFlightBudget(itinerary, trip, flightSearch);

const timingContext = applyFlightTimingContext(enriched, flightSearch);
enriched = timingContext.itinerary;

const weatherResults = await weatherPromise;
  const weather = weatherResults.flatMap((result) => result?.summaries ?? []);
  const weatherByDay = new Map(weather.map((summary) => [`${summary.location}|${summary.date}`, summary]));
  const restaurantsByDay = distributeRestaurants(
    enriched.daily_itinerary.map((day) => day.location),
    restaurantsByLocation
  );
  enriched = {
    ...enriched,
    daily_itinerary: enriched.daily_itinerary.map((day, index) => {
      return {
        ...day,
        food_recommendations: restaurantsByDay[index],
        weather: weatherByDay.get(`${day.location}|${day.date}`),
      };
    }),
    live_data: {
      locations: itinerary.route.flatMap((stop) => {
        const resolved = resolvedLocations.get(stop.location);
        return resolved ? [resolved] : [];
      }),
      flight_search: flightSearch,
      weather,
      refreshed_at: new Date().toISOString(),
      ...(timingContext.planningNote ? { planning_note: timingContext.planningNote } : {}),
    },
  };
  return enrichWalkingLegs(enriched);
}
