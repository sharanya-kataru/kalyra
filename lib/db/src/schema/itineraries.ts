import { pgTable, text, integer, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const itinerariesTable = pgTable("itineraries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull(),
  tripStrategy: text("trip_strategy").notNull(),
  route: jsonb("route").notNull(),
  destinations: jsonb("destinations").notNull(),
  dailySchedule: jsonb("daily_schedule").notNull(),
  budgetBreakdown: jsonb("budget_breakdown").notNull(),
  reasoning: text("reasoning").notNull(),
  tradeoffs: jsonb("tradeoffs").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertItinerarySchema = createInsertSchema(itinerariesTable).omit({ id: true, createdAt: true });
export type InsertItinerary = z.infer<typeof insertItinerarySchema>;
export type Itinerary = typeof itinerariesTable.$inferSelect;
