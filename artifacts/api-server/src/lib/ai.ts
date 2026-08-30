import OpenAI from "openai";
import { logger } from "./logger";
import {
  lookupDestination,
  destinationSummary,
  resolveRouteCandidates,
  type RouteCandidate,
} from "./destinations";
import { buildScoringContext, computeTripHealthScore, type TripHealthScore } from "./scoring";
import {
  addDays,
  calculateBudgetSummary,
  daysBetween,
  parseTripDuration,
  sanitizeAmount,
  type BudgetSummary,
} from "./trip-utils";
import { collectPlaceContext } from "./places";

// Client is lazy — only constructed if the env var is present
let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export function hasAI(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ---------------------------------------------------------------------------
// Types mirroring the OpenAPI contract
// ---------------------------------------------------------------------------

export interface TravelerProfile {
  interests: string[];
  travel_style: string;
  preferences: string[];
}

export interface TripData {
  id: string;
  destination: string;
  starting_location: string;
  start_date: string;
  end_date: string;
  traveler_count: number;
  budget: number;
  budget_preference: string;
  traveler_profile: TravelerProfile;
}

export interface DestinationScore {
  name: string;
  score: number;
  reasoning: string;
  drawbacks: string;
}

export interface TripAnalysis {
  trip_strategy: string;
  destinations: DestinationScore[];
  reasoning: string;
}

export interface RouteStop {
  location: string;
  destination?: string;
  country?: string;
  nights: number;
  transport_to_next: string | null;
  duration_hours: number | null;
  why_selected?: string;
  experience_score?: number;
}

export interface DailyActivity {
  morning: string;
  afternoon: string;
  evening: string;
  food_recommendation: string;
  transport: string;
  estimated_cost: number;
}

export interface DailyActivityPart {
  activity: string;
  description: string;
  estimated_cost_usd: number;
}

export interface DailyTransportation {
  mode: string;
  details: string;
  duration: string;
}

export interface DailyItinerary {
  day: number;
  date: string;
  location: string;
  morning: DailyActivityPart;
  afternoon: DailyActivityPart;
  evening: DailyActivityPart;
  food_recommendations: string[];
  transportation: DailyTransportation;
  estimated_daily_cost_usd: number;
}

export interface DailySchedule {
  day: number;
  date: string;
  location: string;
  activities: DailyActivity;
}

export interface BudgetItem {
  category: string;
  estimated_amount: number;
  description: string;
}

export interface TradeoffItem {
  description: string;
  impact: string;
}

export interface ItineraryData {
  trip_id?: string;
  currency: "USD";
  total_days: number;
  total_nights: number;
  trip_strategy: string;
  route: RouteStop[];
  destinations: DestinationScore[];
  daily_itinerary: DailyItinerary[];
  daily_schedule: DailySchedule[];
  budget_breakdown: BudgetItem[];
  budget_summary: BudgetSummary;
  reasoning: string;
  tradeoffs: TradeoffItem[];
}

export interface ChangeMade {
  description: string;
  type: string;
}

export interface ModificationResult {
  changes_made: ChangeMade[];
  reasoning: string;
  itinerary: ItineraryData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build destination catalog context for the analyze prompt */
function buildAnalyzeDestinationContext(trip: TripData): string {
  const rawDestinations = trip.destination.split(/[,/&+]+/).map((d) => d.trim()).filter(Boolean);
  const lines: string[] = ["Destination catalog data (from scoring engine):"];
  for (const dest of rawDestinations) {
    const attrs = lookupDestination(dest);
    if (attrs) {
      lines.push(`  • ${destinationSummary(dest, attrs)}`);
    }
  }
  if (lines.length === 1) {
    lines.push("  (No catalog entries found — use your own knowledge for scoring)");
  }
  lines.push("");
  lines.push("INSTRUCTION: Use the above attribute data to inform your destination scores. The scores you");
  lines.push("return should be consistent with the catalog values. Reference specific attributes in your reasoning.");
  return lines.join("\n");
}

function normalizeRoute(
  rawRoute: unknown,
  candidates: RouteCandidate[],
  totalNights: number
): RouteStop[] {
  const input = Array.isArray(rawRoute) ? rawRoute : [];
  const parsed = input
    .map((item): RouteStop | null => {
      const row = item as Record<string, unknown>;
      const name = String(row.location ?? row.destination ?? "").trim();
      return name
        ? {
            location: name,
            destination: name,
            country: String(row.country ?? ""),
            nights: Math.max(1, sanitizeAmount(row.nights, 1)),
            transport_to_next: row.transport_to_next ? String(row.transport_to_next) : null,
            duration_hours:
              row.duration_hours === null || row.duration_hours === undefined
                ? null
                : Math.max(0, Number(row.duration_hours) || 0),
            why_selected: String(row.why_selected ?? ""),
            experience_score: sanitizeAmount(row.experience_score, 0) || undefined,
          }
        : null;
    })
    .filter((item): item is RouteStop => item !== null);

  const broadInput = parsed.length === 1 && candidates.length > 1 &&
    !candidates.some((candidate) => candidate.name.toLowerCase() === parsed[0].location.toLowerCase());
  const route = broadInput || parsed.length === 0
    ? candidates.map((candidate, index) => ({
        location: candidate.name,
        destination: candidate.name,
        country: candidate.country,
        nights: 1,
        transport_to_next: index < candidates.length - 1 ? "train or bus" : null,
        duration_hours: index < candidates.length - 1 ? 2 : null,
      }))
    : parsed;

  const limited = route.slice(0, Math.max(1, Math.min(route.length, totalNights)));
  let remaining = totalNights;
  const result = limited.map((stop, index) => {
    const slotsLeft = limited.length - index;
    const preferred = Math.max(1, sanitizeAmount(stop.nights, 1));
    const nights = index === limited.length - 1
      ? Math.max(1, remaining)
      : Math.max(1, Math.min(preferred, remaining - (slotsLeft - 1)));
    remaining -= nights;
    return { ...stop, nights };
  });

  if (remaining > 0 && result.length > 0) {
    result[result.length - 1].nights += remaining;
  }

  return result.map((stop, index) => ({
    ...stop,
    transport_to_next: index < result.length - 1 ? stop.transport_to_next ?? "train or bus" : null,
    duration_hours: index < result.length - 1 ? stop.duration_hours ?? 2 : null,
  }));
}

function activityPart(
  value: unknown,
  fallbackActivity: string,
  fallbackDescription: string,
  fallbackCost: number
): DailyActivityPart {
  if (typeof value === "object" && value !== null) {
    const row = value as Record<string, unknown>;
    return {
      activity: String(row.activity ?? fallbackActivity),
      description: String(row.description ?? fallbackDescription),
      estimated_cost_usd: sanitizeAmount(row.estimated_cost_usd, fallbackCost),
    };
  }
  return {
    activity: fallbackActivity,
    description: typeof value === "string" && value ? value : fallbackDescription,
    estimated_cost_usd: fallbackCost,
  };
}

function normalizeDailyItinerary(
  rawItinerary: unknown,
  rawSchedule: unknown,
  route: RouteStop[],
  trip: TripData,
  totalDays: number
): DailyItinerary[] {
  const richInput = Array.isArray(rawItinerary) ? rawItinerary : [];
  const legacyInput = Array.isArray(rawSchedule) ? rawSchedule : [];
  const result: DailyItinerary[] = [];
  const dailyFallbackCost = Math.max(0, Math.round(trip.budget / Math.max(totalDays, 1) * 0.4));

  for (let index = 0; index < totalDays; index += 1) {
    const rich = (richInput[index] ?? {}) as Record<string, unknown>;
    const legacy = (legacyInput[index] ?? {}) as Record<string, unknown>;
    const location = String(
      rich.location ??
        legacy.location ??
        route.find((_, routeIndex) => index < route.slice(0, routeIndex + 1).reduce((sum, stop) => sum + stop.nights, 0))?.location ??
        route[route.length - 1]?.location ??
        trip.destination
    );
    const legacyActivities = (legacy.activities ?? {}) as Record<string, unknown>;
    const transferDay = index > 0 && route.some(
      (stop, routeIndex) =>
        stop.location === location &&
        routeIndex > 0 &&
        index === route.slice(0, routeIndex).reduce((sum, item) => sum + item.nights, 0)
    );

    const morning = activityPart(
      rich.morning ?? legacyActivities.morning,
      transferDay ? "Arrive, settle in, and take an easy neighborhood walk" : "Explore the local character of the area",
      transferDay ? "Keep the first hours light after the transfer." : "A realistic, interest-led start to the day.",
      dailyFallbackCost
    );
    const afternoon = activityPart(
      rich.afternoon ?? legacyActivities.afternoon,
      "A focused local experience matched to your interests",
      "A flexible block with enough time for an unhurried visit.",
      dailyFallbackCost
    );
    const evening = activityPart(
      rich.evening ?? legacyActivities.evening,
      "Relaxed dinner and an easy evening",
      "Leave space to follow a local recommendation.",
      dailyFallbackCost
    );
    const transportation = (rich.transportation ?? {}) as Record<string, unknown>;
    const food = Array.isArray(rich.food_recommendations)
      ? rich.food_recommendations.map(String).filter(Boolean)
      : [String(legacyActivities.food_recommendation ?? "Ask your accommodation for a local recommendation.")];

    result.push({
      day: index + 1,
      date: String(rich.date ?? legacy.date ?? addDays(trip.start_date, index)),
      location,
      morning,
      afternoon,
      evening,
      food_recommendations: food.length > 0 ? food : ["Ask a local for one trusted recommendation."],
      transportation: {
        mode: String(transportation.mode ?? legacyActivities.transport ?? "Walk and local transit"),
        details: String(transportation.details ?? legacyActivities.transport ?? "Use local transit and walk between nearby stops."),
        duration: String(transportation.duration ?? (transferDay ? "Light transfer day" : "Local movement")),
      },
      estimated_daily_cost_usd: sanitizeAmount(
        rich.estimated_daily_cost_usd ??
          legacyActivities.estimated_cost ??
          morning.estimated_cost_usd + afternoon.estimated_cost_usd + evening.estimated_cost_usd,
        dailyFallbackCost
      ),
    });
  }

  return result;
}

function routeLocationForDay(route: RouteStop[], dayIndex: number): string {
  if (route.length === 0) return "";
  const totalNights = route.reduce((sum, stop) => sum + stop.nights, 0);
  if (dayIndex >= totalNights) return route[route.length - 1].location;

  let nightsThroughStop = 0;
  for (const stop of route) {
    nightsThroughStop += stop.nights;
    if (dayIndex < nightsThroughStop) return stop.location;
  }
  return route[route.length - 1].location;
}

function reassignScheduleLocations(
  schedule: DailySchedule[],
  route: RouteStop[],
  totalDays: number
): DailySchedule[] {
  return Array.from({ length: totalDays }, (_, index) => {
    const existing = schedule[index];
    return {
      day: index + 1,
      date: existing?.date ?? "",
      location: routeLocationForDay(route, index) || existing?.location || "",
      activities: existing?.activities
        ? { ...existing.activities }
        : {
            morning: "Keep the morning flexible.",
            afternoon: "Explore at your own pace.",
            evening: "Relaxed local evening.",
            food_recommendation: "Ask a local for one trusted recommendation.",
            transport: "Walk and local transit",
            estimated_cost: 0,
          },
    };
  });
}

function reassignDailyItineraryLocations(
  days: DailyItinerary[],
  route: RouteStop[],
  totalDays: number
): DailyItinerary[] {
  return Array.from({ length: totalDays }, (_, index) => {
    const existing = days[index];
    return existing
      ? { ...existing, day: index + 1, location: routeLocationForDay(route, index) || existing.location }
      : {
          day: index + 1,
          date: "",
          location: routeLocationForDay(route, index),
          morning: activityPart(undefined, "Keep the morning flexible.", "Leave room to explore.", 0),
          afternoon: activityPart(undefined, "Explore at your own pace.", "Choose one local experience.", 0),
          evening: activityPart(undefined, "Relaxed local evening.", "Follow a local recommendation.", 0),
          food_recommendations: ["Ask a local for one trusted recommendation."],
          transportation: { mode: "Walk and local transit", details: "Move locally.", duration: "Flexible" },
          estimated_daily_cost_usd: 0,
        };
  });
}

function legacyScheduleFromRich(days: DailyItinerary[]): DailySchedule[] {
  return days.map((day) => ({
    day: day.day,
    date: day.date,
    location: day.location,
    activities: {
      morning: `${day.morning.activity}: ${day.morning.description}`,
      afternoon: `${day.afternoon.activity}: ${day.afternoon.description}`,
      evening: `${day.evening.activity}: ${day.evening.description}`,
      food_recommendation: day.food_recommendations.join(" · "),
      transport: `${day.transportation.mode}: ${day.transportation.details}`,
      estimated_cost: day.estimated_daily_cost_usd,
    },
  }));
}

function normalizeBudgetBreakdown(
  rawBreakdown: unknown,
  trip: TripData,
  totalNights: number
): BudgetItem[] {
  const input = Array.isArray(rawBreakdown) ? rawBreakdown : [];
  const normalized = input
    .map((item) => {
      const row = item as Record<string, unknown>;
      const category = String(row.category ?? "").trim();
      return category
        ? {
            category,
            estimated_amount: sanitizeAmount(row.estimated_amount, 0),
            description: String(row.description ?? "Estimated; no live provider connected."),
          }
        : null;
    })
    .filter((item): item is BudgetItem => item !== null);

  const defaults = [
    ["Flights", 0, `Estimated round trip from ${trip.starting_location}; live flight data not connected.`],
    ["Accommodation", Math.round(trip.budget * 0.3), `${totalNights} nights; estimated until a hotel provider is connected.`],
    ["Food", Math.round(trip.budget * 0.18), "Estimated local restaurants and markets."],
    ["Activities", Math.round(trip.budget * 0.14), "Estimated entrance fees and experiences."],
    ["Transportation", Math.round(trip.budget * 0.08), "Estimated trains, local transit, and transfers."],
  ] as const;

  const output = defaults.map(([category, fallbackAmount, description]) => {
    const existing = normalized.find((item) => item.category.toLowerCase().includes(category.toLowerCase().slice(0, 5)));
    return existing ?? { category, estimated_amount: fallbackAmount, description };
  });

  return output.map((item) => ({
    ...item,
    estimated_amount: sanitizeAmount(item.estimated_amount, 0),
    description: item.description || "Estimate unavailable.",
  }));
}

export function normalizeItinerary(
  raw: Partial<ItineraryData>,
  trip: TripData,
  _totalDaysHint?: number
): ItineraryData {
  const duration = parseTripDuration(trip.start_date, trip.end_date);
  const totalDays = duration.total_days;
  const totalNights = duration.total_nights;
  const candidates = resolveRouteCandidates(trip.destination, totalDays);
  const route = normalizeRoute(raw.route, candidates, totalNights);
  const dailyItinerary = normalizeDailyItinerary(
    raw.daily_itinerary,
    raw.daily_schedule,
    route,
    trip,
    totalDays
  );
  const budgetBreakdown = normalizeBudgetBreakdown(raw.budget_breakdown, trip, totalNights);
  const destinations = (Array.isArray(raw.destinations) ? raw.destinations : route).map((item, index) => {
    const row = item as Partial<DestinationScore> & { destination?: string };
    const name = String(row.name ?? row.destination ?? route[index]?.location ?? trip.destination);
    return {
      name,
      score: Math.min(100, Math.max(0, sanitizeAmount(row.score, 65))),
      reasoning: String(row.reasoning ?? "Selected using the structured destination scoring engine."),
      drawbacks: String(row.drawbacks ?? "Costs and availability remain estimates until live providers are connected."),
    };
  });

  return {
    trip_id: trip.id,
    currency: "USD",
    total_days: totalDays,
    total_nights: totalNights,
    trip_strategy: String(raw.trip_strategy ?? `A considered route through ${trip.destination}.`),
    route,
    destinations,
    daily_itinerary: dailyItinerary,
    daily_schedule: legacyScheduleFromRich(dailyItinerary),
    budget_breakdown: budgetBreakdown,
    budget_summary: calculateBudgetSummary(trip.budget, budgetBreakdown),
    reasoning: String(raw.reasoning ?? "This route balances experience fit, pacing, transport, and budget."),
    tradeoffs: Array.isArray(raw.tradeoffs)
      ? raw.tradeoffs.map((item) => ({
          description: String((item as TradeoffItem).description ?? "Tradeoff considered"),
          impact: String((item as TradeoffItem).impact ?? "See the Trip Health Score for detail."),
        }))
      : [],
  };
}

// ---------------------------------------------------------------------------
// ANALYZE — destination scoring and strategy
// ---------------------------------------------------------------------------

export async function analyzeTrip(trip: TripData): Promise<TripAnalysis> {
  const client = getClient();
  const catalogContext = buildAnalyzeDestinationContext(trip);

  if (client) {
    const systemPrompt = `You are Roamwise, an expert travel advisor backed by a structured destination scoring engine.
Analyze the traveler's trip using the provided catalog data. Be honest and specific.
Challenge assumptions when a destination does not match the traveler's stated interests.
Return structured JSON only.`;

    const userPrompt = `Analyze this trip request:
Destination: ${trip.destination}
From: ${trip.starting_location}
Dates: ${trip.start_date} to ${trip.end_date}
Travelers: ${trip.traveler_count}
Budget: $${trip.budget} (preference: ${trip.budget_preference})
Interests: ${trip.traveler_profile.interests.join(", ")}
Travel style: ${trip.traveler_profile.travel_style}
Preferences: ${trip.traveler_profile.preferences.join(", ")}

${catalogContext}

Return JSON matching this exact schema:
{
  "trip_strategy": "2-3 sentence strategic recommendation for this traveler",
  "destinations": [
    {
      "name": "destination name",
      "score": 85,
      "reasoning": "why this fits — reference specific catalog attributes like nature, food, culture scores",
      "drawbacks": "honest assessment with reference to catalog data (crowd level, budget mismatch, etc.)"
    }
  ],
  "reasoning": "overall reasoning for the strategy, referencing attribute tradeoffs"
}

Include 3-5 destinations within or adjacent to the requested area. Score each 0-100 based on match with this specific traveler's interests. Reference catalog attribute scores directly in your explanations.`;

    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        return JSON.parse(content) as TripAnalysis;
      }
    } catch (err) {
      logger.error({ err }, "OpenAI analyze call failed, using fallback");
    }
  }

  // Deterministic fallback based on actual trip data
  return buildFallbackAnalysis(trip);
}

