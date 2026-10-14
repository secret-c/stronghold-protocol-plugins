// sp-mp 客户端插件：伤害统计面板
//
// 目标：**完全不改安装里的任何文件**，只用宿主已经公开的东西——
//   * `window.__SP__`（public/js/main.js 自己挂的 { store, net, data }）：`net.playerId` 就是自己的 playerId
//   * `window.__SP_RUNNER__`（public/js/battle/runner.js 自己挂的调试入口）的只读查询：
//       currentBattle() → { battleId, fieldId, kind, spec, time }
//       ownerOps(ownerId, fieldId) → 自己场上的干员 [{ kind:'op', ownerId, defId, uid, items? }]
//       unitIdOf(uid, ownerId, fieldId) → 它在**当前这场战斗**里的单位 id
//       unitStats(unitId, fieldId) → 该单位的实时数值（协议 unitStatsEntry：hp / maxHp / atk / res / shields / …）
//   * 宿主自己的 DOM 钩子 `.gm__corner`（左下角那排按钮）与 `.gm__fs`（全屏按钮）
//
// 伤害数字：宿主的 unitStatsEntry 只给实时属性，不给战斗统计，所以这里按**每次刷新取 HP 增量**累加：
//   damage = Σ max(0, hpBefore − hpNow) − Σ max(0, 护盾Before − 护盾Now)
// 依据是宿主自己的定义（server/sim/damage.js 头部注释）："伤害只统计从对方身上移除的生命值"，护盾吸收不算伤害。
// 单位阵亡、或者本场战斗结束，就停止累加。
//
// 伤害类型：宿主 runner 不暴露"按类型的伤害量"，所以面板给出的类型是**干员的主攻击类型**
// （data/chess.json 的 `dmgType`：phys → 物理、arts → 法术、heal → 治疗），若技能/天赋文本里出现元素关键词
// （灼燃 / 凋亡 / 神经 / 侵蚀）则额外标注该元素。面板底部明确写清这一点，不假装是实测分类。

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

const L = {
  title: '伤害统计',
  total: '总伤害',
  kills: '击杀',
  taken: '承伤',
  heal: '治疗',
  damage: '伤害',
  type: '类型',
  share: '占比',
  op: '干员',
  ready: '准备阶段：战斗开始后开始统计',
  noBoard: '本场战斗没有你的干员',
  noConn: '还没有连上对局',
  byType: '类型构成',
  note: '伤害＝干员生命值减少量（护盾吸收不计入；只统计你自己场上的干员）。类型按干员的主攻击类型标注，非逐次实测。',
};

const TYPE_NAME = { phys: '物理', arts: '法术', heal: '治疗', true: '真实', elemental: '元素' };
const TYPE_CLASS = { phys: 'is-phys', arts: 'is-arts', heal: 'is-heal', true: 'is-true', elemental: 'is-elem' };
const ELEMENT_WORDS = ['灼燃', '凋亡', '神经', '侵蚀'];

export function start() {
  installStyle();
  watchBattle();
  installButtonLoop();
  setInterval(() => { if (open.value && panel && panel.isConnected) render(); }, POLL_MS);
}

/**
 * Forget everything derived from the host (the resolved playerId, the per-battle tallies and the panel). Meant for
 * tests and for a host that swaps its session in place; the panel itself keeps working without ever calling it.
 */
export function reset() {
  self.playerId = null;
  self.via = '';
  acc.clear();
  battleId = null;
  fieldKey = null;
  if (panel) { panel.remove(); panel = null; }
  open.value = false;
}

// -------------------------------------------------------------------------------------------------------------
// 1. 自己的 playerId / 当前战斗：只读宿主已经暴露的全局入口
// -------------------------------------------------------------------------------------------------------------

const self = { playerId: null, via: '' };

function host() {
  return globalThis.__SP__ && typeof globalThis.__SP__ === 'object' ? globalThis.__SP__ : null;
}

/** 宿主自己的 net 实例上有 playerId；拿不到就问 store（`me.playerId` / `match.private.playerId`）。 */
function resolveSelf(battle) {
  const h = host();
  const n = h && h.net;
  // 宿主断线/换会话时 net.playerId 会被清空：这时忘掉缓存的身份，别拿旧 id 继续显示
  if (n && n.playerId === null && self.playerId) { self.playerId = null; self.via = ''; }
  if (self.playerId) return self.playerId;
  if (n && typeof n.playerId === 'string' && n.playerId) { self.playerId = n.playerId; self.via = 'net'; return self.playerId; }
  const st = h && h.store && typeof h.store.get === 'function' ? h.store.get() : null;
  if (st) {
    const fromMe = st.me && typeof st.me.playerId === 'string' ? st.me.playerId : null;
    if (fromMe) { self.playerId = fromMe; self.via = 'store.me'; return self.playerId; }
    const fromMatch = st.match && st.match.private && typeof st.match.private.playerId === 'string' ? st.match.private.playerId : null;
    if (fromMatch) { self.playerId = fromMatch; self.via = 'store.match'; return self.playerId; }
  }
  // 兜底：谁的棋盘上有干员就是自己（只在前面都拿不到时才用，正常路径永远拿得到）
  const r = globalThis.__SP_RUNNER__;
  if (r && battle && typeof r.ownerOps === 'function') {
    try {
      const owners = (battle.spec && Array.isArray(battle.spec.players) ? battle.spec.players : [])
        .map((p) => (p && typeof p.playerId === 'string' ? p.playerId : null)).filter(Boolean);
      for (const pid of owners) {
        if ((r.ownerOps(pid, battle.fieldId) || []).length) { self.playerId = pid; self.via = 'ownerOps'; return pid; }
      }
    } catch { /* ignore */ }
  }
  return null;
}

