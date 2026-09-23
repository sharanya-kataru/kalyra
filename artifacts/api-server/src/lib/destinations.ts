/**
 * Destination Catalog
 *
 * Each entry encodes 10 structured attributes for a destination.
 * To add a new destination: add an entry to DESTINATIONS — no other changes needed.
 * All scores are 0–100 unless noted.
 */

export interface DestinationAttributes {
  /** Average on-the-ground daily spend in USD (excludes flights) */
  avg_daily_cost_usd: number;
  /** Budget tier: 1=budget(<$60/day), 2=moderate, 3=mid-range, 4=upscale, 5=luxury */
  budget_level: 1 | 2 | 3 | 4 | 5;
  /** Scenic natural landscapes, outdoor access, wilderness */
  nature: number;
  /** Visual appeal — architecture, light, scenery, street life */
  photography: number;
  /** Local food scene quality, variety, authenticity */
  food: number;
  /** History, museums, art, living cultural traditions */
  culture: number;
  /** How non-generic the experience is vs tourist-standard destinations */
  uniqueness: number;
  /** Ease of navigating (0=extremely easy, 100=very complex) */
  transport_complexity: number;
  /** Tourist crowd density at peak season (0=empty, 100=overwhelmed) */
  crowd_level: number;
  /** Recommended minimum and maximum nights */
  ideal_stay_days: { min: number; max: number };
  /** Calendar months where this destination shines (1=Jan…12=Dec) */
  best_months: number[];
  /** Tags for fuzzy matching — lower-case, no accents */
  tags: string[];
}

/**
 * Canonical destination catalog.
 * Keys are lower-cased canonical names.
 * Tags allow partial/alias matching (e.g. "northern italy" → tags include "italy").
 */
