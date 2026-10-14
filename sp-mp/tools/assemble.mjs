// Assemble the overlay: sp-mp/files/<rel> = our modified runtime files (copied from the development tree),
// sp-mp/base/<rel> = the pristine upstream copies they were built from (copied from the INSTALL, which must equal the
// upstream release the working copy is based on — that pair is what tools/rebase.mjs merges against after an update).
//
//   node sp-mp/tools/assemble.mjs           rebuild files/ + base/ (then run tools/build-tree.mjs)
//   node sp-mp/tools/assemble.mjs --list    print the overrides it would write and exit
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));          // this plugin folder
const ROOT = path.dirname(MP);                                                   // the install (a pristine release)
const WORK = path.join(ROOT, 'sp-4-12-16');                                      // our working copy of the change
/** Top-level entries of the install that are never overlay source: the plugin itself, the working copy, per-machine state. */
const SKIP_TOP = new Set(['sp-mp', 'sp-4-12-16', 'node_modules', 'runtime', '.cache', '.venv-extract', '.update-tmp', 'data', 'packs', 'docs', 'test', 'tools', 'types', 'scripts', '.github', '.git']);
const LIST_ONLY = process.argv.includes('--list');

const RUNTIME = [
  'shared/constants.js',
  'shared/protocol.js',
  'server/lobby.js',
  'server/match/Match.js',
  'server/match/choices.js',
  'server/match/effectsMeta.js',
  'server/match/finalAssault.js',
  'server/match/gamedata.js',
  'server/match/pool.js',
  'server/match/player/acquire.js',
  'server/match/match/spDraft.js',
  'server/match/unite.js',
  'server/sim/content/choices.js',
  'public/css/screens/draft.css',
  'public/css/screens/game-panels.css',
  'public/css/screens/game.css',
  'public/css/screens/lobby.css',
  'public/css/screens/room.css',
  'public/i18n/en.json',
  'public/i18n/ja.json',
  'public/i18n/ko.json',
  'public/i18n/zh-TW.json',
  'public/js/screens/bandDraft.js',
  'public/js/screens/lobby.js',
  'public/js/screens/room.js',
  'public/js/ui/choiceOverlay.js',
  'public/js/ui/gameLogic/draft.js',
  'public/js/ui/stats.js',
  'public/js/ui/teamPanel.js',
];

const put = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

// ---------------------------------------------------------------------------------------------------------------
// What actually goes into the overlay: every runtime file of the INSTALL under the trees below whose bytes differ
// from the development tree's copy — plus files the development tree adds (which an installed release cannot have,
// e.g. a new ui/*.js module). The RUNTIME list above is only a fallback for paths the walk below cannot see (a file
// the install does not carry yet, and every `base:` copy misses it too). Deriving the list beats maintaining it: a
// hand-kept list silently drops a file the moment somebody edits one that was never listed (that is exactly how a
// whole client-side feature can look "not applied" while the server side works).
// ---------------------------------------------------------------------------------------------------------------
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const WALK_DIRS = ['shared', 'server', 'public'];

/** Every file under the install's runtime trees, as install-relative `/` paths. */
function walkInstall() {
  const out = [];
  const visit = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      // the overlay's own trees, the generated art/font/vendor bundles and per-machine state are never source
      if (!rel && (SKIP_TOP.has(e.name) || ['assets', 'fonts', 'vendor', 'dev'].includes(e.name))) continue;
      if (e.isDirectory()) visit(path.join(dir, e.name), next);
      else if (!next.endsWith('.pre-rebase')) out.push(next);
    }
  };
  for (const d of WALK_DIRS) if (fs.existsSync(path.join(ROOT, d))) visit(path.join(ROOT, d), d);
  return out;
}

/** Every file under the development tree's runtime trees, as working-copy-relative `/` paths (new modules included). */
function walkWork() {
  const out = [];
  const visit = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && ['assets', 'fonts', 'vendor', 'dev'].includes(e.name)) continue;
      if (e.isDirectory()) visit(path.join(dir, e.name), next);
      else if (!next.endsWith('.pre-rebase')) out.push(next);
    }
  };
  for (const d of WALK_DIRS) if (fs.existsSync(path.join(WORK, d))) visit(path.join(WORK, d), d);
  return out;
}

/**
 * The plugin's own client modules live in `sp-mp/client/` and are ROUTED into the union tree (see the block above).
 */

const overrides = [];
const seen = new Set();
const consider = (rel) => {
  if (seen.has(rel)) return;
  const dev = path.join(WORK, ...rel.split('/'));
  if (!fs.existsSync(dev) || !fs.statSync(dev).isFile()) return;
  const installed = path.join(ROOT, ...rel.split('/'));
  // identical bytes ⇒ nothing to overlay; a file the install has never carried ⇒ always an override
  if (fs.existsSync(installed) && sha(installed) === sha(dev)) return;
  seen.add(rel);
  overrides.push(rel);
};
for (const rel of walkInstall()) consider(rel);
for (const rel of walkWork()) consider(rel);   // a module the development tree adds has no install counterpart
for (const rel of RUNTIME) consider(rel);      // fallback: a path the walks could not see

