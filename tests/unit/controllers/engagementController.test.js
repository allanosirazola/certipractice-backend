/**
 * @fileoverview Engagement Controller Tests
 *
 * Mocks the service layer and checks: response shape, error mapping
 * (validation 400, foreign-key 404, generic 500), and that telemetry
 * is invoked on toggle but never blocks the response.
 */

jest.mock('../../../src/services/engagementService', () => ({
  listBookmarks: jest.fn(),
  isBookmarked: jest.fn(),
  toggleBookmark: jest.fn(),
  removeBookmark: jest.fn(),
  getNote: jest.fn(),
  upsertNote: jest.fn(),
  deleteNote: jest.fn(),
  listNotes: jest.fn(),
}));
jest.mock('../../../src/services/telemetryService', () => ({
  trackQuestionEvent: jest.fn(() => Promise.resolve(undefined)),
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const engagement = require('../../../src/services/engagementService');
const telemetry = require('../../../src/services/telemetryService');
const controller = require('../../../src/controllers/engagementController');

describe('EngagementController', () => {
  let req, res;
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish telemetry impl after clearAllMocks wipes it
    telemetry.trackQuestionEvent.mockImplementation(() => Promise.resolve(undefined));
    req = { user: { id: 1 }, params: {}, body: {}, query: {} };
    res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  });

  describe('listBookmarks', () => {
    it('returns the data envelope', async () => {
      engagement.listBookmarks.mockResolvedValue({ items: [], pagination: { total: 0 } });
      await controller.listBookmarks(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
    it('returns 500 on service error', async () => {
      engagement.listBookmarks.mockRejectedValue(new Error('boom'));
      await controller.listBookmarks(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('checkBookmark', () => {
    it('returns { bookmarked: true }', async () => {
      engagement.isBookmarked.mockResolvedValue(true);
      req.params.questionId = 'q-1';
      await controller.checkBookmark(req, res);
      expect(res.json).toHaveBeenCalledWith({
        success: true, data: { bookmarked: true },
      });
    });
  });

  describe('toggleBookmark', () => {
    it('returns toggled state and tracks telemetry on add', async () => {
      engagement.toggleBookmark.mockResolvedValue({
        bookmarked: true,
        bookmark: { id: '1', questionId: 'q-1' },
      });
      req.params.questionId = 'q-1';
      await controller.toggleBookmark(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(telemetry.trackQuestionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'bookmarked', questionId: 'q-1' })
      );
    });

    it('tracks unbookmarked event on removal', async () => {
      engagement.toggleBookmark.mockResolvedValue({ bookmarked: false });
      req.params.questionId = 'q-1';
      await controller.toggleBookmark(req, res);
      expect(telemetry.trackQuestionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'unbookmarked' })
      );
    });

    it('returns 404 when question does not exist (FK violation)', async () => {
      const err = new Error('FK violation');
      err.code = '23503';
      engagement.toggleBookmark.mockRejectedValue(err);
      req.params.questionId = 'q-1';
      await controller.toggleBookmark(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('removeBookmark', () => {
    it('returns 404 when nothing was deleted', async () => {
      engagement.removeBookmark.mockResolvedValue(false);
      req.params.questionId = 'q-1';
      await controller.removeBookmark(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
    it('returns success when deleted', async () => {
      engagement.removeBookmark.mockResolvedValue(true);
      req.params.questionId = 'q-1';
      await controller.removeBookmark(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  describe('getNote', () => {
    it('returns null when note absent', async () => {
      engagement.getNote.mockResolvedValue(null);
      req.params.questionId = 'q-1';
      await controller.getNote(req, res);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
    });
    it('returns note when present', async () => {
      engagement.getNote.mockResolvedValue({ id: '1', content: 'note' });
      req.params.questionId = 'q-1';
      await controller.getNote(req, res);
      expect(res.json).toHaveBeenCalledWith({
        success: true, data: { id: '1', content: 'note' },
      });
    });
  });

  describe('upsertNote', () => {
    it('returns the saved note', async () => {
      engagement.upsertNote.mockResolvedValue({ id: '1', content: 'hi' });
      req.params.questionId = 'q-1';
      req.body = { content: 'hi' };
      await controller.upsertNote(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('maps validation errors to 400', async () => {
      const err = new Error('Empty');
      err.code = 'EMPTY_NOTE';
      engagement.upsertNote.mockRejectedValue(err);
      req.params.questionId = 'q-1';
      await controller.upsertNote(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('maps NOTE_TOO_LONG to 400', async () => {
      const err = new Error('Too long');
      err.code = 'NOTE_TOO_LONG';
      engagement.upsertNote.mockRejectedValue(err);
      await controller.upsertNote(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('maps FK violation to 404', async () => {
      const err = new Error('FK');
      err.code = '23503';
      engagement.upsertNote.mockRejectedValue(err);
      await controller.upsertNote(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteNote', () => {
    it('returns 404 when nothing deleted', async () => {
      engagement.deleteNote.mockResolvedValue(false);
      await controller.deleteNote(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
