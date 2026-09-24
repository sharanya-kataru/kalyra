/** Allocate existing search results without changing their provider ordering. */
export function distributeRestaurants(
  locations: string[],
  restaurantsByLocation: ReadonlyMap<string, readonly string[]>
): string[][] {
  const dayCounts = new Map<string, number>();
  for (const location of locations) {
    dayCounts.set(location, (dayCounts.get(location) ?? 0) + 1);
  }
  const pools = new Map<string, string[]>();
  for (const [location, names] of restaurantsByLocation) {
    const seen = new Set<string>();
    pools.set(location, names.map((name) => name.trim().replace(/\s+/g, " ")).filter((name) => {
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }
  const cursors = new Map<string, number>();
  return locations.map((location) => {
    const pool = pools.get(location) ?? [];
    if (pool.length === 0) return [];
    const count = Math.min(3, Math.max(1, Math.floor(pool.length / dayCounts.get(location)!)));
    const cursor = cursors.get(location) ?? 0;
    cursors.set(location, cursor + count);
    return Array.from({ length: count }, (_, offset) => pool[(cursor + offset) % pool.length]);
  });
}
