/**
 * Experience Scoring Engine
 *
 * Pure functions — no LLM involvement. Scores are derived entirely from
 * structured destination attributes and traveler profile data.
 *
 * Core contract:
 *   scoreDestinationForTraveler(attrs, profile) → 0-100 match score + explanation
 *   computeTripHealthScore(itinerary, tripData)  → TripHealthScore
 *
 * Adding new destination attributes: update DestinationAttributes in destinations.ts
 * and add corresponding weight/mapping here in INTEREST_WEIGHTS.
 */

import {
  lookupDestination,
  destinationSummary,
  type DestinationAttributes,
} from "./destinations";
import type { TripData, ItineraryData, RouteStop } from "./ai";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface SubScore {
  score: number;
  label: "Excellent" | "Good" | "Fair" | "Needs attention";
  explanation: string;
}

export interface TripHealthScore {
  overall: number;
  overall_label: "Excellent" | "Good" | "Fair" | "Needs attention";
  experience_fit: SubScore;
  transportation_efficiency: SubScore;
  budget_efficiency: SubScore;
  uniqueness: SubScore;
  pacing: SubScore;
}

export interface DestinationMatchResult {
  /** Catalog entry was found */
  found: boolean;
  /** 0-100 personalized match score */
  match_score: number;
  /** Per-interest attribute scores used to compute match */
  attribute_scores: Record<string, number>;
  /** One-line explanation of why score is what it is */
  explanation: string;
  /** Daily cost context */
  avg_daily_cost_usd: number | null;
}

// ---------------------------------------------------------------------------
// Interest → attribute weight mapping
// Extend this to support new interest tags without changing scoring logic.
// Each entry: [primaryAttribute, primaryWeight, secondaryAttribute?, secondaryWeight?]
// ---------------------------------------------------------------------------

type AttributeKey = keyof Pick<
  DestinationAttributes,
  "nature" | "photography" | "food" | "culture" | "uniqueness"
>;

interface InterestMapping {
  weights: Array<{ attr: AttributeKey; weight: number }>;
}

const INTEREST_WEIGHTS: Record<string, InterestMapping> = {
  // Questionnaire options
  Nature: { weights: [{ attr: "nature", weight: 1.8 }, { attr: "photography", weight: 0.4 }] },
  "Mountain landscapes": { weights: [{ attr: "nature", weight: 2.0 }, { attr: "photography", weight: 0.6 }] },
  "Water & swimming": { weights: [{ attr: "nature", weight: 1.4 }, { attr: "photography", weight: 0.4 }] },
  Photography: { weights: [{ attr: "photography", weight: 1.8 }, { attr: "nature", weight: 0.5 }] },
  Food: { weights: [{ attr: "food", weight: 2.0 }, { attr: "culture", weight: 0.3 }] },
  "Local food": { weights: [{ attr: "food", weight: 2.0 }, { attr: "uniqueness", weight: 0.4 }] },
  Culture: { weights: [{ attr: "culture", weight: 1.8 }, { attr: "uniqueness", weight: 0.4 }] },
  History: { weights: [{ attr: "culture", weight: 2.0 }, { attr: "photography", weight: 0.3 }] },
  "Art & design": { weights: [{ attr: "culture", weight: 1.2 }, { attr: "photography", weight: 0.8 }] },
  Architecture: { weights: [{ attr: "culture", weight: 1.0 }, { attr: "photography", weight: 1.0 }] },
  "Small-town life": { weights: [{ attr: "uniqueness", weight: 1.5 }, { attr: "culture", weight: 0.5 }] },
  Nightlife: { weights: [{ attr: "food", weight: 0.8 }, { attr: "uniqueness", weight: 0.6 }] },
  Shopping: { weights: [{ attr: "culture", weight: 0.8 }, { attr: "food", weight: 0.4 }] },
  Adventure: { weights: [{ attr: "nature", weight: 1.8 }, { attr: "uniqueness", weight: 0.6 }] },
  // Fallback for unrecognized interests
  _default: { weights: [{ attr: "uniqueness", weight: 1.0 }, { attr: "culture", weight: 0.5 }] },
};

// Budget preference multiplier: upscale destinations score better with generous budgets
const BUDGET_PREFERENCE_TIER: Record<string, number> = {
  "Keep it lean": 1,
  Balance: 2,
  "A few beautiful splurges": 3,
};

