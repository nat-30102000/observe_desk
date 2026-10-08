import type { FetchInit, FetchLike, FetchResponse } from '../src/obsidian';

/** In-memory stand-in for the Obsidian Local REST API. */
export class FakeVault {
  files = new Map<string, string>();
  online = true;
  key = 'secret';
  calls: string[] = [];
  /** Respond 500 for this many upcoming writes. */
  failWrites = 0;

  fetch: FetchLike = async (url: string, init: FetchInit): Promise<FetchResponse> => {
    const res = (status: number, body = ''): FetchResponse => ({ status, text: async () => body });
    if (!this.online) throw new TypeError('fetch failed');
    const u = new URL(url);
    this.calls.push(`${init.method} ${u.pathname}`);
    if (u.pathname === '/') {
      return res(200, JSON.stringify({ status: 'OK', service: 'Obsidian Local REST API', authenticated: init.headers['Authorization'] === `Bearer ${this.key}`, versions: { self: '3.0.0' } }));
    }
    if (init.headers['Authorization'] !== `Bearer ${this.key}`) return res(401, 'unauthorized');
    const path = decodeURIComponent(u.pathname.replace(/^\/vault\//, ''));
    if (init.method === 'GET' && path.endsWith('/')) {
      const names = [...this.files.keys()].filter((k) => k.startsWith(path)).map((k) => k.slice(path.length));
      return names.length ? res(200, JSON.stringify({ files: names })) : res(404);
    }
    if (init.method === 'GET') {
      const f = this.files.get(path);
      return f === undefined ? res(404) : res(200, f);
    }
    if (init.method === 'PUT' || init.method === 'POST') {
      if (this.failWrites > 0) {
        this.failWrites--;
        return res(500, 'boom');
      }
      if (init.method === 'PUT') this.files.set(path, init.body ?? '');
      else this.files.set(path, (this.files.get(path) ?? '') + (init.body ?? ''));
      return res(204);
    }
    return res(405);
  };
}
