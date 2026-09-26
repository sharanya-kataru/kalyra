/**
 * Modular real-place data layer.
 *
 * Business logic depends on PlacesProvider, not Geoapify. A different provider
 * can implement this interface later without changing itinerary generation.
 */
import { logger } from "./logger";
import { liveSource } from "./sources";
import { getDestinationCatalogMatch } from "./destinations";

export interface PlaceResult {
  name: string;
  category: string;
  categories?: string[];
  city?: string;
  address_line2?: string;
  description?: string;
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
  private readonly placesCache = new Map<string, { expiresAt: number; places: PlaceResult[] }>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async resolveCoordinates(query: string): Promise<{ lat: number; lon: number } | null> {
    const location = await resolveLocation(query);
    if (!location) return null;
    return { lat: location.lat, lon: location.lon };
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
            city?: string;
            address_line2?: string;
            description?: string;
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
          categories: property.categories,
          city: property.city,
          address_line2: property.address_line2,
          description: property.description,
          address: property.formatted,
          lat: property.lat,
          lon: property.lon,
          source: "Geoapify",
          source_metadata: liveSource("Geoapify", "place_search", new Date().toISOString()),
        }));
      this.placesCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, places });
      while (this.placesCache.size > 500) this.placesCache.delete(this.placesCache.keys().next().value!);
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
    return this.search(query, "tourism,heritage,entertainment.museum,entertainment.culture.gallery,religion.place_of_worship", limit);
  }
}

let placesProvider: { key: string; provider: PlacesProvider } | undefined;
export function getPlacesProvider(): PlacesProvider | null {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) return null;
  if (placesProvider?.key !== key) placesProvider = { key, provider: new GeoapifyPlacesProvider(key) };
  return placesProvider.provider;
}

export async function collectPlaceContext(
  destinations: string[],
  interests: string[]
): Promise<string> {
  const provider = getPlacesProvider();
  if (!provider) {
    return "No live Places provider configured. Use scoring catalog and fallback behavior.";
  }

  const wantsNature = interests.some((interest) =>
    /nature|mountain|photography|water|adventure/i.test(interest)
  );

  const wantsFood = interests.some((interest) =>
    /food|culinary|restaurant/i.test(interest)
  );

  const destinationLines = await Promise.all(
    destinations.map(async (destination) => {
      const [attractions, restaurants, nature] = await Promise.all([
        provider.search_attractions(destination, 4),
        wantsFood
          ? provider.search_restaurants(destination, 3)
          : Promise.resolve([]),
        wantsNature
          ? provider.search_nature(destination, 3)
          : Promise.resolve([]),
      ]);

      const places = [...attractions, ...restaurants, ...nature];

      if (places.length === 0) return null;

      return `  ${destination}: ${places
        .map((place) => `${place.name} (${place.category})`)
        .join(", ")}`;
    })
  );

  const lines = [
    "Real place options retrieved from Geoapify (use these where relevant):",
    ...destinationLines.filter((line): line is string => line !== null),
  ];

  return lines.length === 1
    ? "Places provider returned no results; use catalog and fallback behavior."
    : lines.join("\n");
}

export interface ResolvedLocation {
  query: string;
  formatted?: string;
  city?: string;
  state?: string;
  country?: string;
  country_code?: string;
  lat: number;
  lon: number;
  source: "Geoapify";
}

const locationCache: Record<string, ResolvedLocation> = {};

