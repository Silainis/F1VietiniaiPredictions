import { esc } from './util.js';

// Sends email through Resend (https://resend.com). If RESEND_API_KEY or MAIL_FROM
// is not configured, this quietly does nothing, so the app works without email.
export async function sendMail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }),
    });
    if (!res.ok) console.error('Email failed', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('Email error', e);
    return false;
  }
}

export function emailTemplate(env, title, bodyHtml, link, linkLabel) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111">
    <h2 style="color:#e10600;margin-bottom:4px">${esc(env.APP_NAME || 'F1 Predictions')}</h2>
    <h3 style="margin-top:0">${esc(title)}</h3>
    ${bodyHtml}
    ${link ? `<p><a href="${esc(link)}" style="background:#e10600;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${esc(linkLabel || 'Open')}</a></p>` : ''}
  </div>`;
}