// ---------------------------------------------------------------------------
// GENERATE — full itinerary
// ---------------------------------------------------------------------------

export async function generateItinerary(trip: TripData): Promise<ItineraryData> {
  const client = getClient();
  const { total_days: totalDays, total_nights: totalNights } = parseTripDuration(
    trip.start_date,
    trip.end_date
  );
  const candidates = resolveRouteCandidates(trip.destination, totalDays);

  // Build a placeholder itinerary to generate scoring context
  // Broad country inputs are expanded into usable bases before the AI sees them.
  const placeholderRoute: RouteStop[] = candidates.map((candidate, i) => ({
    location: candidate.name,
    destination: candidate.name,
    country: candidate.country,
    nights: Math.max(1, Math.floor(totalNights / candidates.length)),
    transport_to_next: i < candidates.length - 1 ? "train or bus" : null,
    duration_hours: i < candidates.length - 1 ? 2.5 : null,
  }));

  // Build catalog context for these destinations
  const catalogLines: string[] = ["Destination catalog data (from scoring engine):"];
  for (const dest of candidates.map((candidate) => candidate.name)) {
    const attrs = lookupDestination(dest);
    if (attrs) {
      catalogLines.push(`  • ${destinationSummary(dest, attrs)}`);
    }
  }

  const [catalogContext, placesContext] = await Promise.all([
    Promise.resolve(catalogLines.join("\n")),
    collectPlaceContext(
      candidates.map((candidate) => candidate.name),
      trip.traveler_profile.interests
    ),
  ]);

  if (client) {
    const systemPrompt = `You are Roamwise, an expert travel advisor backed by a structured scoring engine.
Create a detailed, personalized itinerary using the provided catalog attribute data.
Every recommendation should be grounded in the scoring data and specific to this traveler's interests.
Return structured JSON only.`;

    const userPrompt = `Create a detailed itinerary for this trip:
Destination: ${trip.destination}
From: ${trip.starting_location}
Dates: ${trip.start_date} to ${trip.end_date} (${totalDays} days / ${totalNights} nights)
Travelers: ${trip.traveler_count}
Budget: $${trip.budget} total (preference: ${trip.budget_preference})
Interests: ${trip.traveler_profile.interests.join(", ")}
Travel style: ${trip.traveler_profile.travel_style}
Preferences: ${trip.traveler_profile.preferences.join(", ")}

${catalogContext}

${placesContext}

SCORING GUIDANCE:
- Prioritize destinations with high scores for the traveler's top interests
- Pacing: match nights at each stop to the catalog's ideal_stay_days range
- Budget: avg_daily_cost_usd from catalog should inform accommodation and activity recommendations
- In destination scores and reasoning, reference catalog attribute values directly
- The route must use specific bases from this candidate list: ${candidates.map((candidate) => candidate.name).join(", ")}
- Do not collapse the route into the broad country/region name.

Return JSON matching this exact schema:
{
  "trip_strategy": "2-3 sentence summary referencing key catalog attributes that drove routing decisions",
  "currency": "USD",
  "total_days": ${totalDays},
  "total_nights": ${totalNights},
  "route": [
    {
      "location": "City/Area name",
      "nights": 2,
      "transport_to_next": "train/flight/bus/drive or null if last stop",
      "duration_hours": 1.5
    }
  ],
  "destinations": [
    {
      "name": "destination name",
      "score": 90,
      "reasoning": "why selected — reference catalog scores (e.g. 'Photography 95/100, Nature 88/100')",
      "drawbacks": "honest tradeoffs referencing catalog data (crowd level, cost, transport complexity)"
    }
  ],
  "daily_itinerary": [
    {
      "day": 1,
      "date": "${trip.start_date}",
      "location": "City name",
      "morning": { "activity": "specific activity", "description": "realistic details", "estimated_cost_usd": 30 },
      "afternoon": { "activity": "specific activity", "description": "realistic details", "estimated_cost_usd": 40 },
      "evening": { "activity": "specific activity", "description": "realistic details", "estimated_cost_usd": 35 },
      "food_recommendations": ["specific local food option"],
      "transportation": { "mode": "walk", "details": "realistic movement", "duration": "20 minutes" },
      "estimated_daily_cost_usd": 105
    }
  ],
  "budget_breakdown": [
    { "category": "Flights", "estimated_amount": 800, "description": "Round trip from ${trip.starting_location}" },
    { "category": "Accommodation", "estimated_amount": 600, "description": "Hotels for ${totalDays} nights" },
    { "category": "Food", "estimated_amount": 400, "description": "Restaurants and local markets" },
    { "category": "Activities", "estimated_amount": 300, "description": "Entrance fees and experiences" },
    { "category": "Transport", "estimated_amount": 200, "description": "Local transport and transfers" }
  ],
  "budget_summary": { "currency": "USD", "total_budget": ${trip.budget} },
  "reasoning": "Why this itinerary optimizes for this traveler — reference specific catalog scores and tradeoffs",
  "tradeoffs": [
    { "description": "tradeoff description with score impact", "impact": "positive or negative impact with score reference" }
  ]
}

Create exactly ${totalDays} entries in daily_itinerary. The first and last days must account for arrival and departure. Transfer days must have lighter schedules. Personalize every activity to the traveler's interests (${trip.traveler_profile.interests.join(", ")}). All money is USD. Budget breakdown must sum close to $${trip.budget}; arithmetic will be recalculated by code.`;

    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        return normalizeItinerary(JSON.parse(content) as Partial<ItineraryData>, trip, totalDays);
      }
    } catch (err) {
      logger.error({ err }, "OpenAI generate call failed, using fallback");
    }
  }

  return normalizeItinerary(buildFallbackItinerary(trip, totalDays), trip, totalDays);
}

