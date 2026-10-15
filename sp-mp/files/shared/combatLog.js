// sp-mp compact latest-match statistics. No hit events, replay state or derived totals are stored.
export const COMBAT_LOG_KEY = 'sp-mp.latest-combat.v1';
export const COMBAT_LOG_LIMIT = 1024 * 1024;
export const COMBAT_KINDS = ['normal', 'unite', 'boss', 'hidden'];
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const key = (s) => typeof s === 'string' && s.length <= 160;
export function validCombatLog(log) {
  if (!log || typeof log.ended !== 'boolean' || log.v !== 1 || !key(log.id) || !Array.isArray(log.p) || log.p.length > 12
    || !Array.isArray(log.u) || log.u.length > 12000 || !Array.isArray(log.f) || log.f.length > 256) return false;
  if (!log.p.every((p) => Array.isArray(p) && key(p[0]) && key(p[1]))) return false;
  if (!log.u.every((u) => Array.isArray(u) && integer(u[0]) && u[0] < log.p.length
    && (u[1] === null || integer(u[1])) && key(u[2]) && key(u[3]))) return false;
  return log.f.every((f) => Array.isArray(f) && integer(f[0]) && f[0] <= 64 && integer(f[1]) && f[1] < 4
    && key(f[2]) && integer(f[3]) && Array.isArray(f[4]) && f[4].length <= 256
    && f[4].every((r) => Array.isArray(r) && r.length === 8 && integer(r[0]) && r[0] < log.u.length && r.slice(1).every(integer)));
}
export function createCombatLog(id, players) {
  return { v: 1, id, p: players.map((p) => [p.playerId, p.name]), u: [], f: [], ended: false };
}
export function mergeCombatLog(previous, packet) {
  if (packet?.log) return validCombatLog(packet.log) ? packet.log : previous;
  if (!previous || previous.id !== packet?.id || packet.us !== previous.u.length || packet.fs !== previous.f.length) return previous;
  const next = { ...previous, u: [...previous.u, ...(packet.u || [])], f: [...previous.f, ...(packet.f || [])] };
  return validCombatLog(next) ? next : previous;
}
export function loadCombatLog(storage) {
  return readCombatLog(storage).log;
}
export function readCombatLog(storage) {
  try {
    const raw = storage?.getItem(COMBAT_LOG_KEY);
    if (!raw) return { log: null, error: null };
    if (raw.length > COMBAT_LOG_LIMIT) return { log: null, error: 'corrupt' };
    const log = JSON.parse(raw);
    return validCombatLog(log) ? { log, error: null } : { log: null, error: 'corrupt' };
  } catch { return { log: null, error: 'corrupt' }; }
}
export function saveCombatLog(storage, log) {
  try {
    if (!validCombatLog(log)) return 'invalid';
    const json = JSON.stringify(log);
    // JSON.stringify escapes lone surrogates; each URI escape represents one UTF-8 byte.
    if (encodeURIComponent(json).replace(/%[0-9A-F]{2}/g, 'x').length > COMBAT_LOG_LIMIT) return 'limit';
    if (!storage) return 'unavailable';
    storage.setItem(COMBAT_LOG_KEY, json); return null;
  } catch { return 'write_failed'; }
}
/** Derive totals instead of storing them twice. round/player null means the whole match/team. */
export function combatLogRows(log, round = null, player = null) {
  if (!validCombatLog(log)) return [];
  const rows = new Map();
  for (const f of log.f) {
    if (round != null && f[0] !== round) continue;
    for (const r of f[4]) {
      const unit = log.u[r[0]]; if (player != null && unit[0] !== player) continue;
      let row = rows.get(r[0]);
      if (!row) { row = { unitId: r[0], uid: unit[1], defId: unit[2], name: unit[3], player: log.p[unit[0]][1], playerIndex: unit[0], alive: true,
        byType: { phys: 0, arts: 0, elemental: 0, true: 0 }, dmg: 0, kills: 0, taken: 0, heal: 0 }; rows.set(r[0], row); }
      ['phys', 'arts', 'elemental', 'true'].forEach((t, i) => { row.byType[t] += r[i + 1]; row.dmg += r[i + 1]; });
      row.kills += r[5]; row.taken += r[6]; row.heal += r[7];
    }
  }
  return [...rows.values()].sort((a, b) => b.dmg - a.dmg || a.unitId - b.unitId);
}
