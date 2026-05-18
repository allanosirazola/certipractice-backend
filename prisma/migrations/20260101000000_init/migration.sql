-- ====================================================================
-- Initial schema for CertiPractice
--
-- This single migration replaces the six historical incremental
-- migrations (add_telemetry, add_engagement, add_spaced_repetition,
-- email_verification, daily_quiz, study_plans). The production
-- database was originally created outside Prisma (via raw SQL + a
-- Python importer), so there was no Prisma baseline to apply the
-- incremental migrations against — Prisma kept refusing to deploy.
-- This file is the new starting point: it defines every table, enum,
-- index, FK and constraint that schema.prisma describes today.
--
-- To apply: drop the existing public schema, then `prisma migrate
-- deploy`. The companion seed (prisma/seed.sql) populates providers /
-- certifications / topics / question_types needed before questions can
-- be imported.
-- ====================================================================

-- ─── Enums ────────────────────────────────────────────────────────────
CREATE TYPE "UserRole" AS ENUM ('admin', 'instructor', 'student');

CREATE TYPE "Difficulty" AS ENUM ('easy', 'medium', 'hard', 'expert');

CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'approved', 'rejected', 'needs_revision');

CREATE TYPE "ReportType" AS ENUM (
  'incorrect_answer', 'unclear_question', 'outdated_content', 'typo', 'other'
);

CREATE TYPE "ReportStatus" AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');

CREATE TYPE "ExamMode" AS ENUM ('practice', 'timed', 'review', 'simulation');

CREATE TYPE "ExamStatus" AS ENUM ('pending', 'active', 'paused', 'completed', 'abandoned');

CREATE TYPE "ExamEventType" AS ENUM (
  'exam_created', 'exam_started', 'exam_paused', 'exam_resumed',
  'exam_completed', 'exam_abandoned', 'exam_cancelled',
  'exam_answer_submitted', 'exam_question_flagged',
  'exam_question_unflagged', 'exam_question_viewed', 'exam_navigated'
);

CREATE TYPE "QuestionEventType" AS ENUM (
  'viewed', 'answered', 'reported', 'bookmarked', 'unbookmarked', 'reviewed'
);

CREATE TYPE "UserActivityType" AS ENUM (
  'login', 'logout', 'registration', 'page_view', 'search',
  'navigation', 'session_start', 'session_end', 'feature_used',
  'error_encountered'
);

