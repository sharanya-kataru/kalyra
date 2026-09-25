import assert from "node:assert/strict";
import test from "node:test";
import { getPlacesProvider } from "../../artifacts/api-server/src/lib/places";

test("POI search includes explicit cultural categories in one cached place request", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.GEOAPIFY_API_KEY;
  process.env.GEOAPIFY_API_KEY = "test-only";
  let placesCalls = 0;
  const categories = ["entertainment.museum", "entertainment.culture.gallery", "religion.place_of_worship"];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v2/places") {
      placesCalls++;
      assert.deepEqual(url.searchParams.get("categories")?.split(","), ["tourism", "heritage", ...categories]);
      assert.equal(url.searchParams.get("limit"), "20");
      assert.equal(url.searchParams.get("filter"), "circle:20,10,15000");
      assert.equal(url.searchParams.get("bias"), "proximity:20,10");
      return new Response(JSON.stringify({ features: categories.map((category) => ({
        properties: { name: category, categories: [category], lat: 10, lon: 20 },
      })) }));
    }
    return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [20, 10] }, properties: { formatted: "Provider test base", lat: 10, lon: 20 } }] }));
  };
  try {
    const provider = getPlacesProvider()!;
    const result = await provider.search_points_of_interest("Provider test base", 20);
    assert.deepEqual(result.map((place) => place.categories), categories.map((category) => [category]));
    assert.equal(placesCalls, 1);
    assert.deepEqual(await provider.search_points_of_interest("Provider test base", 20), result);
    assert.equal(placesCalls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = oldKey;
  }
});
