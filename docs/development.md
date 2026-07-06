# 开发速记

给 AI 和开发者的开工前速读版。只保留当前项目里高频、容易改错、会影响实际行为的约束。

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
- 导入统一走 `@/...`

## 容易改错的入口

- 管理后台入口：`src/app/admin/page.tsx`
- 管理后台实现：`src/features/admin/`
- 搜索聚合：`src/app/api/search/route.ts`、`src/lib/search-aggregate.ts`、`src/lib/search-cache.ts`
- 本地设置面板：`src/components/user-menu/SettingsPanel.tsx`
- 播放页：`src/features/play/`
- 直播页：`src/features/live/`
- Bangumi 首页取数：`src/features/bangumi/lib/bangumi.client.ts`

## 本地设置

这类设置不要分散直接读写 `localStorage`。

- 布尔偏好走 `src/lib/local-preferences.ts`
  - `defaultAggregateSearch`
  - `enableOptimization`
  - `fluidSearch`
  - `liveDirectConnect`
- 带事件通知的布尔设置走 `src/lib/local-settings.ts`
  - `AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY`
- Bangumi 设置走 `src/lib/bangumi-source.ts`
- Douban 代理设置走 `src/lib/douban-source.ts`

如果新增本地设置：

- 先补 helper
- 再在设置面板和消费方统一接入
- 不要在页面里各自手写 key 和默认值

## 鉴权与会话

- 页面/API 鉴权入口：`src/lib/api-auth.ts`
- Cookie 签名和登录签名统一走：`src/lib/signing-secret.server.ts`
- 新签名依赖 `AUTH_SECRET` 或 `ICETV_AUTH_SECRET`
- 旧 cookie 兼容校验由 `LEGACY_COOKIE_CUTOFF_DATE` 控制
- 不要再用站长密码直接生成新会话签名

Guard 选择：

- `requireActiveUser`：任意登录用户
- `requireAdmin`：`admin` + `owner`
- `requireOwner`：仅 `owner`

## 配置读写

配置相关优先看 `src/lib/config.ts`。

- 纯读路径优先用 `getConfigForRead()`
- 需要修改时用 `getConfig()` 取可写对象，再走 `saveConfig()`
- `saveConfig()` 可能抛 `ConfigConflictError`
- 配置里的用户列表会和数据库做同步，不要自己维护第二套真相源

如果是管理后台用户操作：

- 优先复用 `src/features/admin/services/userActions.ts`
- 不要在 `route.ts` 里重新展开权限和用户组逻辑

## 错误处理与日志

- 客户端严重错误日志统一走 `src/lib/client-error-reporting.ts`
- 根布局已挂载 `src/components/ClientErrorReporter.tsx`，负责 `error` 和 `unhandledrejection`
- `src/app/error.tsx`、`src/app/global-error.tsx` 生产环境只展示通用提示，开发环境展示错误类型、信息、编号和堆栈
- 业务可恢复错误优先返回明确文案，不要抛给全局错误边界
- API 返回给前端的 `error` 只放可展示信息；敏感上下文只打服务端日志

## 搜索

搜索链路已经有缓存和失败冷却，不要绕开。

- 聚合执行：`runSearchAggregation()`
- 聚合缓存：`search-cache.ts`
- 失败源冷却：`search-aggregate.ts`
- `/api/search` 命中缓存时会先返回旧结果，再后台刷新

如果改搜索：

- 先确认是改 API 行为、缓存策略，还是前端展示
- 不要在页面层重新拼一套聚合/冷却逻辑

## Bangumi 与 Douban

- 首页 Bangumi 数据读取走 `src/features/bangumi/lib/bangumi.client.ts`
- 它会按本地设置在 `server` / `direct` / `custom` 之间切换
- 它带本地缓存和失败回退
- Bangumi 服务端接口：`src/app/api/bangumi/calendar/route.ts`
- Douban 主接口：`src/app/api/douban/route.ts`

如果改 Bangumi/Douban：

- 先区分是服务端数据源逻辑，还是设置面板文案/入口
- 不要只改设置面板，不改真实读数路径

## 代理与外部请求

安全相关入口不要绕开。

- 代理签名：`src/lib/proxy-auth.ts`
- 外链 URL 校验：`src/lib/url-guard.ts`
- 代理路由：`src/app/api/proxy/*`

任何代理、图片转发、m3u8、分片、外部 fetch：

- 优先复用现有 `authorizeProxyRequest()`、`fetchWithUrlGuard()`、`validateProxyUrlForRequest()`
- 不要直接裸 `fetch` 外部用户输入 URL

## 播放与代理路由

视频源流量路由以后台 `SourceConfig.proxyMode` 为准。

- 未显式配置时默认 `auto`
- `browser`：浏览器直连，不自动切服务端代理
- `server`：播放和测速都走服务端代理
- `auto`：先浏览器直连，失败后按 `source + URL` 记一次服务端代理 fallback

## 逐集解析型源站

部分源站的详情页只给集数结构，每一集的真实播放地址要单独抓一次播放页。这类源站统一走懒解析协议：详情阶段返回 `icetv-lazy://` 懒地址，播放时经 `/api/episode-url` 按需解析。

接入新的这类源站：

- `src/lib/lazy-episodes.ts`：新增 kind 与对应的路径白名单正则
- `src/lib/downstream-sources/<site>.ts`：详情的 `episodes` 用 `buildLazyEpisodeUrl(kind, path)` 生成；导出 `resolveXxxEpisodeUrlByPath(apiSite, path)` 做单集解析
- `src/app/api/episode-url/route.ts`：在 `matchesLazyKind` 和 `resolveEpisodeUrl` 里接上新 kind
- 客户端不用改：播放入口、测速、预热、详情快照对懒地址的处理是通用的

约束：

- 不要在详情阶段全量抓播放页
- 不要绕过 `/api/episode-url` 在客户端直接解析源站地址

## Admin 模块

Admin 维持“导航 + 当前 tab 内容”结构。

- tab 注册：`src/features/admin/lib/admin-tabs.ts`
- tab 切换：`src/features/admin/hooks/useAdminTab.ts`
- 内容挂载：`src/features/admin/components/AdminTabContent.tsx`

新增 tab：

- 先加 `admin-tabs.ts`
- 再加 `AdminTabContent.tsx`
- 再补对应 feature 目录实现

通用弹窗优先复用：

- `@/components/modals/ConfirmModal`
- `@/components/modals/AlertModal`

## 动态 import

项目使用 `moduleResolution: Node16`。

- 相对动态导入必须显式带 `.js`

示例：

```ts
const { MySqlStorage } = await import('./mysql.db.js');
```

## 改动后最小验证

常用命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

如果只改局部：

- 至少跑相关测试
- 没有现成测试时，说明未验证项
