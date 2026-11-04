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

## 视频评价

- 评价按作品身份存储：`normalizeWorkTitle()` + `normalizeWorkYear()`（`src/lib/source-match.ts`），与换源候选、搜索聚合共用同一归一化。**改归一化规则会让已存评价静默匹配不到**，换源后也不再继承。
- `title_norm` 与 `year` 由服务端计算，不信任客户端。MySQL 列须保持 `utf8mb4_bin`，换成 `_ci` 排序规则会让两种存储的匹配结果不一致。
- 年份为空视为通配：查询用 `year IN (?, '')`，PUT 命中空年份记录时沿用其年份，避免同一作品出现两份评价。收藏页在客户端按同一规则（精确年份优先、空年份兜底）把评分映射到卡片，见 `src/features/favorites/lib/favorite-library.ts`。
- 评分为 1.0–10.0 的一位小数：服务端先校验范围再 `Math.round(r * 10) / 10`，前端换算与展示统一走 `src/lib/rating.ts`，不要各处手写 `toFixed` 或步进精度。
- 正文上限是前后端共用的 `REVIEW_CONTENT_MAX_LENGTH`（`src/lib/video-reviews.ts`），前端计数与服务端校验都引用它，不要另写数字。
- 私密评价只对作者可见；作品汇总、后台列表与后台删除都带 `is_public = 1`。新增读取路径须同样过滤。
- 收藏仍按 `source+id`，评价与收藏相互独立：保存评价时由前端补收藏，取消收藏不删评价。
- 新增按用户分表的数据时，`deleteUser`、`clearAllData`、`replaceAllData`、导入导出与 SQLite 用户名大小写合并都要覆盖，`video_reviews` 是现成参照。
- 公开评价、个人主页、关注列表与关注动态只返回 `profileId` 和昵称，登录名仅用于服务端身份和后台接口。
- 每个 `users` 行必须有 `user_profiles` 行；建号同事务写入，初始化与 `replaceAllData()` 结尾补齐，站长无 `users` 行，在会话恢复时按需 `ensureUserProfile()`。用户名比较先归一化。
- `user_profiles`、`user_follows`、`video_review_likes`、`video_review_reports` 的删除、清空、替换、导入导出与 SQLite 大小写合并必须覆盖所有用户名列；删除评价同事务清理点赞与举报。导入昵称冲突置空、资料标识冲突重生成。
- 保存评价、点赞、举报和关注的服务端写入口必须校验昵称，缺失返回 403 `NICKNAME_REQUIRED`；注册昵称与账号同事务保存，失败释放邀请码名额。

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

- 只被一个业务域使用的代码放 `src/features/<domain>/`，被两个及以上复用才上提。
- `page.tsx`、`route.ts` 优先做装配，不堆业务细节。
- 跨目录导入统一走 `@/...`，同目录内可用相对路径。
- 动态 import 也用 `@/` 路径（`moduleResolution: bundler`，裸相对路径在 Turbopack 与 Webpack 下行为不一致）。

## 界面组件

