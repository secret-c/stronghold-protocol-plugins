// sp-mp 客户端插件：伤害统计面板
//
// 目标：**完全不改安装里的任何文件**，只用宿主已经公开的东西——
//   * `window.__SP_RUNNER__`（public/js/battle/runner.js 自己挂的调试入口）的只读查询：
//       currentBattle() → { battleId, fieldId, kind, spec, time }
//       ownerOps(ownerId, fieldId) → 自己场上的干员 [{ kind:'op', ownerId, defId, uid? }]
//       unitIdOf(uid, ownerId, fieldId) → 它在**当前这场战斗**里的单位 id
//       unitStats(unitId, fieldId) → 该单位的实时数值（协议 unitStatsEntry：hp / maxHp / atk / shields / …）
//   * 服务器推给客户端的 `m.private` / `m.public`（本模块只**读** WebSocket 入站消息，不改协议、不回包）
//   * 宿主自己的 DOM 钩子 `.gm__corner`（左下角那排按钮）与 `.gm__fs`（全屏按钮）
//
// 伤害数字：宿主的 unitStatsEntry 不带战斗统计，所以这里按**每次刷新取 HP 增量**累加：
//   damage = Σ max(0, hpBefore − hpNow) − Σ max(0, 护盾Before − 护盾Now)
// 依据是宿主自己的定义（server/sim/damage.js 头部注释）："伤害只统计从对方身上移除的生命值"，
// 护盾吸收不算伤害。单位被打死、或者本场战斗结束，就停止累加（不会再读到它的数值）。
//
// 只统计**你自己场上的干员**：每个浏览器只模拟自己的战场（ARCHITECTURE §1），队友的战场在他们自己的浏览器里跑。

const POLL_MS = 250;
const STYLE_ID = 'sp-mp-client-style';

/** HP/护盾读数（读不到按 0，不影响其它字段）。 */
const hpOf = (e) => (e && Number.isFinite(e.hp) ? Math.max(0, e.hp) : 0);
const shieldOf = (e) => {
  if (!e) return 0;
  let s = Number.isFinite(e.shield) ? e.shield : 0;
  if (Array.isArray(e.shields)) for (const x of e.shields) if (Number.isFinite(x)) s += x;
  return Math.max(0, s);
};

