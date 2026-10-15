// sp-mp damage panel. combatStats is a read-only overlay runner API backed by actual HP damage in the simulation.
import { diyRecordOf } from '../../shared/diy.js';
const POLL_MS = 250;
const STYLE_ID = 'sp-mp-client-style';
const TYPES = ['phys', 'arts', 'elemental', 'true'];
const TYPE_NAME = { phys: '物理', arts: '法术', elemental: '元素', true: '真实' };
let panel = null;
const renderedMarkup = new WeakMap();
let button = null;
let opened = false;
let started = false;
let historyApi = null;
let latestLog = null;
let historyButton = null;
let archiveMode = false;
let selectedRound = null;
let selectedPlayer = null;
let saveError = null;
let chatButton = null;
let chatPanel = null;
let chatOpened = false;
let chatCode = null;
let chatMessages = [];
let chatUnread = 0;
let chatAtBottom = true;
let chatError = '';
let chatSending = false;
let chatComposing = false;
let chatCapability = null;
let chatCapabilityAt = 0;
let chatCapabilityPending = null;
let chatNet = null;
let chatStore = null;
let chatButtonSignature = '';
let poolButton = null;
let poolPanel = null;
let poolOpened = false;
let poolData = null;
let poolDataLoading = false;
let poolStateSignature = null;
let poolTier = '';
let poolBond = '';
let poolSearch = '';
let poolBan = '';
let poolPrefer = '';
let poolSending = false;
let poolSubmitted = false;
let poolError = '';
let poolLastPhase = null;
let poolRoomCode = null;
let poolSetupRevision = null;
let t = (text, params = {}) => text.replace(/\{(\w+)\}/g, (whole, key) => String(params[key] ?? whole));
async function setupHistory() {
  try {
    const i18n = await import('/shared/i18n.js');
    t = i18n.t;
    i18n.onLangChange(refreshChatLang);
    historyApi = await import('/shared/combatLog.js');
    let storage = null; try { storage = globalThis.localStorage; } catch { /* unavailable */ }
    const saved = historyApi.readCombatLog(storage);
    latestLog = saved.log;
    saveError = saved.error;
  } catch (e) { console.warn('[sp-mp] statistics archive unavailable', e); }
}
function syncHistory() {
  const match = host().store?.get?.()?.match;
  if (historyApi && historyApi.validCombatLog(match?.combatLog)) {
    if (latestLog?.id !== match.combatLog.id) { selectedRound = null; selectedPlayer = null; }
    latestLog = match.combatLog;
    saveError = match.combatSaveError || null;
  }
}
function installHistoryButton(corner) {
  if ((!latestLog && !saveError) || corner) { if (historyButton) historyButton.hidden = true; return; }
  if (!historyButton?.isConnected) {
    historyButton = document.createElement('button');
    historyButton.type = 'button';
    historyButton.className = 'sp-mp-historybtn';
    historyButton.textContent = t('最近一局伤害');
    historyButton.addEventListener('click', () => { closeChat(); closePool(); archiveMode = true; if (!opened) toggle(); else render(); });
    const footer = document.querySelector('.result__foot');
    if (footer) { historyButton.className += ' is-result'; footer.appendChild(historyButton); }
    else document.body.appendChild(historyButton);
  }
  const footer = document.querySelector('.result__foot');
  if (footer && historyButton.parentNode !== footer) { footer.appendChild(historyButton); historyButton.className = 'sp-mp-historybtn is-result'; }
  historyButton.textContent = t('最近一局伤害');
  historyButton.hidden = false;
}

