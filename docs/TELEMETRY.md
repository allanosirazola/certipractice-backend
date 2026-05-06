# Telemetry & Analytics System

This document describes the analytics infrastructure introduced in v1.3.0.

## Overview

The system captures **every individual event** (no sampling) for full-fidelity user behavior analysis. Anonymous and authenticated users are both tracked. Events are stored in dedicated, indexed tables and pre-aggregated nightly into `daily_metrics` for fast dashboards.

## Architecture

```
┌─────────────────────┐
│  Frontend / API     │
│  (every request)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ trackPageView       │ ← automatic on every API request (skip /health)
│ (middleware)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Controllers hook    │ ← explicit calls in exam/auth/question controllers
│ telemetryService    │
└──────────┬──────────┘
           │ fire-and-forget INSERTs
           ▼
┌─────────────────────────────────────────────────────────┐
│  exam_events  │  question_events  │  user_activity      │
│  (raw events) │  (raw events)     │  (raw events)       │
└──────────┬──────────────────────────────────────────────┘
           │ nightly aggregation (cron / Railway scheduler)
           ▼
┌─────────────────────┐
│  daily_metrics      │ ← fast lookup for dashboards
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ /api/admin/analytics│ ← admin-only dashboards
└─────────────────────┘
```

## Database Tables

### `exam_events`
Lifecycle events for every exam attempt: created, started, paused, resumed, completed, abandoned, cancelled, plus per-answer/flag events.

| Column | Type | Notes |
|---|---|---|
| `event_type` | enum | `exam_created`, `exam_started`, `exam_paused`, `exam_resumed`, `exam_completed`, `exam_abandoned`, `exam_cancelled`, `exam_answer_submitted`, `exam_question_flagged`, `exam_question_unflagged`, `exam_question_viewed`, `exam_navigated` |
| `metadata` | jsonb | Free-form: score, passed, timeSpent, mode, questionCount, isCorrect |
| `question_index` | int | Where the user was (drop-off analysis) |

Indexes optimized for: `examId`, `userId+createdAt`, `sessionId+createdAt`, `eventType+createdAt`.

### `question_events`
Per-question interactions outside or inside exam context.

| Column | Type | Notes |
|---|---|---|
| `event_type` | enum | `viewed`, `answered`, `reported`, `bookmarked`, `unbookmarked`, `reviewed` |
| `is_correct` | bool? | Set on `answered` events |
| `time_spent` | int? | Seconds spent on the question |

### `user_activity`
Cross-cutting activity: logins, page views, searches, navigation.

| Column | Type | Notes |
|---|---|---|
| `activity_type` | enum | `login`, `logout`, `registration`, `page_view`, `search`, `navigation`, `session_start`, `session_end`, `feature_used`, `error_encountered` |
| `path` | varchar(500) | URL path |
| `referrer` | varchar(500) | HTTP referrer |
| `duration_ms` | int? | For page views |

### `daily_metrics`
Pre-aggregated rollups, keyed by `(date, scope)`. Default scope is `'global'`. Supports per-certification scopes like `'cert:42'`.

## Event Capture Points

### Automatic (no controller changes needed)
- **Every API request** → `user_activity.page_view` via `trackPageView` middleware
  - Captures: path, method, statusCode, duration, user/session, IP, user-agent
  - Skips: `/health*`, `/favicon`, `/robots.txt`, explicit tracking endpoints

### Explicit (in controllers)
- `authController.register` → `user_activity.registration`
- `authController.login` → `user_activity.login`
- `authController.logout` → `user_activity.logout`
- `examController.createExam` → `exam_events.exam_created`
- `examController.startExam` → `exam_events.exam_started`
- `examController.submitAnswer` → `exam_events.exam_answer_submitted` + `question_events.answered`
- `examController.completeExam` → `exam_events.exam_completed` (with score, passed, timeSpent)
- `examController.pauseExam` → `exam_events.exam_paused`
- `examController.resumeExam` → `exam_events.exam_resumed`
- `examController.cancelExam` → `exam_events.exam_cancelled`
- `examController.toggleQuestionFlag` → `exam_events.exam_question_flagged` / `unflagged`
- `questionController.getQuestionById` → `question_events.viewed`
- `questionController.checkAnswer` → `question_events.answered`

All capture points are **fire-and-forget**: telemetry failures never block the user-facing response.

## Admin Dashboard Endpoints

All routes mount under `/api/admin/analytics` and require `adminAuth`.

| Endpoint | Purpose |
|---|---|
| `GET /overview?days=7` | High-level KPIs with delta vs previous period |
| `GET /exams?days=7` | Daily funnel, status/mode distribution, abandon points, slowest exams |
| `GET /questions?days=7&limit=20` | Most failed/viewed/reported questions, accuracy buckets, performance by difficulty |
| `GET /users?days=7` | DAU, registrations by day, most active users, page-view duration percentiles, anon vs auth split |
| `GET /funnel?days=7` | Top paths, error responses, top search queries |
| `GET /timeseries?days=30&scope=global` | Daily metric rows from `daily_metrics` |
| `POST /compute-daily` | Trigger aggregation for a specific date (backfills) |

Query params:
- `days` (1-365, default 7) — lookback window
- `limit` (1-100, default 20) — for top-N lists
- `scope` — partition for timeseries

## Public Endpoints (for the frontend)

| Endpoint | Purpose |
|---|---|
| `POST /api/analytics/activity` | Single-event tracking (auth optional) |
| `POST /api/analytics/events/batch` | Submit up to 50 queued events at once |

## Operations

### Run nightly aggregation

Set up a scheduled job (Railway cron, GitHub Actions, etc.) to run:
```bash
npm run metrics:daily
```
This computes metrics for **yesterday**.

### Backfill a date range
```bash
node scripts/computeDailyMetrics.js 2026-04-01 2026-04-30
```

### Manual recompute (single day)
```bash
node scripts/computeDailyMetrics.js 2026-04-30
```
Or via API:
```bash
curl -X POST https://your-api/api/admin/analytics/compute-daily \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-04-30","scope":"global"}'
```

## Apply the migration

The Prisma schema is up to date. To apply on Railway:

```bash
npx prisma migrate deploy
```

Or run the raw SQL manually:
```bash
psql $DATABASE_URL < prisma/migrations/20260503_add_telemetry/migration.sql
```

## Privacy & Retention

- IP addresses and user-agents are stored truncated to fixed lengths
- No request bodies are logged
- For GDPR compliance you may want to add a job that purges events older than N days for users who request deletion
- Consider adding a `TTL` policy or partitioning by month for very high-volume deployments

## Tests

- `tests/unit/services/telemetryService.test.js` — 20 tests
- `tests/unit/middleware/telemetry.test.js` — 11 tests
- `tests/unit/controllers/adminAnalyticsController.test.js` — 15 tests

Total: 46 new tests, all passing alongside the existing 429.
