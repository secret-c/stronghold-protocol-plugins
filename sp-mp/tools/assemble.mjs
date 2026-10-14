// Assemble the overlay: sp-mp/files/<rel> = our modified runtime files (copied from the development tree),
// sp-mp/base/<rel> = the pristine upstream copies they were built from (copied from the INSTALL, which must equal the
// upstream release the working copy is based on — that pair is what tools/rebase.mjs merges against after an update).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));          // this plugin folder
const ROOT = path.dirname(MP);                                                   // the install (a pristine release)
const WORK = path.join(ROOT, 'sp-4-12-16');                                      // our working copy of the change

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

let copied = 0;
const missing = [];
for (const rel of RUNTIME) {
  const src = path.join(WORK, ...rel.split('/'));
  if (!fs.existsSync(src)) { missing.push(rel); continue; }
  put(src, path.join(MP, 'files', ...rel.split('/')));
  // the rebase base: the INSTALL's copy of the same file (the upstream release the overlay was written against)
  const pristine = path.join(ROOT, ...rel.split('/'));
  if (fs.existsSync(pristine)) put(pristine, path.join(MP, 'base', ...rel.split('/')));
  else missing.push(`base: ${rel}`);
  copied++;
}
const release = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8')).app; } catch { return null; }
})();
console.log(`overlay files: ${copied} of ${RUNTIME.length} (install: v${release ?? '?'})`);
if (missing.length) { console.log('MISSING:'); for (const m of missing) console.log('  ' + m); }