const fmt = (n) => {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : String(v);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = () => globalThis.__SP__ || {};
const emptyTypes = () => ({ phys: 0, arts: 0, elemental: 0, true: 0 });
const detail = (n) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const tooltip = (by) => TYPES.map((t) => `${TYPE_NAME[t]}：${detail(by[t])}`).join(' · ');

function currentBattle() {
  try { return globalThis.__SP_RUNNER__?.currentBattle?.() || null; } catch { return null; }
}
function playerId() {
  const h = host();
  // A known disconnected net identity must not fall through to stale match data or another player's board.
  if (h.net && 'playerId' in h.net) return h.net.playerId || null;
  const st = h.store?.get?.();
  return st?.me?.playerId || st?.match?.private?.playerId || null;
}
function readRows(battle, pid) {
  if (!battle || !pid) return [];
  let rows;
  try { rows = globalThis.__SP_RUNNER__?.combatStats?.(pid, battle.fieldId) || []; } catch { return []; }
  return rows.map((r) => {
    const byType = emptyTypes();
    for (const t of TYPES) byType[t] = Number.isFinite(r.byType?.[t]) ? Math.max(0, r.byType[t]) : 0;
    return { ...r, byType, dmg: TYPES.reduce((s, t) => s + byType[t], 0) };
  }).sort((a, b) => b.dmg - a.dmg || a.unitId - b.unitId);
}
function opName(row) { if (row.player) return `${row.name} · ${row.player}`; return row.name || host().data?.lookup?.('chess', row.defId)?.name || row.defId || '?'; }
function opIcon(defId) {
  const data = host().data;
  try {
    const assets = data?.get?.('assets');
    return data?.avatarUrl?.(assets, defId) || assets?.avatars?.[defId] || null;
  } catch { return null; }
}

export function start() {
  if (started) return;
  started = true;
  installStyle();
  if (typeof window !== 'undefined') {
    if (typeof location !== 'undefined') setupHistory();
    window.addEventListener('keydown', chatKeydown, true);
  }
  const tick = () => {
    const corner = document.querySelector('.gm__corner');
    bindChat();
    syncChatRoom();
    bindPoolData();
    syncPoolState();
    installPoolButton();
    installChatButton(corner);
    installHistoryButton(corner);
    if (corner && (!button || !button.isConnected)) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'gm__gear sp-mp-dmgbtn';
      button.title = '伤害统计';
      button.setAttribute('aria-label', '伤害统计');
      button.setAttribute('aria-pressed', String(opened));
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4v9H3zm7-6h4v15h-4zm7-5h4v20h-4z"/></svg>';
      button.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); closeChat(); closePool(); archiveMode = false; toggle(); });
      corner.insertBefore(button, corner.querySelector('.gm__fs') || null);
    }
    requestAnimationFrame(tick);
  };
  tick();
  setInterval(() => { syncHistory(); if (opened && panel?.isConnected) render(); }, POLL_MS);
}
export function reset() {
  panel?.remove();
  panel = null;
  opened = false;
  button?.setAttribute('aria-pressed', 'false');
  closeChat();
  closePool();
}
function toggle() {
  if (!opened) { closeChat(); closePool(); }
  opened = !opened;
  button?.setAttribute('aria-pressed', String(opened));
  if (!opened) { panel?.remove(); panel = null; return; }
  panel = document.createElement('section');
  panel.className = 'sp-mp-dmg';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '伤害统计');
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  document.body.appendChild(panel);
  render();
}
function rowHtml(row, max) {
  const icon = opIcon(row.defId);
  const tip = `总伤害：${detail(row.dmg)} · ${tooltip(row.byType)}`;
  const width = max > 0 ? row.dmg / max * 100 : 0;
  return `<li class="sp-mp-dmg__row${row.alive ? '' : ' is-down'}" data-unit-id="${esc(row.unitId)}" title="${esc(tip)}" tabindex="0" aria-label="${esc(opName(row) + ' · ' + tip)}">
    ${icon ? `<img class="sp-mp-dmg__thumb" src="${esc(icon)}" alt="" loading="lazy">` : '<span class="sp-mp-dmg__thumb"></span>'}
    <div class="sp-mp-dmg__detail"><div class="sp-mp-dmg__label"><span class="sp-mp-dmg__name">${esc(opName(row))}</span><b class="sp-mp-dmg__v">${fmt(row.dmg)}</b></div>
    <div class="sp-mp-dmg__track"><div class="sp-mp-dmg__bar" style="width:${width.toFixed(3)}%">${TYPES.map((t) => `<i class="sp-mp-dmg__segment is-${t}" style="width:${(row.dmg > 0 ? row.byType[t] / row.dmg * 100 : 0).toFixed(3)}%"></i>`).join('')}</div></div></div>
    <span class="sp-mp-dmg__tooltip">${esc(tip)}</span></li>`;
}
function render() {
  if (!panel) return;
  const battle = currentBattle();
  const pid = playerId();
  const available = typeof globalThis.__SP_RUNNER__?.combatStats === 'function';
  syncHistory();
  const archived = archiveMode && latestLog && historyApi;
  const rows = archived ? historyApi.combatLogRows(latestLog, selectedRound, selectedPlayer) : readRows(battle, pid);
  const totals = emptyTypes();
  for (const row of rows) for (const t of TYPES) totals[t] += row.byType[t];
  const total = TYPES.reduce((s, t) => s + totals[t], 0);
  const sum = (k) => rows.reduce((s, r) => s + (Number.isFinite(r[k]) ? r[k] : 0), 0);
  const msg = archiveMode && !latestLog && saveError ? t('本机统计记录损坏或不可读取；开始新局后会重新保存。')
    : archived ? (!rows.length ? t('所选范围没有已完成的干员统计') : '') : !pid ? '还没有连上对局' : !battle ? '准备阶段：战斗开始后开始统计'
    : !available ? '统计接口未加载，请使用更新后的 sp-mp 启动器并刷新页面' : !rows.length ? '本场战斗没有你的干员' : '';
  const content = msg ? `<p class="sp-mp-dmg__note">${esc(msg)}</p>`
    : `<ol class="sp-mp-dmg__list">${rows.map((r) => rowHtml(r, rows[0]?.dmg || 0)).join('')}</ol>`;
  // Do not replace identical DOM every poll: a stationary hover/focus keeps its tooltip and focus.
  const html = `<header class="sp-mp-dmg__head"><h3 class="sp-mp-dmg__title">${archived ? esc(t('最近一局伤害')) : '伤害统计'}</h3><span class="sp-mp-dmg__phase">${archived ? esc(latestLog.ended ? t('整局结束') : t('已完成战场')) : esc(battle?.kind || '')}</span><button type="button" class="sp-mp-dmg__close" aria-label="关闭">✕</button></header>
    ${latestLog ? `<div class="sp-mp-dmg__tabs"><button type="button" class="sp-mp-live">${esc(t('当前本人'))}</button><button type="button" class="sp-mp-archive">${esc(t('同盟累计'))}</button></div>` : ''}
    ${archived ? archiveControls() : ''}
    <div class="sp-mp-dmg__sum"><span title="${esc(tooltip(totals))}"><i>总伤害</i><b>${fmt(total)}</b></span><span><i>击杀</i><b>${fmt(sum('kills'))}</b></span><span><i>承伤</i><b>${fmt(sum('taken'))}</b></span><span><i>治疗</i><b>${fmt(sum('heal'))}</b></span></div>
    <div class="sp-mp-dmg__legend">${TYPES.map((t) => `<span><i class="is-${t}"></i>${TYPE_NAME[t]}</span>`).join('')}</div>${content}
    <p class="sp-mp-dmg__note sp-mp-dmg__foot">${archived ? archiveNote() : '统计本场自己干员对敌方实际扣除的生命值，含所属召唤物；护盾、溢出和元素损伤积累不计。条长按最高伤害归一，悬停查看分类。击杀、承伤、治疗为干员本体。'}</p>`;
  if (html === renderedMarkup.get(panel)) return;
  const focusedId = document.activeElement?.closest?.('.sp-mp-dmg__row')?.getAttribute('data-unit-id');
  panel.innerHTML = html;
  renderedMarkup.set(panel, html);
  if (focusedId && /^\d+$/.test(focusedId)) panel.querySelector(`[data-unit-id="${focusedId}"]`)?.focus();
  panel.querySelector('.sp-mp-dmg__close')?.addEventListener('click', toggle);
  panel.querySelector('.sp-mp-live')?.addEventListener('click', () => { archiveMode = false; render(); });
  panel.querySelector('.sp-mp-archive')?.addEventListener('click', () => { archiveMode = true; render(); });
  panel.querySelector('.sp-mp-round')?.addEventListener('change', (ev) => { selectedRound = ev.target.value === '' ? null : Number(ev.target.value); render(); });
  panel.querySelector('.sp-mp-player')?.addEventListener('change', (ev) => { selectedPlayer = ev.target.value === '' ? null : Number(ev.target.value); render(); });
}
function archiveControls() {
  const rounds = [...new Set(latestLog.f.map((f) => f[0]))].sort((a, b) => a - b);
  const option = (value, text, selected) => '<option value="' + value + '"' + (selected ? ' selected' : '') + '>' + esc(text) + '</option>';
  return '<div class="sp-mp-dmg__filters"><label>' + esc(t('波次')) + '<select class="sp-mp-round">' + option('', t('整局累计'), selectedRound == null)
    + rounds.map((n) => option(n, t('第 {n} 波', { n }), n === selectedRound)).join('') + '</select></label>'
    + '<label>' + esc(t('成员')) + '<select class="sp-mp-player">' + option('', t('全体同盟'), selectedPlayer == null)
    + latestLog.p.map((p, i) => option(i, p[1], i === selectedPlayer)).join('') + '</select></label></div>';
}
function archiveNote() {
  const fields = latestLog.f.filter((f) => selectedRound == null || f[0] === selectedRound);
  const incomplete = fields.some((f) => selectedPlayer == null ? f[3] !== 0 : (f[3] & (1 << selectedPlayer)) !== 0);
  const state = saveError ? t('未能保存本机：存储空间不足或被禁用，刷新可能丢失。') : t('已保存本机，刷新或重开仍可查看；新局开始替换。');
  return esc((incomplete ? t('部分战场统计缺失，当前合计不完整。') : '') + state
    + ' ' + t('仅含已完成战场，包含联防、领袖及所属召唤物；伤害按类型取整保存，击杀/承伤/治疗为干员本体。'));
}
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

