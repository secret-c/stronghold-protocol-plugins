// sp-mp/start.mjs — start the editable project root through the multiplayer overlay.
//
//   node sp-mp/start.mjs [--port 3000] [--host ::] [--no-open]
//
// The overlay carries generated runtime differences against the 0.2.6 baseline. Node hooks and union client trees
// ensure the edited root runs with the same plugin files as the exported version. See README.md for the workflow.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Module, { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = path.dirname(MP);
const manifest = JSON.parse(fs.readFileSync(path.join(MP, 'plugin.json'), 'utf8'));
const signature = (() => {
  const hash = createHash('sha256');
  const include = (base, rel = '') => {
    for (const ent of fs.readdirSync(path.join(base, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) include(base, next);
      else if (ent.isFile()) { hash.update(`${path.basename(base)}/${next}\0`); hash.update(fs.readFileSync(path.join(base, next))); }
    }
  };
  include(path.join(MP, 'files'));
  include(path.join(MP, 'client'));
  return hash.digest('hex').slice(0, 16);
})();
const spMp = Object.freeze({ version: manifest.version, signature });

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

// A distributed overlay has no machine-specific union tree. Rebuild it on first launch
// (and after moving or replacing the overlay), so players never need a command prompt.
const unionStamp = path.join(MP, '.union-build.json');
const unionKey = JSON.stringify({ root: fs.realpathSync(ROOT), signature: spMp.signature });
const unionFiles = ['public/index.html', 'public/sp-mp/client/entry.js', 'public/sp-mp/client/client.css', 'shared/constants.js', 'sim/spec.js'];
const unionReady = () => unionFiles.every((rel) => fs.existsSync(path.join(MP, rel)));
if (!unionReady() || !fs.existsSync(unionStamp) || fs.readFileSync(unionStamp, 'utf8') !== unionKey) {
  console.log('[sp-mp] 首次启动或文件更新：正在准备游戏页面，请稍候…');
  const built = spawnSync(process.execPath, [path.join(MP, 'tools', 'build-tree.mjs')], { cwd: ROOT, stdio: 'inherit' });
  if (built.error || built.status !== 0) {
    console.error('[sp-mp] 页面准备失败。请检查游戏文件是否完整，再重新双击启动。');
    process.exit(2);
  }
  if (!unionReady()) {
    console.error('[sp-mp] 页面文件不完整，请检查扩充包后重新启动。');
    process.exit(2);
  }
  fs.writeFileSync(unionStamp, unionKey);
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
  const expected = live.spMp?.version === spMp.version && live.spMp?.signature === spMp.signature
    && live.capabilities?.roomChat === true && live.capabilities?.poolTools === true;
  let entryMatches = false;
  if (expected) {
    try {
      const [index, entry] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }),
        fetch(`http://127.0.0.1:${port}/sp-mp/client/entry.js`, { signal: AbortSignal.timeout(1500) }),
      ]);
      entryMatches = index.ok && entry.ok && (await index.text()).includes('/sp-mp/client/entry.js')
        && (await entry.text()) === fs.readFileSync(path.join(MP, 'client', 'entry.js'), 'utf8');
    } catch { /* an unreadable client is not the current plugin service */ }
  }
  if (!expected || !entryMatches) {
    console.error(`\n[sp-mp] 端口 ${port} 已由另一个服务占用，且不是当前 ${manifest.version} 叠加层（或其客户端文件不匹配）。`);
    console.error('        请关闭占用该端口的旧服务器窗口后重新启动本启动器；也可用 --port 3001 换端口。');
    console.error(`        port ${port} is serving a different build; stop that server or choose another port.\n`);
    process.exit(3);
  }
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
    dataDir: path.join(ROOT, 'data'),
    packsDir: path.join(ROOT, 'packs'),
    sharedDir: path.join(MP, 'shared'),
    simDir: path.join(MP, 'sim'),
    poolTools: true,
    spMp,
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
