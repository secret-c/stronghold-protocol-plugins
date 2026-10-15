// Optional real-Chrome integration and screenshot. No match is created on the live game server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url))), ROOT = path.dirname(MP);
Module.registerHooks({ resolve: (await import('../hooks.mjs')).resolve });
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server/index.js')).href);
const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
  publicDir: path.join(MP, 'public'), sharedDir: path.join(MP, 'shared'), simDir: path.join(MP, 'sim') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 720, height: 600, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (req) => req.url().endsWith('/sp-mp-check') ? req.respond({ status: 200, contentType: 'text/html', body: '<html lang="zh-CN"><meta charset="utf-8"><style>body{background:#15201d;font-family:Arial,sans-serif}.gm__corner{position:fixed;bottom:14px;left:12px}.gm__gear{width:32px;height:32px;background:#263e34;color:#b7c9c2;border:1px solid #425b50}</style><body><div class="gm__corner"><button class="gm__fs">⛶</button></div></body></html>' }) : req.continue());
  await page.goto(`http://127.0.0.1:${app.port}/sp-mp-check`);
  const evidence = await page.evaluate(async () => {
    const { createBattleRunner, loadBrowserSim } = await import('/js/battle/runner.js');
    const { Battle } = await import('/sim/Battle.js');
    const sim = await loadBrowserSim();
    const chess = await (await fetch('/data/chess.json')).json();
    const ids = Object.keys(chess).filter((id) => id.endsWith('_a')).slice(0, 3);
    const players = [{ playerId: 'demo', seat: 0, side: 'L', colOffset: 0, bonds: {}, units: ids.map((chessId, i) => ({ uid: i + 1, kind: 'chess', chessId, row: 10, col: i + 4 })) }];
    const b = new Battle({ seed: 1, kind: 'normal', stageId: 'act2autochess_m01', fieldId: 'demo-field', players, data: sim.ds, content: 'none', autoFinish: false, devices: false });
    b.start();
    const r = createBattleRunner({ net: { on: () => () => {} }, store: { get: () => ({}), patch() {} }, doc: null,
      now: () => 1000, raf: () => 1, cancelRaf() {}, setInterval: () => 1, clearInterval() {},
      loadSim: async () => ({ ...sim, spec: { ...sim.spec, createBattleFromSpec: () => b } }) });
    await r.onStart({ battleId: 'demo', fieldId: 'demo-field', kind: 'normal', spec: { players, kind: 'normal' } });
    const target = { ...b.allyUnits[0], id: 90000, side: 'enemy', hp: 100000, bossPool: null, alive: true, deployed: true,
      stats: { dmg: 0, taken: 0 }, get s() { return { ...b.allyUnits[0].s, def: 0, res: 0, flags: {} }; } };
    const values = [[1200, 500, 300, 200], [700, 200, 100, 0], [0, 300, 0, 0]];
    b.allyUnits.slice(0, 3).forEach((op, i) => ['phys', 'arts', 'elemental', 'true'].forEach((type, j) => { if(values[i][j]) b.dealDamage(op, target, { amount: values[i][j], type, canDodge: false }); }));
    globalThis.__SP_RUNNER__ = r;
    globalThis.__SP__ = { net: { playerId: 'demo' }, data: { lookup: (_kind, id) => chess[id], get: () => null } };
    (await import('/sp-mp/client/client.js')).start();
    document.querySelector('.sp-mp-dmgbtn').click();
    return { rows: r.combatStats('demo'), bars: document.querySelectorAll('.sp-mp-dmg__bar').length };
  });
  assert.equal(evidence.bars, 3); assert.deepEqual(evidence.rows.map((r) => r.dmg), [2200, 1000, 300]);
  const bars = await page.$$eval('.sp-mp-dmg__bar', (els) => els.map((el) => ({ width: el.style.width, segments: el.children.length })));
  assert.equal(bars[0].segments, 4); assert.equal(bars[0].width, '100%');
  const overview = path.join(MP, 'docs', 'screenshots', 'damage-panel-overview.png'); fs.mkdirSync(path.dirname(overview), { recursive: true });
  await page.screenshot({ path: overview });
  await page.hover('.sp-mp-dmg__row');
  const tip = await page.$eval('.sp-mp-dmg__tooltip', (el) => ({ text: el.textContent, visible: getComputedStyle(el).display !== 'none' }));
  assert.ok(tip.visible && tip.text.includes('元素：300') && tip.text.includes('真实：200'));
  const out = path.join(MP, 'docs', 'screenshots', 'damage-panel.png'); fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log('✓ Chrome: actual engine → runner → 3 stacked bars, total 3500, hover breakdown; screenshot ' + out);
} finally { await browser.close(); await app.close(); }
