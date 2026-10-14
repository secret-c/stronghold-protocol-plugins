# 卫戍协议：盟约 · 网页版插件包（Stronghold Protocol: Alliance — web plug-ins）

给[《卫戍协议：盟约》网页复刻](https://github.com/sganggs/Stronghold-Protocol)做的**插件包合集**。每个插件都是**叠加层（overlay）**：功能代码放在插件自己的目录里，通过 Node 的模块钩子与联合目录在**运行时**顶替安装里同名的文件 —— 所以**安装目录保持原样**，官方更新包照常能用。

当前收录：

| 插件 | 作用 | 基线 |
| --- | --- | --- |
| [`sp-mp/`](sp-mp/) | 多人容量叠加层：**4 / 8 / 12 人同盟房间**（共享卡池与装备库存随人数缩放、领袖血池按人数、机变分页、隐藏核心层数门槛分档等） | 上游 **v0.2.6** |

相关仓库（上游主仓库、20 人实现的参考仓库、素材来源）见 **[RELATED-REPOS.md](RELATED-REPOS.md)**。

## 前置条件

1. 一份**官方安装**（整合包解压出来即可）或源码目录，版本需与 `sp-mp/plugin.json` 的 `supports` 一致（当前 `0.2.6`）。
2. **Node.js ≥ 22.15**（本机验证 24.x；更老的 Node 会退回 `module.register()` 异步加载线程，同样可用）。
3. 插件目录放进安装根目录下，例如：

```
<安装目录>/
├─ server/  shared/  public/  data/ …      ← 官方文件，插件不改动它们
└─ sp-mp/                                  ← 本仓库的插件目录
```

## 用法

```bat
:: 做法 A（推荐，零改动）：换一个启动器，原版仍是原版
node sp-mp\start.mjs                 :: 默认 3000 端口
node sp-mp\start.mjs --port 3001     :: 换端口
node sp-mp\start.mjs --no-open       :: 不自动开浏览器
```

```bat
:: 做法 B（让"普通启动"也变多人）：把叠加层的 32 个文件复制进安装
sp-mp\tools\install-patch.cmd        :: 菜单：1 打进安装 / 2 还原 / 3 查看状态
```

做法 B 的代价：安装不再与 `MANIFEST.json` 一致（`npm run doctor` 会报那 32 个文件），**官方更新包必须先还原（`revert`）才能启动** —— 这正是做法 A 想避免的事。备份在 `sp-mp/install-backup/`。

启动日志会先打印一行 `[sp-mp] … 32 overlay files …`，随后是官方那套横幅（版本号 + 局域网地址）。

## 仓库里有什么 / 没有什么

| | 内容 |
| --- | --- |
| ✅ 收录 | [`sp-mp/`](sp-mp/)：`files/`（叠加层本体，32 个运行时文件）、`base/`（这 29 个文件在基线版本里的原始副本，rebase 用）、`hooks.mjs`、`start*.mjs`、`plugin.json`、`tools/`（assemble / build-tree / rebase / install-patch） |
| ❌ 不收录 | 官方源码与美术素材（版权归上海鹰角网络 / Yostar，且本插件一个都不需要）；`public/`、`shared/` 这两个**联合目录**是本地生成的（见下）；`install-backup/`、`*.pre-rebase` 等本机状态 |
| 📄 许可 | 插件代码与上游一致：**GPL-3.0-or-later**；不含任何官方素材 |

## 插件是怎么做到「不改安装」的

- **服务端 14 个文件**（`files/server/**`、`files/shared/**`）：`hooks.mjs` 是一个 Node **模块解析钩子**，服务器加载 `server/…` 或 `shared/…` 时被重定向到叠加层里的同名文件。
- **客户端 16 个文件**（`files/public/**`）：把服务器的 `publicDir` / `sharedDir` 指向 `public/`、`shared/` 两个**联合目录** —— 未修改的文件从安装复制（大目录如 `assets/` 用 junction 指过去），被修改的用叠加层版本。这两个目录由 `tools/build-tree.mjs` 生成，**不在本仓库里**。
- **版本守卫**：安装版本不在 `plugin.json.supports` 里时 `start.mjs` 拒绝启动并提示先 rebase；确有需要可 `SP_MP_FORCE=1` 强行启动。

## 官方更新之后（重要）

```bash
node sp-mp/tools/rebase.mjs --dry-run   # 先看：这次更新改了叠加层覆盖的哪些文件
node sp-mp/tools/rebase.mjs             # 三方合并（base=旧上游 / ours=我们的改动 / theirs=新安装）
                                        # 冲突留在 sp-mp/files/… 里带 <<<<<<< 标记，原文件备份为 *.pre-rebase
node sp-mp/tools/build-tree.mjs         # 合并完成后重建客户端联合目录
```

`rebase.mjs` 只写 `sp-mp/` 内的文件；无冲突时会自动把新版本记进 `plugin.json.supports`。细节见 [`sp-mp/README.md`](sp-mp/README.md)。

## 开发

插件包是**生成物**，真正的源码在同作者的开发树里（基线提交 = 上游对应版本，功能提交 = 容量扩展）。改完在开发树跑测试，再同步进叠加层：

```bash
node sp-mp/tools/assemble.mjs     # 从开发树重新生成 files/，并从安装目录刷新 base/
node sp-mp/tools/build-tree.mjs   # 重建客户端联合目录
```

`assemble.mjs` 默认在安装目录下找 `sp-4-12-16/` 这个开发树；没有开发树也能工作（`files/` 与 `base/` 会保持原样）。

## 边界与限制

- 叠加层**绑定上游释放版本**：官方改动它覆盖的 32 个文件中的任何一个，都需要跑一次 `rebase.mjs`。
- 它是**本地扩展**，不是官方玩法：官方房间是 1–4 人。把它当同人插件用，不要当成官方支持。
- 无广告、无付费、无任何形式的盈利（与上游一致）。
