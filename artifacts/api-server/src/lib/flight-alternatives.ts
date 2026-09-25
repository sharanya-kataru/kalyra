import type { FlightOffer, FlightSearchResult } from "./flights";

type Candidate = { result: FlightSearchResult; offer: FlightOffer };
export const completeDuration = (offer: FlightOffer) => offer.duration_complete === true &&
  typeof offer.total_duration_minutes === "number" && Number.isFinite(offer.total_duration_minutes) && offer.total_duration_minutes > 0;
export const completeStops = (offer: FlightOffer) => offer.stops_complete === true &&
  Number.isInteger(offer.stop_count) && offer.stop_count >= 0;
const comparable = (offer: FlightOffer) => completeDuration(offer) && completeStops(offer);
const validFare = (offer: FlightOffer) => Number.isFinite(offer.total_price_usd) && offer.total_price_usd > 0;
const contextKey = (candidate: Candidate) => JSON.stringify([candidate.result.origin, candidate.result.destination,
  candidate.result.departure_date, candidate.result.return_date]);
const segmentsKey = (offer: FlightOffer) => JSON.stringify([offer.outbound.segments, offer.inbound.segments].map((leg) =>
  leg.map((s) => [s.origin_airport, s.destination_airport, s.departure_datetime, s.arrival_datetime, s.airline ?? "", s.flight_number ?? ""])));
const stableKey = (candidate: Candidate) => `${contextKey(candidate)}|${segmentsKey(candidate.offer)}|${candidate.offer.provider_offer_id}|${JSON.stringify([candidate.offer.total_duration_minutes, candidate.offer.stop_count, candidate.offer.duration_complete, candidate.offer.stops_complete, candidate.offer.carriers])}`;
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const tie = (a: Candidate, b: Candidate) => lexical(stableKey(a), stableKey(b));

/** Existing dollar-equivalent trade-off: $45 per round-trip connection and
 * $8 per round-trip hour. Missing metrics are never scored as zero. */
export function balancedFlightScore(offer: FlightOffer): number | null {
  return comparable(offer) ? offer.total_price_usd + 45 * offer.stop_count + 8 * offer.total_duration_minutes! / 60 : null;
}
function rank(a: Candidate, b: Candidate): number {
  const aScore = balancedFlightScore(a.offer), bScore = balancedFlightScore(b.offer);
  if (aScore !== null && bScore === null) return -1;
  if (aScore === null && bScore !== null) return 1;
  return (aScore ?? a.offer.total_price_usd) - (bScore ?? b.offer.total_price_usd) || tie(a, b);
}
function deduplicate(candidates: Candidate[]): Candidate[] {
  const ids = new Set<string>(), journeys = new Set<string>();
  // Prefer complete records, then the lower fare for duplicate journeys.
  return [...candidates].sort((a, b) => Number(comparable(b.offer)) - Number(comparable(a.offer)) ||
    a.offer.total_price_usd - b.offer.total_price_usd || tie(a, b)).filter((candidate) => {
    const id = `${contextKey(candidate)}|${candidate.offer.provider_offer_id}`;
    const segments = [...candidate.offer.outbound.segments, ...candidate.offer.inbound.segments];
    // Without identifiable segments, only the scoped provider ID is trustworthy.
    const signature = completeStops(candidate.offer) && segments.length >= 2 &&
      segments.every((s) => s.departure_datetime && s.arrival_datetime && s.flight_number)
      ? `${contextKey(candidate)}|${segmentsKey(candidate.offer)}` : null;
    const duplicate = ids.has(id) || (signature !== null && journeys.has(signature));
    ids.add(id);
    if (signature) journeys.add(signature);
    return !duplicate;
  });
}
function dominated(candidate: Candidate, pool: Candidate[]): boolean {
  // Unknown dimensions cannot establish dominance; compare only full records.
  if (!comparable(candidate.offer)) return false;
  return pool.some(({ offer }) => comparable(offer) &&
    offer.total_price_usd <= candidate.offer.total_price_usd && offer.stop_count <= candidate.offer.stop_count &&
    offer.total_duration_minutes! <= candidate.offer.total_duration_minutes! &&
    (offer.total_price_usd < candidate.offer.total_price_usd || offer.stop_count < candidate.offer.stop_count ||
      offer.total_duration_minutes! < candidate.offer.total_duration_minutes!));
}

/** No I/O. Only callers' completed, comparable-date live results enter the pool. */
export function buildFlightComparison(results: FlightSearchResult[]): FlightSearchResult | null {
  const pool = deduplicate(results.filter((result) => result.status === "live").flatMap((result) =>
    [...result.offers, ...(result.selected_offer ? [result.selected_offer] : [])]
      .filter((offer) => validFare(offer) && offer.source_metadata.is_live)
      .map((offer) => ({ result, offer }))));
  if (!pool.length) return null;
  const recommended = [...pool].sort(rank)[0];
  // Defensive date filtering: nearby-date estimates/offers cannot mix into comparisons.
  const sameDates = pool.filter(({ result }) => result.departure_date === recommended.result.departure_date &&
    result.return_date === recommended.result.return_date);
  const eligible = sameDates.filter((candidate) => !dominated(candidate, sameDates));
  const cheapest = [...eligible].sort((a, b) => a.offer.total_price_usd - b.offer.total_price_usd || rank(a, b))[0];
  const fastest = eligible.filter(({ offer }) => completeDuration(offer))
    .sort((a, b) => a.offer.total_duration_minutes! - b.offer.total_duration_minutes! || rank(a, b))[0];
  const alternatives: NonNullable<FlightSearchResult["alternatives"]> = [];
  function add(candidate: Candidate | undefined, kind: "cheapest" | "fastest", reason: string) {
    if (!candidate || candidate === recommended) return;
    const existing = alternatives.find((alternative) => alternative.offer === candidate.offer);
    if (existing) { existing.distinctions = [existing.kind, kind]; return; }
    const { origin, destination, departure_date, return_date } = candidate.result;
    alternatives.push({ kind, origin, destination, departure_date, return_date, offer: candidate.offer, reason });
  }
  // Product significance thresholds, not provider facts.
  if (cheapest && recommended.offer.total_price_usd - cheapest.offer.total_price_usd >= Math.max(25, recommended.offer.total_price_usd * 0.03)) {
    add(cheapest, "cheapest", "Lowest fare among the exact-date options compared.");
  }
  if (fastest && completeDuration(recommended.offer) && recommended.offer.total_duration_minutes! - fastest.offer.total_duration_minutes! >= 60) {
    add(fastest, "fastest", "Shortest complete round-trip travel time among the options compared.");
  }
  const completeCount = sameDates.filter(({ offer }) => comparable(offer)).length;
  const recommendation_reason = pool.length === 1 ? "The only usable live offer returned for the requested dates." :
    !comparable(recommended.offer) ? "Lowest fare among returned options; complete duration or connection data was unavailable for balanced comparison." :
    completeCount === 1 ? "The only returned option with complete duration and connection data for balanced comparison." :
    "Recommended balance of fare, round-trip travel time, and connections among the options compared.";
  return { ...recommended.result,
    offers: [...recommended.result.offers].sort((a, b) => rank({ result: recommended.result, offer: a }, { result: recommended.result, offer: b })),
    selected_offer: recommended.offer, recommendation_reason, alternatives };
}
