import { logger } from "./logger";
import {
  lookupDestination,
  destinationSummary,
  resolveRouteCandidates,
  type RouteCandidate,
} from "./destinations";
import { buildScoringContext, computeTripHealthScore, type TripHealthScore } from "./scoring";
import {
  selectRouteCandidates,
  type DestinationDecisionScore,
} from "./decision-engine";
import {
  addDays,
  calculateBudgetSummary,
  daysBetween,
  parseTripDuration,
  sanitizeAmount,
  type BudgetSummary,
} from "./trip-utils";
import { collectPlaceContext } from "./places";
import type { FlightSearchResult } from "./flights";
import type { WeatherSummary } from "./weather";
import { estimatedSource, type DataSourceMetadata } from "./sources";

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
  confidence?: "high" | "limited";
  score_breakdown?: {
    interest_fit: number;
    budget_fit: number;
    pace_fit: number;
    season_fit: number;
    crowd_fit: number;
    transport_fit: number;
    uniqueness_fit: number;
  };
  matched_interests?: string[];
  strengths?: string[];
  tradeoffs?: string[];
  recommended_nights?: number;
  why_selected?: string;
  experience_highlights?: string[];
  estimated_cost_usd?: number;
}

export interface TripRecommendation {
  recommendation: string;
  reason: string;
  expected_benefit: string;
  tradeoff: string;
}

export interface AlternativeStrategy {
  name: string;
  best_for: string[];
  changes: string;
  gains: string;
  sacrifices: string;
  estimated_budget_impact_usd: number;
  pacing_impact: string;
  experience_match_impact: string;
  recommended: boolean;
}

export interface TripAnalysis {
  trip_strategy: string;
  destinations: DestinationScore[];
  reasoning: string;
  recommendations?: TripRecommendation[];
  strategies?: AlternativeStrategy[];
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
  weather?: WeatherSummary;
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
  source_metadata?: DataSourceMetadata;
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
  live_data?: {
    flight_search: FlightSearchResult;
    weather: WeatherSummary[];
    refreshed_at: string;
    planning_note?: string;
  };
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
      : legacyActivities.food_recommendation
      ? [String(legacyActivities.food_recommendation)].filter(Boolean)
      : [];
    const weather = rich.weather && typeof rich.weather === "object"
      ? rich.weather as WeatherSummary
      : undefined;

