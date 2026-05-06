-- Telemetry/Analytics tables for certipractice
-- Generated 2026-05-03

-- ============================================================================
-- ExamEvent
-- ============================================================================
CREATE TYPE "ExamEventType" AS ENUM (
  'exam_created',
  'exam_started',
  'exam_paused',
  'exam_resumed',
  'exam_completed',
  'exam_abandoned',
  'exam_cancelled',
  'exam_answer_submitted',
  'exam_question_flagged',
  'exam_question_unflagged',
  'exam_question_viewed',
  'exam_navigated'
);

CREATE TABLE "exam_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "exam_id" UUID NOT NULL,
  "user_id" INTEGER,
  "session_id" VARCHAR(64),
  "event_type" "ExamEventType" NOT NULL,
  "metadata" JSONB,
  "question_index" INTEGER,
  "ip_address" VARCHAR(45),
  "user_agent" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "exam_events_exam_id_idx" ON "exam_events"("exam_id");
CREATE INDEX "exam_events_user_id_created_at_idx" ON "exam_events"("user_id", "created_at");
CREATE INDEX "exam_events_session_id_created_at_idx" ON "exam_events"("session_id", "created_at");
CREATE INDEX "exam_events_event_type_created_at_idx" ON "exam_events"("event_type", "created_at");
CREATE INDEX "exam_events_created_at_idx" ON "exam_events"("created_at");

-- ============================================================================
-- QuestionEvent
-- ============================================================================
CREATE TYPE "QuestionEventType" AS ENUM (
  'viewed',
  'answered',
  'reported',
  'bookmarked',
  'unbookmarked',
  'reviewed'
);

CREATE TABLE "question_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "question_id" UUID NOT NULL,
  "user_id" INTEGER,
  "session_id" VARCHAR(64),
  "event_type" "QuestionEventType" NOT NULL,
  "is_correct" BOOLEAN,
  "time_spent" INTEGER,
  "metadata" JSONB,
  "ip_address" VARCHAR(45),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "question_events_question_id_created_at_idx" ON "question_events"("question_id", "created_at");
CREATE INDEX "question_events_user_id_created_at_idx" ON "question_events"("user_id", "created_at");
CREATE INDEX "question_events_session_id_created_at_idx" ON "question_events"("session_id", "created_at");
CREATE INDEX "question_events_event_type_created_at_idx" ON "question_events"("event_type", "created_at");
CREATE INDEX "question_events_question_id_is_correct_idx" ON "question_events"("question_id", "is_correct");
CREATE INDEX "question_events_created_at_idx" ON "question_events"("created_at");

-- ============================================================================
-- UserActivity
-- ============================================================================
CREATE TYPE "UserActivityType" AS ENUM (
  'login',
  'logout',
  'registration',
  'page_view',
  'search',
  'navigation',
  'session_start',
  'session_end',
  'feature_used',
  'error_encountered'
);

CREATE TABLE "user_activity" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" INTEGER,
  "session_id" VARCHAR(64),
  "activity_type" "UserActivityType" NOT NULL,
  "path" VARCHAR(500),
  "referrer" VARCHAR(500),
  "metadata" JSONB,
  "duration_ms" INTEGER,
  "ip_address" VARCHAR(45),
  "user_agent" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "user_activity_user_id_created_at_idx" ON "user_activity"("user_id", "created_at");
CREATE INDEX "user_activity_session_id_created_at_idx" ON "user_activity"("session_id", "created_at");
CREATE INDEX "user_activity_activity_type_created_at_idx" ON "user_activity"("activity_type", "created_at");
CREATE INDEX "user_activity_created_at_idx" ON "user_activity"("created_at");

-- ============================================================================
-- DailyMetrics
-- ============================================================================
CREATE TABLE "daily_metrics" (
  "id" BIGSERIAL PRIMARY KEY,
  "date" DATE NOT NULL,
  "scope" VARCHAR(100) NOT NULL DEFAULT 'global',

  "exams_created" INTEGER NOT NULL DEFAULT 0,
  "exams_started" INTEGER NOT NULL DEFAULT 0,
  "exams_completed" INTEGER NOT NULL DEFAULT 0,
  "exams_abandoned" INTEGER NOT NULL DEFAULT 0,
  "exams_passed" INTEGER NOT NULL DEFAULT 0,
  "average_score" DOUBLE PRECISION,
  "average_time_spent" INTEGER,

  "questions_viewed" INTEGER NOT NULL DEFAULT 0,
  "questions_answered" INTEGER NOT NULL DEFAULT 0,
  "questions_correct" INTEGER NOT NULL DEFAULT 0,
  "questions_reported" INTEGER NOT NULL DEFAULT 0,

  "unique_users" INTEGER NOT NULL DEFAULT 0,
  "unique_sessions" INTEGER NOT NULL DEFAULT 0,
  "new_users" INTEGER NOT NULL DEFAULT 0,
  "logins" INTEGER NOT NULL DEFAULT 0,
  "page_views" INTEGER NOT NULL DEFAULT 0,

  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "daily_metrics_date_scope_unique" UNIQUE ("date", "scope")
);

CREATE INDEX "daily_metrics_date_idx" ON "daily_metrics"("date");
CREATE INDEX "daily_metrics_scope_date_idx" ON "daily_metrics"("scope", "date");
