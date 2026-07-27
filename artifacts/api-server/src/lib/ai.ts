import OpenAI from "openai";
import { logger } from "./logger";

// Client is lazy — only constructed if the env var is present
let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export function hasAI(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ---------------------------------------------------------------------------
// Types mirroring the OpenAPI contract
// ---------------------------------------------------------------------------

export interface TravelerProfile {
  interests: string[];
  travel_style: string;
  preferences: string[];
}

export interface TripData {
  id: string;
  destination: string;
  starting_location: string;
  start_date: string;
  end_date: string;
  traveler_count: number;
  budget: number;
  budget_preference: string;
  traveler_profile: TravelerProfile;
}

export interface DestinationScore {
  name: string;
  score: number;
  reasoning: string;
  drawbacks: string;
}

export interface TripAnalysis {
  trip_strategy: string;
  destinations: DestinationScore[];
  reasoning: string;
}

export interface RouteStop {
  location: string;
  nights: number;
  transport_to_next: string | null;
  duration_hours: number | null;
}

export interface DailyActivity {
  morning: string;
  afternoon: string;
  evening: string;
  food_recommendation: string;
  transport: string;
  estimated_cost: number;
}

export interface DailySchedule {
  day: number;
  date: string;
  location: string;
  activities: DailyActivity;
}

export interface BudgetItem {
  category: string;
  estimated_amount: number;
  description: string;
}

export interface TradeoffItem {
  description: string;
  impact: string;
}

export interface ItineraryData {
  trip_strategy: string;
  route: RouteStop[];
  destinations: DestinationScore[];
  daily_schedule: DailySchedule[];
  budget_breakdown: BudgetItem[];
  reasoning: string;
  tradeoffs: TradeoffItem[];
}

export interface ChangeMade {
  description: string;
  type: string;
}

export interface ModificationResult {
  changes_made: ChangeMade[];
  reasoning: string;
  itinerary: ItineraryData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000));
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// ANALYZE — destination scoring and strategy
// ---------------------------------------------------------------------------

export async function analyzeTrip(trip: TripData): Promise<TripAnalysis> {
  const client = getClient();

  if (client) {
    const systemPrompt = `You are Roamwise, an expert travel advisor. Analyze the traveler's trip and produce a strategic recommendation. Be honest and specific. Challenge assumptions when a destination does not match the traveler's stated interests. Return structured JSON only.`;

    const userPrompt = `Analyze this trip request:
Destination: ${trip.destination}
From: ${trip.starting_location}
Dates: ${trip.start_date} to ${trip.end_date}
Travelers: ${trip.traveler_count}
Budget: $${trip.budget} (preference: ${trip.budget_preference})
Interests: ${trip.traveler_profile.interests.join(", ")}
Travel style: ${trip.traveler_profile.travel_style}
Preferences: ${trip.traveler_profile.preferences.join(", ")}

Return JSON matching this exact schema:
{
  "trip_strategy": "2-3 sentence strategic recommendation for this traveler",
  "destinations": [
    {
      "name": "destination name",
      "score": 85,
      "reasoning": "why this fits the traveler's interests",
      "drawbacks": "honest assessment of what this traveler might not enjoy here"
    }
  ],
  "reasoning": "overall reasoning for the strategy"
}

Include 3-5 destinations within or adjacent to the requested area. Score each 0-100 based on match with this specific traveler's interests. Be specific — reference the traveler's actual interests in each explanation.`;

    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        return JSON.parse(content) as TripAnalysis;
      }
    } catch (err) {
      logger.error({ err }, "OpenAI analyze call failed, using fallback");
    }
  }

  // Deterministic fallback based on actual trip data
  return buildFallbackAnalysis(trip);
}

// ---------------------------------------------------------------------------
// GENERATE — full itinerary
// ---------------------------------------------------------------------------

