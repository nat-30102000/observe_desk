export type Mood =
  | 'idle'
  | 'curious'
  | 'nom'
  | 'sleepy'
  | 'reminder'
  | 'happy'
  | 'thinking'
  | 'listening'
  | 'worried'
  | 'cheese'
  | 'newsflash'
  | 'chill';

export interface PetSignals {
  pending: number;
  failed: number;
  offline: boolean;
  authError: boolean;
  /** Transient events set by the app (selection, drop, AI work...). Highest priority first. */
  transient?: Mood;
  doNotDisturb?: boolean;
}

/** Which mood Nib should show, given what the app knows right now. */
export function moodFor(s: PetSignals): Mood {
  if (s.doNotDisturb) return 'chill';
  if (s.transient) return s.transient;
  if (s.authError || s.failed > 0) return 'worried';
  if (s.offline && s.pending > 0) return 'sleepy';
  return 'idle';
}

export interface Speech {
  text: string;
}

/** What Nib says after a sync attempt. */
export function speechForFlush(r: {
  written: number;
  pending: number;
  failed: number;
  offline: boolean;
  authError: boolean;
}): Speech | null {
  if (r.authError) return { text: 'Uh-oh. Obsidian said no. Maybe the API key changed? Your captures are still safe.' };
  if (r.offline && r.pending > 0) {
    return { text: `Obsidian is asleep, so I'm holding ${r.pending} ${r.pending === 1 ? 'snack' : 'snacks'} for later.` };
  }
  if (r.failed > 0) return { text: `${r.failed} ${r.failed === 1 ? 'capture' : 'captures'} could not be filed. Open the Desk to retry.` };
  if (r.written > 0) return { text: r.written === 1 ? 'Filed it!' : `Filed ${r.written} captures!` };
  return null;
}
