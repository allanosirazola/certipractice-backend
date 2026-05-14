/**
 * @fileoverview emailService unit tests
 *
 * The service has two paths:
 *  1) SMTP configured  → uses nodemailer.createTransport()
 *  2) SMTP missing     → console fallback (returns sent=false transport='console')
 *
 * Both paths must:
 *  - Generate cryptographically random tokens (length, uniqueness)
 *  - Build a verification URL using FRONTEND_URL || req.headers.origin || default
 *  - Render an email body with the verification link
 *  - Escape user-supplied content (username) to prevent HTML injection
 */

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const emailService = require('../../../src/services/emailService');

describe('emailService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_SECURE;
    delete process.env.FRONTEND_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('generateVerificationToken', () => {
    it('returns a 64-char hex string (32 bytes encoded)', () => {
      const token = emailService.generateVerificationToken();
      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]+$/);
    });

    it('returns unique tokens across calls', () => {
      const tokens = new Set();
      for (let i = 0; i < 50; i++) tokens.add(emailService.generateVerificationToken());
      expect(tokens.size).toBe(50);
    });
  });

  describe('buildVerificationUrl', () => {
    it('uses FRONTEND_URL when set', () => {
      process.env.FRONTEND_URL = 'https://custom.example.com';
      const url = emailService.buildVerificationUrl('abc123');
      expect(url).toBe('https://custom.example.com/verify-email?token=abc123');
    });

    it('strips trailing slashes from the base', () => {
      process.env.FRONTEND_URL = 'https://custom.example.com///';
      const url = emailService.buildVerificationUrl('abc');
      expect(url).toBe('https://custom.example.com/verify-email?token=abc');
    });

    it('falls back to request origin header when FRONTEND_URL is unset', () => {
      const url = emailService.buildVerificationUrl('abc', { headers: { origin: 'https://example.dev' } });
      expect(url).toBe('https://example.dev/verify-email?token=abc');
    });

    it('falls back to the hard-coded default as a last resort', () => {
      const url = emailService.buildVerificationUrl('abc');
      expect(url).toContain('/verify-email?token=abc');
      expect(url).toMatch(/^https?:\/\//);
    });

    it('URL-encodes the token', () => {
      const url = emailService.buildVerificationUrl('a/b=c&d');
      expect(url).toContain('token=a%2Fb%3Dc%26d');
    });
  });

  describe('sendVerificationEmail (console fallback)', () => {
    it('returns sent=false transport=console when SMTP is not configured', async () => {
      const res = await emailService.sendVerificationEmail({
        to: 'a@example.com',
        username: 'alice',
        token: 'tok',
      });
      expect(res).toEqual({ sent: false, transport: 'console' });
    });

    it('logs the verification URL to console (so dev can use it)', async () => {
      const logger = require('../../../src/utils/logger');
      await emailService.sendVerificationEmail({
        to: 'a@example.com',
        username: 'alice',
        token: 'tok-123',
      });
      const allLogs = logger.info.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(allLogs).toContain('a@example.com');
      expect(allLogs).toContain('tok-123');
    });
  });

  describe('renderVerificationTemplate', () => {
    const { renderVerificationTemplate } = emailService._internals;

    it('renders Spanish by default', () => {
      const r = renderVerificationTemplate({
        username: 'bob',
        url: 'https://x.com/verify?token=t',
        lang: 'es',
      });
      expect(r.subject).toMatch(/Verifica/);
      expect(r.text).toMatch(/Hola bob/);
      expect(r.text).toContain('https://x.com/verify?token=t');
      expect(r.html).toContain('https://x.com/verify?token=t');
    });

    it('renders English when lang=en', () => {
      const r = renderVerificationTemplate({
        username: 'bob', url: 'https://x.com/verify', lang: 'en',
      });
      expect(r.subject).toMatch(/Verify/);
      expect(r.text).toMatch(/Hello bob/);
    });

    it('handles missing username gracefully', () => {
      const r = renderVerificationTemplate({ url: 'https://x.com/verify', lang: 'es' });
      expect(r.text).toMatch(/Hola,/);
      expect(r.text).not.toMatch(/undefined/);
    });

    it('escapes HTML in usernames to prevent injection', () => {
      const malicious = '<script>alert(1)</script>';
      const r = renderVerificationTemplate({
        username: malicious, url: 'https://x.com', lang: 'es',
      });
      expect(r.html).not.toContain('<script>');
      expect(r.html).toContain('&lt;script&gt;');
    });
  });

  describe('escapeHtml', () => {
    const { escapeHtml } = emailService._internals;
    it('escapes the five XML entities', () => {
      expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    });
    it('returns empty string for null/undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });
  });
});
