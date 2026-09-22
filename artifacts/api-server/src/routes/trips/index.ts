import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, tripsTable, itinerariesTable, tripModificationsTable } from "@workspace/db";
import {
  CreateTripBody,
  GetTripParams,
  AnalyzeTripParams,
  GenerateItineraryParams,
  ModifyItineraryParams,
  ModifyItineraryBody,
} from "@workspace/api-zod";
import {
  analyzeTrip,
  generateItinerary,
  modifyItinerary,
  normalizeItinerary,
  hasAI,
  type TripData,
  type ItineraryData,
  type RouteStop,
} from "../../lib/ai";
import { computeTripHealthScore } from "../../lib/scoring";
import { DESTINATIONS } from "../../lib/destinations";
import { parseDateRangeFromText, parseTripDuration } from "../../lib/trip-utils";
import { enrichItineraryWithLiveData } from "../../lib/live-data";

const router: IRouter = Router();

// Helper: load trip or 404
async function loadTrip(id: string) {
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, id));
  return trip ?? null;
}

// Helper: load latest itinerary for a trip
async function loadLatestItinerary(tripId: string) {
  const [itinerary] = await db
    .select()
    .from(itinerariesTable)
    .where(eq(itinerariesTable.tripId, tripId))
    .orderBy(desc(itinerariesTable.version))
    .limit(1);
  return itinerary ?? null;
}

// Helper: build TripData for AI from DB trip row
function buildTripData(trip: typeof tripsTable.$inferSelect): TripData {
  return {
    id: trip.id,
    destination: trip.destination,
    starting_location: trip.startingLocation,
    start_date: trip.startDate,
    end_date: trip.endDate,
    traveler_count: trip.travelerCount,
    budget: Number(trip.budget),
    budget_preference: trip.budgetPreference,
    traveler_profile: trip.travelerProfile as { interests: string[]; travel_style: string; preferences: string[] },
  };
}

// Helper: format itinerary row into API shape, with optional health score computation
function formatItinerary(
  row: typeof itinerariesTable.$inferSelect,
  tripData: TripData
) {
  const itineraryData = normalizeItinerary({
    trip_id: row.tripId,
    trip_strategy: row.tripStrategy,
    currency: row.currency as "USD",
    total_days: row.totalDays,
    total_nights: row.totalNights,
    route: row.route as RouteStop[],
    destinations: row.destinations as any,
    daily_itinerary: row.dailyItinerary as any,
    daily_schedule: row.dailySchedule as any,
    budget_breakdown: row.budgetBreakdown as any,
    budget_summary: row.budgetSummary as any,
    live_data: row.liveData as any,
    reasoning: row.reasoning,
    tradeoffs: row.tradeoffs as any,
  }, tripData);

  const health_score = computeTripHealthScore(itineraryData, tripData);

  return {
    id: row.id,
    trip_id: row.tripId,
    currency: itineraryData.currency,
    total_days: itineraryData.total_days,
    total_nights: itineraryData.total_nights,
    trip_strategy: itineraryData.trip_strategy,
    route: itineraryData.route,
    destinations: itineraryData.destinations,
    daily_itinerary: itineraryData.daily_itinerary,
    daily_schedule: itineraryData.daily_schedule,
    budget_breakdown: itineraryData.budget_breakdown,
    budget_summary: itineraryData.budget_summary,
    live_data: itineraryData.live_data,
    reasoning: itineraryData.reasoning,
    tradeoffs: itineraryData.tradeoffs,
    health_score,
    version: row.version,
    created_at: row.createdAt.toISOString(),
  };
}

// Helper: format trip row into API shape
function formatTrip(
  trip: typeof tripsTable.$inferSelect,
  itinerary: typeof itinerariesTable.$inferSelect | null
) {
  const tripData = buildTripData(trip);
  return {
    id: trip.id,
    destination: trip.destination,
    starting_location: trip.startingLocation,
    start_date: trip.startDate,
    end_date: trip.endDate,
    traveler_count: trip.travelerCount,
    budget: Number(trip.budget),
    currency: trip.currency,
    budget_preference: trip.budgetPreference,
    traveler_profile: trip.travelerProfile as { interests: string[]; travel_style: string; preferences: string[] },
    created_at: trip.createdAt.toISOString(),
    latest_itinerary: itinerary ? formatItinerary(itinerary, tripData) : null,
  };
}