-- ─── Users ────────────────────────────────────────────────────────────
CREATE TABLE "users" (
  "id"                          SERIAL PRIMARY KEY,
  "username"                    VARCHAR(50)  NOT NULL UNIQUE,
  "email"                       VARCHAR(255) NOT NULL UNIQUE,
  "password_hash"               VARCHAR(255) NOT NULL,
  "first_name"                  VARCHAR(100),
  "last_name"                   VARCHAR(100),
  "role"                        "UserRole"   NOT NULL DEFAULT 'student',
  "is_active"                   BOOLEAN      NOT NULL DEFAULT TRUE,
  "is_validated"                BOOLEAN      NOT NULL DEFAULT FALSE,
  "email_verified"              BOOLEAN      NOT NULL DEFAULT TRUE,
  "email_verification_token"    VARCHAR(128),
  "email_verification_expires"  TIMESTAMP(3),
  "last_login_at"               TIMESTAMP(3),
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "users_email_idx"                      ON "users"("email");
CREATE INDEX "users_username_idx"                   ON "users"("username");
CREATE INDEX "users_role_idx"                       ON "users"("role");
CREATE INDEX "users_email_verification_token_idx"   ON "users"("email_verification_token");

-- ─── Providers / Certifications / Topics ──────────────────────────────
CREATE TABLE "providers" (
  "id"          SERIAL PRIMARY KEY,
  "name"        VARCHAR(100) NOT NULL UNIQUE,
  "code"        VARCHAR(20)  NOT NULL UNIQUE,
  "description" TEXT,
  "logo_url"    VARCHAR(500),
  "is_active"   BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "certifications" (
  "id"          SERIAL PRIMARY KEY,
  "provider_id" INTEGER       NOT NULL,
  "name"        VARCHAR(200)  NOT NULL,
  "code"        VARCHAR(50)   NOT NULL UNIQUE,
  "description" TEXT,
  "difficulty"  VARCHAR(20)   NOT NULL DEFAULT 'medium',
  "is_active"   BOOLEAN       NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_certifications_provider"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE,
  CONSTRAINT "certifications_provider_code_unique" UNIQUE ("provider_id", "code")
);
CREATE INDEX "certifications_provider_id_idx" ON "certifications"("provider_id");

CREATE TABLE "topics" (
  "id"               SERIAL PRIMARY KEY,
  "certification_id" INTEGER       NOT NULL,
  "name"             VARCHAR(200)  NOT NULL,
  "description"      TEXT,
  "order_index"      INTEGER       NOT NULL DEFAULT 0,
  "is_active"        BOOLEAN       NOT NULL DEFAULT TRUE,
  "created_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_topics_certification"
    FOREIGN KEY ("certification_id") REFERENCES "certifications"("id") ON DELETE CASCADE,
  CONSTRAINT "topics_certification_name_unique" UNIQUE ("certification_id", "name")
);
CREATE INDEX "topics_certification_id_idx" ON "topics"("certification_id");

-- ─── Question types & questions ───────────────────────────────────────
CREATE TABLE "question_types" (
  "id"          SERIAL PRIMARY KEY,
  "name"        VARCHAR(50) NOT NULL UNIQUE,
  "description" VARCHAR(200),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "questions" (
  "id"                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "topic_id"          INTEGER      NOT NULL,
  "question_type_id"  INTEGER      NOT NULL,
  "question_text"     TEXT         NOT NULL,
  "explanation"       TEXT,
  "difficulty"        "Difficulty" NOT NULL DEFAULT 'medium',
  "points"            INTEGER      NOT NULL DEFAULT 1,
  "time_estimate"     INTEGER,
  "tags"              TEXT[]       NOT NULL DEFAULT '{}',
  "content_hash"      VARCHAR(64)  NOT NULL UNIQUE,
  "metadata"          JSONB        NOT NULL DEFAULT '{}',
  "review_status"     "ReviewStatus" NOT NULL DEFAULT 'pending',
  "reviewed_by"       INTEGER,
  "reviewed_at"       TIMESTAMP(3),
  "review_notes"      TEXT,
  "created_by"        INTEGER,
  "is_active"         BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_questions_topic"
    FOREIGN KEY ("topic_id")         REFERENCES "topics"("id")         ON DELETE CASCADE,
  CONSTRAINT "fk_questions_type"
    FOREIGN KEY ("question_type_id") REFERENCES "question_types"("id"),
  CONSTRAINT "fk_questions_creator"
    FOREIGN KEY ("created_by")       REFERENCES "users"("id"),
  CONSTRAINT "fk_questions_reviewer"
    FOREIGN KEY ("reviewed_by")      REFERENCES "users"("id")
);
CREATE INDEX "questions_topic_id_idx"         ON "questions"("topic_id");
CREATE INDEX "questions_question_type_id_idx" ON "questions"("question_type_id");
CREATE INDEX "questions_difficulty_idx"       ON "questions"("difficulty");
CREATE INDEX "questions_review_status_idx"    ON "questions"("review_status");
CREATE INDEX "questions_content_hash_idx"     ON "questions"("content_hash");
CREATE INDEX "questions_tags_idx"             ON "questions" USING GIN ("tags");

CREATE TABLE "question_options" (
  "id"           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "question_id"  UUID         NOT NULL,
  "option_label" VARCHAR(5)   NOT NULL,
  "option_text"  TEXT         NOT NULL,
  "is_correct"   BOOLEAN      NOT NULL DEFAULT FALSE,
  "order_index"  INTEGER      NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_question_options_question"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE,
  CONSTRAINT "question_options_question_label_unique"
    UNIQUE ("question_id", "option_label")
);
CREATE INDEX "question_options_question_id_idx" ON "question_options"("question_id");

CREATE TABLE "question_statistics" (
  "question_id"           UUID         PRIMARY KEY,
  "total_attempts"        INTEGER      NOT NULL DEFAULT 0,
  "correct_attempts"      INTEGER      NOT NULL DEFAULT 0,
  "average_time_seconds"  INTEGER      NOT NULL DEFAULT 0,
  "last_attempted_at"     TIMESTAMP(3),
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_question_statistics_question"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE
);

CREATE TABLE "question_reports" (
  "id"          SERIAL PRIMARY KEY,
  "question_id" UUID            NOT NULL,
  "user_id"     INTEGER         NOT NULL,
  "report_type" "ReportType"    NOT NULL,
  "description" TEXT            NOT NULL,
  "status"      "ReportStatus"  NOT NULL DEFAULT 'pending',
  "resolved_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_question_reports_question"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_question_reports_user"
    FOREIGN KEY ("user_id")     REFERENCES "users"("id")
);
CREATE INDEX "question_reports_question_id_idx" ON "question_reports"("question_id");
CREATE INDEX "question_reports_user_id_idx"     ON "question_reports"("user_id");
CREATE INDEX "question_reports_status_idx"      ON "question_reports"("status");

-- ─── Engagement: bookmarks & notes ────────────────────────────────────
CREATE TABLE "bookmarks" (
  "id"          BIGSERIAL PRIMARY KEY,
  "user_id"     INTEGER      NOT NULL,
  "question_id" UUID         NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_bookmarks_user"
    FOREIGN KEY ("user_id")     REFERENCES "users"("id")     ON DELETE CASCADE,
  CONSTRAINT "fk_bookmarks_question"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "bookmarks_user_question_unique" ON "bookmarks"("user_id", "question_id");
CREATE INDEX "bookmarks_user_created_idx"            ON "bookmarks"("user_id", "created_at");
CREATE INDEX "bookmarks_question_id_idx"             ON "bookmarks"("question_id");

CREATE TABLE "question_notes" (
  "id"          BIGSERIAL PRIMARY KEY,
  "user_id"     INTEGER      NOT NULL,
  "question_id" UUID         NOT NULL,
  "content"     TEXT         NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_question_notes_user"
    FOREIGN KEY ("user_id")     REFERENCES "users"("id")     ON DELETE CASCADE,
  CONSTRAINT "fk_question_notes_question"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "question_notes_user_question_unique"
  ON "question_notes"("user_id", "question_id");
CREATE INDEX "question_notes_user_updated_idx"
  ON "question_notes"("user_id", "updated_at");
CREATE INDEX "question_notes_question_id_idx"
  ON "question_notes"("question_id");

-- ─── Spaced repetition (SM-2) ─────────────────────────────────────────
CREATE TABLE "question_reviews" (
  "id"                BIGSERIAL PRIMARY KEY,
  "user_id"           INTEGER          NOT NULL,
  "question_id"       UUID             NOT NULL,
  "ease_factor"       DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  "interval_days"     INTEGER          NOT NULL DEFAULT 0,
  "repetitions"       INTEGER          NOT NULL DEFAULT 0,
  "lapses"            INTEGER          NOT NULL DEFAULT 0,
  "due_at"            TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_reviewed_at"  TIMESTAMP(3),
  "last_quality"     INTEGER,
  "created_at"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_question_reviews_user"
    FOREIGN KEY ("user_id")     REFERENCES "users"("id")     ON DELETE CASCADE,
  CONSTRAINT "fk_question_reviews_question"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "question_reviews_user_question_unique"
  ON "question_reviews"("user_id", "question_id");
CREATE INDEX "question_reviews_user_due_at_idx"
  ON "question_reviews"("user_id", "due_at");
CREATE INDEX "question_reviews_user_last_reviewed_idx"
  ON "question_reviews"("user_id", "last_reviewed_at");
CREATE INDEX "question_reviews_question_id_idx"
  ON "question_reviews"("question_id");

-- ─── Exams ────────────────────────────────────────────────────────────
CREATE TABLE "exams" (
  "id"                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"            INTEGER,
  "session_id"         VARCHAR(100),
  "certification_id"   INTEGER       NOT NULL,
  "title"              VARCHAR(255)  NOT NULL,
  "description"        TEXT,
  "mode"               "ExamMode"    NOT NULL DEFAULT 'practice',
  "question_count"     INTEGER       NOT NULL,
  "time_limit"         INTEGER       NOT NULL,
  "passing_score"      DECIMAL(5,2)  NOT NULL DEFAULT 70,
  "status"             "ExamStatus"  NOT NULL DEFAULT 'pending',
  "score"              DECIMAL(5,2),
  "passed"             BOOLEAN,
  "current_index"      INTEGER       NOT NULL DEFAULT 0,
  "settings"           JSONB         NOT NULL DEFAULT '{}',
  "started_at"         TIMESTAMP(3),
  "completed_at"       TIMESTAMP(3),
  "paused_at"          TIMESTAMP(3),
  "total_paused_time"  INTEGER       NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_exams_user"
    FOREIGN KEY ("user_id")          REFERENCES "users"("id"),
  CONSTRAINT "fk_exams_certification"
    FOREIGN KEY ("certification_id") REFERENCES "certifications"("id")
);
CREATE INDEX "exams_user_id_idx"          ON "exams"("user_id");
CREATE INDEX "exams_session_id_idx"       ON "exams"("session_id");
CREATE INDEX "exams_certification_id_idx" ON "exams"("certification_id");
CREATE INDEX "exams_status_idx"           ON "exams"("status");
CREATE INDEX "exams_created_at_idx"       ON "exams"("created_at");

CREATE TABLE "exam_answers" (
  "id"          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "exam_id"     UUID         NOT NULL,
  "question_id" UUID         NOT NULL,
  "order_index" INTEGER      NOT NULL,
  "user_answer" JSONB,
  "is_correct"  BOOLEAN,
  "time_spent"  INTEGER      NOT NULL DEFAULT 0,
  "flagged"     BOOLEAN      NOT NULL DEFAULT FALSE,
  "answered_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_exam_answers_exam"
    FOREIGN KEY ("exam_id")     REFERENCES "exams"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_exam_answers_question"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id")
);
CREATE UNIQUE INDEX "exam_answers_exam_question_unique"
  ON "exam_answers"("exam_id", "question_id");
CREATE INDEX "exam_answers_exam_id_idx"     ON "exam_answers"("exam_id");
CREATE INDEX "exam_answers_question_id_idx" ON "exam_answers"("question_id");

-- ─── Audit log ────────────────────────────────────────────────────────
CREATE TABLE "audit_logs" (
  "id"          BIGSERIAL PRIMARY KEY,
  "user_id"     INTEGER,
  "action"      VARCHAR(100) NOT NULL,
  "entity_type" VARCHAR(50)  NOT NULL,
  "entity_id"   VARCHAR(100) NOT NULL,
  "old_values"  JSONB,
  "new_values"  JSONB,
  "ip_address"  VARCHAR(45),
  "user_agent"  VARCHAR(500),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "audit_logs_user_id_idx"          ON "audit_logs"("user_id");
CREATE INDEX "audit_logs_entity_idx"           ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_created_at_idx"       ON "audit_logs"("created_at");

-- ─── Telemetry: exam_events ───────────────────────────────────────────
CREATE TABLE "exam_events" (
  "id"             BIGSERIAL PRIMARY KEY,
  "exam_id"        UUID             NOT NULL,
  "user_id"        INTEGER,
  "session_id"     VARCHAR(64),
  "event_type"     "ExamEventType"  NOT NULL,
  "metadata"       JSONB,
  "question_index" INTEGER,
  "ip_address"     VARCHAR(45),
  "user_agent"     VARCHAR(500),
  "created_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "exam_events_exam_id_idx"        ON "exam_events"("exam_id");
CREATE INDEX "exam_events_user_created_idx"   ON "exam_events"("user_id", "created_at");
CREATE INDEX "exam_events_session_created_idx" ON "exam_events"("session_id", "created_at");
CREATE INDEX "exam_events_type_created_idx"   ON "exam_events"("event_type", "created_at");
CREATE INDEX "exam_events_created_at_idx"     ON "exam_events"("created_at");

-- ─── Telemetry: question_events ───────────────────────────────────────
CREATE TABLE "question_events" (
  "id"          BIGSERIAL PRIMARY KEY,
  "question_id" UUID                 NOT NULL,
  "user_id"     INTEGER,
  "session_id"  VARCHAR(64),
  "event_type"  "QuestionEventType"  NOT NULL,
  "is_correct"  BOOLEAN,
  "time_spent"  INTEGER,
  "metadata"    JSONB,
  "ip_address"  VARCHAR(45),
  "created_at"  TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "question_events_question_created_idx" ON "question_events"("question_id", "created_at");
CREATE INDEX "question_events_user_created_idx"     ON "question_events"("user_id", "created_at");
CREATE INDEX "question_events_session_created_idx"  ON "question_events"("session_id", "created_at");
CREATE INDEX "question_events_type_created_idx"     ON "question_events"("event_type", "created_at");
CREATE INDEX "question_events_q_correct_idx"        ON "question_events"("question_id", "is_correct");
CREATE INDEX "question_events_created_at_idx"       ON "question_events"("created_at");

-- ─── Telemetry: user_activity ─────────────────────────────────────────
CREATE TABLE "user_activity" (
  "id"            BIGSERIAL PRIMARY KEY,
  "user_id"       INTEGER,
  "session_id"    VARCHAR(64),
  "activity_type" "UserActivityType" NOT NULL,
  "path"          VARCHAR(500),
  "referrer"      VARCHAR(500),
  "metadata"      JSONB,
  "duration_ms"   INTEGER,
  "ip_address"    VARCHAR(45),
  "user_agent"    VARCHAR(500),
  "created_at"    TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "user_activity_user_created_idx"     ON "user_activity"("user_id", "created_at");
CREATE INDEX "user_activity_session_created_idx"  ON "user_activity"("session_id", "created_at");
CREATE INDEX "user_activity_type_created_idx"     ON "user_activity"("activity_type", "created_at");
CREATE INDEX "user_activity_created_at_idx"       ON "user_activity"("created_at");

-- ─── Telemetry: daily_metrics ─────────────────────────────────────────
CREATE TABLE "daily_metrics" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "date"                DATE         NOT NULL,
  "scope"               VARCHAR(100) NOT NULL DEFAULT 'global',
  "exams_created"       INTEGER      NOT NULL DEFAULT 0,
  "exams_started"       INTEGER      NOT NULL DEFAULT 0,
  "exams_completed"     INTEGER      NOT NULL DEFAULT 0,
  "exams_abandoned"     INTEGER      NOT NULL DEFAULT 0,
  "exams_passed"        INTEGER      NOT NULL DEFAULT 0,
  "average_score"       DOUBLE PRECISION,
  "average_time_spent"  INTEGER,
  "questions_viewed"    INTEGER      NOT NULL DEFAULT 0,
  "questions_answered"  INTEGER      NOT NULL DEFAULT 0,
  "questions_correct"   INTEGER      NOT NULL DEFAULT 0,
  "questions_reported"  INTEGER      NOT NULL DEFAULT 0,
  "unique_users"        INTEGER      NOT NULL DEFAULT 0,
  "unique_sessions"     INTEGER      NOT NULL DEFAULT 0,
  "new_users"           INTEGER      NOT NULL DEFAULT 0,
  "logins"              INTEGER      NOT NULL DEFAULT 0,
  "page_views"          INTEGER      NOT NULL DEFAULT 0,
  "computed_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "daily_metrics_date_scope_unique" ON "daily_metrics"("date", "scope");
CREATE INDEX "daily_metrics_date_idx"                 ON "daily_metrics"("date");
CREATE INDEX "daily_metrics_scope_date_idx"           ON "daily_metrics"("scope", "date");

-- ─── Daily quiz completions ───────────────────────────────────────────
CREATE TABLE "daily_quiz_completions" (
  "id"           BIGSERIAL PRIMARY KEY,
  "user_id"      INTEGER      NOT NULL,
  "quiz_date"    DATE         NOT NULL,
  "score"        INTEGER      NOT NULL,
  "total"        INTEGER      NOT NULL DEFAULT 5,
  "question_ids" JSONB        NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_daily_quiz_user"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "daily_quiz_user_date_unique"
  ON "daily_quiz_completions"("user_id", "quiz_date");
CREATE INDEX "daily_quiz_user_date_idx"
  ON "daily_quiz_completions"("user_id", "quiz_date" DESC);

-- ─── Study plans ──────────────────────────────────────────────────────
CREATE TABLE "study_plans" (
  "id"                BIGSERIAL PRIMARY KEY,
  "user_id"           INTEGER      NOT NULL,
  "certification_id"  INTEGER      NOT NULL,
  "target_date"       DATE         NOT NULL,
  "daily_goal"        INTEGER      NOT NULL,
  "questions_answered" INTEGER     NOT NULL DEFAULT 0,
  "is_active"         BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_study_plans_user"
    FOREIGN KEY ("user_id")          REFERENCES "users"("id")          ON DELETE CASCADE,
  CONSTRAINT "fk_study_plans_certification"
    FOREIGN KEY ("certification_id") REFERENCES "certifications"("id") ON DELETE CASCADE
);
CREATE INDEX "study_plans_user_active_idx"
  ON "study_plans"("user_id", "is_active");
CREATE INDEX "study_plans_user_cert_idx"
  ON "study_plans"("user_id", "certification_id");
