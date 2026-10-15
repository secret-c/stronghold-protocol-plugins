# sp-mp 开发指南

适配本体0.2.6，运行清单见 plugin.json。项目根目录是唯一日常开发源，sp-mp/client 是插件界面源码；sp-mp/files/public/shared/sim 是生成物，base 保留0.2.6原始对照。不要手改生成物，不提交游戏素材。

## 数据链路

根目录源码 → tools/assemble.mjs → files；tools/build-tree.mjs → public/shared/sim 联合目录。start.mjs 注册Node解析钩子，并传 publicDir/sharedDir/simDir 给服务端；浏览器和Node必须加载同份sim补丁。正常启动器不写安装文件；install-patch 是可还原的直接安装备选，新增客户端文件也必须复制并在还原时移除。

## 伤害统计

client/client.js 自持DOM，使用 __SP__.net.playerId 与 __SP_RUNNER__.currentBattle()/combatStats(ownerId,fieldId)。combatStats 是本包叠加给runner的只读查询，返回每个干员 unitId/uid/defId/name/alive/dmg/byType/kills/heal/taken；宿主原版没有该接口，缺失时应提示而不是显示假0。

统计在 server/sim/damage.js 的 applyHpLoss 中，与 stats.dmg 同处用实际 dealt 记入WeakMap。四类 phys/arts/elemental/true；element仅为元素积累不计，生命流失沿引擎true。溢出、护盾、自伤/友伤排除，来源归属与既有引擎一致。[ASSUMED 展示归组] 召唤物沿ownerUnit链归自己召唤者；无归属地图角色不进干员表。击杀/承伤/治疗是本体统计。WeakMap不进入结果、事件或golden摘要，也不被游戏逻辑读取。

一人一个堆叠条，条长/最高干员伤害，分段/本人的总伤害。总计与hover分类都来自同份byType。采集由引擎完成，面板打开时间不影响累计；Unit对象在死亡/再部署间保留，新战斗新对象自然清空，切场只查询当前战斗。不要重新用HP轮询估算输出伤害：旧版不仅ownerOps没有uid，而且把自己承伤当输出。

## 同盟聊天

房间消息走 `room.chat {text}`，由 Lobby 根据真实 session/seat 决定发送者、时间和房间；观战席只读。每房内存保留最近100条，跨备战、战斗、结算和下一局，创建/加入/重连时单独推送 `room.chatHistory`；`code + seq` 让客户端与直播消息去重。单条最多200字符、同一身份1秒内至多一条，服务端清理控制字符。界面在 `client/client.js` 自持 DOM，消息只用 `textContent` 渲染，发送失败保留输入框文本。聊天和伤害/最近一局面板互斥；聊天输入聚焦时不触发游戏快捷键。

对应协议、生命周期与限制见根目录 `docs/design/network.md` §8.1；验证见 `test/lobby-chat.test.js`、`sp-mp/tools/test-client.mjs`、`sp-mp/tools/test-browser-chat.mjs`。插件新文案须同时加进根目录四份 `public/i18n/*.json`，再由 assemble 复制到包内。浏览器测试前须先运行 assemble、build-tree，以免 `/sp-mp/client/` 仍是旧副本。

## 卡池与个人商店盟约（1.6.0）

这是用户指定的插件玩法，[ASSUMED]、不代表官方规则。启动器显式启用 `poolTools`；直接安装时，服务端只在所服务 `public/index.html` 引用了插件 entry 且 entry 文件实际存在时启用；普通宿主默认关闭。INFO_CHECK 每名玩家可只选禁用、只选偏好、同时选两个不同盟约，或整体跳过；超时未选等于跳过，重抽开局清掉旧选择。仅本人普通商店棋子槽受影响：先按个人禁用前的各阶剩余复制数抽可用等阶，整阶无未禁卡才重分配阶质量；再在该阶排除任意位置含禁用盟约的卡，将任意位置含偏好盟约的卡复制权重乘2一次。完全无候选时该槽为空，不放回禁用卡。奖励、道具、队友抽卡规则不变；选择不会删除共享池的卡。

`m.pool` 公布本局共享普通基础卡的 `cap / left / overdraw`，包含剩余0；`m.private.diyPoolEntries` 只给本人显示独立自选库存。商店展示不预占，购买时才扣；已展示缺货卡仍可购买并形成负余额，面板把剩余钳到0、超额量另列。库存推送覆盖 take/give 与重连；`m.private.shopAffinity` 回补个人选择。界面按等阶列表，可筛等阶/盟约与搜索名称，左侧拉出；与聊天、伤害统计等面板互斥。根目录的规则与协议见 `docs/design/match.md`、`docs/design/network.md`，版本记录在 `docs/history/sp-mp-1.6.0.md`。针对验证：`test/match/pool-affinity.test.js`。

更新叠加层后重启服务并在客户端硬刷新，使浏览器重新加载联合目录的页面、脚本和数据。
`start.mjs` 只复用在启动时报告当前插件版本与包签名、聊天/卡池能力、并实际提供插件入口的服务；同端口旧宿主会报错并要求关闭旧进程或换端口。`/healthz.capabilities` 只在服务端启用插件卡池规则时出现，客户端用它区分旧服务和暂时网络故障，发送失败仍保留草稿。

## 验证

在安装根目录：

```sh
node sp-mp/tools/assemble.mjs
node sp-mp/tools/build-tree.mjs
node sp-mp/tools/test-client.mjs
node sp-mp/tools/test-overlay.mjs
```

在项目根目录：

```sh
node --test test/match/pool-affinity.test.js test/match/capacity-wire-choice.test.js
npm run ci
npm run golden
```

修改接口后验证真实ESM加载和HTTP的 /sim/damage.js、/js/battle/runner.js、/sp-mp/client/entry.js；仅检查200不能验证模块链接。测试不能mock宿主不存在的字段。根目录运行源码可改，但不能手改data/*.json、提交素材或推送未授权改动。提交无AI署名，非商业。发行使用 `node sp-mp/tools/export-version.mjs` 生成新的未压缩 `dist/` 版本目录；已有目录绝不覆盖。

## 插件仓库发布

日常开发仍在完整游戏项目根目录进行，先运行 assemble 刷新本地 files。向 https://github.com/secret-c/stronghold-protocol-plugins 的 main 发布时，在基于该仓库 main 的隔离工作树同步插件；不要把游戏主仓库的不同历史覆盖到插件 main。分发仓库显式跟踪 files/base/client，它们是安装所需文件；public/shared/sim 联合目录、截图、素材和依赖不入库。仓库顶层的早期插件副本与 sp-mp/ 同步相同版本，标准安装仍复制 sp-mp/。assemble 和完整版本导出只在完整游戏开发根运行，纯插件 checkout 不需要执行它们。