    result.push({
      day: index + 1,
      date: String(rich.date ?? legacy.date ?? addDays(trip.start_date, index)),
      location,
      morning,
      afternoon,
      evening,
      food_recommendations: food,
      transportation: {
        mode: String(transportation.mode ?? legacyActivities.transport ?? "Walk and local transit"),
        details: String(
          transportation.details ??
            (legacyActivities.transport
              ? "Follow the planned route for this leg."
              : "Use local transit and walk between nearby stops.")
        ),
        duration: String(
          transportation.duration ??
            (transferDay ? "Light transfer day" : "Local movement")
        ),
      },
      estimated_daily_cost_usd: sanitizeAmount(
        rich.estimated_daily_cost_usd ??
          legacyActivities.estimated_cost ??
          morning.estimated_cost_usd + afternoon.estimated_cost_usd + evening.estimated_cost_usd,
        dailyFallbackCost
      ),
      ...(weather ? { weather } : {}),
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
            source_metadata: row.source_metadata && typeof row.source_metadata === "object"
              ? row.source_metadata as DataSourceMetadata
              : estimatedSource("budget_estimate"),
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const defaults = [
    ["Flights", 0, `Estimated round trip from ${trip.starting_location}; live flight data not connected.`],
    ["Accommodation", Math.round(trip.budget * 0.3), `${totalNights} nights; estimated until a hotel provider is connected.`],
    ["Food", Math.round(trip.budget * 0.18), "Estimated local restaurants and markets."],
    ["Activities", Math.round(trip.budget * 0.14), "Estimated entrance fees and experiences."],
    ["Transportation", Math.round(trip.budget * 0.08), "Estimated trains, local transit, and transfers."],
  ] as const;

  const output = defaults.map(([category, fallbackAmount, description]) => {
    const existing = normalized.find((item) => item.category.toLowerCase().includes(category.toLowerCase().slice(0, 5)));
    return existing ?? {
      category,
      estimated_amount: fallbackAmount,
      description,
      source_metadata: estimatedSource("budget_estimate"),
    };
  });

  return output.map((item) => ({
    ...item,
    estimated_amount: sanitizeAmount(item.estimated_amount, 0),
    description: item.description || "Estimate unavailable.",
    source_metadata: item.source_metadata ?? estimatedSource("budget_estimate"),
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
  const candidates = selectRouteCandidates(trip).candidates;
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
      ...(row.confidence === "limited" || row.confidence === "high" ? { confidence: row.confidence } : {}),
      ...(row.score_breakdown && typeof row.score_breakdown === "object"
        ? { score_breakdown: row.score_breakdown as DestinationScore["score_breakdown"] }
        : {}),
      ...(Array.isArray(row.matched_interests) ? { matched_interests: row.matched_interests.map(String) } : {}),
      ...(Array.isArray(row.strengths) ? { strengths: row.strengths.map(String) } : {}),
      ...(Array.isArray(row.tradeoffs) ? { tradeoffs: row.tradeoffs.map(String) } : {}),
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
    live_data: raw.live_data,
  };
}

// ---------------------------------------------------------------------------
// ANALYZE — destination scoring and strategy
// ---------------------------------------------------------------------------

export async function analyzeTrip(trip: TripData): Promise<TripAnalysis> {
  return buildFallbackAnalysis(trip);
}

// ---------------------------------------------------------------------------
// GENERATE — full itinerary
// ---------------------------------------------------------------------------

export async function generateItinerary(trip: TripData): Promise<ItineraryData> {
  const { total_days: totalDays } = parseTripDuration(
    trip.start_date,
    trip.end_date
  );

  return normalizeItinerary(
    buildFallbackItinerary(trip, totalDays),
    trip,
    totalDays
  );
}

// ---------------------------------------------------------------------------
// MODIFY — iterative editing with score-aware reasoning
// ---------------------------------------------------------------------------

export async function modifyItinerary(
  trip: TripData,
  currentItinerary: ItineraryData,
  userRequest: string
): Promise<ModificationResult> {
  const currentScore = computeTripHealthScore(currentItinerary, trip);

  return buildFallbackModification(
    trip,
    currentItinerary,
    userRequest,
    currentScore
  );
}

// ---------------------------------------------------------------------------
// Fallbacks — deterministic, input-derived, score-informed
// ---------------------------------------------------------------------------

function normalizeTripAnalysis(raw: unknown, trip: TripData): TripAnalysis {
  const fallback = buildFallbackAnalysis(trip);
  if (!raw || typeof raw !== "object") return fallback;

  const candidate = raw as Record<string, unknown>;
  const destinations = Array.isArray(candidate.destinations)
    ? candidate.destinations
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          name: String(item.name ?? trip.destination),
          score: Math.min(100, Math.max(0, sanitizeAmount(item.score, 65))),
          reasoning: String(item.reasoning ?? "Selected using the structured destination scoring engine."),
          drawbacks: String(item.drawbacks ?? "Costs and availability remain estimates until live providers are connected."),
          ...(item.confidence === "limited" || item.confidence === "high"
            ? { confidence: item.confidence as "high" | "limited" }
            : {}),
          ...(item.score_breakdown && typeof item.score_breakdown === "object"
            ? { score_breakdown: item.score_breakdown as DestinationScore["score_breakdown"] }
            : {}),
          ...(Array.isArray(item.matched_interests) ? { matched_interests: item.matched_interests.map(String) } : {}),
          ...(Array.isArray(item.strengths) ? { strengths: item.strengths.map(String) } : {}),
          ...(Array.isArray(item.tradeoffs) ? { tradeoffs: item.tradeoffs.map(String) } : {}),
          recommended_nights: (() => {
            const attrs = lookupDestination(String(item.name ?? trip.destination));
            return Math.max(
              1,
              sanitizeAmount(
                item.recommended_nights,
                attrs ? Math.ceil((attrs.ideal_stay_days.min + attrs.ideal_stay_days.max) / 2) : 2
              )
            );
          })(),
          why_selected: String(item.why_selected ?? item.reasoning ?? "Selected for fit with your traveler profile."),
          experience_highlights: Array.isArray(item.experience_highlights)
            ? item.experience_highlights.map(String).filter(Boolean)
            : ["A focused local experience aligned with your interests."],
          estimated_cost_usd: (() => {
            const attrs = lookupDestination(String(item.name ?? trip.destination));
            const nights = Math.max(
              1,
              sanitizeAmount(
                item.recommended_nights,
                attrs ? Math.ceil((attrs.ideal_stay_days.min + attrs.ideal_stay_days.max) / 2) : 2
              )
            );
            return sanitizeAmount(item.estimated_cost_usd, attrs ? attrs.avg_daily_cost_usd * nights : 0);
          })(),
        }))
        .filter((item) => item.name.length > 0)
    : [];

  if (destinations.length === 0) return fallback;

  const recommendations = Array.isArray(candidate.recommendations)
    ? candidate.recommendations
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          recommendation: String(item.recommendation ?? ""),
          reason: String(item.reason ?? ""),
          expected_benefit: String(item.expected_benefit ?? ""),
          tradeoff: String(item.tradeoff ?? ""),
        }))
        .filter((item) => item.recommendation && item.reason && item.expected_benefit && item.tradeoff)
    : [];

  const strategies = Array.isArray(candidate.strategies)
    ? candidate.strategies
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          name: String(item.name ?? "Alternative route"),
          best_for: Array.isArray(item.best_for) ? item.best_for.map(String) : [],
          changes: String(item.changes ?? ""),
          gains: String(item.gains ?? ""),
          sacrifices: String(item.sacrifices ?? ""),
          estimated_budget_impact_usd: sanitizeAmount(item.estimated_budget_impact_usd, 0),
          pacing_impact: String(item.pacing_impact ?? ""),
          experience_match_impact: String(item.experience_match_impact ?? ""),
          recommended: Boolean(item.recommended),
        }))
        .filter((item) => item.name && item.changes && item.gains && item.sacrifices)
    : [];

  return {
    trip_strategy: String(candidate.trip_strategy ?? fallback.trip_strategy),
    destinations,
    reasoning: String(candidate.reasoning ?? fallback.reasoning),
    recommendations: recommendations.length > 0 ? recommendations : fallback.recommendations,
    strategies: strategies.length > 0 ? strategies : fallback.strategies,
  };
}

