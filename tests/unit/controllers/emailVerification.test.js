/**
 * @fileoverview Tests for the email-verification endpoints
 *
 *   POST /api/auth/verify-email           → flips email_verified=true
 *   POST /api/auth/resend-verification    → re-issues a token & re-sends
 *
 * The handlers are tested in isolation against mocked pool/emailService.
 */

jest.mock('../../../src/database/pool', () => ({
  query: jest.fn(),
}));
jest.mock('../../../src/services/userService', () => ({}));
jest.mock('../../../src/services/emailService', () => ({
  generateVerificationToken: jest.fn(),
  sendVerificationEmail: jest.fn(),
}));
jest.mock('../../../src/services/telemetryService', () => ({
  trackUserActivity: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const pool = require('../../../src/database/pool');
const emailService = require('../../../src/services/emailService');
const telemetry = require('../../../src/services/telemetryService');
const { verifyEmail, resendVerification } = require('../../../src/controllers/authController');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Re-set default implementations after clearAllMocks() — for jest.fn()
  // without arguments, clearAllMocks DOES wipe the implementation. We
  // restore them here so each test starts from a sane default.
  emailService.generateVerificationToken.mockReturnValue('new-token-abc');
  emailService.sendVerificationEmail.mockResolvedValue({ sent: true, transport: 'console' });
  telemetry.trackUserActivity.mockResolvedValue(undefined);
});

describe('verifyEmail', () => {
  it('returns 400 when token is missing', async () => {
    const req = { body: {} };
    const res = makeRes();
    await verifyEmail(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 400 when token has no matching user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const req = { body: { token: 'unknown' } };
    const res = makeRes();
    await verifyEmail(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('is idempotent: returns success when email already verified', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      id: 1, email: 'a@x.com', username: 'a', email_verified: true,
      email_verification_expires: null,
    }]});
    const req = { body: { token: 'whatever' } };
    const res = makeRes();
    await verifyEmail(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ alreadyVerified: true }),
    }));
  });

  it('returns 400 with TOKEN_EXPIRED code when link has expired', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      id: 1, email: 'a@x.com', username: 'a', email_verified: false,
      email_verification_expires: new Date(Date.now() - 1000),
    }]});
    const req = { body: { token: 'expired' } };
    const res = makeRes();
    await verifyEmail(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = res.json.mock.calls[0][0];
    expect(payload.code).toBe('TOKEN_EXPIRED');
  });

  it('flips email_verified=true and clears the token on success', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{
        id: 42, email: 'a@x.com', username: 'a', email_verified: false,
        email_verification_expires: new Date(Date.now() + 60_000),
      }]})
      .mockResolvedValueOnce({ rowCount: 1 });
    const req = { body: { token: 'valid' } };
    const res = makeRes();
    await verifyEmail(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: { verified: true },
    }));
    // Check the UPDATE happened on the correct user
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][1]).toEqual([42]);
    const updateSql = pool.query.mock.calls[1][0];
    expect(updateSql).toMatch(/email_verified\s*=\s*TRUE/);
    expect(updateSql).toMatch(/email_verification_token\s*=\s*NULL/);
  });

  it('returns 500 on database error', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    const req = { body: { token: 'x' } };
    const res = makeRes();
    await verifyEmail(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('resendVerification', () => {
  it('returns 400 when no email source is available', async () => {
    const req = { user: null, body: {}, headers: {} };
    const res = makeRes();
    await resendVerification(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns success even when user does not exist (no enumeration)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const req = { user: null, body: { email: 'ghost@x.com' }, headers: {} };
    const res = makeRes();
    await resendVerification(req, res);
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('skips sending when user is already verified (no enumeration)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      id: 1, email: 'a@x.com', username: 'a', email_verified: true,
    }]});
    const req = { user: null, body: { email: 'a@x.com' }, headers: {} };
    const res = makeRes();
    await resendVerification(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('issues new token and sends email for unverified user', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 7, email: 'a@x.com', username: 'a', email_verified: false }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const req = { user: null, body: { email: 'a@x.com' }, headers: { 'accept-language': 'en-US' } };
    const res = makeRes();
    await resendVerification(req, res);
    expect(emailService.generateVerificationToken).toHaveBeenCalled();
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'a@x.com',
      username: 'a',
      token: 'new-token-abc',
      lang: 'en',
    }));
  });

  it('prefers req.user.email over body.email when both are present', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 7, email: 'authed@x.com', username: 'authed', email_verified: false }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const req = {
      user: { id: 7, email: 'authed@x.com' },
      body: { email: 'other@x.com' },
      headers: {},
    };
    const res = makeRes();
    await resendVerification(req, res);
    expect(pool.query.mock.calls[0][1]).toEqual(['authed@x.com']);
  });

  it('defaults to Spanish when accept-language is absent', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, email: 'a@x.com', username: 'a', email_verified: false }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const req = { user: null, body: { email: 'a@x.com' }, headers: {} };
    const res = makeRes();
    await resendVerification(req, res);
    const callArgs = emailService.sendVerificationEmail.mock.calls[0][0];
    expect(callArgs.lang).toBe('es');
  });

  it('returns 500 on db error', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'));
    const req = { user: null, body: { email: 'a@x.com' }, headers: {} };
    const res = makeRes();
    await resendVerification(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
