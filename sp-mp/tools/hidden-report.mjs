// 隐秘核心（隐藏关）的开启条件：各人数档下的门槛与其它条件
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
Module.registerHooks({ resolve: (await import(pathToFileURL(path.join(ROOT, 'sp-mp/hooks.mjs')).href)).resolve });
const { GameData } = await import(pathToFileURL(path.join(ROOT, 'sp-mp/files/server/match/gamedata.js')).href);
const { hiddenEligible } = await import(pathToFileURL(path.join(ROOT, 'sp-mp/files/server/match/finalAssault.js')).href);
const { seatScale } = await import(pathToFileURL(path.join(ROOT, 'sp-mp/files/shared/constants.js')).href);

const RAW = {};
for (const f of fs.readdirSync('data')) if (f.endsWith('.json')) { try { RAW[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join('data', f), 'utf8')); } catch {} }

const gdFor = (modeId, n) => {
  const gd = new GameData(RAW, modeId);
  gd.seatScale = seatScale(n);
  gd.hiddenScale = n <= 4 ? 1 : n <= 8 ? 1.5 : 3; // Match.js sets this from the occupied seats
  return gd;
};

console.log('隐秘核心基础门槛（data/config.json hiddenCore）:', JSON.stringify(gdFor('mode_multi_hard', 4).hiddenCore));
console.log('');
console.log('人数  卡池缩放  层数缩放  同盟层数门槛  达到门槛的层数(不满足)  达到+1(满足)');
for (const n of [1, 4, 5, 8, 9, 12]) {
  const gd = gdFor('mode_multi_hard', n);
  const need = gd.hiddenCore.multi * (gd.hiddenScale || 1);
  console.log(`  ${String(n).padStart(2)}   ×${seatScale(n)}      ×${gd.hiddenScale}   ${String(need).padStart(11)}  ${String(hiddenEligible(gd, { layerSum: need, teamLp: 30 })).padStart(20)}  ${String(hiddenEligible(gd, { layerSum: need + 1, teamLp: 30 })).padStart(12)}`);
}
console.log('');
console.log('其它条件（12 人房，门槛 3600）:');
const gd = gdFor('mode_multi_hard', 12);
console.log('  难度 FUNNY          :', hiddenEligible(gdFor('mode_multi_funny', 12), { layerSum: 99999, teamLp: 30 }));
console.log('  难度 NORMAL/HARD/ABYSS:', hiddenEligible(gd, { layerSum: 3601, teamLp: 30 }));
console.log('  团队 LP = 1 (门槛 >1):', hiddenEligible(gd, { layerSum: 3601, teamLp: 1 }));
console.log('  团队 LP = 2          :', hiddenEligible(gd, { layerSum: 3601, teamLp: 2 }));
console.log('  独立模拟 solo 门槛   :', gdFor('mode_single_abyss', 1).hiddenCore.single, '（不随人数变）');
console.log('');
console.log('每个模式的隐藏关回合 gd.hiddenRound:', ['mode_single_funny', 'mode_single_normal', 'mode_multi_hard', 'mode_multi_abyss'].map((m) => `${m}=${gdFor(m, 4).hiddenRound}`).join('  '));
