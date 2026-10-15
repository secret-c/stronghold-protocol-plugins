// Two isolated browser clients against the assembled plugin HTTP server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { StubMatch } from '../../server/match/StubMatch.js';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
for (const name of ['client.js', 'client.css', 'entry.js']) {
  assert.deepEqual(fs.readFileSync(path.join(MP, 'public/sp-mp/client', name)), fs.readFileSync(path.join(MP, 'client', name)),
    `assemble must route the current ${name} before browser validation`);
}
assert.deepEqual(fs.readFileSync(path.join(MP, 'public/js/main.js')),
  fs.readFileSync(path.join(ROOT, 'public/js/main.js')), 'union must include current chat bootstrap');
Module.registerHooks({ resolve: (await import('../hooks.mjs')).resolve });
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server/index.js')).href);
const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
  MatchClass: StubMatch, publicDir: path.join(MP, 'public'), sharedDir: path.join(MP, 'shared'), simDir: path.join(MP, 'sim') });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errors = [];
const screenshotDir = path.join(MP, 'docs/screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });
const url = `http://127.0.0.1:${app.port}/`;

async function makePage(name, viewport, slowFonts = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  if (slowFonts) await page.evaluateOnNewDocument(() => {
    Object.defineProperty(document.fonts, 'load', { configurable: true,
      value: () => new Promise((resolve) => setTimeout(() => resolve([]), 1000)) });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__SP__);
  await page.evaluate(async (n) => { const { enterSession } = await import('/js/screens/title.js'); enterSession(n); }, name);
  await page.waitForFunction(() => globalThis.__SP__.net.status === 'online');
  return page;
}

const request = (page, type, fields = {}) => page.evaluate((t, f) => globalThis.__SP__.net.request(t, f), type, fields);
try {
  const alice = await makePage('Alice', { width: 1280, height: 850 });
  const bob = await makePage('Bob', { width: 700, height: 390 }, true);
  await request(alice, 'room.create', { mode: 'coop', difficulty: 'NORMAL' });
  await alice.waitForFunction(() => !!globalThis.__SP__.store.get().room?.code);
  const code = await alice.evaluate(() => globalThis.__SP__.store.get().room.code);
  await request(bob, 'room.join', { code });
  await bob.waitForFunction((c) => globalThis.__SP__.store.get().room?.code === c, {}, code);
  await alice.waitForSelector('.room-screen .topbar__left .sp-mp-chatbtn:not([hidden])');
  await bob.waitForSelector('.room-screen .topbar__left .sp-mp-chatbtn:not([hidden])');
  await alice.click('.sp-mp-chatbtn');
  await alice.waitForSelector('.sp-mp-chat__input:focus');
  const text = '我守左路，下一波一起支援';
  await alice.type('.sp-mp-chat__input', text);
  await alice.keyboard.press('Enter');
  await alice.waitForFunction((value) => document.querySelector('.sp-mp-chat__message')?.textContent.includes(value), {}, text);
  await bob.waitForFunction(() => !!document.querySelector('.sp-mp-chatbtn__badge'));
  assert.equal(await alice.$$eval('.sp-mp-chat__message', (els) => els.length), 1, 'self echo appears once');
  await bob.click('.sp-mp-chatbtn');
  await bob.waitForFunction((value) => document.querySelector('.sp-mp-chat__message')?.textContent.includes(value), {}, text);
  assert.equal(await bob.$eval('.sp-mp-chat__input', (el) => document.activeElement === el), true, 'opening focuses input');
  await bob.evaluate(() => {
    const input = document.querySelector('.sp-mp-chat__input');
    input.value = '候选';
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(app.lobby.getRoom(code).chatHistory.length, 1, 'IME submit does not send incomplete text');
  await bob.evaluate(() => {
    const input = document.querySelector('.sp-mp-chat__input');
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    input.value = '';
  });
  await bob.evaluate(async () => { const { switchLang } = await import('/js/ui/lang.js'); await switchLang('en'); });
  await bob.waitForFunction(() => document.querySelector('.sp-mp-chat__head h3')?.textContent === 'Alliance chat');
  await bob.evaluate(async () => { const { switchLang } = await import('/js/ui/lang.js'); await switchLang('zh'); });
  await bob.screenshot({ path: path.join(screenshotDir, 'chat-waiting-narrow.png') });
  await bob.keyboard.press('Escape');
  await bob.waitForFunction(() => !document.querySelector('.sp-mp-chat'));
  assert.equal(await bob.$eval('.sp-mp-chatbtn', (el) => document.activeElement === el), true, 'Escape restores button focus');
  await alice.keyboard.press('Escape');

  // A delayed font phase makes the server replay arrive before the plugin can see __SP__.
  await bob.reload({ waitUntil: 'domcontentloaded' });
  await bob.waitForFunction(() => globalThis.__SP__?.store.get().room?.code);
  assert.ok(await bob.evaluate(() => globalThis.__SP__.net.chatBootstrap.messages.length) >= 1,
    'main buffered room history before plugin attachment');
  await bob.waitForSelector('.sp-mp-chatbtn:not([hidden])');
  await bob.click('.sp-mp-chatbtn');
  await bob.waitForFunction((value) => document.querySelector('.sp-mp-chat__message')?.textContent.includes(value), {}, text);
  assert.equal(await bob.$$eval('.sp-mp-chat__message', (els) => els.length), 1, 'refresh hydrate deduplicated');
  await bob.screenshot({ path: path.join(screenshotDir, 'chat-reloaded.png') });

  await request(bob, 'room.ready', { ready: true });
  await request(alice, 'room.start');
  await alice.waitForSelector('.brief__foot .sp-mp-chatbtn:not([hidden])');
  await bob.waitForSelector('.brief__foot .sp-mp-chatbtn:not([hidden])');
  await alice.click('.brief__foot .sp-mp-chatbtn');
  await alice.waitForSelector('.sp-mp-chat__message');
  await alice.screenshot({ path: path.join(screenshotDir, 'chat-briefing.png') });
  await alice.keyboard.press('Escape');
  await bob.reload({ waitUntil: 'domcontentloaded' });
  await bob.waitForFunction(() => globalThis.__SP__?.store.get().room?.inMatch);
  assert.ok(await bob.evaluate(() => globalThis.__SP__.net.chatBootstrap.messages.length) >= 1,
    'active-match room state and early chat replay survive delayed plugin attachment');
  await bob.waitForSelector('.brief__foot .sp-mp-chatbtn:not([hidden])');
  await bob.click('.brief__foot .sp-mp-chatbtn');
  await bob.waitForFunction((value) => document.querySelector('.sp-mp-chat__message')?.textContent.includes(value), {}, text);
  assert.equal(await bob.$$eval('.sp-mp-chat__message', (els) => els.length), 1);
  await request(alice, 'g.infoReady');
  await request(bob, 'g.infoReady');
  await alice.waitForSelector('.result__foot .sp-mp-chatbtn:not([hidden])');
  await bob.waitForSelector('.result__foot .sp-mp-chatbtn:not([hidden])');
  await alice.click('.result__foot .sp-mp-chatbtn');
  await alice.waitForFunction((value) => document.querySelector('.sp-mp-chat__message')?.textContent.includes(value), {}, text);
  await alice.screenshot({ path: path.join(screenshotDir, 'chat-result.png') });
  const unsafeText = '<img src=x onerror=alert(1)> hello';
  await alice.type('.sp-mp-chat__input', unsafeText);
  await alice.keyboard.press('Enter');
  await alice.waitForFunction((value) => [...document.querySelectorAll('.sp-mp-chat__message')].some((el) => el.textContent.includes(value)), {}, unsafeText);
  await bob.waitForFunction((value) => [...document.querySelectorAll('.sp-mp-chat__message')].some((el) => el.textContent.includes(value)), {}, unsafeText);
  assert.equal(await bob.$$eval('.sp-mp-chat__message img', (els) => els.length), 0, 'plain text cannot create HTML');
  assert.equal(await alice.$$eval('.sp-mp-chat__message', (els) => els.length), 2, 'new self echo appears once');

  const scrollState = () => {
    const list = document.querySelector('.sp-mp-chat__messages');
    const top = list.getBoundingClientRect().top;
    const first = [...list.querySelectorAll('[data-seq]')].find((el) => el.getBoundingClientRect().bottom > top);
    return { seq: first?.getAttribute('data-seq'), top: first?.getBoundingClientRect().top - top };
  };
  const snapshot = (from, to) => alice.evaluate((start, end, roomCode) => {
    const messages = Array.from({ length: end - start + 1 }, (_, i) => ({
      t: 'room.chat', code: roomCode, seq: start + i, playerId: 'test', name: 'Teammate',
      at: Date.now(), text: `第 ${start + i} 条队伍消息` }));
    globalThis.__SP__.net._onMessage(JSON.stringify({ t: 'room.chatHistory', code: roomCode, messages }));
  }, from, to, code);
  await snapshot(1, 60);
  await alice.$eval('.sp-mp-chat__messages', (list) => { list.scrollTop = 90; list.dispatchEvent(new Event('scroll')); });
  const beforeAppend = await alice.evaluate(scrollState);
  await snapshot(1, 61);
  const afterAppend = await alice.evaluate(scrollState);
  assert.deepEqual(afterAppend, beforeAppend, 'tail append keeps the visible old message in place');
  await snapshot(1, 100);
  await alice.$eval('.sp-mp-chat__messages', (list) => { list.scrollTop = list.scrollHeight / 2; list.dispatchEvent(new Event('scroll')); });
  const beforeTrim = await alice.evaluate(scrollState);
  await snapshot(11, 110);
  const afterTrim = await alice.evaluate(scrollState);
  assert.equal(afterTrim.seq, beforeTrim.seq, 'head trim anchors the still-visible message');
  assert.ok(Math.abs(afterTrim.top - beforeTrim.top) < 2, 'head trim retains its position within pixel rounding');
  // The stub match has no prep/combat board; exercise that phase's real plugin anchor and mutual exclusion.
  await alice.evaluate(() => {
    const corner = document.createElement('div'); corner.className = 'gm__corner'; document.body.appendChild(corner);
  });
  await alice.waitForSelector('.gm__corner .sp-mp-chatbtn');
  await alice.waitForSelector('.gm__corner .sp-mp-dmgbtn');
  await alice.$eval('.gm__corner .sp-mp-dmgbtn', (el) => el.click());
  await alice.waitForSelector('.sp-mp-dmg');
  assert.equal(await alice.$('.sp-mp-chat'), null, 'damage panel closes chat');
  await alice.$eval('.gm__corner .sp-mp-chatbtn', (el) => el.click());
  await alice.waitForSelector('.sp-mp-chat');
  assert.equal(await alice.$('.sp-mp-dmg'), null, 'chat closes damage panel');
  assert.deepEqual(errors, []);
  console.log('✓ two isolated Chrome clients: room send/unread/IME/language/escape, safe text, single echo, delayed refresh replay, briefing/result anchors, scroll append/trim, combat-corner mutual exclusion; 4 screenshots saved');
} finally { await browser.close(); await app.close(); }
