import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';

export interface Article {
  title: string;
  byline?: string;
  /** Sanitised, safe to render. */
  html: string;
  text: string;
}

/** Web content is untrusted: strip scripts, styles, forms, frames and inline styles. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'link', 'meta'],
    FORBID_ATTR: ['style'],
  });
}

/** Pull the readable article out of a full web page. */
export function extractArticle(html: string, url: string): Article | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Lets Readability turn relative links and images into absolute ones.
  const base = doc.createElement('base');
  base.href = url;
  doc.head.appendChild(base);
  const parsed = new Readability(doc).parse();
  if (!parsed?.content) return null;
  return {
    title: parsed.title || url,
    byline: parsed.byline || undefined,
    html: sanitizeHtml(parsed.content),
    text: parsed.textContent ?? '',
  };
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}
