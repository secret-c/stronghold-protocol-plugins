// Client UI regression: cumulative runner API, actual type buckets, stacked bars and lifecycle.
import assert from 'node:assert/strict';

// ---------------- 最小 DOM ----------------
const created = [];
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, style: {}, dataset: {},
    className: '', innerHTML: '', textContent: '', type: '', title: '', isConnected: true,
    get classList() {
      const self = this;
      return {
        contains: (c) => String(self.className).split(/\s+/).includes(c),
        add: (c) => { self.className = `${self.className} ${c}`.trim(); },
        remove: (c) => { self.className = String(self.className).split(/\s+/).filter((x) => x !== c).join(' '); },
      };
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); this.children.push(c); c.parent = this; c.parentNode = this; return c; },
    append(...children) { for (const c of children) this.appendChild(c); },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    insertBefore(c, before) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, c); c.parent = this; c.parentNode = this; return c; },
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
    contains(c) { return c === this || this.children.some((child) => child.contains(c)); },
    focus() { document.activeElement = this; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== fn); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return find(this, sel); },
    dispatch(type, ev = {}) { for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, target: this, ...ev }); },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._textContent || ''; },
    set(value) { this._textContent = String(value); this.children = []; },
  });
  created.push(el);
  return el;
}
function matches(el, sel) {
  const m = /^([.#]?)([\w-]+)$/.exec(sel.trim());
  if (!m) return false;
  if (m[1] === '.') return String(el.className).split(/\s+/).includes(m[2]);
  if (m[1] === '#') return el.id === m[2];
  return el.tagName === m[2].toUpperCase();
}
function find(root, sel) {
  const out = [];
  const walk = (el) => { for (const c of el.children) { if (matches(c, sel)) out.push(c); walk(c); } };
  walk(root);
  return out;
}
const head = makeEl('head');
const body = makeEl('body');
const windowListeners = {};
globalThis.window = { addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); } };
const corner = makeEl('div');
corner.className = 'gm__corner';
const fsBtn = makeEl('button');
fsBtn.className = 'gm__gear gm__fs';
corner.appendChild(fsBtn);
body.appendChild(corner);

globalThis.document = {
  body, head, activeElement: null,
  getElementById: (id) => find(body, `#${id}`)[0] || find(head, `#${id}`)[0] || null,
  querySelector: (sel) => sel === '.room-screen .topbar__left'
    ? (find(body, '.room-screen')[0] && find(find(body, '.room-screen')[0], '.topbar__left')[0]) || null
    : find(body, sel)[0] || find(head, sel)[0] || null,
  createElement: (tag) => makeEl(tag),
  addEventListener() {}, removeEventListener() {},
};
let rafQueue = [];
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
const timers = [];
globalThis.setInterval = (fn) => { timers.push(fn); return timers.length; };
globalThis.clearInterval = () => {};
const flushRaf = (n = 3) => { for (let i = 0; i < n; i++) { const q = rafQueue; rafQueue = []; for (const fn of q) fn(); } };

// The actual public extension returns cumulative totals; collection never depends on panel visibility.
let battle = { battleId: 'b1', fieldId: 'f1', kind: 'normal' };
let rows = [{ unitId: 101, defId: 'op', name: '物理干员', alive: true, byType: { phys: 400, arts: 100, elemental: 50, true: 25 } },
 { unitId: 102, defId: 'op', name: '同名干员', alive: true, byType: { phys: 100, arts: 0, elemental: 0, true: 0 } }];
