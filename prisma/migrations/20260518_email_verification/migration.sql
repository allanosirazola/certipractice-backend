-- Email verification flow for the registration step.
--
-- Existing rows are grandfathered in as already verified (true), since
-- they registered before this check existed. New registrations after
-- this migration land at false until they click the verification link.

ALTER TABLE "users"
  ADD COLUMN "email_verified"              BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "email_verification_token"    VARCHAR(128),
  ADD COLUMN "email_verification_expires"  TIMESTAMP(3);

-- Lookup token in O(1) when the user clicks the link
CREATE INDEX "users_email_verification_token_idx"
  ON "users" ("email_verification_token");
