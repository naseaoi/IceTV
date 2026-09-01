# IceTV 项目约束

给 AI 编码助手读的项目专属规则。通用工程规范不在此重复，只写本项目里**改错了不会报错、会静默出问题**的约束。

实现细节看代码，改动历史看 git log，其他文档见 [docs/README.md](docs/README.md)。

## 配置读写

统一入口 `src/lib/config.ts`。三个读取函数不可混用：

| 函数                 | 返回         | 用途                        |
| -------------------- | ------------ | --------------------------- |
| `getConfigForRead()` | 冻结、带缓存 | 纯读路径                    |
| `getConfigFresh()`   | 冻结、跳缓存 | 后台面板等必须看到最新写入  |
| `getConfig()`        | 可写克隆     | 要修改，改完 `saveConfig()` |

- 写路径**必须先 `invalidateConfigCache()` 再 `getConfig()`**。否则命中 60 秒 TTL 缓存，会误判用户不存在或撞版本冲突。
- `getConfigFresh()` 的结果**绝不能喂给写路径**。它 `deepFreeze` 的是共享缓存对象本身，不是副本。
- `saveConfig()` 可能抛 `ConfigConflictError`（应用层乐观锁）。捕获后重试前要重新失效缓存。
- 配置里的用户列表每次加载都会和数据库同步重建，不要维护第二套真相源。
- 后台用户操作复用 `src/features/admin/services/userActions.ts`，不在 `route.ts` 里重新展开权限与用户组逻辑。

## 邀请码用量

- 真相源是 `invite_code_usage` 表，**不是配置 JSON 里的 `usedCount`**。配置里那个字段只在数据库缺行时作首次播种回落，读取时由 `mergeInviteCodeUsage()` 合并。改用量不要写配置。
- 名额占用走 `reserveInviteCodeUse()` 的带条件 `UPDATE ... WHERE used_count < ?`，以受影响行数判成败，并发注册才不争抢配置写入。
- 注册后续步骤失败必须 `releaseInviteCode()` 回滚。

## 用户活跃记录

`user_login_activity` 的不变量：**每个 users 行都必须有对应活跃记录行**。

- 建号与活跃记录同事务写入。
- 缺失行在存储层初始化时和 `replaceAllData()` 结尾按当前时刻补齐。这是每次重新断言的不变量，不是一次性迁移。
- 补齐写的是合成时间戳，所以新版本上线后一段时间内「清理不活跃用户」按阈值筛不出人，包括真正沉睡的账号。
- 站长账号来自环境变量，没有 `users` 行但可能有活跃记录行。按 `users` 反查孤儿记录会误伤它。
- 清理时 owner / admin 与操作者本人豁免，无活跃记录的用户不纳入候选。

## 客户端 IP 与限流

- `TRUSTED_PROXY_COUNT` 默认 0，此时 `getClientIp()` 回落到 `x-forwarded-for` 第一段，该值客户端可控。反代后不设它，注册限流可被伪造头绕过。
- `FixedWindowRateLimiter` 是进程内 `Map`，每实例独立计数。多实例或 Vercel 部署时实际放行量按实例数翻倍。

## 鉴权

- 入口 `src/lib/api-auth.ts`。Guard 三档：`requireActiveUser`（任意登录用户）、`requireAdmin`（admin + owner）、`requireOwner`。
- Cookie 与登录签名统一走 `src/lib/signing-secret.server.ts`，依赖 `AUTH_SECRET`。**不要再用站长密码生成新会话签名**。
- 旧 cookie 兼容校验由 `LEGACY_COOKIE_CUTOFF_DATE` 控制。
- 根布局经 `src/lib/auth-session.server.ts` 校验后把初始会话注入 `AuthProvider`，客户端统一用 `useAuthSession()` 消费。
- 受保护路由在对应 `layout.tsx` 挂 `AuthenticatedRoute`，确保门禁先于 `loading.tsx` 和页面内 `Suspense`。
- `/api/auth/session` 只用于显式重新验证，首次渲染与普通路由切换不调用。
- 登录态失效派发 `AUTH_SESSION_LOST_EVENT`，由 `AuthProvider` 统一处理。

