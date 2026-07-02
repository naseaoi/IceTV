# 代码评审报告（2026-07）

全库评审：架构 / 性能 / 安全 / 工程质量四个维度，覆盖 src/ 332 个文件、约 59,600 行、47 个 API route。测试结论来自实际运行 jest。

## 总体结论

| 维度     | 评分   | 一句话                                                              |
| -------- | ------ | ------------------------------------------------------------------- |
| 架构     | 6/10   | feature 横向隔离执行到位，但 lib 成第二个"全部"层，多处依赖箭头倒置 |
| 性能     | 7/10   | 缓存/流式/节流大都做对，三个真实热路径有硬伤                        |
| 安全     | 7.5/10 | guard 全覆盖、SSRF 防护成体系，签名密钥设计是主要缺陷               |
| 工程质量 | 6/10   | 类型纪律优秀，但 CI 不跑测试、主干测试是红的                        |

综合约 6.5/10。底子好（类型纪律、鉴权模板化、双存储一致性工程），但有 4 个 P0 实锤问题和一批系统性技术债。

---

## P0：立即修复

> 进度口径：P0 状态直接维护在本文档中；若单项修复需要长篇迁移方案或回滚说明，再新建专项文档并从完成记录链接。

| 编号 | 状态   | 验收标准                                                       | 完成记录                                                                                                                                                                                                                                                          |
| ---- | ------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | 已完成 | CI 跑通 test、typecheck、lint:strict；本地失败用例修红         | 2026-07-02：新增 `quality.yml`；修复 admin 图标按钮测试；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand`                                                                                                               |
| P0-2 | 已完成 | Docker cron 请求携带 Bearer token；部署文档说明 `CRON_SECRET`  | 2026-07-02：`start.js` 调用 `/api/cron` 时附带 Bearer token；README 补充 Docker 示例与环境变量；通过 `node --check start.js`                                                                                                                                      |
| P0-3 | 已完成 | 会话与代理签名不再直接使用站长密码；兼容迁移路径明确           | 2026-07-02：新增 `AUTH_SECRET` 签名密钥；会话校验允许旧 cookie 迁移；代理签名仅接受新密钥；README 补部署变量；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand`                                                          |
| P0-4 | 已完成 | 用户以 DB 为唯一真相源；注册严格 insert；config 写入有并发保护 | 2026-07-02：`UserConfig.Users` 由 DB 用户表重建并保留元数据；SQLite/MySQL 注册改为严格 insert；管理员新增先查 DB；配置保存加入乐观锁；新增路由/SQLite/config 回归测试；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand` |

### 1. CI 无质量门禁，主干测试是红的

- `.github/workflows/` 只有 docker-image 和 release 两条流水线，无 test / lint / typecheck；git hooks 只跑 lint-staged。
- 实跑 `npx jest`：2 个用例稳定失败。`src/app/admin/page.test.tsx:177` 用 `getByText('重置配置')` 等元素，而 `page.tsx:119` 中该字符串只存在于 `title`/`aria-label` 属性——组件改了、测试烂在主干无人发现。
- 修复：CI 增加 test + typecheck + lint:strict 门禁；修复失败用例。

### 2. Docker 部署下 cron 永远 401

- `src/app/api/cron/route.ts` 的 `isCronAuthorized` 要求 Bearer token 匹配 `CRON_SECRET`，secret 为空时直接拒绝。
- `start.js:70` 的 `http.get(cronUrl)` 不带 Authorization 头；`CRON_SECRET` 在 README/docs 零文档。
- 后果：Docker 部署无论设不设密钥，每小时的直播源/配置/收藏后台刷新必然 401。
- 修复：start.js 读取 `CRON_SECRET` 并附带 Bearer 头；补部署文档。

### 3. 会话与代理签名的 HMAC 密钥直接用站长密码

- `src/lib/api-auth.ts:89`、`src/lib/proxy-auth.ts:29`：cookie 签名与代理 URL 签名的 HMAC-SHA256 密钥均为 `getOwnerPassword()`。
- 风险：改写后的 m3u8 中每个分片 URL 都携带 `HMAC(payload, 站长密码)` 签名样本，任何登录用户（或拿到播放链接的人）可离线暴力破解站长密码；密码强度即签名强度。
- 修复：改用独立随机密钥（如 `AUTH_SECRET` 环境变量，或从密码 HKDF 派生并加盐），密码仅用于登录校验。

### 4. 用户数据双源真相，非原子写入 + upsert 语义

- 用户同时存于 DB `users` 表和 `AdminConfig.UserConfig.Users` JSON。`register/route.ts:41-53` 先 `db.registerUser` 再 `saveConfig`，两步之间失败即漂移。
- `admin/user/route.ts` 的 add 只查 config 不查 DB，而 `registerUser` 两个实现均为 upsert（sqlite `INSERT OR REPLACE`、mysql `ON DUPLICATE KEY UPDATE`）——一旦漂移，管理员"新增"同名用户会静默重置既有用户密码。
- `AdminConfig` 整体是单 JSON blob 的 read-modify-write，并发管理操作互相覆盖。
- 修复：用户以 DB 为唯一真相源；`registerUser` 改为严格 insert；config 写入加版本号乐观锁。

---

## P1：架构与性能热点

| 分类   | 状态   | 完成记录                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 架构   | 已完成 | 2026-07-02：`AdminConfig` 下沉到 `src/types`；通用 AlertModal/useAlertModal 与 play intent 上移；auth 拆分 client/server 并接入 `server-only`；home/live/play/bangumi 单域文件归位；wire 类型合并；admin user 与 m3u8 route 抽出业务逻辑；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand`                     |
| 性能   | 已完成 | 2026-07-02：新增 `getConfigForRead` 只读缓存与 `CONFIG_CACHE_TTL_MS`；代理 DNS 30s 缓存并复用入口校验；搜索聚合加入服务端失败源冷却与 miss 请求合并；m3u8 重写缓存上限提升到 2MB；豆瓣主接口接入 SWR；env proxy 流式转发接入背压；封面缓存持久化改 idle 防抖；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand` |
| 可靠性 | 已完成 | 2026-07-02：新增 `error.tsx`、`global-error.tsx`、`not-found.tsx`；Bangumi 日历故障改为错误 JSON + 502 并补路由测试；搜索、配置缓存失效、代理 fallback、Bangumi 代理 fallback 补服务端日志；数据导入 500 响应脱敏并补测试；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand`                                    |

