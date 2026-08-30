/**
 * Modular real-place data layer.
 *
 * Business logic depends on PlacesProvider, not Geoapify. A different provider
 * can implement this interface later without changing itinerary generation.
 */

export interface PlaceResult {
  name: string;
  category: string;
  address?: string;
  lat?: number;
  lon?: number;
  source: string;
}

export interface PlacesProvider {
  search_attractions(query: string, limit?: number): Promise<PlaceResult[]>;
  search_restaurants(query: string, limit?: number): Promise<PlaceResult[]>;
  search_nature(query: string, limit?: number): Promise<PlaceResult[]>;
  search_points_of_interest(query: string, limit?: number): Promise<PlaceResult[]>;
}

export interface FlightProvider {
  search_flights(...args: unknown[]): Promise<unknown[]>;
}

export interface HotelProvider {
  search_hotels(...args: unknown[]): Promise<unknown[]>;
}

export interface ActivityProvider {
  search_activities(...args: unknown[]): Promise<unknown[]>;
}

class GeoapifyPlacesProvider implements PlacesProvider {
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.geoapify.com/v2/places";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async search(query: string, categories: string, limit = 5): Promise<PlaceResult[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("categories", categories);
    url.searchParams.set("text", query);
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 20)));
    url.searchParams.set("apiKey", this.apiKey);

    try {
      const response = await fetch(url);
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
      return (body.features ?? [])
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
        }));
    } catch {
      // External place data is an enhancement. Never block trip generation.
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