/** 12345678 → '1234.6万'（HUD 里大数的紧凑写法）。 */
function fmt(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v >= 100000000) return `${(v / 100000000).toFixed(2)}亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return String(v);
}

const pct = (v) => `${(Math.max(0, Number(v) || 0) * 100).toFixed(1)}%`;

/** 干员名 / 头像：优先用宿主 data.js；取不到就退回 id、不画头像（宿主结构变了也不影响面板）。 */
function opName(defId) {
  try {
    const rec = hostLookup('chess', defId);
    if (rec && rec.name) return rec.name;
  } catch { /* ignore */ }
  return defId || '?';
}
function opIcon(defId) {
  try {
    const store = hostData();
    const assets = store && typeof store.get === 'function' ? store.get('assets') : null;
    if (!assets) return null;
    if (typeof store.avatarUrl === 'function') return store.avatarUrl(assets, defId) || null;
    if (assets.avatars && typeof assets.avatars === 'object') return assets.avatars[defId] || null;
  } catch { /* ignore */ }
  return null;
}
function hostData() {
  return globalThis.__SP_DATA__ || (globalThis.__SP__ && globalThis.__SP__.data) || null;
}
function hostLookup(kind, id) {
  const store = hostData();
  return store && typeof store.lookup === 'function' ? store.lookup(kind, id) : null;
}

const L = {
  title: '伤害统计',
  total: '总伤害',
  kills: '击杀',
  taken: '承伤',
  heal: '治疗',
  damage: '伤害',
  share: '占比',
  op: '干员',
  ready: '准备阶段：战斗开始后开始统计',
  noBoard: '本场战斗没有你的干员',
  noConn: '还没有连上对局',
  note: '（伤害按干员生命值的减少量累计，护盾吸收不计入；治疗/击杀只在宿主提供时显示）',
};

export function start() {
  installStyle();
  watchMessages();
  installButtonLoop();
  setInterval(() => { if (open.value && panel && panel.isConnected) render(); }, POLL_MS);
}

// -------------------------------------------------------------------------------------------------------------
// 1. 只读地嗅探服务器推给本客户端的消息
// -------------------------------------------------------------------------------------------------------------

const self = { playerId: null, phase: null, round: null };

function watchMessages() {
  const proto = globalThis.WebSocket && globalThis.WebSocket.prototype;
  if (!proto || proto.__spMpPatched) return;
  const origAdd = proto.addEventListener;
  const origRemove = proto.removeEventListener;
  proto.addEventListener = function patchedAdd(type, fn, opts) {
    if (type !== 'message' || typeof fn !== 'function') return origAdd.call(this, type, fn, opts);
    const wrapped = function (ev) {
      try { sniff(ev && ev.data); } catch { /* 嗅探失败绝不影响宿主 */ }
      return fn.call(this, ev);
    };
    this.__spMpMap = this.__spMpMap || new Map();
    this.__spMpMap.set(fn, wrapped);
    return origAdd.call(this, type, wrapped, opts);
  };
  proto.removeEventListener = function patchedRemove(type, fn, opts) {
    const mapped = this.__spMpMap && this.__spMpMap.get(fn);
    if (mapped) this.__spMpMap.delete(fn);
    return origRemove.call(this, type, mapped || fn, opts);
  };
  proto.__spMpPatched = true;
}

function sniff(data) {
  if (typeof data !== 'string' || data.length < 2 || data[0] !== '{') return;
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;
  if ((msg.t === 'welcome' || msg.t === 'm.private') && typeof msg.playerId === 'string') self.playerId = msg.playerId;
  if (msg.t === 'm.public' || msg.t === 'm.private') {
    if (typeof msg.phase === 'string') self.phase = msg.phase;
    if (Number.isInteger(msg.round)) self.round = msg.round;
  }
}

// -------------------------------------------------------------------------------------------------------------
// 2. 左下角按钮（插在宿主全屏按钮前面）+ 面板
// -------------------------------------------------------------------------------------------------------------

let panel = null;
let button = null;
const open = { value: false };
/** unitId → { dmg, lastHp, lastShield, frozen } 只属于当前这一场战斗；battleId 一变就清空。 */
const acc = new Map();
let battleId = null;

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:60%;height:60%;fill:currentColor">'
  + '<rect x="3" y="12" width="4" height="9"></rect><rect x="10" y="6" width="4" height="15"></rect>'
  + '<rect x="17" y="9" width="4" height="12"></rect></svg>';

function installButtonLoop() {
  const tick = () => {
    const host = document.querySelector('.gm__corner');
    if (host && (!button || !button.isConnected)) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'gm__gear sp-mp-dmgbtn';
      button.title = L.title;
      button.setAttribute('aria-label', L.title);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = ICON;
      button.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggle(); });
      const fs = host.querySelector('.gm__fs');
      host.insertBefore(button, fs || null);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function toggle() {
  open.value = !open.value;
  if (button) button.setAttribute('aria-pressed', open.value ? 'true' : 'false');
  if (open.value) { build(); render(); } else if (panel) { panel.remove(); panel = null; }
}

function build() {
  if (panel) return;
  panel = document.createElement('section');
  panel.className = 'sp-mp-dmg';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', L.title);
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  document.body.appendChild(panel);
}

function render() {
  if (!panel) return;
  const rows = readRows();
  const total = rows.reduce((s, r) => s + r.dmg, 0);
  const kills = rows.reduce((s, r) => s + r.kills, 0);
  const taken = rows.reduce((s, r) => s + r.taken, 0);
  const battle = currentBattle();
  const body = !self.playerId ? `<p class="sp-mp-dmg__note">${L.noConn}</p>`
    : !battle ? `<p class="sp-mp-dmg__note">${L.ready}</p>`
      : !rows.length ? `<p class="sp-mp-dmg__note">${L.noBoard}</p>`
        : `<div class="sp-mp-dmg__cols"><span>${L.op}</span><span></span><span>${L.damage}</span><span>${L.share}</span><span>${L.kills}</span></div>
           <ol class="sp-mp-dmg__list">${rows.map(rowHtml).join('')}</ol>`;
  panel.innerHTML = `<header class="sp-mp-dmg__head"><h3 class="sp-mp-dmg__title">${L.title}</h3>
      <span style="font-size:11px;color:var(--text-lo,#8ba39a)">${battle ? String(battle.kind || '') : ''}</span>
      <button type="button" class="sp-mp-dmg__close" aria-label="关闭" title="关闭">✕</button></header>
    <div class="sp-mp-dmg__sum">
      <span><i>${L.total}</i><b>${fmt(total)}</b></span>
      <span><i>${L.kills}</i><b>${fmt(kills)}</b></span>
      <span><i>${L.taken}</i><b>${fmt(taken)}</b></span>
      <span><i>${L.heal}</i><b>—</b></span>
    </div>${body}
    <p class="sp-mp-dmg__note" style="padding:4px 9px 8px;font-size:11px;opacity:.7">${L.note}</p>`;
  const close = panel.querySelector('.sp-mp-dmg__close');
  if (close) close.addEventListener('click', () => toggle());
}

function rowHtml(r) {
  const cls = `sp-mp-dmg__row${r.alive ? '' : ' is-down'}${r.dmg > 0 ? '' : ' is-idle'}`;
  const icon = opIcon(r.defId);
  const thumb = icon ? `<img class="sp-mp-dmg__thumb" src="${icon}" alt="" loading="lazy">` : `<span class="sp-mp-dmg__thumb"></span>`;
  return `<li class="${cls}" title="${r.defId} · 承伤 ${fmt(r.taken)}">
    ${thumb}<span class="sp-mp-dmg__name">${opName(r.defId)}</span>
    <span class="sp-mp-dmg__v">${fmt(r.dmg)}</span>
    <span class="sp-mp-dmg__share"><i style="width:${(r.share * 100).toFixed(1)}%"></i><b>${pct(r.share)}</b></span>
    <span class="sp-mp-dmg__k">${r.kills}</span></li>`;
}

// -------------------------------------------------------------------------------------------------------------
// 3. 通过宿主的公开查询取数（全部只读）
// -------------------------------------------------------------------------------------------------------------

function currentBattle() {
  const r = globalThis.__SP_RUNNER__;
  if (!r || typeof r.currentBattle !== 'function') return null;
  try { return r.currentBattle(); } catch { return null; }
}

function readRows() {
  const r = globalThis.__SP_RUNNER__;
  const battle = currentBattle();
  if (!r || !battle || !self.playerId) return [];
  if (typeof r.ownerOps !== 'function' || typeof r.unitStats !== 'function') return [];
  // 换了一场战斗（或重开）：清空本场累计
  if (battleId !== battle.battleId) { battleId = battle.battleId; acc.clear(); }
  let ops = [];
  try { ops = r.ownerOps(self.playerId, battle.fieldId) || []; } catch { return []; }
  const rows = [];
  for (const op of ops) {
    if (!op || typeof op.defId !== 'string') continue;
    const pieceUid = Number.isInteger(op.uid) ? op.uid : null;
    let unitId = null;
    try { unitId = pieceUid != null && typeof r.unitIdOf === 'function' ? r.unitIdOf(pieceUid, self.playerId, battle.fieldId) : null; } catch { unitId = null; }
    let e = null;
    if (unitId != null) { try { e = r.unitStats(unitId, battle.fieldId); } catch { e = null; } }
    // 没部署：算 0 伤害，但仍列出来（玩家能看出谁还没上场）
    const key = unitId != null ? `u${unitId}` : `p${pieceUid}`;
    let st = acc.get(key);
    if (!st) { st = { dmg: 0, lastHp: null, lastShield: null, kills: 0, taken: 0, frozen: false }; acc.set(key, st); }
    if (e) {
      const hp = hpOf(e);
      const sh = shieldOf(e);
      if (!st.frozen && st.lastHp != null && e.alive !== false) {
        const lostHp = Math.max(0, st.lastHp - hp);
        const lostSh = Math.max(0, st.lastShield - sh);
        st.dmg += Math.max(0, lostHp - lostSh);
      }
      st.lastHp = hp;
      st.lastShield = sh;
      if (e.alive === false) st.frozen = true;                    // 阵亡：停止累加（宿主不再更新它的数值）
      if (Number.isFinite(e.kills)) st.kills = e.kills;
      if (Number.isFinite(e.taken)) st.taken = e.taken;
    }
    rows.push({ key, defId: op.defId, alive: e ? e.alive !== false : false, dmg: st.dmg, kills: st.kills, taken: st.taken, heal: null });
  }
  const total = rows.reduce((s, x) => s + x.dmg, 0);
  for (const x of rows) x.share = total > 0 ? Math.min(1, x.dmg / total) : 0;
  rows.sort((a, b) => b.dmg - a.dmg || String(a.defId).localeCompare(String(b.defId)));
  return rows;
}

// -------------------------------------------------------------------------------------------------------------
// 4. 样式：插件自己的 CSS 文件（index.html 里 <link> 引入；缺失时这里兜底挂一份）
// -------------------------------------------------------------------------------------------------------------

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.querySelector('link[href*="sp-mp/client/client.css"]');
  if (link) { link.id = STYLE_ID; return; }
  const el = document.createElement('link');
  el.id = STYLE_ID;
  el.rel = 'stylesheet';
  el.href = '/sp-mp/client/client.css';
  document.head.appendChild(el);
}
