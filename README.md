# Kalyra

### A better way to find your way.

Kalyra is a decision-focused travel planning platform that helps travelers design better trips by optimizing **time, budget, and experiences**.

Traditional travel platforms are excellent at helping people find flights, hotels, attractions, and restaurants. But for travelers planning their own multi-city trips, finding options is rarely the hardest part.

**The harder question is: what should I actually choose?**

Kalyra is built around that decision.

Rather than simply generating an itinerary or maximizing the number of places a traveler can visit, Kalyra evaluates preferences, trip constraints, geography, pace, and live travel data to recommend how limited vacation time should be spent.

---

## The Problem

Planning a complex trip often means moving between:

- Google Flights
- Airbnb and Booking.com
- Google Maps
- Reddit and travel blogs
- TikTok and YouTube
- tour websites
- spreadsheets
- notes apps

There is no shortage of travel information. The problem is that the information is fragmented, and the traveler still has to make the difficult decisions.

Questions such as:

- Which destinations are actually worth including?
- Is this itinerary realistic?
- Am I trying to visit too many places?
- Where should I spend more or fewer nights?
- Which experiences are worth the money?
- How much time will I lose moving between destinations?
- How do I balance budget, convenience, and experience?

can require hours of research.

**Travelers don't necessarily need more options. They need help making better decisions.**

---

## Why Kalyra?

Kalyra began from the experience of planning complex international trips independently.

Building a great multi-city itinerary required comparing flights, maps, weather, destinations, activities, travel times, recommendations, and budgets across many different platforms.

The challenge wasn't finding information.

**The challenge was turning all of that information into a good decision.**

That led to a different approach to travel planning: instead of beginning with *"What attractions should I add?"*, Kalyra begins with *"How should this traveler spend this trip?"*

---

## How Kalyra Approaches Planning

Kalyra treats travel planning as a decision and optimization problem.

```text
Traveler Preferences + Trip Constraints
                  |
                  v
        Destination Evaluation
                  |
                  v
          Route / Base Selection
                  |
                  v
        Daily Activity Planning
                  |
                  v
         Live Data Enrichment
                  |
                  v
            Generated Trip
                  |
                  v
       Refinement + Versioning
```

The planning process separates **trip-level strategy** from **daily activity selection**.

That distinction matters.

Before deciding what a traveler should do on Tuesday afternoon, Kalyra first asks whether that traveler should be in that destination at all.

---

## Core Features

### Preference-driven analysis

Kalyra collects information about the traveler and the trip — including destinations under consideration, dates, interests, budget, pace, and travel style — before recommending a plan.

### Destination evaluation

Candidate destinations are evaluated and ranked so the itinerary does not automatically give every possible stop equal weight.

### Route and base optimization

Kalyra determines how many travel bases make sense for the available time and builds a route around geography, pace, and trip constraints.

The goal is not to maximize the number of cities visited. It is to create a trip whose movement is justified by the experience it provides.

### Day-by-day planning

Once the trip-level strategy is established, Kalyra creates a structured daily itinerary around the selected destinations, traveler interests, geography, and pace.

### Live travel data

Kalyra enriches planning with external data sources:

- **Ignav** — live flight fares and itinerary data
- **Open-Meteo** — weather forecasts
- **Geoapify** — places and geocoding

Provider abstractions, caching, and fallback behavior keep external services separated from the core planning logic.

### Trip refinement and versioning

Travelers can refine a generated itinerary while retaining previous versions, allowing them to explore different planning decisions without losing the original recommendation.

### Interactive trip experience

Generated trips include overview and day-by-day views, route visualization, destination information, recommendations, trip-level analysis, and refinement history.

---

## What Makes Kalyra Different?

### Booking platforms help travelers transact.

They are designed to find and purchase flights, hotels, and other travel products.

### Traditional itinerary tools help travelers organize.

They are useful for assembling destinations, reservations, and activities into a schedule.

### AI itinerary generators can help travelers generate.

They can quickly produce lists of attractions, restaurants, and suggested schedules.

### Kalyra is focused on helping travelers decide.

Instead of only asking:

> "What can I do here?"

Kalyra is designed around questions like:

> "Is this destination worth including given my limited time?"

> "Should I spend another night here or somewhere else?"

> "Is the experience worth the additional travel time or cost?"

> "Does this route match the way I actually like to travel?"

The long-term opportunity is to make those decisions increasingly personalized as Kalyra learns which types of destinations, pacing, and experiences individual travelers consistently value.

---

## Architecture

Kalyra is built as a pnpm monorepo with separate frontend, backend, shared-library, and supporting workspaces.

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- TanStack Query
- Leaflet
- Framer Motion
- Zod

### Backend

- Node.js
- TypeScript
- Express
- Drizzle ORM
- Zod
- Pino

### External Services

- Ignav — flight search
- Open-Meteo — weather forecasts
- Geoapify — places and geocoding

External integrations are isolated behind provider boundaries so live-data sources can be cached, replaced, or allowed to fail gracefully without tightly coupling them to the planning engine.

---

## Repository Structure

```text
kalyra/
├── artifacts/
│   ├── api-server/          # Express API and planning services
│   ├── travel-optimizer/    # React frontend
│   └── mockup-sandbox/
├── lib/                     # Shared workspace libraries
├── scripts/                 # Tests and supporting scripts
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.json
```

---

## Engineering Decisions

### Optimize before generating

Kalyra determines the trip strategy before filling individual days.

This prevents the availability of attractions from determining the higher-level structure of the vacation.

### Separate destination strategy from activity planning

Destination evaluation, base selection, routing, and daily activity planning are separate concerns.

This allows Kalyra to reason about *where* time should be spent independently from *what* should fill that time.

### Treat travel time as a cost

Adding another destination is not automatically an improvement.

Changing hotels, traveling between cities, and reorganizing luggage consume time and energy that could otherwise be spent experiencing a destination. Kalyra's planning model therefore considers movement itself as part of the trade-off.

### Isolate external providers

Flight, weather, and place data are accessed through provider boundaries rather than being embedded directly into the planning logic.

This makes external services easier to cache, replace, test, and recover from when unavailable.

### Preserve refinements

Trip modifications create new versions so travelers can experiment with planning decisions without losing the original recommendation.

---

## Running Locally

### Prerequisites

- Node.js
- pnpm
- PostgreSQL
- API credentials for the external providers used by the application

Install dependencies:

```bash
pnpm install
```

Create a root `.env` file with the required local configuration and provider credentials.

Secrets should never be committed to source control.

Start the API:

```bash
pnpm --filter @workspace/api-server dev
```

Start the frontend in a separate terminal:

```bash
pnpm --filter @workspace/travel-optimizer dev
```

### Validation

Run repository type checks:

```bash
pnpm run typecheck
```

Build the project:

```bash
pnpm run build
```

---

## Current Scope

Kalyra is currently an MVP focused on **travel decision support and itinerary optimization**.

It is intentionally not a booking platform. Live flight, weather, and place data are used to improve planning decisions rather than complete transactions inside the application.

The current product explores a larger vision: a travel platform that does not just know *what is available*, but increasingly understands **what is worth it for a particular traveler**.

---

## Vision

The long-term vision for Kalyra is to become an intelligent planning layer for independent travel — helping travelers plan, optimize, experience, and eventually learn from every trip.

As personalization develops across trips, the system could learn patterns such as which destinations, pacing, spending decisions, and types of experiences consistently produce the most value for an individual traveler.

The goal is not simply to make travel planning faster.

**It is to help people spend their limited travel time on experiences they are more likely to value.**

---

## Project Status

Kalyra is under active development.