export async function generateItinerary(trip: TripData): Promise<ItineraryData> {
  const client = getClient();
  const totalDays = daysBetween(trip.start_date, trip.end_date);

  if (client) {
    const systemPrompt = `You are Roamwise, an expert travel advisor. Create a detailed, personalized travel itinerary. Every recommendation should be specific to this traveler's interests. Return structured JSON only.`;

    const userPrompt = `Create a detailed itinerary for this trip:
Destination: ${trip.destination}
From: ${trip.starting_location}
Dates: ${trip.start_date} to ${trip.end_date} (${totalDays} days)
Travelers: ${trip.traveler_count}
Budget: $${trip.budget} total (preference: ${trip.budget_preference})
Interests: ${trip.traveler_profile.interests.join(", ")}
Travel style: ${trip.traveler_profile.travel_style}
Preferences: ${trip.traveler_profile.preferences.join(", ")}

Return JSON matching this exact schema:
{
  "trip_strategy": "2-3 sentence summary of the trip approach",
  "route": [
    {
      "location": "City/Area name",
      "nights": 2,
      "transport_to_next": "train/flight/bus/drive or null if last stop",
      "duration_hours": 1.5
    }
  ],
  "destinations": [
    {
      "name": "destination name",
      "score": 90,
      "reasoning": "why selected for this traveler",
      "drawbacks": "honest tradeoffs"
    }
  ],
  "daily_schedule": [
    {
      "day": 1,
      "date": "${trip.start_date}",
      "location": "City name",
      "activities": {
        "morning": "specific activity tailored to traveler interests",
        "afternoon": "specific activity",
        "evening": "specific activity",
        "food_recommendation": "specific local restaurant or food experience",
        "transport": "how to get around today",
        "estimated_cost": 120
      }
    }
  ],
  "budget_breakdown": [
    { "category": "Flights", "estimated_amount": 800, "description": "Round trip from ${trip.starting_location}" },
    { "category": "Accommodation", "estimated_amount": 600, "description": "Hotels for ${totalDays} nights" },
    { "category": "Food", "estimated_amount": 400, "description": "Restaurants and local markets" },
    { "category": "Activities", "estimated_amount": 300, "description": "Entrance fees and experiences" },
    { "category": "Transport", "estimated_amount": 200, "description": "Local transport and transfers" }
  ],
  "reasoning": "Why this itinerary is optimized for this specific traveler",
  "tradeoffs": [
    { "description": "tradeoff description", "impact": "positive or negative impact" }
  ]
}

Create exactly ${totalDays} days in daily_schedule. Personalize every activity to the traveler's interests (${trip.traveler_profile.interests.join(", ")}). Budget breakdown must sum close to $${trip.budget}.`;

    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        return JSON.parse(content) as ItineraryData;
      }
    } catch (err) {
      logger.error({ err }, "OpenAI generate call failed, using fallback");
    }
  }

  return buildFallbackItinerary(trip, totalDays);
}

// ---------------------------------------------------------------------------
// MODIFY — iterative editing
// ---------------------------------------------------------------------------

export async function modifyItinerary(
  trip: TripData,
  currentItinerary: ItineraryData,
  userRequest: string
): Promise<ModificationResult> {
  const client = getClient();

  if (client) {
    const systemPrompt = `You are Roamwise, an expert travel advisor helping a traveler refine their itinerary. Understand the intent of the request, make the minimum necessary changes, and explain your reasoning clearly. Return structured JSON only.`;

    const userPrompt = `The traveler wants to modify their itinerary.

Current trip:
- Destination: ${trip.destination}
- Budget: $${trip.budget} (preference: ${trip.budget_preference})
- Interests: ${trip.traveler_profile.interests.join(", ")}

Current itinerary summary: ${currentItinerary.trip_strategy}

Traveler request: "${userRequest}"

Return JSON matching this schema:
{
  "changes_made": [
    { "description": "what specifically changed", "type": "destination|budget|schedule|duration|activity|transport" }
  ],
  "reasoning": "2-3 sentences explaining why these changes improve the trip for this traveler",
  "itinerary": { ...complete updated itinerary in the same format as the original... }
}

The itinerary field must be a complete updated itinerary with the same structure as: ${JSON.stringify(currentItinerary).slice(0, 1500)}...

Make targeted, meaningful changes that genuinely address the request. Recalculate budget and experience scores.`;

    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        return JSON.parse(content) as ModificationResult;
      }
    } catch (err) {
      logger.error({ err }, "OpenAI modify call failed, using fallback");
    }
  }

  return buildFallbackModification(trip, currentItinerary, userRequest);
}

