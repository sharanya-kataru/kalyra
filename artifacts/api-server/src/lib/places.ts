/**
 * Modular real-place data layer.
 *
 * Business logic depends on PlacesProvider, not Geoapify. A different provider
 * can implement this interface later without changing itinerary generation.
 */
import { logger } from "./logger";
import { liveSource } from "./sources";

export interface PlaceResult {
  name: string;
  category: string;
  address?: string;
  lat?: number;
  lon?: number;
  source: string;
  source_metadata?: ReturnType<typeof liveSource>;
}

export interface PlacesProvider {
  search_attractions(query: string, limit?: number): Promise<PlaceResult[]>;
  search_restaurants(query: string, limit?: number): Promise<PlaceResult[]>;
  search_nature(query: string, limit?: number): Promise<PlaceResult[]>;
  search_points_of_interest(query: string, limit?: number): Promise<PlaceResult[]>;
}

export type { FlightProvider } from "./flights";

export interface HotelProvider {
  search_hotels(...args: unknown[]): Promise<unknown[]>;
}

export interface ActivityProvider {
  search_activities(...args: unknown[]): Promise<unknown[]>;
}

class GeoapifyPlacesProvider implements PlacesProvider {
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.geoapify.com/v2/places";
  private readonly geocodeUrl = "https://api.geoapify.com/v1/geocode/search";
  private readonly coordinatesCache = new Map<string, Promise<{ lat: number; lon: number } | null>>();
  private readonly placesCache = new Map<string, { expiresAt: number; places: PlaceResult[] }>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async resolveCoordinates(query: string): Promise<{ lat: number; lon: number } | null> {
    const cached = this.coordinatesCache.get(query);
    if (cached) return cached;

    const request = (async () => {
      try {
        const url = new URL(this.geocodeUrl);
        url.searchParams.set("text", query);
        url.searchParams.set("limit", "1");
        url.searchParams.set("apiKey", this.apiKey);
        const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
        if (!response.ok) return null;
        const body = (await response.json()) as {
          results?: Array<{ lat?: unknown; lon?: unknown }>;
        };
        const result = body.results?.[0];
        const lat = Number(result?.lat);
        const lon = Number(result?.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      } catch {
        return null;
      }
    })();
    this.coordinatesCache.set(query, request);
    return request;
  }

  private async search(query: string, categories: string, limit = 5): Promise<PlaceResult[]> {
    const cacheKey = `${query.toLowerCase()}|${categories}|${limit}`;
    const cached = this.placesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.places;
    const coordinates = await this.resolveCoordinates(query);
    if (!coordinates) return [];

    const url = new URL(this.baseUrl);
    url.searchParams.set("categories", categories);
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 20)));
    url.searchParams.set("filter", `circle:${coordinates.lon},${coordinates.lat},15000`);
    url.searchParams.set("bias", `proximity:${coordinates.lon},${coordinates.lat}`);
    url.searchParams.set("apiKey", this.apiKey);

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        features?: Array<{
          properties?: {
            name?: string;
            formatted?: string;
            categories?: string[];
            lat?: number;
            lon?: number;
          };
        }>;
      };
      const places = (body.features ?? [])
        .map((feature) => feature.properties)
        .filter((property): property is NonNullable<typeof property> & { name: string } =>
          Boolean(property?.name)
        )
        .map((property) => ({
          name: property.name,
          category: property.categories?.[0] ?? "place",
          address: property.formatted,
          lat: property.lat,
          lon: property.lon,
          source: "Geoapify",
          source_metadata: liveSource("Geoapify", "place_search", new Date().toISOString()),
        }));
      this.placesCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, places });
      logger.info({ provider: "Geoapify", requestType: "place_search", cache: "miss", resultCount: places.length }, "Place search completed");
      return places;
    } catch {
      // External place data is an enhancement. Never block trip generation.
      logger.warn({ provider: "Geoapify", requestType: "place_search" }, "Place provider request failed");
      return [];
    }
  }

  search_attractions(query: string, limit = 5) {
    return this.search(query, "tourism.attraction,tourism.sights", limit);
  }

  search_restaurants(query: string, limit = 5) {
    return this.search(query, "catering.restaurant,catering.cafe", limit);
  }

  search_nature(query: string, limit = 5) {
    return this.search(query, "natural,leisure.park", limit);
  }

  search_points_of_interest(query: string, limit = 5) {
    return this.search(query, "tourism,heritage", limit);
  }
}

export function getPlacesProvider(): PlacesProvider | null {
  const key = process.env.GEOAPIFY_API_KEY;
  return key ? new GeoapifyPlacesProvider(key) : null;
}

export async function collectPlaceContext(
  destinations: string[],
  interests: string[]
): Promise<string> {
  const provider = getPlacesProvider();
  if (!provider) return "No live Places provider configured. Use scoring catalog and fallback behavior.";

  const wantsNature = interests.some((interest) =>
    /nature|mountain|photography|water|adventure/i.test(interest)
  );
  const wantsFood = interests.some((interest) => /food|culinary|restaurant/i.test(interest));
  const lines: string[] = ["Real place options retrieved from Geoapify (use these where relevant):"];

  for (const destination of destinations) {
    const [attractions, restaurants, nature] = await Promise.all([
      provider.search_attractions(destination, 4),
      wantsFood ? provider.search_restaurants(destination, 3) : Promise.resolve([]),
      wantsNature ? provider.search_nature(destination, 3) : Promise.resolve([]),
    ]);
    const places = [...attractions, ...restaurants, ...nature];
    if (places.length === 0) continue;
    lines.push(`  ${destination}: ${places.map((place) => `${place.name} (${place.category})`).join(", ")}`);
  }

  return lines.length === 1 ? "Places provider returned no results; use catalog and fallback behavior." : lines.join("\n");
}
