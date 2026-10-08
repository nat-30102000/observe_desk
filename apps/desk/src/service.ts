import {
  AuthError,
  CaptureQueue,
  ObsidianClient,
  OfflineError,
  captureFromExtension,
  dueReminders,
  listSubscriptions,
  type Reminder,
  speechForFlush,
  type Capture,
  type QueueItem,
} from '@observe/core';
import { emitBus, fileStore, getSecret, listenBus, listenNative, loadJson, obsidianFetch, saveJson } from './platform';
import { FeedService } from './feedService';
import { pollMail } from './mailService';
import { tauriUpdater } from './updaterApi';
import { UpdateService } from './updates';
import { DEFAULT_SETTINGS, INITIAL_STATE, type AppState, type QueuedSummary, type Settings } from './state';

export const KEY_SECRET = 'obsidian-api-key';
const SYNC_EVERY_MS = 30_000;
const RECENT_LIMIT = 20;
const REMINDER_EVERY_MS = 60 * 60_000;

const localToday = (): string => new Date().toLocaleDateString('en-CA');

function reminderText(r: Reminder, more: number): string {
  const when = r.days === 1 ? 'tomorrow' : `in ${r.days} days`;
  const money = `${r.cost.toFixed(2)} ${r.currency}`;
  return `Psst! ${r.service} renews ${when} (${money}).${more > 0 ? ` Plus ${more} more soon.` : ''}`;
}

export async function loadSettings(): Promise<Settings> {
  const saved = await loadJson<Partial<Settings>>('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    folders: { ...DEFAULT_SETTINGS.folders, ...saved?.folders },
    ai: { providers: {}, ...saved?.ai },
    email: { ...DEFAULT_SETTINGS.email, ...saved?.email },
    updates: { ...DEFAULT_SETTINGS.updates, ...saved?.updates },
  };
}

export async function makeClient(settings: Settings): Promise<ObsidianClient | null> {
  const apiKey = await getSecret(KEY_SECRET);
  return apiKey ? new ObsidianClient({ baseUrl: settings.baseUrl, apiKey }, obsidianFetch) : null;
}

function titleOf(c: Capture): string {
  return c.kind === 'highlight' ? c.source.title : c.kind === 'file' ? c.name : c.title;
}

const summarize = (items: QueueItem[]): QueuedSummary[] =>
  items.map((i) => ({
    id: i.capture.id,
    kind: i.capture.kind,
    title: titleOf(i.capture),
    attempts: i.attempts,
    failed: i.failed === true,
    lastError: i.lastError,
  }));

/**
 * Owns the capture queue and talks to Obsidian. Only the pet window creates one (it is always
 * running), so the queue file never has two writers. Other windows send it messages.
 */
export class AppService {
  state: AppState = INITIAL_STATE;
  private settings: Settings = DEFAULT_SETTINGS;
  private client: ObsidianClient | null = null;
  private readonly queue = new CaptureQueue({
    load: async () => (await loadJson<QueueItem[]>('queue')) ?? [],
    save: (items) => saveJson('queue', items),
  });
  private readonly listeners = new Set<(s: AppState) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly unlisten: Array<() => void> = [];
  private lastSpeech = '';
  private readonly feeds = new FeedService((t) => this.say(t));
  private reminderTimer: ReturnType<typeof setInterval> | undefined;
  private seenReminders = new Set<string>();

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private publish(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
    void emitBus('state', this.state);
  }

  say(text: string): void {
    this.publish({ speech: { text, at: Date.now() } });
  }

  async start(): Promise<void> {
    await this.reloadSettings();
    this.unlisten.push(
      await listenBus<Capture>('capture', (c) => void this.capture(c)),
      await listenBus<void>('updates:check', () => void this.updater.checkNow()),
      await listenBus<void>('updates:install', () => void this.updater.install()),
      await listenBus<Capture[]>('capture-batch', (cs) => void this.captureMany(cs)),
      await listenBus<void>('settings-changed', () => void this.reloadSettings().then(() => this.sync()).then(() => this.checkMail())),
      await listenBus<void>('sync', () => void this.sync()),
      await listenBus<void>('retry-failed', () => void this.queue.retryFailed().then(() => this.sync())),
      await listenBus<void>('subs-changed', () => void this.checkReminders()),
      await listenBus<void>('state-request', () => void emitBus('state', this.state)),
      await listenNative<unknown>('ext-capture', (raw) => {
        const c = captureFromExtension(raw);
        if (c) void this.capture(c);
        else this.say("The browser extension sent something I couldn't read.");
      }),
    );
    this.timer = setInterval(() => void this.sync(), SYNC_EVERY_MS);
    await this.sync();
    await this.feeds.start();
    void this.updater.start();
    this.seenReminders = new Set((await loadJson<string[]>('reminders-seen')) ?? []);
    this.reminderTimer = setInterval(() => void this.checkReminders(), REMINDER_EVERY_MS);
    void this.checkReminders();
    void this.checkMail();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    clearTimeout(this.mailTimer);
    this.feeds.stop();
    this.updater.stop();
    this.unlisten.forEach((u) => u());
  }