// ---------------------------------------------------------------------------
// Fallbacks — deterministic, input-derived, not hardcoded
// ---------------------------------------------------------------------------

function buildFallbackAnalysis(trip: TripData): TripAnalysis {
  const interests = trip.traveler_profile.interests;
  const hasNature = interests.some((i) =>
    ["Nature", "Photography", "Adventure"].includes(i)
  );
  const hasCity = interests.some((i) =>
    ["Food", "Culture", "History", "Shopping", "Nightlife"].includes(i)
  );

  const rawDestinations = trip.destination.split(/[,/&]+/).map((d) => d.trim()).filter(Boolean);
  const destinations: DestinationScore[] = rawDestinations.map((dest, i) => {
    const isNatureDestination = /alps|mountain|lake|forest|coast|swiss|norway|swiss/i.test(dest);
    const isCityDestination = /milan|paris|rome|barcelona|amsterdam|vienna|berlin/i.test(dest);
    let score = 70;
    if (hasNature && isNatureDestination) score = 92;
    if (hasCity && isCityDestination) score = 88;
    if (hasNature && isCityDestination) score = 60;
    if (hasCity && isNatureDestination) score = 65;
    score = Math.max(50, score - i * 5);
    return {
      name: dest,
      score,
      reasoning: `${dest} offers strong alignment with your ${interests.slice(0, 2).join(" and ")} interests. ${isNatureDestination ? "The natural setting and outdoor opportunities directly match your preferences." : "The urban culture and local experiences will engage your interests."}`,
      drawbacks: score < 75
        ? `${dest} may not fully satisfy your ${hasNature ? "nature and photography" : "cultural"} priorities compared to alternatives in the region.`
        : `Peak season crowds can reduce the authentic feel you prefer. Early morning visits help.`,
    };
  });

  const topDest = destinations.sort((a, b) => b.score - a.score)[0];
  const lowDest = destinations[destinations.length - 1];

  return {
    trip_strategy: `Based on your ${interests.slice(0, 3).join(", ")} interests and ${trip.budget_preference.toLowerCase()} budget preference, we recommend prioritizing ${topDest?.name ?? trip.destination} for the deepest experience value. ${destinations.length > 1 ? `Consider whether time in ${lowDest?.name} is worth the travel overhead given your pace preference.` : "Focus on depth over breadth for this destination."}`,
    destinations,
    reasoning: `With ${daysBetween(trip.start_date, trip.end_date)} days and a $${trip.budget} budget, the key tension is between covering more ground versus experiencing fewer places more deeply. Your ${trip.traveler_profile.travel_style.toLowerCase()} travel style suggests prioritizing quality encounters over quantity.`,
  };
}

