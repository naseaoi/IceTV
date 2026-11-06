# IceTV 项目约束

给 AI 编码助手读的项目专属规则。只写本项目里**改错了不会报错、会静默出问题**的约束；通用工程规范不在此重复，实现细节看代码，改动历史看 git log。

## 按改动范围先读

| 改动涉及                                             | 先读                                     |
| ---------------------------------------------------- | ---------------------------------------- |
| 存储层、配置写入、用户权限、邀请码、导入导出、新增表 | [数据与存储](docs/data-storage.md)       |
| 评价、收藏库、观看状态、个人主页、关注、卡片菜单     | [评价与收藏](docs/reviews-favorites.md)  |
| 消息、追更、关注动态                                 | [消息与追更](docs/messages-tracking.md)  |
| 搜索、源站接入、源站健康与探测、逐集解析             | [源站与搜索](docs/sources-search.md)     |
| 点播 / 直播播放、换源、分片缓存、弹幕、去广告        | [播放](docs/playback.md)                 |
| 页面、组件、样式、后台界面                           | [前端界面](docs/frontend.md)             |
| 部署、环境变量、缓存与回源预算、定时任务             | [部署](docs/deployment.md)               |
| 性能相关改动                                         | [性能验证](docs/performance-baseline.md) |
| 打 tag、发版                                         | [发布](docs/release.md)                  |

## 配置读写

统一入口 `src/lib/config.ts`。三个读取函数不可混用：

| 函数                 | 返回         | 用途                        |
| -------------------- | ------------ | --------------------------- |
| `getConfigForRead()` | 冻结、带缓存 | 纯读路径                    |
| `getConfigFresh()`   | 冻结、跳缓存 | 后台面板等必须看到最新写入  |
| `getConfig()`        | 可写克隆     | 要修改，改完 `saveConfig()` |

- 写路径**必须先 `invalidateConfigCache()` 再 `getConfig()`**，否则拿到 TTL 缓存里的旧版本，`saveConfig()` 撞版本冲突。
- 原地修改 `getConfig()` 返回的对象再保存；版本号绑定在对象身份上，展开或克隆后保存会绕过冲突检测。
- `getConfigFresh()` 的结果**绝不能喂给写路径**。它 `deepFreeze` 的是共享缓存对象本身，不是副本。
- `saveConfig()` 可能抛 `ConfigConflictError`（应用层乐观锁）。捕获后重试前要重新失效缓存。
- 用户权限、邀请码、订阅状态、直播频道数已迁出配置 JSON，真相源见 [数据与存储](docs/data-storage.md)。

## 鉴权与访问边界

- 入口 `src/lib/api-auth.ts`。Guard 三档：`requireActiveUser`（任意登录用户）、`requireAdmin`（admin + owner）、`requireOwner`。
- Cookie 与登录签名统一走 `src/lib/signing-secret.server.ts`，依赖 `AUTH_SECRET`。**不要再用站长密码生成新会话签名**。旧 cookie 兼容校验由 `LEGACY_COOKIE_CUTOFF_DATE` 控制。
- 根布局经 `src/lib/auth-session.server.ts` 校验后把初始会话注入 `AuthProvider`，客户端统一用 `useAuthSession()` 消费。`/api/auth/session` 只用于显式重新验证，首次渲染与普通路由切换不调用。登录态失效派发 `AUTH_SESSION_LOST_EVENT`，由 `AuthProvider` 统一处理。
- 受保护路由在对应 `layout.tsx` 挂 `AuthenticatedRoute`，确保门禁先于 `loading.tsx` 和页面内 `Suspense`。
- 游客点受保护入口时先进目标页展示统一登录提示，**不在入口组件直接跳 `/login`**。
- 前端拦截不算防线，服务端仍需对应 Guard。代理模式、播放路由统计等辅助接口同属登录后能力。公开能力仅限：首页、分类、版本信息、登录注册、受限封面缓存。

## 外部请求与客户端 IP

- **不要直接 `fetch` 未经校验的外部输入 URL**。复用 `authorizeProxyRequest()`、`fetchWithUrlGuard()`、`validateProxyUrlForRequest()`（签名 `src/lib/proxy-auth.ts`，校验 `src/lib/url-guard.ts`）。
- 普通服务端回源复用 `fetchUpstream()` / `fetchWithUrlGuard()`，它们会申请数据库共享资源额度。得到的响应体必须消费或取消，连接租约不会在响应头到达时释放。
- `getClientIp()` 在 `TRUSTED_PROXY_COUNT` 为 0（默认）时依次取 `cf-connecting-ip`、`x-real-ip`、`x-forwarded-for` 第一段，均可由客户端伪造。反代后不设该变量，注册限流可被绕过。
- `FixedWindowRateLimiter` 是进程内 `Map`，每实例独立计数。多实例或 Vercel 部署时实际放行量按实例数翻倍。

## 目录归属

- 只被一个业务域使用的代码放 `src/features/<domain>/`，被两个及以上复用才上提。
- `page.tsx`、`route.ts` 优先做装配，不堆业务细节。
- 跨目录导入（含动态 import）统一走 `@/...`，同目录内可用相对路径；测试文件可相对导入被测模块。

## 界面硬约束

其余界面规范见 [前端界面](docs/frontend.md)。原生 `<select>`、`max-*` 变体、`animate-pulse` / `animate-spin`、导航与筛选栏以外的 `backdrop-blur` 由 ESLint（`eslint.config.mjs`）报错拦截，新增吸顶导航或筛选栏时把文件加入 `BACKDROP_BLUR_ALLOWED_FILES`。

