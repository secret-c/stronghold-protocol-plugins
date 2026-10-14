# sp-mp 开发记录（DEVLOG）

倒序记录**做过的决定、为什么、验证了什么、还欠什么**。格式：`YYYY-MM-DD · 主题` → 结论 / 影响 / 验证。

给下一位 agent 的入口是 [../DEVELOPMENT.md](../DEVELOPMENT.md)（结构、接口、铁律、坑、验证清单）；本文件只记“发生过什么”。

---

## 2026-10-14 · 伤害统计面板：从“改宿主”改成“插件自持”，并修掉类型与取数问题

**背景。** 面板最初是改宿主的 `shared/protocol.js` / `public/js/battle/runner.js` / `public/js/screens/game.js` / `public/css/screens/game.css` 实现的。

**发生了什么。**

1. 面板上线后**整个游戏脚本加载失败**（页面显示「游戏脚本加载失败，请检查网络连接后刷新页面」）。
   根因：`public/js/ui/damagePanel.js` 里 `import { GIcon } from './components.js'`，而 `GIcon` 实际在
   `gameComponents.js`。**ESM 导入不存在的具名导出会让整条模块链在解析阶段失败**，`main.js → game.js → damagePanel.js` 一断，宿主全挂。
   教训 → 新增客户端模块必须用真正的 ESM 加载器验证，不能只看 HTTP 200。
2. 用户要求**全部放进插件包**。于是：
   - 把宿主的 4 个文件逐一还原成上游 v0.2.6 原样（逐字节核对通过）；
   - 面板改到 `sp-mp/client/`（`client.js` + `client.css` + `entry.js`），由叠加层自己的 `index.html` 引导；
   - `assemble.mjs` 增加：按**内容差异**自动判定覆盖清单（替代手工清单——手工清单曾把 `unite.js` 漏掉，导致“改了服务端没生效”）、
     生成注入版的 `public/index.html`、把 `client/` 路由到 `public/sp-mp/client/`。

**随后修的两个真问题（用户实测反馈）。**

3. **面板一直显示“还没有连上对局”**：宿主用的是 `ws.onmessage = …`（不是 `addEventListener('message')`），
   所以最初的嗅探补丁根本没生效，`playerId` 永远为空。改为直接读宿主自己挂的 `window.__SP__.net.playerId`（`main.js` 的 `__SP__`），
   并在极端情况下允许从 `ownerOps` 反推（保留为兜底）。
4. **伤害类型**：宿主 `unitStatsEntry` 的 `statView()` 只给属性（maxHp/atk/def/res/interval/blockCnt/moveSpeed），**没有 `dmg`/`kills`/`taken`**，
   也没有按类型的伤害量。所以面板：
   - 伤害 = 每次刷新取 `hp` 增量累加，减去护盾减少量（口径 = 宿主 `sim/damage.js` 的“只统计从对方身上移除的生命值”）；
   - 类型 = 干员记录的 `dmgType`（`phys`→物理 74 名 / `arts`→法术 39 / `heal`→治疗 16），技能或天赋文本里出现
     灼燃 / 凋亡 / 神经 / 侵蚀时额外标注该元素，并在面板底部注明“按主攻击类型标注，非逐次实测”；
   - 顶部合计改为 总伤害 / 击杀 / 承伤，治疗在宿主持有该字段前显示 `—`（不再假装有数）。

**验证。** `tools/test-client.mjs`（Node + 最小 DOM 桩）覆盖：按钮插到全屏按钮之前、未连上时的提示、三名干员与类型标签、
HP 增量与护盾口径（400 + 50 护盾 → 450）、类型构成百分比、换战斗清空、`reset()` 后重新解析。
叠加层侧另有一次性校验：首页含插件引导、`/sp-mp/client/*` 三个文件 200、宿主的 4 个文件与安装逐字节一致。

