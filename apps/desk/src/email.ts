import { stableId, type MarkdownCapture } from '@observe/core';
import PostalMime from 'postal-mime';
import { htmlToMarkdown, sanitizeHtml } from './article';

export interface ParsedMail {
  from: { name: string; address: string };
  subject: string;
  date?: Date;
  messageId?: string;
  html?: string;
  text?: string;
  attachments: string[];
  /** Mailing-list headers are present: it is a newsletter. */
  list: boolean;
}

const MAX_BODY = 200_000;

export async function parseMail(raw: Uint8Array): Promise<ParsedMail> {
  const m = await PostalMime.parse(raw);
  const has = (name: string) => m.headers.some((h) => h.key.toLowerCase() === name);
  const parsedDate = m.date ? new Date(m.date) : undefined;
  return {
    from: { name: m.from?.name ?? '', address: (m.from?.address ?? '').toLowerCase() },
    subject: (m.subject ?? '').trim(),
    date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : undefined,
    messageId: m.messageId?.trim() || undefined,
    html: m.html || undefined,
    text: m.text || undefined,
    attachments: m.attachments.map((a) => a.filename || 'unnamed').slice(0, 20),
    list: has('list-unsubscribe') || has('list-id'),
  };
}

/** Allowed senders: full addresses or whole domains ("@example.com" or "example.com"). Empty list allows everyone. */
export function senderAllowed(address: string, allow: string[]): boolean {
  const list = allow.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  const addr = address.toLowerCase();
  const domain = addr.split('@')[1] ?? '';
  return list.some((a) => a === addr || a.replace(/^@/, '') === domain);
}

/** Email html to markdown. Pictures become their alt text, because a remote image in a note would tell the sender when you open it. */
export function mailHtmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img').forEach((img) => {
    const alt = img.getAttribute('alt')?.trim();
    if (alt && alt.length < 120) {
      const em = doc.createElement('em');
      em.textContent = alt;
      img.replaceWith(em);
    } else img.remove();
  });
  doc.querySelectorAll('table').forEach((t) => {
    // Layout tables are how newsletters are built; flatten them to their content.
    const div = doc.createElement('div');
    div.innerHTML = t.innerHTML.replace(/<\/?(table|tbody|thead|tfoot|tr|td|th)\b[^>]*>/gi, '<br>');
    t.replaceWith(div);
  });
  const md = htmlToMarkdown(sanitizeHtml(doc.body.innerHTML));
  return md.replace(/\n{3,}/g, '\n\n').replace(/\[\s*\]\([^)]*\)/g, '').trim();
}

export function mailToCapture(mail: ParsedMail, now = new Date()): MarkdownCapture | null {
  const body = mail.html ? mailHtmlToMarkdown(mail.html) : (mail.text ?? '').trim();
  if (!body && !mail.subject) return null;
  const when = mail.date ?? now;
  const sender = mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address;
  const lines = [`**From:** ${sender}  `, `**Date:** ${when.toISOString().slice(0, 16).replace('T', ' ')}  `, `**Subject:** ${mail.subject || '(no subject)'}`, '', '---', '', body.slice(0, MAX_BODY) || '_This email has no text._'];
  if (mail.attachments.length) lines.push('', `_Attachments not saved: ${mail.attachments.join(', ')}_`);
  return {
    kind: 'markdown',
    id: stableId('mail', mail.messageId ?? `${mail.from.address}|${when.toISOString()}|${mail.subject}`),
    createdAt: when.toISOString(),
    title: mail.subject || `Email from ${mail.from.name || mail.from.address}`,
    body: lines.join('\n'),
    tags: mail.list ? ['email', 'newsletter'] : ['email'],
    meta: { source: 'email', from: mail.from.address, subject: mail.subject, received: when.toISOString(), ...(mail.messageId ? { message_id: mail.messageId } : {}) },
  };
}