// ---------------------------------------------------------------------------
// MODIFY — iterative editing with score-aware reasoning
// ---------------------------------------------------------------------------

export async function modifyItinerary(
  trip: TripData,
  currentItinerary: ItineraryData,
  userRequest: string
): Promise<ModificationResult> {
  const client = getClient();

  // Compute current health score to inject into prompt
  const currentScore = computeTripHealthScore(currentItinerary, trip);
  const scoringContext = buildScoringContext(currentItinerary, trip, currentScore);

  if (client) {
    const systemPrompt = `You are Roamwise, an expert travel advisor backed by a structured scoring engine.
When modifying itineraries, reference the scoring data to explain tradeoffs with concrete numbers.
Example: "Moving one night from Milan to Zermatt increases Experience Fit by ~8 points because Zermatt scores 99/100 on Nature vs Milan's 10/100, which better matches your photography interests."
Return structured JSON only.`;

    const userPrompt = `The traveler wants to modify their itinerary.

Trip context:
- Destination: ${trip.destination}
- Budget: $${trip.budget} (preference: ${trip.budget_preference})
- Interests: ${trip.traveler_profile.interests.join(", ")}
- Travel style: ${trip.traveler_profile.travel_style}

Current itinerary: ${currentItinerary.trip_strategy}

Traveler request: "${userRequest}"

${scoringContext}

Return JSON matching this schema:
{
  "changes_made": [
    { "description": "what specifically changed, with score impact where applicable", "type": "destination|budget|schedule|duration|activity|transport" }
  ],
  "reasoning": "2-4 sentences referencing catalog scores and score deltas. Use format: 'This increases [Dimension] by ~N points because [attribute data]...' Be specific about tradeoffs.",
  "itinerary": { ...complete updated itinerary in the same format as the original... }
}

The itinerary field must be a complete updated itinerary with the same structure as:
${JSON.stringify(currentItinerary).slice(0, 2000)}...

Make targeted changes that genuinely address the request. Your reasoning MUST reference specific scores from the scoring data above.`;

    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content) as ModificationResult;
        return {
          changes_made: Array.isArray(parsed.changes_made) ? parsed.changes_made : [],
          reasoning: String(parsed.reasoning ?? "Updated using the structured scoring engine."),
          itinerary: normalizeItinerary(
            (parsed.itinerary ?? currentItinerary) as Partial<ItineraryData>,
            trip,
            currentItinerary.total_days || daysBetween(trip.start_date, trip.end_date)
          ),
        };
      }
    } catch (err) {
      logger.error({ err }, "OpenAI modify call failed, using fallback");
    }
  }

  return buildFallbackModification(trip, currentItinerary, userRequest, currentScore);
}

