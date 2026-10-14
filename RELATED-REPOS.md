# 相关仓库与出处（Related repositories）

本插件包的实现、基线与参考都来自下面这些仓库。写代码或提 issue 前，请先确认你改的是哪一层。

## 直接相关

| 仓库 | 角色 | 说明 |
| --- | --- | --- |
| [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) | **上游主仓库（基线）** | 《明日方舟》「卫戍协议：盟约」的非官方同人网页复刻（浏览器自走棋塔防，官方玩法 1–4 人联机）。插件包的 `base/` 就是它的发布版本：当前 **v0.2.6**（2026-10-13）。它同时是[本插件包](https://github.com/secret-c/stronghold-protocol-plugins)所依附的宿主程序——插件不改它一个字节。 |
| [LongQianChen/Stronghold-Protocol](https://github.com/LongQianChen/Stronghold-Protocol) | **20 人实现的参考仓库** | 同名 fork（上游的镜像 fork）。它的 `feat/IncreasePlayerCapacity` 分支做了 **4 / 8 / 10 / 16 / 20 人**房间与「固定卡池分组、各组并行轮选」的完整方案，自带 `docs/PLAYER_CAPACITY.md` 与 30+ 份开发记录，是本插件 4 / 8 / 12 人实现的重要参考。阅读入口：分支里的 `docs/PLAYER_CAPACITY.md`、`docs/development/DECISIONS.md`（D001–D030）。 |
| [secret-c/stronghold-protocol-plugins](https://github.com/secret-c/stronghold-protocol-plugins) | **本仓库** | 插件包合集，当前收录 `sp-mp`（多人容量叠加层）。 |

## 上游的素材与数据来源（上游文档里列出的第三方仓库）

插件本身**不需要**这些，只有在你重新构建上游的 `data/`、美术或验证数值时才用到；上游 README 与 `NOTICE.md` 列了完整清单，常用的几个：

| 仓库 | 用途 |
| --- | --- |
| [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) | 官方数据表镜像（`excel/activity_table.json` 等），`tools/build-data.mjs` 的默认来源 |
| [yuanqian3060/ArknightsGameResource](https://github.com/yuanqian3060/ArknightsGameResource) | 美术 / 音频 / Spine 模型素材源 |
| [fexli/ArknightsResource](https://github.com/fexli/ArknightsResource) | 备用素材源 |
| [isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models) | 3D 模型素材源 |
| [ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2) | 素材源 |
| [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) | 界面字体 |
| [isHarryh/Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker) | AB 包解包（LZ4AK / BCD-3-Clause 算法），`tools/local-extract/` 用到 |
| [K0lb3/UnityPy](https://github.com/K0lb3/UnityPy) | Unity 资源读取（本地客户端提取） |
| [PRTS 明日方舟中文 Wiki](https://prts.wiki/) | 规则与数值的权威参考，上游把官方表查不到的地方都对着它核 |

## 版本别搞混

- **上游主仓库的版本**（`v0.2.6`、`v0.2.5` …）是**官方玩法的复刻版本**，也是本插件 rebase 的基线：`sp-mp/plugin.json` 的 `supports` 字段决定插件能挂在哪个版本上。
- **本插件包的版本**（`plugin.json` 的 `version`）与叠加层编号（`sp-mp/files/` 的 28 个文件）是插件自己的事，与上游版本号无关。
- 上游更新后必须重跑 `sp-mp/tools/rebase.mjs`，见根 [README](README.md) 与 [sp-mp/README.md](sp-mp/README.md)。