// POST /trips — create a new trip
router.post("/trips", async (req, res): Promise<void> => {
  const parsed = CreateTripBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  let normalizedDates;
  try {
    normalizedDates = parseTripDuration(d.start_date, d.end_date);
  } catch {
    res.status(400).json({
      error: "We couldn't understand those dates. Try selecting them from the calendar or entering a date like September 18, 2026.",
    });
    return;
  }

  const [trip] = await db
    .insert(tripsTable)
    .values({
      destination: d.destination,
      startingLocation: d.starting_location,
      startDate: normalizedDates.start_date,
      endDate: normalizedDates.end_date,
      travelerCount: d.traveler_count,
      budget: String(d.budget),
      currency: "USD",
      budgetPreference: d.budget_preference,
      travelerProfile: d.traveler_profile,
    })
    .returning();

  req.log.info({ tripId: trip.id }, "Trip created");
  res.status(201).json(formatTrip(trip, null));
});

// GET /trips/:id — retrieve trip with latest itinerary
router.get("/trips/:id", async (req, res): Promise<void> => {
  const params = GetTripParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const trip = await loadTrip(params.data.id);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const itinerary = await loadLatestItinerary(trip.id);
  res.json(formatTrip(trip, itinerary));
});

// POST /trips/:id/analyze — AI destination analysis
router.post("/trips/:id/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeTripParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const trip = await loadTrip(params.data.id);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  req.log.info({ tripId: trip.id, aiEnabled: hasAI() }, "Analyzing trip");
  const analysis = await analyzeTrip(buildTripData(trip));
  res.json(analysis);
});

// POST /trips/:id/generate — AI itinerary generation
router.post("/trips/:id/generate", async (req, res): Promise<void> => {
  const params = GenerateItineraryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const trip = await loadTrip(params.data.id);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  req.log.info({ tripId: trip.id, aiEnabled: hasAI() }, "Generating itinerary");

  const tripData = buildTripData(trip);
  const itineraryData = await enrichItineraryWithLiveData(
    await generateItinerary(tripData),
    tripData
  );

  // Get current latest version number
  const existing = await loadLatestItinerary(trip.id);
  const version = (existing?.version ?? 0) + 1;

  const [saved] = await db
    .insert(itinerariesTable)
    .values({
      tripId: trip.id,
      tripStrategy: itineraryData.trip_strategy,
      currency: itineraryData.currency,
      totalDays: itineraryData.total_days,
      totalNights: itineraryData.total_nights,
      route: itineraryData.route,
      destinations: itineraryData.destinations,
      dailyItinerary: itineraryData.daily_itinerary,
      dailySchedule: itineraryData.daily_schedule,
      budgetBreakdown: itineraryData.budget_breakdown,
      budgetSummary: itineraryData.budget_summary,
      liveData: itineraryData.live_data ?? null,
      reasoning: itineraryData.reasoning,
      tradeoffs: itineraryData.tradeoffs,
      version,
    })
    .returning();

  res.json(formatItinerary(saved, tripData));
});