const netListeners = {};
let requestError = null;
const sent = [];
const net = {
  playerId: 'p_0', status: 'online',
  on(type, fn) { (netListeners[type] ||= []).push(fn); },
  async request(type, data) { sent.push({ type, data }); if (requestError) throw requestError; },
};
let state = { room: null, me: { playerId: 'p_0' } };
const subscriptions = [];
const store = { get: () => state, subscribe(fn) { subscriptions.push(fn); } };
const setState = (s) => { state = s; subscriptions.forEach((fn) => fn()); };
globalThis.__SP__ = { net, store, data: { lookup: () => null, get: () => null } };
globalThis.__SP_RUNNER__ = { currentBattle: () => battle, combatStats: (pid, fid) => pid === 'p_0' && fid === battle?.fieldId ? rows : [] };
let healthMode = 'current';
globalThis.fetch = async () => {
  if (healthMode === 'unavailable') throw new Error('offline');
  return { ok: true, async json() { return healthMode === 'current'
    ? { ok: true, capabilities: { roomChat: true, poolTools: true } }
    : { ok: true, version: 1 }; } };
};
const mod = await import(new URL('../client/client.js', import.meta.url)); mod.start(); flushRaf();
const btn = find(corner, '.sp-mp-dmgbtn')[0]; assert.ok(btn); assert.equal(corner.children.at(-1), fsBtn);
const panel = () => find(body, '.sp-mp-dmg')[0];
const refresh = () => { timers.forEach((fn) => fn()); return panel().innerHTML; };
btn.dispatch('click'); let html = refresh();
assert.ok(html.includes('675'), 'late open sees full damage');
assert.equal((html.match(/class="sp-mp-dmg__bar"/g) || []).length, 2, 'one stacked bar per unit, duplicate defIds separate');
assert.ok(html.includes('物理：400 · 法术：100 · 元素：50 · 真实：25'), 'hover breakdown uses actual buckets');
assert.ok(html.includes('width:100.000%') && html.includes('width:17.391%'), 'highest-damage normalization');
btn.dispatch('click'); rows[0].byType.true += 25; btn.dispatch('click'); assert.ok(refresh().includes('700'), 'closed panel loses no damage');
rows[0].alive = false; assert.ok(refresh().includes('700'), 'death preserves damage');
battle = { battleId: 'b2', fieldId: 'f1' }; rows = []; assert.ok(refresh().includes('本场战斗没有你的干员'));
net.playerId = null; assert.ok(refresh().includes('还没有连上对局'));
net.playerId = 'p_0'; battle = null; assert.ok(refresh().includes('准备阶段'));
battle = { fieldId: 'f2' }; delete globalThis.__SP_RUNNER__.combatStats; assert.ok(refresh().includes('统计接口未加载'));
console.log('✓ panel: late open, four actual types, one bar per unit, hover totals, close/reopen, death, lifecycle, missing API');

