import { DEFAULT_FOLDERS, type Folders, type ProviderId } from '@observe/core';
import { INITIAL_UPDATES, type UpdatesState } from './updates';

export interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  /** Encrypted connection (recommended). Only a mail server on this computer may turn it off. */
  tls: boolean;
  username: string;
  folder: string;
  /** Minutes between checks. */
  everyMinutes: number;
  /** Only mail from these addresses or domains becomes a note. Empty allows everyone. */
  allowFrom: string[];
  /** On first connection, also import what is already in the mailbox. */
  importExisting: boolean;
}

export const DEFAULT_EMAIL: EmailSettings = {
  enabled: false,
  host: '',
  port: 993,
  tls: true,
  username: '',
  folder: 'INBOX',
  everyMinutes: 5,
  allowFrom: [],
  importExisting: false,
};

export interface AiSettings {
  summaryProvider?: ProviderId;
  tagProvider?: ProviderId;
  /** Which provider turns voice notes into text (OpenAI or Gemini). */
  voiceProvider?: ProviderId;
  /** Model for OpenAI's transcription endpoint. */
  transcribeModel?: string;
  /** Per-provider overrides. The API key itself lives in the secret store, never here. */
  providers: Partial<Record<ProviderId, { model?: string; baseUrl?: string }>>;
}

export interface UpdateSettings {
  /** Look for new versions in the background. */
  autoCheck: boolean;
  /** Install them without asking when Nib is idle. */
  autoInstall: boolean;
}

export interface Settings {
  baseUrl: string;
  folders: Folders;
  ai: AiSettings;
  email: EmailSettings;
  updates: UpdateSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://127.0.0.1:27124',
  folders: DEFAULT_FOLDERS,
  ai: { providers: {} },
  email: DEFAULT_EMAIL,
  updates: { autoCheck: true, autoInstall: false },
};

export interface RecentItem {
  id: string;
  title: string;
  path: string;
  action: 'created' | 'appended' | 'unchanged';
  at: string;
}

export interface QueuedSummary {
  id: string;
  kind: string;
  title: string;
  attempts: number;
  failed: boolean;
  lastError?: string;
}

/** Broadcast by the pet window (the only window that owns the queue) to every other window. */
export interface AppState {
  configured: boolean;
  connected: boolean;
  offline: boolean;
  authError: boolean;
  pending: number;
  failed: number;
  queue: QueuedSummary[];
  recent: RecentItem[];
  /** Latest thing Nib wants to say. `at` changes on every message so repeats still show. */
  speech: { text: string; at: number } | null;
  updates: UpdatesState;
}

export const INITIAL_STATE: AppState = {
  configured: false,
  connected: false,
  offline: false,
  authError: false,
  pending: 0,
  failed: 0,
  queue: [],
  recent: [],
  speech: null,
  updates: INITIAL_UPDATES,
};
