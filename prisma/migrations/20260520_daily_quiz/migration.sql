-- Daily-quiz completion tracking.
--
-- One row per (user, date). Unique constraint prevents double-submitting
-- the same day. question_ids is stored as JSONB so we can later audit
-- the picker algorithm or de-duplicate against recent picks.

CREATE TABLE "daily_quiz_completions" (
  "id"           BIGSERIAL PRIMARY KEY,
  "user_id"      INTEGER NOT NULL,
  "quiz_date"    DATE NOT NULL,
  "score"        INTEGER NOT NULL,
  "total"        INTEGER NOT NULL DEFAULT 5,
  "question_ids" JSONB NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_daily_quiz_user"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "daily_quiz_user_date_unique"
  ON "daily_quiz_completions" ("user_id", "quiz_date");

CREATE INDEX "daily_quiz_user_date_idx"
  ON "daily_quiz_completions" ("user_id", "quiz_date" DESC);
