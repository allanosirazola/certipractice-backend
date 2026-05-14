/**
 * @fileoverview Email service
 *
 * Production: sends real emails over SMTP via nodemailer when SMTP_* env
 * vars are configured (SMTP_HOST is the toggle).
 *
 * Development / tests: when SMTP is not configured, falls back to logging
 * the email content (including the verification link) to console at info
 * level. This lets the dev complete the flow without setting up a mailer.
 *
 * The send* functions are all fire-and-forget safe: they catch transport
 * errors internally and return a `{ sent, transport, error }` shape so
 * callers can react if they want, without try/catch boilerplate.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config/config');

let _transporter = null;
let _transporterCheckedFor = null;

/**
 * Lazily build (and memoize) the nodemailer transporter using env vars.
 * Returns null when SMTP is not configured — callers MUST handle that.
 */
function getTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  // Re-init if env changed (mostly relevant for tests)
  const sig = `${host}|${process.env.SMTP_PORT}|${process.env.SMTP_USER}`;
  if (_transporter && _transporterCheckedFor === sig) return _transporter;

  // Lazy-require so non-SMTP environments don't even load the dep
  const nodemailer = require('nodemailer');
  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false otherwise
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  _transporterCheckedFor = sig;
  return _transporter;
}

/** Generate a URL-safe verification token (32 random bytes hex). */
function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Build the public-facing verification URL the user will click.
 *
 * Pulls the base from FRONTEND_URL or, as a fallback, from the request's
 * origin header — useful in mixed-environment deployments where the API
 * doesn't know which site the user is on (e.g. preview deploys).
 */
function buildVerificationUrl(token, req) {
  const base = process.env.FRONTEND_URL
    || (req?.headers?.origin)
    || 'https://certipractice.vercel.app';
  return `${String(base).replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Send the verification email (or log it in dev).
 *
 * @param {{ to: string, username?: string, token: string, req?: object, lang?: 'es'|'en' }} args
 * @returns {Promise<{ sent: boolean, transport: 'smtp'|'console', error?: Error }>}
 */
async function sendVerificationEmail({ to, username, token, req, lang = 'es' }) {
  const url = buildVerificationUrl(token, req);
  const { subject, html, text } = renderVerificationTemplate({ username, url, lang });

  const transporter = getTransporter();
  if (!transporter) {
    // Dev / test fallback — print to stdout so developers can click the link
    logger.info('[emailService] SMTP not configured. Verification email NOT sent.');
    logger.info(`[emailService] To:      ${to}`);
    logger.info(`[emailService] Subject: ${subject}`);
    logger.info(`[emailService] Link:    ${url}`);
    return { sent: false, transport: 'console' };
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"CertiPractice" <no-reply@${(process.env.SMTP_HOST || 'certipractice.app')}>`,
      to,
      subject,
      text,
      html,
    });
    logger.info(`Verification email sent to ${to}`);
    return { sent: true, transport: 'smtp' };
  } catch (error) {
    logger.error('Failed to send verification email:', error);
    return { sent: false, transport: 'smtp', error };
  }
}

/* ───────────────────────────────────────────────────────────────────────
   Email content
   ─────────────────────────────────────────────────────────────────────── */

function renderVerificationTemplate({ username, url, lang }) {
  const t = lang === 'en' ? EN : ES;
  const rawGreeting = username ? `${t.hi} ${username},` : `${t.hi},`;

  const text = [
    rawGreeting,
    '',
    t.intro,
    '',
    url,
    '',
    t.expires,
    '',
    t.ignore,
    '',
    t.signature,
  ].join('\n');

  // For HTML, escape user-provided content (username) but keep our
  // own static strings as-is. URLs are not user-provided (we generate them).
  const safeGreeting = username
    ? `${t.hi} ${escapeHtml(username)},`
    : `${t.hi},`;

  const html = `
<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"/><title>${t.subject}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:32px 32px 16px 32px;">
          <h1 style="margin:0 0 8px 0;font-size:20px;color:#111827;">CertiPractice</h1>
          <p style="margin:0 0 24px 0;color:#6b7280;font-size:14px;">${t.tagline}</p>
          <p style="margin:0 0 16px 0;font-size:16px;">${safeGreeting}</p>
          <p style="margin:0 0 24px 0;line-height:1.6;">${t.intro}</p>
          <p style="margin:0 0 32px 0;text-align:center;">
            <a href="${url}"
               style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">
              ${t.button}
            </a>
          </p>
          <p style="margin:0 0 8px 0;color:#6b7280;font-size:13px;">${t.fallback}</p>
          <p style="margin:0 0 24px 0;word-break:break-all;font-size:12px;color:#374151;">
            <a href="${url}" style="color:#2563eb;">${url}</a>
          </p>
          <p style="margin:0 0 16px 0;color:#6b7280;font-size:13px;">${t.expires}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
          <p style="margin:0;color:#9ca3af;font-size:12px;">${t.ignore}</p>
        </td></tr>
      </table>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px;">${t.signature}</p>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return { subject: t.subject, html, text };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ES = {
  subject: 'Verifica tu correo en CertiPractice',
  tagline: 'Prepara tus certificaciones técnicas',
  hi: 'Hola',
  intro: 'Gracias por registrarte. Para empezar a usar tu cuenta, confirma que esta dirección de correo es tuya pulsando el botón:',
  button: 'Verificar correo',
  fallback: '¿No funciona el botón? Copia este enlace en tu navegador:',
  expires: 'Este enlace caduca en 24 horas.',
  ignore: 'Si no creaste una cuenta en CertiPractice, ignora este mensaje.',
  signature: '— El equipo de CertiPractice',
};

const EN = {
  subject: 'Verify your email at CertiPractice',
  tagline: 'Practice for technical certifications',
  hi: 'Hello',
  intro: 'Thanks for signing up. To start using your account, confirm this email address by clicking the button:',
  button: 'Verify email',
  fallback: 'Button not working? Copy this link into your browser:',
  expires: 'This link expires in 24 hours.',
  ignore: 'If you did not create a CertiPractice account, you can safely ignore this message.',
  signature: '— The CertiPractice team',
};

module.exports = {
  generateVerificationToken,
  sendVerificationEmail,
  buildVerificationUrl,
  // Exported for tests
  _internals: { renderVerificationTemplate, getTransporter, escapeHtml },
};
