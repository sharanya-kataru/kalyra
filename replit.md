# Kalyra Travel Optimizer

Kalyra is a personalized travel decision-making platform that helps independent travelers optimize limited vacation time, money, and experiences.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/travel-optimizer/src/App.tsx` — interactive prototype flow and route-level UI
- `artifacts/travel-optimizer/src/index.css` — Kalyra visual language and theme tokens
- `artifacts/travel-optimizer/src/data/` — milestone-one mock trip data
- `artifacts/api-server/src/routes/` — shared FastAPI-oriented API boundary placeholder (currently Express scaffold)
- `lib/api-spec/openapi.yaml` — source of truth for future typed trip-generation endpoints
- `lib/db/src/schema/` — source of truth for future trip and itinerary persistence

## Architecture decisions

- The first milestone is frontend-first with mock data so the core decision-making experience can be evaluated before external AI and persistence are introduced.
- The product flow is intentionally split into questionnaire, analysis, and generated trip dashboard states so recommendation reasoning is visible before the itinerary is accepted.
- The UI uses a dedicated travel domain model for preferences, rankings, route segments, daily plans, budgets, and checklist items; this maps directly to the planned structured AI response.
- Kalyra is a decision-support product, not a booking marketplace; booking actions are represented only as a preparation checklist.

## Product

- Landing page communicates the promise and shows an example of a considered route.
- Questionnaire captures destination context, budget intent, interests, pace, and travel constraints.
- Analysis screen explains the recommended strategy and ranks destinations by experience match.
- Trip dashboard visualizes route flow, destination tradeoffs, daily plans, budget allocation, and preparation tasks.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Keep `lib/api-spec/openapi.yaml` as the contract source of truth when backend endpoints are added, then run codegen before consuming new client types.
- Keep the current visual language consistent: deep fjord teal, limestone parchment, alpine sage, saffron accents, DM Sans, Fraunces, and DM Mono.
- The app is served at the artifact root path and its managed workflow supplies `PORT` and `BASE_PATH`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
