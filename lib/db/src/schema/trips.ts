import { pgTable, text, integer, numeric, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tripsTable = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  destination: text("destination").notNull(),
  startingLocation: text("starting_location").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  travelerCount: integer("traveler_count").notNull(),
  budget: numeric("budget", { precision: 10, scale: 2 }).notNull(),
  budgetPreference: text("budget_preference").notNull(),
  travelerProfile: jsonb("traveler_profile").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTripSchema = createInsertSchema(tripsTable).omit({ id: true, createdAt: true });
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type Trip = typeof tripsTable.$inferSelect;
