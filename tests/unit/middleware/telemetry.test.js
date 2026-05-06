/**
 * @fileoverview Telemetry Middleware Tests
 *
 * Verifies trackPageView middleware:
 * - Skips noisy paths (/health, /favicon, etc.)
 * - Captures path, method, status, duration on res 'finish'
 * - Never blocks the request
 */

jest.mock('../../../src/services/telemetryService', () => ({
  trackUserActivity: jest.fn(() => Promise.resolve(undefined)),
}));

const telemetryService = require('../../../src/services/telemetryService');
const {
  trackPageView,
  shouldSkip,
  SKIP_PATTERNS,
} = require('../../../src/middleware/telemetry');

describe('Telemetry Middleware', () => {
  let req, res, next, finishHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish default impl after clearAllMocks wipes it
    telemetryService.trackUserActivity.mockImplementation(() => Promise.resolve(undefined));

    req = {
      path: '/api/exams',
      method: 'GET',
      ip: '127.0.0.1',
      user: { id: 1 },
      sessionId: 's1',
      headers: { referer: '/dashboard', 'user-agent': 'jest' },
    };

    res = {
      statusCode: 200,
      on: jest.fn((evt, fn) => {
        if (evt === 'finish') finishHandler = fn;
      }),
    };

    next = jest.fn();
  });

  describe('shouldSkip', () => {
    it('skips /health endpoints', () => {
      expect(shouldSkip('/health')).toBe(true);
      expect(shouldSkip('/health/ready')).toBe(true);
      expect(shouldSkip('/api/health')).toBe(true);
    });

    it('skips /favicon and /robots.txt', () => {
      expect(shouldSkip('/favicon.ico')).toBe(true);
      expect(shouldSkip('/robots.txt')).toBe(true);
    });

    it('skips the explicit activity-tracking endpoint', () => {
      expect(shouldSkip('/api/analytics/activity')).toBe(true);
    });

    it('does NOT skip regular API paths', () => {
      expect(shouldSkip('/api/exams')).toBe(false);
      expect(shouldSkip('/api/questions/123')).toBe(false);
      expect(shouldSkip('/api/auth/login')).toBe(false);
    });
  });

  describe('SKIP_PATTERNS', () => {
    it('exposes an array of regex patterns', () => {
      expect(Array.isArray(SKIP_PATTERNS)).toBe(true);
      expect(SKIP_PATTERNS.length).toBeGreaterThan(0);
      SKIP_PATTERNS.forEach((re) => expect(re).toBeInstanceOf(RegExp));
    });
  });

  describe('trackPageView', () => {
    it('always calls next() immediately', () => {
      trackPageView(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('does not register finish listener for skipped paths', () => {
      req.path = '/health';
      trackPageView(req, res, next);
      expect(res.on).not.toHaveBeenCalled();
    });

    it('registers a finish listener for tracked paths', () => {
      trackPageView(req, res, next);
      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });

    it('tracks page_view with path, method, status and duration on finish', () => {
      trackPageView(req, res, next);
      // Simulate response finish after 50ms
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
      res.statusCode = 201;
      finishHandler();

      expect(telemetryService.trackUserActivity).toHaveBeenCalledTimes(1);
      const args = telemetryService.trackUserActivity.mock.calls[0][0];
      expect(args.activityType).toBe('page_view');
      expect(args.path).toBe('/api/exams');
      expect(args.referrer).toBe('/dashboard');
      expect(args.req).toBe(req);
      expect(args.metadata).toEqual({
        method: 'GET',
        statusCode: 201,
      });
      expect(typeof args.durationMs).toBe('number');
      jest.useRealTimers();
    });

    it('uses headers.referrer if referer is missing', () => {
      req.headers = { referrer: '/from-here' };
      trackPageView(req, res, next);
      finishHandler();
      const args = telemetryService.trackUserActivity.mock.calls[0][0];
      expect(args.referrer).toBe('/from-here');
    });

    it('handles tracking failure gracefully (does not crash)', () => {
      telemetryService.trackUserActivity.mockRejectedValueOnce(new Error('boom'));
      trackPageView(req, res, next);
      expect(() => finishHandler()).not.toThrow();
    });
  });
});
