import { describe, expect, it } from 'vitest';
import { extractArticle, htmlToMarkdown, sanitizeHtml } from '../article';

const PAGE = `<html><head><title>Site | The slow case</title></head><body>
<nav>Home About Login</nav>
<article><h1>The slow case</h1><p class="byline">By Mara Ellison</p>
${'<p>Attention is trained, not given. A page read twice is a different page. <a href="/more">More</a> <img src="/pic.png"></p>'.repeat(6)}
<script>alert(1)</script><p onclick="steal()">Click <b>me</b></p></article>
<footer>Copyright</footer></body></html>`;

describe('article extraction', () => {
  it('returns the article, makes links absolute and removes scripts and handlers', () => {
    const a = extractArticle(PAGE, 'https://aeon.co/essays/slow')!;
    expect(a).not.toBeNull();
    expect(a.text).toContain('Attention is trained');
    expect(a.html).toContain('https://aeon.co/more');
    expect(a.html).not.toMatch(/<script|onclick|alert\(1\)/);
    expect(a.html).not.toContain('Copyright');
  });
  it('returns null for pages with nothing to read', () => {
    expect(extractArticle('<html><body></body></html>', 'https://x.com')).toBeNull();
  });
});

describe('sanitizeHtml', () => {
  it('drops dangerous markup but keeps formatting', () => {
    const out = sanitizeHtml('<p style="x" onclick="a()">Hi <b>there</b></p><iframe src="https://evil"></iframe><form><input></form><script>x()</script><a href="javascript:alert(1)">bad</a>');
    expect(out).toContain('<b>there</b>');
    expect(out).not.toMatch(/iframe|form|input|script|onclick|style=|javascript:/);
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings, lists, links and code', () => {
    const md = htmlToMarkdown('<h2>Title</h2><ul><li>a</li><li>b</li></ul><p><a href="https://x.com">x</a></p><pre><code>let a = 1;</code></pre>');
    expect(md).toContain('## Title');
    expect(md).toMatch(/-\s+a/);
    expect(md).toContain('[x](https://x.com)');
    expect(md).toContain('```');
  });
});
