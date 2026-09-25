import type { FlightOffer, FlightSearchResult } from "../../artifacts/api-server/src/lib/flights";
import { liveSource } from "../../artifacts/api-server/src/lib/sources";
export function flightOffer(id: string, price: number, duration = 600, stops = 0, origin = "AAA", destination = "BBB"): FlightOffer {
  const segments = (from: string, to: string, date: string, count: number) => Array.from({ length: count }, (_, i) => ({
    origin_airport: i === 0 ? from : `X${i}`,
    destination_airport: i === count - 1 ? to : `X${i + 1}`,
    departure_datetime: `${date}T${String(8 + i).padStart(2, "0")}:00:00`,
    arrival_datetime: `${date}T${String(9 + i).padStart(2, "0")}:00:00`, airline: "Test Air", flight_number: `${id}-${i}`,
  }));
  return { provider_offer_id: id, total_price_usd: price, duration_complete: true, stops_complete: true,
    total_duration_minutes: duration, stop_count: stops, carriers: ["Test Air"],
    outbound: { duration_minutes: duration / 2, segments: segments(origin, destination, "2026-10-01", stops + 1) },
    inbound: { duration_minutes: duration / 2, segments: segments(destination, origin, "2026-10-05", 1) },
    departure_datetime: "2026-10-01T08:00:00", arrival_datetime: "2026-10-05T09:00:00",
    source_metadata: liveSource("Ignav", "flight_search", "2026-09-01T00:00:00Z") };
}
export function flightResult(offers: FlightOffer[], origin = "AAA", destination = "BBB"): FlightSearchResult {
  return { status: "live", origin, destination, departure_date: "2026-10-01", return_date: "2026-10-05",
    offers, selected_offer: offers[0] ?? null, source_metadata: liveSource("Ignav", "flight_search", "2026-09-01T00:00:00Z") };
}
