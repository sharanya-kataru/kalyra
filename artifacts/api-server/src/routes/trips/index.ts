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
import { analyzeTrip, generateItinerary, modifyItinerary, hasAI, type TripData } from "../../lib/ai";

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

// Helper: format trip row into API shape
function formatTrip(trip: typeof tripsTable.$inferSelect, itinerary: typeof itinerariesTable.$inferSelect | null) {
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
    created_at: trip.createdAt.toISOString(),
    latest_itinerary: itinerary ? formatItinerary(itinerary) : null,
  };
}

// Helper: format itinerary row into API shape
function formatItinerary(row: typeof itinerariesTable.$inferSelect) {
  return {
    id: row.id,
    trip_id: row.tripId,
    trip_strategy: row.tripStrategy,
    route: row.route,
    destinations: row.destinations,
    daily_schedule: row.dailySchedule,
    budget_breakdown: row.budgetBreakdown,
    reasoning: row.reasoning,
    tradeoffs: row.tradeoffs,
    version: row.version,
    created_at: row.createdAt.toISOString(),
  };
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

// POST /trips — create a new trip
router.post("/trips", async (req, res): Promise<void> => {
  const parsed = CreateTripBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  const [trip] = await db
    .insert(tripsTable)
    .values({
      destination: d.destination,
      startingLocation: d.starting_location,
      startDate: d.start_date,
      endDate: d.end_date,
      travelerCount: d.traveler_count,
      budget: String(d.budget),
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

  const data = buildTripData(trip);
  const itineraryData = await generateItinerary(data);

  // Get current latest version number
  const existing = await loadLatestItinerary(trip.id);
  const version = (existing?.version ?? 0) + 1;

  const [saved] = await db
    .insert(itinerariesTable)
    .values({
      tripId: trip.id,
      tripStrategy: itineraryData.trip_strategy,
      route: itineraryData.route,
      destinations: itineraryData.destinations,
      dailySchedule: itineraryData.daily_schedule,
      budgetBreakdown: itineraryData.budget_breakdown,
      reasoning: itineraryData.reasoning,
      tradeoffs: itineraryData.tradeoffs,
      version,
    })
    .returning();

  res.json(formatItinerary(saved));
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
  const currentData = {
    trip_strategy: currentItinerary.tripStrategy,
    route: currentItinerary.route as any,
    destinations: currentItinerary.destinations as any,
    daily_schedule: currentItinerary.dailySchedule as any,
    budget_breakdown: currentItinerary.budgetBreakdown as any,
    reasoning: currentItinerary.reasoning,
    tradeoffs: currentItinerary.tradeoffs as any,
  };

  const result = await modifyItinerary(tripData, currentData, bodyParsed.data.user_request);

  // Save new itinerary version
  const [savedItinerary] = await db
    .insert(itinerariesTable)
    .values({
      tripId: trip.id,
      tripStrategy: result.itinerary.trip_strategy,
      route: result.itinerary.route,
      destinations: result.itinerary.destinations,
      dailySchedule: result.itinerary.daily_schedule,
      budgetBreakdown: result.itinerary.budget_breakdown,
      reasoning: result.itinerary.reasoning,
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
      reasoning: result.reasoning,
    })
    .returning();

  res.json({
    id: savedMod.id,
    trip_id: savedMod.tripId,
    user_request: savedMod.userRequest,
    changes_made: savedMod.changesMade,
    reasoning: savedMod.reasoning,
    itinerary: formatItinerary(savedItinerary),
    created_at: savedMod.createdAt.toISOString(),
  });
});

export default router;
