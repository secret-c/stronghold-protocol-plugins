# sp-mp 开发指南（给下一位 agent / 维护者）

这是一份**交接文档**：结构、约定、宿主接口、以及我们踩过的坑。动手前请把「铁律」和「已知坑」两节读完，它们每一条都是真实翻车换来的。

---

## 1. 这是什么

`sp-mp` 是《卫戍协议：盟约》网页复刻（[上游 sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)）的**叠加层插件**：

| 功能 | 说明 |
| --- | --- |
| 多人容量 | 同盟房间 4 / 8 / 12 座；共享卡池、装备库存、机变页数、隐藏核心层数门槛随**实际参战人数**缩放；4 人及以下与原版逐字节等价 |
| 联防优先真人 | `unite.js helperOrder`：真人整体排在 AI 席位之前，各自内部保持官方择优顺序 |
| 伤害统计面板 | 纯客户端：左下角 📊（全屏按钮左侧），实时列出自己场上干员的伤害/占比/类型/击杀/承伤 |

## 2. 目录结构与数据流

```
<安装目录>/
├─ sp-mp/                         ← 插件本体（本仓库）
│  ├─ plugin.json                 ← 版本、支持的上游版本（supports）、文件清单
│  ├─ hooks.mjs                   ← Node 模块解析钩子：server/ 与 shared/ 的覆盖
│  ├─ start.mjs / start-windows.cmd / start.sh   ← 启动器（注册钩子 + 把 publicDir/sharedDir 指向联合目录）
│  ├─ client/                     ← 插件的客户端模块（源头）
│  │  ├─ entry.js                 ← 被叠加层 index.html 引导
│  │  ├─ client.js                ← 面板本体（DOM + 取数 + 累计）
│  │  └─ client.css               ← 面板样式（全 sp-mp- 前缀）
│  ├─ files/                      ← 覆盖安装的文件（服务端 12 个 + 客户端 16 个 + index.html 注入版）
│  ├─ base/                       ← 上面这些文件在**上游对应版本**里的原样副本（rebase 的三方合并基准）
│  ├─ public/、shared/            ← **生成的**联合目录（不要手改、不要提交）
│  ├─ tools/
│  │  ├─ assemble.mjs             ← 生成 files/ 与 base/：按**内容差异**自动判定覆盖哪些文件 + 注入 index.html + 路由 client/
│  │  ├─ build-tree.mjs           ← 生成联合目录（未改的文件复制/联结点到安装，改过的用叠加层版本）
│  │  ├─ rebase.mjs               ← 上游更新后的三方合并（base=旧上游 / ours=我们的改动 / theirs=新安装）
│  │  └─ install-patch.mjs/.cmd   ← 可选：把覆盖文件直接打进安装（会破坏 MANIFEST，官方更新包必须先 revert）
│  └─ sp-4-12-16/                 ← 开发树（普通 git 仓库；基线提交 = 上游某个版本，功能提交 = 容量扩展）
└─ server/ shared/ public/ …      ← 安装（**一个字节都不要改**）
```

数据流（三层，缺一不可）：

```
开发树 sp-4-12-16/  ──assemble──▶  sp-mp/files/  ──build-tree──▶  sp-mp/public/ (联合目录)  ──start.mjs──▶  浏览器
                            │                      │
                            └──── base/（=安装原样）┘        hooks.mjs ──▶ 服务端 server/·shared/ 的覆盖
```

## 3. 铁律

1. **不改安装里的任何文件**。`sp-mp/files/` 里放的是“加载时顶替”的副本，安装目录必须保持与 `MANIFEST.json` 一致（`node tools/doctor.mjs` 要报“全部一致”）。这是官方更新包还能用的前提。
2. **客户端功能优先做进 `sp-mp/client/`**，不要去覆盖宿主的 `public/js/**`。新增宿主没有的文件由联合目录提供，不影响 MANIFEST；而覆盖宿主文件会让 rebase 冲突面变大、也更容易把宿主改坏。
3. **只用宿主已经公开的入口**（见 §4）。不要 import 宿主的内部模块——宿主内部结构一变，你的模块会在**解析阶段**就整条链失败（见坑 #1）。
4. **`files/`、`base/`、`public/`、`shared/` 都是生成物**：改代码请改开发树或 `client/`，然后重新 assemble；不要手改生成物。
5. **改完必须验证**（§7 的命令），并至少跑一遍插件的客户端回归测试。
6. **提交信息**写清“做了什么 / 为什么 / 出处”，不要加 AI 署名 trailer；仓库非商业、不带任何官方素材。

