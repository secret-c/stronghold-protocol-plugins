// Two real isolated Chrome clients against the assembled sp-mp overlay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
const DEV = ROOT;
for (const name of ['client.js', 'client.css', 'entry.js']) {
  assert.deepEqual(fs.readFileSync(path.join(MP, 'public/sp-mp/client', name)), fs.readFileSync(path.join(MP, 'client', name)),
    `assemble/build-tree must serve the current ${name}`);
}
for (const rel of ['js/main.js', 'js/store.js']) {
  assert.deepEqual(fs.readFileSync(path.join(MP, 'public', rel)), fs.readFileSync(path.join(DEV, 'public', rel)),
    `union must serve the current ${rel}`);
}
Module.registerHooks({ resolve: (await import('../hooks.mjs')).resolve });
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server/index.js')).href);
const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
  publicDir: path.join(MP, 'public'), dataDir: path.join(ROOT, 'data'), packsDir: path.join(ROOT, 'packs'),
  sharedDir: path.join(MP, 'shared'), simDir: path.join(MP, 'sim') });
assert.equal(app.lobby.opts.poolTools, true, 'assembled plugin auto-enables direct-install rule');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errors = [];
const screenshotDir = path.join(MP, 'docs/screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });
const url = `http://127.0.0.1:${app.port}/`;

async function makePage(name, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__SP__);
  await page.evaluate(async (n) => { const { enterSession } = await import('/js/screens/title.js'); enterSession(n); }, name);
  await page.waitForFunction(() => globalThis.__SP__.net.status === 'online');
  return page;
}
const request = (page, type, fields = {}) => page.evaluate((t, f) => globalThis.__SP__.net.request(t, f), type, fields);