// The plugin's own client modules (`sp-mp/client/**`) are served to the browser at `/sp-mp/client/…`: the static
// server only serves the install and the union trees, so they are ROUTED into the union tree as `public/sp-mp/client/…`
// (copied below, then exposed by tools/build-tree.mjs like any other public file). Overriding a release file is a
// different job from adding one, so they are not mixed into the override list above.
const CLIENT_SRC = path.join(MP, 'client');
const CLIENT_OUT = path.join(MP, 'public', 'sp-mp', 'client');
let clientRouted = 0;
if (fs.existsSync(CLIENT_SRC)) {
  fs.rmSync(CLIENT_OUT, { recursive: true, force: true });
  for (const e of fs.readdirSync(CLIENT_SRC, { withFileTypes: true })) {
    if (e.isDirectory()) continue;
    put(path.join(CLIENT_SRC, e.name), path.join(CLIENT_OUT, e.name));
    clientRouted++;
  }
}

// The overlay's own index.html: the install's page + two lines that boot the plugin's client module (a stylesheet and
// a module script). Derived from the INSTALL at build time, so an upstream change to index.html is never lost and its
// copy in `files/` can never drift. `rebase.mjs` will report it merged after the next official update — that is
// expected: the injector below re-applies the same two lines.
const INSTALL_INDEX = path.join(ROOT, 'public', 'index.html');
const OVERLAY_INDEX = path.join(MP, 'files', 'public', 'index.html');
let indexInjected = false;
if (fs.existsSync(INSTALL_INDEX)) {
  indexInjected = injectClient(INSTALL_INDEX, OVERLAY_INDEX);
}

/** @returns {boolean} whether the file existed and the tags are in place */
function injectClient(from, to) {
  let html = fs.readFileSync(from, 'utf8');
  if (!html.includes('/sp-mp/client/entry.js')) {
    const tags = '  <!-- sp-mp overlay: 伤害统计 panel, loaded from the plugin (no host file is modified) -->\n'
      + '  <link rel="stylesheet" href="/sp-mp/client/client.css" />\n'
      + '  <script type="module" src="/sp-mp/client/entry.js"></script>\n';
    if (html.includes('<script type="module" src="/js/main.js"')) {
      html = html.replace(/(\s*)<script type="module" src="\/js\/main\.js"/, `\n${tags}$1<script type="module" src="/js/main.js"`);
    } else if (html.includes('</head>')) {                       // an upstream rewrite without that literal tag
      html = html.replace('</head>', `${tags}</head>`);
    } else {
      console.log('! index.html: no injection point found (neither the main.js module script nor </head>)');
      return false;
    }
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, html, 'utf8');
  // the pristine copy for rebase: the install's page as it is (no plugin tags) — this is the base side of a merge
  put(from, path.join(MP, 'base', 'public', 'index.html'));
  return true;
}

let copied = 0;
const missing = [];
for (const rel of overrides) {
  if (rel === 'public/index.html') continue;   // written by injectClient above
  const src = path.join(WORK, ...rel.split('/'));
  if (!fs.existsSync(src)) { missing.push(rel); continue; }
  put(src, path.join(MP, 'files', ...rel.split('/')));
  // the rebase base: the INSTALL's copy of the same file (the upstream release the overlay was written against);
  // a file upstream does not have keeps no base — `rebase.mjs` reports it as "gone from the install" if it vanishes
  const pristine = path.join(ROOT, ...rel.split('/'));
  if (fs.existsSync(pristine)) put(pristine, path.join(MP, 'base', ...rel.split('/')));
  copied++;
}
if (indexInjected) copied++;

// stale overlay files: a path that no longer differs (or was deleted in the development tree) must leave `files/`
// and `base/`, or the server would keep serving it through the hooks
let dropped = 0;
const keep = new Set(overrides);
keep.add('public/index.html');
for (const sub of ['files', 'base']) {
  const dir = path.join(MP, sub);
  if (!fs.existsSync(dir)) continue;
  const visit = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { visit(path.join(d, e.name), next); continue; }
      if (next.endsWith('.pre-rebase') || keep.has(next)) continue;
      fs.rmSync(path.join(d, e.name));
      if (sub === 'files') dropped++;
    }
    // prune the directories the removal left empty
    if (rel && !fs.readdirSync(d).length) fs.rmdirSync(d);
  };
  visit(dir, '');
}
const release = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8')).app; } catch { return null; }
})();
if (LIST_ONLY) {
  console.log(`overrides (${overrides.length}) — install v${release ?? '?'}:`);
  for (const rel of overrides) console.log('  ' + rel);
} else {
  console.log(`overlay files: ${copied} (install: v${release ?? '?'}), client routed: ${clientRouted}, index.html: ${indexInjected ? 'injected' : 'NOT injected'}, stale removed: ${dropped}`);
  for (const rel of overrides) console.log('  + ' + rel);
  if (indexInjected) console.log('  + public/index.html (install copy + /sp-mp/client tags)');
  if (missing.length) { console.log('MISSING:'); for (const m of missing) console.log('  ' + m); }
}
