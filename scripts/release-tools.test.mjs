import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cargoVersion, checkRelease, checkSignature, deepMerge, setVersion } from './release-tools.mjs';

function fixture(version = '0.1.0', pubkey = 'REPLACE_WITH_UPDATER_PUBLIC_KEY') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const t = path.join(root, 'apps/desk/src-tauri');
  fs.mkdirSync(t, { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/desk/package.json'), JSON.stringify({ name: 'x', version }));
  fs.writeFileSync(path.join(t, 'tauri.conf.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(t, 'Cargo.toml'), `[package]\nname = "observe_desk"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2" }\nserde = "1"\n`);
  fs.writeFileSync(path.join(t, 'Cargo.lock'), `[[package]]\nname = "serde"\nversion = "1.0.1"\n\n[[package]]\nname = "observe_desk"\nversion = "${version}"\n`);
  fs.writeFileSync(path.join(t, 'tauri.release.conf.json'), JSON.stringify({ plugins: { updater: { pubkey } } }));
  return root;
}

const sig = (comment) => Buffer.from(`untrusted comment: signature from tauri secret key\nRUSW\ntrusted comment: ${comment}\nSIG==\n`).toString('base64');

test('set-version updates every file and touches only this package', () => {
  const root = fixture();
  setVersion(root, '0.2.0');
  assert.equal(checkRelease(root, 'v0.2.0').length, 0);
  const cargo = fs.readFileSync(path.join(root, 'apps/desk/src-tauri/Cargo.toml'), 'utf8');
  assert.equal(cargoVersion(cargo), '0.2.0');
  assert.match(cargo, /tauri = \{ version = "2" \}/);
  const lock = fs.readFileSync(path.join(root, 'apps/desk/src-tauri/Cargo.lock'), 'utf8');
  assert.match(lock, /name = "serde"\nversion = "1.0.1"/);
  assert.match(lock, /name = "observe_desk"\nversion = "0.2.0"/);
  assert.throws(() => setVersion(root, 'two'), /not a version/);
});

test('check finds a tag that does not match and a placeholder key', () => {
  const root = fixture('0.1.0');
  assert.deepEqual(checkRelease(root, 'v0.1.0'), []);
  assert.match(checkRelease(root, 'v0.3.0').join('\n'), /Cargo\.toml says 0\.1\.0, but the tag is v0\.3\.0/);
  assert.match(checkRelease(root, 'release-1').join('\n'), /not like v1\.2\.3/);
  assert.match(checkRelease(root, 'v0.1.0', { release: true }).join('\n'), /placeholder update key/);
  assert.deepEqual(checkRelease(fixture('0.1.0', 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEMxOUY4Q0VF'), 'v0.1.0', { release: true }), []);
});

test('deepMerge merges objects and replaces arrays and scalars', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2, 3], e: 4 } }), { a: { b: 1, c: [2, 3], e: 4 }, d: 1 });
});

test('signature check wants the signed version to match', () => {
  assert.equal(checkSignature(sig('timestamp:1\tfile:app.exe\tversion:0.2.0'), '0.2.0'), null);
  assert.equal(checkSignature(sig('timestamp:1\tfile:app.exe\tversion:0.2.0'), 'v0.2.0'), null);
  assert.match(checkSignature(sig('timestamp:1\tfile:app.exe'), '0.2.0'), /does not record a version/);
  assert.match(checkSignature(sig('timestamp:1\tversion:0.1.0'), '0.2.0'), /for version 0\.1\.0, not 0\.2\.0/);
  assert.match(checkSignature('not a signature', '0.2.0'), /no trusted comment/);
});
