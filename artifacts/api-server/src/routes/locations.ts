import { Router, type IRouter } from "express";
import { autocompleteLocations } from "../lib/places";

const router: IRouter = Router();

router.get("/locations/suggest", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (query.length < 2) {
    return res.json([]);
  }

  const candidates = await autocompleteLocations(query, 5);

  return res.json(
    candidates.map((candidate) => ({
      formatted: candidate.formatted,
      city: candidate.city,
      state: candidate.state,
      country: candidate.country,
      country_code: candidate.country_code,
      lat: candidate.lat,
      lon: candidate.lon,
    }))
  );
});

export default router;