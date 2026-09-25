import type { FlightOffer, FlightSearch } from "../../../../lib/api-client-react/src/generated/api.schemas";

export function flightDuration(offer: FlightOffer): number | null {
  return offer.duration_complete === true && typeof offer.total_duration_minutes === "number" &&
    Number.isFinite(offer.total_duration_minutes) && offer.total_duration_minutes > 0 ? offer.total_duration_minutes : null;
}
export function flightConnections(offer: FlightOffer): number | null {
  return offer.stops_complete === true && Number.isInteger(offer.stop_count) && offer.stop_count >= 0 ? offer.stop_count : null;
}
export function formatFlightMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}
export function flightMetrics(offer: FlightOffer): string {
  const duration = flightDuration(offer), stops = flightConnections(offer);
  return [duration === null ? "Duration unavailable" : `${formatFlightMinutes(duration)} round-trip`,
    stops === null ? "Connections unavailable" : `${stops} round-trip connection${stops === 1 ? "" : "s"}`].join(" · ");
}
export function flightDeltas(offer: FlightOffer, recommended: FlightOffer): string {
  const parts: string[] = [];
  const price = offer.total_price_usd - recommended.total_price_usd;
  if (Number.isFinite(price) && Math.abs(price) >= 0.5) parts.push(`$${Math.round(Math.abs(price)).toLocaleString("en-US")} ${price < 0 ? "cheaper" : "more"}`);
  const duration = flightDuration(offer), referenceDuration = flightDuration(recommended);
  if (duration !== null && referenceDuration !== null && duration !== referenceDuration) {
    parts.push(`${formatFlightMinutes(Math.abs(duration - referenceDuration))} ${duration < referenceDuration ? "faster" : "longer"} round-trip`);
  }
  const stops = flightConnections(offer), referenceStops = flightConnections(recommended);
  if (stops !== null && referenceStops !== null && stops !== referenceStops) {
    const delta = Math.abs(stops - referenceStops);
    parts.push(`${delta} ${stops < referenceStops ? "fewer" : "more"} connection${delta === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}
export function visibleFlightAlternatives(flight?: FlightSearch) {
  return flight?.status === "live" && flight.selected_offer ? (flight.alternatives ?? []).slice(0, 2) : [];
}
