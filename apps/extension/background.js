// Works in Chrome (service worker) and Firefox (event page). Plain script, no build step.
const api = globalThis.browser ?? globalThis.chrome;
const ENDPOINT = 'http://127.0.0.1:27125';

async function send(payload) {
  const { token } = await api.storage.local.get('token');
  if (!token) throw new Error('Paste the token from the observe_desk Settings into this extension\'s options.');
  let res;
  try {
    res = await fetch(`${ENDPOINT}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Observe-Token': token },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach Nib. Is observe_desk running?');
  }
  if (res.status === 401) throw new Error('Nib rejected the token. Copy it again from Settings.');
  if (!res.ok) throw new Error(`Nib answered ${res.status}.`);
}

function badge(text, color) {
  api.action.setBadgeBackgroundColor({ color });
  api.action.setBadgeText({ text });
  setTimeout(() => api.action.setBadgeText({ text: '' }), 2500);
}

async function run(payload) {
  try {
    await send(payload);
    badge('OK', '#1F8F63');
  } catch (e) {
    badge('!', '#B3261E');
    console.warn(e.message);
  }
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({ id: 'highlight', title: 'Send selection to Nib', contexts: ['selection'] });
  api.contextMenus.create({ id: 'bookmark', title: 'Bookmark this page with Nib', contexts: ['page'] });
  api.contextMenus.create({ id: 'bookmark-link', title: 'Bookmark this link with Nib', contexts: ['link'] });
});

api.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.pageUrl ?? tab?.url;
  const title = tab?.title ?? '';
  if (info.menuItemId === 'highlight' && info.selectionText) {
    run({ type: 'highlight', url, title, text: info.selectionText });
  } else if (info.menuItemId === 'bookmark') {
    run({ type: 'bookmark', url, title });
  } else if (info.menuItemId === 'bookmark-link' && info.linkUrl) {
    run({ type: 'bookmark', url: info.linkUrl, title: info.linkUrl });
  }
});

api.commands.onCommand.addListener(async (command) => {
  if (command !== 'highlight-selection') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const [res] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() ?? '') });
  const text = res?.result?.trim();
  if (text) run({ type: 'highlight', url: tab.url, title: tab.title ?? '', text });
});