### 架构

| 问题                         | 位置                                                                                                                                                                           | 说明                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 核心领域类型挂在 feature 下  | `config.ts` / `db.ts` / `sqlite.db.ts` / `mysql.db.ts` 等 9 个 lib 文件 import `@/features/admin/types/api` 的 `AdminConfig`                                                   | 最底层 lib 依赖最上层 feature，应下沉到 `src/lib/types.ts` 或 `src/types/`                                                                                              |
| 通用层反向依赖 feature       | `components/user-menu/SettingsPanel.tsx:6-8`、`components/DataMigration.tsx:6`（引 admin 的 AlertModal/useAlertModal）、`components/VideoCard.tsx:32`（引 play 的 playIntent） | 按项目自己的归属表，被多域消费的资产应上移 `src/components                                                                                                              | hooks` |
| lib 成 god directory         | src/lib 74 个条目中约 25-30 个单域专属                                                                                                                                         | `hls-utils.ts`(702 行,仅 play)、`home.server.ts`/`home-cache.ts`(仅 home)、`live.ts`(697 行)、`time.ts`(仅 live)等应归位各 feature；bangumi 簇 6 文件构成未声明的影子域 |
| server/client 边界零机制保障 | 全项目无 `server-only` 包                                                                                                                                                      | `auth.ts` 单文件混装两侧代码且被 6 个 'use client' 组件 import，签名签发代码进了浏览器 bundle；应拆 `auth.server.ts`/`auth.client.ts` 并引入 `server-only`              |
| wire 类型双份定义已漂移      | `db.client.ts:19-30` vs `types.ts:4-15`                                                                                                                                        | `search_title` 一边必填一边可选，序列化契约无人担保                                                                                                                     |
| 业务逻辑泄漏进 API 层        | `api/admin/user/route.ts`（521 行 handler、12+ 种 action）、`api/proxy/m3u8/route.ts`（805 行，含 500 行 m3u8 改写引擎）                                                       | 纯逻辑应抽 service/lib，路由只留装配                                                                                                                                    |

