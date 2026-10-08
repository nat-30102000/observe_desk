import { AuthError, HttpError, OfflineError } from './errors';

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchResponse {
  status: number;
  text(): Promise<string>;
}

/** Minimal fetch shape, so the desktop app can route requests through Rust (self-signed cert). */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface ObsidianConfig {
  /** e.g. https://127.0.0.1:27124 */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface ObsidianStatus {
  authenticated: boolean;
  service?: string;
  version?: string;
}

/** Encode a vault-relative path for the REST API, keeping the slashes. */
export function encodeVaultPath(path: string): string {
  return path
    .split('/')
    .filter((p) => p.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

export class ObsidianClient {
  constructor(
    private readonly config: ObsidianConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  private async request(
    method: string,
    path: string,
    opts: { body?: string; contentType?: string; accept?: string } = {},
  ): Promise<FetchResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
    if (opts.accept) headers['Accept'] = opts.accept;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5000);
    let res: FetchResponse;
    try {
      res = await this.fetchImpl(this.config.baseUrl.replace(/\/+$/, '') + path, {
        method,
        headers,
        body: opts.body,
        signal: controller.signal,
      });
    } catch (e) {
      throw new OfflineError(e instanceof Error ? e.message : undefined);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new AuthError();
    return res;
  }

  private async expectOk(res: FetchResponse): Promise<void> {
    if (res.status >= 200 && res.status < 300) return;
    throw new HttpError(res.status, await res.text().catch(() => ''));
  }

  /** Connection test. GET / does not require the key but reports whether it was accepted. */
  async status(): Promise<ObsidianStatus> {
    const res = await this.request('GET', '/', { accept: 'application/json' });
    await this.expectOk(res);
    const data = JSON.parse(await res.text()) as {
      authenticated?: boolean;
      service?: string;
      versions?: { self?: string };
    };
    return {
      authenticated: data.authenticated === true,
      service: data.service,
      version: data.versions?.self,
    };
  }

  /** Returns null when the note does not exist. */
  async getNote(path: string): Promise<string | null> {
    const res = await this.request('GET', `/vault/${encodeVaultPath(path)}`, {
      accept: 'text/markdown',
    });
    if (res.status === 404) return null;
    await this.expectOk(res);
    return res.text();
  }

  /** Create or replace a note. */
  async putNote(path: string, content: string): Promise<void> {
    const res = await this.request('PUT', `/vault/${encodeVaultPath(path)}`, {
      body: content,
      contentType: 'text/markdown',
    });
    await this.expectOk(res);
  }

  /** Append to a note, creating it if needed. */
  async appendNote(path: string, content: string): Promise<void> {
    const res = await this.request('POST', `/vault/${encodeVaultPath(path)}`, {
      body: content,
      contentType: 'text/markdown',
    });
    await this.expectOk(res);
  }

  /** File names inside a folder (folders end with "/"). Empty when the folder does not exist. */
  async listDir(dir: string): Promise<string[]> {
    const res = await this.request('GET', `/vault/${encodeVaultPath(dir)}/`, {
      accept: 'application/json',
    });
    if (res.status === 404) return [];
    await this.expectOk(res);
    const data = JSON.parse(await res.text()) as { files?: string[] };
    return data.files ?? [];
  }
}
