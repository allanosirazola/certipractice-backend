/**
 * @fileoverview Search Service Tests
 *
 * Verifies query validation, SQL parameter binding, filter composition
 * and the rank-ordering contract. Pool is mocked, so we don't exercise
 * actual full-text search — that's covered by integration tests against
 * a real Postgres instance.
 */

jest.mock('../../../src/database/pool', () => ({
  query: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const pool = require('../../../src/database/pool');
const search = require('../../../src/services/searchService');
const { MIN_QUERY_LENGTH, MAX_QUERY_LENGTH, MAX_LIMIT } =
  require('../../../src/services/searchService');

describe('SearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validation', () => {
    it('rejects non-string query', async () => {
      await expect(search.searchQuestions(123)).rejects.toMatchObject({
        code: 'INVALID_QUERY',
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects empty / whitespace-only query', async () => {
      await expect(search.searchQuestions('')).rejects.toMatchObject({ code: 'EMPTY_QUERY' });
      await expect(search.searchQuestions('   ')).rejects.toMatchObject({ code: 'EMPTY_QUERY' });
    });

    it('rejects queries shorter than MIN_QUERY_LENGTH', async () => {
      await expect(search.searchQuestions('a')).rejects.toMatchObject({
        code: 'QUERY_TOO_SHORT',
      });
    });

    it('rejects queries longer than MAX_QUERY_LENGTH', async () => {
      await expect(
        search.searchQuestions('x'.repeat(MAX_QUERY_LENGTH + 1))
      ).rejects.toMatchObject({ code: 'QUERY_TOO_LONG' });
    });

    it('trims whitespace before searching', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] });
      await search.searchQuestions('  s3 lifecycle  ');
      expect(pool.query.mock.calls[0][1][0]).toBe('s3 lifecycle');
    });
  });

  describe('searchQuestions happy path', () => {
    beforeEach(() => {
      pool.query
        .mockResolvedValueOnce({ rows: [{
          id: 'q-1',
          question_text: 'What is the maximum size of an S3 object?',
          difficulty: 'medium',
          topic_name: 'S3',
          certification_name: 'AWS SAA',
          provider_name: 'AWS',
          rank: 0.85,
          snippet: 'maximum size of an <mark>S3</mark> object',
        }]})
        .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    });

    it('returns items shaped for the frontend', async () => {
      const r = await search.searchQuestions('s3 size');
      expect(r.query).toBe('s3 size');
      expect(r.items).toHaveLength(1);
      expect(r.items[0]).toMatchObject({
        questionId: 'q-1',
        difficulty: 'medium',
        topicName: 'S3',
        certificationName: 'AWS SAA',
        providerName: 'AWS',
        rank: 0.85,
      });
      expect(r.items[0].snippet).toContain('<mark>');
    });

    it('uses websearch_to_tsquery + ts_rank_cd ordering', async () => {
      await search.searchQuestions('s3 size');
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toMatch(/websearch_to_tsquery/);
      expect(sql).toMatch(/ts_rank_cd/);
      expect(sql).toMatch(/ORDER BY rank DESC/);
    });

    it('only includes approved questions', async () => {
      await search.searchQuestions('s3');
      expect(pool.query.mock.calls[0][0]).toMatch(/review_status = 'approved'/);
    });

    it('includes pagination metadata with hasMore=false on last page', async () => {
      const r = await search.searchQuestions('s3');
      expect(r.pagination).toMatchObject({
        total: 1, limit: 20, offset: 0, hasMore: false,
      });
    });

    it('truncates long question_text into preview with ellipsis', async () => {
      pool.query.mockReset();
      pool.query
        .mockResolvedValueOnce({ rows: [{
          id: 'q-1',
          question_text: 'x'.repeat(300),
          difficulty: 'easy',
          topic_name: 'S3', certification_name: 'AWS', provider_name: 'AWS',
          rank: 1, snippet: '',
        }]})
        .mockResolvedValueOnce({ rows: [{ total: 1 }] });
      const r = await search.searchQuestions('xxxx');
      expect(r.items[0].preview.endsWith('…')).toBe(true);
      expect(r.items[0].preview.length).toBeLessThanOrEqual(201);
    });
  });

  describe('filters', () => {
    beforeEach(() => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    });

    it('appends certificationId to params', async () => {
      await search.searchQuestions('s3', { certificationId: 7 });
      const params = pool.query.mock.calls[0][1];
      expect(params).toContain(7);
      expect(pool.query.mock.calls[0][0]).toMatch(/certification_id/);
    });

    it('appends providerId to params', async () => {
      await search.searchQuestions('s3', { providerId: 2 });
      expect(pool.query.mock.calls[0][1]).toContain(2);
    });

    it('appends valid difficulty', async () => {
      await search.searchQuestions('s3', { difficulty: 'hard' });
      expect(pool.query.mock.calls[0][1]).toContain('hard');
    });

    it('ignores invalid difficulty silently', async () => {
      await search.searchQuestions('s3', { difficulty: 'super-extra-hard' });
      const params = pool.query.mock.calls[0][1];
      expect(params).not.toContain('super-extra-hard');
    });
  });

  describe('pagination', () => {
    beforeEach(() => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    });

    it('caps limit at MAX_LIMIT', async () => {
      await search.searchQuestions('s3', { limit: 9999 });
      const params = pool.query.mock.calls[0][1];
      expect(params[params.length - 2]).toBe(MAX_LIMIT);
    });

    it('treats negative offset as 0', async () => {
      await search.searchQuestions('s3', { offset: -100 });
      const params = pool.query.mock.calls[0][1];
      expect(params[params.length - 1]).toBe(0);
    });
  });

  describe('suggest', () => {
    it('returns suggestions when query is valid', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ name: 'S3' }, { name: 'S3 Glacier' }] });
      const r = await search.suggest('s3');
      expect(r.suggestions).toEqual(['S3', 'S3 Glacier']);
    });

    it('allows short query (1 char) for typeahead', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ name: 'S3' }] });
      const r = await search.suggest('s');
      expect(r.suggestions).toEqual(['S3']);
    });

    it('returns empty list for empty query', async () => {
      const r = await search.suggest('');
      expect(r.suggestions).toEqual([]);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns empty list for non-string', async () => {
      const r = await search.suggest(null);
      expect(r.suggestions).toEqual([]);
    });
  });
});
