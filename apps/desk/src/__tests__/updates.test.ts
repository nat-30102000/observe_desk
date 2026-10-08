import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateService, type UpdateHandle, type UpdaterApi, type UpdateOptions, type UpdatesState } from '../updates';

function setup(over: Partial<UpdaterApi> = {}, options: UpdateOptions = { autoCheck: true, autoInstall: false }, busy = false) {
  const said: string[] = [];
  const states: UpdatesState[] = [];
  const installed: string[] = [];
  const handle: UpdateHandle = { version: '0.2.0', notes: 'Fixes', install: async (p) => { p(0.5); p(1); installed.push('0.2.0'); } };
  const api: UpdaterApi = { enabled: async () => true, version: async () => '0.1.0', check: async () => handle, restart: async () => { installed.push('restart'); }, ...over };
  const svc = new UpdateService(api, (s) => states.push(s), (t) => said.push(t), () => options, () => busy);
  return { svc, said, states, installed };
}

describe('UpdateService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays off when the build has no update key', async () => {
    const t = setup({ enabled: async () => false, check: async () => { throw new Error('must not be called'); } });
    await t.svc.start();
    await vi.advanceTimersByTimeAsync(7 * 60 * 60_000);
    expect(t.svc.state).toMatchObject({ enabled: false, current: '0.1.0' });
    await t.svc.checkNow();
    expect(t.svc.state.error).toBeNull();
  });

  it('checks shortly after start, announces a new version once, then every six hours', async () => {
    const t = setup();
    await t.svc.start();
    expect(t.svc.state.available).toBeNull();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(t.svc.state.available).toEqual({ version: '0.2.0', notes: 'Fixes' });
    expect(t.said).toHaveLength(1);
    expect(t.said[0]).toContain('0.2.0');
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    expect(t.said).toHaveLength(1); // same version: not announced twice
    t.svc.stop();
  });

  it('does not check in the background when automatic checks are off, but a manual check works', async () => {
    const t = setup({}, { autoCheck: false, autoInstall: false });
    await t.svc.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.svc.state.available).toBeNull();
    await t.svc.checkNow();
    expect(t.svc.state.available?.version).toBe('0.2.0');
    t.svc.stop();
  });

  it('reports "no update" as available = null and a failed manual check as an error, but stays quiet in the background', async () => {
    const none = setup({ check: async () => null });
    await none.svc.start();
    await none.svc.checkNow();
    expect(none.svc.state).toMatchObject({ available: null, error: null });
    expect(none.svc.state.lastChecked).not.toBeNull();

    const bad = setup({ check: async () => { throw new Error('offline'); } });
    await bad.svc.start();
    await bad.svc.checkNow();
    expect(bad.svc.state.error).toMatch(/offline/);
    await bad.svc.checkNow(true);
    expect(bad.svc.state.error).toBeNull();
    expect(bad.svc.state.checking).toBe(false);
  });

  it('installs, shows progress, then restarts', async () => {
    const t = setup();
    await t.svc.start();
    await t.svc.checkNow();
    await t.svc.install();
    expect(t.installed).toEqual(['0.2.0', 'restart']);
    expect(t.states.some((s) => s.progress === 0.5)).toBe(true);
    expect(t.said.at(-1)).toMatch(/Restarting/);
  });

  it('a failed install reports the error and stays usable', async () => {
    const handle: UpdateHandle = { version: '0.2.0', install: async () => { throw new Error('signature mismatch'); } };
    const t = setup({ check: async () => handle });
    await t.svc.start();
    await t.svc.checkNow();
    await t.svc.install();
    expect(t.svc.state).toMatchObject({ installing: false, progress: null });
    expect(t.svc.state.error).toMatch(/signature mismatch/);
    expect(t.installed).toEqual([]);
  });

  it('installs by itself only when allowed and nothing is being filed', async () => {
    const auto = setup({}, { autoCheck: true, autoInstall: true });
    await auto.svc.start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(auto.installed).toEqual(['0.2.0', 'restart']);

    const busy = setup({}, { autoCheck: true, autoInstall: true }, true);
    await busy.svc.start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(busy.installed).toEqual([]);
    expect(busy.svc.state.available?.version).toBe('0.2.0');

    const ask = setup({}, { autoCheck: true, autoInstall: false });
    await ask.svc.start();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ask.installed).toEqual([]);
    auto.svc.stop(); busy.svc.stop(); ask.svc.stop();
  });

  it('ignores a second install while one is running', async () => {
    let calls = 0;
    const handle: UpdateHandle = { version: '0.2.0', install: async () => { calls++; await new Promise((r) => setTimeout(r, 1000)); } };
    const t = setup({ check: async () => handle });
    await t.svc.start();
    await t.svc.checkNow();
    const first = t.svc.install();
    await t.svc.install();
    await vi.advanceTimersByTimeAsync(1000);
    await first;
    expect(calls).toBe(1);
  });
});