// Room chat belongs to the room, not to a match phase. The server owns identity, order and history.
function bindChat() {
  const { net, store } = host();
  if (net && net !== chatNet && typeof net.on === 'function') {
    chatNet = net;
    net.on('room.chat', acceptChatMessage);
    net.on('room.chatHistory', acceptChatHistory);
  }
  if (store && store !== chatStore && typeof store.subscribe === 'function') {
    chatStore = store;
    store.subscribe(syncChatRoom);
  }
  syncChatRoom();
  if (net?.chatBootstrap?.code === chatCode && net.chatBootstrap.messages.length
    && net.chatBootstrap.messages.at(-1).seq > (chatMessages.at(-1)?.seq || 0)) {
    acceptChatHistory({ code: chatCode, messages: net.chatBootstrap.messages });
  }
}

function refreshChatLang() {
  updateChatBadge();
  refreshPoolLang();
  if (!chatPanel) return;
  chatPanel.setAttribute('aria-label', t('同盟聊天'));
  chatPanel.querySelector('.sp-mp-chat__head h3').textContent = t('同盟聊天');
  chatPanel.querySelector('.sp-mp-chat__close').setAttribute('aria-label', t('关闭聊天'));
  const input = chatPanel.querySelector('.sp-mp-chat__input');
  input.setAttribute('aria-label', t('输入消息'));
  input.placeholder = t('输入消息');
  chatPanel.querySelector('.sp-mp-chat__send').textContent = t('发送');
  chatPanel.querySelector('.sp-mp-chat__empty')?.replaceChildren(t('暂无消息'));
  updateChatJump();
  updateChatComposer();
}

function roomCode() { return host().store?.get?.()?.room?.code || null; }
function isChatSpectator() {
  const state = host().store?.get?.();
  const id = playerId();
  return !!id && Array.isArray(state?.room?.spectators)
    && state.room.spectators.some((seat) => seat?.playerId === id);
}
function syncChatRoom() {
  const code = roomCode();
  if (code === chatCode) {
    if (chatOpened) updateChatComposer();
    return;
  }
  chatCode = code;
  chatMessages = [];
  chatUnread = 0;
  chatError = '';
  chatSending = false;
  chatAtBottom = true;
  closeChat();
  if (chatButton) chatButton.hidden = !code;
  updateChatBadge();
}

function installChatButton(corner) {
  if (!chatCode) { if (chatButton) chatButton.hidden = true; return; }
  if (!chatButton?.isConnected) {
    chatButton = document.createElement('button');
    chatButtonSignature = '';
    chatButton.type = 'button';
    chatButton.className = 'sp-mp-chatbtn';
    chatButton.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggleChat(); });
  }
  const roomTools = document.querySelector('.room-screen .topbar__left');
  const resultFoot = document.querySelector('.result__foot');
  const briefFoot = document.querySelector('.brief__foot');
  const draftOrder = document.querySelector('.draft-order');
  if (corner) {
    if (chatButton.parentNode !== corner) corner.insertBefore(chatButton, button?.parentNode === corner ? button : corner.querySelector('.gm__fs'));
    chatButton.className = 'gm__gear sp-mp-chatbtn';
  } else if (roomTools) {
    if (chatButton.parentNode !== roomTools) roomTools.appendChild(chatButton);
    chatButton.className = 'sp-mp-chatbtn is-room';
  } else if (resultFoot) {
    if (chatButton.parentNode !== resultFoot) resultFoot.appendChild(chatButton);
    chatButton.className = 'sp-mp-chatbtn is-result';
  } else if (briefFoot) {
    if (chatButton.parentNode !== briefFoot) briefFoot.insertBefore(chatButton, briefFoot.firstChild);
    chatButton.className = 'sp-mp-chatbtn is-brief';
  } else if (draftOrder) {
    if (chatButton.parentNode !== draftOrder) draftOrder.appendChild(chatButton);
    chatButton.className = 'sp-mp-chatbtn is-draft';
  } else {
    chatButton.hidden = true;
    return;
  }
  chatButton.hidden = false;
  updateChatBadge();
}