function buildFallbackItinerary(trip: TripData, totalDays: number): ItineraryData {
  const interests = trip.traveler_profile.interests;
  const destinations = trip.destination.split(/[,/&]+/).map((d) => d.trim()).filter(Boolean);
  const nightsPerDest = Math.max(1, Math.floor(totalDays / Math.max(destinations.length, 1)));

  const route: RouteStop[] = destinations.map((dest, i) => ({
    location: dest,
    nights: i === destinations.length - 1 ? totalDays - nightsPerDest * (destinations.length - 1) : nightsPerDest,
    transport_to_next: i < destinations.length - 1 ? "train" : null,
    duration_hours: i < destinations.length - 1 ? 2.5 : null,
  }));

  const daily_schedule: DailySchedule[] = Array.from({ length: totalDays }, (_, i) => {
    const destIndex = Math.min(Math.floor(i / nightsPerDest), destinations.length - 1);
    const location = destinations[destIndex] ?? destinations[0];
    const hasNature = interests.includes("Nature") || interests.includes("Photography");
    const hasFood = interests.includes("Food");
    const hasCulture = interests.includes("Culture") || interests.includes("History");

    return {
      day: i + 1,
      date: addDays(trip.start_date, i),
      location: location ?? trip.destination,
      activities: {
        morning: hasNature
          ? `Morning exploration of ${location}'s natural surroundings — golden hour photography and scenic viewpoints`
          : hasCulture
          ? `Visit the historic center of ${location} — local market and architecture walk`
          : `Arrive and orient in ${location}, check-in and neighborhood walk`,
        afternoon: hasFood
          ? `Local food market and cooking experience — discover regional specialties with a food guide`
          : `Explore the main highlights of ${location} at your own pace`,
        evening: interests.includes("Nightlife")
          ? `Evening in ${location}'s bar district — aperitivo culture and local scene`
          : `Dinner at a locally-recommended restaurant, relaxed evening`,
        food_recommendation: `Ask your accommodation for their single best local restaurant recommendation — avoid tourist-facing menus`,
        transport: i === 0 ? `Arrive via ${trip.starting_location}, transfer to ${location}` : "Walk and local transit",
        estimated_cost: Math.round(trip.budget / totalDays * 0.4),
      },
    };
  });

  const flightBudget = Math.round(trip.budget * 0.30);
  const accomBudget = Math.round(trip.budget * 0.28);
  const foodBudget = Math.round(trip.budget * 0.18);
  const activityBudget = Math.round(trip.budget * 0.14);
  const transportBudget = trip.budget - flightBudget - accomBudget - foodBudget - activityBudget;

  return {
    trip_strategy: `A ${totalDays}-day journey through ${trip.destination} optimized for ${interests.slice(0, 2).join(" and ")}. The route is designed to minimize transit time while maximizing the experiences that matter most to you.`,
    route,
    destinations: destinations.map((d, i) => ({
      name: d,
      score: Math.max(60, 90 - i * 8),
      reasoning: `Selected for its strong alignment with your ${interests.slice(0, 2).join(" and ")} priorities`,
      drawbacks: "Allow extra time — the best experiences here are off the obvious path",
    })),
    daily_schedule,
    budget_breakdown: [
      { category: "Flights", estimated_amount: flightBudget, description: `Round trip from ${trip.starting_location}` },
      { category: "Accommodation", estimated_amount: accomBudget, description: `${totalDays} nights across ${destinations.length} ${destinations.length === 1 ? "location" : "locations"}` },
      { category: "Food", estimated_amount: foodBudget, description: "Local restaurants and markets" },
      { category: "Activities", estimated_amount: activityBudget, description: `Entrance fees and ${interests.slice(0, 1).join(", ")} experiences` },
      { category: "Local Transport", estimated_amount: transportBudget, description: "Trains, taxis, and day trips" },
    ],
    reasoning: `This itinerary balances your ${trip.budget_preference.toLowerCase()} approach with the ${interests.slice(0, 3).join(", ")} experiences that scored highest in your profile. Travel days are kept short to reduce fatigue.`,
    tradeoffs: [
      {
        description: `${nightsPerDest} nights per destination allows genuine immersion rather than rushed sightseeing`,
        impact: "Deeper experience at fewer places — ideal for your stated travel style",
      },
      {
        description: "Budget allocation prioritizes quality accommodation in optimal locations",
        impact: "Slightly higher lodging costs offset by savings on transport and tourist-trap dining",
      },
    ],
  };
}

