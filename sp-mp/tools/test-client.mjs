// sp-mp 客户端插件回归测试（Node + 最小 DOM 桩）：验证
//   * 没有对局时不显示数字、提示正确
//   * 用宿主的 __SP__.net.playerId 认出自己
//   * 面板渲染出干员、总伤害、占比、类型构成
//   * HP 减少量累加成伤害；换战斗会清空
// 用法: node sp-mp/tools/test-client.mjs
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
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    insertBefore(c) { this.children.unshift(c); c.parent = this; return c; },
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== fn); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return find(this, sel); },
    dispatch(type, ev = {}) { for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, target: this, ...ev }); },
  };
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
const corner = makeEl('div');
corner.className = 'gm__corner';
const fsBtn = makeEl('button');
fsBtn.className = 'gm__gear gm__fs';
corner.appendChild(fsBtn);
body.appendChild(corner);

globalThis.document = {
  body, head,
  getElementById: (id) => find(body, `#${id}`)[0] || find(head, `#${id}`)[0] || null,
  querySelector: (sel) => find(body, sel)[0] || find(head, sel)[0] || null,
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

// ---------------- 宿主桩 ----------------
const CHESS = {
  op_phys: { chessId: 'op_phys', name: '物理干员', dmgType: 'phys', skills: [{ desc: '造成物理伤害' }], talents: [] },
  op_arts: { chessId: 'op_arts', name: '法术干员', dmgType: 'arts', skills: [{ desc: '造成法术伤害并附加凋亡损伤' }], talents: [] },
  op_heal: { chessId: 'op_heal', name: '治疗干员', dmgType: 'heal', skills: [], talents: [] },
};
const DATA = { lookup: (kind, id) => (kind === 'chess' ? CHESS[id] || null : null), get: () => null };
const state = {
  battle: { battleId: 'b1', fieldId: 'f1', kind: 'normal', time: 1 },
  ops: [{ kind: 'op', ownerId: 'p_0', defId: 'op_phys', uid: 11 }, { kind: 'op', ownerId: 'p_0', defId: 'op_arts', uid: 12 }, { kind: 'op', ownerId: 'p_0', defId: 'op_heal', uid: 13 }],
  units: { 101: { defId: 'op_phys', hp: 1000, maxHp: 1000, alive: true, base: {} }, 102: { defId: 'op_arts', hp: 800, maxHp: 800, alive: true, base: {} }, 103: { defId: 'op_heal', hp: 600, maxHp: 600, alive: true, base: {} } },
  pieceToUnit: { 11: 101, 12: 102, 13: 103 },
};
globalThis.__SP__ = { net: { playerId: 'p_0' }, data: DATA, store: {} };
globalThis.__SP_RUNNER__ = {
  currentBattle: () => state.battle,
  ownerOps: (pid, fid) => (pid === 'p_0' ? state.ops : []),
  unitIdOf: (uid) => state.pieceToUnit[uid] ?? null,
  unitStats: (unitId) => state.units[unitId] || null,
};

// ---------------- 被测模块 ----------------
const mod = await import(new URL('../client/client.js', import.meta.url).href);
const { start } = mod;
globalThis.__SP_MP_DEBUG__ = (o) => { if (process.env.SP_MP_TEST_DEBUG) console.log('[render]', JSON.stringify(o)); };
start();
flushRaf();

// 按钮是否插到了全屏按钮前面
const btn = corner.children[0];
assert.equal(btn.className.includes('sp-mp-dmgbtn'), true, '按钮已插入 gm__corner');
assert.equal(corner.children[1], fsBtn, '按钮在全屏按钮之前');
assert.equal(btn.innerHTML.includes('<svg'), true, '按钮有图标');

// 打开面板：还没有战斗时提示
const getPanel = () => find(body, '.sp-mp-dmg')[0] || null;
btn.dispatch('click');
flushRaf();
let panel = getPanel();
assert.ok(panel, '面板已创建');

/** 面板内容（必要时先确保它是打开的）。setInterval 的回调就是刷新入口。 */
const openPanel = () => { if (!getPanel()) { btn.dispatch('click'); flushRaf(); } return getPanel(); };
const refresh = () => { for (const fn of timers) fn(); return openPanel().innerHTML; };

// ---- 1) 还没连上（页面刚起来：没有 playerId）→ 提示"还没有连上对局"
globalThis.__SP__ = { data: DATA, net: { playerId: null }, store: {} };
state.battle = null;
let html = refresh();
assert.ok(html.includes('还没有连上对局'), `没有 playerId 时提示正确（实际: ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100)}）`);
console.log('✓ 未连上对局时的提示');

// 关掉面板，回到干净状态
btn.dispatch('click');
flushRaf();
assert.equal(getPanel(), null, '再点一次关闭面板');

// ---- 2) 接上对局：net.playerId + 战斗 + 干员
state.battle = { battleId: 'b1', fieldId: 'f1', kind: 'normal', time: 1 };
globalThis.__SP__ = { net: { playerId: 'p_0' }, data: DATA, store: {} };
html = refresh();
assert.ok(html.includes('物理干员') && html.includes('法术干员') && html.includes('治疗干员'), '三名干员都列出了');
assert.ok(html.includes('物理') && html.includes('法术') && html.includes('治疗'), '类型标签出现');
console.log('✓ 初次渲染：三名干员 + 类型标签（还没伤害，故无类型构成）');

// 物理干员掉 400 HP，法术掉 100，治疗不掉；护盾吸收 50 不计入
state.units[101].hp = 600;
state.units[102].hp = 700;
state.units[101].shields = [50];
html = refresh();
assert.ok(/400/.test(html), `物理干员统计到 400 伤害（面板: ${html.match(/sp-mp-dmg__v">[^<]*/g)}）`);
assert.ok(/100/.test(html), '法术干员统计到 100 伤害');

// 再掉 100（护盾先被吸收 50）→ 物理干员累计 450
state.units[101].shields = [];
state.units[101].hp = 500;
html = refresh();
assert.ok(/450/.test(html), '护盾吸收的 50 不计入：累计 450');

// 类型构成：物理 450 / 法术 100 → 物理占多数
const mix = html.match(/类型构成<\/b>([\s\S]*?)<\/div>/);
assert.ok(mix && /物理 81\.8%/.test(mix[1]), `类型构成按伤害拆开（实际: ${mix && mix[1].replace(/<[^>]+>/g, ' ').trim()}）`);
console.log('✓ 伤害累计与护盾口径：400 + 50(护盾不计) → 450；类型构成 物理 81.8%');

// 换一场战斗 → 累计清空
state.battle = { battleId: 'b2', fieldId: 'f1', kind: 'normal', time: 0 };
html = refresh();
assert.ok(!/450/.test(html), '换战斗后累计清空');
console.log('✓ 换战斗清空累计');

// 没有 playerId 时提示"还没有连上对局"
globalThis.__SP__.net.playerId = null;
state.battle = null;
mod.reset();
btn.dispatch('click');
flushRaf();
html = refresh();
assert.ok(html.includes('还没有连上对局'), `没有 playerId 时提示正确（实际: ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120)}）`);
console.log('✓ 未连上对局时的提示');

console.log('\n全部通过 ✅');