function updateChatBadge() {
  if (!chatButton) return;
  const label = t('同盟聊天');
  const signature = `${label}|${chatOpened}|${chatUnread}`;
  if (signature === chatButtonSignature) return;
  chatButtonSignature = signature;
  chatButton.textContent = '';
  const icon = document.createElement('span');
  icon.className = 'sp-mp-chatbtn__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▤';
  chatButton.appendChild(icon);
  if (chatUnread > 0 && !chatOpened) {
    const badge = document.createElement('span');
    badge.className = 'sp-mp-chatbtn__badge';
    badge.textContent = String(Math.min(chatUnread, 99)) + (chatUnread > 99 ? '+' : '');
    chatButton.appendChild(badge);
  }
  chatButton.title = label;
  chatButton.setAttribute('aria-label', chatUnread && !chatOpened ? `${label}，${t('{n} 条新消息', { n: chatUnread })}` : label);
  chatButton.setAttribute('aria-pressed', String(chatOpened));
}

function toggleChat() {
  if (chatOpened) { closeChat(); return; }
  if (!chatCode) return;
  if (opened) toggle();
  closePool();
  chatOpened = true;
  chatUnread = 0;
  chatAtBottom = true;
  chatPanel = document.createElement('section');
  chatPanel.className = 'sp-mp-chat';
  chatPanel.setAttribute('data-game-hotkeys', 'off');
  chatPanel.setAttribute('role', 'dialog');
  chatPanel.setAttribute('aria-label', t('同盟聊天'));
  chatPanel.addEventListener('click', (ev) => ev.stopPropagation());
  chatPanel.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  chatPanel.addEventListener('wheel', (ev) => ev.stopPropagation());
  const head = document.createElement('header');
  head.className = 'sp-mp-chat__head';
  const title = document.createElement('h3');
  title.textContent = t('同盟聊天');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'sp-mp-chat__close';
  close.textContent = '✕';
  close.setAttribute('aria-label', t('关闭聊天'));
  close.addEventListener('click', closeChat);
  head.append(title, close);
  const list = document.createElement('ol');
  list.className = 'sp-mp-chat__messages';
  list.setAttribute('aria-live', 'polite');
  list.addEventListener('scroll', () => {
    chatAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 28;
    if (chatAtBottom) chatUnread = 0;
    updateChatJump();
    updateChatBadge();
  });
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'sp-mp-chat__jump';
  jump.addEventListener('click', () => { scrollChatBottom(); chatUnread = 0; updateChatBadge(); updateChatJump(); });
  const form = document.createElement('form');
  form.className = 'sp-mp-chat__form';
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (chatComposing || ev.isComposing) return;
    sendChat();
  });
  const input = document.createElement('input');
  input.className = 'sp-mp-chat__input';
  input.type = 'text';
  input.maxLength = 200;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', t('输入消息'));
  input.placeholder = t('输入消息');
  input.addEventListener('compositionstart', () => { chatComposing = true; });
  input.addEventListener('compositionend', () => { chatComposing = false; });
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'sp-mp-chat__send';
  send.textContent = t('发送');
  form.append(input, send);
  const error = document.createElement('p');
  error.className = 'sp-mp-chat__error';
  error.setAttribute('role', 'alert');
  chatPanel.append(head, list, jump, form, error);
  document.body.appendChild(chatPanel);
  renderChatMessages();
  updateChatComposer();
  updateChatBadge();
  const focusTarget = isChatSpectator() ? close : input;
  try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); }
}

function closeChat() {
  const restoreFocus = !!chatPanel?.contains(document.activeElement);
  chatOpened = false;
  chatComposing = false;
  chatPanel?.remove();
  chatPanel = null;
  updateChatBadge();
  if (restoreFocus) chatButton?.focus?.({ preventScroll: true });
}

function chatKeydown(ev) {
  if (poolOpened && poolPanel?.contains(document.activeElement)) {
    ev.stopImmediatePropagation();
    if (ev.key === 'Escape' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); closePool(); }
    return;
  }
  if (!chatOpened || !chatPanel?.contains(document.activeElement)) return;
  // Window capture runs before the game's shortcuts, including facingWheel's capture listener.
  ev.stopImmediatePropagation();
  const input = chatPanel.querySelector('.sp-mp-chat__input');
  if (ev.isComposing || chatComposing || ev.keyCode === 229) return;
  if (ev.key === 'Escape') { ev.preventDefault(); closeChat(); }
  else if (ev.key === 'Enter' && document.activeElement === input) { ev.preventDefault(); sendChat(); }
}

function validChatMessage(msg) {
  return msg && msg.code === chatCode && Number.isSafeInteger(msg.seq) && msg.seq > 0
    && typeof msg.playerId === 'string' && typeof msg.name === 'string'
    && typeof msg.text === 'string' && Number.isFinite(msg.at);
}
function mergeChatMessage(msg) {
  if (!validChatMessage(msg) || chatMessages.some((old) => old.seq === msg.seq)) return false;
  chatMessages.push(msg);
  chatMessages.sort((a, b) => a.seq - b.seq);
  if (chatMessages.length > 100) chatMessages = chatMessages.slice(-100);
  return true;
}
function acceptChatMessage(msg) {
  if (!mergeChatMessage(msg)) return;
  const fromOther = msg.playerId !== playerId();
  if (fromOther && (!chatOpened || !chatAtBottom)) chatUnread += 1;
  if (chatOpened) renderChatMessages();
  updateChatBadge();
}
function acceptChatHistory(msg) {
  if (!msg || msg.code !== chatCode || !Array.isArray(msg.messages)) return;
  const oldLast = chatMessages.at(-1)?.seq || 0;
  const hadMessages = chatMessages.length > 0;
  // A reconnect snapshot is authoritative for the newest 100 messages.
  chatMessages = [];
  for (const item of msg.messages) mergeChatMessage(item);
  if (hadMessages) {
    const added = chatMessages.filter((item) => item.seq > oldLast && item.playerId !== playerId()).length;
    if (!chatOpened || !chatAtBottom) chatUnread += added;
  }
  if (chatOpened) renderChatMessages();
  updateChatBadge();
}

