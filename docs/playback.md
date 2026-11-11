# 播放约束

改点播 / 直播播放、换源、分片缓存、弹幕或去广告前先读本文。阈值、超时、冷却以各策略文件为准，**不要在其他模块复制常量**。

## 模块入口

| 职责     | 位置                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 编排     | `src/features/play/lib/vodHlsRuntime.ts`                                                                                         |
| 流量路由 | `vodAutoRoutePolicy.ts`，代理模式 `src/lib/proxy-modes.ts`；以后台 `SourceConfig.proxyMode`（`browser` / `server` / `auto`）为准 |
| 画质     | `vodHlsQualityController.ts`、`vodQualityPolicy.ts`                                                                              |
| 前向缓冲 | `vodBufferBudgetPolicy.ts`、`vodBufferBudgetController.ts`                                                                       |
| 换源     | `src/features/play/hooks/useSourceSwitch.ts`                                                                                     |
| 快捷键   | 定义 `src/lib/player-shortcuts.ts` → 执行 `src/hooks/usePlayerKeyboard.ts` → 弹窗 `src/components/PlayerShortcutsModal.tsx`      |

新增快捷键动作依次补齐三处，不要在页面单独监听 keydown。

## 线路检测

- 点播清单、密钥与分片回源都传同一规则的 `resourceContext.identity`，[上游代理池](deployment.md#上游代理池)据此让同一用户走同一出口，漏传会静默变成轮询；清单与密钥只传标识不传 `kind`，避免改变资源额度类别。直播回源传 `useProxyPool: false`，不经代理池；点播分片仅在 `SiteConfig.UpstreamProxyPoolSegments` 为 `true` 时走代理池。新增 `SiteConfig` 字段须同步加入 `configSelfCheck()` 的字段白名单重建，否则保存后被静默丢弃。
- 「直连」（`browser`）由浏览器直接请求原始清单、子清单、密钥和分片；「代理」（`server`）全部经服务端，两种固定模式均不切线路。「自动」（`auto`）默认全程直连，同标签页存在该「源 + 清单主机」的代理成功记忆时先走代理。线路快照统一由 `getSourcePlaybackRoute()` 解析，异步入口先等待配置；`directManifest` 决定是否跳过服务端缓存预取。
- 直播线路由 `src/features/live/lib/livePlaybackRoute.ts` 自动决定，无站点或用户设置：所有 http(s) 频道先直连，https 页面上的 http 频道会被浏览器按混合内容立即拦截并回落，放行不安全内容且装有跨域插件的用户可直连成功。直连时顶层清单仍经 `/api/proxy/m3u8?allowCORS=true` 中转，子清单、密钥与分片由浏览器直取；直连尚未成功取到分片前，任一直连请求的网络错误立即回落服务器，起播后仅致命网络错误回落。本站代理请求的失败不触发回落。服务器中转因[月流量](deployment.md#月流量监控)暂停时，首个带暂停标记的失败即停止播放并提示，不再重试。回落按频道地址主机在 sessionStorage 记 30 分钟，另有进程内副本，防止存储不可用时反复切换。
- `/api/proxy-modes` 只返回站长配置。跨域、地区限制与网络可达性由用户浏览器的实际播放判定，服务端不做按源跨域能力探测。
- 自动模式在同一播放意图内按「源 + ID」保存已尝试线路和回落标记，每个源最多跨线路切换一次；换源次数只计算候选源尝试，线路回落不占名额。两路失败交给恢复耗尽的换源或报错路径。清单、子清单、密钥网络加载失败立即尝试另一条线路，分片沿用连续失败阈值；子清单与分片失败先经画质档判断（见「容错与换源」）。取消、离线、解码和缓冲配额错误不触发线路回落。
- 代理成功记忆存于 sessionStorage，按「源 + 清单 host」隔离，30 分钟有效；回落后同类型分片到达失败位置才写入，直连成功清除。线路开始切换与旧位置缓存命中均不写入成功记忆。
- 线路 `stat` 只记录实际线路的网络加载失败和成功；源健康 `outcome` 按播放意图中的站点 key 去重，每个尝试源成功起播或被放弃时上报一次，自动换源前也上报被放弃的中间源。单条线路失败只记线路统计，自动模式两路失败或详情不可用、缺集、懒解析和解码等源级失败才记源失败；固定模式无需尝试其他线路。取消、离线和过期意图不记健康结果。测速独立上报其最终可用结果。
- 选源偏好以当前浏览器为准：客户端起播优选与自动换源共用 `src/features/play/lib/sourceRoutePreference.ts`，先比较本地历史可靠性档，仅双方均为中性档时参考全局健康等级，再比较非 `server` 线路；上述条件仍平局且双方本地均中性时，最后按本人近 90 天观看时长降序。证据门槛与闲置衰减统一使用 `getSourcePlaybackPreferenceTier()`；可靠性差异在远端上下文缺失时仍生效，双方中性且线路或健康上下文为空时保留调用方顺序，同一非中性档只参考可用线路配置。自动换源先将有效测速失败者排后，测速唯一读源为 `sourceProbeStore`：预计算结果只补空位，后续面板测速与播放器结果覆盖旧值；使用现有 TTL 限制测量有效期，过期或排队、进行中、暂缓状态按未知处理。个人时长由 `/api/playback-stats/sources` 在现有选源上下文中后台加载，起播不等待该请求；缺失时保持原排序。自动换源只读 `peekSourceSelectionContext()` 缓存，无额外网络等待。`/api/search/quick` 保持服务端健康等级排序，同档内先发起直连源，中转源先解析出可播详情时最多再等 1.5 秒给仍未完成的同档或更优直连源。

## 缓冲

- 前向缓冲按码率收敛到字节预算，由控制器改写 `hls.config.maxMaxBufferLength`；码率极高时保留最少秒数下限，码率未知时沿用原配置。hls.js 的 `maxBufferSize` 是「至少缓冲到 `maxBufferLength`」的下限，不是字节上限，调它压不住 SourceBuffer 配额。
- `bufferFullError` 非致命：hls.js 已自行降低上限或清空缓冲后重下该分片，控制器再按实际配额收紧。**不计失败、不 `startLoad`，也不把上限抬回出错前的值**，否则同一分片反复重下再撞配额。

## 容错与换源

- 分片首字节超时只来自运行参数 `VodFragmentTimeoutSeconds`（源站下限在 `vodSourcePlaybackPolicy.ts`），自动路由的失败窗口由它派生。**不要另设分片超时**，与派生值脱节后失败窗口可能短于相邻两次失败的间隔，计数凑不满阈值，`auto` 静默不切线路。
- 清单里有两个以上可区分档位的 HLS 源都启用画质菜单与失败降档；`vodQualityPolicy.ts` 只为需要默认档、自动上下限或保留手动选择的源登记专属策略，未登记源走 hls.js 自动码率。
- 子清单或分片网络失败时先判断是否只坏单个画质档：失败档取自错误载荷（子清单 `context.level`、主轨分片 `frag.level`），不按当前播放档推测。还有未试线路时，只有本次清单在当前线路上已有**其他档**的主轨分片加载成功才先降档，否则照常切线路，保证整条线路不可用时直连首次失败即切代理；线路用尽后降档作为判源失败前的兜底，此时不写代理成功记忆。降档把自动码率上限压到目标档（新清单解析时解除），每个源在每条线路上最多降一次（记在 `VodSourceAttempt.qualityDowngradedRoutes`），降档后再失败交回线路回落或判源失败；降档不重置起播预算、不占换源名额。手动锁定的画质不自动降档。
- 其余 HLS 致命错误恢复统一走 `createHlsFatalRecoveryController()`（`src/lib/player-utils.ts`，点播直播共用）。直接 `startLoad()` 会绕过次数上限，坏流无限重试且不触发回落和换源；hls.js 非致命错误时仍在加载，降档只改档位，不调 `startLoad()`。
- 停止当前源用 `runManagedVideoCleanup()`。只调 `stopLoad()` 会被待执行的恢复重试或后续 `play` 事件重新拉流。
- 分片加载成功是否算恢复以 `handleFragmentLoaded()` 的返回值为准（同类型分片到达失败位置才算），直连与服务端的线路失败计数也随它清零。恢复拉流会先重下失败位置之前的分片，这些请求常命中浏览器缓存，**任意分片成功就清零会让坏流永远凑不满上限**。
- `hls.startLoad()` 会中止在途分片并重新请求，不是幂等的「确保在加载」。起播和 play 只在 `hls.loadingEnabled` 为 false 时补拉，卡顿恢复在有分片在途或缓冲仍在增长时不介入，**否则首片会被中止后整段重下**。
- 自动换源是用户本地开关，站点默认值 `SiteConfig.AutoSwitchSource`（默认关）。触发集中在 `useSourceSwitch.ts`：页面超时、恢复次数耗尽、懒解析失败，共用离线和意图身份守卫；网络加载失败先尝试当前源尚未使用的另一线路。换集、重试等新播放意图先调 `resetAutoSourceSwitch()`，同步递增请求代次并中止候选详情请求，详情正文解析后再次核对身份再提交；这样旧候选即使忽略中止信号也无法覆盖新集。
- 旧源的迟到回调（超时、错误、起播、统计）先确认运行时仍属于当前加载（`getVodRuntimeSourceUrl()` / `pauseIfVodRuntimeReleased()`），换源流程内再看 `sourceSwitchInFlightRef`。漏判时旧源失败会触发回退或换源、覆盖用户刚选的源，旧集进度也会带进新集。
- 换源提交后经 `replacePlayPageUrl()` 以 `window.history.replaceState(null, …)` 把地址改成新源，Next 据此同步路由地址与 `useSearchParams()`。state 必须传 `null`：沿用 `window.history.state` 时路由不同步，之后任一路由更新（刷新、开发热更新）会把地址栏改回换源前的源。页面状态和 `usePlayInit` 只在挂载时读一次地址参数，**不要让它们随 searchParams 变化重跑**，否则每次换源都重新搜索起播；`tab=reviews` 这类一次性入口参数由消费方打开对应面板后立即从地址移除，否则换源同步地址时参数串变化会再次触发；不要在 `replacePlayPageUrl()` 里删，起播时它可能早于消费方挂载。也不要用 `router.replace`，同路由软导航会重新请求服务端组件。

## 起播与起播等待

- 首次起播放行（`setLoading(false)`）前经 `waitForHistoryRestore()`（`usePlayProgress.ts`）等历史恢复定下集数和续播时间，`loading` 期间页面不派生 `videoUrl`。等待有上限（`usePlayInit.ts` 的 `HISTORY_RESTORE_WAIT_TIMEOUT_MS`），超时放行后播放记录迟到时再恢复、换集；恢复实际改变集索引时同步开启新播放意图并中止候选详情请求，同集恢复只更新续播时间。去掉等待会先按第 1 集建播放器再换集，白发清单与逐集解析请求。
- 播放页详情先取本地快照（`detailSnapshot.ts`）再后台回源，历史恢复可能已按快照定下集索引。回源详情替换快照时当前集须经 `remapEpisodeIndexToDetail()`（`src/lib/episode-groups.ts`）按分组身份换算，**直接沿用绝对索引会让分组源在靠前分组新增剧集后退到上一集**。
- 后台「运行参数 → 播放」的 `VodPageTimeoutSeconds` 控制媒体开始加载后的无进展窗口 W。hls.js 从拉清单开始计时，清单成功、分片字节增长或分片完成续期；原生播放从 `loadstart` 计时，缓冲增长和 `loadedmetadata` 续期。W 取配置值、源站起播下限与该源有效分片首字节超时的最大值。每个源尝试拥有独立的总预算 T = 4W；自动换源从候选详情请求开始重新计时，详情请求最多等待 W 后使用可用搜索详情，媒体加载沿用该源的起点。自动模式首条线路最迟在 3W 让出预算，回落重新计无进展时间且保留总起点，因此第二条线路至少获得完整 W，不会继承上一源耗尽的预算。
- 首次起播等待的最坏预算为各尝试源 T 之和，至多 `(1 + AUTO_SOURCE_SWITCH_MAX_ATTEMPTS) × max(T)`，当前最多 4 个源；页面轮询每次判定有至多 250 ms 的调度粒度，浏览器后台节流另计。成功起播关闭当前预算，后续播放故障以新的恢复起点计时，线路和换源尝试记录仍保留；新播放意图重置全部状态。
- 起播窗口只负责页面回落与换源，分片请求仍由 HLS 加载策略负责。候选源详情、懒解析等无运行时的准备阶段使用 W 兜底，详情请求有独立中止计时器；未命中缓存的懒解析从请求开始登记源尝试，媒体阶段沿用该起点，准备与媒体合计受 T 约束。普通首次加载的详情、历史恢复仍由 `loading` 门禁隔离，不计入媒体起播预算；页面轮询只读取预算，起点由准备阶段或媒体运行时登记。
- HLS 与原生线路回落均开启页面加载等待，恢复播放后收起加载态与线路提示；线路恢复只补报该线路成功，每个加载会话的起播通知与源成功统计仍只触发一次。原生与 HLS 共用受管回落入口，运行时释放时同步清除。

## 分片缓存与预取

- 每次改写清单都会变的分片参数（签名、切换标记等）必须登记到 `src/lib/segment-cache-key.ts` 的 `VOLATILE_SEGMENT_PARAMS`。SW 分片缓存和页面分片内存缓存都按它归一化缓存键，**漏登记只会静默不命中**。
- 分片内存缓存 `fragmentMemoryCache.ts` 命中时按条目记录的原始首字节与传输耗时回填加载统计，写入方必须记真实下载耗时。**否则 ABR 把内存交付当成超高带宽**，静默升到撑不住的画质。
- 播放、测速、可信候选验证与下一集预载共用线路快照及 `buildVodProxyUrl()`：清单直连时原样返回源站地址，其余模式带上相同的线路和源标识，匹配服务端缓存分区与地址改写。仅填充服务端缓存的清单预取（当前集、下一集及换源候选）在直连时跳过；下一集分片预载仍执行。测速与预载按每层响应的最终 URL 解析相对地址，不能沿用重定向前或上层清单地址。
- 源播放统计 `src/lib/source-playback-stats.ts` 按站点 key（`SearchResult.source`）读写，不是测速和自动换源用的 `{source}-{id}` 组合键，混用会让常用源判定静默落空。

## 弹幕

代码在 `src/features/play/lib/danmaku/`。

- 模式值两边不同：dandanplay `1/2/3` 滚动、`5` 顶部、`4` 底部；artplayer 插件 `0` 滚动、`1` 顶部、`2` 底部。颜色上游是十进制整数，插件要 CSS 字符串。**直接透传会让顶部 / 底部弹幕静默错位**，一律走 `normalize.ts`。
- `p` 字段 4 段时颜色在第 3 位，8/9 段时在第 4 位，取错只是颜色不对不会报错。
- 换集时播放器可能**复用实例**（非 webkit + 前后都是 hls），此时插件不会自行重新调用加载器，必须显式 `reloadDanmaku()`。去广告开关会 `destroy()` 重建，走的是另一条路。
- 弹幕行位由 `lane.ts` 在主线程计算：经补丁新增的 `getDanmuTop` 选项接管插件 worker 里的分配算法，从上往下取第一个不会追尾的位置。插件原算法优先找完全空着的行，弹幕稀疏时排成斜线。升级插件时须重新确认补丁里的钩子仍生效，否则静默退回原算法。
- 插件改动走 `patches/artplayer-plugin-danmuku@5.3.0.patch`（`pnpm patch` / `pnpm patch-commit`）。改补丁后本地 `pnpm build` 会沿用 `.next/cache/webpack` 里的旧模块，须先删除该目录再构建；Docker 构建不带 `.next`，不受影响。
- 重载期间插件的渲染循环不停，仍会往弹幕层投放弹幕，并按当时量到的宽高定位。隐藏旧弹幕用 `data-reloading` 属性配合 `globals.css` 的 `visibility: hidden !important`；**不能对弹幕层用 `display: none`**（量到的宽高为 0、过渡不执行，恢复后弹幕静止堆在左上角），也不能用 `opacity`（插件的显示 / 隐藏开关占用它）。
- 加载器在本地开关关闭时返回空数组以免白跑请求，所以**开关打开时必须触发一次 `reloadDanmaku()`**，只调 `api.show()` 显示的是空数据。
- 弹幕剧集映射按 `源:ID:集` 隔离。换源提交时经 `carryOverDanmakuEpisodeMapping()` 把同一集已匹配的映射带到新源，否则新源按自己的标题重搜，标题格式不同就静默落空。
- `provider.server.ts` 的 base URL 只来自环境变量，用户输入只经 `searchParams` 进 query。默认走 URL guard；内网自建服务须显式设置 `DANMAKU_API_ALLOW_PRIVATE=true`，经 `fetchPrivateUpstream()` 回源，仍受共享资源额度保护。
- 后台弹幕「请求超时」只约束到响应头到达，响应体读取受共享资源层的总时限约束。

### 用户弹幕

共享规则在 `src/lib/user-danmaku.ts`，服务端以它为准；站点开关 `EnableUserDanmaku` 依赖 `EnableDanmaku`，两者都开才放行发送。

- 归属键：当前集匹配到第三方弹幕集时用 `dandan:<episodeId>`，跨播放源共享；否则用 `src:<源:ID:集>`，只在该源内可见。之后再匹配到弹幕集，之前按 `src:` 存的弹幕不会迁移。
- 时间存的是弹幕集时间轴上的秒数：发送时减去用户校准偏移，读取后与第三方弹幕一起 `applyOffset`。**直接存播放器时间会让调过偏移的用户之间错位。**
- 条数预算：服务端每集最多返回 `DanmakuEpisodeLimit × USER_DANMAKU_BUDGET_RATIO` 条最新用户弹幕，客户端把第三方弹幕抽稀到剩余额度后合并，总量仍不超过 `DanmakuEpisodeLimit`。用户弹幕拉取失败时只展示第三方弹幕。
- 发送走插件内置输入框的 `beforeEmit`：返回 `true` 由插件本地回显（自己的弹幕带边框），返回 `false` 不回显。请求期间换集只保存不回显，归属键在加载器 `onUserTarget` 回调里随当前集更新。
- 新弹幕附带作品标题与年份，管理员删除弹幕的通知据此按作品合并；早期弹幕没有作品信息，只能按归属键分组。

## 播放偏好的保存

- 跳过片头片尾配置按源与视频键串行提交，连续设置以最后一次为准；最后一次失败时恢复最后确认的值，并同步播放器设置面板的显示。
- 弹幕开关的账号同步失败时保留本机已生效的状态，只提示同步失败；去广告开关重建失败时恢复开关与偏好。弹幕剧集绑定 / 清除的服务端失败不走成功界面。

## 去广告

- 去广告统一在客户端执行，播放器清单加载器与下一集预载共用 `ad-segment-detector.ts` 的 `filterM3U8AdsForSource()`，均遵守用户去广告开关。服务端缓存原始清单，只负责地址改写。
- 源规则注册在 `ad-filter-strategy-registry.ts`：未注册源使用 `playUtils.ts` 的通用过滤；`rycj` 使用 EXTINF、局部时长偏移、主机异常、周期时长与短边缘块等纯文本信号，周期布局经 `ad-filter-manifest.ts` 连续化重建。
- 新增源规则在注册表组合现有 signal 与时间轴策略，无法表达时才扩展检测器；补源站 fixture，验证广告删除、正片保留和时间轴边界。源专用规则与通用规则二选一，避免二次重建。
- 播放器加载器可跨源复用，过滤时从 `detailRef.current` 读取当前源；下一集预载按当前会话源选择同一规则。主机异常检测经 `resolveSegmentAssetUri()` 还原代理地址，并以响应最终清单 URL 解析相对地址，保持直连与代理的判定一致。
- 客户端过滤只在 hls.js 加载清单时生效。iPadOS / Safari 17+ 下 hls.js 用 ManagedMediaSource，以 blob: 的 `<source>` 挂载；`ensureVideoSource()` 必须让它留在最前，播放地址只作为末尾的 AirPlay 备选，否则 Safari 选中 m3u8 原生播放，广告原样播出。
