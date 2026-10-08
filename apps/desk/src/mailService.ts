import { type Capture } from '@observe/core';
import { mailToCapture, parseMail, senderAllowed } from './email';
import { fromBase64, getSecret, imapFetch, loadJson, saveJson, type MailConfig } from './platform';
import type { EmailSettings } from './state';

export const MAIL_PASSWORD_SECRET = 'email-password';
const BATCH = 20;
const MAX_BATCHES_PER_POLL = 5;

interface MailState {
  /** host|user|folder, so changing the mailbox starts fresh. */
  key: string;
  uidValidity: number;
  lastUid: number;
}

export const mailKey = (s: EmailSettings): string => `${s.host.trim().toLowerCase()}|${s.username.trim().toLowerCase()}|${s.folder}`;

export async function mailConfig(s: EmailSettings): Promise<MailConfig | null> {
  const password = await getSecret(MAIL_PASSWORD_SECRET);
  if (!s.host.trim() || !s.username.trim() || !password) return null;
  return { host: s.host.trim(), port: s.port, tls: s.tls, username: s.username.trim(), password, folder: s.folder.trim() || 'INBOX' };
}

/** Quick check for the Settings screen. Returns how many messages the folder holds. */
export async function testMail(s: EmailSettings): Promise<number> {
  const cfg = await mailConfig(s);
  if (!cfg) throw new Error('Fill in the server, user name and password first.');
  return (await imapFetch(cfg, null, null, 0)).exists;
}

export interface PollResult {
  captures: Capture[];
  skippedSender: number;
  skippedTooBig: number;
}

/**
 * Looks for new mail and turns it into captures. The position is saved only after the captures were
 * handed over, so a crash re-reads (and, thanks to stable ids, does not duplicate) rather than loses mail.
 */
export async function pollMail(s: EmailSettings, hand: (c: Capture[]) => Promise<void>): Promise<PollResult> {
  const result: PollResult = { captures: [], skippedSender: 0, skippedTooBig: 0 };
  const cfg = await mailConfig(s);
  if (!cfg) return result;
  let state = await loadJson<MailState>('mail-state');
  if (state && state.key !== mailKey(s)) state = null;

  for (let round = 0; round < MAX_BATCHES_PER_POLL; round++) {
    const batch = await imapFetch(cfg, state?.uidValidity ?? null, state?.lastUid ?? null, BATCH);
    const found: Capture[] = [];
    for (const msg of batch.messages) {
      try {
        const mail = await parseMail(fromBase64(msg.raw_base64));
        if (!senderAllowed(mail.from.address, s.allowFrom)) {
          result.skippedSender++;
          continue;
        }
        const capture = mailToCapture(mail);
        if (capture) found.push(capture);
      } catch {
        /* a message we cannot read is skipped, not retried forever */
      }
    }
    result.skippedTooBig += batch.skipped.length;
    // First contact: begin at "now", or at the start when the user asked for the existing mail.
    const firstContact = !state;
    if (found.length) {
      await hand(found);
      result.captures.push(...found);
    }
    if (firstContact && s.importExisting && batch.last_uid > 0) {
      state = { key: mailKey(s), uidValidity: batch.uid_validity, lastUid: 0 };
      await saveJson('mail-state', state);
      continue;
    }
    state = { key: mailKey(s), uidValidity: batch.uid_validity, lastUid: batch.last_uid };
    await saveJson('mail-state', state);
    if (!batch.more) break;
  }
  return result;
}
