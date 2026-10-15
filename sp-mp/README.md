# 卫戍协议：盟约 · 多人扩充版

这是 sp-mp 1.6.1 插件，适配游戏本体 0.2.6。独立插件发布在 [secret-c/stronghold-protocol-plugins](https://github.com/secret-c/stronghold-protocol-plugins)：先准备原版 0.2.6 和 Node.js ≥ 22.15，把仓库里的 `sp-mp/` 文件夹复制到游戏根目录，再双击 `sp-mp/start-windows.cmd`（或运行 `node sp-mp/start.mjs`）。发布包已包含 `files/` 与 `client/`，玩家无需运行 assemble；首次启动自动生成浏览器联合目录。插件不包含游戏本体、素材和依赖。

若拿到含游戏与便携 Node 的完整版本目录，Windows 用户双击最外层的 **`启动游戏.cmd`**。请保留启动窗口，结束游戏时按 Ctrl+C 或关闭窗口。同一房间的朋友只需要浏览器。这个非官方同人项目仅供非商业使用。

扩充版支持 4 / 8 / 12 人房间、房间聊天、伤害与最近一局统计、卡池查看，以及个人商店盟约设置。悬赏选择的第 7 张及之后的候选现在也能提交。开局本局信息阶段可只选择一个偏好盟约，不必同时禁用；偏好仅使本人普通商店中命中羁绊的干员在同阶抽取权重 ×2。也可以只选禁用、同时选两个不同盟约，或整体跳过。确认后本局固定。个人禁用只排除本人普通商店候选，不删共享卡池；全局禁用的干员则不进入共享卡池。卡池面板将两者分别标记。

## 开发与导出

项目根目录是唯一日常编辑源。修改 `server/`、`shared/`、`public/`、`docs/`、`test/` 等本体文件，以及 `sp-mp/client/` 的插件界面。`sp-mp/files/`、`sp-mp/public/`、`sp-mp/shared/`、`sp-mp/sim/` 是发行/运行生成物，不手动修改；根目录的 `public/index.html` 保持未注入插件标签。

在根目录执行 `node sp-mp/tools/assemble.mjs`，再执行 `node sp-mp/tools/build-tree.mjs`。前者用原版 `MANIFEST.json` 和 `sp-mp/base/` 识别并生成覆盖文件，后者建立浏览器联合目录。根目录双击入口会走扩充版启动器；直接运行普通 `npm start` 不会启用插件规则。

发行时运行 `node sp-mp/tools/export-version.mjs`，在 `dist/` 新建一个**未压缩的完整版本目录**（本体源码、插件、素材、生产依赖、便携 Node 与许可）。脚本拒绝覆盖任何已有版本，不会清理玩家已解压或正在运行的目录。版本目录中的顶层 `启动游戏.cmd` 可直接双击。详细规则、测试与升级说明见 [DEVELOPMENT.md](DEVELOPMENT.md)。

本体源码仍保留原 0.2.6 的 `MANIFEST.json` 作为扩充层差异基线，因此 `doctor` 会看到有意修改的源码；扩充版应由上述入口启动，不要把原版更新包直接覆盖这些文件。游戏素材属于原权利人，版权和第三方许可见根目录的 `NOTICE.md`、`THIRD-PARTY-NOTICES.md`。