访问边界：

- 游客点受保护入口时先进目标页展示统一登录提示，**不在入口组件直接跳 `/login`**。
- 前端拦截不算防线，服务端仍需对应 Guard。代理模式、播放路由统计等辅助接口同属登录后能力。
- 公开能力仅限：首页、分类、版本信息、登录注册、受限封面缓存。

## 目录归属

```text
src/
├── app/                    # 路由入口，只做装配
├── components/             # 跨 feature 通用 UI
├── hooks/                  # 跨 feature 通用 hooks
├── lib/                    # 跨 feature 通用工具
└── features/<domain>/      # 业务域实现
```

- 只被一个业务域使用的代码放 `src/features/<domain>/`，被两个及以上复用才上提。
- `page.tsx`、`route.ts` 优先做装配，不堆业务细节。
- 跨目录导入统一走 `@/...`，同目录内可用相对路径。
- 动态 import 也用 `@/` 路径（`moduleResolution: bundler`，裸相对路径在 Turbopack 与 Webpack 下行为不一致）。

## 本地设置

不要在页面或组件里分散读写 `localStorage`，各有 helper：布尔开关 `local-preference-toggles.ts`、其他偏好 `local-preferences.ts`、Bangumi `bangumi-source.ts`、Douban `douban-source.ts`、播放器快捷键 `player-shortcuts.ts`（均在 `src/lib/`）。

新增设置先补 helper，再让设置面板和消费方接入，不要各自手写 key 和默认值。

## 搜索

聚合执行 `runSearchAggregation()`，聚合缓存 `src/lib/search-cache.ts`，失败源冷却 `src/lib/search-aggregate.ts`。`/api/search` 命中缓存时先返回旧结果再后台刷新。不要在页面层重新实现聚合、缓存或失败冷却。

## 外部请求

- 复用 `authorizeProxyRequest()`、`fetchWithUrlGuard()`、`validateProxyUrlForRequest()`。签名 `src/lib/proxy-auth.ts`，校验 `src/lib/url-guard.ts`。
- **不要直接 `fetch` 未经校验的外部输入 URL**。

## 播放

流量路由以后台 `SourceConfig.proxyMode` 为准：`browser` 直连、`server` 走服务端、`auto` 按失败策略探测切换。阈值、超时、冷却以策略文件为准，**不要在其他模块复制常量**。

- 编排 `src/features/play/lib/vodHlsRuntime.ts`，自动路由 `vodAutoRoutePolicy.ts`，代理模式 `src/lib/proxy-modes.ts`
- 画质 `vodHlsQualityController.ts`、`vodQualityPolicy.ts`
- 快捷键：定义 `src/lib/player-shortcuts.ts` → 执行 `src/hooks/usePlayerKeyboard.ts` → 弹窗 `src/components/PlayerShortcutsModal.tsx`。新增动作依次补齐三处，不要在页面单独监听 keydown

弹幕（`src/features/play/lib/danmaku/`）：

- 模式值两边不同：dandanplay `1/2/3` 滚动、`5` 顶部、`4` 底部；artplayer 插件 `0` 滚动、`1` 顶部、`2` 底部。颜色上游是十进制整数，插件要 CSS 字符串。**直接透传会让顶部/底部弹幕静默错位**，一律走 `normalize.ts`
- `p` 字段 4 段时颜色在第 3 位，8/9 段时在第 4 位，取错只是颜色不对不会报错
- 换集时播放器可能**复用实例**（非 webkit + 前后都是 hls），此时插件不会自行重新调用加载器，必须显式 `reloadDanmaku()`。去广告开关会 `destroy()` 重建，走的是另一条路
- 加载器在本地开关关闭时返回空数组以免白跑请求，所以**开关打开时必须触发一次 `reloadDanmaku()`**，只调 `api.show()` 显示的是空数据
- `provider.server.ts` 故意不用 `fetchWithUrlGuard()`：base URL 来自环境变量属可信输入，而 guard 会拦私有 IP，套上会逼站长把自建弹幕服务暴露到公网。用户输入只经 `searchParams` 进 query

