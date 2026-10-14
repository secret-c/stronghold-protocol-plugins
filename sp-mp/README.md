# sp-mp · 多人容量叠加层（4 / 8 / 12 人房间）

给《卫戍协议：盟约》0.2.4 加**4 / 8 / 12 人同盟房间**，但**一个安装文件都不改**——所以官方更新包照常可用，`npm run doctor` 永远显示安装干净。

## 为什么这样做

游戏的官方更新包（`Stronghold-Protocol-v0.2.x-update.zip`）在启动时会用新版 `MANIFEST.json` 逐文件校验安装：**任何被改过的程序文件都会让服务器拒绝启动**。所以"直接改安装"和"主线正常更新"是互斥的。

叠加层的做法：

- 功能代码放在 `sp-mp/files/`，通过 Node 的模块钩子（`hooks.mjs`）在**加载时**顶替安装里同名的 14 个服务端文件（`server/` + `shared/`）；
- 客户端那 17 个文件通过把服务器的 `publicDir` / `sharedDir` 指向 `sp-mp/public`、`sp-mp/shared`（联合目录：未改的文件复制/联接到安装，改过的用叠加层版本）来交付；**叠加层新加的客户端模块（安装目录里没有的文件）也由联合目录提供**；
- 安装目录里的 28 个文件仍然是原始字节，官方更新包直接覆盖它们即可。

实测：加载叠加层后，安装的 `node tools/doctor.mjs` 依然报「**6480 个文件与 v0.2.6 一致**」。

## 使用

两种用法，安装目录都不用"改造"：

**做法 A（推荐，零改动）**——换一个启动器即可，`scripts\start-windows.bat` 仍是原版 4 人：

```bat
:: Windows：双击，或
node sp-mp\start.mjs                 :: 默认 3000 端口
node sp-mp\start.mjs --port 3001     :: 换端口
node sp-mp\start.mjs --no-open       :: 不自动开浏览器
```

```bash
# macOS / Linux
node sp-mp/start.mjs
```

**做法 B（让"普通启动"也变多人）**——把叠加层那 28 个文件复制进安装：

```bat
sp-mp\tools\install-patch.cmd        :: 菜单：1 打进安装 / 2 还原 / 3 查看状态
node sp-mp\tools\install-patch.mjs apply|revert|status
```

之后 `scripts\start-windows.bat`、`npm start`、开机自启的服务都直接是 4 / 8 / 12 人版。
**代价**：安装不再与 `MANIFEST.json` 一致（`npm run doctor` 会报那 28 个文件），**官方更新包必须先 `revert` 才能启动**——这正是做法 A 想避免的事。备份在 `sp-mp/install-backup/`。

> 注意：`sp-mp\*.cmd` 与 `sp-mp\tools\*.cmd` **必须是 CRLF 换行**。cmd.exe 解析批处理要求 CRLF；LF 换行叠加中文和 `chcp 65001` 会让它把行拆碎，报一串"不是内部或外部命令"。编辑后转换一次：
> `node -e "const fs=require('fs');for(const f of ['sp-mp/start-windows.cmd','sp-mp/tools/install-patch.cmd'])fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"`

环境变量：`PORT` / `HOST`（同官方）、`SP_MP_NO_BROWSER=1`（不开浏览器）、`SP_MP_FORCE=1`（版本不匹配时仍强行启动）。

启动日志会先打印一行 `[sp-mp] … 28 overlay files …`，随后是官方那套横幅（v0.2.4 + 局域网地址）。

## 玩法（叠加层带来的差异）

| | 4 人房 | 8 人房 | 12 人房 |
| --- | --- | --- | --- |
| 共享干员卡池 / 装备库存 | 原版 | ×2 | ×3 |
| 领袖血池（最终攻势/隐秘核心） | ×存活人数 | ×8 | ×12 |
| 隐秘核心层数门槛 | 1200 | 1800 | 3600 |
| 机变公共选卡 | 6 张 | 12 张 | 18 张 |

- 大厅「创建同盟」里选 **同盟席位**；开房后房主可在等待室改（不能低于已占用的最高席位，不会把人挤出去）。
- **对局按实际入座人数生成**：4 个人进 12 人房就是原来的 4 人游戏；空位不会自动补 AI，想凑人数用「添加 AI 队友」。
- **装备库存**：效果**生成**的装备（梓兰的〈寻呼模块〉、马克维茨的〈商业包装方案〉、变形者集群的〈变形同构体〉等）**不占**共享装备库存——人数再多也不会因为库存被买空而拿不到；从库存里拿的装备（商店、机变卡、战术决策、奖励）照旧占用。这条规则**不分人数**，4 人房里也一样生效。
- 观战席仍是最多 2 个，不占席位、不计人数。
- ≤4 人的**容量规则**、数值、golden 结果与原版逐位相同（上面那条装备库存规则除外，它不随人数变化）。

