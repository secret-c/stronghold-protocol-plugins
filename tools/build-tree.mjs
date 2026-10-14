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
  fs.rmSync(to, { recursive: true, force: true });
  fs.symlinkSync(from, to, 'junction');
}

function union(fromDir, toDir, rel = '') {
  let files = 0;
  let links = 0;
  fs.mkdirSync(toDir, { recursive: true });
  for (const e of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, e.name);
    const to = path.join(toDir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    const overridden = fs.existsSync(path.join(OVERLAY, ...relPath.split('/')));
    if (e.isDirectory()) {
      if (!overridden && JUNCTION.has(relPath.split('/')[0]) && relPath.split('/').length === 1) { link(from, to); links++; continue; }
      const sub = union(from, to, relPath);
      files += sub.files; links += sub.links;
      continue;
    }
    if (overridden) continue; // the overlay's copy is written in the second pass
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

console.log(`public/: ${pub.files} files copied, ${pub.links} junctions, ${pubOv} overlay files`);
console.log(`shared/: ${shared.files} files copied, ${shared.links} junctions, ${sharedOv} overlay files`);
console.log(`union public/: ${count(path.join(MP, 'public'))} files reachable (assets junctioned)`);
