export interface SearchDoc {
  id: string;
  kind: 'bookmark' | 'feed' | 'subscription' | 'clipping';
  title: string;
  text: string;
  url?: string;
}

const tokenize = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Small in-memory index. Every query word must match (as a word prefix); title hits rank higher. */
export class SearchIndex {
  private docs = new Map<string, { doc: SearchDoc; title: string[]; body: Set<string> }>();

  add(doc: SearchDoc): void {
    this.docs.set(`${doc.kind}:${doc.id}`, { doc, title: tokenize(doc.title), body: new Set(tokenize(doc.text)) });
  }

  /** Replace every document of one kind (used when a source refreshes). */
  replaceKind(kind: SearchDoc['kind'], docs: SearchDoc[]): void {
    for (const k of [...this.docs.keys()]) if (k.startsWith(`${kind}:`)) this.docs.delete(k);
    docs.forEach((d) => this.add({ ...d, kind }));
  }

  get size(): number {
    return this.docs.size;
  }

  search(query: string, limit = 30): SearchDoc[] {
    const words = tokenize(query);
    if (words.length === 0) return [];
    const scored: Array<{ doc: SearchDoc; score: number }> = [];
    for (const { doc, title, body } of this.docs.values()) {
      let score = 0;
      let all = true;
      for (const w of words) {
        const inTitle = title.some((t) => t === w) ? 6 : title.some((t) => t.startsWith(w)) ? 4 : 0;
        let inBody = 0;
        if (body.has(w)) inBody = 2;
        else for (const b of body) if (b.startsWith(w)) { inBody = 1; break; }
        if (inTitle + inBody === 0) {
          all = false;
          break;
        }
        score += inTitle + inBody;
      }
      if (all) scored.push({ doc, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title)).slice(0, limit).map((s) => s.doc);
  }
}