export async function resolveLocationCandidates(
    query: string,
    limit = 5
  ): Promise<ResolvedLocation[]> {
    const apiKey = process.env.GEOAPIFY_API_KEY;

    if (!apiKey) {
      logger.warn(
        { provider: "Geoapify", requestType: "geocode_candidates" },
        "Geoapify API key is not configured"
      );
      return [];
    }

    try {
      const url = new URL("https://api.geoapify.com/v1/geocode/search");
      url.searchParams.set("text", query);
      url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 10)));
      url.searchParams.set("apiKey", apiKey);

      const response = await fetch(url, {
        signal: AbortSignal.timeout(6_000),
      });

      if (!response.ok) {
        logger.warn(
          {
            provider: "Geoapify",
            requestType: "geocode_candidates",
            statusCode: response.status,
          },
          "Geoapify candidate geocoding request failed"
        );
        return [];
      }

      const body = (await response.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: {
            formatted?: string;
            city?: string;
            state?: string;
            country?: string;
            country_code?: string;
          };
        }>;
      };

      const candidates: ResolvedLocation[] = [];

      for (const feature of body.features ?? []) {
        const coordinates = feature.geometry?.coordinates;
        const properties = feature.properties;

        if (!coordinates || !properties) continue;

        const [lon, lat] = coordinates;

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        candidates.push({
          query,
          formatted: properties.formatted,
          city: properties.city,
          state: properties.state,
          country: properties.country,
          country_code: properties.country_code,
          lat,
          lon,
          source: "Geoapify",
        });
      }

      logger.info(
        {
          provider: "Geoapify",
          requestType: "geocode_candidates",
          resultCount: candidates.length,
        },
        "Location candidate search completed"
      );

      return candidates;
    } catch (error) {
      logger.warn(
        {
          provider: "Geoapify",
          requestType: "geocode_candidates",
          error,
        },
        "Geoapify candidate geocoding failed"
      );

      return [];
    }
  }

  export async function autocompleteLocations(
  query: string,
  limit = 5
): Promise<ResolvedLocation[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  const trimmed = query.trim();

  if (!apiKey || trimmed.length < 2) {
    return [];
  }

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");

    // Fetch more than we display so Kalyra can rank and filter the candidates.
    url.searchParams.set("text", trimmed);
    url.searchParams.set("limit", "20");
    url.searchParams.set("lang", "en");
    url.searchParams.set("apiKey", apiKey);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(6_000),
    });

    if (!response.ok) {
      logger.warn(
        {
          provider: "Geoapify",
          requestType: "location_autocomplete",
          statusCode: response.status,
        },
        "Geoapify autocomplete request failed"
      );
      return [];
    }

    const body = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
          formatted?: string;
          city?: string;
          state?: string;
          country?: string;
          country_code?: string;
          result_type?: string;
        };
      }>;
    };

    const candidates: Array<{
      location: ResolvedLocation;
      catalogScore: number;
      originalIndex: number;
    }> = [];

    for (const [originalIndex, feature] of (body.features ?? []).entries()) {
      const coordinates = feature.geometry?.coordinates;
      const properties = feature.properties;

      if (!coordinates || !properties) continue;

      const [lon, lat] = coordinates;

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      // Kalyra is searching for travel destinations, not addresses or
      // administrative records.
      const allowedResultTypes = new Set([
        "city",
        "town",
        "village",
        "municipality",
        "county",
        "state",
        "country",
      ]);

      if (
        properties.result_type &&
        !allowedResultTypes.has(properties.result_type)
      ) {
        continue;
      }

      const location: ResolvedLocation = {
        query: trimmed,
        formatted: properties.formatted,
        city: properties.city,
        state: properties.state,
        country: properties.country,
        country_code: properties.country_code,
        lat,
        lon,
        source: "Geoapify",
      };

      candidates.push({
        location,
        catalogScore: getDestinationCatalogMatch(trimmed, location),
        originalIndex,
      });
    }

    // Prefer destinations already understood by Kalyra, while preserving
    // Geoapify's ranking for destinations outside the catalog.
    candidates.sort((a, b) => {
      if (b.catalogScore !== a.catalogScore) {
        return b.catalogScore - a.catalogScore;
      }

      return a.originalIndex - b.originalIndex;
    });

    const normalizedQuery = trimmed.toLowerCase().trim();
    const queryWords = normalizedQuery.split(/\s+/);

    const topCatalogScore = candidates[0]?.catalogScore ?? 0;

    // A simple destination-name search such as "Florence" or "Milan" that
    // strongly matches Kalyra's catalog should resolve to that travel
    // destination rather than every geographic place sharing the name.
    if (
      queryWords.length === 1 &&
      normalizedQuery.length >= 3 &&
      topCatalogScore >= 200
    ) {
      return [candidates[0].location];
    }

        // Deduplicate geographic variants of the same city.
    // For travel search, "Milan, LOM, Italy" and "Milan, Italy" represent
    // the same destination.
    const seen = new Set<string>();
    const results: ResolvedLocation[] = [];

    for (const candidate of candidates) {
      const location = candidate.location;
      const candidateName =
        location.city?.toLowerCase().trim() ??
        location.formatted?.split(",")[0]?.toLowerCase().trim() ??
        "";

      const exactNameMatch = candidateName === normalizedQuery;
      const startsWithQuery = candidateName.startsWith(normalizedQuery);

      if (!exactNameMatch && !startsWithQuery) {
        continue;
      }

      const dedupeKey = [
        location.city?.toLowerCase().trim() ?? "",
        location.state?.toLowerCase().trim() ?? "",
        location.country_code?.toLowerCase().trim() ?? "",
      ].join("|");

      // If Geoapify omitted state on one representation of the same city,
      // also compare city + country.
      const broadKey = [
        location.city?.toLowerCase().trim() ?? "",
        location.country_code?.toLowerCase().trim() ?? "",
      ].join("|");

      if (seen.has(dedupeKey) || seen.has(broadKey)) {
        continue;
      }

      seen.add(dedupeKey);
      seen.add(broadKey);

      results.push(location);

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  } catch (error) {
    logger.warn(
      {
        provider: "Geoapify",
        requestType: "location_autocomplete",
        error,
      },
      "Geoapify autocomplete failed"
    );

    return [];
  }
}

