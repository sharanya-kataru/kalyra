import type { DailyItinerary, ItineraryData, TripData } from "./ai";
import type { PlaceResult, PlacesProvider } from "./places";
import { validPlace } from "./walking";

const CATEGORY_LABELS: Record<string, string> = {
  "leisure.park": "A park",
  "entertainment.museum": "A museum",
  "entertainment.culture.gallery": "A gallery",
  "tourism.attraction": "An attraction",
  "tourism.attraction.viewpoint": "A viewpoint",
  "tourism.sights.memorial": "A memorial",
  "tourism.sights.memorial.monument": "A monument",
  "tourism.sights.archaeological_site": "An archaeological site",
  "tourism.sights.place_of_worship": "A place of worship",
  "religion.place_of_worship": "A place of worship",
  heritage: "A heritage site",
};

export function formatPlaceDescription(place: PlaceResult): string {
  const description = place.description?.trim();
  // Ignore placeholders and repeated titles, without rewriting provider facts.
  if (description && /\p{L}/u.test(description) &&
      !/^(?:n\/?a|none|null|unknown|no description(?: available)?)\.?$/i.test(description) &&
      description.toLowerCase() !== place.name.trim().toLowerCase()) {
    return description;
  }

  const categories = place.categories ?? [place.category];
  const recognized = Object.keys(CATEGORY_LABELS)
    .filter((key) => categories.some((category) => category === key || category.startsWith(`${key}.`)))
    .sort((a, b) => b.split(".").length - a.split(".").length || a.localeCompare(b));
  if (recognized.length > 0) {
    const city = place.city?.trim();
    return `${CATEGORY_LABELS[recognized[0]]}${city ? ` in ${city}` : ""}.`;
  }
  return place.address_line2?.trim() || place.address?.trim() || "";
}

/** Enrich initial plans only. Missing places leave the deterministic plan intact. */
export async function discoverDailyActivities(
  itinerary: ItineraryData,
  trip: TripData,
  provider: PlacesProvider | null
): Promise<DailyItinerary[]> {
  if (!provider) return itinerary.daily_itinerary;

  const preferences = [
    ...trip.traveler_profile.interests,
    ...trip.traveler_profile.preferences,
  ].join(" ");
  const wantsNature = /nature|mountain|photography|water|adventure|outdoor|hiking/i.test(preferences);
  const wantsCulture = /culture|history|art|architecture|heritage/i.test(preferences);
  const locations = [...new Set(itinerary.daily_itinerary.map((day) => day.location))];
  const entries = await Promise.all(locations.map(async (location) => {
    const country = itinerary.route.find((stop) => stop.location === location)?.country;
    const context = country || trip.destination;
    const query = location.includes(",") || location.toLowerCase() === context.toLowerCase()
      ? location
      : `${location}, ${context}`;
    const dayCount = itinerary.daily_itinerary.filter((day) => day.location === location).length;
    const limit = Math.min(20, Math.max(5, dayCount * 2));
    // Query order expresses category preference; sorting within each group makes
    // allocation independent of the provider's response ordering.
    const searches: Array<() => Promise<PlaceResult[]>> = [];
    if (wantsNature) searches.push(() => provider.search_nature(query, limit));
    if (wantsCulture) searches.push(() => provider.search_points_of_interest(query, limit));
    searches.push(() => provider.search_attractions(query, limit));
    if (!wantsCulture) searches.push(() => provider.search_points_of_interest(query, limit));
    const results = await Promise.allSettled(searches.map(async (search) => search()));
    const seen = new Set<string>();
    const places = results.flatMap((result) => result.status === "fulfilled"
      ? [...result.value].sort((a, b) =>
        a.name.localeCompare(b.name) || (a.address ?? "").localeCompare(b.address ?? "") ||
        (a.lat ?? 0) - (b.lat ?? 0) || (a.lon ?? 0) - (b.lon ?? 0))
      : []).filter((place) => {
        const key = place.name.trim().toLowerCase().replace(/\s+/g, " ");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return [location, places] as const;
  }));
  const pools = new Map(entries);
  const cursors = new Map<string, number>();

  return itinerary.daily_itinerary.map((day, index, days) => {
    // Keep the whole departure day and arrival/transfer mornings available for
    // travel. Evenings remain flexible: place opening hours are not available.
    if (index === days.length - 1) return day;
    const updated = { ...day };
    const periods = index === 0 || days[index - 1].location !== day.location
      ? ["afternoon"] as const
      : ["morning", "afternoon"] as const;
    for (const period of periods) {
      const cursor = cursors.get(day.location) ?? 0;
      const place = pools.get(day.location)?.[cursor];
      if (!place) break;
      cursors.set(day.location, cursor + 1);
      const coordinates = { name: place.name, location: day.location, lat: place.lat, lon: place.lon };
      updated[period] = {
        ...(validPlace(coordinates) ? { place: coordinates } : {}),
        activity: place.name,
        description: formatPlaceDescription(place),
        estimated_cost_usd: day[period].estimated_cost_usd,
      };
    }
    return updated;
  });
}