setState({ room: { code: 'ROOM1', spectators: [] }, me: { playerId: 'p_0' } });
flushRaf();
const chatBtn = find(corner, '.sp-mp-chatbtn')[0];
assert.ok(chatBtn && !chatBtn.hidden, 'chat appears in the room');
chatBtn.dispatch('click');
assert.equal(panel(), undefined, 'chat closes the damage panel');
const chat = () => find(body, '.sp-mp-chat')[0];
assert.ok(chat(), 'chat opens');
const input = find(chat(), '.sp-mp-chat__input')[0];
assert.equal(document.activeElement, input, 'chat focuses composer');
const emit = (type, message) => { for (const fn of netListeners[type] || []) fn(message); };
const message = (seq, text, playerId = 'p_1') => ({ code: 'ROOM1', seq, playerId, name: '<other>', text, at: 1_760_000_000_000 });
emit('room.chatHistory', { code: 'ROOM1', messages: [message(1, '<img src=x onerror=alert(1)>')] });
let list = find(chat(), '.sp-mp-chat__messages')[0];
assert.equal(list.children.length, 1);
assert.equal(find(list, 'p')[0].textContent, '<img src=x onerror=alert(1)>', 'message is plain text');
emit('room.chat', message(1, 'duplicate'));
assert.equal(list.children.length, 1, 'history and broadcast deduplicate by sequence');
emit('room.chat', message(2, 'new'));
assert.equal(list.children.length, 2);
input.value = 'draft';
input.dispatch('compositionstart');
const key = (name, extra = {}) => { const ev = { key: name, target: input, preventDefault() {}, stopImmediatePropagation() {}, ...extra }; for (const fn of windowListeners.keydown || []) fn(ev); };
key('Enter', { isComposing: true });
assert.equal(sent.length, 0, 'IME confirmation does not send');
input.dispatch('compositionend');
requestError = new Error('rate');
key('Enter');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(input.value, 'draft', 'failure preserves the draft');
assert.equal(find(chat(), '.sp-mp-chat__error')[0].hidden, false, 'failure is visible');
requestError = null;
key('Enter');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sent.at(-1).type, 'room.chat');
assert.equal(input.value, '', 'successful request clears the submitted draft');
assert.equal(list.children.length, 2, 'sending does not optimistically echo');
emit('room.chat', message(3, 'draft', 'p_0'));
assert.equal(list.children.length, 3, 'server echo appears');
const originalNow = Date.now;
let advancedNow = originalNow() + 16000;
Date.now = () => advancedNow;
healthMode = 'old';
input.value = 'old draft';
const beforeOld = sent.length;
key('Enter');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(sent.length, beforeOld, 'old server capability blocks chat request');
assert.equal(input.value, 'old draft', 'old server keeps chat draft');
assert.ok(find(chat(), '.sp-mp-chat__error')[0].textContent.includes('当前服务未加载 sp-mp 1.6.0'), 'old server shows precise recovery message');
advancedNow += 16000;
healthMode = 'unavailable';
requestError = new Error('offline');
key('Enter');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(find(chat(), '.sp-mp-chat__error')[0].textContent, '发送失败，请重试', 'health network failure retains generic send error');
assert.equal(input.value, 'old draft', 'network failure keeps chat draft');
requestError = null;
Date.now = originalNow;
list.scrollHeight = 1000; list.clientHeight = 200; list.scrollTop = 0;
list.dispatch('scroll');
emit('room.chat', message(4, 'while reading'));
const jump = find(chat(), '.sp-mp-chat__jump')[0];
assert.equal(jump.hidden, false, 'new message offers a jump while reading history');
jump.dispatch('click');
assert.equal(list.scrollTop, 1000);
assert.equal(jump.hidden, true, 'jump clears the pending notice');
btn.dispatch('click');
assert.equal(chat(), undefined, 'damage panel closes chat');
btn.dispatch('click');
chatBtn.dispatch('click');
key('Escape');
assert.equal(chat(), undefined, 'Escape closes chat');
emit('room.chat', message(5, 'unread'));
assert.ok(chatBtn.getAttribute('aria-label').includes('1 条新消息'), 'folded chat counts unread messages');
setState({ room: { code: 'ROOM2', spectators: [{ playerId: 'p_0' }] }, me: { playerId: 'p_0' } });
chatBtn.dispatch('click');
list = find(chat(), '.sp-mp-chat__messages')[0];
assert.equal(list.children.length, 1, 'room change clears previous conversation');
assert.equal(find(chat(), '.sp-mp-chat__form')[0].hidden, true, 'spectators are read-only');
corner.remove();
const roomScreen = makeEl('div'); roomScreen.className = 'room-screen';
const roomTools = makeEl('div'); roomTools.className = 'topbar__left';
roomScreen.appendChild(roomTools); body.appendChild(roomScreen);
flushRaf();
assert.equal(find(roomTools, '.sp-mp-chatbtn')[0], chatBtn, 'chat moves to waiting-room toolbar');
roomScreen.remove();
const resultFoot = makeEl('div'); resultFoot.className = 'result__foot'; body.appendChild(resultFoot);
flushRaf();
assert.equal(find(resultFoot, '.sp-mp-chatbtn')[0], chatBtn, 'chat moves to result actions');
console.log('✓ chat: room lifecycle, text safety, history dedupe, IME, failed draft, server echo, unread, spectator');