const pendingLocations = new Map<string, Promise<ResolvedLocation | null>>();
export async function resolveLocation(query: string): Promise<ResolvedLocation | null> {
  const key = `${process.env.GEOAPIFY_API_KEY}|${query.trim().toLowerCase()}`;
  const existing = pendingLocations.get(key);
  if (existing) return existing;
  const pending = resolveLocationOnce(query);
  pendingLocations.set(key, pending);
  try { return await pending; } finally { pendingLocations.delete(key); }
}

async function resolveLocationOnce(query: string): Promise<ResolvedLocation | null> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    logger.warn({ provider: "Geoapify", requestType: "geocode" }, "Geoapify API key is not configured");
    return null;
  }

  const cacheKey = query.trim().toLowerCase();
  if (locationCache[cacheKey]) {
    return locationCache[cacheKey];
  }

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/search");
    url.searchParams.set("text", query);
    url.searchParams.set("limit", "1");
    url.searchParams.set("apiKey", apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) {
      logger.warn(
        { provider: "Geoapify", requestType: "geocode", statusCode: response.status },
        "Geoapify geocoding request failed"
      );
      return null;
    }

    const body = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
          formatted?: string;
          city?: string;
          state?: string;
          country?: string;
          country_code?: string;
        };
      }>;
    };
    const result = body.features?.[0];

    if (!result || !result.geometry || !result.properties || !Array.isArray(result.geometry.coordinates)) {
      logger.warn({ provider: "Geoapify", requestType: "geocode" }, "Geoapify geocoding response missing result data");
      return null;
    }

    const [lon, lat] = result.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      logger.warn({ provider: "Geoapify", requestType: "geocode" }, "Geoapify geocoding response missing valid coordinates");
      return null;
    }

    const resolvedLocation: ResolvedLocation = {
      query,
      formatted: result.properties.formatted,
      city: result.properties.city,
      state: result.properties.state,
      country: result.properties.country,
      country_code: result.properties.country_code,
      lat,
      lon,
      source: "Geoapify",
    };

    locationCache[cacheKey] = resolvedLocation;
    return resolvedLocation;
  } catch (error) {
    logger.warn({ provider: "Geoapify", requestType: "geocode", error }, "Geoapify geocoding failed");
    return null;
  }
}

export interface AirportCandidate {
  name: string;
  formatted?: string;
  iata?: string;
  icao?: string;
  closest_town?: string;
  city?: string;
  country?: string;
  country_code?: string;
  lat: number;
  lon: number;
  distance_km: number;
  categories: string[];
  place_id?: string;
  source: "Geoapify";
}

const airportDiscoveryCache = new Map<string, AirportCandidate[]>();

function getPropertyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIata(value: unknown): string | undefined {
  const candidate = getPropertyText(value);
  if (!candidate || !/^[A-Za-z]{3}$/.test(candidate)) return undefined;
  return candidate.toUpperCase();
}

function normalizeIcao(value: unknown): string | undefined {
  const candidate = getPropertyText(value);
  if (!candidate || !/^[A-Za-z]{4}$/.test(candidate)) return undefined;
  return candidate.toUpperCase();
}

function normalizeCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function getAirportMeta(raw: unknown): { iata?: string; icao?: string; closest_town?: string } {
  if (!raw || typeof raw !== "object") return {};

  const record = raw as Record<string, unknown>;
  return {
    iata: normalizeIata(record.iata),
    icao: normalizeIcao(record.icao),
    closest_town: getPropertyText(record.closest_town),
  };
}

function isPassengerAirportCandidate(categories: string[], iata?: string): boolean {
  const normalized = categories.map((category) => category.toLowerCase());
  if (normalized.some((category) => /airport\.(private|military|gliding)/.test(category))) {
    return false;
  }

  return Boolean(iata) && normalized.some((category) => category.includes("airport"));
}

async function getAirportPlaceDetails(placeId: string, apiKey: string): Promise<{ iata?: string; icao?: string; closest_town?: string } | null> {
  const url = new URL("https://api.geoapify.com/v2/place-details");
  url.searchParams.set("id", placeId);
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) {
      logger.warn({ provider: "Geoapify", requestType: "airport_details", statusCode: response.status }, "Airport place-details request failed");
      return null;
    }

    const body = (await response.json()) as {
      properties?: {
        airport?: Record<string, unknown>;
        iata?: unknown;
        icao?: unknown;
        closest_town?: unknown;
      };
    };
    const airport = body.properties?.airport ?? {};
    const flatAirport = {
      ...airport,
      iata: body.properties?.iata ?? airport.iata,
      icao: body.properties?.icao ?? airport.icao,
      closest_town: body.properties?.closest_town ?? airport.closest_town,
    };
    return {
      iata: normalizeIata(flatAirport.iata),
      icao: normalizeIcao(flatAirport.icao),
      closest_town: getPropertyText(flatAirport.closest_town),
    };
  } catch (error) {
    logger.warn({ provider: "Geoapify", requestType: "airport_details", error }, "Airport place-details lookup failed");
    return null;
  }
}

