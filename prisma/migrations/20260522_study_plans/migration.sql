-- Study plans toward a target certification date.
--
-- One row per (user, certification, creation). Only one isActive=true
-- per (user, certification) at a time; the service deactivates previous
-- ones on creation. Indexed on (user, isActive) for the
-- getActivePlan lookup and (user, certification) for the deactivation
-- sweep.

CREATE TABLE "study_plans" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "user_id"             INTEGER NOT NULL,
  "certification_id"    INTEGER NOT NULL,
  "target_date"         DATE NOT NULL,
  "daily_goal"          INTEGER NOT NULL,
  "questions_answered"  INTEGER NOT NULL DEFAULT 0,
  "is_active"           BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_study_plans_user"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_study_plans_certification"
    FOREIGN KEY ("certification_id") REFERENCES "certifications"("id") ON DELETE CASCADE
);

CREATE INDEX "study_plans_user_active_idx"
  ON "study_plans" ("user_id", "is_active");

CREATE INDEX "study_plans_user_cert_idx"
  ON "study_plans" ("user_id", "certification_id");
