/**
 * @fileoverview Search Controller Tests
 *
 * Mocks the search service. Covers:
 *  - happy path (200 with data envelope + telemetry)
 *  - validation errors mapped to 400 with correct code
 *  - generic errors -> 500
 *  - suggest endpoint soft-fails
 */

jest.mock('../../../src/services/searchService', () => ({
  searchQuestions: jest.fn(),
  suggest: jest.fn(),
}));
jest.mock('../../../src/services/telemetryService', () => ({
  trackUserActivity: jest.fn(() => Promise.resolve(undefined)),
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const search = require('../../../src/services/searchService');
const telemetry = require('../../../src/services/telemetryService');
const controller = require('../../../src/controllers/searchController');

describe('SearchController', () => {
  let req, res;
  beforeEach(() => {
    jest.clearAllMocks();
    telemetry.trackUserActivity.mockImplementation(() => Promise.resolve(undefined));
    req = { user: null, query: {}, body: {}, params: {} };
    res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  });

  describe('searchQuestions', () => {
    it('returns the data envelope and tracks the search', async () => {
      search.searchQuestions.mockResolvedValue({
        query: 's3 size',
        items: [{ questionId: 'q-1' }],
        pagination: { total: 1 },
      });
      req.query = { q: 's3 size', certificationId: '7' };
      await controller.searchQuestions(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ query: 's3 size' }),
      }));
      expect(telemetry.trackUserActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          activityType: 'search',
          metadata: expect.objectContaining({
            query: 's3 size',
            resultCount: 1,
          }),
        })
      );
    });

    it('accepts the alias "query" param', async () => {
      search.searchQuestions.mockResolvedValue({ query: 'x', items: [], pagination: {} });
      req.query = { query: 'x' };
      await controller.searchQuestions(req, res);
      expect(search.searchQuestions).toHaveBeenCalledWith('x', expect.any(Object));
    });

    it('maps EMPTY_QUERY to 400', async () => {
      const err = new Error('empty'); err.code = 'EMPTY_QUERY';
      search.searchQuestions.mockRejectedValue(err);
      await controller.searchQuestions(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('maps QUERY_TOO_SHORT to 400', async () => {
      const err = new Error('short'); err.code = 'QUERY_TOO_SHORT';
      search.searchQuestions.mockRejectedValue(err);
      req.query.q = 'a';
      await controller.searchQuestions(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('maps QUERY_TOO_LONG to 400', async () => {
      const err = new Error('long'); err.code = 'QUERY_TOO_LONG';
      search.searchQuestions.mockRejectedValue(err);
      req.query.q = 'whatever';
      await controller.searchQuestions(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('maps generic errors to 500', async () => {
      search.searchQuestions.mockRejectedValue(new Error('db went away'));
      req.query.q = 'whatever';
      await controller.searchQuestions(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('passes filters to the service', async () => {
      search.searchQuestions.mockResolvedValue({ query: 's3', items: [], pagination: {} });
      req.query = {
        q: 's3',
        certificationId: '7',
        providerId: '2',
        difficulty: 'hard',
        limit: '5',
        offset: '10',
      };
      await controller.searchQuestions(req, res);
      expect(search.searchQuestions).toHaveBeenCalledWith('s3', {
        certificationId: '7',
        providerId: '2',
        difficulty: 'hard',
        limit: '5',
        offset: '10',
      });
    });
  });

  describe('suggestQuestions', () => {
    it('returns suggestions on success', async () => {
      search.suggest.mockResolvedValue({ suggestions: ['S3', 'S3 Glacier'] });
      req.query.q = 's3';
      await controller.suggestQuestions(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { suggestions: ['S3', 'S3 Glacier'] },
      }));
    });

    it('soft-fails to empty list on error', async () => {
      search.suggest.mockRejectedValue(new Error('boom'));
      await controller.suggestQuestions(req, res);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { suggestions: [] },
      });
    });
  });
});