try {
  const alice = await makePage('Alice', { width: 1280, height: 850 });
  const bob = await makePage('Bob', { width: 700, height: 390 });
  await request(alice, 'room.create', { mode: 'coop', difficulty: 'NORMAL' });
  await alice.waitForFunction(() => !!globalThis.__SP__.store.get().room?.code);
  const code = await alice.evaluate(() => globalThis.__SP__.store.get().room.code);
  await request(bob, 'room.join', { code });
  await request(bob, 'room.ready', { ready: true });
  await request(alice, 'room.start');
  await Promise.all([alice, bob].map((page) => page.waitForFunction(() => !!globalThis.__SP__.store.get().match?.pool?.entries?.length
    && globalThis.__SP__.store.get().match?.public?.poolToolsEnabled)));
  await alice.waitForSelector('.sp-mp-poolbtn:not([hidden])');
  await alice.click('.sp-mp-poolbtn');
  await alice.waitForSelector('.sp-mp-pool__affinity-select');
  try { await alice.waitForFunction(() => document.querySelector('.sp-mp-pool__affinity-select')?.options.length > 2, { timeout: 5000 }); }
  catch (e) {
    console.log('pool-load-diagnostic', await alice.evaluate(async () => ({
      statuses: ['chess', 'bonds', 'backups'].map((n) => [n, globalThis.__SP__.data.status(n)]),
      counts: ['chess', 'bonds', 'backups'].map((n) => [n, globalThis.__SP__.data.list(n).length]),
      options: document.querySelector('.sp-mp-pool__affinity-select')?.options.length,
      row: document.querySelector('.sp-mp-pool__entry')?.textContent,
      fetched: await Promise.all(['/data/chess.json', '/data/bonds.json', '/data/backups.json'].map(async (u) => {
        const r = await fetch(u); return [u, r.status, (await r.text()).slice(0, 60)];
      })),
    })), errors);
    throw e;
  }
  assert.ok(await alice.$$eval('.sp-mp-pool__entry', (nodes) => nodes.length) > 20);
  const bonds = await alice.$$eval('.sp-mp-pool__affinity-select', (selects) => [...selects[0].options].map((o) => o.value).filter(Boolean));
  assert.ok(bonds.length >= 2);
  const selects = await alice.$$('.sp-mp-pool__affinity-select');
  await selects[0].select(bonds[0]);
  const nextSelects = await alice.$$('.sp-mp-pool__affinity-select');
  await nextSelects[1].select(bonds[1]);
  await alice.click('.sp-mp-pool__confirm');
  await alice.waitForFunction(() => globalThis.__SP__.store.get().match?.private?.shopAffinity?.locked);
  const aliceAffinity = await alice.evaluate(() => globalThis.__SP__.store.get().match.private.shopAffinity);
  assert.deepEqual([aliceAffinity.banBond, aliceAffinity.preferBond], bonds.slice(0, 2));
  assert.deepEqual(await bob.evaluate(() => globalThis.__SP__.store.get().match.private.shopAffinity),
    { banBond: null, preferBond: null, locked: false });
  await new Promise((resolve) => setTimeout(resolve, 220)); // capture after the drawer's entrance animation
  await alice.screenshot({ path: path.join(screenshotDir, 'pool-opening-desktop.png') });
  await bob.waitForSelector('.sp-mp-poolbtn:not([hidden])');
  await bob.click('.sp-mp-poolbtn');
  await bob.waitForSelector('.sp-mp-pool__skip');
  await new Promise((resolve) => setTimeout(resolve, 220));
  await bob.$eval('.sp-mp-pool__entry', (el) => el.scrollIntoView({ block: 'center' }));
  await bob.waitForFunction(() => {
    const panel = document.querySelector('.sp-mp-pool');
    const row = document.querySelector('.sp-mp-pool__entry');
    if (!panel || !row) return false;
    const box = panel.getBoundingClientRect();
    const card = row.getBoundingClientRect();
    return card.top >= box.top && card.bottom <= box.bottom && panel.scrollTop > 0;
  });
  await bob.screenshot({ path: path.join(screenshotDir, 'pool-opening-narrow.png') });
  assert.ok(await bob.$eval('.sp-mp-pool', (el) => el.getBoundingClientRect().width <= innerWidth * 0.45), 'narrow drawer keeps the game visible');
  await bob.click('.sp-mp-pool__skip');
  await bob.waitForFunction(() => globalThis.__SP__.store.get().match?.private?.shopAffinity?.locked);

  const match = app.lobby.getRoom(code).match;
  const row = match.poolView().entries.find((e) => e.tier === 6);
  match.pool.take(row.id, row.cap + 2, { overdraw: true });
  match.flush();
  await Promise.all([alice, bob].map((page) => page.waitForFunction((id) => {
    const row = globalThis.__SP__.store.get().match?.pool?.entries?.find((e) => e.id === id);
    return row?.left === 0 && row?.overdraw === 2;
  }, {}, row.id)));
  const overdrawSelector = `[data-chess-id="${row.id}"] .sp-mp-pool__overdraw`;
  await alice.waitForSelector(overdrawSelector);
  assert.ok(await alice.$eval(overdrawSelector, (el) => el.textContent.includes('2')));
  await request(alice, 'g.infoReady', { setupRevision: 0 });
  await request(bob, 'g.infoReady', { setupRevision: 0 });
  await alice.waitForFunction(() => globalThis.__SP__.store.get().match?.public?.phase === 'BAND_DRAFT');
  assert.ok(await alice.$('.sp-mp-pool__entry'), 'drawer stays open after briefing');
  for (let i = 0; i < 2; i++) {
    const pid = match.draftTurn();
    assert.ok(pid);
    const page = pid === await alice.evaluate(() => globalThis.__SP__.net.playerId) ? alice : bob;
    await request(page, 'g.band', { bandId: match.defaultBand(pid) });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await alice.waitForFunction(() => globalThis.__SP__.store.get().match?.public?.phase === 'PREP', { timeout: 15000 });
  assert.ok(await alice.$('.sp-mp-pool__entry'), 'drawer persists into prep');
  const filterCase = await alice.evaluate(() => {
    const { store, data } = globalThis.__SP__;
    return store.get().match.pool.entries.map((e) => ({ id: e.id, bonds: data.lookup('chess', e.id)?.bonds || [] }))
      .find((e) => e.bonds.length >= 3);
  });
  assert.ok(filterCase, 'a real shared card exposes three bond positions');
  for (const bondId of filterCase.bonds.slice(1, 3)) {
    await alice.select('.sp-mp-pool__bond', bondId);
    await alice.waitForSelector(`[data-chess-id="${filterCase.id}"]`);
  }
  await alice.select('.sp-mp-pool__bond', '');
  const purchase = await alice.evaluate(() => {
    const m = globalThis.__SP__.store.get().match;
    const rows = new Map(m.pool.entries.map((e) => [e.id, e]));
    return m.private.shop.slots.map((s, slot) => ({ ...s, slot })).find((s) => s.kind === 'chess'
      && !s.sold && rows.has(s.id) && !m.private.hand.some((p) => p?.id === s.id));
  });
  assert.ok(purchase, 'first prep shop contains a buyable shared card');
  const playerId = await alice.evaluate(() => globalThis.__SP__.net.playerId);
  match.players.get(playerId).addFunds(100);
  match.flush();
  const beforeBuy = await alice.evaluate((id) => globalThis.__SP__.store.get().match.pool.entries.find((e) => e.id === id).left, purchase.id);
  assert.equal((await request(alice, 'g.buy', { slot: purchase.slot })).t, 'ok');
  await alice.waitForFunction(({ id, left }) => globalThis.__SP__.store.get().match.pool.entries.find((e) => e.id === id)?.left === left - 1,
    {}, { id: purchase.id, left: beforeBuy });
  const uid = await alice.evaluate((id) => globalThis.__SP__.store.get().match.private.hand.find((p) => p?.id === id)?.uid, purchase.id);
  assert.ok(uid, 'purchased card entered the hand');
  assert.equal((await request(alice, 'g.sell', { uid })).t, 'ok');
  await alice.waitForFunction(({ id, left }) => globalThis.__SP__.store.get().match.pool.entries.find((e) => e.id === id)?.left === left,
    {}, { id: purchase.id, left: beforeBuy });
  await alice.screenshot({ path: path.join(screenshotDir, 'pool-prep.png') });
  await alice.reload({ waitUntil: 'domcontentloaded' });
  await alice.waitForFunction(() => !!globalThis.__SP__?.store.get().match?.pool?.entries?.length);
  await alice.waitForSelector('.sp-mp-poolbtn:not([hidden])');
  await alice.click('.sp-mp-poolbtn');
  await alice.waitForSelector(`[data-chess-id="${row.id}"] .sp-mp-pool__overdraw`);
  assert.deepEqual(await alice.evaluate(() => globalThis.__SP__.store.get().match.private.shopAffinity), aliceAffinity);
  await alice.screenshot({ path: path.join(screenshotDir, 'pool-reloaded.png') });
  assert.deepEqual(errors, []);
  console.log('✓ two isolated Chrome clients: pool stock/overdraw, personal choice and skip, secondary/third bond filter, real buy/sell, narrow drawer, phase continuity, reconnect; 4 screenshots saved');
} finally { await browser.close(); await app.close(); }
