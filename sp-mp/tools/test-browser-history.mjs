// Real app dispatch -> latest-match persistence -> result/external/reload viewer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { makeMatch } from '../../test/match/harness.js';
import { combatLogRows, COMBAT_LOG_KEY } from '../../shared/combatLog.js';
const h = makeMatch({ humans: 2, bots: 1, clientCombat: true, seed: 8821 }); h.autoHumans(); h.start(); h.runToPhase('PREP', 3); h.m.finish({ victory: false });
const result = JSON.parse(JSON.stringify({ ...h.ended, t: 'm.result', playerId: 'p_0' })); h.m.dispose();
const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url))), ROOT = path.dirname(MP);
Module.registerHooks({ resolve: (await import('../hooks.mjs')).resolve });
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server/index.js')).href);
const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
  publicDir: path.join(MP, 'public'), sharedDir: path.join(MP, 'shared'), simDir: path.join(MP, 'sim') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 850, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const pathname = new URL(req.url()).pathname;
    if (pathname === '/sp-mp/client/client.js' || pathname === '/sp-mp/client/client.css') {
      const file = path.join(MP, 'client', path.basename(pathname));
      req.respond({ status: 200, contentType: pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: fs.readFileSync(file) });
    } else req.continue();
  });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + app.port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__SP__);
  await page.evaluate((res) => {
    const { net, store } = globalThis.__SP__;
    store.set({ session: { entered: true }, me: { ...store.get().me, playerId: 'p_0', name: 'P0' },
      room: { mode: 'coop', inMatch: false, seats: [] }, match: { ...store.get().match, public: { phase: 'RESULT', round: 2, players: res.players } } });
    net._onMessage(JSON.stringify(res));
  }, result);
  await page.waitForSelector('.result__foot');
  await page.waitForSelector('.sp-mp-historybtn:not([hidden])');
  await page.click('.sp-mp-historybtn');
  await page.waitForSelector('.sp-mp-dmg__filters');
  const expected = combatLogRows(result.combatLog);
  assert.equal(await page.$$eval('.sp-mp-dmg__row', (els) => els.length), expected.length);
  assert.ok(await page.$eval('.sp-mp-dmg', (el) => el.textContent.includes('P1') && el.textContent.includes('AI0')));
  const out = path.join(os.tmpdir(), 'combat-history-result.png');
  await page.screenshot({ path: out });
  await page.evaluate(async () => { const { switchLang } = await import('/js/ui/lang.js'); await switchLang('en'); });
  await page.waitForFunction(() => document.querySelector('.sp-mp-dmg__title')?.textContent === 'Last Match Damage'
    && document.querySelector('.sp-mp-archive')?.textContent === 'Alliance totals');
  await page.evaluate(async () => { const { switchLang } = await import('/js/ui/lang.js'); await switchLang('zh'); });
  await page.evaluate(async () => { const { emptyMatch } = await import('/js/store.js'); globalThis.__SP__.store.set({ room: null, match: emptyMatch() }); });
  await page.waitForFunction(() => !document.querySelector('.result__foot'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__SP__);
  await page.waitForSelector('.sp-mp-historybtn:not([hidden])'); await page.click('.sp-mp-historybtn');
  await page.waitForSelector('.sp-mp-player');
  assert.equal(await page.$$eval('.sp-mp-dmg__row', (els) => els.length), expected.length, 'reload preserved all players/rounds outside room');
  await page.click('.sp-mp-player');
  assert.equal(await page.evaluate(async () => {
    const select = document.querySelector('.sp-mp-player');
    await new Promise((resolve) => setTimeout(resolve, 850));
    return select === document.querySelector('.sp-mp-player') && document.activeElement === select;
  }), true, 'native player select keeps its node and focus across several polls');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.$eval('.sp-mp-player', (el) => el.value), '1', 'keyboard selects a player after the native menu stays open');
  await page.click('.sp-mp-round');
  assert.equal(await page.evaluate(async () => {
    const select = document.querySelector('.sp-mp-round');
    await new Promise((resolve) => setTimeout(resolve, 600));
    return select === document.querySelector('.sp-mp-round') && document.activeElement === select;
  }), true, 'native round select also survives polling');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.$eval('.sp-mp-round', (el) => el.value), '1', 'keyboard selects a round after the native menu stays open');
  assert.ok(await page.$$eval('.sp-mp-dmg__name', (els) => els.length > 0 && els.every((el) => el.textContent.includes('P1'))));
  await page.hover('.sp-mp-dmg__row');
  assert.equal(await page.evaluate(async () => {
    const row = document.querySelector('.sp-mp-dmg__row');
    await new Promise((resolve) => setTimeout(resolve, 850));
    return row === document.querySelector('.sp-mp-dmg__row');
  }), true, 'hovered tooltip row stays mounted across several polls');
  assert.equal(await page.$eval('.sp-mp-player', (el) => el.value), '1', 'player filter persists');
  assert.equal(await page.$eval('.sp-mp-round', (el) => el.value), '1', 'round filter persists');
  await page.screenshot({ path: path.join(os.tmpdir(), 'combat-history-reloaded.png') });
  await page.evaluate((res) => {
    Storage.prototype.setItem = function () { throw Error('quota'); };
    globalThis.__SP__.net._onMessage(JSON.stringify(res));
  }, result);
  await page.waitForFunction(() => document.querySelector('.sp-mp-dmg')?.textContent.includes('未能保存本机'));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => !!globalThis.__SP__);
  await page.evaluate((key) => localStorage.setItem(key, '{corrupted'), COMBAT_LOG_KEY);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => !!globalThis.__SP__);
  await page.waitForSelector('.sp-mp-historybtn:not([hidden])'); await page.click('.sp-mp-historybtn');
  await page.waitForFunction(() => document.querySelector('.sp-mp-dmg')?.textContent.includes('本机统计记录损坏'));
  assert.deepEqual(errors, []);
  console.log('✓ actual result UI, all teammates+AI, round/player filters, room exit+reload, storage failure/corruption; screenshots saved');
} finally { await browser.close(); await app.close(); }
