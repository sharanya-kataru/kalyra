/**
 * Shared trip invariants.
 *
 * Date arithmetic and budget arithmetic live here so neither the LLM nor
 * individual route handlers can silently produce inconsistent totals.
 */

export interface TripDuration {
  start_date: string;
  end_date: string;
  total_days: number;
  total_nights: number;
}

export interface BudgetSummary {
  currency: "USD";
  total_budget: number;
  flights_estimated: number;
  accommodation_estimated: number;
  transportation_estimated: number;
  food_estimated: number;
  activities_estimated: number;
  total_estimated: number;
  remaining_budget: number;
  estimates_only: boolean;
}

const MS_PER_DAY = 86_400_000;

function isoDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function parseNaturalDate(value: string, fallbackYear?: number): string | null {
  const direct = isoDate(value);
  if (direct) return direct;

  const normalized = value
    .trim()
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const match = normalized.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/
  );
  if (!match) return null;

  const month = MONTHS[match[2]];
  const year = Number(match[3] ?? fallbackYear);
  if (!month || !year) return null;
  return isoDate(`${year}-${month}-${Number(match[1])}`);
}

/**
 * Handles the formats exposed by the current questionnaire:
 * - 2026-09-01 to 2026-09-10
 * - September 1 to September 10, 2026
 * - 18–29 September 2025
 */
export function parseTripDuration(startInput: string, endInput: string): TripDuration {
  let start = parseNaturalDate(startInput);
  let end = parseNaturalDate(endInput);

  if (!start || !end) {
    const combined = `${startInput} ${endInput}`.trim();
    const parts = combined.split(/\s+(?:to|until|through)\s+|[–—]/i);
    if (parts.length >= 2) {
      const yearMatch = combined.match(/\b(20\d{2})\b/);
      const year = yearMatch ? Number(yearMatch[1]) : undefined;
      start = parseNaturalDate(parts[0], year);
      end = parseNaturalDate(parts[1], year);
    }
  }

  if (!start || !end) {
    throw new Error("Dates must be valid ISO dates or a format like September 1 to September 10, 2026.");
  }

  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const totalNights = Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY);

  if (totalNights < 1 || totalNights > 120) {
    throw new Error("Trip duration must be between 2 and 121 calendar days.");
  }

  return {
    start_date: start,
    end_date: end,
    total_days: totalNights + 1,
    total_nights: totalNights,
  };
}

export function daysBetween(start: string, end: string): number {
  return parseTripDuration(start, end).total_days;
}

export function addDays(dateString: string, amount: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function finiteNonNegative(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

/**
 * Normalizes category estimates and performs all total arithmetic in code.
 * Flight and hotel data remain estimates until a live provider is added.
 */
export function calculateBudgetSummary(
  totalBudget: number,
  breakdown: Array<{ category: string; estimated_amount: number }>
): BudgetSummary {
  const safeBudget = finiteNonNegative(totalBudget);
  const find = (names: string[]) =>
    breakdown
      .filter((item) => names.some((name) => item.category.toLowerCase().includes(name)))
      .reduce((sum, item) => sum + finiteNonNegative(item.estimated_amount), 0);

  const flights = find(["flight", "air"]);
  const accommodation = find(["accommodation", "hotel", "lodging"]);
  const transportation = find(["transport", "transfer"]);
  const food = find(["food", "meal", "dining"]);
  const activities = find(["activit", "experience", "entrance"]);
  const totalEstimated = [flights, accommodation, transportation, food, activities].reduce(
    (sum, value) => sum + value,
    0
  );

  return {
    currency: "USD",
    total_budget: Math.round(safeBudget),
    flights_estimated: Math.round(flights),
    accommodation_estimated: Math.round(accommodation),
    transportation_estimated: Math.round(transportation),
    food_estimated: Math.round(food),
    activities_estimated: Math.round(activities),
    total_estimated: Math.round(totalEstimated),
    remaining_budget: Math.round(safeBudget - totalEstimated),
    estimates_only: true,
  };
}

export function sanitizeAmount(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}