## 4. 可用的宿主接口（只读）

服务端（通过 `hooks.mjs` 覆盖的文件里可以直接用，等于宿主内部）：

- `shared/constants.js` 的常量、`GameData`（`gamedata.js`）、`Match` / `MatchSpDraft` / `PlayerState` 的方法。

客户端（**插件唯一应该依赖的东西**，都由宿主自己挂在全局）：

| 入口 | 内容 |
| --- | --- |
| `window.__SP__` | `{ store, net, data }`（`public/js/main.js` 挂）。`net.playerId` = 自己的 playerId |
| `window.__SP_RUNNER__` | 战斗 runner（`public/js/battle/runner.js` 挂）。只读查询：`currentBattle()` → `{battleId, fieldId, kind, spec, time}`；`ownerOps(ownerId, fieldId)` → 自己的干员 `[{kind:'op', ownerId, defId, uid, items?}]`；`unitIdOf(uid, ownerId, fieldId)` → 该干员在当前战斗里的单位 id；`unitStats(unitId, fieldId)` → 实时数值（`unitStatsEntry`：hp/maxHp/atk/def/res/interval/blockCnt/moveSpeed/range/dir，**不含战斗统计**） |
| `data.js`（经 `__SP__.data`） | `lookup('chess', id)` → 干员记录（含 `name`、`dmgType`、`skills`、`talents`、`trait`）；`get('assets')` → 资源清单（头像） |
| DOM 钩子 | `.gm__corner`（左下角按钮排）、`.gm__fs`（全屏按钮）、`.gm__gear`（按钮样式类） |

**没有得到的东西**：宿主不暴露“按伤害类型统计的伤害量”“每单位击杀/治疗”。所以要类型构成只能从干员记录推（见 `client.js typeOf()`）；要精确分类需要改宿主 `unitStatsEntry`，那违反铁律 1，除非维护者另行决定。

## 5. 构建与发布

```bash
# 1) 改代码：服务端/共享改动在开发树 sp-4-12-16/ 里改；纯客户端改动在 sp-mp/client/ 里改
# 2) 重新生成叠加层（自动：按内容差异算覆盖清单、注入 index.html、路由 client/）
node sp-mp/tools/assemble.mjs            # 加 --list 只看清单
node sp-mp/tools/build-tree.mjs          # 重建联合目录
# 3) 验证（见下）
# 4) 提交并推送（本机到 github.com 直连不稳，push 要重试）
```

上游发新版之后：

```bash
node sp-mp/tools/rebase.mjs --dry-run    # 先看官方改了哪些被覆盖的文件
node sp-mp/tools/rebase.mjs              # 三方合并；冲突留在 files/ 里带 <<<<<<< 标记
node sp-mp/tools/build-tree.mjs
# 顺手把 plugin.json 的 supports/base 更新（无冲突时 rebase 会自动写）
```

## 6. 已知坑（每条都真踩过）

