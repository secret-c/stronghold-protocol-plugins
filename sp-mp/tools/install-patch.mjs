// sp-mp/tools/install-patch.mjs — the OTHER way to use the overlay: copy its 31 overrides plus client files INTO the install, so the normal
// launcher (scripts\start-windows.bat, npm start) starts the multiplayer build.
//
//   node sp-mp/tools/install-patch.mjs status   # is the install patched?
//   node sp-mp/tools/install-patch.mjs apply    # back up the overlay files, then copy the overlay over them
//   node sp-mp/tools/install-patch.mjs revert   # put the backed-up originals back
//
// Trade-off (this is what the overlay exists to avoid): a patched install no longer matches MANIFEST.json, and an
// official Stronghold-Protocol-v0.2.x-update.zip REFUSES TO START until you revert. The launcher route
// (sp-mp\start-windows.cmd / node sp-mp/start.mjs) needs none of this.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
const FILES = path.join(MP, 'files');
const BACKUP = path.join(MP, 'install-backup');
const STATE = path.join(BACKUP, 'backup.json');
const cmd = (process.argv[2] || 'status').toLowerCase();

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk = (dir, rel = '', out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), next, out);
    else if (!next.endsWith('.pre-rebase')) out.push(next);
  }
  return out;
};
// The injected entry URL is a new public file, not an upstream override. Include the self-contained client too.
const clientFiles = walk(path.join(MP, 'client')).map((rel) => `public/sp-mp/client/${rel}`);
const overlay = [...new Set([...walk(FILES), ...clientFiles])];
const source = (rel) => rel.startsWith('public/sp-mp/client/')
  ? path.join(MP, 'client', rel.slice('public/sp-mp/client/'.length)) : path.join(FILES, ...rel.split('/'));
const target = (rel) => path.join(ROOT, ...rel.split('/'));
const backupPath = (rel) => path.join(BACKUP, ...rel.split('/'));

const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null);

function status() {
  const state = loadState();
  if (!state) { console.log('install: NOT patched (the normal launcher starts the plain 4-seat game).'); return; }
  let same = 0;
  let other = 0;
  for (const { rel, sha256 } of state.files) {
    const p = target(rel);
    if (fs.existsSync(p) ? sha(p) !== sha256 : sha256 !== null) other++;
    else same++;
  }
  console.log(`install: patched on ${state.at} (backup of ${state.files.length} files in sp-mp/install-backup/)`);
  console.log(`  ${other} file(s) differ from the backup (the overlay is in place), ${same} already original.`);
  console.log('  revert with:  node sp-mp/tools/install-patch.mjs revert');
}

function apply() {
  if (loadState()) { console.log('already patched — run "revert" first if you want to re-apply.'); return; }
  fs.mkdirSync(BACKUP, { recursive: true });
  const files = [];
  for (const rel of overlay) {
    const from = source(rel);
    const to = target(rel);
    if (!fs.existsSync(to)) {
      files.push({ rel, existed: false, sha256: null });
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      continue;
    }
    const bak = backupPath(rel);
    fs.mkdirSync(path.dirname(bak), { recursive: true });
    fs.copyFileSync(to, bak);
    files.push({ rel, sha256: sha(bak) });
    fs.copyFileSync(from, to);
  }
  fs.writeFileSync(STATE, JSON.stringify({ at: new Date().toISOString(), files }, null, 2) + '\n');
  console.log(`patched ${files.length} files into the install.`);
  console.log('The normal launcher now starts the multiplayer build (4 / 8 / 12-seat co-op rooms):');
  console.log('  scripts\\start-windows.bat        (or: node server/index.js)');
  console.log('\n! The install no longer matches MANIFEST.json: `npm run doctor` will report the changed files, and an');
  console.log('  official update package will refuse to start until you revert:');
  console.log('  node sp-mp/tools/install-patch.mjs revert');
}

function revert() {
  const state = loadState();
  if (!state) { console.log('nothing to revert (the install was not patched by this tool).'); return; }
  let restored = 0;
  const problems = [];
  for (const { rel, sha256, existed } of state.files) {
    const bak = backupPath(rel);
    const to = target(rel);
    if (existed === false) {
      const resolved = path.resolve(to);
      if (!resolved.startsWith(path.resolve(ROOT) + path.sep)) { problems.push(`${rel}: invalid target`); continue; }
      if (fs.existsSync(resolved)) { fs.unlinkSync(resolved); restored++; }
      continue;
    }
    if (!fs.existsSync(bak)) { problems.push(`${rel}: backup missing`); continue; }
    if (sha(bak) !== sha256) { problems.push(`${rel}: backup does not match its recorded hash`); continue; }
    if (fs.existsSync(to) && sha(to) === sha256) continue; // already original
    fs.copyFileSync(bak, to);
    restored++;
  }
  if (problems.length) { console.log('NOT reverted:'); for (const p of problems) console.log('  ' + p); return; }
  fs.rmSync(BACKUP, { recursive: true, force: true });
  console.log(`reverted ${restored} file(s); the install matches v${(() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8')).app; } catch { return '?'; } })()} again.`);
  console.log('Check with:  node tools/doctor.mjs');
}

if (cmd === 'apply') apply();
else if (cmd === 'revert') revert();
else status();