## 伤害统计面板（本叠加层自带）

战斗界面左下角那排按钮里多了一个 📊（在全屏按钮左边），点开是**本场战斗的实时伤害统计**：按伤害排序列出你自己场上的干员，带伤害占比条与击杀数，鼠标悬停还能看到每人的承伤与治疗，顶部合计总伤害 / 击杀 / 治疗 / 承伤。

- 数据完全来自**本机运行的这一场战斗**（每个浏览器模拟自己的战场），不占服务器流量、不加协议字段；
- 只统计**你自己的干员**（队友的战场在他们自己的浏览器里跑）；战斗暂停或尚未开打时显示一行提示，而不是冻结的数字；
- 打开时每 250 ms 刷新一次，与详情卡读取实时数值的频率一致；
- 叠加层通过 `files/public/js/ui/damagePanel.js`（安装目录里没有的新模块，由联合目录提供）与 `files/public/js/screens/game.js`、`files/public/css/screens/game.css`、`files/public/js/battle/runner.js` 交付。

## 官方更新之后（重要）

更新包正常用（双击 `scripts\start-windows.bat` 让它在启动时自动完成校验，或手动解压覆盖）。更新完**先别直接用叠加层**——它认的是旧版本：

```bash
node sp-mp/tools/rebase.mjs --dry-run   # 先看：更新改了叠加层覆盖的哪些文件
node sp-mp/tools/rebase.mjs             # 三方合并（base=旧上游 / ours=我们的改动 / theirs=新安装）
                                        # 冲突会留在 sp-mp/files/… 里带 <<<<<<< 标记，原文件备份为 *.pre-rebase
node sp-mp/tools/build-tree.mjs         # 合并完成后重建客户端联合目录
```

`rebase.mjs` 只写 `sp-mp/` 内的文件；合并无冲突时会自动把 `plugin.json` 的 `supports` 记上新版本。

版本守卫：安装版本不在 `plugin.json.supports` 里时，`start.mjs` **拒绝启动**并提示先 rebase（要强行启动就 `SP_MP_FORCE=1`）。

## 目录说明

| 路径 | 内容 |
| --- | --- |
| `files/` | 叠加层本体：12 个 `server/`+`shared/` 模块 + 16 个 `public/` 客户端文件 |
| `base/` | 这 28 个文件在**上游 0.2.4** 里的原始版本（rebase 的 base） |
| `public/`、`shared/` | 联合目录（未改文件复制、大目录如 `assets/` 用 junction 指向安装），只给服务器读取 |
| `hooks.mjs` | 模块解析钩子：安装路径 ↔ 叠加层路径 |
| `start.mjs` | 启动器（版本守卫 + 注册钩子 + 用联合目录启动安装的服务器） |
| `tools/assemble.mjs` | 从开发树 `sp-4-12-16/` 重新生成 `files/` 与 `base/`（**按内容差异自动判定该覆盖哪些文件**，不再是手工清单；`--list` 只打印清单） |
| `tools/build-tree.mjs` | 重建 `public/`、`shared/` 联合目录 |
| `tools/rebase.mjs` | 官方更新后的三方合并 |
| `tools/install-patch.mjs` + `install-patch.cmd` | 做法 B：把 28 个文件打进安装 / 一键还原（备份在 `install-backup/`） |

开发树（含完整测试套件与 golden 基准）在相邻的 `sp-4-12-16/`，那边是普通的 git 仓库：基线提交 = 上游 v0.2.4，功能提交 = 4/8/12 容量。改完在开发树跑测试，再用 `tools/assemble.mjs` 把改动同步进叠加层。

## 边界与限制

- 叠加层**绑定上游释放版本**：官方改动叠加层覆盖的那 28 个文件中的任何一个，都需要跑一次 `rebase.mjs`（工具会告诉你改了哪些、并自动合并）。
- 它不含文档/测试/打包元数据（那些不影响运行）；开发树里才有。
- 叠加层的 14 个服务端文件（`server/` + `shared/`）走 Node 模块钩子加载，需要 **Node ≥ 22.15**（本机 24.15 可用；更老的 Node 会退回 `module.register()` 异步加载线程，同样可用）。
- 12 人是本叠加层验证过的上限；想开更多人数要改 `files/shared/constants.js` 的 `ROOM_CAPACITIES` 与 `MAX_SEATS`，并在开发树重跑测试。
