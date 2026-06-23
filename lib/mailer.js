'use strict';

// Email sending via SMTP (nodemailer). Configure in .env:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE (true/false), MAIL_FROM
// If SMTP isn't configured, emails are logged to the console instead (dev mode).

const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST || '';
const PORT = Number(process.env.SMTP_PORT || 587);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || PORT === 465;
const FROM = process.env.MAIL_FROM || (USER ? `Mémoire <${USER}>` : 'Mémoire <no-reply@memoire.local>');

function isConfigured() {
  return Boolean(HOST && USER && PASS);
}

let transport = null;
function getTransport() {
  if (!transport) transport = nodemailer.createTransport({ host: HOST, port: PORT, secure: SECURE, auth: { user: USER, pass: PASS } });
  return transport;
}

async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) {
    console.log('\n[mailer] SMTP not configured — email NOT sent. Contents:');
    console.log(`  To: ${to}\n  Subject: ${subject}\n  ${text}\n`);
    return { skipped: true };
  }
  return getTransport().sendMail({ from: FROM, to, subject, text, html });
}

async function sendPasswordReset(to, name, url) {
  const subject = 'Reset your Mémoire password';
  const text = `Hi ${name || 'there'},\n\nWe received a request to reset your Mémoire password.\nReset it here (link expires in 30 minutes):\n${url}\n\nIf you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#3A322A;line-height:1.6;">
      <p>Hi ${name || 'there'},</p>
      <p>We received a request to reset your Mémoire password.</p>
      <p><a href="${url}" style="display:inline-block;background:#C2683E;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;">Reset password</a></p>
      <p style="color:#8a7a6a;font-size:13px;">This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>
    </div>`;
  return sendMail({ to, subject, text, html });
}

module.exports = { isConfigured, sendMail, sendPasswordReset };