### 性能

| 问题                                        | 位置                                                                               | 触发场景                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `getConfig()` 每次调用全量 JSON 深拷贝      | `config.ts:323-326, 641-643`                                                       | `requireActiveUser`（每个 API 请求）与代理 UA 解析（每个 ts 分片）都触发；配置几百 KB 时 CPU+GC 双重浪费。改冻结只读对象或按需取字段 |
| 代理分片每请求 2 次无缓存 DNS 解析          | `url-guard.ts:158-191`；`segment/route.ts:64` + `fetchWithUrlGuard` 内部重复校验   | `dns.lookup` 占 libuv 线程池（默认 4 线程），几十人同时观看即逼近吞吐上限。加 30-60s 进程内 DNS 缓存 + 去掉入口重复校验              |
| 搜索聚合无服务端失败源冷却、miss 无请求合并 | `search-aggregate.ts:32-41`（每源 20s 超时）；`failed-source-cooldown.ts` 仅客户端 | 30 源中 10 个挂死时冷缓存搜索拖到 30s+，每个新关键词重复撞死源；热词并发首搜各自跑全源聚合                                           |
| 大 m3u8 恰好不缓存重写结果                  | `proxy/m3u8/route.ts:76`（缓存上限 256KB）                                         | 数千段长片 VOD 清单重写成本最高却每次全量逐行 HMAC 签名                                                                              |
| 豆瓣主分类接口无 SWR 缓存                   | `api/douban/route.ts:60-92`                                                        | 同目录 recommends 用了 `createSwrCache`，主接口裸打上游，自托管易触发豆瓣限流                                                        |
| 多实例下 `cachedConfig` 无 TTL 无失效       | `config.ts:59`                                                                     | 实例 A 改配置（禁源、封人），实例 B 重启前永远用旧值——性能设计连带正确性问题                                                         |
| env-proxy 流式转发无背压                    | `http-proxy-json.ts:555-583`                                                       | 配置 HTTPS_PROXY + 慢客户端时单连接最多积压 256MB                                                                                    |
| 渲染期同步写 sessionStorage                 | `cover-image-cache.ts:131-161`，调用点 `CoverImage.tsx`                            | 一屏 30-50 卡片，命中即全量 `JSON.stringify`(~50KB)+同步 setItem，发生在滚动关键帧；读接口应纯读、持久化改 idle 防抖                 |

### 可靠性

- 全项目无 React 错误边界：src/app 下无 `error.tsx`/`global-error.tsx`/`not-found.tsx`，渲染抛错直接白屏。
- `api/bangumi/calendar/route.ts:41-47`：故障 catch 后返回 `[]` + HTTP 200，故障与"无数据"客户端无法区分。
- 364 处 catch 中 25 处完全为空（`proxy/key/route.ts:85`、`config.ts:684`、`layout.tsx:100` 等）；`search/route.ts:103` 捕获后不落日志直接 500，线上排障无据。
- `admin/data_migration/import/route.ts:115,122` 把 `error.message` 原样透传客户端（内部信息泄露）。

---

## P2：技术债

