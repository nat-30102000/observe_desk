import { AuthError, HttpError, OfflineError } from './errors';
import type { ObsidianClient } from './obsidian';
import type { Capture, Folders } from './types';
import { writeCapture, type WriteDeps, type WriteResult } from './writer';

export const MAX_ATTEMPTS = 5;

export interface QueueItem {
  capture: Capture;
  attempts: number;
  lastError?: string;
  /** Gave up after MAX_ATTEMPTS server errors. Kept so the user can retry or inspect it. */
  failed?: boolean;
}

/** Where the queue is persisted. The desktop app supplies a file-backed one. */
export interface QueueStorage {
  load(): Promise<QueueItem[]>;
  save(items: QueueItem[]): Promise<void>;
}

export class MemoryStorage implements QueueStorage {
  private items: QueueItem[] = [];
  async load(): Promise<QueueItem[]> {
    return structuredClone(this.items);
  }
  async save(items: QueueItem[]): Promise<void> {
    this.items = structuredClone(items);
  }
}

export interface FlushResult {
  written: Array<WriteResult & { id: string }>;
  /** Items still waiting (not failed). */
  pending: number;
  failed: number;
  offline: boolean;
  authError: boolean;
}

export class CaptureQueue {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: QueueStorage) {}

  /** Serialise all mutations so enqueue and flush never interleave. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  list(): Promise<QueueItem[]> {
    return this.exclusive(() => this.storage.load());
  }

  async pendingCount(): Promise<number> {
    return (await this.list()).filter((i) => !i.failed).length;
  }

  enqueue(capture: Capture): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.storage.load();
      if (items.some((i) => i.capture.id === capture.id)) return;
      items.push({ capture, attempts: 0 });
      await this.storage.save(items);
    });
  }

  /** Many captures with one save (imports can be thousands). Ids already queued are skipped. */
  enqueueMany(captures: Capture[]): Promise<number> {
    return this.exclusive(async () => {
      const items = await this.storage.load();
      const have = new Set(items.map((i) => i.capture.id));
      let added = 0;
      for (const capture of captures) {
        if (have.has(capture.id)) continue;
        have.add(capture.id);
        items.push({ capture, attempts: 0 });
        added++;
      }
      if (added > 0) await this.storage.save(items);
      return added;
    });
  }

  /** Put failed items back in line. */
  retryFailed(): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.storage.load();
      for (const i of items) {
        if (i.failed) {
          i.failed = false;
          i.attempts = 0;
        }
      }
      await this.storage.save(items);
    });
  }

  /** Write queued captures to the vault in order. Stops at the first connection or key problem. */
  flush(client: ObsidianClient, folders: Folders, deps: WriteDeps = {}): Promise<FlushResult> {
    return this.exclusive(async () => {
      const items = await this.storage.load();
      const written: FlushResult['written'] = [];
      let offline = false;
      let authError = false;
      const remaining: QueueItem[] = [];

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx] as QueueItem;
        if (item.failed) {
          remaining.push(item);
          continue;
        }
        try {
          const res = await writeCapture(client, folders, item.capture, deps);
          written.push({ ...res, id: item.capture.id });
        } catch (e) {
          if (e instanceof OfflineError) offline = true;
          else if (e instanceof AuthError) authError = true;
          if (offline || authError) {
            remaining.push(item, ...items.slice(idx + 1));
            break;
          }
          item.attempts += 1;
          item.lastError = e instanceof HttpError || e instanceof Error ? e.message : String(e);
          if (item.attempts >= MAX_ATTEMPTS) item.failed = true;
          remaining.push(item);
        }
      }

      await this.storage.save(remaining);
      return {
        written,
        pending: remaining.filter((i) => !i.failed).length,
        failed: remaining.filter((i) => i.failed).length,
        offline,
        authError,
      };
    });
  }
}
