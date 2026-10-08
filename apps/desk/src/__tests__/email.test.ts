import { describe, expect, it } from 'vitest';
import { mailHtmlToMarkdown, mailToCapture, parseMail, senderAllowed } from '../email';

const enc = (s: string) => new TextEncoder().encode(s.replace(/\n/g, '\r\n'));

const NEWSLETTER = `From: "Weekly Digest" <news@digest.example>
To: me@example.com
Subject: Five tools for thinking
Date: Wed, 07 Oct 2026 09:30:00 +0000
Message-ID: <abc123@digest.example>
List-Unsubscribe: <https://digest.example/unsub>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: multipart/alternative; boundary="A"

--A
Content-Type: text/plain; charset=utf-8

Plain version of the digest.
--A
Content-Type: text/html; charset=utf-8

<html><body><table><tr><td><h1>Five tools</h1><p>Read <a href="https://example.com/x">this article</a> now.</p>
<img src="https://tracker.example/pixel.gif" width="1" height="1">
<img src="https://cdn.example/hero.png" alt="Hero picture"><script>alert(1)</script></td></tr></table></body></html>
--A--
--B
Content-Type: application/pdf; name="report.pdf"
Content-Disposition: attachment; filename="report.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--B--
`;

describe('email parsing', () => {
  it('reads headers, body parts, attachments and list headers', async () => {
    const m = await parseMail(enc(NEWSLETTER));
    expect(m).toMatchObject({ from: { name: 'Weekly Digest', address: 'news@digest.example' }, subject: 'Five tools for thinking', messageId: '<abc123@digest.example>', list: true, attachments: ['report.pdf'] });
    expect(m.date?.toISOString()).toBe('2026-10-07T09:30:00.000Z');
    expect(m.text).toContain('Plain version');
  });
  it('turns the html into clean markdown without trackers, scripts or remote images', async () => {
    const c = mailToCapture(await parseMail(enc(NEWSLETTER)))!;
    expect(c.body).toContain('**From:** Weekly Digest <news@digest.example>');
    expect(c.body).toContain('# Five tools');
    expect(c.body).toContain('[this article](https://example.com/x)');
    expect(c.body).toContain('_Hero picture_');
    expect(c.body).not.toMatch(/tracker\.example|pixel|<script|alert\(1\)|!\[/);
    expect(c.body).toContain('_Attachments not saved: report.pdf_');
    expect(c).toMatchObject({ title: 'Five tools for thinking', tags: ['email', 'newsletter'], meta: { source: 'email', from: 'news@digest.example', message_id: '<abc123@digest.example>' } });
  });
  it('gives the same id for the same message so a re-fetch never duplicates', async () => {
    const a = mailToCapture(await parseMail(enc(NEWSLETTER)))!;
    const b = mailToCapture(await parseMail(enc(NEWSLETTER)), new Date())!;
    expect(a.id).toBe(b.id);
  });
  it('handles plain-text mail with no subject and ignores empty mail', async () => {
    const c = mailToCapture(await parseMail(enc('From: bob@example.com\nDate: Wed, 07 Oct 2026 09:30:00 +0000\n\nJust a note to self.\n')))!;
    expect(c.title).toBe('Email from bob@example.com');
    expect(c.body).toContain('Just a note to self.');
    expect(c.tags).toEqual(['email']);
    expect(mailToCapture(await parseMail(enc('From: bob@example.com\n\n')))).toBeNull();
  });
  it('flattens layout tables and drops empty links', () => {
    const md = mailHtmlToMarkdown('<table><tr><td>One</td><td>Two</td></tr></table><a href="https://x.com"><img src="https://x.com/i.png"></a>');
    expect(md).toContain('One');
    expect(md).toContain('Two');
    expect(md).not.toContain('](');
  });
});

describe('senderAllowed', () => {
  it('allows everyone with no list, otherwise only listed addresses and domains', () => {
    expect(senderAllowed('a@b.com', [])).toBe(true);
    expect(senderAllowed('a@b.com', ['a@b.com'])).toBe(true);
    expect(senderAllowed('x@b.com', ['@b.com'])).toBe(true);
    expect(senderAllowed('x@b.com', ['b.com'])).toBe(true);
    expect(senderAllowed('x@evil-b.com', ['b.com'])).toBe(false);
    expect(senderAllowed('x@sub.b.com', ['b.com'])).toBe(false);
    expect(senderAllowed('A@B.com', [' a@b.com '])).toBe(true);
  });
});