const chess = {
  a: { name: '甲', bonds: ['b1', 'b2'] },
  b: { name: '乙', bonds: ['b2'] },
  c: { name: '禁丙', tier: 1, bonds: ['b1', 'b2'] },
  d: { name: '自选丙', bonds: ['b3'] },
};
const bondData = { b1: { bondId: 'b1', name: '一盟' }, b2: { bondId: 'b2', name: '二盟' }, b3: { bondId: 'b3', name: '三盟' } };
globalThis.__SP__.data = {
  lookup(kind, id) { return (kind === 'chess' ? chess : bondData)[id] || null; },
  list(kind) { return kind === 'bonds' ? Object.values(bondData) : []; },
  loadAll: async () => [], subscribe() {}, locale: () => 'zh',
};
const pool = { entries: [
  { id: 'a', tier: 1, cap: 10, left: 0, overdraw: 2 },
  { id: 'b', tier: 2, cap: 5, left: 3 },
] };
const room = { code: 'ROOM2', spectators: [] };
const publicInfo = { phase: 'INFO_CHECK', poolToolsEnabled: true, setupRevision: 1, bannedChess: ['c'] };
setState({ room, me: { playerId: 'p_0' }, match: { public: publicInfo, pool, private: {
  shopAffinity: { banBond: null, preferBond: null, locked: false },
  diyPoolEntries: [{ id: 'd', tier: 5, cap: 2, left: 1 }],
} } });
flushRaf();
const poolBtn = find(body, '.sp-mp-poolbtn')[0];
assert.ok(poolBtn && !poolBtn.hidden, 'pool button appears while feature is enabled');
poolBtn.dispatch('click');
const poolPanel = () => find(body, '.sp-mp-pool')[0];
assert.ok(poolPanel() && !chat(), 'pool drawer closes chat');
const entries = () => find(poolPanel(), '.sp-mp-pool__entry').map((e) => e.getAttribute('data-chess-id'));
assert.deepEqual(entries().sort(), ['a', 'b', 'c', 'd'], 'shared, globally banned and personal rows all shown');
assert.ok(find(poolPanel(), '.sp-mp-pool__stock').some((n) => n.textContent === '剩余 0/10'), 'zero stock stays visible');
assert.equal(find(poolPanel(), '.is-global-ban').length, 1, 'only bannedChess gets the global-ban tag');
assert.equal(find(poolPanel(), '.is-global-ban')[0].getAttribute('data-chess-id'), 'c');
assert.equal(find(find(poolPanel(), '.is-global-ban')[0], '.sp-mp-pool__stock')[0].textContent, '未加入卡池', 'banned card has no fake stock');
assert.equal(find(poolPanel(), '.is-personal-ban').length, 0, 'unconfirmed ban draft does not mark cards');
assert.equal(find(poolPanel(), '.sp-mp-pool__overdraw')[0].textContent, '超额占用 2', 'overdraw is explained');
assert.ok(find(poolPanel(), '.sp-mp-pool__foot')[0].textContent.includes('个人禁用仅影响自己的商店'));
assert.ok(find(poolPanel(), '.is-personal').length, 'DIY stock is a separate section');
const bondFilter = find(poolPanel(), '.sp-mp-pool__bond')[0];
bondFilter.value = 'b2'; bondFilter.dispatch('change');
assert.deepEqual(entries().sort(), ['a', 'b', 'c'], 'bond filter matches any bond position, including global bans');
bondFilter.value = 'b3'; bondFilter.dispatch('change');
assert.deepEqual(entries(), ['d'], 'personal-only DIY bond participates in filtering');
bondFilter.value = ''; bondFilter.dispatch('change');
const tierFilter = find(poolPanel(), '.sp-mp-pool__tier')[0];
tierFilter.value = '5'; tierFilter.dispatch('change');
assert.deepEqual(entries(), ['d'], 'tier filter includes personal stock');
tierFilter.value = ''; tierFilter.dispatch('change');
const search = find(poolPanel(), '.sp-mp-pool__search')[0];
search.value = '乙'; search.dispatch('input');
assert.deepEqual(entries(), ['b'], 'name search filters rows');
search.value = ''; search.dispatch('input');
let affinitySelects = find(poolPanel(), '.sp-mp-pool__affinity-select');
affinitySelects[0].value = 'b1'; affinitySelects[0].dispatch('change');
affinitySelects = find(poolPanel(), '.sp-mp-pool__affinity-select');
affinitySelects[1].value = 'b2'; affinitySelects[1].dispatch('change');
find(poolPanel(), '.sp-mp-pool__affinity-form')[0].dispatch('submit');
await Promise.resolve(); await Promise.resolve();
assert.deepEqual(sent.at(-1), { type: 'g.shopAffinity', data: { setupRevision: 1, banBond: 'b1', preferBond: 'b2' } });
assert.equal(find(poolPanel(), '.sp-mp-pool__confirm').length, 0, 'confirmed choice becomes read-only');
assert.equal(find(poolPanel(), '.is-personal-ban').length, 0, 'request completion alone does not mark an unacknowledged ban');
setState({ room, me: { playerId: 'p_0' }, match: { public: publicInfo, pool, private: {
  shopAffinity: { banBond: 'b1', preferBond: 'b2', locked: true },
  diyPoolEntries: [{ id: 'd', tier: 5, cap: 2, left: 1 }],
} } });
flushRaf();
const marked = find(poolPanel(), '.sp-mp-pool__entry').filter((row) => find(row, '.is-personal-ban').length);
assert.deepEqual(marked.map((row) => row.getAttribute('data-chess-id')).sort(), ['a', 'c'], 'personal ban marks matching bonds only');
assert.equal(find(find(poolPanel(), '.is-global-ban')[0], '.sp-mp-pool__tag').length, 2, 'one card can have both marks');
setState({ room, me: { playerId: 'p_0' }, match: { public: { ...publicInfo, setupRevision: 2 }, pool,
  private: { shopAffinity: { banBond: null, preferBond: null, locked: false }, diyPoolEntries: [] } } });