function chatTime(at) {
  try { return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(at); }
  catch { return ''; }
}
function renderChatMessages() {
  const list = chatPanel?.querySelector('.sp-mp-chat__messages');
  if (!list) return;
  const wasAtBottom = chatAtBottom;
  const oldTop = list.scrollTop;
  const bounds = list.getBoundingClientRect?.();
  const currentSeqs = new Set(chatMessages.map((msg) => String(msg.seq)));
  const anchor = bounds && [...list.querySelectorAll('[data-seq]')].find((item) => currentSeqs.has(item.getAttribute('data-seq'))
    && item.getBoundingClientRect().bottom > bounds.top);
  const anchorSeq = anchor?.getAttribute('data-seq');
  const anchorTop = anchor?.offsetTop;
  list.textContent = '';
  if (!chatMessages.length) {
    const empty = document.createElement('li');
    empty.className = 'sp-mp-chat__empty';
    empty.textContent = t('暂无消息');
    list.appendChild(empty);
  }
  for (const msg of chatMessages) {
    const item = document.createElement('li');
    item.className = 'sp-mp-chat__message';
    item.setAttribute('data-seq', String(msg.seq));
    const meta = document.createElement('div');
    meta.className = 'sp-mp-chat__meta';
    const name = document.createElement('b');
    name.textContent = msg.name;
    const time = document.createElement('time');
    time.textContent = chatTime(msg.at);
    const date = new Date(msg.at);
    if (Number.isFinite(date.getTime())) time.dateTime = date.toISOString();
    meta.append(name, time);
    const body = document.createElement('p');
    body.textContent = msg.text;
    item.append(meta, body);
    list.appendChild(item);
  }
  if (wasAtBottom) scrollChatBottom();
  else {
    const nextAnchor = anchorSeq && list.querySelector(`[data-seq="${anchorSeq}"]`);
    list.scrollTop = nextAnchor && Number.isFinite(anchorTop) ? oldTop + nextAnchor.offsetTop - anchorTop : oldTop;
  }
  updateChatJump();
}
function scrollChatBottom() {
  const list = chatPanel?.querySelector('.sp-mp-chat__messages');
  if (!list) return;
  list.scrollTop = list.scrollHeight;
  chatAtBottom = true;
  chatUnread = 0;
  updateChatBadge();
}
function updateChatJump() {
  const jump = chatPanel?.querySelector('.sp-mp-chat__jump');
  if (!jump) return;
  jump.hidden = chatAtBottom || chatUnread === 0;
  jump.textContent = chatUnread ? t('{n} 条新消息', { n: chatUnread }) : t('跳到最新消息');
}
function updateChatComposer() {
  if (!chatPanel) return;
  const spectator = isChatSpectator();
  const form = chatPanel.querySelector('.sp-mp-chat__form');
  const input = chatPanel.querySelector('.sp-mp-chat__input');
  const send = chatPanel.querySelector('.sp-mp-chat__send');
  if (form) form.hidden = spectator;
  if (input) { input.disabled = spectator; input.readOnly = chatSending; }
  if (send) send.disabled = spectator || chatSending;
  if (spectator && document.activeElement === input) chatPanel.querySelector('.sp-mp-chat__close')?.focus?.();
  const error = chatPanel.querySelector('.sp-mp-chat__error');
  if (error) {
    error.textContent = spectator ? t('观战者只能查看聊天')
      : chatError === 'old-server' ? t('当前服务未加载 sp-mp 1.6.0，请关闭旧服务，用 sp-mp/start-windows.cmd 重启并硬刷新')
      : (chatError ? t(chatError) : '');
    error.hidden = !error.textContent;
  }
}
async function roomChatCapability() {
  const now = Date.now();
  if (chatCapabilityAt && now >= chatCapabilityAt
    && now - chatCapabilityAt < (chatCapability == null ? 2000 : 15000)) return chatCapability;
  if (chatCapabilityPending) return chatCapabilityPending;
  chatCapabilityPending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    try {
      const response = await fetch('/healthz', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return null;
      const health = await response.json();
      if (health?.ok !== true) return null;
      return health.capabilities?.roomChat === true && health.capabilities?.poolTools === true;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  })();
  try {
    chatCapability = await chatCapabilityPending;
    chatCapabilityAt = Date.now();
    return chatCapability;
  } finally { chatCapabilityPending = null; }
}
async function sendChat() {
  const input = chatPanel?.querySelector('.sp-mp-chat__input');
  const value = input?.value?.trim();
  if (!value || !chatCode || isChatSpectator() || chatSending) return;
  if (chatNet?.status !== 'online') { chatError = '尚未连接，无法发送消息'; updateChatComposer(); return; }
  const code = chatCode;
  chatSending = true;
  chatError = '';
  updateChatComposer();
  try {
    const capability = await roomChatCapability();
    if (chatCode !== code) return;
    if (capability === false) { chatError = 'old-server'; return; }
    await chatNet.request('room.chat', { text: value });
    if (chatCode === code && input.value.trim() === value) input.value = '';
  } catch {
    if (chatCode === code) chatError = '发送失败，请重试';
  } finally {
    if (chatCode === code) { chatSending = false; updateChatComposer(); input?.focus?.(); }
  }
}

