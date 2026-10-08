export type FrontmatterValue = string | number | boolean | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

const SAFE_PLAIN = /^[A-Za-z0-9_./@-][A-Za-z0-9_ ./@()-]*$/;

function scalar(v: string | number | boolean): string {
  if (typeof v !== 'string') return String(v);
  if (v === '' || !SAFE_PLAIN.test(v) || /^(true|false|null|yes|no|\d+(\.\d+)?)$/i.test(v)) {
    return JSON.stringify(v);
  }
  return v;
}

export function toFrontmatter(data: Frontmatter): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${scalar(item)}`);
      }
    } else {
      lines.push(`${key}: ${scalar(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function parseScalar(raw: string): string | number | boolean {
  const s = raw.trim();
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s;
    }
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s.replace(/^'(.*)'$/, '$1');
}

function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of inner) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Reads the leading frontmatter block. Supports flat keys, block lists and [flow, lists]. */
export function parseFrontmatter(text: string): { data: Frontmatter; body: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: normalized };
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '');
  const data: Frontmatter = {};
  let listKey: string | null = null;
  for (const line of block.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const arr = data[listKey];
      if (Array.isArray(arr)) arr.push(String(parseScalar(item[1] ?? '')));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1] as string;
    const rest = (kv[2] ?? '').trim();
    if (rest === '') {
      data[key] = [];
      listKey = key;
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = splitFlow(rest.slice(1, -1)).map((x) => String(parseScalar(x)));
      listKey = null;
    } else {
      data[key] = parseScalar(rest);
      listKey = null;
    }
  }
  return { data, body };
}
