// sp-mp/hooks.mjs — the module hooks of the multiplayer overlay.
//
// The install keeps its own files byte-identical (so official update packages still apply); every runtime file the
// overlay carries is loaded FROM the overlay instead:
//
//   * a file the install resolves under server/ or shared/ that the overlay also carries → the overlay copy;
//   * an overlay module's relative import of a file the overlay does NOT carry → back to the install
//     (pre-empted before resolution, and caught if resolution throws first);
//   * anything else (node_modules, data, tools, tests) → untouched.
//
// One module instance per file either way: the mapping is by target path, so every importer — overlay or install —
// gets the same instance. Works in-thread (module.registerHooks, Node >= 22.15) and in the async loader thread
// (module.register), so the launcher can pick whichever this Node offers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MP = fileURLToPath(new URL('.', import.meta.url));                   // this plugin folder
export const ROOT = path.dirname(MP);                                            // the install root
const OVERLAY = path.join(MP, 'files');

const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
const asFile = (url) => {
  try { return typeof url === 'string' && url.startsWith('file:') ? fileURLToPath(url) : null; } catch { return null; }
};

/** The overlay copy of an install file, when the overlay carries it. */
function overlayFor(abs) {
  if (!abs || !inside(ROOT, abs)) return null;
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (!(rel.startsWith('server/') || rel.startsWith('shared/'))) return null;
  const ov = path.join(OVERLAY, ...rel.split('/'));
  return fs.existsSync(ov) ? ov : null;
}

/**
 * The install file for a request that an overlay module made: resolve the specifier against the install's own copy of
 * that module's directory. Bare specifiers (node_modules) are left to the default resolution.
 */
function installFallback(specifier, parentUrl) {
  const parentAbs = asFile(parentUrl);
  if (!parentAbs || !inside(OVERLAY, parentAbs)) return null;
  if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) return null;
  const installParent = path.join(ROOT, path.relative(OVERLAY, parentAbs));
  const candidate = path.isAbsolute(specifier) ? specifier : path.resolve(path.dirname(installParent), specifier);
  return fs.existsSync(candidate) ? pathToFileURL(candidate).href : null;
}

function redirect(url) {
  const target = overlayFor(asFile(url));
  return target ? { url: pathToFileURL(target).href } : null;
}

/** resolve hook: one shape works for both the sync (registerHooks) and the async (register) API. */
export function resolve(specifier, context, nextResolve) {
  // NB: an overlay module's own relative import is resolved normally first (the overlay copy wins when it exists);
  // installFallback only steps in when that file lives in the install alone.
  let result;
  try {
    result = nextResolve(specifier, context);
  } catch (e) {
    const retry = installFallback(specifier, context && context.parentURL);
    if (retry) return { url: retry, shortCircuit: true };
    throw e;
  }
  if (result && typeof result.then === 'function') {
    return result.then((r) => {
      const hit = r && r.url ? redirect(r.url) : null;
      return hit ? { ...r, ...hit, shortCircuit: true } : r;
    }, (e) => {
      const retry = installFallback(specifier, context && context.parentURL);
      if (retry) return { url: retry, shortCircuit: true };
      throw e;
    });
  }
  const hit = result && result.url ? redirect(result.url) : null;
  return hit ? { ...result, ...hit, shortCircuit: true } : result;
}