// POST /trips/:id/refresh-live-data — refresh provider-backed flight and weather data
router.post("/trips/:id/refresh-live-data", async (req, res): Promise<void> => {
  const params = GetTripParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const trip = await loadTrip(params.data.id);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  const existing = await loadLatestItinerary(trip.id);
  if (!existing) {
    res.status(409).json({ error: "Generate an itinerary before refreshing live travel data." });
    return;
  }

  const tripData = buildTripData(trip);
  const refreshed = await enrichItineraryWithLiveData(
    normalizeItinerary({
      trip_id: existing.tripId,
      trip_strategy: existing.tripStrategy,
      currency: existing.currency as "USD",
      total_days: existing.totalDays,
      total_nights: existing.totalNights,
      route: existing.route as RouteStop[],
      destinations: existing.destinations as any,
      daily_itinerary: existing.dailyItinerary as any,
      daily_schedule: existing.dailySchedule as any,
      budget_breakdown: existing.budgetBreakdown as any,
      budget_summary: existing.budgetSummary as any,
      live_data: existing.liveData as any,
      reasoning: existing.reasoning,
      tradeoffs: existing.tradeoffs as any,
    }, tripData),
    tripData
  );

  const [updated] = await db
    .update(itinerariesTable)
    .set({
      budgetBreakdown: refreshed.budget_breakdown,
      budgetSummary: refreshed.budget_summary,
      dailyItinerary: refreshed.daily_itinerary,
      dailySchedule: refreshed.daily_schedule,
      liveData: refreshed.live_data ?? null,
    })
    .where(eq(itinerariesTable.id, existing.id))
    .returning();

  res.json(formatItinerary(updated, tripData));
});

