# 开发速记

本文档只保留当前项目里高频、容易改错、会影响实际行为的约束。

## 目录归属

```text
src/
├── app/                    # 路由入口，只做装配
├── components/             # 跨 feature 通用 UI
├── hooks/                  # 跨 feature 通用 hooks
├── lib/                    # 跨 feature 通用工具
└── features/<domain>/      # 业务域实现
```

- 只被一个业务域使用的代码，放 `src/features/<domain>/`
- 被两个及以上业务域复用的代码，放 `src/components`、`src/hooks`、`src/lib`
- `page.tsx`、`route.ts` 优先做装配，不堆业务细节
- 跨目录的项目内导入统一走 `@/...`；同目录内可以使用相对路径

## 本地设置

不要在页面或组件里分散读写 `localStorage`。

- 布尔开关注册走 `src/lib/local-preference-toggles.ts`
- 其他本地偏好走 `src/lib/local-preferences.ts`
- Bangumi 设置的读取、写入、重置走 `src/lib/bangumi-source.ts`
- Douban 数据与图片代理设置的读取、写入、重置走 `src/lib/douban-source.ts`

新增设置时先补 helper，再让设置面板和消费方统一接入；不要各自手写 key 和默认值。

## 鉴权与会话

- 页面/API 鉴权入口：`src/lib/api-auth.ts`
- Cookie 签名和登录签名统一走：`src/lib/signing-secret.server.ts`
- 新签名依赖 `AUTH_SECRET`
- 旧 cookie 兼容校验由 `LEGACY_COOKIE_CUTOFF_DATE` 控制
- 不要再用站长密码直接生成新会话签名

Guard 选择：

- `requireActiveUser`：任意登录用户
- `requireAdmin`：`admin` + `owner`
- `requireOwner`：仅 `owner`

页面会话：

- 根布局通过 `src/lib/auth-session.server.ts` 校验 Cookie，并把初始会话注入 `AuthProvider`
- 客户端统一通过 `AuthProvider` / `useAuthSession()` 消费会话；`AuthenticatedRoute` 只负责展示门禁
- 受保护路由在对应 `layout.tsx` 挂载 `AuthenticatedRoute`，确保门禁先于 `loading.tsx` 和页面内 `Suspense`
- `/api/auth/session` 仅用于显式重新验证，首次渲染和普通路由切换不调用
- 登录状态失效时派发 `AUTH_SESSION_LOST_EVENT`，由 `AuthProvider` 统一更新

访问边界：

- 搜索、直播、播放、个人页、收藏页和后台通过 `AuthenticatedRoute` 验证有效会话后再挂载业务组件
- 游客点击受保护入口时先进入目标页面展示统一登录提示，不要在入口组件直接跳转 `/login`
- 受保护页面的 API 调用不能只依赖前端拦截，服务端仍需使用对应 Guard
- 代理模式、播放路由统计等辅助接口同样属于登录后能力，不得对游客开放
- 首页、分类、版本信息、登录注册和受限封面缓存属于公开能力

## 配置读写

- 统一入口：`src/lib/config.ts`
- 纯读路径优先用 `getConfigForRead()`
- 需要修改时用 `getConfig()` 取可写对象，再走 `saveConfig()`
- `saveConfig()` 可能抛 `ConfigConflictError`
- 配置里的用户列表会和数据库做同步，不要自己维护第二套真相源
- 管理后台用户操作优先复用 `src/features/admin/services/userActions.ts`，不要在 `route.ts` 里重新展开权限和用户组逻辑

## 错误处理与日志

- 客户端严重错误日志统一走 `src/lib/client-error-reporting.ts`
- 根布局已挂载 `src/components/ClientErrorReporter.tsx`，负责 `error` 和 `unhandledrejection`
- `src/app/error.tsx`、`src/app/global-error.tsx` 生产环境只展示通用提示，开发环境展示错误类型、信息、编号和堆栈
- 业务可恢复错误优先返回明确文案，不要抛给全局错误边界
- API 返回给前端的 `error` 只放可展示信息；敏感上下文只打服务端日志

## 搜索