去广告：

- 策略注册 `ad-filter-strategy-registry.ts`，清单重建 `ad-filter-manifest.ts`，服务端检测 `ad-segment-detector.ts`
- 新源优先组合现有 signal，无法表达时才新增检测器
- 每个服务端策略必须有独立 `id` 和 `version`，规则变化时递增 `version`
- 新增策略要补源站 fixture，验证广告删除、正片保留、时间轴边界
- 服务端策略源不再跑客户端通用过滤，避免清单被二次重建

## 逐集解析型源站

统一用 `icetv-lazy://`：详情阶段返回懒地址，播放时经 `/api/episode-url` 解析。新增源动三处：

1. `src/lib/lazy-episodes.ts`：新增 kind 与路径白名单正则
2. `src/lib/downstream-sources/<site>.ts`：`episodes` 用 `buildLazyEpisodeUrl(kind, path)`，导出 `resolveXxxEpisodeUrlByPath(apiSite, path)`
3. `src/app/api/episode-url/route.ts`：在 `matchesLazyKind` 和 `resolveEpisodeUrl` 接上新 kind

不要在详情阶段全量抓播放页，不要绕过 `/api/episode-url` 在客户端直接解析源站地址。

## Admin

- 新增 tab 依次补：注册 `src/features/admin/lib/admin-tabs.ts` → 切换 `useAdminTab.ts` → 挂载 `AdminTabContent.tsx`
- 弹窗复用 `ConfirmModal` / `AlertModal`
- 表单样式复用 `src/features/admin/lib/buttonStyles.ts`（`buttonStyles` / `inputStyles` / `checkboxStyles`）

## 错误处理

- 客户端严重错误走 `src/lib/client-error-reporting.ts`，根布局已挂 `ClientErrorReporter`
- `error.tsx`、`global-error.tsx` 生产只展示通用提示，开发展示类型、信息、编号、堆栈
- 业务可恢复错误返回明确文案，不要抛给全局错误边界
- API 返回的 `error` 只放可展示信息，敏感上下文只打服务端日志

## 测试

- 需要 `crypto` 的测试调 `installCryptoPolyfill()`（`src/app/api/test-utils/crypto-polyfill.ts`）。jest 的 jsdom 与 node 环境都不提供全局 `crypto`，**只加 `@jest-environment node` 不够**。
- 需要 `Headers` / `Request` / `Response` 的路由测试调 `installWebPolyfills()`（同目录），它不含 crypto。
- `jest.setup.js` 把 `LOCAL_DB_PATH` 固定为 `:memory:`，防止测试写进开发库。新增测试不要覆盖成真实路径。
- `jest.mock` 工厂必须列出被测模块导入的每个符号，**漏一个会让路由静默 500**。
- `mysql-storage-contract.test.ts` 走 fake pool（JS 模拟谓词），验的是接线，不执行真 SQL，证明不了两侧谓词等价。真 SQL 覆盖靠 `pnpm test:mysql`（需 Docker，未配 `MYSQL_TEST_URL` 时整体 skip）。

## 验证

改完依次跑：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

- 本地开发默认 `pnpm dev`，遇 Turbopack 兼容问题用 `pnpm dev:webpack`
- 改过中文文案跑 `pnpm check:encoding`，拦截乱码字节
- 非空数据性能回归跑 `pnpm perf:baseline`，方法见 [docs/performance-baseline.md](docs/performance-baseline.md)
- 没有现成测试时明确说明未验证项
