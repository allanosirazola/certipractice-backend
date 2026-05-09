-- ============================================================================
-- Engagement features: bookmarks, personal notes, full-text search
-- Generated 2026-05-10
-- ============================================================================

-- ─── bookmarks ──────────────────────────────────────────────────────────
-- Drop legacy table if it exists (was created by old SQL scripts, never
-- formalized in Prisma). Safe because nothing in production reads from it
-- in a way that requires the data.
DROP TABLE IF EXISTS "bookmarks" CASCADE;

CREATE TABLE "bookmarks" (
  "id"          BIGSERIAL PRIMARY KEY,
  "user_id"     INTEGER NOT NULL,
  "question_id" UUID    NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bookmarks_user_question_unique" UNIQUE ("user_id", "question_id"),
  CONSTRAINT "bookmarks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "bookmarks_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE
);

CREATE INDEX "bookmarks_user_id_created_at_idx" ON "bookmarks"("user_id", "created_at" DESC);
CREATE INDEX "bookmarks_question_id_idx"        ON "bookmarks"("question_id");

-- ─── question_notes ─────────────────────────────────────────────────────
CREATE TABLE "question_notes" (
  "id"          BIGSERIAL PRIMARY KEY,
  "user_id"     INTEGER NOT NULL,
  "question_id" UUID    NOT NULL,
  "content"     TEXT    NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_notes_user_question_unique" UNIQUE ("user_id", "question_id"),
  CONSTRAINT "question_notes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "question_notes_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE
);

CREATE INDEX "question_notes_user_id_updated_at_idx" ON "question_notes"("user_id", "updated_at" DESC);
CREATE INDEX "question_notes_question_id_idx"        ON "question_notes"("question_id");

-- ─── Full-text search on questions ─────────────────────────────────────
-- A generated tsvector column lets PostgreSQL build a GIN index that we
-- can query with @@ in O(log n). 'simple' config keeps it language-agnostic;
-- swap to 'english' or 'spanish' if you want stemming.
ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("question_text", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("explanation", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(array_to_string("tags", ' '), '')), 'A')
  ) STORED;

CREATE INDEX IF NOT EXISTS "questions_search_vector_idx"
  ON "questions" USING GIN ("search_vector");
