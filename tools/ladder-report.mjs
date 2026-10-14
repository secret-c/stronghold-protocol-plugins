// Print the exact scaling ladder of the overlay (registers the plugin's own module hooks first).
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('sp-mp/', pathToFileURL(process.cwd() + path.sep))));
Module.registerHooks({ resolve: (await import(pathToFileURL(path.join(MP, 'hooks.mjs')).href)).resolve });

const { GameData, bossPoolShareOf } = await import(pathToFileURL(path.join(MP, 'files/server/match/gamedata.js')).href);
const { seatScale, ROOM_CAPACITIES, MAX_SEATS } = await import(pathToFileURL(path.join(MP, 'files/shared/constants.js')).href);

const RAW = {};
for (const f of fs.readdirSync('data')) {
  if (f.endsWith('.json')) { try { RAW[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join('data', f), 'utf8')); } catch {} }
}

console.log(`可选人数 ${JSON.stringify(ROOM_CAPACITIES)}   默认 ${ROOM_CAPACITIES[0]}   硬上限 MAX_SEATS=${MAX_SEATS}\n`);
console.log('人数  缩放  干员池(I阶每种)  装备库存(I阶每种)  领袖倍数  隐秘核心层数  机变卡数');
for (const n of [1, 4, 5, 8, 9, 12]) {
  const gd = new GameData(RAW, 'mode_multi_hard');
  gd.seatScale = seatScale(n);
  const id = gd.visibleChess.find((c) => gd.tierOf(c) === 1);
  const item = gd.shopItemsByTier[1][0];
  const cards = Math.max(1, Math.ceil((n + 2) / 6)) * 6;
  console.log(` ${String(n).padStart(2)}   ×${seatScale(n)}  ${String(gd.poolCopies(id)).padStart(12)}  ${String(gd.itemPoolCopies(item)).padStart(14)}  ${String(bossPoolShareOf(null, null, false, n)).padStart(7)}  ${String(1200 * seatScale(n)).padStart(11)}  ${String(cards).padStart(7)}`);
}
console.log('\n终极难度「假想敌：胄」bloodPoint = 3,600,000：');
for (const n of [4, 8, 12]) console.log(`  ${String(n).padStart(2)} 人开战 → ${(3600000 * bossPoolShareOf(null, null, false, n)).toLocaleString('en-US')}`);
console.log('\n普通敌人波次 / 棋盘 / 联防助手数 / 自选私有库存 = 不随人数变化');