| 分类              | 状态   | 完成记录                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安全遗留/工程杂项 | 已完成 | 2026-07-02：bcrypt 识别 `$2y$` 并记录 bcryptjs 回退；`AUTH_SESSION_TTL_HOURS <= 0` 回退默认 TTL；开启 React Strict Mode；Node 基线升至 22.14 并补 `engines`；Docker 增加 HEALTHCHECK；`start.js` 就绪轮询加超时；移除 MySQL 新建表冗余 username 索引；通过 `node --check start.js`、`eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand` |
| 重复代码          | 已完成 | 2026-07-02：`douban.client` 合并三套代理分支并复用 `createTimedAbortController`；新增豆瓣代理配置 helper；豆瓣上游响应类型与字段转换抽成 `douban-normalize` 并被客户端/服务端 route 共用；豆瓣 API Cache-Control 响应头抽成公共 helper；新增 normalizer/proxy 配置测试；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand`        |
| 测试              | 已完成 | 2026-07-02：补 `auth.server` cookie 解析与 HMAC 签名测试；新增 SQLite 核心持久化契约测试覆盖播放记录/收藏/搜索历史/跳过配置/导入快照；P1 中新增 Bangumi calendar 与数据导入 route 测试并抽 route 测试 Web API polyfill；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand`                                                        |
| 单文件堆叠        | 已完成 | 2026-07-02：`db.client.internal` 拆出 `db.client.cache`，主文件从 849 行降至 511 行；`VideoCard` 拆出类型与 memo 比较器并补比较器测试，主组件从 1213 行降至 1040 行；`usePlayProgress` 拆出 checkpoint/恢复候选逻辑到 `playProgressRestore`，hook 从 733 行降至 468 行；通过 `eslint --max-warnings=0 src`、`tsc --noEmit --incremental false`、`jest --runInBand`        |

### 重复代码

- 超时 fetch 手写约 12 处，而 `downstream-sources/shared.ts:11-41` 的 `createTimedAbortController` 只有 3 处调用（`douban.client.ts`、`bangumi.client.ts`、`downstream.ts:336/396` 同文件两份逐字相同等），清理方式还不一致。
- `douban.client.ts` 文件内三重复制约 250 行（Categories/List/Recommends 各抄一份 switch 六分支），`:441` 的错误文案"获取豆瓣分类数据失败"出现在 List 流程——复制粘贴实证。
- douban server route 与 client 库整套平行重复：接口声明逐字重复、字段转换两边各一份、Cache-Control 四件套在 3 个 route 逐字出现。
- douban/bangumi 两套平行流程零共享："localStorage → RUNTIME_CONFIG → 默认值"三级读取写了四遍；两套 SWR 缓存语义相同实现零共享。
- UI 模板级复制：三个用户组弹窗 85-90% 相同；视频源/直播源 Add/Edit 四表单约 80% 同骨架共 440 行；favorites/playrecords/skipconfigs/searchhistory 12 个 handler 外壳重复约 70%。

### 测试

- 覆盖严重偏科：src/lib 32 个测试文件、play 13 个，但 **47 个 API route 仅 1 个测试**；`sqlite.db.ts`(737 行)/`mysql.db.ts`(573 行)/`db.ts`/`config.ts` 共 2255 行核心持久化代码零测试——双后端行为一致性无契约保障。
- `auth.test.ts` 仅 28 行，签名校验、cookie 解析主链路未测。
- jest 27（2021 年）迫使 `auth-guard.test.ts:6-60` 手写 60 行 fetch polyfill，是 route 测试铺不开的直接摩擦成本；建议升 jest 29+ 或迁 vitest。

### 单文件堆叠

| 文件                                     | 行数 | 问题                                                                                     |
| ---------------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `components/VideoCard.tsx`               | 1213 | 33 个 hook，收藏/播放记录/长按菜单/预热/聚合展示全在一个卡片组件，全站复用即全站改动风险 |
| `lib/db.client.internal.ts`              | 849  | 传输重试/会话探测/缓存层/乐观写四类职责                                                  |
| `features/play/hooks/usePlayProgress.ts` | 836  | 位置正确但单 hook 过大                                                                   |
| `api/proxy/m3u8/route.ts`                | 805  | 见 P1                                                                                    |
| `features/play/hooks/useArtPlayer.ts`    | 795  | 同上                                                                                     |

### 安全遗留（非紧急）

