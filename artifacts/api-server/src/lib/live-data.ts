import type { ItineraryData, TripData } from "./ai";
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

    const airports = await discoverNearbyAirports(resolved);

    const iataCodes = airports
      .map((airport) => airport.iata)
      .filter((iata): iata is string => Boolean(iata));

    return iataCodes.slice(0, maxAirports);
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

      if (!origin || !destination) continue;

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
  comparisonDeadlineMs = 8_000
): Promise<FlightSearchResult | null> {
  if (inputs.length === 0) return null;

  const liveResults: FlightSearchResult[] = [];
  let bestEstimatedResult: FlightSearchResult | null = null;

  // Retain input order for score ties, irrespective of completion order.
  const completed: Array<FlightSearchResult | undefined> = new Array(inputs.length);
  let acceptingResults = true;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlineAt = performance.now() + comparisonDeadlineMs;
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        deadlineTimer = setTimeout(resolve, comparisonDeadlineMs);
      }),
      Promise.all(inputs.map(async (input, index) => {
        try {
          const result = await search(input, false);
          if (acceptingResults && performance.now() < deadlineAt) completed[index] = result;
        } catch {
          // A failed candidate must not prevent other routes from being compared.
        }
      })),
    ]);
  } finally {
    acceptingResults = false;
    clearTimeout(deadlineTimer);
  }
  const results = completed.filter((result): result is FlightSearchResult => result !== undefined);

  for (const result of results) {
      if (
        result.status === "live" &&
        result.selected_offer !== null
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

  const fallbackInput = inputs[0];

  const nearbyResult = await search(fallbackInput, true);

  if (
    nearbyResult.status === "unavailable" &&
    nearbyResult.selected_offer !== null
  ) {
    return nearbyResult;
  }

  return bestEstimatedResult;
}

export async function enrichItineraryWithLiveData(
  itinerary: ItineraryData,
  trip: TripData
): Promise<ItineraryData> {
  const resolvedLocations = new Map<string, { location: string; lat: number; lon: number }>();
  const weatherPromise = Promise.all(
    [...new Set(itinerary.daily_itinerary.map((day) => day.location))]
      .map(async (location) => {
        const locationWithContext = normalizeLocationWithContext(
          location,
          trip.destination
        );
        const resolved = await resolveLocation(locationWithContext);

        if (!resolved) return null;
        resolvedLocations.set(location, { location, lat: resolved.lat, lon: resolved.lon });

        const input: WeatherSearchInput = {
          location,
          latitude: resolved.lat,
          longitude: resolved.lon,
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
        ...(weatherByDay.has(`${day.location}|${day.date}`)
          ? { weather: weatherByDay.get(`${day.location}|${day.date}`) }
          : {}),
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