1. **ESM 具名导出错误 = 整条模块链挂掉**。`import { GIcon } from './components.js'`（实际在 `gameComponents.js`）会让 `main.js → game.js → 你的模块` 在解析阶段全部失败，页面显示「游戏脚本加载失败」。**只查 HTTP 200 查不出来**：必须用真正的 ESM 加载器验证（见 §7）。提交前请对每个新模块跑一次。
2. **`assemble.mjs` 的覆盖清单已改为按内容差异自动判定**。历史上它是手工清单，`unite.js` 漏在里面导致“改了服务端却没生效”。**不要**再引入手工清单；新目录（如 `client/`）要显式加进 `walkClient()` 或路由逻辑。
3. **服务端只服务安装目录与联合目录**：插件的客户端文件必须**路由**进 `public/`（`assemble.mjs` 已把 `client/` 复制到 `public/sp-mp/client/`），否则 `/sp-mp/client/xxx.js` 是 404。
4. **`statView()` 只返回属性**（maxHp/atk/def/res/interval/blockCnt/moveSpeed），没有 `dmg`。伤害要靠客户端累计 HP 减少量；口径按宿主定义「只统计从对方身上移除的生命值」，护盾吸收不算。
5. **Windows 上的 PowerShell 5.1 会把无 BOM 的 UTF-8 当 ANSI 读**：脚本里有中文时语法会崩（报错却指向奇怪的位置）。给 `powershell.exe -File` 用的脚本要么纯 ASCII，要么写 BOM。
6. **`cmd.exe /c` 或任何“带管道 spawn 子进程”的写法在本机沙箱里可能报 `couldn't create signal pipe` / `EPERM`**：读 git 凭据请用 PowerShell 自己的管道（`$cred | git credential fill`），不要经过 `cmd.exe`。
7. **到 github.com 的直连不稳定**：`git push` 会随机 `Recv failure: Connection was reset` / 443 超时。**重试 10 次左右通常能过**；只有 fetch/clone 可以借 `https://ghproxy.net/<原 URL>`，它的 `git-receive-pack`（push）返回 401，不能用于推送。
8. **不要用 `robocopy /MIR` 同步插件目录**（会删掉仓库侧独有的文件），用 Node 的 `fs.cpSync` 或逐文件复制。
9. **i18n**：插件客户端的字符串现在**自带**在 `client.js`（不走宿主 `t()`），所以不会触发宿主的 i18n 检查；如果哪天要跟随宿主语言，用 `__SP__.store`/`data` 里的语言设置自己映射。
10. **`sp-mp/README.md` 是给玩家看的说明**，本文件是给开发者的；两边的文件数/版本号要保持一致（`plugin.json` 的 `files`/`publicFiles`/`clientFiles`）。

## 7. 验证清单（改完必跑）

```bash
# 0) 安装仍是原版（不变量）
cd <安装目录> && node tools/doctor.mjs           # 期望「6480 个文件与 v0.2.6 一致」

# 1) 叠加层与安装同步
node sp-mp/tools/rebase.mjs --dry-run            # 期望「upstream did not touch: 28」（数字 = base 里的文件数）

# 2) 客户端模块能被真正的 ESM 加载器加载（坑 #1 的守门）
node -e "const {pathToFileURL}=await import('node:url');
  for (const p of ['/sp-mp/client/client.js','/sp-mp/client/entry.js'])
    await import(pathToFileURL('E:/code/wsl_dsh/wei/Stronghold-Protocol'+p).href);
  console.log('ok')" --input-type=module

# 3) 客户端逻辑回归（Node + 最小 DOM 桩）：按钮插入、playerId 解析、伤害累计、护盾口径、换场清空、类型构成
node sp-mp/tools/test-client.mjs                 # 若放在仓库里；否则用开发机上的同一份脚本

# 4) 起服并确认首页引导与静态路由
node sp-mp/start.mjs                             # 首行应打印 overlay files / client files 数
#  浏览器硬刷新后：左下角出现 📊；面板打开不报错
```

## 8. 当前状态与待办

- 版本 `1.2.0`，基线上游 `v0.2.6`；覆盖 28 个文件（含注入版 `index.html`）+ 3 个自持客户端文件。
- 已完成：4/8/12 容量、联防优先真人、伤害统计面板（含类型标签与类型构成）。
- 待办 / 可做：
  - 面板的“治疗/击杀/承伤”目前只在宿主提供时才显示（`unitStatsEntry` 不带时显示 `—`）；想要精确数值需要宿主侧扩展（需维护者拍板）。
  - 伤害类型目前是**按干员主攻击类型**推断；精确到“每次伤害的类型占比”同样需要宿主扩展。
  - 可以把 `test-client.mjs` 收进 `tools/`，并在 `plugin.json` 里挂一个 `verify` 脚本。
  - 12 人房的伤害面板顺序可以按“当前伤害速率”而非累计值排序（需要记录时间窗口）。