// ---------------------------------------------------------------------------
// Fallbacks — deterministic, input-derived, score-informed
// ---------------------------------------------------------------------------

function buildFallbackAnalysis(trip: TripData): TripAnalysis {
  const interests = trip.traveler_profile.interests;
  const hasNature = interests.some((i) =>
    ["Nature", "Mountain landscapes", "Photography", "Adventure", "Water & swimming"].includes(i)
  );
  const hasCity = interests.some((i) =>
    ["Food", "Local food", "Culture", "History", "Art & design", "Architecture", "Shopping", "Nightlife"].includes(i)
  );

  const rawDestinations = resolveRouteCandidates(trip.destination, daysBetween(trip.start_date, trip.end_date))
    .map((candidate) => candidate.name);
  const destinations: DestinationScore[] = rawDestinations.map((dest, i) => {
    const attrs = lookupDestination(dest);

    if (attrs) {
      // Use real catalog data for scoring
      const natureInterestScore = hasNature ? attrs.nature * 0.6 + attrs.photography * 0.4 : 0;
      const cityInterestScore = hasCity ? attrs.food * 0.35 + attrs.culture * 0.4 + attrs.uniqueness * 0.25 : 0;
      const interestBase = hasNature && hasCity
        ? (natureInterestScore + cityInterestScore) / 2
        : hasNature ? natureInterestScore : hasCity ? cityInterestScore : attrs.uniqueness;

      const crowdPenalty = hasNature ? (attrs.crowd_level / 100) * 10 : 0;
      const score = Math.round(Math.min(100, Math.max(40, interestBase - crowdPenalty - i * 3)));

      const crowdNote = attrs.crowd_level >= 80 ? `Crowd level is HIGH (${attrs.crowd_level}/100).` : "";
      const costNote = `~$${attrs.avg_daily_cost_usd}/day on the ground.`;

      return {
        name: dest,
        score,
        reasoning: `${dest} scores ${attrs.nature}/100 on Nature, ${attrs.photography}/100 on Photography, ${attrs.food}/100 on Food, and ${attrs.culture}/100 on Culture. ${hasNature ? `Strong natural landscape access makes this a good fit for your interests.` : `Cultural richness and food scene align with your stated priorities.`}`,
        drawbacks: `${crowdNote} ${costNote} ${attrs.transport_complexity >= 50 ? "Transport navigation can be complex." : ""}`.trim(),
      };
    }

    // No catalog entry — derive from heuristics
    const isNatureDestination = /alps|mountain|lake|forest|coast|swiss|norway|highland|isle/i.test(dest);
    const isCityDestination = /milan|paris|rome|barcelona|amsterdam|vienna|berlin|madrid|lisbon/i.test(dest);
    let score = 70;
    if (hasNature && isNatureDestination) score = 90;
    if (hasCity && isCityDestination) score = 86;
    if (hasNature && isCityDestination) score = 58;
    if (hasCity && isNatureDestination) score = 62;
    score = Math.max(48, score - i * 5);

    return {
      name: dest,
      score,
      reasoning: `${dest} offers alignment with your ${interests.slice(0, 2).join(" and ")} interests. ${isNatureDestination ? "The natural setting directly matches your preferences." : "The urban culture and food scene will engage your interests."}`,
      drawbacks: score < 73
        ? `${dest} may not fully satisfy your ${hasNature ? "nature and photography" : "cultural"} priorities.`
        : `Peak season crowds can reduce the authentic feel. Early morning visits are recommended.`,
    };
  });

  const sorted = [...destinations].sort((a, b) => b.score - a.score);
  const topDest = sorted[0];
  const lowDest = sorted[sorted.length - 1];

  return {
    trip_strategy: `Based on your ${interests.slice(0, 3).join(", ")} interests and ${trip.budget_preference.toLowerCase()} budget preference, we recommend prioritizing ${topDest?.name ?? trip.destination} for the deepest experience value. ${destinations.length > 1 && lowDest && lowDest.name !== topDest?.name ? `Consider whether time in ${lowDest.name} is worth the transit overhead given your pace preference.` : "Focus on depth over breadth for this destination."}`,
    destinations,
    reasoning: `With ${daysBetween(trip.start_date, trip.end_date)} days and a $${trip.budget} budget, the key tension is between covering more ground versus experiencing fewer places more deeply. Your ${trip.traveler_profile.travel_style.toLowerCase()} travel style suggests prioritizing quality encounters over quantity.`,
  };
}

