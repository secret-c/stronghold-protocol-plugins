# 卫戍协议：盟约 · 网页版插件包

为 [游戏本体](https://github.com/sganggs/Stronghold-Protocol) 提供非商业插件。本仓库是 [secret-c/stronghold-protocol-plugins](https://github.com/secret-c/stronghold-protocol-plugins)，上游地址仅用于取得游戏基线。

当前 **sp-mp 1.6.1**，适配游戏 **0.2.6**：4 / 8 / 12 人房间、同盟聊天、伤害与最近一局统计、卡池查看、个人商店禁用与偏好盟约。支持只选偏好或只选禁用；修复大房间第七张及之后悬赏候选的提交限制，并保留房间容量协议。

## 安装与启动

1. 准备原版游戏 0.2.6 和 Node.js ≥ 22.15。插件仓库不包含游戏本体、美术素材或运行依赖。
2. 下载本仓库，将其中的 **`sp-mp/` 文件夹**复制到游戏根目录，与 `server/`、`shared/`、`public/`、`data/` 并列。
3. Windows 双击 `sp-mp/start-windows.cmd`；其他系统运行 `node sp-mp/start.mjs`。端口冲突可加 `--port 3001`。

发布目录已经包含 52 个覆盖文件及三个客户端文件，**无需运行 assemble**。首次启动会自动生成浏览器联合目录。请保留启动窗口；更新插件后重启服务并在浏览器硬刷新。同一房间的朋友只需浏览器。

推荐启动器在运行时叠加插件，保留原版安装文件。`tools/install-patch.mjs` 的直接安装方式会修改安装，官方更新前必须先 `revert`；详见 [sp-mp/DEVELOPMENT.md](sp-mp/DEVELOPMENT.md)。

## 仓库布局与开发

`sp-mp/` 是标准插件目录。顶层 `base/`、`files/`、`client/`、工具和启动器是早期布局的兼容副本，与 `sp-mp/` 同步相同版本；也可将这一整套目录作为 `sp-mp` 安装，但不要套入重复层级。

`files/` 是发行所需覆盖文件，`base/` 保存原版对照，`client/` 是插件界面源码。两种布局均不提交 `public/`、`shared/`、`sim/` 联合目录、本机状态、截图、素材或依赖。

完整游戏项目根目录是唯一日常开发源。修改本体源码和 `sp-mp/client/`，在完整项目根执行 `node sp-mp/tools/assemble.mjs`，验证后再同步到本仓库。纯插件 checkout 不运行 assemble 或完整游戏导出工具；它们需要完整游戏源码和 MANIFEST。不要把游戏仓库的不同提交历史覆盖到本仓库 main。

相关仓库与素材出处保留在 [RELATED-REPOS.md](RELATED-REPOS.md)；插件说明与版本记录见 [sp-mp/README.md](sp-mp/README.md) 和 [sp-mp/docs/DEVLOG.md](sp-mp/docs/DEVLOG.md)。代码使用 GPL-3.0-or-later，游戏素材版权属于原权利人。本项目无广告、无收费、无盈利。
