---
name: Roamwise product direction
description: Core product decisions and architecture for the Roamwise travel optimizer
---

## Product principle
Optimize for Experience Value, not cheapest/fastest/most popular. AI should respectfully challenge user assumptions when a destination mismatches their stated interests.

## Architecture
- Frontend: React + Vite + Wouter at `/` (artifact: travel-optimizer)
- Backend: Express 5 API server at `/api`
- DB: PostgreSQL via Drizzle ORM — tables: trips, itineraries, trip_modifications
- AI: OpenAI SDK (gpt-4o-mini) — activated when `OPENAI_API_KEY` env var is present; deterministic input-derived fallback when absent
- State: TripContext holds planData, tripId, analysis, itinerary — flows across /plan → /analysis → /trip

## Data flow
1. /plan (questionnaire) → POST /api/trips → stores tripId in context
2. /analysis (mount) → POST /api/trips/:id/analyze → destination scoring + strategy
3. /analysis "Generate" → POST /api/trips/:id/generate → full itinerary saved to DB
4. /trip chat → POST /api/trips/:id/modify → new itinerary version saved, modification record stored

## AI response schema
All AI calls return structured JSON: `{ trip_strategy, route[], destinations[], daily_schedule[], budget_breakdown[], reasoning, tradeoffs[] }`. Modification adds `changes_made[]`.

## Key files
- AI service: `artifacts/api-server/src/lib/ai.ts` — analyzeTrip / generateItinerary / modifyItinerary with OpenAI + deterministic fallbacks
- Routes: `artifacts/api-server/src/routes/trips/index.ts`
- Context: `artifacts/travel-optimizer/src/context/TripContext.tsx`
- Pages: `src/pages/landing.tsx`, `plan.tsx`, `analysis.tsx`, `trip.tsx`

## Why deterministic fallback
User declined Replit AI Integrations upgrade and did not provide OPENAI_API_KEY. App must demo end-to-end without AI. Fallbacks are derived from real user input (destination, interests, budget) — not generic hardcoded data.

## OpenAI integration pattern
`hasAI()` checks for `OPENAI_API_KEY` at runtime. Adding the key activates real AI with no code changes needed.
