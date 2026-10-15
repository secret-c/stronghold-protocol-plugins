// Real launcher routing and reversible direct installation, without touching the user's installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
Module.registerHooks({ resolve: (await import('../hooks.mjs')).resolve });
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server/index.js')).href);
const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
  publicDir: path.join(MP, 'public'), sharedDir: path.join(MP, 'shared'), simDir: path.join(MP, 'sim') });
try {
  for (const [url, source] of [
    ['/sim/damage.js', 'files/server/sim/damage.js'], ['/js/battle/runner.js', 'files/public/js/battle/runner.js'],
    ['/shared/combatLog.js', 'files/shared/combatLog.js'], ['/js/main.js', 'files/public/js/main.js'],
    ['/sp-mp/client/client.js', 'client/client.js'], ['/sp-mp/client/entry.js', 'client/entry.js'],
  ]) {
    const res = await fetch(`http://127.0.0.1:${app.port}${url}`); assert.equal(res.status, 200);
    assert.equal(await res.text(), fs.readFileSync(path.join(MP, source), 'utf8'), url);
  }
  assert.match(await (await fetch(`http://127.0.0.1:${app.port}/`)).text(), /sp-mp\/client\/entry.js/);
  const { unitDamageTypes } = await import(pathToFileURL(path.join(ROOT, 'server/sim/damage.js')).href);
  assert.equal(typeof unitDamageTypes, 'function', 'Node loads same ledger patch');
  console.log('✓ launcher: real HTTP entry, client, runner and /sim/ bytes match overlay; Node loads ledger');
} finally { await app.close(); }

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mp-install-test-'));
try {
  const mp = path.join(temp, 'sp-mp'); fs.mkdirSync(path.join(mp, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(MP, 'tools/install-patch.mjs'), path.join(mp, 'tools/install-patch.mjs'));
  fs.cpSync(path.join(MP, 'files'), path.join(mp, 'files'), { recursive: true });
  fs.cpSync(path.join(MP, 'client'), path.join(mp, 'client'), { recursive: true });
  const original = path.join(temp, 'public/index.html'); fs.mkdirSync(path.dirname(original), { recursive: true }); fs.writeFileSync(original, 'original');
  const run = (cmd) => execFileSync(process.execPath, [path.join(mp, 'tools/install-patch.mjs'), cmd], { encoding: 'utf8' });
  run('apply');
  assert.equal(fs.readFileSync(path.join(temp, 'public/sp-mp/client/client.js'), 'utf8'), fs.readFileSync(path.join(MP, 'client/client.js'), 'utf8'));
  assert.match(fs.readFileSync(path.join(temp, 'server/sim/damage.js'), 'utf8'), /unitDamageTypes/);
  assert.match(fs.readFileSync(original, 'utf8'), /sp-mp\/client\/entry.js/);
  assert.equal(fs.existsSync(path.join(temp, 'shared/combatLog.js')), true);
  run('revert'); assert.equal(fs.readFileSync(original, 'utf8'), 'original');
  assert.equal(fs.existsSync(path.join(temp, 'public/sp-mp/client/client.js')), false);
  assert.equal(fs.existsSync(path.join(temp, 'server/sim/damage.js')), false);
  assert.equal(fs.existsSync(path.join(temp, 'shared/combatLog.js')), false);
  console.log('✓ direct installer: adds client + sim patch, preserves originals, reverts added files');
} finally {
  const resolved = path.resolve(temp);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(resolved, { recursive: true, force: true });
}