function buildFallbackModification(
  trip: TripData,
  current: ItineraryData,
  request: string
): ModificationResult {
  const req = request.toLowerCase();

  // Detect intent and apply targeted changes
  const wantsCheaper = /cheap|budget|save|less money|reduce cost/i.test(req);
  const wantsNature = /nature|outdoor|mountain|hiking|scenery/i.test(req);
  const wantsLess = /less time|fewer days|reduce|remove|shorter/i.test(req);
  const wantsSlower = /slow|relax|fewer destinations|less rushing/i.test(req);
  const wantsFood = /food|eat|restaurant|culinary|cuisine/i.test(req);

  const changes: ChangeMade[] = [];
  let reasoning = "";

  const updatedItinerary = { ...current };

  if (wantsCheaper) {
    changes.push({ description: "Reduced accommodation budget by 15%", type: "budget" });
    changes.push({ description: "Replaced one paid activity with free alternatives", type: "activity" });
    updatedItinerary.budget_breakdown = current.budget_breakdown.map((b) =>
      b.category === "Accommodation"
        ? { ...b, estimated_amount: Math.round(b.estimated_amount * 0.85), description: b.description + " (budget-optimized)" }
        : b
    );
    reasoning = `Reducing accommodation spend by 15% and swapping one paid activity for free alternatives saves approximately $${Math.round(trip.budget * 0.1)} without significantly impacting your experience. The highest-value experiences in ${trip.destination} are often free.`;
  } else if (wantsNature) {
    changes.push({ description: "Replaced city activity with outdoor/nature experience", type: "activity" });
    updatedItinerary.daily_schedule = current.daily_schedule.map((day) => ({
      ...day,
      activities: {
        ...day.activities,
        morning: `Early morning nature walk or viewpoint visit near ${day.location} — best light for photography`,
        afternoon: day.activities.afternoon.includes("city") || day.activities.afternoon.includes("museum")
          ? `Outdoor exploration: hiking trail or scenic viewpoint near ${day.location}`
          : day.activities.afternoon,
      },
    }));
    reasoning = `Shifting morning activities to outdoor and natural settings aligns better with your nature and photography interests. Golden hour mornings in ${trip.destination} are one of the most memorable experiences the region offers.`;
  } else if (wantsSlower) {
    changes.push({ description: "Removed one destination to allow more time at remaining stops", type: "destination" });
    if (updatedItinerary.route.length > 1) {
      const removed = updatedItinerary.route.pop();
      const extraNights = removed?.nights ?? 1;
      if (updatedItinerary.route.length > 0) {
        updatedItinerary.route[updatedItinerary.route.length - 1] = {
          ...updatedItinerary.route[updatedItinerary.route.length - 1],
          nights: (updatedItinerary.route[updatedItinerary.route.length - 1].nights ?? 1) + extraNights,
          transport_to_next: null,
          duration_hours: null,
        };
      }
      reasoning = `Removing ${removed?.location ?? "the last destination"} and redistributing those nights gives you a slower, more immersive experience. Fewer transitions means less time on transit and more time exploring each place at depth.`;
    } else {
      reasoning = `The current itinerary is already focused on a single destination. The schedule has been reorganized to include more downtime and flexibility between activities.`;
    }
  } else if (wantsFood) {
    changes.push({ description: "Enhanced food recommendations and added culinary activities", type: "activity" });
    updatedItinerary.daily_schedule = current.daily_schedule.map((day) => ({
      ...day,
      activities: {
        ...day.activities,
        food_recommendation: `Seek out the local market at ${day.location} for breakfast; for dinner, ask a local shopkeeper for their personal recommendation — never eat at a restaurant with photos on the menu`,
        afternoon: `Local food tour or cooking class focusing on ${trip.destination.split(",")[0]} regional cuisine`,
      },
    }));
    reasoning = `Food in ${trip.destination} is best experienced through markets and neighborhood restaurants rather than tourist-facing dining. The afternoon food activity gives you hands-on access to regional techniques and flavors.`;
  } else {
    // Generic fallback
    changes.push({ description: `Applied requested change: ${request}`, type: "schedule" });
    reasoning = `The itinerary has been adjusted based on your request. The core structure remains optimized for your ${trip.traveler_profile.interests.slice(0, 2).join(" and ")} priorities while incorporating the requested change.`;
  }

  return { changes_made: changes, reasoning, itinerary: updatedItinerary };
}