// ---------------------------------------------------------------------------
// Core: score a single destination for a traveler profile
// ---------------------------------------------------------------------------

export function scoreDestinationForTraveler(
  name: string,
  attrs: DestinationAttributes,
  profile: TripData["traveler_profile"],
  budgetPreference: string
): DestinationMatchResult {
  const interests = profile.interests;
  if (interests.length === 0) {
    return {
      found: true,
      match_score: 65,
      attribute_scores: {},
      explanation: "No interests specified — using baseline score.",
      avg_daily_cost_usd: attrs.avg_daily_cost_usd,
    };
  }

  let totalWeightedScore = 0;
  let totalWeight = 0;
  const attributeScores: Record<string, number> = {};

  for (const interest of interests) {
    const mapping = INTEREST_WEIGHTS[interest] ?? INTEREST_WEIGHTS._default;
    for (const { attr, weight } of mapping.weights) {
      const raw = attrs[attr] as number;
      totalWeightedScore += raw * weight;
      totalWeight += weight;
      attributeScores[attr] = Math.max(attributeScores[attr] ?? 0, raw);
    }
  }

  const rawScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 65;

  // Budget alignment adjustment: ±10 points
  const travelerTier = BUDGET_PREFERENCE_TIER[budgetPreference] ?? 2;
  const budgetDelta = (travelerTier - attrs.budget_level) * 4; // ±4 per tier difference
  const budgetAdjusted = Math.min(100, Math.max(20, rawScore + budgetDelta));

  // Crowd penalty: high-interest travelers lose up to 8 points in crowded places
  const uniquenessInterest = interests.some((i) =>
    ["Small-town life", "Photography", "Nature"].includes(i)
  );
  const crowdPenalty = uniquenessInterest ? (attrs.crowd_level / 100) * 8 : 0;

  const finalScore = Math.round(Math.min(100, Math.max(0, budgetAdjusted - crowdPenalty)));

  // Generate explanation
  const topAttr = Object.entries(attributeScores).sort(([, a], [, b]) => b - a)[0];
  const weakAttr = Object.entries(attributeScores).sort(([, a], [, b]) => a - b)[0];
  const crowdNote =
    attrs.crowd_level >= 80
      ? " Crowds are significant at peak season."
      : attrs.crowd_level <= 30
      ? " Very low tourist density."
      : "";
  const budgetNote =
    budgetDelta > 5
      ? ` Under your budget preference.`
      : budgetDelta < -5
      ? ` Above your typical spend target.`
      : "";

  let explanation = `${name} scores well on ${topAttr?.[0] ?? "uniqueness"} (${topAttr?.[1] ?? 0}/100)`;
  if (weakAttr && weakAttr[0] !== topAttr?.[0] && (weakAttr[1] ?? 0) < 60) {
    explanation += `, but lower on ${weakAttr[0]} (${weakAttr[1]}/100)`;
  }
  explanation += `.${crowdNote}${budgetNote}`;

  return {
    found: true,
    match_score: finalScore,
    attribute_scores: attributeScores,
    explanation,
    avg_daily_cost_usd: attrs.avg_daily_cost_usd,
  };
}

// ---------------------------------------------------------------------------
// Trip Health Score computation
// ---------------------------------------------------------------------------

function scoreLabel(score: number): SubScore["label"] {
  if (score >= 88) return "Excellent";
  if (score >= 72) return "Good";
  if (score >= 55) return "Fair";
  return "Needs attention";
}

function subScore(score: number, explanation: string): SubScore {
  return { score: Math.round(score), label: scoreLabel(score), explanation };
}