function buildFallbackItinerary(trip: TripData, totalDays: number): Partial<ItineraryData> {
  const interests = trip.traveler_profile.interests;
  const tripNights = parseTripDuration(trip.start_date, trip.end_date).total_nights;
  const destinations = resolveRouteCandidates(trip.destination, totalDays).map((candidate) => candidate.name);

  // Use catalog data to determine ideal nights per destination
  const destNights = destinations.map((dest) => {
    const attrs = lookupDestination(dest);
    if (attrs) {
      // Pick the midpoint of ideal stay, bounded by trip length
      return Math.max(1, Math.min(
        Math.ceil((attrs.ideal_stay_days.min + attrs.ideal_stay_days.max) / 2),
        Math.floor(tripNights / destinations.length)
      ));
    }
    return Math.max(1, Math.floor(tripNights / destinations.length));
  });

  // Normalize nights to sum to the nights between arrival and departure.
  const plannedNights = destNights.reduce((a, b) => a + b, 0);
  const scale = tripNights / Math.max(plannedNights, 1);
  const normalizedNights = destNights.map((n, i) => {
    if (i === destNights.length - 1) {
      return tripNights - destNights.slice(0, -1).reduce((a, b) => a + Math.round(b * scale), 0);
    }
    return Math.max(1, Math.round(n * scale));
  });

  const candidates = resolveRouteCandidates(trip.destination, totalDays);
  const route: RouteStop[] = destinations.map((dest, i) => ({
    location: dest,
    destination: dest,
    country: candidates[i]?.country ?? "",
    nights: normalizedNights[i] ?? 2,
    transport_to_next: i < destinations.length - 1 ? "train" : null,
    duration_hours: i < destinations.length - 1 ? 2.5 : null,
    why_selected: "Selected from the destination catalog for fit, pacing, and transport efficiency.",
    experience_score: undefined,
  }));

  const daily_schedule: DailySchedule[] = [];
  for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
    const location = routeLocationForDay(route, dayIndex);
    const hasNature = interests.some((i) => ["Nature", "Mountain landscapes", "Photography", "Adventure"].includes(i));
    const hasFood = interests.some((i) => ["Food", "Local food"].includes(i));
    const hasCulture = interests.some((i) => ["Culture", "History", "Art & design", "Architecture"].includes(i));
    const attrs = lookupDestination(location);
    const isArrivalDay = dayIndex === 0;
    const isDepartureDay = dayIndex === totalDays - 1;
    const isTransferDay = !isArrivalDay && routeLocationForDay(route, dayIndex - 1) !== location;

    daily_schedule.push({
      day: dayIndex + 1,
      date: addDays(trip.start_date, dayIndex),
      location,
      activities: {
        morning: isDepartureDay
          ? `Easy final morning in ${location} and pack for departure`
          : isTransferDay
          ? `Transfer into ${location}, settle in, and take an easy orientation walk`
          : hasNature
          ? `Morning exploration of ${location}'s natural surroundings — golden hour photography${attrs && attrs.photography >= 85 ? ` (photography score: ${attrs.photography}/100)` : ""}`
          : hasCulture
          ? `Visit the historic center of ${location} — local market and architecture walk${attrs && attrs.culture >= 85 ? ` (culture score: ${attrs.culture}/100)` : ""}`
          : `Orient in ${location}, check in, and take a neighborhood walk`,
        afternoon: isDepartureDay
          ? `Keep the afternoon open for a final meal before leaving`
          : hasFood
          ? `Local food market and culinary experience — regional specialties${attrs && attrs.food >= 85 ? ` (food scene rated ${attrs.food}/100)` : ""}`
          : `Explore the highlights of ${location} at your own pace`,
        evening: isDepartureDay
          ? `Early dinner or airport transfer from ${location}`
          : `Dinner at a locally-recommended restaurant — ${hasFood ? "prioritize off-menu local spots" : "relaxed evening"}`,
        food_recommendation: attrs && attrs.food >= 80
          ? `${location} has a strong local food scene (${attrs.food}/100). Ask your accommodation for their single best local recommendation.`
          : `Ask your accommodation for the one restaurant they'd send a trusted friend to.`,
        transport: isArrivalDay
          ? `Arrive from ${trip.starting_location}`
          : isTransferDay
          ? `Transfer from the previous base`
          : isDepartureDay
          ? `Depart from ${location}`
          : "Walk and local transit",
        estimated_cost: Math.round(((attrs?.avg_daily_cost_usd ?? (trip.budget / totalDays * 0.4)) * 0.4)),
      },
    });
  }

  // Budget using catalog avg costs where available
  const avgDailyCost = destinations.reduce((sum, dest) => {
    const attrs = lookupDestination(dest);
    return sum + (attrs?.avg_daily_cost_usd ?? trip.budget / totalDays);
  }, 0) / destinations.length;

  const flightBudget = Math.round(trip.budget * 0.28);
  const accomBudget = Math.round(trip.budget * 0.30);
  const foodBudget = Math.round(trip.budget * 0.18);
  const activityBudget = Math.round(trip.budget * 0.14);
  const transportBudget = trip.budget - flightBudget - accomBudget - foodBudget - activityBudget;

  // Compute destination scores from catalog
  const scoredDestinations: DestinationScore[] = destinations.map((dest, i) => {
    const attrs = lookupDestination(dest);
    if (!attrs) {
      return {
        name: dest,
        score: Math.max(60, 88 - i * 8),
        reasoning: `Selected for alignment with your ${interests.slice(0, 2).join(" and ")} priorities`,
        drawbacks: "Allow extra time — the best experiences are off the obvious path",
      };
    }
    const topInterestScore = interests.includes("Nature") || interests.includes("Mountain landscapes")
      ? attrs.nature
      : interests.includes("Photography") ? attrs.photography
      : interests.includes("Food") || interests.includes("Local food") ? attrs.food
      : interests.includes("Culture") || interests.includes("History") ? attrs.culture
      : attrs.uniqueness;

    return {
      name: dest,
      score: Math.round(Math.min(99, topInterestScore * 0.85 + 15)),
      reasoning: `Nature ${attrs.nature}/100, Photography ${attrs.photography}/100, Food ${attrs.food}/100, Culture ${attrs.culture}/100. Ideal stay ${attrs.ideal_stay_days.min}–${attrs.ideal_stay_days.max} nights.`,
      drawbacks: `Avg ~$${attrs.avg_daily_cost_usd}/day. ${attrs.crowd_level >= 80 ? "High season crowds — early mornings recommended." : attrs.crowd_level <= 35 ? "Low crowds — excellent for an immersive experience." : "Moderate crowds at peak times."}`,
    };
  });

  return {
    trip_strategy: `A ${totalDays}-day journey through ${trip.destination} optimized for ${interests.slice(0, 2).join(" and ")}. The route matches destination catalog ideal stay lengths and minimizes unnecessary transit.`,
    route,
    destinations: scoredDestinations,
    daily_schedule,
    budget_breakdown: [
      { category: "Flights", estimated_amount: flightBudget, description: `Round trip from ${trip.starting_location}` },
      { category: "Accommodation", estimated_amount: accomBudget, description: `${tripNights} nights across ${destinations.length} ${destinations.length === 1 ? "location" : "locations"}` },
      { category: "Food", estimated_amount: foodBudget, description: "Local restaurants and markets" },
      { category: "Activities", estimated_amount: activityBudget, description: `Entrance fees and ${interests.slice(0, 1).join(", ")} experiences` },
      { category: "Transportation", estimated_amount: transportBudget, description: "Estimated trains, taxis, and day trips" },
    ],
    reasoning: `Average destination cost ~$${Math.round(avgDailyCost)}/day. Itinerary pacing follows catalog ideal stay ranges for each destination. ${trip.budget_preference === "Keep it lean" ? "Budget prioritizes free and low-cost experiences." : trip.budget_preference === "A few beautiful splurges" ? "Budget includes room for a few standout splurge experiences." : "Budget is balanced across all categories."}`,
    tradeoffs: [
      {
        description: `Nights allocation follows catalog ideal stay ranges (${destinations.map((d) => { const a = lookupDestination(d); return a ? `${d}: ${a.ideal_stay_days.min}–${a.ideal_stay_days.max} nights` : d; }).join(", ")})`,
        impact: "Pacing optimized — reduces the risk of feeling rushed or overstaying.",
      },
      {
        description: `Destination avg cost: ~$${Math.round(avgDailyCost)}/day vs your daily budget of ~$${Math.round(trip.budget / totalDays)}/day`,
        impact: avgDailyCost <= trip.budget / totalDays ? "Good budget alignment — room for quality meals and experiences." : "Slight budget stretch — focus spend on the experiences that matter most.",
      },
    ],
  };
}