- 聚合执行：`runSearchAggregation()`
- 聚合缓存：`src/lib/search-cache.ts`
- 失败源冷却：`src/lib/search-aggregate.ts`
- `/api/search` 命中缓存时会先返回旧结果，再后台刷新
- 不要在页面层重新实现聚合、缓存或失败冷却

## Bangumi 与 Douban

- Bangumi 客户端统一入口：`src/features/bangumi/lib/bangumi.client.ts`
- Douban 客户端统一入口：`src/lib/douban.client.ts`
- Bangumi 会按本地设置在 `server` / `direct` / `custom` 间切换，并带缓存和失败回退
- 修改数据源设置时必须同步真实读数路径，不要只改设置面板

## 代理与外部请求

- 代理签名：`src/lib/proxy-auth.ts`
- 外链 URL 校验：`src/lib/url-guard.ts`
- 代理路由：`src/app/api/proxy/*`
- 代理、图片、m3u8、分片等外部请求优先复用 `authorizeProxyRequest()`、`fetchWithUrlGuard()`、`validateProxyUrlForRequest()`
- 不要直接 `fetch` 未经校验的外部用户输入 URL

## 播放与代理路由

视频源流量路由以后台 `SourceConfig.proxyMode` 为准：`browser` 直连、`server` 走服务端、`auto` 按失败策略探测和切换。阈值、超时和冷却时间以策略文件为准，不要在其他模块复制常量。

- 播放与错误恢复编排：`src/features/play/lib/vodHlsRuntime.ts`
- 自动路由策略：`src/features/play/lib/vodAutoRoutePolicy.ts`
- 代理模式与会话覆盖：`src/lib/proxy-modes.ts`
- 画质控制：`src/features/play/lib/vodHlsQualityController.ts`
- 默认画质与降级能力：`src/features/play/lib/vodQualityPolicy.ts`
- 画质偏好保存：`src/lib/local-preferences.ts`

去广告扩展：

- 源站策略注册：`src/features/play/lib/ad-filter-strategy-registry.ts`
- 清单解析与重建：`src/features/play/lib/ad-filter-manifest.ts`
- 服务端检测执行：`src/features/play/lib/ad-segment-detector.ts`
- 新源优先组合现有 signal；只有现有 signal 无法表达时才新增检测器
- 每个服务端策略必须设置独立 `id` 和 `version`，规则行为变化时递增 `version`
- 新增或调整策略时补对应源站 fixture，验证广告删除、正片保留和时间轴边界
- 服务端策略源不再运行客户端通用过滤，避免同一清单被二次重建

## 逐集解析型源站

逐集解析源统一使用 `icetv-lazy://`：详情阶段返回懒地址，播放时经 `/api/episode-url` 按需解析。

- `src/lib/lazy-episodes.ts`：新增 kind 与对应的路径白名单正则
- `src/lib/downstream-sources/<site>.ts`：详情的 `episodes` 用 `buildLazyEpisodeUrl(kind, path)` 生成；导出 `resolveXxxEpisodeUrlByPath(apiSite, path)` 做单集解析
- `src/app/api/episode-url/route.ts`：在 `matchesLazyKind` 和 `resolveEpisodeUrl` 里接上新 kind
- 客户端播放入口、测速、预热和详情快照使用通用处理，不为单个源增加分支
- 不要在详情阶段全量抓播放页
- 不要绕过 `/api/episode-url` 在客户端直接解析源站地址

## Admin 模块

- tab 注册：`src/features/admin/lib/admin-tabs.ts`
- tab 切换：`src/features/admin/hooks/useAdminTab.ts`
- 内容挂载：`src/features/admin/components/AdminTabContent.tsx`
- 新增 tab 时依次补注册、内容挂载和对应 feature 实现
- 通用弹窗优先复用 `ConfirmModal` 和 `AlertModal`

## 动态 import

项目使用 `moduleResolution: bundler`。项目内动态导入统一使用 `@/` 路径，第三方包继续使用包名，兼容 Webpack 与 Turbopack。

示例：

```ts
const { MySqlStorage } = await import('@/lib/mysql.db');
```

## 验证

- 本地开发默认使用 `pnpm dev`；仅遇到 Turbopack 兼容问题时使用 `pnpm dev:webpack`
- 改动后运行 `pnpm lint`、`pnpm typecheck` 和相关测试
- 没有现成测试时明确说明未验证项