/** 宿主换场/换局时清掉累计（runner 的 field 事件是最可靠的信号）。 */
let fieldKey = null;
function watchBattle() {
  const r = globalThis.__SP_RUNNER__;
  if (r && typeof r.on === 'function') {
    try {
      r.on('field', (f) => { const key = f && (f.fieldId || f.battleId) || null; if (key !== fieldKey) { fieldKey = key; acc.clear(); battleId = null; } });
    } catch { /* 宿主的 on 变了也不影响：readRows 里还有 battleId 兜底 */ }
  }
}

// -------------------------------------------------------------------------------------------------------------
// 2. 左下角按钮（插在宿主全屏按钮前面）+ 面板
// -------------------------------------------------------------------------------------------------------------

let panel = null;
let button = null;
const open = { value: false };
/** 单位 key → { dmg, lastHp, lastShield, kills, taken, frozen }；battleId 一变就整表清空。 */
const acc = new Map();
let battleId = null;

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:60%;height:60%;fill:currentColor">'
  + '<rect x="3" y="12" width="4" height="9"></rect><rect x="10" y="6" width="4" height="15"></rect>'
  + '<rect x="17" y="9" width="4" height="12"></rect></svg>';

function installButtonLoop() {
  const tick = () => {
    const corner = document.querySelector('.gm__corner');
    if (corner && (!button || !button.isConnected)) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'gm__gear sp-mp-dmgbtn';
      button.title = L.title;
      button.setAttribute('aria-label', L.title);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = ICON;
      button.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggle(); });
      corner.insertBefore(button, corner.querySelector('.gm__fs') || null);
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
  const battle = currentBattle();
  const pid = resolveSelf(battle);
  const rows = readRows();
  const dbg = globalThis.__SP_MP_DEBUG__;
  if (typeof dbg === 'function') dbg({ battle: !!battle, pid, rows: rows.length, via: self.via });
  const total = rows.reduce((s, r) => s + r.dmg, 0);
  const kills = rows.reduce((s, r) => s + r.kills, 0);
  const taken = rows.reduce((s, r) => s + r.taken, 0);
  const mix = typeMix(rows, total);
  const body = !pid ? `<p class="sp-mp-dmg__note">${L.noConn}</p>`
    : !battle ? `<p class="sp-mp-dmg__note">${L.ready}</p>`
      : !rows.length ? `<p class="sp-mp-dmg__note">${L.noBoard}</p>`
        : `<div class="sp-mp-dmg__cols"><span>${L.op}</span><span></span><span>${L.damage}</span><span>${L.share}</span><span>${L.type}</span></div>
           <ol class="sp-mp-dmg__list">${rows.map(rowHtml).join('')}</ol>
           ${mix.length ? `<div class="sp-mp-dmg__mix"><b>${L.byType}</b>${mix.map((m) => `<span class="sp-mp-dmg__tag ${TYPE_CLASS[m.type] || ''}">${m.name} ${pct(m.share)}</span>`).join('')}</div>` : ''}`;
  panel.innerHTML = `<header class="sp-mp-dmg__head"><h3 class="sp-mp-dmg__title">${L.title}</h3>
      <span class="sp-mp-dmg__phase">${battle ? String(battle.kind || '') : ''}</span>
      <button type="button" class="sp-mp-dmg__close" aria-label="关闭" title="关闭">✕</button></header>
    <div class="sp-mp-dmg__sum">
      <span><i>${L.total}</i><b>${fmt(total)}</b></span>
      <span><i>${L.kills}</i><b>${fmt(kills)}</b></span>
      <span><i>${L.taken}</i><b>${fmt(taken)}</b></span>
      <span><i>${L.heal}</i><b>—</b></span>
    </div>${body}
    <p class="sp-mp-dmg__note sp-mp-dmg__foot">${L.note}</p>`;
  const close = panel.querySelector('.sp-mp-dmg__close');
  if (close) close.addEventListener('click', () => toggle());
}

