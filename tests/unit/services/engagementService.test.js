/**
 * @fileoverview Engagement Service Tests
 *
 * Verifies bookmark and note CRUD against a mocked pool. Each method gets
 * tested for happy path + edge cases (empty input, length limits, unique
 * constraints, idempotency).
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
const engagement = require('../../../src/services/engagementService');
const { MAX_NOTE_LENGTH } = require('../../../src/services/engagementService');

describe('EngagementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listBookmarks', () => {
    it('returns paginated items with question metadata', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{
          bookmark_id: 1n, bookmarked_at: new Date('2026-04-01'),
          question_id: 'q-1', question_text: 'What is X?',
          difficulty: 'medium', topic_name: 'S3',
          certification_name: 'AWS SAA', provider_name: 'AWS',
          has_note: true,
        }]})
        .mockResolvedValueOnce({ rows: [{ total: 1 }] });

      const r = await engagement.listBookmarks(42);
      expect(r.items).toHaveLength(1);
      expect(r.items[0]).toMatchObject({
        questionId: 'q-1',
        questionText: 'What is X?',
        topicName: 'S3',
        hasNote: true,
      });
      expect(r.pagination).toMatchObject({ total: 1, limit: 50, offset: 0 });
    });

    it('clamps limit between 1 and 200', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })            // items
        .mockResolvedValueOnce({ rows: [{ total: 0 }] }); // total
      await engagement.listBookmarks(1, { limit: 9999 });
      // The items query is the FIRST call; its params are [userId, limit, offset]
      const params = pool.query.mock.calls[0][1];
      expect(params[1]).toBe(200);
    });

    it('treats negative offset as 0', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });
      await engagement.listBookmarks(1, { offset: -50 });
      expect(pool.query.mock.calls[0][1][2]).toBe(0);
    });
  });

  describe('isBookmarked', () => {
    it('returns true when row exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ exists: true }] });
      expect(await engagement.isBookmarked(1, 'q-1')).toBe(true);
    });
    it('returns false when row absent', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
      expect(await engagement.isBookmarked(1, 'q-1')).toBe(false);
    });
  });

  describe('addBookmark', () => {
    it('returns the created bookmark', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{
        id: 7n, user_id: 1, question_id: 'q-1',
        created_at: new Date('2026-04-01'),
      }]});
      const out = await engagement.addBookmark(1, 'q-1');
      expect(out).toMatchObject({ id: '7', userId: 1, questionId: 'q-1' });
    });

    it('uses ON CONFLICT for idempotency', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{
        id: 1n, user_id: 1, question_id: 'q-1', created_at: new Date(),
      }]});
      await engagement.addBookmark(1, 'q-1');
      expect(pool.query.mock.calls[0][0]).toMatch(/ON CONFLICT/);
    });
  });

  describe('removeBookmark', () => {
    it('returns true when a row was deleted', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      expect(await engagement.removeBookmark(1, 'q-1')).toBe(true);
    });
    it('returns false when nothing was deleted', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });
      expect(await engagement.removeBookmark(1, 'q-1')).toBe(false);
    });
  });

  describe('toggleBookmark', () => {
    it('removes when bookmark exists', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ exists: true }] })  // isBookmarked
        .mockResolvedValueOnce({ rowCount: 1 });               // delete
      const r = await engagement.toggleBookmark(1, 'q-1');
      expect(r).toEqual({ bookmarked: false });
    });
    it('adds when bookmark does not exist', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ exists: false }] })
        .mockResolvedValueOnce({ rows: [{
          id: 1n, user_id: 1, question_id: 'q-1', created_at: new Date(),
        }]});
      const r = await engagement.toggleBookmark(1, 'q-1');
      expect(r.bookmarked).toBe(true);
      expect(r.bookmark.questionId).toBe('q-1');
    });
  });

  describe('getNote', () => {
    it('returns null when no note exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      expect(await engagement.getNote(1, 'q-1')).toBeNull();
    });
    it('returns the note when it exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{
        id: 5n, user_id: 1, question_id: 'q-1',
        content: 'remember the formula',
        created_at: new Date('2026-04-01'),
        updated_at: new Date('2026-04-02'),
      }]});
      const note = await engagement.getNote(1, 'q-1');
      expect(note).toMatchObject({
        id: '5', questionId: 'q-1', content: 'remember the formula',
      });
    });
  });

  describe('upsertNote', () => {
    it('creates/updates a valid note', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{
        id: 1n, user_id: 1, question_id: 'q-1',
        content: 'note text',
        created_at: new Date(), updated_at: new Date(),
      }]});
      const out = await engagement.upsertNote(1, 'q-1', '  note text  ');
      expect(out.content).toBe('note text');                 // trimmed
      expect(pool.query.mock.calls[0][0]).toMatch(/ON CONFLICT/);
    });

    it('rejects non-string content', async () => {
      await expect(engagement.upsertNote(1, 'q-1', 123)).rejects.toMatchObject({
        code: 'INVALID_NOTE',
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects empty/whitespace-only content', async () => {
      await expect(engagement.upsertNote(1, 'q-1', '')).rejects.toMatchObject({
        code: 'EMPTY_NOTE',
      });
      await expect(engagement.upsertNote(1, 'q-1', '   ')).rejects.toMatchObject({
        code: 'EMPTY_NOTE',
      });
    });

    it('rejects content above MAX_NOTE_LENGTH', async () => {
      const huge = 'x'.repeat(MAX_NOTE_LENGTH + 1);
      await expect(engagement.upsertNote(1, 'q-1', huge)).rejects.toMatchObject({
        code: 'NOTE_TOO_LONG',
      });
    });

    it('accepts content exactly at MAX_NOTE_LENGTH', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{
        id: 1n, user_id: 1, question_id: 'q-1',
        content: 'x'.repeat(MAX_NOTE_LENGTH),
        created_at: new Date(), updated_at: new Date(),
      }]});
      await expect(
        engagement.upsertNote(1, 'q-1', 'x'.repeat(MAX_NOTE_LENGTH))
      ).resolves.toBeDefined();
    });
  });

  describe('deleteNote', () => {
    it('returns true when deleted', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      expect(await engagement.deleteNote(1, 'q-1')).toBe(true);
    });
    it('returns false when nothing matched', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });
      expect(await engagement.deleteNote(1, 'q-1')).toBe(false);
    });
  });

  describe('listNotes', () => {
    it('joins question metadata and returns paginated list', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{
          id: 1n, user_id: 1, question_id: 'q-1',
          content: 'study these', created_at: new Date(), updated_at: new Date(),
          question_text: 'What?', topic_name: 'S3', certification_name: 'SAA',
        }]})
        .mockResolvedValueOnce({ rows: [{ total: 1 }] });

      const r = await engagement.listNotes(1);
      expect(r.items[0]).toMatchObject({
        questionText: 'What?', topicName: 'S3', certificationName: 'SAA',
      });
      expect(r.pagination.total).toBe(1);
    });
  });
});
