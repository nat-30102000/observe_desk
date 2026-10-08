import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventName } from '../platform';

/** Tauri rejects event names with any other character (a "?" once stopped the whole background engine). */
const VALID = /^[A-Za-z0-9\-/:_]+$/;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : sources(path.join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

describe('bus event names', () => {
  const names = new Set<string>();
  for (const file of sources(path.join(__dirname, '..'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\b(?:emitBus|listenBus)(?:<[^>(]*(?:\([^)]*\)[^>(]*)*>)?\(\s*'([^']+)'/g)) names.add(m[1] as string);
    for (const m of text.matchAll(/\blistenNative(?:<[^>(]*>)?\(\s*'([^']+)'/g)) names.add(m[1] as string);
  }

  it('finds the names in use', () => {
    expect(names.size).toBeGreaterThan(15);
    expect(names.has('capture')).toBe(true);
    expect(names.has('state-request')).toBe(true);
  });

  it('only uses characters Tauri allows', () => {
    const bad = [...names].filter((n) => !VALID.test(eventName(n)));
    expect(bad).toEqual([]);
  });
});
