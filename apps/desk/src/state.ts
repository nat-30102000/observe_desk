import { DEFAULT_FOLDERS, type Folders } from '@observe/core';

export interface Settings {
  baseUrl: string;
  folders: Folders;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://127.0.0.1:27124',
  folders: DEFAULT_FOLDERS,
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
};