- 下拉统一用 `src/components/Select.tsx`（`field` 表单整宽、`pill` 工具栏胶囊），`AdminSelect` 只是 `field` 的包装。不要再写原生 `<select>`。
- `@tailwindcss/forms` 会给所有原生 input / select / textarea 加边框、内边距和背景箭头。自定义样式的控件须显式 `border-0`、重置 padding、`focus:ring-0`（select 再加 `bg-none`），否则在浅色模式出现灰框或文字被裁切。
- `tailwind.config.ts` 含 raw 断点（`split`），Tailwind 因此**不生成 `max-sm:` / `max-md:` 等 `max-*` 变体**，写了也静默无效。窄屏样式写成基础类加 `sm:` / `md:` 覆盖，窄屏横屏用 `phone-landscape:`。
- 强调色统一用 `brand-*`（`tailwind.config.ts` 定义的冰蓝色阶），`gray` 已覆盖为冷调中性灰；分区标题等装饰统一用中性灰，主色只出现在选中态、进度和主操作上。
- 桌面端导航是 `src/components/TopNav.tsx`（由 `PageLayout` 挂载），页面水平容器统一用 `PAGE_CONTAINER_CLASS`（`src/components/page-container.ts`），否则内容与导航左边缘错位。
- 移动端顶部区域由 `PageLayout` 按路径决定：首页与 `/douban` 走 `MobileChannelHeader`（频道条，频道列表与高亮规则在 `src/components/channel-nav.ts`，与桌面顶栏共用），其余页面走 `MobileHeader`；传 `mobileHeader={false}` 表示页面自带顶部区域（搜索、`/me`）。频道页忽略 `mobileHeader` 的标题和操作按钮，入口不要放在那里
- 页面滚动发生在 `document.body` 上，监听或回顶统一用 `src/hooks/usePageScroll.ts`，只监听 `window` 会静默失效。Next 导航自带的滚动重置只作用于 `documentElement`，换页位置由根布局的 `PageScrollRestorer` 接管（新页面回顶、前进后退恢复），不要在页面里另写换页回顶
- 账号相关能力（退出、登录跳转、版本更新标记、设置/改密/版本面板）在 `src/components/user-menu/`，桌面 `UserMenu` 与移动端 `/settings` 共用
- `/me` 下各标签页的外壳（`PageLayout`、个人横幅、标签栏）由 `app/me/layout.tsx` 的 `MeShell` 提供，子页面与其 `loading.tsx` 只渲染内容区，**再套 `PageLayout` 会出现双层导航**。概览页及其骨架放在路由组 `app/me/(overview)/`，`app/me/` 根目录不放 `loading.tsx`，否则冷加载其他标签会先闪出概览骨架。海报网格统一用 `POSTER_GRID_CLASS`（`src/components/poster-grid-layout.ts`）
- 加载反馈统一入口：骨架块用 `globals.css` 的 `skeleton` 类（自带底色与扫光，只加在叶子块上，父子叠加会出现两层动画），转圈用 `src/components/Spinner.tsx`（ArtPlayer 缓冲图标复用其 `SPINNER_MARKUP`），整页加载/错误用 `LoadingStatePanel`，播放器内遮罩用 `PlayerStateOverlay`。不要再手写 `animate-pulse` 灰块或 `animate-spin` 图标。`PlayerStateOverlay` 须与播放器容器同级挂在 `playerOverlay` 位置，`globals.css` 靠 `:has()` 在遮罩显示时隐藏内置缓冲指示
- 长文本折叠用 `src/components/ExpandableText.tsx`；弹窗外壳 `ModalShell` 支持 `backdropClassName`（遮罩底色）与 `initialFocusRef`（打开后聚焦的元素）。
- 弹窗、下拉、浮层用实底（`bg-white` / `dark:bg-gray-900` + 细 ring），遮罩只压暗不模糊；毛玻璃只留给吸顶导航与筛选栏。弹窗标题、关闭与按钮复用 `src/components/modals/modal-styles.ts`。

## 本地设置

不要在页面或组件里分散读写 `localStorage`，各有 helper：布尔开关 `local-preference-toggles.ts`、其他偏好 `local-preferences.ts`、Bangumi `bangumi-source.ts`、Douban `douban-source.ts`、播放器快捷键 `player-shortcuts.ts`、源播放统计 `source-playback-stats.ts`（均在 `src/lib/`）。

新增设置先补 helper，再让设置面板和消费方接入，不要各自手写 key 和默认值。

## 搜索

聚合执行 `runSearchAggregation()`，聚合缓存 `src/lib/search-cache.ts`，失败源冷却 `src/lib/search-aggregate.ts`。`/api/search` 命中缓存时先返回旧结果再后台刷新。不要在页面层重新实现聚合、缓存或失败冷却。

## 外部请求

- 复用 `authorizeProxyRequest()`、`fetchWithUrlGuard()`、`validateProxyUrlForRequest()`。签名 `src/lib/proxy-auth.ts`，校验 `src/lib/url-guard.ts`。
- **不要直接 `fetch` 未经校验的外部输入 URL**。
- 普通服务端回源复用 `fetchUpstream()` / `fetchWithUrlGuard()`，它们会申请数据库共享资源额度。得到的响应体必须消费或取消，连接租约不会在响应头到达时释放。

## 播放

流量路由以后台 `SourceConfig.proxyMode` 为准：`browser` 直连、`server` 走服务端、`auto` 按失败策略探测切换。阈值、超时、冷却以策略文件为准，**不要在其他模块复制常量**。