/** Experience Fit: how well destinations match the traveler's interests */
function computeExperienceFit(
  route: RouteStop[],
  trip: TripData
): SubScore {
  const results: number[] = [];
  const names: string[] = [];

  for (const stop of route) {
    const attrs = lookupDestination(stop.location);
    if (!attrs) {
      results.push(68); // Unknown destination — neutral score
      continue;
    }
    const { match_score } = scoreDestinationForTraveler(
      stop.location,
      attrs,
      trip.traveler_profile,
      trip.budget_preference
    );
    results.push(match_score);
    names.push(stop.location);
  }

  if (results.length === 0) return subScore(65, "No route stops to evaluate.");

  // Weight by nights spent
  let weightedSum = 0;
  let weightTotal = 0;
  route.forEach((stop, i) => {
    const score = results[i] ?? 68;
    weightedSum += score * stop.nights;
    weightTotal += stop.nights;
  });

  const avg = weightTotal > 0 ? weightedSum / weightTotal : results.reduce((a, b) => a + b, 0) / results.length;
  const worstStop = route[results.indexOf(Math.min(...results))];
  const bestStop = route[results.indexOf(Math.max(...results))];

  let explanation = `Your itinerary scores ${Math.round(avg)}/100 for experience match. `;
  if (bestStop && names.length > 0) {
    explanation += `${bestStop.location} is the strongest fit (${Math.max(...results)}/100). `;
  }
  if (worstStop && results.length > 1 && Math.min(...results) < 65) {
    explanation += `${worstStop.location} is the weakest fit (${Math.min(...results)}/100) for your interests.`;
  }

  return subScore(avg, explanation.trim());
}

/** Transportation Efficiency: time in transit relative to total trip length */
function computeTransportationEfficiency(
  route: RouteStop[],
  totalDays: number
): SubScore {
  const totalTransitHours = route.reduce(
    (sum, stop) => sum + (stop.duration_hours ?? 0),
    0
  );
  const transitRatio = totalTransitHours / (totalDays * 8); // relative to 8 active hours/day

  let score: number;
  let description: string;

  if (transitRatio <= 0.05) {
    score = 95;
    description = `Minimal transit — only ${totalTransitHours.toFixed(1)}h moving across ${totalDays} days. Maximum time in each place.`;
  } else if (transitRatio <= 0.12) {
    score = 85;
    description = `Good balance — ${totalTransitHours.toFixed(1)}h total transit across ${totalDays} days.`;
  } else if (transitRatio <= 0.20) {
    score = 72;
    description = `Moderate transit load — ${totalTransitHours.toFixed(1)}h moving means some days are mostly travel.`;
  } else if (transitRatio <= 0.30) {
    score = 55;
    description = `Heavy transit — ${totalTransitHours.toFixed(1)}h on the move. Consider consolidating destinations.`;
  } else {
    score = 38;
    description = `Very high transit — ${totalTransitHours.toFixed(1)}h traveling significantly reduces experience time.`;
  }

  return subScore(score, description);
}

/** Budget Efficiency: destination cost levels vs traveler's daily budget */
function computeBudgetEfficiency(
  route: RouteStop[],
  trip: TripData
): SubScore {
  const totalDays = route.reduce((sum, s) => sum + s.nights, 0) || 1;
  const dailyBudget = trip.budget / totalDays;

  const costsFound: number[] = [];
  for (const stop of route) {
    const attrs = lookupDestination(stop.location);
    if (attrs) costsFound.push(attrs.avg_daily_cost_usd);
  }

  if (costsFound.length === 0) {
    return subScore(72, "Insufficient destination data to calculate budget efficiency.");
  }

  const avgDailyCost = costsFound.reduce((a, b) => a + b, 0) / costsFound.length;
  const ratio = avgDailyCost / dailyBudget;

  let score: number;
  let explanation: string;
  const formatted = `$${Math.round(avgDailyCost)}/day avg destination cost vs your $${Math.round(dailyBudget)}/day budget`;

  if (ratio < 0.5) {
    score = 80;
    explanation = `${formatted}. Destination costs are well below your budget — you have room for quality upgrades.`;
  } else if (ratio < 0.75) {
    score = 92;
    explanation = `${formatted}. Excellent fit — these destinations offer strong value at your budget level.`;
  } else if (ratio <= 1.0) {
    score = 98;
    explanation = `${formatted}. Near-perfect alignment — your budget matches the destination cost level well.`;
  } else if (ratio <= 1.25) {
    score = 78;
    explanation = `${formatted}. Slight stretch — these destinations run a bit above your daily budget. Prioritize essentials.`;
  } else if (ratio <= 1.5) {
    score = 58;
    explanation = `${formatted}. Destinations are significantly above budget. Consider lower-cost alternatives or reduce trip length.`;
  } else {
    score = 38;
    explanation = `${formatted}. Severe budget mismatch. These destinations typically require ${Math.round(ratio * 100 - 100)}% more than your daily allocation.`;
  }

  return subScore(score, explanation);
}

