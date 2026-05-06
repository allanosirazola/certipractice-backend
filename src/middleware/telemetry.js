/**
 * @fileoverview Telemetry Middleware
 * Automatic activity tracking for incoming requests.
 *
 * Lightweight: skips static/health endpoints and uses fire-and-forget tracking.
 */

const telemetryService = require('../services/telemetryService');

/**
 * Paths that should NOT be tracked (noise reduction)
 */
const SKIP_PATTERNS = [
  /^\/health/,
  /^\/api\/health/,
  /^\/favicon/,
  /^\/robots\.txt/,
  /^\/api\/analytics\/activity/, // explicit endpoint already tracks
];

const shouldSkip = (path) => SKIP_PATTERNS.some((re) => re.test(path));

/**
 * Track every API page view automatically.
 * Skips health checks and static assets.
 *
 * Behavior:
 * - Fire-and-forget: never blocks the request
 * - Captures path, method, user/session, response status (via res.on('finish'))
 * - Records duration in ms
 */
const trackPageView = (req, res, next) => {
  // Skip noisy paths
  if (shouldSkip(req.path)) {
    return next();
  }

  const startTime = Date.now();

  // Capture metrics on response finish
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    // Don't await: fire-and-forget
    telemetryService
      .trackUserActivity({
        activityType: 'page_view',
        req,
        path: req.path,
        referrer: req.headers?.referer || req.headers?.referrer || null,
        durationMs,
        metadata: {
          method: req.method,
          statusCode: res.statusCode,
        },
      })
      .catch(() => {
        // Already logged inside trackUserActivity; swallow
      });
  });

  next();
};

module.exports = {
  trackPageView,
  shouldSkip,
  SKIP_PATTERNS,
};
