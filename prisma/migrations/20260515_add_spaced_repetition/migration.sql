-- Spaced-repetition review state (SM-2 algorithm)
-- One row per (user, question). Created lazily on first answer.

CREATE TABLE "question_reviews" (
  "id"               BIGSERIAL PRIMARY KEY,
  "user_id"          INTEGER NOT NULL,
  "question_id"      UUID NOT NULL,

  "ease_factor"      DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  "interval_days"    INTEGER NOT NULL DEFAULT 0,
  "repetitions"      INTEGER NOT NULL DEFAULT 0,
  "lapses"           INTEGER NOT NULL DEFAULT 0,

  "due_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_reviewed_at" TIMESTAMP(3),
  "last_quality"     INTEGER,

  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_question_reviews_user"
    FOREIGN KEY ("user_id")     REFERENCES "users"("id")     ON DELETE CASCADE,
  CONSTRAINT "fk_question_reviews_question"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "question_reviews_user_id_question_id_unique"
  ON "question_reviews" ("user_id", "question_id");

CREATE INDEX "question_reviews_user_due_at_idx"
  ON "question_reviews" ("user_id", "due_at");

CREATE INDEX "question_reviews_user_last_reviewed_idx"
  ON "question_reviews" ("user_id", "last_reviewed_at");

CREATE INDEX "question_reviews_question_id_idx"
  ON "question_reviews" ("question_id");
