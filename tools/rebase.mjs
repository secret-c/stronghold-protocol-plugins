// sp-mp/tools/rebase.mjs — carry the overlay onto a NEWER install after an official update.
//
//   node sp-mp/tools/rebase.mjs            # merge, report, and (unless conflicts) stamp the new base
//   node sp-mp/tools/rebase.mjs --dry-run  # only report what the update changed under the overlay
//
// For every overlay file it runs a three-way merge:
//     base/  = the upstream file the overlay was written against (kept from the last rebase)
//     ours/  = sp-mp/files/…   (our change)
//     theirs = <install>/…     (the file as the official update left it)
// A file upstream did NOT touch needs nothing. A file only one side changed merges silently; overlapping edits are a
// conflict, listed with the usual <<<<<<< markers inside sp-mp/files/… (the previous copy is kept beside it as
// …pre-rebase). Nothing outside sp-mp/ is ever written.
//
// The merge uses `git merge-file` in its in-place form (it writes the result into the first file and returns the
// conflict count) so no output has to be piped back — that keeps it working in restricted shells where spawning a
// child with pipes is denied. If git cannot be run at all, the tool reports it and changes NOTHING.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
const DRY = process.argv.includes('--dry-run');
const FILES = path.join(MP, 'files');
const BASE = path.join(MP, 'base');
const plugin = JSON.parse(fs.readFileSync(path.join(MP, 'plugin.json'), 'utf8'));

const installed = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8')).app; } catch { return null; }
})();
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

const walk = (dir, rel = '', out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), next, out);
    else if (!next.endsWith('.pre-rebase')) out.push(next);
  }
  return out;
};

const overlayFiles = walk(FILES);
const gitOk = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

/**
 * Three-way merge of one file. Returns { ok, conflicts, text, error }: `text` is the merged result.
 * `git merge-file` writes into its first argument in place and prints nothing, so nothing is piped.
 */
function merge3(oursText, baseText, theirsText) {
  const tmp = path.join(MP, '.rebase');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const ours = path.join(tmp, 'ours');
  write(ours, oursText);
  write(path.join(tmp, 'base'), baseText);
  write(path.join(tmp, 'theirs'), theirsText);
  const r = spawnSync('git', ['merge-file', '-L', 'overlay', '-L', 'base', '-L', 'install', ours, path.join(tmp, 'base'), path.join(tmp, 'theirs')], { stdio: 'ignore' });
  const text = read(ours);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.error || r.status === null) return { ok: false, conflicts: 0, text: null, error: r.error ? String(r.error.code || r.error.message) : 'git could not be run' };
  if (text === null || text === '') return { ok: false, conflicts: 0, text: null, error: 'git produced no output' };
  return { ok: r.status === 0, conflicts: r.status, text };
}

const untouched = [];
const merged = [];
const conflicted = [];
const failed = [];

if (!gitOk && !DRY) {
  console.log('! git is not available here: no merges were attempted, nothing was written.');
  console.log('  Install git (it is also what the official packaging uses) and run this again.');
}

for (const rel of overlayFiles) {
  const mine = path.join(FILES, ...rel.split('/'));
  const baseFile = path.join(BASE, ...rel.split('/'));
  const theirsFile = path.join(ROOT, ...rel.split('/'));
  const baseText = read(baseFile);
  const theirsText = read(theirsFile);

  if (theirsText === null && baseText === null) { untouched.push(`${rel} (overlay-only module)`); continue; }
  if (theirsText === null) { failed.push(`${rel}: gone from the install (was it removed upstream?)`); continue; }
  if (baseText === null) { failed.push(`${rel}: no base copy — run tools/assemble.mjs first`); continue; }
  if (baseText === theirsText) { untouched.push(rel); continue; }
  if (DRY) { merged.push(`${rel} (upstream changed it)`); continue; }
  if (!gitOk) { conflicted.push(`${rel} (upstream changed it; git unavailable)`); continue; }

  const r = merge3(read(mine), baseText, theirsText);
  if (!r.text) { failed.push(`${rel}: ${r.error}`); continue; }
  fs.copyFileSync(mine, `${mine}.pre-rebase`);
  write(mine, r.text);
  if (r.ok) { write(baseFile, theirsText); merged.push(rel); } else conflicted.push(`${rel} (${r.conflicts} conflict block(s))`);
}

const w = (label, list) => { if (!list.length) return; console.log(`${label}: ${list.length}`); for (const x of list) console.log('  ' + x); };
console.log(`install: v${installed ?? '?'}   overlay built for: ${plugin.supports.join(' / ')}   files: ${overlayFiles.length}\n`);
if (!untouched.length && !merged.length && !conflicted.length && !failed.length) console.log('nothing to compare.');
w('upstream did not touch', untouched);
w('changed under the overlay', merged);
if (!DRY) { w('CONFLICT — resolve in sp-mp/files', conflicted); w('could not process', failed); }

if (DRY) {
  console.log('\n--dry-run: nothing was written.');
} else if (failed.length || conflicted.length) {
  console.log('\nNothing else was touched. Conflicts keep <<<<<<< markers in sp-mp/files/… (previous copy beside them as *.pre-rebase);');
  console.log('after resolving them run:  node sp-mp/tools/rebase.mjs --stamp   (or edit plugin.json by hand)');
} else if (installed && !plugin.supports.includes(installed)) {
  plugin.supports = [...new Set([...plugin.supports, installed])];
  plugin.base = installed;
  fs.writeFileSync(path.join(MP, 'plugin.json'), JSON.stringify(plugin, null, 2) + '\n');
  console.log(`\nrebased onto v${installed}: plugin.json now supports ${plugin.supports.join(' / ')}.`);
  console.log('Now rebuild the client union tree: node sp-mp/tools/build-tree.mjs');
} else {
  console.log('\noverlay is already in sync with this install.');
}