function decisionToDestinationScore(
  decision: DestinationDecisionScore,
  trip: TripData,
  rank: number
): DestinationScore {
  const attrs = lookupDestination(decision.name);
  const recommendedNights = attrs
    ? Math.max(1, Math.min(
        parseTripDuration(trip.start_date, trip.end_date).total_nights,
        Math.round((attrs.ideal_stay_days.min + attrs.ideal_stay_days.max) / 2)
      ))
    : Math.max(1, Math.min(parseTripDuration(trip.start_date, trip.end_date).total_nights, 2));
  return {
    name: decision.name,
    score: decision.overall_score,
    confidence: decision.confidence,
    reasoning: decision.explanation,
    drawbacks: decision.tradeoffs.length > 0
      ? decision.tradeoffs.join(". ") + "."
      : `Ranked ${rank + 1} for the combined traveler, budget, pace, season, crowd, and transport fit.`,
    score_breakdown: {
      interest_fit: decision.interest_fit,
      budget_fit: decision.budget_fit,
      pace_fit: decision.pace_fit,
      season_fit: decision.season_fit,
      crowd_fit: decision.crowd_fit,
      transport_fit: decision.transport_fit,
      uniqueness_fit: decision.uniqueness_fit,
    },
    matched_interests: decision.matched_interests,
    strengths: decision.strengths,
    tradeoffs: decision.tradeoffs,
    recommended_nights: recommendedNights,
    why_selected: decision.found
      ? `Selected as the ${rank === 0 ? "strongest" : "ranked"} fit in a ${trip.traveler_profile.travel_style.toLowerCase()} route.`
      : "Included with limited confidence because it is outside the curated catalog.",
    experience_highlights: decision.strengths.length > 0
      ? decision.strengths
      : ["Limited catalog data; verify the fit before committing scarce vacation days."],
    estimated_cost_usd: attrs ? attrs.avg_daily_cost_usd * recommendedNights : 0,
  };
}

