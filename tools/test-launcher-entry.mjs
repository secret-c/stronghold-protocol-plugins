// The real Windows entry point must not redirect players to a plain/old server on the same port.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

if (process.platform !== 'win32') throw new Error('this test exercises start-windows.cmd');
const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});
async function health(port, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(700) });
      if (r.ok) return await r.json();
    } catch { /* wait for this test's child service */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`test service on ${port} did not start`);
}
function cmd(port) {
  const child = spawn('cmd.exe', ['/d', '/c', 'sp-mp\\start-windows.cmd', '--port', String(port), '--no-open'],
    { cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (b) => { output += b.toString(); });
  child.stderr.on('data', (b) => { output += b.toString(); });
  child.stdin.write('x\n'); // release the wrapper's pause on an expected startup failure
  return { child, output: () => output };
}
function exited(child, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`cmd did not exit in ${timeout} ms`)), timeout);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
function stopTree(child) {
  if (!child || !child.pid) return;
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}

const plainPort = await freePort();
const plain = spawn(process.execPath, ['--input-type=module', '-e',
  `import { startServer } from './server/index.js'; await startServer({ port: ${plainPort}, host: '127.0.0.1', quiet: true, assetIndex: false });`],
{ cwd: ROOT, windowsHide: true, stdio: 'ignore' });
try {
  const h = await health(plainPort);
  assert.equal(h.capabilities?.roomChat, undefined, 'installed host has no plugin backend');
  const conflict = cmd(plainPort);
  const code = await exited(conflict.child);
  assert.notEqual(code, 0, `launcher must reject a plain service: ${conflict.output()}`);
  assert.match(conflict.output(), /不是当前|different build/);
  console.log('✓ start-windows.cmd rejects a plain server already on its port');
} finally { plain.kill(); }

const port = await freePort();
const live = cmd(port);
let browser;
try {
  const h = await health(port);
  assert.deepEqual(h.capabilities, { roomChat: true, poolTools: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(MP, 'plugin.json'), 'utf8'));
  assert.equal(h.spMp?.version, manifest.version);
  assert.ok(h.spMp?.signature);
  const same = cmd(port);
  assert.equal(await exited(same.child), 0, `same-version launcher should reuse this service: ${same.output()}`);
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 850, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__SP__);
  await page.evaluate(async () => { const { enterSession } = await import('/js/screens/title.js'); enterSession('Solo'); });
  await page.waitForFunction(() => globalThis.__SP__.net.status === 'online');
  assert.equal((await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }))).t, 'ok');
  await page.waitForFunction(() => !!globalThis.__SP__.store.get().room?.code);
  await page.waitForSelector('.sp-mp-chatbtn.is-room');
  await page.click('.sp-mp-chatbtn.is-room');
  await page.type('.sp-mp-chat__input', 'single-player hello');
  await page.click('.sp-mp-chat__send');
  await page.waitForFunction(() => [...document.querySelectorAll('.sp-mp-chat__message')]
    .some((e) => e.textContent.includes('single-player hello')));
  assert.equal(await page.$$eval('.sp-mp-chat__message', (rows) => rows.filter((e) => e.textContent.includes('single-player hello')).length), 1);
  assert.ok(await page.$eval('.sp-mp-chat__error', (el) => el.hidden && !el.textContent));
  assert.equal((await page.evaluate(() => globalThis.__SP__.net.request('room.start'))).t, 'ok');
  await page.waitForFunction(() => !!globalThis.__SP__.store.get().match?.public?.poolToolsEnabled
    && !!globalThis.__SP__.store.get().match?.pool?.entries?.length);
  await page.waitForSelector('.sp-mp-poolbtn:not([hidden])');
  await page.click('.sp-mp-poolbtn');
  await page.waitForSelector('.sp-mp-pool__affinity-select');
  await page.waitForFunction(() => document.querySelector('.sp-mp-pool__affinity-select')?.options.length > 2);
  await new Promise((resolve) => setTimeout(resolve, 220));
  await page.screenshot({ path: path.join(MP, 'docs/screenshots/pool-single-launcher.png') });
  assert.deepEqual(errors, []);
  console.log('✓ real start-windows.cmd: current service reused, one Chrome player sends exactly one chat echo, pool choices and rows open');
} finally {
  if (browser) await browser.close();
  stopTree(live.child);
}