flushRaf();
assert.equal(find(poolPanel(), '.sp-mp-pool__confirm').length, 1, 'new setup revision resets draft lock');
assert.equal(find(poolPanel(), '.sp-mp-pool__affinity-select')[0].value, '', 'new setup starts with no choice');
assert.equal(find(poolPanel(), '.sp-mp-pool__confirm')[0].disabled, true, 'confirmation requires a choice');
setState({ room, me: { playerId: 'p_0' }, match: { public: { ...publicInfo, setupRevision: 2, rerollVote: { id: 1 } }, pool,
  private: { shopAffinity: { banBond: null, preferBond: null, locked: false }, diyPoolEntries: [] } } });
flushRaf();
assert.equal(find(poolPanel(), '.sp-mp-pool__skip').length, 0, 'reroll vote suspends affinity actions');
setState({ room, me: { playerId: 'p_0' }, match: { public: { ...publicInfo, setupRevision: 2, rerollVote: null }, pool,
  private: { shopAffinity: { banBond: null, preferBond: null, locked: false }, diyPoolEntries: [] } } });
flushRaf();
assert.equal(find(poolPanel(), '.sp-mp-pool__skip').length, 1, 'affinity actions resume after vote');
const beforeHalf = sent.length;
affinitySelects = find(poolPanel(), '.sp-mp-pool__affinity-select');
affinitySelects[1].value = 'b2'; affinitySelects[1].dispatch('change');
find(poolPanel(), '.sp-mp-pool__affinity-form')[0].dispatch('submit');
await Promise.resolve(); await Promise.resolve();
assert.deepEqual(sent.at(-1), { type: 'g.shopAffinity', data: { setupRevision: 2, banBond: null, preferBond: 'b2' } }, 'preference alone submits without a ban');
assert.equal(sent.length, beforeHalf + 1);
setState({ room, me: { playerId: 'p_0' }, match: { public: { ...publicInfo, setupRevision: 3 }, pool,
  private: { shopAffinity: { banBond: null, preferBond: null, locked: false }, diyPoolEntries: [] } } });
flushRaf();
affinitySelects = find(poolPanel(), '.sp-mp-pool__affinity-select');
affinitySelects[0].value = 'b1'; affinitySelects[0].dispatch('change');
affinitySelects = find(poolPanel(), '.sp-mp-pool__affinity-select');
affinitySelects[1].value = 'b2'; affinitySelects[1].dispatch('change');
requestError = new Error('stale');
find(poolPanel(), '.sp-mp-pool__affinity-form')[0].dispatch('submit');
await Promise.resolve(); await Promise.resolve();
assert.equal(find(poolPanel(), '.sp-mp-pool__confirm').length, 1, 'failed choice remains editable');
assert.ok(find(poolPanel(), '.sp-mp-pool__error')[0], 'failed choice shows error');
requestError = null;
find(poolPanel(), '.sp-mp-pool__skip')[0].dispatch('click');
await Promise.resolve(); await Promise.resolve();
assert.deepEqual(sent.at(-1), { type: 'g.shopAffinity', data: { setupRevision: 3, banBond: null, preferBond: null } }, 'skip is explicit null/null');
setState({ room: null, me: { playerId: 'p_0' }, match: {} });
flushRaf();
assert.equal(poolPanel(), undefined, 'drawer closes on room exit');
assert.equal(poolBtn.hidden, true, 'button hides outside match');
console.log('✓ pool: sections, zero stock, bond/tier/name filters, affinity revision and failure');