  private async reloadSettings(): Promise<void> {
    this.settings = await loadSettings();
    this.client = await makeClient(this.settings);
    this.publish({ configured: this.client !== null });
  }

  /** Looks at the Subscriptions notes and tells you once per renewal milestone (7 days, 1 day). */
  async checkReminders(): Promise<void> {
    if (!this.client || this.state.offline) return;
    try {
      const subs = await listSubscriptions(this.client, this.settings.folders);
      const key = (r: Reminder) => `${r.service}:${r.date}:${r.days}`;
      const fresh = dueReminders(subs, localToday()).filter((r) => !this.seenReminders.has(key(r)));
      if (fresh.length === 0) return;
      fresh.forEach((r) => this.seenReminders.add(key(r)));
      await saveJson('reminders-seen', [...this.seenReminders].slice(-200));
      this.say(reminderText(fresh[0] as Reminder, fresh.length - 1));
    } catch {
      /* Obsidian closed or key wrong: the next hourly check tries again. */
    }
  }

  /** Imports and mail: many captures, one save. */
  async captureMany(cs: Capture[]): Promise<void> {
    const added = await this.queue.enqueueMany(cs);
    await this.refreshQueueView();
    if (added > 0 && cs.length > 3) this.say(`Got ${added} items to file. This may take a little while.`);
    await this.sync();
  }

  private readonly updater = new UpdateService(
    tauriUpdater,
    (updates) => this.publish({ updates }),
    (text) => this.say(text),
    () => this.settings.updates,
    () => this.state.pending > 0 || this.syncing,
  );

  private mailBusy = false;
  private mailTimer: ReturnType<typeof setTimeout> | undefined;

  /** Checks the mailbox for forwarded mail and newsletters, then schedules the next check. */
  async checkMail(): Promise<void> {
    clearTimeout(this.mailTimer);
    const cfg = this.settings.email;
    if (!cfg.enabled || this.mailBusy) return void this.scheduleMail();
    this.mailBusy = true;
    try {
      const r = await pollMail(cfg, (found) => this.captureMany(found));
      if (r.captures.length > 0) this.say(`You've got mail! ${r.captures.length} new ${r.captures.length === 1 ? 'note' : 'notes'} from your inbox.`);
    } catch (e) {
      this.say(`I could not read your mailbox: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.mailBusy = false;
      this.scheduleMail();
    }
  }

  private scheduleMail(): void {
    clearTimeout(this.mailTimer);
    if (this.settings.email.enabled) this.mailTimer = setTimeout(() => void this.checkMail(), Math.max(1, this.settings.email.everyMinutes) * 60_000);
  }

  async capture(c: Capture): Promise<void> {
    await this.queue.enqueue(c);
    await this.refreshQueueView();
    await this.sync();
  }

  private async refreshQueueView(): Promise<void> {
    const items = await this.queue.list();
    this.publish({
      queue: summarize(items),
      pending: items.filter((i) => !i.failed).length,
      failed: items.filter((i) => i.failed).length,
    });
  }

  private syncing = false;
  private syncAgain = false;

  async sync(): Promise<void> {
    // A long import keeps one sync busy; ask for another pass afterwards instead of stacking calls.
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      await this.syncOnce();
    } finally {
      this.syncing = false;
      if (this.syncAgain) {
        this.syncAgain = false;
        void this.sync();
      }
    }
  }

  private async syncOnce(): Promise<void> {
    if (!this.client) {
      await this.refreshQueueView();
      this.publish({ configured: false, connected: false });
      return;
    }
    try {
      const r = await this.queue.flush(this.client, this.settings.folders, { files: fileStore }, (done, total) => {
        // Show a long import moving without redrawing for every item.
        if (done % 25 === 0) this.publish({ pending: Math.max(0, total - done) });
      });
      let connected = !r.offline && !r.authError;
      let offline = r.offline;
      let authError = r.authError;
      if (r.written.length === 0 && !r.offline && !r.authError) {
        // Nothing to write: still check that Obsidian and the key are good.
        try {
          const s = await this.client.status();
          authError = !s.authenticated;
          connected = s.authenticated;
          offline = false;
        } catch (e) {
          offline = e instanceof OfflineError;
          authError = e instanceof AuthError;
          connected = false;
        }
      }
      const items = await this.queue.list();
      const recent = [
        ...r.written
          .filter((w) => w.action !== 'unchanged')
          .map((w) => ({
            id: w.id,
            title: w.path.replace(/^.*\//, '').replace(/\.md$/, ''),
            path: w.path,
            action: w.action,
            at: new Date().toISOString(),
          }))
          .reverse(),
        ...this.state.recent,
      ].slice(0, RECENT_LIMIT);
      this.publish({
        connected,
        offline,
        authError,
        pending: r.pending,
        failed: r.failed,
        queue: summarize(items),
        recent,
      });
      const speech = speechForFlush({ ...r, written: r.written.length, offline, authError });
      // Don't repeat the same worry every sync; speak again only when something changes.
      if (!speech) this.lastSpeech = '';
      else if (r.written.length > 0 || speech.text !== this.lastSpeech) {
        this.lastSpeech = speech.text;
        this.say(speech.text);
      }
    } catch (e) {
      this.say(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
