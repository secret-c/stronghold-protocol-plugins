// sp-mp/tools/build-tree.mjs — build the UNION client trees the overlay serves from:
//
//   sp-mp/public/   every file of the install's public/ (assets, vendor and fonts as directory junctions — they are
//                   large and unmodified), with the overlay's own copies winning for the files it carries
//   sp-mp/shared/   the install's shared/*.js, same rule (the browser loads /shared/… as well as the server)
//
// Nothing inside the install is written to. Run it after assemble.mjs, and again after a rebase.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
const OVERLAY = path.join(MP, 'files');

/** Directories of public/ that are large and never overridden: junction them instead of copying. */
const JUNCTION = new Set(['assets', 'vendor', 'fonts', 'icons', 'dev']);

const count = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += count(path.join(dir, e.name));
    else n++;
  }
  return n;
};

function link(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    if (fs.realpathSync(to) === fs.realpathSync(from)) return true;
  } catch { /* missing or stale target: replace it below */ }
  fs.rmSync(to, { recursive: true, force: true });
  try {
    fs.symlinkSync(from, to, 'junction');
    return true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    // Windows without junction permission: copy the resource directory instead.
    fs.cpSync(from, to, { recursive: true });
    return false;
  }
}

function union(fromDir, toDir, rel = '') {
  let files = 0;
  let links = 0;
  fs.mkdirSync(toDir, { recursive: true });
  for (const e of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, e.name);
    const to = path.join(toDir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const carried = fs.existsSync(path.join(OVERLAY, ...relPath.split('/')));   // the overlay carries files below here
      if (!carried && JUNCTION.has(relPath.split('/')[0]) && relPath.split('/').length === 1) {
        if (link(from, to)) links++;
        else files += count(to);
        continue;
      }
      const sub = union(from, to, relPath);
      files += sub.files; links += sub.links;
      continue;
    }
    // a file the overlay does NOT carry is copied as it is; one it does was written by the overlay pass below
    if (fs.existsSync(path.join(OVERLAY, ...relPath.split('/')))) continue;
    fs.copyFileSync(from, to);
    files++;
  }
  return { files, links };
}

/** Copy the overlay's own client files over the union tree. */
function overlayPass(kind) {
  const src = path.join(OVERLAY, kind);
  let n = 0;
  if (!fs.existsSync(src)) return n;
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(from, relPath); continue; }
      const to = path.join(MP, kind, ...relPath.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      n++;
    }
  };
  walk(src);
  return n;
}

const pub = union(path.join(ROOT, 'public'), path.join(MP, 'public'));
const shared = union(path.join(ROOT, 'shared'), path.join(MP, 'shared'));
const pubOv = overlayPass('public');
const sharedOv = overlayPass('shared');

// Standalone releases do not carry the developer-only assemble.mjs. Route the
// plugin's own browser modules during union build as well as during assembly.
const ownClient = path.join(MP, 'client');
const servedClient = path.join(MP, 'public', 'sp-mp', 'client');
fs.mkdirSync(servedClient, { recursive: true });
fs.cpSync(ownClient, servedClient, { recursive: true });

// The browser and Node must run the same simulation overrides. /sim/ has its own static mount.
fs.cpSync(path.join(ROOT, 'server', 'sim'), path.join(MP, 'sim'), { recursive: true });
if (fs.existsSync(path.join(OVERLAY, 'server', 'sim'))) {
  fs.cpSync(path.join(OVERLAY, 'server', 'sim'), path.join(MP, 'sim'), { recursive: true });
}

console.log(`public/: ${pub.files} files copied, ${pub.links} junctions, ${pubOv} overlay files`);
console.log(`shared/: ${shared.files} files copied, ${shared.links} junctions, ${sharedOv} overlay files`);
console.log(`union public/: ${count(path.join(MP, 'public'))} files reachable (assets junctioned)`);
