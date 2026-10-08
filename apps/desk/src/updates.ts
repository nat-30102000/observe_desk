export interface UpdatesState {
  /** False in development and in builds without an update key. */
  enabled: boolean;
  current: string;
  checking: boolean;
  available: { version: string; notes?: string } | null;
  installing: boolean;
  /** 0 to 1 while downloading, null when the size is unknown. */
  progress: number | null;
  lastChecked: string | null;
  error: string | null;
}

export const INITIAL_UPDATES: UpdatesState = {
  enabled: false,
  current: '',
  checking: false,
  available: null,
  installing: false,
  progress: null,
  lastChecked: null,
  error: null,
};

export interface UpdateHandle {
  version: string;
  notes?: string;
  /** Downloads, verifies the signature and installs. */
  install(onProgress: (fraction: number | null) => void): Promise<void>;
}

/** The pieces that touch the OS, so the logic below can be tested. */
export interface UpdaterApi {
  enabled(): Promise<boolean>;
  version(): Promise<string>;
  check(): Promise<UpdateHandle | null>;
  restart(): Promise<void>;
}

export interface UpdateOptions {
  /** Look for updates in the background. */
  autoCheck: boolean;
  /** Install without asking, when Nib is idle. */
  autoInstall: boolean;
}

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Looks for new versions, tells you once per version, and installs on request (or automatically
 * when allowed and nothing is being filed). The update is verified against the app's built-in
 * public key by the updater before it is installed.
 */
export class UpdateService {
  state: UpdatesState = INITIAL_UPDATES;
  private handle: UpdateHandle | null = null;
  private announced = '';
  private timers: Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>> = [];

  constructor(
    private readonly api: UpdaterApi,
    private readonly publish: (s: UpdatesState) => void,
    private readonly say: (text: string) => void,
    private readonly options: () => UpdateOptions,
    /** True while captures are being filed; auto-install waits. */
    private readonly busy: () => boolean,
  ) {}

  private set(patch: Partial<UpdatesState>): void {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }

  async start(): Promise<void> {
    const enabled = await this.api.enabled().catch(() => false);
    this.set({ enabled, current: await this.api.version().catch(() => '') });
    if (!enabled) return;
    this.timers.push(setTimeout(() => void this.backgroundCheck(), FIRST_CHECK_MS), setInterval(() => void this.backgroundCheck(), CHECK_EVERY_MS));
  }

  stop(): void {
    this.timers.forEach((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.timers.forEach((t) => clearInterval(t as ReturnType<typeof setInterval>));
    this.timers = [];
  }

  private async backgroundCheck(): Promise<void> {
    if (!this.options().autoCheck || this.state.installing) return;
    await this.checkNow(true);
    if (this.handle && this.options().autoInstall && !this.busy()) await this.install();
  }

  /** `quiet` means a background check: no error messages, only the announcement of a new version. */
  async checkNow(quiet = false): Promise<void> {
    if (!this.state.enabled || this.state.checking || this.state.installing) return;
    this.set({ checking: true, error: null });
    try {
      this.handle = await this.api.check();
      this.set({ available: this.handle ? { version: this.handle.version, notes: this.handle.notes } : null, lastChecked: new Date().toISOString() });
      if (this.handle && this.announced !== this.handle.version) {
        this.announced = this.handle.version;
        this.say(`A new version of me is out: ${this.handle.version}! Tap me and choose Update, or open Settings.`);
      }
    } catch (e) {
      this.set({ error: quiet ? null : `Could not check for updates: ${message(e)}`, lastChecked: new Date().toISOString() });
    } finally {
      this.set({ checking: false });
    }
  }

  async install(): Promise<void> {
    if (!this.handle || this.state.installing) return;
    this.set({ installing: true, progress: null, error: null });
    try {
      await this.handle.install((p) => this.set({ progress: p }));
      this.say('All updated! Restarting in a moment...');
      await this.api.restart();
    } catch (e) {
      this.set({ installing: false, progress: null, error: `The update did not install: ${message(e)}` });
    }
  }
}