function rowHtml(r) {
  const cls = `sp-mp-dmg__row${r.alive ? '' : ' is-down'}${r.dmg > 0 ? '' : ' is-idle'}`;
  const icon = opIcon(r.defId);
  const thumb = icon ? `<img class="sp-mp-dmg__thumb" src="${icon}" alt="" loading="lazy">` : `<span class="sp-mp-dmg__thumb"></span>`;
  const tag = r.typeName ? `<span class="sp-mp-dmg__tag ${TYPE_CLASS[r.type] || ''}" title="${r.typeTitle || ''}">${r.typeName}${r.element ? '·' + r.element : ''}</span>` : '<span></span>';
  return `<li class="${cls}" title="${r.defId} · 承伤 ${fmt(r.taken)}">
    ${thumb}<span class="sp-mp-dmg__name">${opName(r.defId)}</span>
    <span class="sp-mp-dmg__v">${fmt(r.dmg)}</span>
    <span class="sp-mp-dmg__share"><i style="width:${(r.share * 100).toFixed(1)}%"></i><b>${pct(r.share)}</b></span>
    ${tag}</li>`;
}

/** 类型构成：按主攻击类型把总伤害拆开（类型来自干员记录，不是逐次实测）。 */
function typeMix(rows, total) {
  if (!(total > 0)) return [];
  const by = new Map();
  for (const r of rows) {
    if (!(r.dmg > 0)) continue;
    const key = r.type || 'other';
    by.set(key, (by.get(key) || 0) + r.dmg);
  }
  return [...by.entries()]
    .map(([type, v]) => ({ type, name: TYPE_NAME[type] || type, share: v / total }))
    .sort((a, b) => b.share - a.share);
}

// -------------------------------------------------------------------------------------------------------------
// 3. 干员记录：名字 / 头像 / 伤害类型（全部只读 data.js）
// -------------------------------------------------------------------------------------------------------------

function hostData() {
  const h = host();
  return (h && h.data) || globalThis.__SP_DATA__ || null;
}
function lookup(kind, id) {
  const store = hostData();
  return store && typeof store.lookup === 'function' ? store.lookup(kind, id) : null;
}
function opName(defId) {
  const rec = lookup('chess', defId);
  return (rec && rec.name) || defId || '?';
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

/** { type, typeName, element, typeTitle } of an operator record: its main attack type + any elemental keyword. */
function typeOf(defId) {
  const rec = lookup('chess', defId);
  if (!rec) return { type: null, typeName: null, element: null, typeTitle: '' };
  const type = TYPE_NAME[rec.dmgType] ? rec.dmgType : null;
  const texts = [rec.trait || '', ...(Array.isArray(rec.skills) ? rec.skills.map((s) => (s && s.desc) || '') : []),
    ...(Array.isArray(rec.talents) ? rec.talents.map((t) => (t && (t.desc || t.name)) || '') : [])].join(' ');
  const element = ELEMENT_WORDS.find((w) => texts.includes(w)) || null;
  const bits = [];
  if (type) bits.push(`主攻击类型：${TYPE_NAME[type]}（记录 dmgType=${rec.dmgType}）`);
  if (element) bits.push(`技能/天赋涉及${element}元素伤害`);
  return { type, typeName: type ? TYPE_NAME[type] : null, element, typeTitle: bits.join('；') };
}

// -------------------------------------------------------------------------------------------------------------
// 4. 伤害累计（HP 增量）
// -------------------------------------------------------------------------------------------------------------

function currentBattle() {
  const r = globalThis.__SP_RUNNER__;
  if (!r || typeof r.currentBattle !== 'function') return null;
  try { return r.currentBattle(); } catch { return null; }
}

function readRows() {
  const r = globalThis.__SP_RUNNER__;
  const battle = currentBattle();
  if (!r || !battle) return [];
  const pid = resolveSelf(battle);
  if (!pid) return [];
  if (typeof r.ownerOps !== 'function' || typeof r.unitStats !== 'function') return [];
  if (battleId !== battle.battleId) { battleId = battle.battleId; acc.clear(); }
  let ops = [];
  try { ops = r.ownerOps(pid, battle.fieldId) || []; } catch { return []; }
  const rows = [];
  for (const op of ops) {
    if (!op || typeof op.defId !== 'string') continue;
    const pieceUid = Number.isInteger(op.uid) ? op.uid : null;
    let unitId = null;
    try { unitId = pieceUid != null && typeof r.unitIdOf === 'function' ? r.unitIdOf(pieceUid, pid, battle.fieldId) : null; } catch { unitId = null; }
    let e = null;
    if (unitId != null) { try { e = r.unitStats(unitId, battle.fieldId); } catch { e = null; } }
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
      if (e.alive === false) st.frozen = true;
      if (Number.isFinite(e.kills)) st.kills = e.kills;
      if (Number.isFinite(e.taken)) st.taken = e.taken;
    }
    const t = typeOf(op.defId);
    rows.push({ key, defId: op.defId, alive: e ? e.alive !== false : false, dmg: st.dmg, kills: st.kills, taken: st.taken, ...t });
  }
  const total = rows.reduce((s, x) => s + x.dmg, 0);
  for (const x of rows) x.share = total > 0 ? Math.min(1, x.dmg / total) : 0;
  rows.sort((a, b) => b.dmg - a.dmg || String(a.defId).localeCompare(String(b.defId)));
  return rows;
}

// -------------------------------------------------------------------------------------------------------------
// 5. 样式：插件自己的 CSS（index.html 里 <link> 引入；缺失时兜底挂一份）
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
