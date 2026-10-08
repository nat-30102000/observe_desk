import { isTauri } from './platform';
import type { UpdaterApi } from './updates';

async function invoke<T>(cmd: string): Promise<T> {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  return inv<T>(cmd);
}

/** The real thing: Rust commands plus the Tauri updater plugin. */
export const tauriUpdater: UpdaterApi = {
  enabled: async () => isTauri() && (await invoke<boolean>('updates_enabled')),
  version: async () => (isTauri() ? invoke<string>('app_version') : ''),
  check: async () => {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? undefined,
      install: async (onProgress) => {
        let total = 0;
        let got = 0;
        await update.downloadAndInstall((ev) => {
          if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
          else if (ev.event === 'Progress') {
            got += ev.data.chunkLength;
            onProgress(total > 0 ? Math.min(1, got / total) : null);
          } else if (ev.event === 'Finished') onProgress(1);
        });
      },
    };
  },
  restart: () => invoke<void>('restart_app'),
};