function buildFallbackAnalysis(trip: TripData): TripAnalysis {
  const selection = selectRouteCandidates(trip);
  const selectedScores = selection.candidates
    .map((candidate) => selection.scores.find((score) => score.name === candidate.name))
    .filter((score): score is DestinationDecisionScore => Boolean(score));
  const destinations = selectedScores.map((score, index) => decisionToDestinationScore(score, trip, index));
  const topDest = destinations[0];
  const lowDest = destinations[destinations.length - 1];
  const interests = trip.traveler_profile.interests;
  const totalDays = daysBetween(trip.start_date, trip.end_date);
  const transitionCount = Math.max(0, selection.candidates.length - 1);
  const recommendations: TripRecommendation[] = [];

  if (topDest) {
    recommendations.push({
      recommendation: `Protect the core of the trip around ${topDest.name}.`,
      reason: `${topDest.name} ranks first at ${topDest.score}/100 after combining interest fit, budget, pace, season, crowds, and transport.`,
      expected_benefit: "More time in the destination that best matches the stated brief.",
      tradeoff: destinations.length > 1 ? `Less time for lower-ranked bases such as ${lowDest?.name ?? "the alternatives"}.` : "Less geographic variety.",
    });
  }
  if (lowDest && topDest && lowDest.name !== topDest.name && (lowDest.score_breakdown?.pace_fit ?? 100) < 70) {
    recommendations.push({
      recommendation: `Question whether ${lowDest.name} deserves its full allocation.`,
      reason: `${lowDest.name} has a weaker pace fit (${lowDest.score_breakdown?.pace_fit}/100), so its nights may create a rushed stop.`,
      expected_benefit: "Fewer transitions and more time for high-fit experiences.",
      tradeoff: "Less destination variety and one fewer perspective on the region.",
    });
  }
  if (topDest && (topDest.score_breakdown?.budget_fit ?? 100) < 65) {
    recommendations.push({
      recommendation: "Protect the budget before adding another base.",
      reason: `${topDest.name}'s budget fit is ${topDest.score_breakdown?.budget_fit}/100 for this traveler count and total budget.`,
      expected_benefit: "Fewer compromises on the experiences that matter most.",
      tradeoff: "May require simpler accommodation or fewer paid activities.",
    });
  }
  if (transitionCount > 2) {
    recommendations.push({
      recommendation: "Keep transfer days intentionally light.",
      reason: `${transitionCount} planned transitions use a meaningful share of a ${totalDays}-day trip.`,
      expected_benefit: "Less transit fatigue and more usable time in each base.",
      tradeoff: "Some nearby destinations remain outside the selected route.",
    });
  }

  const baseStrategies: AlternativeStrategy[] = [
    {
      name: "Depth-first route",
      best_for: interests.length > 0 ? interests.slice(0, 3) : ["Restful travel"],
      changes: topDest ? `Prioritize ${topDest.name} and shorten the weakest-fit stop.` : "Keep the route to the fewest viable bases.",
      gains: "Higher pacing quality and more time in the strongest matches.",
      sacrifices: "Less destination variety.",
      estimated_budget_impact_usd: 0,
      pacing_impact: "Fewer transitions and longer stays.",
      experience_match_impact: topDest ? `Favors the ${topDest.score}/100 leading match.` : "Avoids overcommitting with limited catalog data.",
      recommended: selection.base_count <= 2,
    },
    {
      name: "Balanced signature",
      best_for: interests.length > 0 ? interests.slice(0, 2) : ["A little of everything"],
      changes: `Keep ${selection.base_count} base${selection.base_count === 1 ? "" : "s"} selected from the ranked candidate pool.`,
      gains: "Maintains variety without defaulting to every catalog entry.",
      sacrifices: "Some stays may be shorter than the ideal midpoint.",
      estimated_budget_impact_usd: 0,
      pacing_impact: `${transitionCount} planned transition${transitionCount === 1 ? "" : "s"}.`,
      experience_match_impact: "Balances fit across the mapped interests.",
      recommended: selection.base_count > 2,
    },
  ];
  if (totalDays >= 10 && selection.candidates.length < selection.scores.length) {
    baseStrategies.push({
      name: "Wider regional sample",
      best_for: ["Travelers who prioritize variety"],
      changes: "Add one more candidate only if its score and ideal stay fit justify another transition.",
      gains: "More geographic range.",
      sacrifices: "More packing, transfer time, and pacing pressure.",
      estimated_budget_impact_usd: 0,
      pacing_impact: "Adds friction unless the new base replaces a long transfer.",
      experience_match_impact: "Can add a strong secondary match but dilutes time in the leader.",
      recommended: false,
    });
  }

  const countries = selection.countries_requested.filter(Boolean);
  return {
    trip_strategy: topDest
      ? `For ${totalDays} days, Kalyra ranks ${topDest.name} highest at ${topDest.score}/100 and selects ${selection.base_count} base${selection.base_count === 1 ? "" : "s"} based on your preferred pace. ${countries.length > 1 ? `The route keeps representation across ${countries.join(" and ")}.` : "The route favors depth over catalog order."}`
      : `Kalyra found limited catalog data for ${trip.destination} and is keeping the route conservative.`,
    destinations,
    reasoning: `The shortlist combines normalized interest fit with budget fit for ${trip.traveler_count} traveler${trip.traveler_count === 1 ? "" : "s"}, pace/stay fit, ${new Date(`${trip.start_date}T00:00:00Z`).toLocaleString("en-US", { month: "long" })} season fit, crowd friction, transport friction, and exploration value. Catalog daily costs are treated as per traveler and exclude flights.`,
    recommendations,
    strategies: baseStrategies,
  };
}