async function searchAirportRadius(
  location: ResolvedLocation,
  apiKey: string,
  radiusMeters: number,
  seen: Set<string>,
  existingCandidates: AirportCandidate[]
): Promise<AirportCandidate[]> {
  const url = new URL("https://api.geoapify.com/v2/places");
  url.searchParams.set("categories", "airport");
  url.searchParams.set("filter", `circle:${location.lon},${location.lat},${radiusMeters}`);
  url.searchParams.set("bias", `proximity:${location.lon},${location.lat}`);
  url.searchParams.set("limit", "50");
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      logger.warn({ provider: "Geoapify", requestType: "airport_discovery", radiusMeters, statusCode: response.status }, "Airport discovery request failed");
      return existingCandidates;
    }

    const body = (await response.json()) as {
      features?: Array<{
        id?: string;
        properties?: Record<string, unknown>;
      }>;
    };
    const features = Array.isArray(body.features) ? body.features : [];
    if (features.length === 0) return existingCandidates;

    const resolvedCandidates = await Promise.all(
      features.map(async (feature): Promise<AirportCandidate | null> => {
        const properties = feature.properties ?? {};
        const propertyRecord = properties as Record<string, unknown>;
        const name = getPropertyText(propertyRecord.name);

        if (!name) return null;

        const categories = normalizeCategories(propertyRecord.categories);

        if (
          !categories.some((category) =>
            category.toLowerCase().includes("airport")
          )
        ) {
          return null;
        }

        const placeId =
          getPropertyText(propertyRecord.place_id) ??
          (typeof feature.id === "string" ? feature.id : undefined);

        // Overlapping radius responses contain the same airports. Deduplicate
        // before looking up missing metadata, including candidates with no IATA.
        if (placeId) {
          if (seen.has(placeId)) return null;
          seen.add(placeId);
        }

        const distanceMeters = Number(propertyRecord.distance ?? 0);
        const lat = Number(propertyRecord.lat);
        const lon = Number(propertyRecord.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return null;
        }

        const airportMeta = getAirportMeta(
          (propertyRecord.airport as unknown) ?? propertyRecord
        );

        const iata = normalizeIata(
          airportMeta.iata ??
            propertyRecord.iata ??
            (propertyRecord.airport as Record<string, unknown> | undefined)?.iata
        );

        const icao = normalizeIcao(
          airportMeta.icao ??
            propertyRecord.icao ??
            (propertyRecord.airport as Record<string, unknown> | undefined)?.icao
        );

        const closestTown = getPropertyText(
          airportMeta.closest_town ??
            propertyRecord.closest_town ??
            (propertyRecord.airport as Record<string, unknown> | undefined)
              ?.closest_town
        );

        const hasExplicitlyInvalidCategory = categories.some((category) =>
          /airport\.(private|military|gliding)/i.test(category)
        );

        if (hasExplicitlyInvalidCategory) return null;

        const candidate: AirportCandidate = {
          name,
          formatted: getPropertyText(propertyRecord.formatted),
          iata,
          icao,
          closest_town: closestTown,
          city: getPropertyText(propertyRecord.city),
          country: getPropertyText(propertyRecord.country),
          country_code: getPropertyText(propertyRecord.country_code),
          lat,
          lon,
          distance_km: Number.isFinite(distanceMeters)
            ? distanceMeters / 1000
            : 0,
          categories,
          place_id: placeId,
          source: "Geoapify",
        };

        // Only request additional metadata when the Places response did not
        // already provide the IATA code.
        if (!candidate.iata && candidate.place_id) {
          const details = await getAirportPlaceDetails(
            candidate.place_id,
            apiKey
          );

          if (details) {
            candidate.iata = details.iata ?? candidate.iata;
            candidate.icao = details.icao ?? candidate.icao;
            candidate.closest_town =
              details.closest_town ?? candidate.closest_town;
          }
        }

        return candidate.iata ? candidate : null;
      })
    );

    for (const candidate of resolvedCandidates) {
      if (!candidate) continue;

      const dedupeKey =
        candidate.place_id ??
        `${candidate.name}|${candidate.lat}|${candidate.lon}`;

      if (!candidate.place_id && seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      existingCandidates.push(candidate);
    }
        return existingCandidates;
  } catch (error) {
    logger.warn(
      {
        provider: "Geoapify",
        requestType: "airport_discovery",
        radiusMeters,
        error,
      },
      "Airport discovery failed"
    );

    return existingCandidates;
  }
}

export async function discoverNearbyAirports(location: ResolvedLocation, limit = Infinity): Promise<AirportCandidate[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    logger.warn({ provider: "Geoapify", requestType: "airport_discovery" }, "Geoapify API key is not configured");
    return [];
  }

  const cacheKey = `${location.query.trim().toLowerCase()}|${location.lat.toFixed(4)}|${location.lon.toFixed(4)}|${limit}`;
  const cached = airportDiscoveryCache.get(cacheKey);
  if (cached) return cached;

  const candidates: AirportCandidate[] = [];
  const seen = new Set<string>();

  const radiusSearches = [250_000, 500_000];

  for (const radiusMeters of radiusSearches) {
    await searchAirportRadius(
      location,
      apiKey,
      radiusMeters,
      seen,
      candidates
    );
    // A wider radius cannot improve the nearest N airports once N are found.
    if (new Set(candidates.filter((candidate) => isPassengerAirportCandidate(candidate.categories, candidate.iata))
      .map((candidate) => candidate.iata)).size >= limit) break;
  }

  const sorted = [...candidates]
    .filter((candidate) => isPassengerAirportCandidate(candidate.categories, candidate.iata))
    .sort((left, right) => left.distance_km - right.distance_km);

  airportDiscoveryCache.set(cacheKey, sorted);
  logger.info({ provider: "Geoapify", requestType: "airport_discovery", cache: "miss", resultCount: sorted.length }, "Airport discovery completed");
  return sorted;
}