export const DESTINATIONS: Record<string, DestinationAttributes> = {
  // ── European cities ──────────────────────────────────────────────────────
  paris: {
    avg_daily_cost_usd: 160,
    budget_level: 4,
    nature: 18,
    photography: 94,
    food: 95,
    culture: 98,
    uniqueness: 40,
    transport_complexity: 25,
    crowd_level: 90,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["paris", "france", "ile-de-france"],
  },
  rome: {
    avg_daily_cost_usd: 130,
    budget_level: 3,
    nature: 15,
    photography: 92,
    food: 90,
    culture: 99,
    uniqueness: 45,
    transport_complexity: 40,
    crowd_level: 92,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [4, 5, 9, 10, 11],
    tags: ["rome", "roma", "italy", "lazio"],
  },
  florence: {
    avg_daily_cost_usd: 120,
    budget_level: 3,
    nature: 30,
    photography: 91,
    food: 92,
    culture: 97,
    uniqueness: 52,
    transport_complexity: 20,
    crowd_level: 85,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [4, 5, 9, 10],
    tags: ["florence", "firenze", "tuscany", "toscana", "italy"],
  },
  milan: {
    avg_daily_cost_usd: 145,
    budget_level: 4,
    nature: 10,
    photography: 72,
    food: 85,
    culture: 82,
    uniqueness: 38,
    transport_complexity: 22,
    crowd_level: 65,
    ideal_stay_days: { min: 1, max: 3 },
    best_months: [4, 5, 9, 10],
    tags: ["milan", "milano", "lombardy", "italy", "northern italy"],
  },
  venice: {
    avg_daily_cost_usd: 150,
    budget_level: 4,
    nature: 25,
    photography: 98,
    food: 74,
    culture: 92,
    uniqueness: 88,
    transport_complexity: 45,
    crowd_level: 97,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [3, 4, 10, 11],
    tags: ["venice", "venezia", "veneto", "italy"],
  },
  barcelona: {
    avg_daily_cost_usd: 125,
    budget_level: 3,
    nature: 30,
    photography: 90,
    food: 91,
    culture: 86,
    uniqueness: 62,
    transport_complexity: 20,
    crowd_level: 88,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["barcelona", "catalonia", "spain"],
  },
  madrid: {
    avg_daily_cost_usd: 110,
    budget_level: 3,
    nature: 12,
    photography: 75,
    food: 90,
    culture: 90,
    uniqueness: 48,
    transport_complexity: 18,
    crowd_level: 70,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [3, 4, 5, 9, 10, 11],
    tags: ["madrid", "spain", "castile"],
  },
  amsterdam: {
    avg_daily_cost_usd: 150,
    budget_level: 4,
    nature: 22,
    photography: 88,
    food: 72,
    culture: 85,
    uniqueness: 60,
    transport_complexity: 15,
    crowd_level: 85,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [4, 5, 6, 7, 8, 9],
    tags: ["amsterdam", "netherlands", "holland"],
  },
  berlin: {
    avg_daily_cost_usd: 105,
    budget_level: 2,
    nature: 20,
    photography: 80,
    food: 78,
    culture: 90,
    uniqueness: 72,
    transport_complexity: 15,
    crowd_level: 62,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["berlin", "germany"],
  },
  munich: {
    avg_daily_cost_usd: 140,
    budget_level: 4,
    nature: 35,
    photography: 78,
    food: 80,
    culture: 82,
    uniqueness: 45,
    transport_complexity: 15,
    crowd_level: 65,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [5, 6, 7, 8, 9, 10],
    tags: ["munich", "münchen", "bavaria", "germany"],
  },
  vienna: {
    avg_daily_cost_usd: 130,
    budget_level: 3,
    nature: 22,
    photography: 88,
    food: 80,
    culture: 96,
    uniqueness: 55,
    transport_complexity: 12,
    crowd_level: 72,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["vienna", "wien", "austria"],
  },
  prague: {
    avg_daily_cost_usd: 85,
    budget_level: 2,
    nature: 18,
    photography: 90,
    food: 70,
    culture: 88,
    uniqueness: 62,
    transport_complexity: 20,
    crowd_level: 82,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [4, 5, 9, 10],
    tags: ["prague", "czech republic", "bohemia"],
  },
  budapest: {
    avg_daily_cost_usd: 75,
    budget_level: 2,
    nature: 20,
    photography: 88,
    food: 78,
    culture: 87,
    uniqueness: 68,
    transport_complexity: 18,
    crowd_level: 75,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [4, 5, 9, 10],
    tags: ["budapest", "hungary"],
  },
  lisbon: {
    avg_daily_cost_usd: 100,
    budget_level: 2,
    nature: 32,
    photography: 88,
    food: 86,
    culture: 82,
    uniqueness: 70,
    transport_complexity: 28,
    crowd_level: 75,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [3, 4, 5, 6, 9, 10, 11],
    tags: ["lisbon", "lisboa", "portugal"],
  },
  porto: {
    avg_daily_cost_usd: 90,
    budget_level: 2,
    nature: 35,
    photography: 90,
    food: 85,
    culture: 80,
    uniqueness: 72,
    transport_complexity: 25,
    crowd_level: 65,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["porto", "oporto", "portugal", "douro"],
  },
  edinburgh: {
    avg_daily_cost_usd: 130,
    budget_level: 3,
    nature: 55,
    photography: 88,
    food: 68,
    culture: 88,
    uniqueness: 68,
    transport_complexity: 18,
    crowd_level: 70,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["edinburgh", "scotland", "uk"],
  },
  copenhagen: {
    avg_daily_cost_usd: 175,
    budget_level: 5,
    nature: 25,
    photography: 82,
    food: 88,
    culture: 85,
    uniqueness: 62,
    transport_complexity: 12,
    crowd_level: 60,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["copenhagen", "denmark", "scandinavia"],
  },
  stockholm: {
    avg_daily_cost_usd: 170,
    budget_level: 5,
    nature: 40,
    photography: 82,
    food: 82,
    culture: 85,
    uniqueness: 60,
    transport_complexity: 15,
    crowd_level: 55,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [5, 6, 7, 8],
    tags: ["stockholm", "sweden", "scandinavia"],
  },
  athens: {
    avg_daily_cost_usd: 90,
    budget_level: 2,
    nature: 28,
    photography: 85,
    food: 82,
    culture: 98,
    uniqueness: 65,
    transport_complexity: 32,
    crowd_level: 78,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [4, 5, 9, 10, 11],
    tags: ["athens", "greece", "attica"],
  },
  dubrovnik: {
    avg_daily_cost_usd: 120,
    budget_level: 3,
    nature: 62,
    photography: 94,
    food: 72,
    culture: 80,
    uniqueness: 65,
    transport_complexity: 30,
    crowd_level: 92,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [5, 6, 9, 10],
    tags: ["dubrovnik", "croatia", "dalmatia"],
  },
  split: {
    avg_daily_cost_usd: 100,
    budget_level: 2,
    nature: 60,
    photography: 85,
    food: 75,
    culture: 82,
    uniqueness: 68,
    transport_complexity: 25,
    crowd_level: 75,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [5, 6, 9, 10],
    tags: ["split", "croatia", "dalmatia"],
  },
  krakow: {
    avg_daily_cost_usd: 65,
    budget_level: 1,
    nature: 22,
    photography: 82,
    food: 72,
    culture: 88,
    uniqueness: 72,
    transport_complexity: 15,
    crowd_level: 70,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["krakow", "kraków", "poland", "malopolska"],
  },
  tallinn: {
    avg_daily_cost_usd: 70,
    budget_level: 2,
    nature: 35,
    photography: 85,
    food: 68,
    culture: 82,
    uniqueness: 80,
    transport_complexity: 15,
    crowd_level: 58,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [5, 6, 7, 8],
    tags: ["tallinn", "estonia", "baltics"],
  },
  // ── Alpine & mountain Europe ──────────────────────────────────────────────
  zermatt: {
    avg_daily_cost_usd: 250,
    budget_level: 5,
    nature: 99,
    photography: 99,
    food: 65,
    culture: 40,
    uniqueness: 80,
    transport_complexity: 35,
    crowd_level: 70,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [6, 7, 8, 12, 1, 2],
    tags: ["zermatt", "matterhorn", "switzerland", "alps", "valais"],
  },
  interlaken: {
    avg_daily_cost_usd: 180,
    budget_level: 5,
    nature: 95,
    photography: 92,
    food: 55,
    culture: 35,
    uniqueness: 70,
    transport_complexity: 30,
    crowd_level: 75,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [6, 7, 8, 9, 12],
    tags: ["interlaken", "bernese oberland", "switzerland", "alps", "jungfrau"],
  },
  grindelwald: {
    avg_daily_cost_usd: 190,
    budget_level: 5,
    nature: 97,
    photography: 96,
    food: 50,
    culture: 30,
    uniqueness: 75,
    transport_complexity: 28,
    crowd_level: 65,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [6, 7, 8, 9],
    tags: ["grindelwald", "jungfrau", "switzerland", "alps"],
  },
  chamonix: {
    avg_daily_cost_usd: 175,
    budget_level: 5,
    nature: 98,
    photography: 97,
    food: 68,
    culture: 42,
    uniqueness: 78,
    transport_complexity: 30,
    crowd_level: 72,
    ideal_stay_days: { min: 2, max: 5 },
    best_months: [6, 7, 8, 1, 2, 3],
    tags: ["chamonix", "mont blanc", "france", "alps", "haute-savoie"],
  },
  dolomites: {
    avg_daily_cost_usd: 140,
    budget_level: 4,
    nature: 99,
    photography: 99,
    food: 72,
    culture: 55,
    uniqueness: 88,
    transport_complexity: 45,
    crowd_level: 60,
    ideal_stay_days: { min: 3, max: 7 },
    best_months: [6, 7, 8, 9],
    tags: ["dolomites", "dolomiti", "alto adige", "south tyrol", "italy", "alps"],
  },
  hallstatt: {
    avg_daily_cost_usd: 130,
    budget_level: 3,
    nature: 88,
    photography: 97,
    food: 55,
    culture: 70,
    uniqueness: 72,
    transport_complexity: 35,
    crowd_level: 88,
    ideal_stay_days: { min: 1, max: 2 },
    best_months: [5, 6, 9, 10],
    tags: ["hallstatt", "salzkammergut", "austria", "alps"],
  },
  salzburg: {
    avg_daily_cost_usd: 130,
    budget_level: 3,
    nature: 55,
    photography: 85,
    food: 72,
    culture: 90,
    uniqueness: 58,
    transport_complexity: 18,
    crowd_level: 72,
    ideal_stay_days: { min: 1, max: 3 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["salzburg", "austria", "alps", "mozart"],
  },
  innsbruck: {
    avg_daily_cost_usd: 115,
    budget_level: 3,
    nature: 80,
    photography: 85,
    food: 68,
    culture: 75,
    uniqueness: 62,
    transport_complexity: 18,
    crowd_level: 55,
    ideal_stay_days: { min: 1, max: 3 },
    best_months: [6, 7, 8, 9, 12, 1],
    tags: ["innsbruck", "tyrol", "austria", "alps"],
  },
  // ── Italian lakes & coast ─────────────────────────────────────────────────
  "lake como": {
    avg_daily_cost_usd: 170,
    budget_level: 4,
    nature: 82,
    photography: 95,
    food: 78,
    culture: 68,
    uniqueness: 65,
    transport_complexity: 30,
    crowd_level: 78,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["lake como", "como", "lombardy", "italy", "northern italy"],
  },
  "amalfi coast": {
    avg_daily_cost_usd: 180,
    budget_level: 5,
    nature: 75,
    photography: 97,
    food: 82,
    culture: 75,
    uniqueness: 68,
    transport_complexity: 60,
    crowd_level: 85,
    ideal_stay_days: { min: 2, max: 5 },
    best_months: [5, 6, 9, 10],
    tags: ["amalfi", "amalfi coast", "positano", "ravello", "campania", "italy"],
  },
  "cinque terre": {
    avg_daily_cost_usd: 130,
    budget_level: 3,
    nature: 72,
    photography: 95,
    food: 75,
    culture: 62,
    uniqueness: 65,
    transport_complexity: 35,
    crowd_level: 90,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["cinque terre", "liguria", "italy"],
  },
  // ── Balkans & eastern med ─────────────────────────────────────────────────
  kotor: {
    avg_daily_cost_usd: 70,
    budget_level: 2,
    nature: 78,
    photography: 90,
    food: 65,
    culture: 75,
    uniqueness: 82,
    transport_complexity: 35,
    crowd_level: 68,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["kotor", "montenegro", "adriatic", "balkans"],
  },
  "lake bled": {
    avg_daily_cost_usd: 95,
    budget_level: 2,
    nature: 90,
    photography: 96,
    food: 60,
    culture: 55,
    uniqueness: 72,
    transport_complexity: 30,
    crowd_level: 78,
    ideal_stay_days: { min: 1, max: 2 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["bled", "lake bled", "slovenia"],
  },
  plitvice: {
    avg_daily_cost_usd: 80,
    budget_level: 2,
    nature: 95,
    photography: 95,
    food: 45,
    culture: 40,
    uniqueness: 80,
    transport_complexity: 40,
    crowd_level: 72,
    ideal_stay_days: { min: 1, max: 2 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["plitvice", "plitvice lakes", "croatia"],
  },
  sarajevo: {
    avg_daily_cost_usd: 55,
    budget_level: 1,
    nature: 40,
    photography: 80,
    food: 75,
    culture: 85,
    uniqueness: 88,
    transport_complexity: 35,
    crowd_level: 35,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["sarajevo", "bosnia", "balkans"],
  },
  // ── Scotland & UK ─────────────────────────────────────────────────────────
  "scottish highlands": {
    avg_daily_cost_usd: 120,
    budget_level: 3,
    nature: 97,
    photography: 95,
    food: 55,
    culture: 72,
    uniqueness: 85,
    transport_complexity: 55,
    crowd_level: 30,
    ideal_stay_days: { min: 4, max: 8 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["highlands", "scottish highlands", "scotland", "uk"],
  },
  "isle of skye": {
    avg_daily_cost_usd: 110,
    budget_level: 3,
    nature: 99,
    photography: 98,
    food: 52,
    culture: 65,
    uniqueness: 88,
    transport_complexity: 45,
    crowd_level: 45,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["isle of skye", "skye", "scotland", "uk"],
  },
  // ── Japan ─────────────────────────────────────────────────────────────────
  tokyo: {
    avg_daily_cost_usd: 130,
    budget_level: 3,
    nature: 25,
    photography: 90,
    food: 99,
    culture: 92,
    uniqueness: 92,
    transport_complexity: 50,
    crowd_level: 75,
    ideal_stay_days: { min: 4, max: 7 },
    best_months: [3, 4, 10, 11],
    tags: ["tokyo", "japan", "kanto"],
  },
  kyoto: {
    avg_daily_cost_usd: 115,
    budget_level: 3,
    nature: 55,
    photography: 96,
    food: 90,
    culture: 98,
    uniqueness: 88,
    transport_complexity: 35,
    crowd_level: 82,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [3, 4, 10, 11],
    tags: ["kyoto", "japan", "kansai"],
  },
  osaka: {
    avg_daily_cost_usd: 110,
    budget_level: 3,
    nature: 15,
    photography: 78,
    food: 96,
    culture: 80,
    uniqueness: 78,
    transport_complexity: 30,
    crowd_level: 70,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [3, 4, 5, 10, 11],
    tags: ["osaka", "japan", "kansai"],
  },
  // ── Southeast Asia ────────────────────────────────────────────────────────
  bali: {
    avg_daily_cost_usd: 75,
    budget_level: 2,
    nature: 85,
    photography: 90,
    food: 72,
    culture: 82,
    uniqueness: 65,
    transport_complexity: 45,
    crowd_level: 80,
    ideal_stay_days: { min: 5, max: 10 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["bali", "ubud", "indonesia", "southeast asia"],
  },
  "chiang mai": {
    avg_daily_cost_usd: 50,
    budget_level: 1,
    nature: 72,
    photography: 80,
    food: 88,
    culture: 85,
    uniqueness: 75,
    transport_complexity: 38,
    crowd_level: 60,
    ideal_stay_days: { min: 3, max: 7 },
    best_months: [11, 12, 1, 2, 3],
    tags: ["chiang mai", "thailand", "southeast asia", "northern thailand"],
  },
  "hoi an": {
    avg_daily_cost_usd: 40,
    budget_level: 1,
    nature: 52,
    photography: 90,
    food: 88,
    culture: 82,
    uniqueness: 80,
    transport_complexity: 25,
    crowd_level: 68,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [2, 3, 4, 7, 8],
    tags: ["hoi an", "vietnam", "southeast asia", "central vietnam"],
  },
  hanoi: {
    avg_daily_cost_usd: 45,
    budget_level: 1,
    nature: 30,
    photography: 82,
    food: 88,
    culture: 85,
    uniqueness: 78,
    transport_complexity: 40,
    crowd_level: 65,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [10, 11, 12, 3, 4],
    tags: ["hanoi", "vietnam", "southeast asia", "northern vietnam"],
  },
  "halong bay": {
    avg_daily_cost_usd: 80,
    budget_level: 2,
    nature: 95,
    photography: 97,
    food: 60,
    culture: 50,
    uniqueness: 88,
    transport_complexity: 50,
    crowd_level: 70,
    ideal_stay_days: { min: 1, max: 3 },
    best_months: [3, 4, 5, 9, 10, 11],
    tags: ["halong", "halong bay", "vietnam", "southeast asia"],
  },
  // ── Morocco ───────────────────────────────────────────────────────────────
  marrakech: {
    avg_daily_cost_usd: 70,
    budget_level: 2,
    nature: 25,
    photography: 88,
    food: 82,
    culture: 90,
    uniqueness: 88,
    transport_complexity: 50,
    crowd_level: 75,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [3, 4, 10, 11],
    tags: ["marrakech", "marrakesh", "morocco", "medina"],
  },
  fes: {
    avg_daily_cost_usd: 55,
    budget_level: 1,
    nature: 15,
    photography: 85,
    food: 80,
    culture: 92,
    uniqueness: 92,
    transport_complexity: 55,
    crowd_level: 55,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [3, 4, 10, 11],
    tags: ["fes", "fez", "morocco", "medina"],
  },
  // ── Americas ──────────────────────────────────────────────────────────────
  "new york": {
    avg_daily_cost_usd: 200,
    budget_level: 5,
    nature: 12,
    photography: 90,
    food: 95,
    culture: 95,
    uniqueness: 52,
    transport_complexity: 25,
    crowd_level: 80,
    ideal_stay_days: { min: 3, max: 7 },
    best_months: [4, 5, 6, 9, 10, 11],
    tags: ["new york", "nyc", "manhattan", "usa"],
  },
  "mexico city": {
    avg_daily_cost_usd: 70,
    budget_level: 2,
    nature: 18,
    photography: 80,
    food: 95,
    culture: 92,
    uniqueness: 82,
    transport_complexity: 50,
    crowd_level: 65,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [11, 12, 1, 2, 3, 4],
    tags: ["mexico city", "cdmx", "mexico", "df"],
  },
  oaxaca: {
    avg_daily_cost_usd: 55,
    budget_level: 1,
    nature: 45,
    photography: 85,
    food: 95,
    culture: 90,
    uniqueness: 90,
    transport_complexity: 35,
    crowd_level: 45,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [11, 12, 1, 2, 3, 4, 5],
    tags: ["oaxaca", "mexico"],
  },
  cartagena: {
    avg_daily_cost_usd: 75,
    budget_level: 2,
    nature: 42,
    photography: 88,
    food: 75,
    culture: 82,
    uniqueness: 80,
    transport_complexity: 30,
    crowd_level: 60,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [12, 1, 2, 3, 4],
    tags: ["cartagena", "colombia", "caribbean", "south america"],
  },
  cusco: {
    avg_daily_cost_usd: 65,
    budget_level: 2,
    nature: 78,
    photography: 88,
    food: 70,
    culture: 92,
    uniqueness: 88,
    transport_complexity: 45,
    crowd_level: 65,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["cusco", "cuzco", "peru", "south america", "andes", "machu picchu"],
  },
  // ── Southern Africa ───────────────────────────────────────────────────────
  "cape town": {
    avg_daily_cost_usd: 100,
    budget_level: 3,
    nature: 88,
    photography: 95,
    food: 80,
    culture: 72,
    uniqueness: 88,
    transport_complexity: 38,
    crowd_level: 55,
    ideal_stay_days: { min: 4, max: 7 },
    best_months: [11, 12, 1, 2, 3, 4],
    tags: ["cape town", "south africa", "southern africa"],
  },
  // ── Generic fallback entries for common vague inputs ──────────────────────
  switzerland: {
    avg_daily_cost_usd: 200,
    budget_level: 5,
    nature: 95,
    photography: 95,
    food: 65,
    culture: 70,
    uniqueness: 68,
    transport_complexity: 20,
    crowd_level: 55,
    ideal_stay_days: { min: 5, max: 10 },
    best_months: [6, 7, 8, 9, 12, 1],
    tags: ["switzerland", "swiss", "alps"],
  },
  portugal: {
    avg_daily_cost_usd: 95,
    budget_level: 2,
    nature: 50,
    photography: 85,
    food: 85,
    culture: 80,
    uniqueness: 68,
    transport_complexity: 25,
    crowd_level: 65,
    ideal_stay_days: { min: 7, max: 14 },
    best_months: [4, 5, 6, 9, 10],
    tags: ["portugal", "portuguese"],
  },
  scotland: {
    avg_daily_cost_usd: 120,
    budget_level: 3,
    nature: 92,
    photography: 90,
    food: 58,
    culture: 80,
    uniqueness: 80,
    transport_complexity: 40,
    crowd_level: 38,
    ideal_stay_days: { min: 5, max: 10 },
    best_months: [5, 6, 7, 8, 9],
    tags: ["scotland", "uk"],
  },
  japan: {
    avg_daily_cost_usd: 120,
    budget_level: 3,
    nature: 65,
    photography: 92,
    food: 97,
    culture: 95,
    uniqueness: 90,
    transport_complexity: 45,
    crowd_level: 70,
    ideal_stay_days: { min: 10, max: 21 },
    best_months: [3, 4, 10, 11],
    tags: ["japan", "japanese"],
  },
  italy: {
    avg_daily_cost_usd: 130,
    budget_level: 3,
    nature: 55,
    photography: 92,
    food: 95,
    culture: 97,
    uniqueness: 55,
    transport_complexity: 35,
    crowd_level: 80,
    ideal_stay_days: { min: 7, max: 14 },
    best_months: [4, 5, 9, 10],
    tags: ["italy", "italian"],
  },
  greece: {
    avg_daily_cost_usd: 90,
    budget_level: 2,
    nature: 60,
    photography: 88,
    food: 80,
    culture: 92,
    uniqueness: 60,
    transport_complexity: 40,
    crowd_level: 72,
    ideal_stay_days: { min: 7, max: 14 },
    best_months: [5, 6, 9, 10],
    tags: ["greece", "greek", "hellenic"],
  },
  norway: {
    avg_daily_cost_usd: 200,
    budget_level: 5,
    nature: 99,
    photography: 97,
    food: 60,
    culture: 72,
    uniqueness: 82,
    transport_complexity: 45,
    crowd_level: 30,
    ideal_stay_days: { min: 7, max: 14 },
    best_months: [6, 7, 8],
    tags: ["norway", "norwegian", "fjords", "scandinavia"],
  },
  morocco: {
    avg_daily_cost_usd: 65,
    budget_level: 2,
    nature: 55,
    photography: 88,
    food: 82,
    culture: 90,
    uniqueness: 88,
    transport_complexity: 50,
    crowd_level: 58,
    ideal_stay_days: { min: 7, max: 14 },
    best_months: [3, 4, 10, 11],
    tags: ["morocco", "moroccan", "north africa"],
  },
  antigua: {
    avg_daily_cost_usd: 75,
    budget_level: 2,
    nature: 52,
    photography: 86,
    food: 72,
    culture: 92,
    uniqueness: 86,
    transport_complexity: 28,
    crowd_level: 45,
    ideal_stay_days: { min: 2, max: 4 },
    best_months: [11, 12, 1, 2, 3, 4],
    tags: ["antigua", "antigua guatemala", "guatemala"],
  },
  "lake atitlan": {
    avg_daily_cost_usd: 55,
    budget_level: 1,
    nature: 94,
    photography: 95,
    food: 68,
    culture: 88,
    uniqueness: 92,
    transport_complexity: 58,
    crowd_level: 42,
    ideal_stay_days: { min: 3, max: 5 },
    best_months: [11, 12, 1, 2, 3, 4],
    tags: ["lake atitlan", "atitlan", "guatemala", "solola"],
  },
  "guatemala city": {
    avg_daily_cost_usd: 65,
    budget_level: 2,
    nature: 35,
    photography: 72,
    food: 78,
    culture: 75,
    uniqueness: 70,
    transport_complexity: 62,
    crowd_level: 48,
    ideal_stay_days: { min: 1, max: 2 },
    best_months: [11, 12, 1, 2, 3, 4],
    tags: ["guatemala city", "ciudad de guatemala", "guatemala"],
  },
  flores: {
    avg_daily_cost_usd: 55,
    budget_level: 1,
    nature: 82,
    photography: 84,
    food: 62,
    culture: 82,
    uniqueness: 88,
    transport_complexity: 48,
    crowd_level: 35,
    ideal_stay_days: { min: 2, max: 3 },
    best_months: [11, 12, 1, 2, 3, 4],
    tags: ["flores", "peten", "guatemala", "tikal"],
  },
  tikal: {
    avg_daily_cost_usd: 60,
    budget_level: 1,
    nature: 90,
    photography: 93,
    food: 40,
    culture: 98,
    uniqueness: 96,
    transport_complexity: 52,
    crowd_level: 35,
    ideal_stay_days: { min: 1, max: 2 },
    best_months: [11, 12, 1, 2, 3, 4],
    tags: ["tikal", "maya", "peten", "guatemala"],
  },
};

export function getDestinationCatalogMatch(
  query: string,
  candidate: {
    city?: string;
    state?: string;
    country?: string;
  },
): number {
  const q = query.toLowerCase().trim();
  const city = candidate.city?.toLowerCase().trim() ?? "";
  const state = candidate.state?.toLowerCase().trim() ?? "";
  const country = candidate.country?.toLowerCase().trim() ?? "";

  let bestScore = 0;

  for (const [name, attrs] of Object.entries(DESTINATIONS)) {
    const cityMatches =
      city === name ||
      name.startsWith(q) ||
      attrs.tags.some(
        (tag) =>
          tag === city ||
          (q.length >= 3 && tag.startsWith(q) && city === name)
      );

    if (!cityMatches) continue;

    let score = 100;

    // Exact canonical destination search.
    if (q === name) {
      score += 100;
    }

    // Alias search: "firenze" → Florence.
    if (attrs.tags.includes(q)) {
      score += 80;
    }

    // Reward candidates whose region/country agrees with the catalog.
    if (attrs.tags.includes(state)) {
      score += 40;
    }

    if (attrs.tags.includes(country)) {
      score += 40;
    }

    // More-specific user input should still matter.
    if (state && q.includes(state)) {
      score += 60;
    }

    if (country && q.includes(country)) {
      score += 60;
    }

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

/**
 * Look up destination attributes by name.
 * Tries exact match first, then tag substring matching.
 * Returns undefined when not in the catalog (AI fallback applies).
 */
export function lookupDestination(name: string): DestinationAttributes | undefined {
  const q = name.toLowerCase().trim();

  // Exact key match
  if (DESTINATIONS[q]) return DESTINATIONS[q];

  // Substring key match (q contains key or key contains q)
  for (const [key, attrs] of Object.entries(DESTINATIONS)) {
    if (q.includes(key) || key.includes(q)) return attrs;
  }

  // Tag match
  for (const attrs of Object.values(DESTINATIONS)) {
    if (attrs.tags.some((tag) => q.includes(tag) || tag.includes(q))) {
      return attrs;
    }
  }

  return undefined;
}

/**
 * Return a human-readable summary of a destination's attributes.
 * Used as context injected into AI prompts.
 */
export function destinationSummary(name: string, attrs: DestinationAttributes): string {
  const month = new Date().getMonth() + 1;
  const inSeason = attrs.best_months.includes(month);
  const crowdLabel = attrs.crowd_level >= 80 ? "HIGH" : attrs.crowd_level >= 55 ? "MODERATE" : "LOW";
  return [
    `${name}: ~$${attrs.avg_daily_cost_usd}/day`,
    `Nature ${attrs.nature}/100`,
    `Photography ${attrs.photography}/100`,
    `Food ${attrs.food}/100`,
    `Culture ${attrs.culture}/100`,
    `Uniqueness ${attrs.uniqueness}/100`,
    `Crowds: ${crowdLabel}`,
    `Ideal stay: ${attrs.ideal_stay_days.min}–${attrs.ideal_stay_days.max} nights`,
    inSeason ? "✓ In season" : "⚠ Off-peak season",
  ].join(" | ");
}

export interface RouteCandidate {
  name: string;
  country: string;
}

const ROUTE_EXPANSIONS: Record<string, RouteCandidate[]> = {
  guatemala: [
    { name: "Antigua", country: "Guatemala" },
    { name: "Lake Atitlán", country: "Guatemala" },
    { name: "Flores / Tikal", country: "Guatemala" },
    { name: "Guatemala City", country: "Guatemala" },
  ],
  italy: [
    { name: "Milan", country: "Italy" },
    { name: "Lake Como", country: "Italy" },
    { name: "Florence", country: "Italy" },
    { name: "Venice", country: "Italy" },
  ],
  switzerland: [
    { name: "Zermatt", country: "Switzerland" },
    { name: "Interlaken", country: "Switzerland" },
    { name: "Grindelwald", country: "Switzerland" },
    { name: "Lucerne", country: "Switzerland" },
  ],
  scotland: [
    { name: "Edinburgh", country: "Scotland" },
    { name: "Scottish Highlands", country: "Scotland" },
    { name: "Isle of Skye", country: "Scotland" },
  ],
  portugal: [
    { name: "Lisbon", country: "Portugal" },
    { name: "Porto", country: "Portugal" },
    { name: "Algarve", country: "Portugal" },
  ],
  japan: [
    { name: "Tokyo", country: "Japan" },
    { name: "Kyoto", country: "Japan" },
    { name: "Osaka", country: "Japan" },
  ],
};

function canonicalKey(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Returns the complete curated candidate pool for a destination request.
 * Selection and ordering happen in the decision engine, not by catalog order.
 */
export function getRouteCandidatePool(destinationInput: string): RouteCandidate[] {
  const chunks = destinationInput
    .split(/[,/&+]+|\s+and\s+/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const expanded: RouteCandidate[] = [];

  for (const chunk of chunks) {
    const key = canonicalKey(chunk);
    const expansion = Object.entries(ROUTE_EXPANSIONS).find(
      ([country]) => key === country || key.includes(country) || country.includes(key)
    )?.[1];

    if (expansion) {
      expanded.push(...expansion);
      continue;
    }

    const existing = Object.keys(DESTINATIONS).find(
      (name) => name === key || name.includes(key) || key.includes(name)
    );
    expanded.push({ name: existing ? titleCase(existing) : chunk, country: inferCountry(chunk) });
  }

  const unique = expanded.filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.name.toLowerCase() === candidate.name.toLowerCase()) === index
  );

  return unique.length > 0 ? unique : [{ name: destinationInput.trim(), country: inferCountry(destinationInput) }];
}

/**
 * Compatibility helper for itinerary normalization and modification flows.
 * New analysis and generation use the scored selection path instead.
 */
export function resolveRouteCandidates(
  destinationInput: string,
  totalDays: number
): RouteCandidate[] {
  const maxStops = totalDays >= 12 ? 4 : totalDays >= 8 ? 3 : totalDays >= 5 ? 2 : 1;
  return getRouteCandidatePool(destinationInput).slice(0, maxStops);
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferCountry(value: string): string {
  const attrs = lookupDestination(value);
  const tag = attrs?.tags.find((item) => /italy|switzerland|guatemala|scotland|portugal|japan|france|spain|austria|croatia|morocco|vietnam|thailand|indonesia|peru|mexico|colombia|norway|germany|poland|greece/i.test(item));
  return tag ? titleCase(tag) : "";
}
