// ui/damagePanel.js — 伤害统计: the live damage board of the own battlefield, opened by the 📊 button beside the
// fullscreen toggle in the game HUD's bottom-left corner (gm__corner). Purely client-side: the browser runs its own
// battle (docs/ARCHITECTURE.md §1), so the numbers come straight from the running sim through
// battle/runner.js damageBoard() — no server message, no protocol addition, nothing added to the wire.
//
// What it shows: every operator the local player owns IN THE BATTLE ON SCREEN, ranked by damage dealt — the same
// tally the battle result and the statistics page count (sim/units.js `stats`; HP removed from the other side only,
// sim/damage.js). `share` is the row's part of the field's total ally damage, drawn as a bar. A teammate's board is
// not included (that battle runs in their browser). The panel is read-only and polls at 4 Hz while open — the rate
// the unit detail card re-reads live stats at (screens/game.js).

import { html, Icon, GIcon } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { battleRunner } from '../battle/runner.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';

const POLL_MS = 250;

/** 12345678 → '1234.6万' (the compact form the HUD uses for big numbers). */
function fmt(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v >= 100000000) return `${(v / 100000000).toFixed(2)}亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return String(v);
}

const pct = (v) => `${(Math.max(0, Number(v) || 0) * 100).toFixed(1)}%`;

/** The operator's display name; the id is the fallback (a token or an unknown record). */
function nameOf(defId) {
  const rec = defId ? data.lookup('chess', defId) : null;
  return (rec && rec.name) || defId || '?';
}

/**
 * @param {{ ownerId: string|null, fieldId?: string|null, onClose: () => void }} props
 *   `ownerId` = the local player (m.private.playerId). No board of one's own (spectating, a teammate's field, a
 *   paused battle) ⇒ the panel says so instead of showing an empty table.
 */
export function DamagePanel({ ownerId, fieldId = null, onClose }) {
  const [rows, setRows] = useState(null);   // null = 还没有读到；[] = 这一场没有自己的干员
  useEffect(() => {
    const read = () => {
      try { setRows(ownerId ? battleRunner.damageBoard(ownerId, fieldId) : []); } catch { setRows([]); }
    };
    read();
    const h = setInterval(read, POLL_MS);
    return () => clearInterval(h);
  }, [ownerId, fieldId]);

  const list = Array.isArray(rows) ? rows : [];
  const sum = (k) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const total = sum('dmg');

  return html`<section class="dmgpanel" role="dialog" aria-label=${t('伤害统计')}>
    <header class="dmgpanel__head">
      <${GIcon} name="chart" class="dmgpanel__icon" />
      <h3 class="dmgpanel__title">${t('伤害统计')}</h3>
      <button type="button" class="dmgpanel__close" aria-label=${t('关闭')} title=${t('关闭')} onClick=${onClose}>
        <${Icon} name="close" />
      </button>
    </header>

    <div class="dmgpanel__sum">
      <span class="dmgpanel__cell"><i>${t('总伤害')}</i><b class="num">${fmt(total)}</b></span>
      <span class="dmgpanel__cell"><i>${t('击杀')}</i><b class="num">${fmt(sum('kills'))}</b></span>
      <span class="dmgpanel__cell"><i>${t('治疗')}</i><b class="num">${fmt(sum('heal'))}</b></span>
      <span class="dmgpanel__cell"><i>${t('承伤')}</i><b class="num">${fmt(sum('taken'))}</b></span>
    </div>

    ${!ownerId || !list.length ? html`<p class="dmgpanel__note">${t('战斗开始后显示伤害统计')}</p>`
      : html`<div class="dmgpanel__body">
        <div class="dmgpanel__cols"><span>${t('干员')}</span><span>${t('伤害')}</span><span>${t('占比')}</span><span>${t('击杀')}</span></div>
        <ol class="dmgpanel__list">
          ${list.map((r) => html`<li key=${r.uid ?? r.id ?? r.defId} class=${`dmgrow${r.alive ? '' : ' is-down'}${r.dmg > 0 ? '' : ' is-idle'}`}
            title=${`${r.defId || ''} · ${t('承伤')} ${fmt(r.taken)} · ${t('治疗')} ${fmt(r.heal)}`}>
            <${UnitThumb} kind="chess" id=${r.defId} size="xs" class="dmgrow__thumb" title=${nameOf(r.defId)} />
            <span class="dmgrow__name">${nameOf(r.defId)}</span>
            <span class="dmgrow__v num">${fmt(r.dmg)}</span>
            <span class="dmgrow__share"><i style=${`width:${((Number(r.share) || 0) * 100).toFixed(1)}%`}></i><b class="num">${pct(r.share)}</b></span>
            <span class="dmgrow__k num">${r.kills || 0}</span>
          </li>`)}
        </ol>
      </div>`}
  </section>`;
}
