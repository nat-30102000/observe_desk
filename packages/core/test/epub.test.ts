import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { openEpub } from '../src';

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CONTAINER = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
const page = (body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><script>alert(1)</script></head><body>${body}</body></html>`;

function epub(kind: 'epub3' | 'epub2'): Uint8Array {
  const nav: Record<string, Uint8Array> = kind === 'epub3'
    ? { 'OEBPS/nav.xhtml': strToU8(page('<nav epub:type="toc"><ol><li><a href="ch1.xhtml">Opening &amp; Beginnings</a></li><li><a href="text/ch2.xhtml#s1">The Middle</a></li></ol></nav>')) }
    : { 'OEBPS/toc.ncx': strToU8('<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="a"><navLabel><text>Opening</text></navLabel><content src="ch1.xhtml"/><navPoint id="b"><navLabel><text>Nested Middle</text></navLabel><content src="text/ch2.xhtml#s1"/></navPoint></navPoint></navMap></ncx>') };
  const navItem = kind === 'epub3' ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>';
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Slow Book</dc:title><dc:creator opf:role="aut" xmlns:opf="http://www.idpf.org/2007/opf">Mara Ellison</dc:creator></metadata>
<manifest>${navItem}<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/><item id="img" href="images/pic.png" media-type="image/png"/><item id="css" href="style.css" media-type="text/css"/></manifest>
<spine${kind === 'epub2' ? ' toc="ncx"' : ''}><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="css"/><itemref idref="missing"/></spine></package>`;
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/content.opf': strToU8(opf),
    ...nav,
    'OEBPS/ch1.xhtml': strToU8(page('<h1>Ignored heading</h1><p>First chapter.</p><img src="images/pic.png" alt="pic"/>')),
    'OEBPS/text/ch2.xhtml': strToU8(page('<p>Second <a href="../ch3.xhtml#x">link</a> and <a href="https://example.com">out</a>.</p><img src="../images/pic.png"/><img src="../images/missing.png"/>')),
    'OEBPS/ch3.xhtml': strToU8(page('<h2>Fallback title <em>here</em></h2><p>Third.</p>')),
    'OEBPS/images/pic.png': PNG,
    'OEBPS/style.css': strToU8('p{}'),
  });
}

describe('openEpub', () => {
  for (const kind of ['epub3', 'epub2'] as const) {
    it(`reads metadata, chapters and titles (${kind})`, () => {
      const b = openEpub(epub(kind));
      expect(b).toMatchObject({ title: 'The Slow Book', author: 'Mara Ellison' });
      expect(b.chapters.map((c) => c.path)).toEqual(['OEBPS/ch1.xhtml', 'OEBPS/text/ch2.xhtml', 'OEBPS/ch3.xhtml']);
      expect(b.chapters.map((c) => c.title)).toEqual([kind === 'epub3' ? 'Opening & Beginnings' : 'Opening', kind === 'epub3' ? 'The Middle' : 'Nested Middle', 'Fallback title here']);
    });
  }
  it('returns only the body and inlines images relative to the chapter', () => {
    const b = openEpub(epub('epub3'));
    const one = b.chapterHtml(0);
    expect(one).toContain('First chapter.');
    expect(one).not.toContain('alert(1)');
    expect(one).toMatch(/src="data:image\/png;base64,/);
    expect(b.chapterHtml(1)).toMatch(/src="data:image\/png;base64,/);
    expect(b.chapterHtml(1)).toContain('src=""'); // missing image removed
    expect(b.chapterHtml(99)).toBe('');
  });
  it('resolves internal links between chapters only', () => {
    const b = openEpub(epub('epub3'));
    expect(b.resolveLink(1, '../ch3.xhtml#x')).toBe(2);
    expect(b.resolveLink(0, 'text/ch2.xhtml')).toBe(1);
    expect(b.resolveLink(1, 'https://example.com')).toBe(-1);
    expect(b.resolveLink(0, 'nowhere.xhtml')).toBe(-1);
  });
  it('rejects things that are not epubs', () => {
    expect(() => openEpub(strToU8('hello'))).toThrow(/valid EPUB/);
    expect(() => openEpub(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/no readable/);
    expect(() => openEpub(zipSync({ 'META-INF/container.xml': strToU8(CONTAINER), 'OEBPS/content.opf': strToU8('<package><manifest/><spine/></package>') }))).toThrow(/no readable chapters/);
  });
});