function buildFallbackModification(
  trip: TripData,
  current: ItineraryData,
  request: string,
  currentScore?: TripHealthScore
): ModificationResult {
  const req = request.toLowerCase();
  const scoreRef = currentScore ? ` (current overall: ${currentScore.overall}/100)` : "";

  const wantsCheaper = /cheap|budget|save|less money|reduce cost/i.test(req);
  const wantsNature = /nature|outdoor|mountain|hiking|scenery/i.test(req);
  const wantsSlower = /slow|relax|fewer destinations|less rushing/i.test(req);
  const wantsFood = /food|eat|restaurant|culinary|cuisine/i.test(req);
  const requestedDay = req.match(/\bday\s*(\d+)\b/)?.[1];
  const addDestination = /add\s+(lake atitlan|atitlán|zermatt|tikal|antigua|nature)/i.exec(request)?.[1];

  const changes: ChangeMade[] = [];
  let reasoning = "";
  const updatedItinerary = {
    ...current,
    route: current.route.map((stop) => ({ ...stop })),
    daily_itinerary: current.daily_itinerary.map((day) => ({
      ...day,
      morning: { ...day.morning },
      afternoon: { ...day.afternoon },
      evening: { ...day.evening },
      food_recommendations: [...day.food_recommendations],
      transportation: { ...day.transportation },
    })),
    daily_schedule: current.daily_schedule.map((day) => ({
      ...day,
      activities: { ...day.activities },
    })),
  };

  if (wantsSlower && wantsNature) {
    changes.push({ description: "Removed one rushed stop and shifted remaining mornings toward nature", type: "destination" });
    if (updatedItinerary.route.length > 1) {
      const removalIndex = updatedItinerary.route.reduce((lowestIndex, stop, index, route) => {
        const stopNature = lookupDestination(stop.location)?.nature ?? 65;
        const lowestNature = lookupDestination(route[lowestIndex].location)?.nature ?? 65;
        return stopNature < lowestNature ? index : lowestIndex;
      }, 0);
      const removed = updatedItinerary.route.splice(removalIndex, 1)[0];
      const receivingStop = updatedItinerary.route[removalIndex] ?? updatedItinerary.route[removalIndex - 1];
      if (receivingStop) {
        receivingStop.nights += removed.nights;
      }
      updatedItinerary.daily_schedule = reassignScheduleLocations(
        current.daily_schedule,
        updatedItinerary.route,
        current.total_days
      );
      updatedItinerary.daily_itinerary = reassignDailyItineraryLocations(
        current.daily_itinerary,
        updatedItinerary.route,
        current.total_days
      );
      const pacingScore = currentScore?.pacing.score ?? 68;
      const experienceScore = currentScore?.experience_fit.score ?? 68;
      reasoning = `This slower, nature-forward route targets Pacing from ${pacingScore}/100 and Experience Fit from ${experienceScore}/100. Removing ${removed.location} eliminates a transition; the remaining stops now have more time for the catalog's higher-nature experiences.`;
    } else {
      updatedItinerary.daily_schedule = current.daily_schedule.map((day) => ({
        ...day,
        activities: {
          ...day.activities,
          morning: `Slow morning in ${day.location}'s natural surroundings — choose one focused viewpoint or trail`,
          afternoon: "Unstructured time for rest, a café, or an optional nearby walk",
        },
      }));
      updatedItinerary.daily_itinerary = current.daily_itinerary.map((day) => ({
        ...day,
        morning: {
          ...day.morning,
          activity: `Slow morning in ${day.location}'s natural surroundings — choose one focused viewpoint or trail`,
          description: "One anchor experience, with protected downtime afterward.",
        },
        afternoon: {
          ...day.afternoon,
          activity: "Unstructured time for rest, a café, or an optional nearby walk",
          description: "Keep the afternoon open and unhurried.",
        },
      }));
      changes.push({ description: "Protected downtime and added a nature-focused anchor to each day", type: "schedule" });
      reasoning = `The route already has one base, so I kept the destination and made the schedule slower with more nature time. Experience Fit is currently ${currentScore?.experience_fit.score ?? 68}/100.`;
    }
  } else if (requestedDay) {
    const dayNumber = Number(requestedDay);
    const day = updatedItinerary.daily_schedule.find((item) => item.day === dayNumber);
    if (day) {
      changes.push({ description: `Made Day ${dayNumber} lighter with more unstructured time`, type: "schedule" });
      day.activities = {
        ...day.activities,
        morning: `Slow morning in ${day.location} — one focused experience, with no fixed second stop`,
        afternoon: "Unstructured time for a café, rest, or an optional nearby walk",
        evening: "Early dinner and a relaxed evening",
        transport: "Walk locally; no cross-town transfers planned",
      };
      const richDay = updatedItinerary.daily_itinerary.find((item) => item.day === dayNumber);
      if (richDay) {
        richDay.morning = {
          ...richDay.morning,
          activity: `Slow morning in ${richDay.location} — one focused experience, with no fixed second stop`,
          description: "Keep the first block deliberately light.",
        };
        richDay.afternoon = {
          ...richDay.afternoon,
          activity: "Unstructured time for a café, rest, or an optional nearby walk",
          description: "No second fixed stop is planned.",
        };
        richDay.evening = {
          ...richDay.evening,
          activity: "Early dinner and a relaxed evening",
          description: "Leave the evening open for rest.",
        };
        richDay.transportation = {
          ...richDay.transportation,
          mode: "Walk locally",
          details: "No cross-town transfers planned.",
        };
      }
      reasoning = `Day ${dayNumber} now has one anchor experience and protected downtime. This preserves the rest of your itinerary while improving pacing for that day.`;
    } else {
      reasoning = `Day ${dayNumber} was not available, so no schedule was changed. The current score remains ${currentScore?.overall ?? 70}/100.`;
    }
  } else if (addDestination) {
    const candidate = resolveRouteCandidates(addDestination, current.total_days).find((item) =>
      item.name.toLowerCase().includes(addDestination.toLowerCase().replace("á", "a"))
    ) ?? resolveRouteCandidates(addDestination, current.total_days)[0];
    if (candidate && !updatedItinerary.route.some((stop) => stop.location.toLowerCase() === candidate.name.toLowerCase())) {
      const donorIndex = updatedItinerary.route.findIndex((stop) => stop.nights > 1);
      if (donorIndex >= 0) {
        updatedItinerary.route[donorIndex].nights -= 1;
        updatedItinerary.route.splice(donorIndex + 1, 0, {
          location: candidate.name,
          destination: candidate.name,
          country: candidate.country,
          nights: 1,
          transport_to_next: null,
          duration_hours: null,
          why_selected: "Added at the traveler's request and rescored against their profile.",
        });
        updatedItinerary.daily_schedule = reassignScheduleLocations(
          current.daily_schedule,
          updatedItinerary.route,
          current.total_days
        );
        updatedItinerary.daily_itinerary = reassignDailyItineraryLocations(
          current.daily_itinerary,
          updatedItinerary.route,
          current.total_days
        );
        changes.push({ description: `Added ${candidate.name} with one night, preserving the total trip length`, type: "destination" });
        const attrs = lookupDestination(candidate.name);
        reasoning = `Added ${candidate.name} by moving one night from ${updatedItinerary.route[donorIndex].location}. ${attrs ? `${candidate.name} contributes Nature ${attrs.nature}/100, Uniqueness ${attrs.uniqueness}/100, and costs about $${attrs.avg_daily_cost_usd}/day.` : "The destination will be rescored with neutral catalog values until added to the catalog."} This increases route variety but may reduce Pacing if the new one-night stop falls below its ideal stay range.`;
      } else {
        reasoning = `I could not add ${candidate?.name ?? addDestination} without creating a zero-night stop. The current route already uses every night.`;
      }
    } else {
      reasoning = `${candidate?.name ?? addDestination} is already in the route, so I left the itinerary unchanged.`;
    }
  } else if (wantsCheaper) {
    const accomEntry = current.budget_breakdown.find((b) => b.category === "Accommodation");
    const saving = accomEntry ? Math.round(accomEntry.estimated_amount * 0.15) : Math.round(trip.budget * 0.05);
    changes.push({ description: `Reduced accommodation budget by 15% (~$${saving} savings)`, type: "budget" });
    changes.push({ description: "Replaced one paid activity with free alternatives", type: "activity" });
    updatedItinerary.budget_breakdown = current.budget_breakdown.map((b) =>
      b.category === "Accommodation"
        ? { ...b, estimated_amount: Math.round(b.estimated_amount * 0.85), description: b.description + " (budget-optimized)" }
        : b
    );
    const budgetScore = currentScore?.budget_efficiency.score ?? 72;
    reasoning = `Reducing accommodation by 15% saves ~$${saving}${scoreRef}. Budget Efficiency improves from ${budgetScore}/100. The highest-value experiences in ${trip.destination} are often free — markets, viewpoints, and neighborhood walks outperform many paid attractions.`;
  } else if (wantsNature) {
    changes.push({ description: "Shifted morning activities to natural settings and viewpoints", type: "activity" });
    updatedItinerary.daily_schedule = current.daily_schedule.map((day) => {
      const attrs = lookupDestination(day.location);
      const natureScore = attrs ? `(Nature score: ${attrs.nature}/100)` : "";
      return {
        ...day,
        activities: {
          ...day.activities,
          morning: `Early morning in ${day.location}'s natural landscape — golden hour photography and viewpoints ${natureScore}`,
        },
      };
    });
    updatedItinerary.daily_itinerary = current.daily_itinerary.map((day) => {
      const attrs = lookupDestination(day.location);
      const natureScore = attrs ? ` (Nature score: ${attrs.nature}/100)` : "";
      return {
        ...day,
        morning: {
          ...day.morning,
          activity: `Early morning in ${day.location}'s natural landscape — golden hour photography and viewpoints${natureScore}`,
          description: "A nature-first start with time for scenery and photos.",
        },
      };
    });
    const expFit = currentScore?.experience_fit.score ?? 68;
    const natureAttrs = current.route.map((r) => { const a = lookupDestination(r.location); return a ? `${r.location}: Nature ${a.nature}/100` : null; }).filter(Boolean);
    reasoning = `Shifting mornings to outdoor exploration better matches your nature interests${scoreRef}. Experience Fit improves from ${expFit}/100. ${natureAttrs.length > 0 ? `Catalog data: ${natureAttrs.slice(0, 2).join(", ")}.` : ""} Golden hour light conditions make mornings the optimal window for photography and natural landscapes.`;
  } else if (wantsSlower) {
    changes.push({ description: "Removed one destination to extend time at remaining stops", type: "destination" });
    if (updatedItinerary.route.length > 1) {
      const removed = updatedItinerary.route.pop()!;
      const removedAttrs = lookupDestination(removed.location);
      const last = updatedItinerary.route[updatedItinerary.route.length - 1];
      if (last) {
        updatedItinerary.route[updatedItinerary.route.length - 1] = {
          ...last,
          nights: last.nights + removed.nights,
          transport_to_next: null,
          duration_hours: null,
        };
      }
      updatedItinerary.daily_schedule = reassignScheduleLocations(
        current.daily_schedule,
        updatedItinerary.route,
        current.total_days
      );
      updatedItinerary.daily_itinerary = reassignDailyItineraryLocations(
        current.daily_itinerary,
        updatedItinerary.route,
        current.total_days
      );
      const pacingScore = currentScore?.pacing.score ?? 68;
      const idealNote = removedAttrs ? ` Catalog ideal stay for ${removed.location}: ${removedAttrs.ideal_stay_days.min}–${removedAttrs.ideal_stay_days.max} nights — shorter stays rarely reach the experience depth available there.` : "";
      reasoning = `Removing ${removed.location} and redistributing ${removed.nights} night${removed.nights !== 1 ? "s" : ""} targets Pacing from ${pacingScore}/100.${idealNote} Fewer transitions means less time on transit and more time in each place.`;
    } else {
      reasoning = `The itinerary is already focused on one destination. Schedule has been reorganized to include more unstructured time between activities.`;
    }
  } else if (wantsFood) {
    changes.push({ description: "Enhanced food focus — culinary activities and market visits added", type: "activity" });
    updatedItinerary.daily_schedule = current.daily_schedule.map((day) => {
      const attrs = lookupDestination(day.location);
      const foodScore = attrs ? ` (Food scene: ${attrs.food}/100)` : "";
      return {
        ...day,
        activities: {
          ...day.activities,
          food_recommendation: `${day.location} local market for breakfast, neighborhood restaurant for dinner — avoid tourist-facing menus${foodScore}`,
          afternoon: `Local food experience or cooking class focusing on ${trip.destination.split(",")[0]} regional cuisine`,
        },
      };
    });
    updatedItinerary.daily_itinerary = current.daily_itinerary.map((day) => {
      const attrs = lookupDestination(day.location);
      const foodScore = attrs ? ` (Food scene: ${attrs.food}/100)` : "";
      return {
        ...day,
        afternoon: {
          ...day.afternoon,
          activity: `Local food experience or cooking class focusing on ${trip.destination.split(",")[0]} regional cuisine`,
          description: `Markets and neighborhood restaurants over tourist-facing menus${foodScore}.`,
        },
        food_recommendations: [
          `${day.location} local market for breakfast`,
          `Neighborhood restaurant for dinner — avoid tourist-facing menus${foodScore}`,
        ],
      };
    });
    const expFit = currentScore?.experience_fit.score ?? 68;
    const foodAttrs = current.route.map((r) => { const a = lookupDestination(r.location); return a ? `${r.location}: Food ${a.food}/100` : null; }).filter(Boolean);
    reasoning = `Shifting focus to food experiences better matches your culinary interests. Experience Fit improves from ${expFit}/100. ${foodAttrs.length > 0 ? `${foodAttrs.slice(0, 2).join(", ")}. ` : ""}Markets and neighborhood restaurants outperform tourist-facing dining in both quality and authenticity.`;
  } else {
    changes.push({ description: `Applied requested adjustment: ${request}`, type: "schedule" });
    reasoning = `Itinerary adjusted based on your request${scoreRef}. Core structure remains optimized for your ${trip.traveler_profile.interests.slice(0, 2).join(" and ")} priorities (current Experience Fit: ${currentScore?.experience_fit.score ?? "–"}/100).`;
  }

  const normalizedItinerary = normalizeItinerary(
    updatedItinerary,
    trip,
    current.total_days || daysBetween(trip.start_date, trip.end_date)
  );
  const updatedScore = computeTripHealthScore(normalizedItinerary, trip);
  if (currentScore) {
    const delta = updatedScore.overall - currentScore.overall;
    const sign = delta >= 0 ? "+" : "";
    reasoning += ` Actual Trip Health Score: ${currentScore.overall} → ${updatedScore.overall} (${sign}${delta}).`;
  }

  return {
    changes_made: changes,
    reasoning,
    itinerary: normalizedItinerary,
  };
}
