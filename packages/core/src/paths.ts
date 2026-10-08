const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Make a title safe as a Windows/Obsidian file name (without extension). */
export function sanitizeFileName(name: string): string {
  let out = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (out.length > 120) out = out.slice(0, 120).trim();
  if (out === '' || RESERVED.test(out)) return out === '' ? 'Untitled' : `${out}_`;
  return out;
}

export function joinPath(folder: string, file: string): string {
  const f = folder.replace(/^\/+|\/+$/g, '');
  return f ? `${f}/${file}` : file;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}
