const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const ENDPOINT = 'http://127.0.0.1:27125';
let tab;
let selection = '';

function say(text, ok) {
  const el = $('msg');
  el.textContent = text;
  el.className = ok ? 'ok' : 'err';
}

async function send(payload) {
  const { token } = await api.storage.local.get('token');
  if (!token) throw new Error('Add the token in this extension\'s options first.');
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
  if (res.status === 401) throw new Error('Nib rejected the token.');
  if (!res.ok) throw new Error(`Nib answered ${res.status}.`);
}

function tagsOf() {
  return $('tags').value.split(/[,\s]+/).filter(Boolean);
}

async function submit(payload) {
  try {
    await send(payload);
    say('Nib has it!', true);
    setTimeout(() => window.close(), 900);
  } catch (e) {
    say(e.message, false);
  }
}

(async () => {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  $('title').textContent = tab?.title ?? '';
  $('url').textContent = tab?.url ?? '';
  try {
    const [res] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() ?? '') });
    selection = (res?.result ?? '').trim();
  } catch {
    selection = ''; // pages like chrome:// cannot be scripted
  }
  if (selection) {
    $('selection').hidden = false;
    $('selection').textContent = selection;
    $('highlight').disabled = false;
  }
})();

$('highlight').addEventListener('click', () =>
  submit({ type: 'highlight', url: tab.url, title: tab.title ?? '', text: selection, note: $('note').value, tags: tagsOf() }),
);
$('bookmark').addEventListener('click', () =>
  submit({ type: 'bookmark', url: tab.url, title: tab.title ?? '', description: $('note').value, tags: tagsOf() }),
);
