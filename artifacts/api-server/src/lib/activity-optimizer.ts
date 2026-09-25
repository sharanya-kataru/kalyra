import { resolveOptimizationProfile } from "./optimization-profile";
import type { TripData } from "./ai";
import type { PlaceResult } from "./places";
import type { WeatherSummary } from "./weather";

// Category families express interests, not popularity or literal attraction facts.
const FAMILIES = [
  { dimension: "nature", interests: /nature|outdoor|mountain|water|adventure|hiking/i,
    categories: ["natural", "leisure.park", "tourism.attraction.viewpoint"] },
  { dimension: "photography", interests: /photograph|viewpoint/i,
    categories: ["natural", "leisure.park", "tourism.attraction.viewpoint"] },
  { dimension: "culture", interests: /culture|history|heritage/i,
    categories: ["heritage", "entertainment.museum", "entertainment.culture", "tourism.sights.archaeological_site", "tourism.sights.castle", "tourism.sights.palace", "tourism.sights.memorial.monument", "tourism.sights.place_of_worship", "religion.place_of_worship"] },
  { dimension: "art", interests: /\bart\b|museum|gallery/i,
    categories: ["entertainment.museum", "entertainment.culture"] },
  { dimension: "architecture", interests: /architecture|religio|worship/i,
    categories: ["heritage", "tourism.sights.place_of_worship", "religion.place_of_worship", "tourism.sights.castle", "tourism.sights.palace", "tourism.sights.memorial.monument"] },
];
const OUTDOOR = ["natural", "leisure.park", "tourism.attraction.viewpoint"];
const INDOOR = ["entertainment.museum", "entertainment.culture.gallery"];
const MEANINGFUL = [...FAMILIES.flatMap((family) => family.categories), "tourism.attraction"];
// Interest dominates a single proximity bonus. Baseline eligibility is never zero.
const BASE = 10, CATEGORY_BONUS = 10, INTEREST_BONUS = 30, MAX_INTEREST = 60;
const BAD_WEATHER_OUTDOOR = -10, BAD_WEATHER_INDOOR = 5;
// Diversity is secondary: 8 per prior overlapping-family selection, plus 8
// for repeating the current day's previous family. Cap at 36 and 60% of
// interest fit, so it cannot erase personalization. Count each place once,
// even when it matches overlapping nature/photography or culture/art families.
const REPETITION_WEIGHT = 8, MAX_DIVERSITY_PENALTY = 36;
const TOLERANCE_KM = { slow: 1, balanced: 3, fast: 6 };
export function activityPace(style: string): keyof typeof TOLERANCE_KM {
  if (/slow|unhurried|relaxed|easy/i.test(style)) return "slow";
  if (/fast|active|packed|see more|see it all/i.test(style)) return "fast";
  return "balanced";
}
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const activityIdentity = (place: PlaceResult) => normalized(place.name);
const categoriesOf = (place: PlaceResult) => place.categories ?? [place.category];
const matches = (category: string, parent: string) => category === parent || category.startsWith(`${parent}.`);
function hasCategory(place: PlaceResult, parents: string[]) {
  return categoriesOf(place).some((category) => parents.some((parent) => matches(category, parent)));
}
function coordinates(place: PlaceResult): place is PlaceResult & { lat: number; lon: number } {
  return typeof place.lat === "number" && Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 &&
    typeof place.lon === "number" && Number.isFinite(place.lon) && Math.abs(place.lon) <= 180;
}
/** Straight-line distance is only a grouping heuristic, never a displayed route estimate. */
export function geographicDistanceKm(a: PlaceResult, b: PlaceResult): number | null {
  if (!coordinates(a) || !coordinates(b)) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export interface ActivityContext {
  previous?: PlaceResult;
  selectedAtLocation?: readonly PlaceResult[];
  weather?: WeatherSummary;
  date?: string;
  location?: string;
}
export function scoreActivity(place: PlaceResult, trip: TripData, context: ActivityContext = {}) {
  const profile = resolveOptimizationProfile(trip.traveler_profile.optimization_mode);
  const preferences = [...trip.traveler_profile.interests, ...trip.traveler_profile.preferences].join(" ");
  const interestMatches = FAMILIES.filter((family) => family.interests.test(preferences))
    .map((family) => ({ dimension: family.dimension,
      categories: categoriesOf(place).filter((category) => family.categories.some((parent) => matches(category, parent))).sort() }))
    .filter((match) => match.categories.length > 0);
  const base = BASE + (hasCategory(place, MEANINGFUL) ? CATEGORY_BONUS : 0);
  // Collapse provider ancestors/descendants onto recognized category roots.
  // One root can support several explanatory dimensions, but earns only one
  // bonus. Two bonuses require two different dimensions AND distinct roots.
  const roots = [...new Set(FAMILIES.flatMap((family) => family.categories))]
    .filter((root, _, all) => !all.some((parent) => parent !== root && matches(root, parent)));
  const evidence = interestMatches.map((match) => ({ dimension: match.dimension,
    roots: roots.filter((root) => match.categories.some((category) => matches(category, root))) }));
  // The existing cap is two bonuses; checking distinct pairs avoids greedy
  // assignment depending on family/category order when evidence overlaps.
  const distinctPair = evidence.some((a, i) => evidence.slice(i + 1)
    .some((b) => a.roots.some((root) => b.roots.some((other) => root !== other))));
  const interest = Math.min(MAX_INTEREST, (distinctPair ? 2 : interestMatches.length ? 1 : 0) * INTEREST_BONUS);
  const families = FAMILIES.filter((family) => hasCategory(place, family.categories));
  const overlaps = (prior: PlaceResult) => families.some((family) => hasCategory(prior, family.categories));
  const repeatedSelections = (context.selectedAtLocation ?? []).filter(overlaps).length;
  const repeatsPrevious = context.previous ? overlaps(context.previous) : false;
  const diversityAdjustment = 0 - Math.min(MAX_DIVERSITY_PENALTY, interest * 0.6,
    REPETITION_WEIGHT * (repeatedSelections + Number(repeatsPrevious)));
  const distanceKm = context.previous ? geographicDistanceKm(context.previous, place) : null;
  const proximity = (tolerance: number) => distanceKm === null ? 0 : profile.proximityMaximum * Math.max(0, 1 - distanceKm / tolerance);
  const geography = proximity(TOLERANCE_KM.balanced);
  const pace = activityPace(trip.traveler_profile.travel_style);
  const paceAdjustment = proximity(TOLERANCE_KM[pace]) - geography;
  const forecast = context.weather;
  // Only matching day/base data can affect selection. Historical frequency is
  // explicitly not a future probability; require a majority of sampled wet days.
  const matchingWeather = forecast?.date === context.date && forecast?.location === context.location;
  const usableWeather = matchingWeather && forecast?.kind !== "historical" && forecast?.source_metadata?.is_live;
  const badWeather = usableWeather && ((forecast.precipitation_probability ?? 0) >= 60 ||
    [61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(forecast.weather_code ?? -1));
  const wetHistory = matchingWeather && forecast?.kind === "historical" && !forecast.source_metadata.is_live &&
    (forecast.historical_sample_days ?? 0) >= 100 && (forecast.historical_wet_day_frequency ?? 0) >= 60;
  const confidence = badWeather ? 1 : wetHistory ? 0.5 : 0;
  const weatherAdjustment = confidence === 0 ? 0 : confidence * (hasCategory(place, OUTDOOR) ? BAD_WEATHER_OUTDOOR :
    hasCategory(place, INDOOR) ? BAD_WEATHER_INDOOR : 0);
  return { total: base + interest * profile.interestMultiplier + geography + paceAdjustment + weatherAdjustment + diversityAdjustment,
    base, interest, interestMatches, distanceKm, geography, pace, paceAdjustment, weatherAdjustment, diversityAdjustment, repeatedSelections, repeatsPrevious };
}

// Final canonical comparison also selects duplicate representatives independently of
// response order. Provider timestamps are deliberately excluded from selection.
export function compareActivities(a: PlaceResult, b: PlaceResult): number {
  const key = (p: PlaceResult) => JSON.stringify([p.name, p.address, p.lat, p.lon,
    [...categoriesOf(p)].sort(), p.city, p.address_line2, p.description, p.source]);
  return activityIdentity(a).localeCompare(activityIdentity(b)) ||
    normalized(a.address ?? "").localeCompare(normalized(b.address ?? "")) ||
    (a.lat ?? 0) - (b.lat ?? 0) || (a.lon ?? 0) - (b.lon ?? 0) || key(a).localeCompare(key(b));
}
export function rankActivities(places: PlaceResult[], trip: TripData, context: ActivityContext = {}) {
  return places.map((place) => ({ place, score: scoreActivity(place, trip, context) }))
    .sort((a, b) => b.score.total - a.score.total || compareActivities(a.place, b.place));
}
