import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tripModificationsTable = pgTable("trip_modifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull(),
  userRequest: text("user_request").notNull(),
  previousItineraryId: uuid("previous_itinerary_id"),
  updatedItineraryId: uuid("updated_itinerary_id").notNull(),
  changesMade: jsonb("changes_made").notNull(),
  reasoning: text("reasoning").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTripModificationSchema = createInsertSchema(tripModificationsTable).omit({ id: true, createdAt: true });
export type InsertTripModification = z.infer<typeof insertTripModificationSchema>;
export type TripModification = typeof tripModificationsTable.$inferSelect;
