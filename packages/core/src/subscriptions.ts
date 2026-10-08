import { parseFrontmatter, toFrontmatter } from './frontmatter';
import type { ObsidianClient } from './obsidian';
import { joinPath, sanitizeFileName } from './paths';
import type { Folders } from './types';

export type Cycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type SubStatus = 'active' | 'cancelling' | 'cancelled';

export interface Subscription {
  service: string;
  cost: number;
  currency: string;
  cycle: Cycle;
  /** YYYY-MM-DD */
  nextRenewal: string;
  status: SubStatus;
  category?: string;
  url?: string;
  notes?: string;
}

export const CYCLES: Cycle[] = ['weekly', 'monthly', 'quarterly', 'yearly'];
const MONTHS: Record<Cycle, number> = { weekly: 12 / 52, monthly: 1, quarterly: 3, yearly: 12 };

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const parseYmd = (s: string): Date => new Date(`${s}T00:00:00Z`);
export const isYmd = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseYmd(s).getTime());

/** Add one billing cycle, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addCycle(date: string, cycle: Cycle, times = 1): string {
  const d = parseYmd(date);
  if (cycle === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * times);
    return ymd(d);
  }
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + MONTHS[cycle] * times);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return ymd(d);
}

/** First renewal on or after `today`, rolling forward from a stale date. */
export function upcomingRenewal(sub: Pick<Subscription, 'nextRenewal' | 'cycle'>, today: string): string {
  let next = sub.nextRenewal;
  let guard = 0;
  while (next < today && guard++ < 1000) next = addCycle(next, sub.cycle);
  return next;
}

export function daysUntil(date: string, today: string): number {
  return Math.round((parseYmd(date).getTime() - parseYmd(today).getTime()) / 86_400_000);
}

export const monthlyCost = (s: Subscription): number => s.cost / MONTHS[s.cycle];

export interface Totals {
  currency: string;
  monthly: number;
  yearly: number;
}

/** Totals per currency, active and cancelling subscriptions only (cancelling ones still bill until they end). */
export function totals(subs: Subscription[]): Totals[] {
  const by = new Map<string, number>();
  for (const s of subs) {
    if (s.status === 'cancelled') continue;
    by.set(s.currency, (by.get(s.currency) ?? 0) + monthlyCost(s));
  }
  return [...by.entries()].map(([currency, m]) => ({ currency, monthly: round2(m), yearly: round2(m * 12) }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface Reminder {
  service: string;
  date: string;
  days: number;
  cost: number;
  currency: string;
}

/** Subscriptions renewing in exactly one of `leadDays` days (default 7 and 1). Cancelled ones are skipped. */
export function dueReminders(subs: Subscription[], today: string, leadDays: number[] = [7, 1]): Reminder[] {
  const out: Reminder[] = [];
  for (const s of subs) {
    if (s.status === 'cancelled') continue;
    const date = upcomingRenewal(s, today);
    const days = daysUntil(date, today);
    if (leadDays.includes(days)) out.push({ service: s.service, date, days, cost: s.cost, currency: s.currency });
  }
  return out.sort((a, b) => a.days - b.days);
}

export function subscriptionPath(folders: Folders, service: string): string {
  return joinPath(folders.subscriptions, `${sanitizeFileName(service)}.md`);
}

export function renderSubscription(s: Subscription): string {
  const fm = toFrontmatter({
    type: 'subscription',
    service: s.service,
    cost: s.cost,
    currency: s.currency,
    cycle: s.cycle,
    next_renewal: s.nextRenewal,
    status: s.status,
    ...(s.category ? { category: s.category } : {}),
    ...(s.url ? { url: s.url } : {}),
    tags: ['subscriptions'],
  });
  return `${fm}\n# ${s.service}\n${s.notes ? `\n${s.notes}\n` : ''}`;
}

/** Null when the note is not a valid subscription note. */
export function parseSubscription(text: string, fallbackName = ''): Subscription | null {
  const { data, body } = parseFrontmatter(text);
  if (data['type'] !== 'subscription') return null;
  const cost = data['cost'];
  const cycle = data['cycle'];
  const next = data['next_renewal'];
  if (typeof cost !== 'number' || !CYCLES.includes(cycle as Cycle) || typeof next !== 'string' || !isYmd(next)) return null;
  const status = (['active', 'cancelling', 'cancelled'] as const).find((x) => x === data['status']) ?? 'active';
  const notes = body.replace(/^# .*\n?/, '').trim();
  return {
    service: typeof data['service'] === 'string' ? data['service'] : fallbackName,
    cost,
    currency: typeof data['currency'] === 'string' ? data['currency'] : 'USD',
    cycle: cycle as Cycle,
    nextRenewal: next,
    status,
    category: typeof data['category'] === 'string' ? data['category'] : undefined,
    url: typeof data['url'] === 'string' ? data['url'] : undefined,
    notes: notes || undefined,
  };
}

export async function saveSubscription(client: ObsidianClient, folders: Folders, s: Subscription): Promise<string> {
  const path = subscriptionPath(folders, s.service);
  await client.putNote(path, renderSubscription(s));
  return path;
}

export async function listSubscriptions(client: ObsidianClient, folders: Folders): Promise<Subscription[]> {
  const files = (await client.listDir(folders.subscriptions)).filter((f) => f.endsWith('.md'));
  const out: Subscription[] = [];
  for (const file of files) {
    const text = await client.getNote(joinPath(folders.subscriptions, file));
    const sub = text === null ? null : parseSubscription(text, file.replace(/\.md$/, ''));
    if (sub) out.push(sub);
  }
  return out.sort((a, b) => upcomingRenewal(a, '0000-00-00').localeCompare(upcomingRenewal(b, '0000-00-00')));
}