/** Uniqueness: how distinctive the route is, weighted by crowds */
function computeUniqueness(route: RouteStop[]): SubScore {
  const scores: number[] = [];

  for (const stop of route) {
    const attrs = lookupDestination(stop.location);
    if (!attrs) {
      scores.push(65);
      continue;
    }
    // Uniqueness score discounted by crowd level: high uniqueness + low crowds = best
    const crowdFactor = 1 - (attrs.crowd_level / 200); // 0.5–1.0
    scores.push(Math.round(attrs.uniqueness * crowdFactor));
  }

  if (scores.length === 0) return subScore(65, "Unable to evaluate route uniqueness.");

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  let explanation: string;
  if (avg >= 75) {
    explanation = `Your route features genuinely off-the-beaten-path destinations. Most travelers will not have been to these places.`;
  } else if (avg >= 55) {
    explanation = `A mix of well-known and lesser-visited places. Consider swapping one high-crowd destination for a lesser-known alternative.`;
  } else {
    explanation = `The route leans toward heavily-touristed destinations. Adding lesser-known stops would significantly improve the experience quality.`;
  }

  return subScore(avg, explanation);
}

/** Pacing: actual nights per stop vs ideal stay range from the destination catalog */
function computePacing(route: RouteStop[]): SubScore {
  const details: string[] = [];
  let totalPenalty = 0;

  for (const stop of route) {
    const attrs = lookupDestination(stop.location);
    if (!attrs) continue;

    const { min, max } = attrs.ideal_stay_days;
    const actual = stop.nights;

    if (actual < min) {
      const penalty = (min - actual) * 18;
      totalPenalty += penalty;
      details.push(`${stop.location}: ${actual} night${actual !== 1 ? "s" : ""} (ideal ${min}–${max}) — too brief`);
    } else if (actual > max + 1) {
      const penalty = (actual - max - 1) * 8;
      totalPenalty += penalty;
      details.push(`${stop.location}: ${actual} nights (ideal ${min}–${max}) — slightly long`);
    } else {
      details.push(`${stop.location}: ${actual} night${actual !== 1 ? "s" : ""} — well-paced`);
    }
  }

  const stopsEvaluated = details.length;
  if (stopsEvaluated === 0) return subScore(72, "Pacing looks reasonable based on available data.");

  const score = Math.max(20, 100 - totalPenalty / stopsEvaluated);

  const issues = details.filter((d) => d.includes("brief") || d.includes("long"));
  let explanation: string;

  if (issues.length === 0) {
    explanation = `All stops are within their ideal stay range. Great pacing.`;
  } else if (score >= 85) {
    explanation = `Strong overall pacing, with one small tradeoff: ${issues[0]}.${issues.length > 1 ? ` +${issues.length - 1} more.` : ""}`;
  } else if (score >= 70) {
    explanation = `Generally balanced pacing, with some room to improve: ${issues.slice(0, 2).join("; ")}.${issues.length > 2 ? ` +${issues.length - 2} more.` : ""}`;
  } else {
    explanation = `Pacing needs adjustment: ${issues.slice(0, 2).join("; ")}.${issues.length > 2 ? ` +${issues.length - 2} more.` : ""}`;
  }

  return subScore(score, explanation);
}

// ---------------------------------------------------------------------------
// Public API: compute full health score
// ---------------------------------------------------------------------------

export function computeTripHealthScore(
  itinerary: ItineraryData,
  trip: TripData
): TripHealthScore {
  const totalDays = itinerary.daily_schedule.length || itinerary.route.reduce((s, r) => s + r.nights, 0) || 7;

  const experienceFit = computeExperienceFit(itinerary.route, trip);
  const transportationEfficiency = computeTransportationEfficiency(itinerary.route, totalDays);
  const budgetEfficiency = computeBudgetEfficiency(itinerary.route, trip);
  const uniqueness = computeUniqueness(itinerary.route);
  const pacing = computePacing(itinerary.route);

  // Weighted composite: experience fit is most important
  const overall =
    experienceFit.score * 0.35 +
    pacing.score * 0.22 +
    budgetEfficiency.score * 0.20 +
    transportationEfficiency.score * 0.13 +
    uniqueness.score * 0.10;

  return {
    overall: Math.round(overall),
    overall_label: scoreLabel(overall),
    experience_fit: experienceFit,
    transportation_efficiency: transportationEfficiency,
    budget_efficiency: budgetEfficiency,
    uniqueness,
    pacing,
  };
}

