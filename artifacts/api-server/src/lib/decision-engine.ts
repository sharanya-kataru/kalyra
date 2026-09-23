import {
  getRouteCandidatePool,
  lookupDestination,
  type DestinationAttributes,
  type RouteCandidate,
} from "./destinations";
import { parseTripDuration } from "./trip-utils";

export interface DecisionTrip {
  destination: string;
  start_date: string;
  end_date: string;
  traveler_count: number;
  budget: number;
  budget_preference: string;
  traveler_profile: {
    interests: string[];
    travel_style: string;
  };
}

export type DecisionDimension =
  | "interest_fit"
  | "budget_fit"
  | "pace_fit"
  | "season_fit"
  | "crowd_fit"
  | "transport_fit"
  | "uniqueness_fit";

export interface TravelerPreferenceProfile {
  weights: Record<"nature" | "photography" | "food" | "culture" | "uniqueness", number>;
  matched_interests: string[];
  unmapped_interests: string[];
}

export interface DestinationDecisionScore {
  name: string;
  found: boolean;
  confidence: "high" | "limited";
  overall_score: number;
  match_score: number;
  interest_fit: number;
  budget_fit: number;
  pace_fit: number;
  season_fit: number;
  crowd_fit: number;
  transport_fit: number;
  uniqueness_fit: number;
  matched_interests: string[];
  strengths: string[];
  tradeoffs: string[];
  explanation: string;
  avg_daily_cost_usd: number | null;
}

export interface RouteSelection {
  candidates: RouteCandidate[];
  scores: DestinationDecisionScore[];
  base_count: number;
  countries_requested: string[];
}

type InterestDimension = keyof TravelerPreferenceProfile["weights"];

interface InterestMapping {
  weights: Partial<Record<InterestDimension, number>>;
}

export const INTEREST_DIMENSION_MAPPINGS: Record<string, InterestMapping> = {
  Nature: { weights: { nature: 1 } },
  "Mountain landscapes": { weights: { nature: 0.7, photography: 0.3 } },
  Photography: { weights: { photography: 1 } },
  Food: { weights: { food: 1 } },
  "Local food": { weights: { food: 0.8, uniqueness: 0.2 } },
  Culture: { weights: { culture: 1 } },
  History: { weights: { culture: 1 } },
  "Art & design": { weights: { culture: 0.6, photography: 0.4 } },
  Architecture: { weights: { culture: 0.6, photography: 0.4 } },
  Adventure: { weights: { nature: 0.7, uniqueness: 0.3 } },
  "Water & swimming": { weights: { nature: 0.7, uniqueness: 0.3 } },
  Shopping: { weights: { culture: 0.7, uniqueness: 0.3 } },
  Nightlife: { weights: { culture: 0.7, uniqueness: 0.3 } },
  "Small-town life": { weights: { uniqueness: 0.7, culture: 0.3 } },
};