// The published pool is shared; DIY entries come only from this player's private view.
function poolState() { return host().store?.get?.() || {}; }
function poolEnabled() { const s = poolState(); return !!(s.room?.code && s.match?.public?.poolToolsEnabled); }
function bindPoolData() {
  if (!poolEnabled()) return;
  const data = host().data;
  if (!data || data === poolData) return;
  poolData = data;
  data.subscribe?.(() => { if (poolOpened) renderPool(); });
  if (!poolDataLoading && typeof data.loadAll === 'function') {
    poolDataLoading = true;
    Promise.resolve(data.loadAll('chess', 'bonds', 'backups')).catch(() => {}).finally(() => {
      poolDataLoading = false;
      if (poolOpened) renderPool();
    });
  }
}
function syncPoolState() {
  const s = poolState();
  const phase = s.match?.public?.phase || null;
  const code = s.room?.code || null;
  const setupRevision = s.match?.public?.setupRevision ?? null;
  const affinity = s.match?.private?.shopAffinity;
  if (code !== poolRoomCode || setupRevision !== poolSetupRevision
      || (phase === 'INFO_CHECK' && poolLastPhase !== 'INFO_CHECK')) {
    poolRoomCode = code;
    poolSetupRevision = setupRevision;
    poolTier = '';
    poolBond = '';
    poolSearch = '';
    poolBan = affinity?.banBond || '';
    poolPrefer = affinity?.preferBond || '';
    poolSubmitted = !!affinity?.locked;
    poolSending = false;
    poolError = '';
  }
  poolLastPhase = phase;
  if (affinity?.locked) {
    poolBan = affinity.banBond || '';
    poolPrefer = affinity.preferBond || '';
    poolSubmitted = true;
  }
  const ready = s.match?.public?.players?.some((p) => p?.playerId === playerId() && p.ready);
  const signature = [code, phase, setupRevision, !!s.match?.public?.poolToolsEnabled,
    !!ready, !!s.match?.public?.rerollVote, s.match?.public?.bannedChess, s.match?.pool,
    s.match?.private?.diyPoolEntries, affinity, host().data?.locale?.()];
  const changed = !poolStateSignature || signature.some((x, i) => x !== poolStateSignature[i]);
  if (changed) {
    poolStateSignature = signature;
    if (poolOpened) renderPool();
  }
  if (!poolEnabled() && poolOpened) closePool();
}
function installPoolButton() {
  if (!poolEnabled()) { if (poolButton) poolButton.hidden = true; return; }
  if (!poolButton?.isConnected) {
    poolButton = document.createElement('button');
    poolButton.type = 'button';
    poolButton.className = 'sp-mp-poolbtn';
    poolButton.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); togglePool(); });
    document.body.appendChild(poolButton);
  }
  poolButton.textContent = t('卡池');
  poolButton.setAttribute('aria-label', t('卡池'));
  poolButton.setAttribute('aria-expanded', String(poolOpened));
  poolButton.hidden = poolOpened;
}
function poolEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}
function togglePool() {
  if (poolOpened) { closePool(); return; }
  if (!poolEnabled()) return;
  closeChat();
  if (opened) toggle();
  poolOpened = true;
  poolPanel = poolEl('section', 'sp-mp-pool');
  poolPanel.setAttribute('role', 'dialog');
  poolPanel.setAttribute('data-game-hotkeys', 'off');
  poolPanel.setAttribute('aria-label', t('卡池'));
  for (const type of ['click', 'pointerdown', 'wheel']) poolPanel.addEventListener(type, (ev) => ev.stopPropagation());
  const head = poolEl('header', 'sp-mp-pool__head');
  const title = poolEl('h3', '', t('卡池'));
  const close = poolEl('button', 'sp-mp-pool__close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', t('关闭卡池'));
  close.addEventListener('click', closePool);
  head.append(title, close);
  const affinity = poolEl('div', 'sp-mp-pool__affinity');
  const filters = poolEl('div', 'sp-mp-pool__filters');
  const search = poolEl('input', 'sp-mp-pool__search');
  search.type = 'search';
  search.value = poolSearch;
  search.placeholder = t('搜索干员');
  search.setAttribute('aria-label', t('搜索干员'));
  search.addEventListener('input', () => { poolSearch = search.value; renderPoolRows(); });
  const tier = poolEl('select', 'sp-mp-pool__tier');
  tier.setAttribute('aria-label', t('全部等阶'));
  tier.addEventListener('change', () => { poolTier = tier.value; renderPoolRows(); });
  const bond = poolEl('select', 'sp-mp-pool__bond');
  bond.setAttribute('aria-label', t('全部盟约'));
  bond.addEventListener('change', () => { poolBond = bond.value; renderPoolRows(); });
  filters.append(search, tier, bond);
  const rows = poolEl('div', 'sp-mp-pool__rows');
  const foot = poolEl('p', 'sp-mp-pool__foot', `${t('商店展示不预扣，购买才扣')} · ${t('本局禁用未加入卡池；个人禁用仅影响自己的商店')}`);
  poolPanel.append(head, affinity, filters, rows, foot);
  document.body.appendChild(poolPanel);
  if (poolButton) poolButton.hidden = true;
  renderPool();
  try { search.focus({ preventScroll: true }); } catch { search.focus(); }
}
function closePool() {
  const restoreFocus = !!poolPanel?.contains(document.activeElement);
  poolOpened = false;
  poolPanel?.remove();
  poolPanel = null;
  if (poolButton) { poolButton.hidden = !poolEnabled(); poolButton.setAttribute('aria-expanded', 'false'); }
  if (restoreFocus) poolButton?.focus?.({ preventScroll: true });
}
function refreshPoolLang() {
  if (poolButton) { poolButton.textContent = t('卡池'); poolButton.setAttribute('aria-label', t('卡池')); }
  if (!poolPanel) return;
  poolPanel.setAttribute('aria-label', t('卡池'));
  poolPanel.querySelector('.sp-mp-pool__head h3').textContent = t('卡池');
  poolPanel.querySelector('.sp-mp-pool__close').setAttribute('aria-label', t('关闭卡池'));
  const search = poolPanel.querySelector('.sp-mp-pool__search');
  search.placeholder = t('搜索干员');
  search.setAttribute('aria-label', t('搜索干员'));
  poolPanel.querySelector('.sp-mp-pool__foot').textContent = `${t('商店展示不预扣，购买才扣')} · ${t('本局禁用未加入卡池；个人禁用仅影响自己的商店')}`;
  renderPool();
}
function poolEntries(raw, personal = false) {
  if (!Array.isArray(raw)) return [];
  const data = host().data;
  const priv = poolState().match?.private;
  const backups = data?.get?.('backups');
  return raw.filter((e) => e && typeof e.id === 'string' && Number.isInteger(e.tier)
    && Number.isFinite(e.cap) && Number.isFinite(e.left)).map((e) => {
      const base = data?.lookup?.('chess', e.id) || null;
      let rec = base;
      if (personal && base?.isDiy && priv?.diy?.[e.id] && backups) {
        try { rec = diyRecordOf(base, priv.diy[e.id], { chess: data.get('chess'), backups }) || base; }
        catch { /* incomplete local data: keep the slot label until it loads */ }
      }
      return { id: e.id, tier: e.tier, cap: Math.max(0, e.cap), left: Math.max(0, e.left),
        overdraw: Math.max(0, Number(e.overdraw) || 0), personal, rec };
    });
}
function poolRows() {
  const s = poolState();
  const shared = poolEntries(s.match?.pool?.entries);
  const personal = poolEntries(s.match?.private?.diyPoolEntries, true);
  const activeBan = s.match?.private?.shopAffinity;
  const banBond = activeBan?.locked ? activeBan.banBond : null;
  const markPersonalBan = (row) => ({ ...row, personalBan: !!(banBond && row.rec?.bonds?.includes(banBond)) });
  const pooled = new Set(shared.map((row) => row.id));
  const banned = (s.match?.public?.bannedChess || []).filter((id) => typeof id === 'string' && !pooled.has(id))
    .map((id) => {
      const rec = host().data?.lookup?.('chess', id);
      return rec && Number.isInteger(rec.tier) ? { id, tier: rec.tier, cap: null, left: null,
        overdraw: 0, personal: false, globalBan: true, rec } : null;
    }).filter(Boolean);
  return {
    shared: [...shared, ...banned].map(markPersonalBan),
    personal: personal.map(markPersonalBan),
  };
}
function poolBondChoices(shared) {
  const ids = new Set(shared.flatMap((e) => Array.isArray(e.rec?.bonds) ? e.rec.bonds : []));
  return (host().data?.list?.('bonds') || []).filter((b) => ids.has(b?.bondId))
    .sort((a, b) => String(a.name || a.bondId).localeCompare(String(b.name || b.bondId)));
}
function poolOption(value, label) {
  const option = poolEl('option', '', label);
  option.value = value;
  return option;
}
function renderPoolFilters(shared, personal, bonds) {
  const tier = poolPanel?.querySelector('.sp-mp-pool__tier');
  const bond = poolPanel?.querySelector('.sp-mp-pool__bond');
  if (!tier || !bond) return;
  const tiers = [...new Set([...shared, ...personal].map((e) => e.tier))].sort((a, b) => a - b);
  tier.replaceChildren(poolOption('', t('全部等阶')), ...tiers.map((n) => poolOption(String(n), t('{tier} 阶', { tier: n }))));
  if (poolTier && !tiers.includes(Number(poolTier))) poolTier = '';
  tier.value = poolTier;
  bond.replaceChildren(poolOption('', t('全部盟约')), ...bonds.map((b) => poolOption(b.bondId, b.name || b.bondId)));
  if (poolBond && !bonds.some((b) => b.bondId === poolBond)) poolBond = '';
  bond.value = poolBond;
}
function renderPool() {
  if (!poolPanel) return;
  const search = poolPanel.querySelector('.sp-mp-pool__search');
  if (search && search.value !== poolSearch) search.value = poolSearch;
  const { shared, personal } = poolRows();
  const bonds = poolBondChoices([...shared, ...personal]);
  renderPoolFilters(shared, personal, bonds);
  renderPoolAffinity(bonds);
  renderPoolRows(shared, personal);
}
function renderPoolRows(sharedIn, personalIn) {
  const root = poolPanel?.querySelector('.sp-mp-pool__rows');
  if (!root) return;
  const { shared, personal } = sharedIn && personalIn ? { shared: sharedIn, personal: personalIn } : poolRows();
  const oldTop = root.scrollTop;
  const oldPanelTop = poolPanel.scrollTop;
  root.replaceChildren();
  if (!poolState().match?.pool) {
    root.appendChild(poolEl('p', 'sp-mp-pool__note', t('卡池加载中')));
    return;
  }
  const term = poolSearch.trim().toLocaleLowerCase();
  const filter = (e) => (!poolTier || e.tier === Number(poolTier))
    && (!poolBond || (Array.isArray(e.rec?.bonds) && e.rec.bonds.includes(poolBond)))
    && (!term || `${e.rec?.name || ''} ${e.id}`.toLocaleLowerCase().includes(term));
  let count = 0;
  const appendSection = (label, entries, personalSection) => {
    const filtered = entries.filter(filter).sort((a, b) => a.tier - b.tier || String(a.rec?.name || a.id).localeCompare(String(b.rec?.name || b.id)));
    if (!filtered.length) return;
    count += filtered.length;
    const section = poolEl('section', personalSection ? 'sp-mp-pool__section is-personal' : 'sp-mp-pool__section');
    section.appendChild(poolEl('h4', '', label));
    let lastTier = null;
    let list = null;
    for (const row of filtered) {
      if (row.tier !== lastTier) {
        lastTier = row.tier;
        section.appendChild(poolEl('h5', '', t('{tier} 阶', { tier: row.tier })));
        list = poolEl('ul', 'sp-mp-pool__list');
        section.appendChild(list);
      }
      const li = poolEl('li', `sp-mp-pool__entry${row.left === 0 ? ' is-empty' : ''}${row.globalBan ? ' is-global-ban' : ''}`);
      li.setAttribute('data-chess-id', row.id);
      const name = poolEl('span', 'sp-mp-pool__name', row.rec?.name || row.id);
      const stock = poolEl('span', 'sp-mp-pool__stock', row.globalBan
        ? t('未加入卡池') : t('剩余 {left}/{cap}', { left: row.left, cap: row.cap }));
      if (row.overdraw) stock.title = t('超额占用 {n}', { n: row.overdraw });
      const bondNames = (Array.isArray(row.rec?.bonds) ? row.rec.bonds : []).map((id) => host().data?.lookup?.('bonds', id)?.name || id);
      const sub = poolEl('small', 'sp-mp-pool__bonds', bondNames.join(' · '));
      li.append(name, stock, sub);
      if (row.globalBan || row.personalBan) {
        const tags = poolEl('span', 'sp-mp-pool__tags');
        if (row.globalBan) tags.appendChild(poolEl('small', 'sp-mp-pool__tag is-global', t('本局禁用')));
        if (row.personalBan) tags.appendChild(poolEl('small', 'sp-mp-pool__tag is-personal is-personal-ban', t('个人禁用')));
        li.appendChild(tags);
      }
      if (row.overdraw) li.appendChild(poolEl('small', 'sp-mp-pool__overdraw', t('超额占用 {n}', { n: row.overdraw })));
      list.appendChild(li);
    }
    root.appendChild(section);
  };
  appendSection(t('卡池'), shared, false);
  appendSection(t('自选库存独立'), personal, true);
  if (!count) root.appendChild(poolEl('p', 'sp-mp-pool__note', t('无匹配干员')));
  root.scrollTop = oldTop;
  poolPanel.scrollTop = oldPanelTop;
}
function renderPoolAffinity(bonds) {
  const root = poolPanel?.querySelector('.sp-mp-pool__affinity');
  if (!root) return;
  const s = poolState();
  const pub = s.match?.public;
  const priv = s.match?.private;
  const spectator = isChatSpectator();
  root.hidden = !(pub?.poolToolsEnabled && pub.phase === 'INFO_CHECK' && !spectator && priv);
  if (root.hidden) { root.replaceChildren(); return; }
  root.replaceChildren(poolEl('h4', '', t('个人商店设置')));
  const form = poolEl('form', 'sp-mp-pool__affinity-form');
  const ready = pub.players?.some((p) => p?.playerId === playerId() && p.ready);
  const locked = !!(priv.shopAffinity?.locked || ready || pub.rerollVote || poolSubmitted || poolSending);
  const selectBond = (label, value, other, onChange) => {
    const wrap = poolEl('label', 'sp-mp-pool__affinity-label');
    wrap.appendChild(poolEl('span', '', label));
    const sel = poolEl('select', 'sp-mp-pool__affinity-select');
    sel.append(poolOption('', t('不选择')), ...bonds.map((b) => poolOption(b.bondId, b.name || b.bondId)));
    sel.value = value;
    sel.disabled = locked;
    sel.addEventListener('change', () => {
      onChange(sel.value);
      if (sel.value && sel.value === other()) { if (onChange === setPoolBan) poolPrefer = ''; else poolBan = ''; }
      renderPoolAffinity(bonds);
      const index = onChange === setPoolBan ? 0 : 1;
      root.querySelectorAll('.sp-mp-pool__affinity-select')[index]?.focus?.({ preventScroll: true });
    });
    wrap.appendChild(sel);
    return wrap;
  };
  form.append(selectBond(t('禁用盟约'), poolBan, () => poolPrefer, setPoolBan),
    selectBond(t('偏好盟约'), poolPrefer, () => poolBan, setPoolPrefer));
  const hint = poolEl('p', 'sp-mp-pool__hint', `${t('仅影响自己的商店')} · ${t('偏好盟约干员出现权重 ×2')}`);
  form.appendChild(hint);
  if (locked) form.appendChild(poolEl('p', 'sp-mp-pool__locked', t('已确认，无法修改')));
  else {
    if ((!poolBan && !poolPrefer) || (poolBan && poolBan === poolPrefer)) {
      form.appendChild(poolEl('p', 'sp-mp-pool__hint', t('至少选择一个盟约；禁用与偏好不能相同')));
    }
    const confirm = poolEl('button', 'sp-mp-pool__confirm', t('确认设置'));
    confirm.type = 'submit';
    confirm.disabled = (!poolBan && !poolPrefer) || (poolBan && poolBan === poolPrefer);
    form.appendChild(confirm);
    const skip = poolEl('button', 'sp-mp-pool__skip', t('跳过设置'));
    skip.type = 'button';
    skip.addEventListener('click', () => submitPoolAffinity(true));
    form.appendChild(skip);
  }
  if (poolError) form.appendChild(poolEl('p', 'sp-mp-pool__error', t('选择失败，请重试')));
  form.addEventListener('submit', (ev) => { ev.preventDefault(); submitPoolAffinity(false); });
  root.appendChild(form);
}
function setPoolBan(value) { poolBan = value; }
function setPoolPrefer(value) { poolPrefer = value; }
async function submitPoolAffinity(skip = false) {
  if (poolSending || poolSubmitted || !poolEnabled() || poolState().match?.public?.phase !== 'INFO_CHECK') return;
  const pub = poolState().match?.public;
  if (pub.rerollVote || pub.players?.some((p) => p?.playerId === playerId() && p.ready)) return;
  if (!skip && ((!poolBan && !poolPrefer) || (poolBan && poolBan === poolPrefer))) return;
  const revision = poolState().match?.public?.setupRevision;
  const banBond = skip ? null : (poolBan || null);
  const preferBond = skip ? null : (poolPrefer || null);
  poolSending = true;
  poolError = '';
  renderPoolAffinity(poolBondChoices([...poolRows().shared, ...poolRows().personal]));
  try {
    await host().net.request('g.shopAffinity', {
      setupRevision: revision,
      banBond, preferBond,
    });
    if (poolSetupRevision === revision) {
      poolSubmitted = true;
      if (skip) { poolBan = ''; poolPrefer = ''; }
    }
  } catch {
    if (poolSetupRevision === revision) poolError = '选择失败，请重试';
  } finally {
    if (poolSetupRevision === revision) {
      poolSending = false;
      renderPoolAffinity(poolBondChoices([...poolRows().shared, ...poolRows().personal]));
    }
  }
}