// POST /trips/:id/modify — AI itinerary modification
router.post("/trips/:id/modify", async (req, res): Promise<void> => {
  const params = ModifyItineraryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bodyParsed = ModifyItineraryBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const trip = await loadTrip(params.data.id);
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const currentItinerary = await loadLatestItinerary(trip.id);
  if (!currentItinerary) {
    res.status(400).json({ error: "No itinerary found. Generate an itinerary first." });
    return;
  }

  req.log.info({ tripId: trip.id, aiEnabled: hasAI() }, "Modifying itinerary");

  const tripData = buildTripData(trip);

  const currentData = normalizeItinerary({
    trip_id: currentItinerary.tripId,
    trip_strategy: currentItinerary.tripStrategy,
    currency: currentItinerary.currency as "USD",
    total_days: currentItinerary.totalDays,
    total_nights: currentItinerary.totalNights,
    route: currentItinerary.route as RouteStop[],
    destinations: currentItinerary.destinations as any,
    daily_itinerary: currentItinerary.dailyItinerary as any,
    daily_schedule: currentItinerary.dailySchedule as any,
    budget_breakdown: currentItinerary.budgetBreakdown as any,
    budget_summary: currentItinerary.budgetSummary as any,
    live_data: currentItinerary.liveData as any,
    reasoning: currentItinerary.reasoning,
    tradeoffs: currentItinerary.tradeoffs as any,
  }, tripData);

  // Compute before-score to include in response
  const scoreBefore = computeTripHealthScore(currentData, tripData);

  const requestedDuration = parseDateRangeFromText(bodyParsed.data.user_request);
  if (requestedDuration) {
    const updatedTripData: TripData = {
      ...tripData,
      start_date: requestedDuration.start_date,
      end_date: requestedDuration.end_date,
    };
    const regenerated = await enrichItineraryWithLiveData(
      await generateItinerary(updatedTripData),
      updatedTripData
    );
    const scoreAfter = computeTripHealthScore(regenerated, updatedTripData);
    const scoreDelta = scoreAfter.overall - scoreBefore.overall;
    const scoreSign = scoreDelta >= 0 ? "+" : "";
    const scoreReasoning = `Trip dates were updated and live travel data was refreshed. Actual Trip Health Score: ${scoreBefore.overall} → ${scoreAfter.overall} (${scoreSign}${scoreDelta}).`;

    await db
      .update(tripsTable)
      .set({
        startDate: updatedTripData.start_date,
        endDate: updatedTripData.end_date,
      })
      .where(eq(tripsTable.id, trip.id));

    const [savedItinerary] = await db
      .insert(itinerariesTable)
      .values({
        tripId: trip.id,
        tripStrategy: regenerated.trip_strategy,
        currency: regenerated.currency,
        totalDays: regenerated.total_days,
        totalNights: regenerated.total_nights,
        route: regenerated.route,
        destinations: regenerated.destinations,
        dailyItinerary: regenerated.daily_itinerary,
        dailySchedule: regenerated.daily_schedule,
        budgetBreakdown: regenerated.budget_breakdown,
        budgetSummary: regenerated.budget_summary,
        liveData: regenerated.live_data ?? null,
        reasoning: scoreReasoning,
        tradeoffs: regenerated.tradeoffs,
        version: currentItinerary.version + 1,
      })
      .returning();

    const [savedMod] = await db
      .insert(tripModificationsTable)
      .values({
        tripId: trip.id,
        userRequest: bodyParsed.data.user_request,
        previousItineraryId: currentItinerary.id,
        updatedItineraryId: savedItinerary.id,
        changesMade: [
          `Trip dates updated to ${updatedTripData.start_date} through ${updatedTripData.end_date}.`,
          "Live flight and weather data refreshed for the new dates.",
        ],
        reasoning: scoreReasoning,
      })
      .returning();

    res.json({
      id: savedMod.id,
      trip_id: savedMod.tripId,
      user_request: savedMod.userRequest,
      changes_made: savedMod.changesMade,
      reasoning: savedMod.reasoning,
      score_before: scoreBefore,
      score_after: scoreAfter,
      itinerary: formatItinerary(savedItinerary, updatedTripData),
      created_at: savedMod.createdAt.toISOString(),
    });
    return;
  }

  const result = await modifyItinerary(tripData, currentData, bodyParsed.data.user_request);

  // Compute after-score on the new itinerary
  const scoreAfter = computeTripHealthScore(result.itinerary, tripData);
  const scoreDelta = scoreAfter.overall - scoreBefore.overall;
  const scoreSign = scoreDelta >= 0 ? "+" : "";
  const scoreReasoning = result.reasoning.includes("Actual Trip Health Score:")
    ? result.reasoning
    : `${result.reasoning} Actual Trip Health Score: ${scoreBefore.overall} → ${scoreAfter.overall} (${scoreSign}${scoreDelta}).`;

  // Save new itinerary version
  const [savedItinerary] = await db
    .insert(itinerariesTable)
    .values({
      tripId: trip.id,
      tripStrategy: result.itinerary.trip_strategy,
      currency: result.itinerary.currency,
      totalDays: result.itinerary.total_days,
      totalNights: result.itinerary.total_nights,
      route: result.itinerary.route,
      destinations: result.itinerary.destinations,
      dailyItinerary: result.itinerary.daily_itinerary,
      dailySchedule: result.itinerary.daily_schedule,
      budgetBreakdown: result.itinerary.budget_breakdown,
      budgetSummary: result.itinerary.budget_summary,
      liveData: result.itinerary.live_data ?? currentItinerary.liveData ?? null,
      reasoning: scoreReasoning,
      tradeoffs: result.itinerary.tradeoffs,
      version: currentItinerary.version + 1,
    })
    .returning();

  // Record the modification
  const [savedMod] = await db
    .insert(tripModificationsTable)
    .values({
      tripId: trip.id,
      userRequest: bodyParsed.data.user_request,
      previousItineraryId: currentItinerary.id,
      updatedItineraryId: savedItinerary.id,
      changesMade: result.changes_made,
      reasoning: scoreReasoning,
    })
    .returning();

  res.json({
    id: savedMod.id,
    trip_id: savedMod.tripId,
    user_request: savedMod.userRequest,
    changes_made: savedMod.changesMade,
    reasoning: savedMod.reasoning,
    score_before: scoreBefore,
    score_after: scoreAfter,
    itinerary: formatItinerary(savedItinerary, tripData),
    created_at: savedMod.createdAt.toISOString(),
  });
});

// GET /destinations — expose the scoring catalog
router.get("/destinations", (_req, res): void => {
  const destinations = Object.entries(DESTINATIONS).map(([name, attrs]) => ({
    name,
    avg_daily_cost_usd: attrs.avg_daily_cost_usd,
    budget_level: attrs.budget_level,
    nature: attrs.nature,
    photography: attrs.photography,
    food: attrs.food,
    culture: attrs.culture,
    uniqueness: attrs.uniqueness,
    transport_complexity: attrs.transport_complexity,
    crowd_level: attrs.crowd_level,
    ideal_stay_min: attrs.ideal_stay_days.min,
    ideal_stay_max: attrs.ideal_stay_days.max,
  }));
  res.json({ destinations });
});

export default router;
