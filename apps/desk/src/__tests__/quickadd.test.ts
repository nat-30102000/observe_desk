import { describe, expect, it } from 'vitest';
import { buildCapture } from '../components/QuickAdd';

const blank = { text: '', url: '', title: '', note: '', tags: '' };

describe('buildCapture', () => {
  it('asks for a link on bookmarks and highlights', () => {
    expect(buildCapture('bookmark', blank)).toMatch(/http/);
    expect(buildCapture('bookmark', { ...blank, url: 'javascript:alert(1)' })).toMatch(/http/);
    expect(buildCapture('highlight', { ...blank, text: 'hi' })).toMatch(/link/);
  });
  it('asks for text on highlights and markdown', () => {
    expect(buildCapture('markdown', blank)).toMatch(/text/);
  });
  it('builds a highlight with cleaned tags and a default title', () => {
    const c = buildCapture('highlight', { ...blank, text: 'A line', url: 'https://aeon.co/x', tags: '#reading, deep' });
    expect(c).toMatchObject({ kind: 'highlight', tags: ['reading', 'deep'], source: { url: 'https://aeon.co/x', title: 'aeon.co' } });
  });
  it('titles a markdown note from its first line', () => {
    const c = buildCapture('markdown', { ...blank, text: '# Big idea\nmore' });
    expect(c).toMatchObject({ kind: 'markdown', title: '# Big idea' });
  });
});