- DNS rebinding TOCTOU：`url-guard.ts` 先 `lookup()` 校验、后 `fetch()` 独立解析，理论上可用旋转 DNS 绕过；根治需钉扎已校验 IP（自定义 undici Agent connect）。
- `password.ts:33` 的 bcrypt 识别正则不认 `$2y$` 前缀，此类哈希会被当明文比较。
- bcryptjs 回退时 `.catch()` 吞错零日志，部署方无法察觉在用慢 3-5 倍的纯 JS 实现。
- `AUTH_SESSION_TTL_HOURS <= 0` 时会话到 2099 年永不过期（选项本身危险，靠改密码才能全量吊销）。

### 工程杂项

- `next.config.js:24` `reactStrictMode: false`——React 19 项目关严格模式，掩盖副作用 bug。
- Node 20 已 EOL（2026-04），`.nvmrc` 与 Dockerfile 双处钉死，package.json 无 `engines` 兜底。
- `start.js:33-60` 就绪轮询无上限（启动失败则每秒 GET /login 到天荒地老）；Dockerfile 无 HEALTHCHECK。
- 错误响应格式至少 5 种并存（`{error}` / `{ok,error,retryAfter}` / `{code,message,list}` / `{success,message,error}`），客户端反馈三套机制并存（AlertModal / CustomEvent / 局部 setError）。
- 命名不自释义：`yellow.ts`（成人内容过滤表）、`giri.ts` 与 `downstream-sources/giri.ts` 同名双层易混淆。
- MySQL 冗余二级索引：`idx_play_records_username` 与主键左前缀完全重复（favorites、skip_configs 同）。

---

## 已核实做得好的部分

1. **类型纪律**：strict + Node16 解析，60k 行 0 个 ts-ignore、src 内 0 个 eslint-disable、any 密度 <0.1%。
2. **鉴权体系**：47 route 中 34 个走统一 guard/代理签名，未挂 guard 的均为有意公开端点（已逐一核对）；cookie httpOnly+sameSite+签名绑定过期时间；favorites/playrecords 的 username 一律取自 token 不取请求参数（无水平越权）；SQL 全参数化；注册受 `OpenRegister` 开关控制；`server-config` 区分登录/未登录视图。
3. **SSRF 防护成体系**：`url-guard.ts` 做到 DNS 解析级校验（IPv4/IPv6 私网段全覆盖 + `::ffff:` 映射归一 + 重定向逐跳重校验 + 上限 5 跳）且配了测试；cron 密钥比较用 `timingSafeEqual`。
4. **缓存设计**：`server-cache.ts` 的 SWR 三态 + inflight 请求合并是教科书级；SQLite WAL + 全量 prepared statements + 事务；播放进度 5s 节流 + 指纹去重。
5. **客户端渲染管线**：SSE 逐源流式 + 80ms 批量 flush + `startTransition`、虚拟化网格、IntersectionObserver 预载。
6. **feature 横向隔离**：6 个 feature 互相 import 实现代码仅 1 处（HomeClient→useDoubanFeed），60k 行体量下少见。
7. **运维意识**：Docker 多阶段 + 非 root + standalone；pnpm.overrides 钉住 19 个漏洞传递依赖；`check-encoding.js` 检测 CJK 乱码。

---

## 建议修复顺序

1. CI 门禁 + 修红测试（半天，止血）
2. Docker cron 鉴权 + 文档（1 小时）
3. 签名密钥与站长密码解耦（半天，注意兼容已发 cookie 的迁移）
4. 用户双源真相收敛 + `registerUser` 去 upsert（1 天）
5. `global-error.tsx`/`error.tsx` + 空 catch 补日志（半天）
6. `getConfig` 去深拷贝、DNS 结果缓存、服务端失败源冷却（各半天，性能收益最大三件）
7. `AdminConfig` 类型下沉 + `server-only` 落地 + auth.ts 拆分（1-2 天，立住架构规矩）
8. 双存储契约测试 + route 测试铺开（随迭代持续）
9. douban 三重复制合并、超时 fetch 收敛到共享封装（随迭代持续）
