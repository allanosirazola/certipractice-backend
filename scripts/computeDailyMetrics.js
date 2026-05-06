#!/usr/bin/env node
/**
 * @fileoverview Daily metrics aggregation script
 *
 * Computes daily_metrics for the previous day (or a date range).
 * Designed to run as a scheduled job (e.g. nightly via cron, Railway scheduler,
 * or a node-cron task).
 *
 * Usage:
 *   node scripts/computeDailyMetrics.js                     # yesterday
 *   node scripts/computeDailyMetrics.js 2026-04-30          # specific date
 *   node scripts/computeDailyMetrics.js 2026-04-01 2026-04-30  # date range (backfill)
 *
 * Env: DATABASE_URL must be set.
 *
 * Exit code: 0 on success, 1 if any day failed.
 */

require('dotenv').config();

const telemetry = require('../src/services/telemetryService');
const logger = require('../src/utils/logger');
const pool = require('../src/database/pool');

const formatDate = (d) => d.toISOString().split('T')[0];

const parseArgs = () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    const yesterday = new Date(Date.now() - 86400000);
    return [formatDate(yesterday)];
  }
  if (args.length === 1) {
    return [args[0]];
  }
  // Range: start, end (inclusive)
  const start = new Date(args[0]);
  const end = new Date(args[1]);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    console.error('Invalid date(s). Use YYYY-MM-DD');
    process.exit(2);
  }
  if (end < start) {
    console.error('End date must be >= start date');
    process.exit(2);
  }
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(formatDate(d));
  }
  return dates;
};

const main = async () => {
  const dates = parseArgs();
  logger.info(`Computing daily metrics for ${dates.length} day(s): ${dates[0]}${dates.length > 1 ? ` … ${dates[dates.length - 1]}` : ''}`);

  let failures = 0;
  for (const date of dates) {
    const result = await telemetry.computeDailyMetrics(date);
    if (!result.success) {
      logger.error(`✗ ${date}: ${result.error}`);
      failures++;
    } else {
      logger.info(`✓ ${date}`);
    }
  }

  await pool.end();

  if (failures > 0) {
    logger.error(`${failures}/${dates.length} day(s) failed`);
    process.exit(1);
  }
  logger.info(`All ${dates.length} day(s) computed successfully`);
  process.exit(0);
};

main().catch((err) => {
  logger.error('Fatal error in daily metrics script:', err);
  process.exit(1);
});
