import { detectSocial, fetchThread, fetchVideo, parseVideoId, threadToMarkdown, videoNoteBody } from '@observe/core';
import { useState } from 'react';
import { webFetch } from '../platform';

export interface Imported {
  title: string;
  body: string;
  tags: string[];
}

interface Props {
  url: string;
  onUrl: (u: string) => void;
  imported: Imported | null;
  onImported: (i: Imported | null) => void;
}

export function importKind(url: string): 'video' | 'thread' | 'x' | null {
  if (parseVideoId(url) && /youtu/.test(url)) return 'video';
  const ref = detectSocial(url);
  return ref ? (ref.platform === 'x' ? 'x' : 'thread') : null;
}

/** Turns a YouTube link (captions) or a Reddit, Hacker News, Mastodon or Bluesky thread into a markdown note. */
export function ImportPanel({ url, onUrl, imported, onImported }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = importKind(url.trim());

  const fetchIt = async () => {
    setBusy(true);
    setError(null);
    onImported(null);
    try {
      if (kind === 'video') {
        const { info, segments } = await fetchVideo(webFetch, url.trim());
        if (segments.length === 0) setError('This video has no captions I can read. You can still save the note and add your own.');
        onImported({ title: info.title, body: videoNoteBody(info, segments), tags: ['video', 'youtube'] });
      } else {
        const thread = await fetchThread(webFetch, url.trim());
        onImported({ title: thread.title, body: threadToMarkdown(thread), tags: ['social', thread.platform] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="importpanel">
      <label>
        YouTube video or thread link
        <input value={url} onChange={(e) => { onUrl(e.target.value); onImported(null); }} placeholder="https://" inputMode="url" />
      </label>
      <p className="muted small">
        {kind === 'video' && 'YouTube video: saves the captions with timestamps that link back to the moment.'}
        {kind === 'thread' && 'Thread: saves the post and its replies.'}
        {kind === 'x' && 'X (Twitter) does not allow reading posts without logging in. Use the browser extension on the post page.'}
        {kind === null && 'Works with YouTube, Reddit, Hacker News, Mastodon and Bluesky links.'}
      </p>
      <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} disabled={busy || (kind !== 'video' && kind !== 'thread')} onClick={() => void fetchIt()}>
        {busy ? 'Fetching...' : kind === 'video' ? 'Fetch transcript' : 'Fetch thread'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      {imported && (
        <>
          <label>Note title<input value={imported.title} onChange={(e) => onImported({ ...imported, title: e.target.value })} /></label>
          <label>Note (edit before saving)<textarea rows={9} value={imported.body} onChange={(e) => onImported({ ...imported, body: e.target.value })} /></label>
        </>
      )}
    </div>
  );
}