const SCORE_WEIGHTS: Record<DecisionDimension, number> = {
  interest_fit: 0.46,
  budget_fit: 0.18,
  pace_fit: 0.14,
  season_fit: 0.08,
  crowd_fit: 0.06,
  transport_fit: 0.04,
  uniqueness_fit: 0.04,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function normalizedBudgetPreference(value: string): "lean" | "balanced" | "splurge" {
  if (/lean|save|budget/i.test(value)) return "lean";
  if (/splurge|beautiful|upscale/i.test(value)) return "splurge";
  return "balanced";
}

function normalizedPace(value: string): "slow" | "fast" | "balanced" {
  if (/slow|unhurried|relaxed|easy/i.test(value)) return "slow";
  if (/fast|active|packed|see more/i.test(value)) return "fast";
  return "balanced";
}

export function buildTravelerPreferenceProfile(interests: string[]): TravelerPreferenceProfile {
  const totals: TravelerPreferenceProfile["weights"] = {
    nature: 0,
    photography: 0,
    food: 0,
    culture: 0,
    uniqueness: 0,
  };
  const matched_interests: string[] = [];
  const unmapped_interests: string[] = [];

  for (const interest of interests) {
    const mapping = INTEREST_DIMENSION_MAPPINGS[interest];
    if (!mapping) {
      unmapped_interests.push(interest);
      continue;
    }
    matched_interests.push(interest);
    for (const [dimension, weight] of Object.entries(mapping.weights)) {
      totals[dimension as InterestDimension] += weight ?? 0;
    }
  }

  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const weights = Object.fromEntries(
    Object.entries(totals).map(([dimension, value]) => [dimension, total > 0 ? value / total : 0])
  ) as TravelerPreferenceProfile["weights"];

  return { weights, matched_interests, unmapped_interests };
}

function scoreInterestFit(attrs: DestinationAttributes, profile: TravelerPreferenceProfile): number {
  const entries = Object.entries(profile.weights) as Array<[InterestDimension, number]>;
  const weighted = entries.reduce((sum, [dimension, weight]) => sum + attrs[dimension] * weight, 0);
  return entries.some(([, weight]) => weight > 0) ? clamp(weighted) : 60;
}

function scoreBudgetFit(attrs: DestinationAttributes, trip: DecisionTrip, totalNights: number): number {
  // Catalog daily costs are per traveler and exclude flights. Reserve 70% of
  // the total budget for on-the-ground costs before dividing by travelers.
  const usableDailyBudget = (trip.budget * 0.7) / Math.max(1, trip.traveler_count) / Math.max(1, totalNights);
  const tolerance = normalizedBudgetPreference(trip.budget_preference) === "lean"
    ? 0.9
    : normalizedBudgetPreference(trip.budget_preference) === "splurge"
      ? 1.15
      : 1;
  const ratio = attrs.avg_daily_cost_usd / Math.max(1, usableDailyBudget * tolerance);
  if (ratio <= 0.65) return 94;
  if (ratio <= 0.85) return 88;
  if (ratio <= 1) return 80;
  if (ratio <= 1.2) return 70;
  if (ratio <= 1.5) return 56;
  if (ratio <= 2) return 42;
  return 30;
}

function scorePaceFit(attrs: DestinationAttributes, trip: DecisionTrip, totalNights: number): number {
  const pace = normalizedPace(trip.traveler_profile.travel_style);
  const desiredBases = pace === "slow"
    ? totalNights >= 12 ? 3 : totalNights >= 6 ? 2 : 1
    : pace === "fast"
      ? totalNights >= 12 ? 4 : totalNights >= 8 ? 3 : 2
      : totalNights >= 12 ? 3 : totalNights >= 8 ? 2 : 1;
  const availableNights = totalNights / Math.max(1, desiredBases);
  const midpoint = (attrs.ideal_stay_days.min + attrs.ideal_stay_days.max) / 2;
  const distance = Math.abs(availableNights - midpoint);
  return clamp(100 - distance * (pace === "slow" ? 20 : 15));
}

function scoreSeasonFit(attrs: DestinationAttributes, startDate: string): number {
  const month = Number(startDate.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return 65;
  return attrs.best_months.includes(month) ? 100 : 62;
}

function scoreCrowdFit(attrs: DestinationAttributes): number {
  return clamp(100 - attrs.crowd_level * 0.25);
}

function scoreTransportFit(attrs: DestinationAttributes, trip: DecisionTrip): number {
  const multiBaseFactor = trip.traveler_profile.travel_style ? 1 : 0.8;
  return clamp(100 - attrs.transport_complexity * 0.35 * multiBaseFactor);
}

function scoreUniquenessFit(attrs: DestinationAttributes, profile: TravelerPreferenceProfile): number {
  return profile.weights.uniqueness > 0 ? attrs.uniqueness : 60;
}

function dimensionLabel(dimension: DecisionDimension): string {
  return dimension.replace("_fit", "").replace("_", " ");
}

function buildExplanation(
  name: string,
  score: DestinationDecisionScore,
  profile: TravelerPreferenceProfile,
  attrs: DestinationAttributes
): string {
  const dimensions = (Object.keys(SCORE_WEIGHTS) as DecisionDimension[])
    .map((dimension) => [dimension, score[dimension]] as const)
    .sort(([, left], [, right]) => right - left);
  const strongest = dimensions.slice(0, 2).map(([dimension, value]) => `${dimensionLabel(dimension)} ${value}/100`);
  const weakest = dimensions.filter(([, value]) => value < 70).slice(-2).map(([dimension, value]) => `${dimensionLabel(dimension)} ${value}/100`);
  const interestText = profile.matched_interests.length > 0
    ? `It matches your ${profile.matched_interests.slice(0, 2).join(" and ")} priorities`
    : "It has limited mapped-interest data";
  const seasonText = score.season_fit >= 90 ? "it is in its stronger season" : "the travel month is outside its strongest season";
  return `${name}: ${interestText}; strongest dimensions are ${strongest.join(" and ")}. The route also considers ${seasonText} and catalog cost of ~$${attrs.avg_daily_cost_usd}/traveler/day${weakest.length > 0 ? `; tradeoffs include ${weakest.join(" and ")}.` : "."}`;
}

export function scoreDestinationForTrip(name: string, trip: DecisionTrip): DestinationDecisionScore {
  const attrs = lookupDestination(name);
  if (!attrs) {
    return {
      name,
      found: false,
      confidence: "limited",
      overall_score: 50,
      match_score: 50,
      interest_fit: 50,
      budget_fit: 50,
      pace_fit: 50,
      season_fit: 50,
      crowd_fit: 50,
      transport_fit: 50,
      uniqueness_fit: 50,
      matched_interests: [],
      strengths: [],
      tradeoffs: ["Not in the curated destination catalog; budget, season, pace, and transport fit are lower-confidence."],
      explanation: `${name} is outside Kalyra's curated catalog, so this is a limited-data match rather than a precise high-confidence score.`,
      avg_daily_cost_usd: null,
    };
  }

  const totalNights = parseTripDuration(trip.start_date, trip.end_date).total_nights;
  const profile = buildTravelerPreferenceProfile(trip.traveler_profile.interests);
  const dimensions = {
    interest_fit: scoreInterestFit(attrs, profile),
    budget_fit: scoreBudgetFit(attrs, trip, totalNights),
    pace_fit: scorePaceFit(attrs, trip, totalNights),
    season_fit: scoreSeasonFit(attrs, trip.start_date),
    crowd_fit: scoreCrowdFit(attrs),
    transport_fit: scoreTransportFit(attrs, trip),
    uniqueness_fit: scoreUniquenessFit(attrs, profile),
  };
  const overall_score = clamp(
    (Object.keys(SCORE_WEIGHTS) as DecisionDimension[])
      .reduce((sum, dimension) => sum + dimensions[dimension] * SCORE_WEIGHTS[dimension], 0)
  );
  const score: DestinationDecisionScore = {
    name,
    found: true,
    confidence: "high",
    overall_score,
    match_score: overall_score,
    ...dimensions,
    matched_interests: profile.matched_interests.filter((interest) => {
      const mapping = INTEREST_DIMENSION_MAPPINGS[interest];
      return Object.keys(mapping.weights).some((dimension) => attrs[dimension as InterestDimension] >= 70);
    }),
    strengths: [],
    tradeoffs: [],
    explanation: "",
    avg_daily_cost_usd: attrs.avg_daily_cost_usd,
  };
  const sortedDimensions = (Object.keys(SCORE_WEIGHTS) as DecisionDimension[])
    .sort((left, right) => score[right] - score[left]);
  score.strengths = sortedDimensions
    .filter((dimension) => score[dimension] >= 80)
    .slice(0, 3)
    .map((dimension) => `${dimensionLabel(dimension)} ${score[dimension]}/100`);
  score.tradeoffs = sortedDimensions
    .filter((dimension) => score[dimension] < 70)
    .slice(-3)
    .map((dimension) => `${dimensionLabel(dimension)} ${score[dimension]}/100`);
  score.explanation = buildExplanation(name, score, profile, attrs);
  return score;
}

function baseCountForTrip(trip: DecisionTrip, totalNights: number): number {
  const pace = normalizedPace(trip.traveler_profile.travel_style);
  const base = totalNights >= 12 ? 4 : totalNights >= 8 ? 3 : totalNights >= 5 ? 2 : 1;
  if (pace === "slow") return Math.max(1, base - 1);
  if (pace === "fast") return Math.min(4, base + 1);
  return base;
}

export function selectRouteCandidates(trip: DecisionTrip): RouteSelection {
  const totalNights = parseTripDuration(trip.start_date, trip.end_date).total_nights;
  const pool = getRouteCandidatePool(trip.destination);
  const scores = pool
    .map((candidate) => scoreDestinationForTrip(candidate.name, trip))
    .sort((left, right) => right.overall_score - left.overall_score || left.name.localeCompare(right.name));
  const baseCount = Math.min(pool.length, baseCountForTrip(trip, totalNights));
  const requestedCountries = [...new Set(pool.map((candidate) => candidate.country).filter(Boolean))];
  const selectedNames = new Set<string>();

  if (requestedCountries.length > 1 && baseCount >= requestedCountries.length) {
    for (const country of requestedCountries) {
      const candidate = scores.find((score) => !selectedNames.has(score.name) && pool.find((item) => item.name === score.name)?.country === country);
      if (candidate) selectedNames.add(candidate.name);
    }
  }
  for (const score of scores) {
    if (selectedNames.size >= baseCount) break;
    selectedNames.add(score.name);
  }

  const candidates = scores
    .filter((score) => selectedNames.has(score.name))
    .map((score) => pool.find((candidate) => candidate.name === score.name))
    .filter((candidate): candidate is RouteCandidate => Boolean(candidate));

  return {
    candidates,
    scores,
    base_count: baseCount,
    countries_requested: requestedCountries,
  };
}