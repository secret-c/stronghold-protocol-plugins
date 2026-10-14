// sp-mp/start.mjs — start the pristine install WITH the multiplayer overlay, without touching a single installed file.
//
//   node sp-mp/start.mjs [--port 3000] [--host ::] [--no-open]
//
// The overlay carries 28 runtime files (4 / 8 / 12-seat co-op rooms). They are loaded through Node's module hooks and
// served from the union trees under sp-mp/, so `npm run doctor` keeps reporting an untouched install and an official
// Stronghold-Protocol-v0.2.x-update.zip still applies. See README.md for the update workflow.
import fs from 'node:fs';
import path from 'node:path';
import Module, { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = path.dirname(MP);
const manifest = JSON.parse(fs.readFileSync(path.join(MP, 'plugin.json'), 'utf8'));

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null;
};

// ---------------------------------------------------------------------------------------------------
// 1. version guard: the overlay is written against ONE upstream release, and says so
// ---------------------------------------------------------------------------------------------------
const installed = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8')).app; } catch { return null; }
})();
const force = process.env.SP_MP_FORCE === '1' || arg('force') === true;
if (!manifest.supports.includes(installed)) {
  console.error(`\n[sp-mp] ${manifest.name} ${manifest.version} is built for Stronghold-Protocol ${manifest.supports.join(' / ')},`);
  console.error(`        but this install is ${installed ? `v${installed}` : 'unknown (no MANIFEST.json)'}.`);
  console.error('        An overlay over a different release can mix two versions silently — refusing to start.');
  console.error('        Rebase it first:  node sp-mp/tools/rebase.mjs');
  console.error('        Or run anyway:    SP_MP_FORCE=1 node sp-mp/start.mjs\n');
  if (!force) process.exit(2);
  console.error('[sp-mp] SP_MP_FORCE=1 — starting anyway.\n');
}

// ---------------------------------------------------------------------------------------------------
// 2. module hooks: the overlay's server/ + shared/ files win over the install's
// ---------------------------------------------------------------------------------------------------
const hooks = path.join(MP, 'hooks.mjs');
if (typeof Module.registerHooks === 'function') Module.registerHooks({ resolve: (await import(pathToFileURL(hooks).href)).resolve });
else register(hooks, import.meta.url); // older Node: the async loader thread, same hook module

// ---------------------------------------------------------------------------------------------------
// 3. start the install's server with the union client trees
// ---------------------------------------------------------------------------------------------------
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server', 'index.js')).href);

const port = Number(arg('port') ?? process.env.PORT) || 3000;
const host = arg('host') ?? process.env.HOST ?? '::';

/** Is a server of this install already answering on the port? */
async function alreadyRunning(p) {
  try {
    const res = await fetch(`http://127.0.0.1:${p}/healthz`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const open = async (url) => {
  if (arg('no-open') === true || /^(1|true|yes)$/i.test(process.env.SP_NO_BROWSER || '')) return;
  const { spawnSync } = await import('node:child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawnSync(cmd[0], cmd[1], { stdio: 'ignore' }); } catch { /* the message above already printed the URL */ }
};

const live = await alreadyRunning(port);
if (live) {
  console.log(`\n[sp-mp] 端口 ${port} 上已经有一个服务器在跑了（app ${live.app}，已运行 ${live.uptimeSec} 秒，房间 ${live.rooms}）。`);
  console.log(`        直接打开浏览器就行： http://localhost:${port}`);
  console.log(`        要另起一个（例如换端口）：  sp-mp\\start-windows.cmd --port ${port + 1}`);
  console.log(`        要重启：先关掉那个服务器窗口（或结束它的 node 进程），再运行本启动器。`);
  console.log(`[sp-mp] a server is already listening on ${port} (app ${live.app}) — opening it instead.\n`);
  await open(`http://localhost:${port}`);
  process.exit(0);
}
console.log(`[sp-mp] ${manifest.name} ${manifest.version} over install v${installed}: ${manifest.files} overlay files, `
  + `${manifest.publicFiles} client files (4 / 8 / 12-seat co-op rooms)`);

try {
  await startServer({
    port,
    host,
    publicDir: path.join(MP, 'public'),
    sharedDir: path.join(MP, 'shared'),
  });
} catch (e) {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`\n[sp-mp] 端口 ${port} 被别的程序占用了，没能启动。`);
    console.error(`        换一个端口试试：  sp-mp\\start-windows.cmd --port ${port + 1}`);
    console.error(`        或者找出占用者：   netstat -ano | findstr :${port}`);
    console.error(`[sp-mp] port ${port} is already in use by something else — try --port ${port + 1}.\n`);
    process.exit(3);
  }
  throw e;
}