- 编排 `src/features/play/lib/vodHlsRuntime.ts`，自动路由 `vodAutoRoutePolicy.ts`，代理模式 `src/lib/proxy-modes.ts`
- 画质 `vodHlsQualityController.ts`、`vodQualityPolicy.ts`
- 前向缓冲按码率封顶到 `vodBufferBudgetPolicy.ts` 的字节预算，由 `vodBufferBudgetController.ts` 改写 `hls.config.maxMaxBufferLength`。hls.js 的 `maxBufferSize` 是「至少缓冲到 `maxBufferLength`」的下限，不是字节上限，调它压不住 SourceBuffer 配额。`bufferFullError` 非致命，hls.js 已自行降低上限并重下该分片，**不计失败、不 `startLoad`，也不把上限抬回 hls.js 降低前的值**，否则同一分片反复重下再撞配额
- 快捷键：定义 `src/lib/player-shortcuts.ts` → 执行 `src/hooks/usePlayerKeyboard.ts` → 弹窗 `src/components/PlayerShortcutsModal.tsx`。新增动作依次补齐三处，不要在页面单独监听 keydown

容错与换源：

- 分片首字节超时只来自运行参数 `VodFragmentTimeoutSeconds`（源站下限在 `vodSourcePlaybackPolicy.ts`），自动路由的失败窗口和探测超时由它派生。**不要另设分片超时**，与派生值脱节后失败窗口可能短于相邻两次失败的间隔，计数凑不满阈值，`auto` 静默不切线路
- HLS 致命错误恢复统一走 `createHlsFatalRecoveryController()`（`src/lib/player-utils.ts`，点播直播共用）。直接 `startLoad()` 会绕过次数上限，坏流无限重试且不触发回落和换源。停止当前源用 `runManagedVideoCleanup()`，只调 `stopLoad()` 会被待执行的恢复重试或代理探测重新拉流
- 分片加载成功是否算恢复以 `handleFragmentLoaded()` 的返回值为准（同类型分片到达失败位置才算），直连与服务端的线路失败计数也随它清零。恢复拉流会先重下失败位置之前的分片，这些请求常命中浏览器缓存，**任意分片成功就清零会让坏流永远凑不满上限**，不回落也不换源
- `hls.startLoad()` 会中止在途分片并重新请求，不是幂等的「确保在加载」。起播和 play 只在 `hls.loadingEnabled` 为 false 时补拉，卡顿恢复在有分片在途或缓冲仍在增长时不介入，**否则首片会被中止后整段重下**
- 自动换源是用户本地开关，站点默认值 `SiteConfig.AutoSwitchSource`（默认关）。触发集中在 `useSourceSwitch.ts`：页面超时、恢复次数耗尽、懒解析失败，前两种先试服务端回落。换集、重试等新播放意图先调 `resetAutoSourceSwitch()`，否则失败记录和次数上限跨集累积，自动换源静默停摆
- 旧源的迟到回调（超时、错误、起播、统计）先确认运行时仍属于当前加载（`vodHlsRuntime.ts` 的 `getVodRuntimeSourceUrl()` / `pauseIfVodRuntimeReleased()`），换源流程内再看 `sourceSwitchInFlightRef`。漏判时旧源失败会触发回退或换源、覆盖用户刚选的源，旧集进度也会带进新集
- 换源提交后经 `replacePlayPageUrl()`（`window.history.replaceState`）把地址改成新源。Next 会把它同步进 `useSearchParams()`，所以页面状态和 `usePlayInit` 只在挂载时读一次地址参数，**不要让它们随 searchParams 变化重跑**，否则每次换源都重新搜索起播；也不要用 `router.replace`，同路由软导航会重新请求服务端组件

分片缓存与起播：

- 每次改写清单都会变的分片参数（签名、切换标记等）必须登记到 `src/lib/segment-cache-key.ts` 的 `VOLATILE_SEGMENT_PARAMS`。SW 分片缓存和页面分片内存缓存都按它归一化缓存键，**漏登记只会静默不命中**
- 分片内存缓存 `fragmentMemoryCache.ts` 命中时按条目记录的原始首字节与传输耗时回填加载统计，写入方必须记真实下载耗时。**否则 ABR 把内存交付当成超高带宽**，静默升到撑不住的画质
- 预取清单（换源候选、下一集预载）用 `buildVodProxyUrl()` 带上与播放器相同的线路和源标识。服务端清单缓存按源分区、分片地址随线路改写，任一不一致都静默不命中
- 源播放统计 `source-playback-stats.ts` 按站点 key（`SearchResult.source`）读写，不是测速和自动换源用的 `{source}-{id}` 组合键，混用会让常用源判定静默落空
- 首次起播放行（`setLoading(false)`）前须经 `waitForHistoryRestore()`（`usePlayProgress.ts`）等历史恢复定下集数和续播时间，`loading` 期间页面不派生 `videoUrl`。提前放行会先按第 1 集建播放器再换集，白发清单与逐集解析请求
- 播放页详情先取本地快照（`detailSnapshot.ts`）再后台回源，历史恢复可能已按快照定下集索引。回源详情替换快照时当前集须经 `remapEpisodeIndexToDetail()`（`src/lib/episode-groups.ts`）按分组身份换算，**直接沿用绝对索引会让分组源在靠前分组新增剧集后退到上一集**