// ---------------------------------------------------------------------------
// Scoring context string — injected into AI prompts
// ---------------------------------------------------------------------------

/**
 * Build a compact scoring context block for injection into AI prompts.
 * This is what allows the AI to reference real numbers in its reasoning.
 */
export function buildScoringContext(
  itinerary: ItineraryData,
  trip: TripData,
  healthScore?: TripHealthScore
): string {
  const lines: string[] = ["=== SCORING ENGINE DATA ==="];

  // Destination attribute summaries
  lines.push("\nDestination attributes from catalog:");
  const destinations = [...new Set(itinerary.route.map((r) => r.location))];
  for (const dest of destinations) {
    const attrs = lookupDestination(dest);
    if (attrs) {
      lines.push(`  • ${destinationSummary(dest, attrs)}`);
      const match = scoreDestinationForTraveler(dest, attrs, trip.traveler_profile, trip.budget_preference);
      lines.push(`    → Experience match for this traveler: ${match.match_score}/100. ${match.explanation}`);
    } else {
      lines.push(`  • ${dest}: Not in scoring catalog — use your own knowledge.`);
    }
  }

  // Trip health score
  if (healthScore) {
    lines.push("\nCurrent Trip Health Score:");
    lines.push(`  Overall: ${healthScore.overall}/100 (${healthScore.overall_label})`);
    lines.push(`  Experience Fit: ${healthScore.experience_fit.score}/100 — ${healthScore.experience_fit.explanation}`);
    lines.push(`  Pacing: ${healthScore.pacing.score}/100 — ${healthScore.pacing.explanation}`);
    lines.push(`  Budget Efficiency: ${healthScore.budget_efficiency.score}/100 — ${healthScore.budget_efficiency.explanation}`);
    lines.push(`  Transportation Efficiency: ${healthScore.transportation_efficiency.score}/100 — ${healthScore.transportation_efficiency.explanation}`);
    lines.push(`  Uniqueness: ${healthScore.uniqueness.score}/100 — ${healthScore.uniqueness.explanation}`);
  }

  lines.push("\nINSTRUCTION: When explaining recommendations or changes, reference the scores above.");
  lines.push("Use language like: 'Moving one night from X to Y increases Experience Fit by ~N points because...'");
  lines.push("Quantify tradeoffs where you can. Reference catalog attributes by name.");
  lines.push("=== END SCORING DATA ===\n");

  return lines.join("\n");
}

/**
 * Estimate the score delta when swapping one stop for another.
 * Used for tradeoff explanations in modifications.
 */
export function estimateSwapDelta(
  fromDest: string,
  toDest: string,
  profile: TripData["traveler_profile"],
  budgetPreference: string
): { experience_delta: number; cost_delta: number; explanation: string } {
  const fromAttrs = lookupDestination(fromDest);
  const toAttrs = lookupDestination(toDest);

  if (!fromAttrs || !toAttrs) {
    return { experience_delta: 0, cost_delta: 0, explanation: "Destination data unavailable for comparison." };
  }

  const fromScore = scoreDestinationForTraveler(fromDest, fromAttrs, profile, budgetPreference);
  const toScore = scoreDestinationForTraveler(toDest, toAttrs, profile, budgetPreference);

  const experienceDelta = toScore.match_score - fromScore.match_score;
  const costDelta = toAttrs.avg_daily_cost_usd - fromAttrs.avg_daily_cost_usd;

  const sign = experienceDelta >= 0 ? "+" : "";
  const costSign = costDelta >= 0 ? "+$" : "-$";

  return {
    experience_delta: experienceDelta,
    cost_delta: costDelta,
    explanation: `Swapping ${fromDest} → ${toDest}: ${sign}${experienceDelta} experience match points, ${costSign}${Math.abs(costDelta)}/day on-the-ground cost.`,
  };
}