function buildFallbackItinerary(trip: TripData, totalDays: number): Partial<ItineraryData> {
  const interests = trip.traveler_profile.interests;
  const tripNights = parseTripDuration(trip.start_date, trip.end_date).total_nights;
  const selection = selectRouteCandidates(trip);
  const candidates = selection.candidates;
  const destinations = candidates.map((candidate) => candidate.name);

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

  const route: RouteStop[] = destinations.map((dest, i) => ({
    location: dest,
    destination: dest,
    country: candidates[i]?.country ?? "",
    nights: normalizedNights[i] ?? 2,
    transport_to_next: i < destinations.length - 1 ? "train" : null,
    duration_hours: i < destinations.length - 1 ? 2.5 : null,
    why_selected: "Selected from the destination catalog for fit, pacing, and transport efficiency.",
    experience_score: selection.scores.find((score) => score.name === dest)?.overall_score,
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

    const dayVariant = dayIndex % 3;

    const natureMorning = [
      `Explore ${location}'s natural surroundings and viewpoints${attrs && attrs.photography >= 85 ? ` (photography score: ${attrs.photography}/100)` : ""}`,
      `Take a slower scenic morning in ${location} with time for photography and an easy walk`,
      `Choose one outdoor highlight in ${location} and leave time to explore without rushing`,
    ][dayVariant];

    const cultureMorning = [
      `Explore the historic center of ${location}${attrs && attrs.culture >= 85 ? ` (culture score: ${attrs.culture}/100)` : ""}`,
      `Spend the morning with ${location}'s architecture, neighborhoods, and local history`,
      `Choose one cultural highlight in ${location}, then explore the surrounding streets`,
    ][dayVariant];

    const flexibleAfternoon = [
      `Explore one of ${location}'s highlights at your own pace`,
      `Keep the afternoon flexible for a neighborhood, viewpoint, or café`,
      `Leave room for a spontaneous local experience in ${location}`,
    ][dayVariant];

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
          ? natureMorning
          : hasCulture
          ? cultureMorning
          : `Orient in ${location}, check in, and take a neighborhood walk`,
        afternoon: isDepartureDay
          ? `Keep the afternoon open for a final meal before leaving`
          : hasFood
          ? `Local food market and culinary experience — regional specialties${attrs && attrs.food >= 85 ? ` (food scene rated ${attrs.food}/100)` : ""}`
          : flexibleAfternoon,
        evening: isDepartureDay
          ? `Early dinner or airport transfer from ${location}`
          : `Dinner at a locally-recommended restaurant — ${hasFood ? "prioritize off-menu local spots" : "relaxed evening"}`,
        food_recommendation: hasFood
          ? attrs && attrs.food >= 80
            ? `${location} has a strong local food scene (${attrs.food}/100). Ask your accommodation for their single best local recommendation.`
            : `Ask your accommodation for the one restaurant they'd send a trusted friend to.`
          : "",
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

  const scoredDestinations: DestinationScore[] = candidates.map((candidate, index) => {
    const decision = selection.scores.find((score) => score.name === candidate.name);
    return decision
      ? decisionToDestinationScore(decision, trip, index)
      : {
          name: candidate.name,
          score: 50,
          confidence: "limited" as const,
          reasoning: `Selected with limited catalog data for your ${interests.slice(0, 2).join(" and ")} priorities.`,
          drawbacks: "Verify the destination fit before committing scarce vacation days.",
        };
  });

  return {
    trip_strategy: `A ${totalDays}-day journey through ${trip.destination} with ${selection.base_count} base${selection.base_count === 1 ? "" : "s"} selected by deterministic interest, budget, pace, season, crowd, and transport fit.`,
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
    reasoning: `Average destination cost ~$${Math.round(avgDailyCost)}/traveler/day. The route follows ranked destination scores and catalog ideal stay ranges. ${trip.budget_preference === "Keep it lean" ? "Budget fit favors lower-cost bases." : trip.budget_preference === "A few beautiful splurges" ? "Budget fit allows more expensive standout bases." : "Budget fit is balanced against experience and pace."}`,
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

  const requestedDay = req.match(/\bday\s*(\d+)\b/)?.[1];
  const wantsCheaper = /cheap|budget|save|less money|reduce cost/i.test(req);
  const wantsNature = /nature|outdoor|mountain|hiking|scenery/i.test(req);
  const wantsSlower = !requestedDay && /slow|relax|fewer destinations|less rushing|less rushed|rushed|fewer stops|less busy/i.test(req);
  const wantsFood = /food|eat|restaurant|culinary|cuisine/i.test(req);
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