弹幕（`src/features/play/lib/danmaku/`）：

- 模式值两边不同：dandanplay `1/2/3` 滚动、`5` 顶部、`4` 底部；artplayer 插件 `0` 滚动、`1` 顶部、`2` 底部。颜色上游是十进制整数，插件要 CSS 字符串。**直接透传会让顶部/底部弹幕静默错位**，一律走 `normalize.ts`
- `p` 字段 4 段时颜色在第 3 位，8/9 段时在第 4 位，取错只是颜色不对不会报错
- 换集时播放器可能**复用实例**（非 webkit + 前后都是 hls），此时插件不会自行重新调用加载器，必须显式 `reloadDanmaku()`。去广告开关会 `destroy()` 重建，走的是另一条路
- 加载器在本地开关关闭时返回空数组以免白跑请求，所以**开关打开时必须触发一次 `reloadDanmaku()`**，只调 `api.show()` 显示的是空数据
- 弹幕剧集映射按 `源:ID:集` 隔离。换源提交时经 `carryOverDanmakuEpisodeMapping()` 把同一集已匹配的映射带到新源，否则新源按自己的标题重搜，标题格式不同就静默落空成「暂未获取到弹幕」
- `provider.server.ts` 的 base URL 只来自环境变量，用户输入只经 `searchParams` 进 query。默认走 URL guard；内网自建服务须显式设置 `DANMAKU_API_ALLOW_PRIVATE=true`，经 `fetchPrivateUpstream()` 回源，仍受共享资源额度保护。

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
- 设置类内容用 `AdminSettings.tsx` 的 `AdminSettingsGroup` / `AdminSettingRow`，开关用 `AdminStatusSwitch`，列表行操作收进 `AdminRowMenu`。`ADMIN_PANEL_CLASS` 外框不裁切溢出，行内下拉才能伸出；贴边底色的子元素自行加圆角，不要给外框补 `overflow-hidden`

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
- `jest.setup.js` 默认 mock 回源与资源保护边界以隔离普通单测；资源限额集成测试必须 `jest.unmock('@/lib/upstream-resource-guard.server')`，并用 `installStreamPolyfills()` 安装真实流响应实现。
- `mysql-storage-contract.test.ts` 走 fake pool，不执行真 SQL，证明不了两侧谓词等价。`pnpm test:mysql` 启动一次性 MySQL 容器；普通 Jest 未配 `MYSQL_TEST_URL` 时会跳过真实 MySQL 用例。

## 验证

按**完整改动单元和风险**验证，不在每次编辑后重复全量执行。

| 改动范围                               | 验证要求                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| 纯文档                                 | 检查链接、命令与当前实现；无需跑应用测试或构建                                          |
| 单一模块代码                           | 改动文件 ESLint、相关 Jest；TypeScript 改动加 `pnpm typecheck`；UI 交互加浏览器实际操作 |
| 跨模块、鉴权、数据写入、共享缓存或并发 | `pnpm lint` → `pnpm typecheck` → `pnpm test --runInBand`                                |
| 发布、依赖或构建配置                   | 上述全量检查，加 `pnpm build`                                                           |

- 影响范围不明确时按全量处理；相关测试可用 `pnpm test --runInBand --runTestsByPath <文件>`。仅后续文档变化时可复用代码验证结果。
- 中文变更加 `pnpm check:encoding`；MySQL 查询、事务或共享存储变更加 `pnpm test:mysql`；性能改动按 [性能基线](docs/performance-baseline.md) 选择场景。
- 提交钩子只检查暂存文件的 lint / 格式；CI 的全量检查不代替本地功能验证。说明实际检查及未覆盖项，不把 skip 当通过。

## 文档边界

- 维护文档只保留当前约束、易误读边界与必要操作。实现细节看代码，不重复通用工程规范。
- 不保留审查经过、试错记录、一次性测试数字或过期结论。改动历史看 git log；`CHANGELOG.md` 专门保留用户可见的版本变化。
- 同一事实只在一处维护，其余用链接。部署参数见 `.env.example`，发布规则见 `docs/release.md`。