- `tailwind.config.ts` 含 raw 断点（`split`），Tailwind 因此**不生成 `max-sm:` / `max-md:` 等 `max-*` 变体**，写了也静默无效。窄屏样式写成基础类加 `sm:` / `md:` 覆盖，窄屏横屏用 `phone-landscape:`。
- `@tailwindcss/forms` 按控件类型给原生 input / select / textarea 加边框、内边距和背景（select 另有背景箭头）。自定义样式的控件须显式 `border-0`、重置 padding、`focus:ring-0`（select 再加 `bg-none`），否则浅色模式出现灰框或文字被裁切。下拉统一用 `src/components/Select.tsx`，不写原生 `<select>`。
- 页面滚动可能发生在 `window`、`documentElement` 或 `body` 上，监听或回顶统一用 `src/hooks/usePageScroll.ts`，只监听其中一处会静默失效。需要捕获任意容器滚动的虚拟列表、无限加载可在 `document` 上用捕获监听。换页滚动位置由根布局的 `PageScrollRestorer` 接管（新页面回顶、前进后退恢复），不要在页面里另写换页回顶。
- 加载反馈与骨架有统一入口，骨架与真实组件共用布局常量，不手写 `animate-pulse` / `animate-spin` 或像素高度，见 [前端界面](docs/frontend.md#加载反馈与骨架)。

## 本地设置

- `localStorage` 只经 `src/lib/browser-storage.ts` 访问（ESLint 拦截直接访问），它统一处理服务端渲染、隐私模式与配额已满时的异常；写入返回是否成功，配额满时调用方可清理后重试。
- 业务代码不直接拼 key 与默认值，各类设置用对应 helper（均在 `src/lib/`）：布尔开关 `local-preference-toggles.ts`、其他偏好 `local-preferences.ts`、Bangumi `bangumi-source.ts`、Douban `douban-source.ts`、播放器快捷键 `player-shortcuts.ts`、源播放统计 `source-playback-stats.ts`。新增设置先补 helper，再让设置面板和消费方接入。
- 主题的存储键、默认值与首屏主题脚本都在 `src/lib/theme-preference.ts`，脚本与 `ThemeProvider` 共用常量；新增主题取值时同步改脚本里的取值判断。

## 错误处理

- 客户端严重错误走 `src/lib/client-error-reporting.ts`，根布局已挂 `ClientErrorReporter`。
- `error.tsx`、`global-error.tsx` 生产只展示通用提示，开发展示类型、信息、编号、堆栈。
- 业务可恢复错误返回明确文案，不要抛给全局错误边界。
- API 返回的 `error` 只放可展示信息；兜底 `catch` 不要把任意异常的 `message` 透传给客户端，敏感上下文只打服务端日志。

## 测试

- 需要 `crypto` 的测试调 `installCryptoPolyfill()`（`src/app/api/test-utils/crypto-polyfill.ts`）。jest 的 jsdom 与 node 环境都不提供全局 `crypto`，**只加 `@jest-environment node` 不够**。
- 需要 `Headers` / `Request` / `Response` 的路由测试调 `installWebPolyfills()`（同目录），它不含 crypto。
- `jest.setup.js` 把 `LOCAL_DB_PATH` 固定为 `:memory:`，防止测试写进开发库。新增测试不要覆盖成真实路径。
- `jest.mock` 工厂必须列出被测模块导入的每个符号，**漏一个会让路由静默 500**。
- `jest.setup.js` 默认 mock 回源与资源保护边界以隔离普通单测；资源限额集成测试必须 `jest.unmock('@/lib/upstream-resource-guard.server')`，并用 `installStreamPolyfills()` 安装真实流响应实现。
- `mysql-storage-contract.test.ts` 走 fake pool，不执行真 SQL，证明不了两侧谓词等价。`pnpm test:mysql` 启动一次性 MySQL 容器；普通 Jest 未配 `MYSQL_TEST_URL` 时会跳过真实 MySQL 用例，全绿不代表 MySQL 已验证。

## 验证

按**完整改动单元和风险**验证，不在每次编辑后重复全量执行。CI（`.github/workflows/quality.yml`）跑 `lint:strict`、`typecheck`、`test --runInBand`，本地以同一口径为准。

| 改动范围                               | 验证要求                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| 纯文档                                 | 检查链接、命令与当前实现；无需跑应用测试或构建                                          |
| 单一模块代码                           | 改动文件 ESLint、相关 Jest；TypeScript 改动加 `pnpm typecheck`；UI 交互加浏览器实际操作 |
| 跨模块、鉴权、数据写入、共享缓存或并发 | `pnpm lint:strict` → `pnpm typecheck` → `pnpm test --runInBand`                         |
| 发布、依赖或构建配置                   | 上述全量检查，加 `pnpm build`                                                           |

- 影响范围不明确时按全量处理；相关测试可用 `pnpm test --runInBand --runTestsByPath <文件>`。仅后续文档变化时可复用代码验证结果。
- 中文变更加 `pnpm check:encoding`；MySQL 查询、事务或共享存储变更加 `pnpm test:mysql`；性能改动按 [性能验证](docs/performance-baseline.md) 选择场景。
- 提交钩子只检查暂存文件的 lint / 格式，CI 不跑 `check:encoding` 与 `test:mysql`。说明实际检查及未覆盖项，不把 skip 当通过。

## 文档

`docs/` 的索引与维护规则见 [docs/README.md](docs/README.md)。改动使文档中的约束失效时同次更新对应文档。
