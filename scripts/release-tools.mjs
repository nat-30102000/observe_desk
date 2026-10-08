#!/usr/bin/env node
// Small helpers for releases. Used by the release workflow and runnable locally:
//   node scripts/release-tools.mjs set-version 0.2.0
//   node scripts/release-tools.mjs check v0.2.0 [--release]
//   node scripts/release-tools.mjs merge out.json a.json b.json
//   node scripts/release-tools.mjs check-sig installer.exe.sig 0.2.0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PLACEHOLDER = 'REPLACE_WITH_UPDATER_PUBLIC_KEY';

const files = (root) => ({
  desk: path.join(root, 'apps/desk/package.json'),
  tauri: path.join(root, 'apps/desk/src-tauri/tauri.conf.json'),
  cargo: path.join(root, 'apps/desk/src-tauri/Cargo.toml'),
  lock: path.join(root, 'apps/desk/src-tauri/Cargo.lock'),
  release: path.join(root, 'apps/desk/src-tauri/tauri.release.conf.json'),
});

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** First `version = "x"` after [package] in Cargo.toml. */
export function cargoVersion(text) {
  const pkg = text.slice(text.indexOf('[package]'));
  return /^version\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
}

export function setVersion(root, version) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a version like 1.2.3`);
  const f = files(root);
  for (const p of [f.desk, f.tauri]) {
    const j = readJson(p);
    j.version = version;
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  }
  const cargo = fs.readFileSync(f.cargo, 'utf8');
  const at = cargo.indexOf('[package]');
  const head = cargo.slice(0, at);
  const rest = cargo.slice(at).replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  fs.writeFileSync(f.cargo, head + rest);
  if (fs.existsSync(f.lock)) {
    const lock = fs.readFileSync(f.lock, 'utf8').replace(/(name = "observe_desk"\nversion = )"[^"]+"/, `$1"${version}"`);
    fs.writeFileSync(f.lock, lock);
  }
}

/** Problems that would make a release wrong. Empty array means good. */
export function checkRelease(root, tag, { release = false } = {}) {
  const f = files(root);
  const problems = [];
  const version = tag.replace(/^v/, '');
  if (!SEMVER.test(version)) problems.push(`The tag "${tag}" is not like v1.2.3.`);
  const found = {
    'apps/desk/package.json': readJson(f.desk).version,
    'tauri.conf.json': readJson(f.tauri).version,
    'Cargo.toml': cargoVersion(fs.readFileSync(f.cargo, 'utf8')),
  };
  for (const [name, v] of Object.entries(found)) {
    if (v !== version) problems.push(`${name} says ${v}, but the tag is ${tag}. Run: node scripts/release-tools.mjs set-version ${version}`);
  }
  if (release) {
    const key = readJson(f.release)?.plugins?.updater?.pubkey ?? '';
    if (!key || key.includes('REPLACE') || key === PLACEHOLDER) {
      problems.push('tauri.release.conf.json still has the placeholder update key. Generate one and paste the public key in (see RELEASING.md).');
    }
  }
  return problems;
}

export function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return b ?? a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? deepMerge(a[k], v) : v;
  return out;
}

/** The updater (with requireSignedVersion on) only accepts signatures whose signed comment names the version. */
export function checkSignature(sigFileText, version) {
  let decoded;
  try {
    decoded = Buffer.from(sigFileText.trim(), 'base64').toString('utf8');
  } catch {
    return 'The signature file is not base64.';
  }
  const comment = /^trusted comment: (.*)$/m.exec(decoded)?.[1];
  if (!comment) return 'The signature file has no trusted comment, so it is not a Tauri update signature.';
  const signed = comment.split('\t').find((p) => p.startsWith('version:'))?.slice('version:'.length);
  if (!signed) return 'The signature does not record a version. With "requireSignedVersion" on, installed apps would reject this update. Turn it off in tauri.release.conf.json or upgrade the Tauri CLI.';
  if (signed.replace(/^v/, '') !== version.replace(/^v/, '')) return `The signature is for version ${signed}, not ${version}.`;
  return null;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'set-version':
      setVersion(root, args[0] ?? '');
      console.log(`Set version ${args[0]} in package.json, tauri.conf.json, Cargo.toml and Cargo.lock.`);
      return 0;
    case 'check': {
      const problems = checkRelease(root, args[0] ?? '', { release: args.includes('--release') });
      problems.forEach((p) => console.error(`ERROR: ${p}`));
      if (!problems.length) console.log('Release checks passed.');
      return problems.length ? 1 : 0;
    }
    case 'merge': {
      const [out, ...inputs] = args;
      fs.writeFileSync(out, JSON.stringify(inputs.map(readJson).reduce(deepMerge, {}), null, 2));
      return 0;
    }
    case 'check-sig': {
      const problem = checkSignature(fs.readFileSync(args[0], 'utf8'), args[1] ?? '');
      if (problem) console.error(`ERROR: ${problem}`);
      else console.log('Signature records the right version.');
      return problem ? 1 : 0;
    }
    default:
      console.error('Usage: set-version <x.y.z> | check <tag> [--release] | merge <out> <files...> | check-sig <file.sig> <version>');
      return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
