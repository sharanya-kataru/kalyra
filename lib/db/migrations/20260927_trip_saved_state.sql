-- Apply before starting the updated API (and before drizzle-kit push).
-- Preserve the existing collection: explicit saves cannot be distinguished
-- from automatically owned trips in the old schema. New trips default to draft.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'trips' AND column_name = 'is_saved'
  ) THEN
    ALTER TABLE trips ADD COLUMN is_saved boolean NOT NULL DEFAULT false;
    UPDATE trips SET is_saved = true WHERE user_id IS NOT NULL;
  END IF;
END $$;
COMMIT;
