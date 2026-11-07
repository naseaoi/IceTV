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

## 缓冲

- 前向缓冲按码率收敛到字节预算，由控制器改写 `hls.config.maxMaxBufferLength`；码率极高时保留最少秒数下限，码率未知时沿用原配置。hls.js 的 `maxBufferSize` 是「至少缓冲到 `maxBufferLength`」的下限，不是字节上限，调它压不住 SourceBuffer 配额。
- `bufferFullError` 非致命：hls.js 已自行降低上限或清空缓冲后重下该分片，控制器再按实际配额收紧。**不计失败、不 `startLoad`，也不把上限抬回出错前的值**，否则同一分片反复重下再撞配额。

## 容错与换源

- 分片首字节超时只来自运行参数 `VodFragmentTimeoutSeconds`（源站下限在 `vodSourcePlaybackPolicy.ts`），自动路由的失败窗口和探测超时由它派生。**不要另设分片超时**，与派生值脱节后失败窗口可能短于相邻两次失败的间隔，计数凑不满阈值，`auto` 静默不切线路。
- HLS 致命错误先尝试画质降级（`vodHlsQualityController.ts`，受可用档位约束），其余恢复统一走 `createHlsFatalRecoveryController()`（`src/lib/player-utils.ts`，点播直播共用）。直接 `startLoad()` 会绕过次数上限，坏流无限重试且不触发回落和换源。
- 停止当前源用 `runManagedVideoCleanup()`。只调 `stopLoad()` 会被待执行的恢复重试、代理探测或后续 `play` 事件重新拉流。
- 分片加载成功是否算恢复以 `handleFragmentLoaded()` 的返回值为准（同类型分片到达失败位置才算），直连与服务端的线路失败计数也随它清零。恢复拉流会先重下失败位置之前的分片，这些请求常命中浏览器缓存，**任意分片成功就清零会让坏流永远凑不满上限**。
- `hls.startLoad()` 会中止在途分片并重新请求，不是幂等的「确保在加载」。起播和 play 只在 `hls.loadingEnabled` 为 false 时补拉，卡顿恢复在有分片在途或缓冲仍在增长时不介入，**否则首片会被中止后整段重下**。
- 自动换源是用户本地开关，站点默认值 `SiteConfig.AutoSwitchSource`（默认关）。触发集中在 `useSourceSwitch.ts`：页面超时、恢复次数耗尽、懒解析失败，前两种先试服务端回落。换集、重试等新播放意图先调 `resetAutoSourceSwitch()`，否则失败记录和次数上限跨集累积，自动换源静默停摆。
- 旧源的迟到回调（超时、错误、起播、统计）先确认运行时仍属于当前加载（`getVodRuntimeSourceUrl()` / `pauseIfVodRuntimeReleased()`），换源流程内再看 `sourceSwitchInFlightRef`。漏判时旧源失败会触发回退或换源、覆盖用户刚选的源，旧集进度也会带进新集。
- 换源提交后经 `replacePlayPageUrl()`（`window.history.replaceState`）把地址改成新源。Next 会把它同步进 `useSearchParams()`，所以页面状态和 `usePlayInit` 只在挂载时读一次地址参数，**不要让它们随 searchParams 变化重跑**，否则每次换源都重新搜索起播；也不要用 `router.replace`，同路由软导航会重新请求服务端组件。

## 起播与起播等待

- 首次起播放行（`setLoading(false)`）前经 `waitForHistoryRestore()`（`usePlayProgress.ts`）等历史恢复定下集数和续播时间，`loading` 期间页面不派生 `videoUrl`。等待有上限（`usePlayInit.ts` 的 `HISTORY_RESTORE_WAIT_TIMEOUT_MS`），超时放行后播放记录迟到时再恢复、换集。去掉等待会先按第 1 集建播放器再换集，白发清单与逐集解析请求。
- 播放页详情先取本地快照（`detailSnapshot.ts`）再后台回源，历史恢复可能已按快照定下集索引。回源详情替换快照时当前集须经 `remapEpisodeIndexToDetail()`（`src/lib/episode-groups.ts`）按分组身份换算，**直接沿用绝对索引会让分组源在靠前分组新增剧集后退到上一集**。
- 后台「运行参数 → 播放」的 `VodPageTimeoutSeconds` 控制媒体开始加载后的无进展窗口。hls.js 从拉清单开始计时，清单成功、分片字节增长或分片完成续期；原生播放从 `loadstart` 计时，缓冲增长和 `loadedmetadata` 续期。实际窗口取配置值、源站起播下限与该源有效分片首字节超时的最大值，每次线路加载另受窗口 4 倍的总时长上限约束；服务端回落开始新一轮加载，重新计时。
- 起播窗口只负责页面回落与换源，分片请求仍由 HLS 加载策略负责。详情获取、历史恢复等准备阶段只有挂载了 `PlayMainContent` 的入口受总时长兜底，普通首次加载显示加载页时不计时。

## 分片缓存与预取

- 每次改写清单都会变的分片参数（签名、切换标记等）必须登记到 `src/lib/segment-cache-key.ts` 的 `VOLATILE_SEGMENT_PARAMS`。SW 分片缓存和页面分片内存缓存都按它归一化缓存键，**漏登记只会静默不命中**。
- 分片内存缓存 `fragmentMemoryCache.ts` 命中时按条目记录的原始首字节与传输耗时回填加载统计，写入方必须记真实下载耗时。**否则 ABR 把内存交付当成超高带宽**，静默升到撑不住的画质。
- 预取清单（换源候选、下一集预载）用 `buildVodProxyUrl()` 带上与播放器相同的线路和源标识。服务端清单缓存按源分区、分片地址随线路改写，任一不一致都静默不命中。
- 源播放统计 `src/lib/source-playback-stats.ts` 按站点 key（`SearchResult.source`）读写，不是测速和自动换源用的 `{source}-{id}` 组合键，混用会让常用源判定静默落空。

## 弹幕

代码在 `src/features/play/lib/danmaku/`。

- 模式值两边不同：dandanplay `1/2/3` 滚动、`5` 顶部、`4` 底部；artplayer 插件 `0` 滚动、`1` 顶部、`2` 底部。颜色上游是十进制整数，插件要 CSS 字符串。**直接透传会让顶部 / 底部弹幕静默错位**，一律走 `normalize.ts`。
- `p` 字段 4 段时颜色在第 3 位，8/9 段时在第 4 位，取错只是颜色不对不会报错。
- 换集时播放器可能**复用实例**（非 webkit + 前后都是 hls），此时插件不会自行重新调用加载器，必须显式 `reloadDanmaku()`。去广告开关会 `destroy()` 重建，走的是另一条路。
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

## 去广告

- 策略注册 `ad-filter-strategy-registry.ts`，清单重建 `ad-filter-manifest.ts`，服务端检测 `ad-segment-detector.ts`（均在 `src/features/play/lib/`）。
- 新源优先组合现有 signal，无法表达时才新增检测器。
- 每个服务端策略有独立 `id` 和 `version`，规则变化时递增 `version`（它参与缓存键）。
- 新增策略补源站 fixture，验证广告删除、正片保留、时间轴边界。
- 服务端策略源不再跑客户端通用过滤，避免清单被二次重建。