**影响 / 代价。** 覆盖清单从 32 降到 28（唯一 `public/` 文件是注入版 `index.html`）；rebase 冲突面大幅缩小；
面板不再依赖宿主的任何改动，但也因此拿不到“精确的按类型伤害”——要做需要宿主扩展 `unitStatsEntry`（需维护者决定）。

---

## 2026-10-14 · 联防 helper 顺序：真人优先

`unite.js helperOrder` 原先纯按官方择优顺序（unitsOnField > activeBond > undownedUnits，配对再比 layers）选协防者，
AI 队友的棋盘通常更肥，于是真人几乎没机会上场。改为**真人整体排在 AI 席位之前**，各自内部保持原顺序；
`ps.isBot` 才算法 AI 席位（AI 托管 / 掉线 / 离开的真人仍算真人）。房间没有 AI 时与原来逐位相同。

顺带发现并修掉：`unite.js` **不在叠加层的覆盖清单里**（手工清单漏项），也就是说这条修复原本永远不会生效——
这也是把 `assemble.mjs` 改成“按内容差异自动判定”的直接原因。

验证：`test/docs-consistency.test.js` 增加人类优先的四条断言；`test/match/hardening.test.js` 里“空盘人类永不被选”的旧断言
按新规则改为“人类优先”。

---

## 2026-10-14 · 升级到上游 v0.2.6 并 rebase 叠加层

- 上游 `-update.zip` 只是**相对上一版**的差异包，**不能**单独用于跨版本升级（0.2.6 包只有 69 项，且不含 `public/js/ui/stats.js`、`server/lobby.js` 等文件）。
  实际做法：官方 **v0.2.6 源码树**（codeload tarball）作代码基线逐文件覆盖（932 覆盖 / 480 相同），官方增量包补素材与 `MANIFEST.json`，
  打包时才生成的 8 个文件（README/CHANGELOG/package.json/packs/index.json/docs 等）从 **lite 包**取，逐一对上 MANIFEST 的 sha256。
  结果：`doctor` 报「6480 个文件与 v0.2.6 一致」。
- 开发树 rebase：`0.2.6` 基线提交 + 容量功能重放，9 处冲突全部按“取上游一侧”解决。
- 移除 0.2.4 时期的本地补丁「生成都不占（效果生成的装备不占共享库存）」：上游 0.2.5 起已有**官方**规则
  （`GameData.isUnlimitedGiftItem`，8 条 `SERVER_GAIN_EQUIP` 参战团，含**变形同构体**），本地面更宽的临时补丁不再需要；
  马克维茨的「商业包装方案」按官方保持受库存限制。
- 顺带修掉一个回归：本地扩展段原本占用 `§30`，而上游 0.2.5 的历史就是 `§30`（还有 `§30.x` / `§31`），
  导致 `docs-consistency` 抛 `§30 appears twice`。本地扩展整体改为 **`§32`**（`docs/design/capacity.md`）。

---

## 2026-10-13/14 · 4 / 8 / 12 座容量扩展（最初版本）

- 房间可选 4 / 8 / 12 座（`ROOM_CAPACITIES`），对局按**实际入座人数**生成；空位不补 AI，观战席最多 2 个且不占席位。
- 随人数缩放：共享干员池与装备库存（`seatScale`）、领袖血池上限（`MAX_SEATS`）、隐藏核心层数门槛（≤4→1200、5–8→1800、9–12→3600）、
  机变发牌页数（每 6 名选卡者一页 + 2 张备用）。
- 交付方式一开始就选定**叠加层**：官方更新包会按 `MANIFEST.json` 逐文件校验，直接改安装与“能正常更新”互斥；
  叠加层用 Node 模块钩子覆盖服务端文件、用联合目录覆盖客户端文件，安装保持原样。
- 上游与本插件的关系、20 人实现的参考仓库、素材来源，见仓库根 [RELATED-REPOS.md](../../RELATED-REPOS.md)。
