# 源站、搜索与健康度约束

改搜索、源站接入、源站健康或探测前先读本文。

## 搜索

- 聚合执行 `runSearchAggregation()`，聚合缓存 `src/lib/search-cache.ts`，失败源冷却 `src/lib/search-aggregate.ts`。不要在页面层重新实现聚合、缓存或失败冷却。
- `/api/search` 命中新鲜缓存直接返回；命中过期缓存先返回旧结果再后台刷新。
- 单源异常（含回源额度申请失败）在聚合内吞掉并返回空结果，整体搜索仍可 200；判断源是否可用看健康数据，不看搜索接口状态码。

## 源站健康

- 质量分与等级由 `src/lib/source-health.server.ts` 汇总、`src/lib/source-quality-policy.ts` 计算，阈值、权重、样本门槛、探测关键词与并发只在策略文件定义。评分用平滑比率，接口返回的比率是原始值，供展示。后台手动排序决定面板展示顺序，运行时只在同一等级内沿用配置顺序作为兜底。
- 搜索样本只在 `downstream.ts` 的 `fetchAndCacheSearchPage()` 第 1 页采集；缓存命中、父级中止、`ResourceLimitError` 不计，giri / xgcartoon 等特殊源没有搜索样本。新增搜索路径若绕过该函数，质量分会静默缺样本。
- 搜索样本先在进程内累加，距上次写库超过间隔后由下一次记录触发写库；读报告前只刷新本模块实例的缓冲，其他实例或路由包的样本要等它们下一次记录才可见。
- 播放样本经 `POST /api/source-route-stats` 写入 `source_health_play`，按「源 × 日 × 上报者」聚合：同一上报者当天有任一成功即记成功日，评分按上报者日而非请求次数计算。上报者是用户名的 HMAC，不存用户名，因此不纳入删号、合并与导入导出，靠 cron `metadata` 任务按保留期清理。两张健康表都不导出，`clearAllData()` 与 `replaceAllData()` 清空。
- 搜索、流式搜索、快速起播、搜索建议经 `getSourceHealthTiers()` + `rankSourcesByHealth()` 按**等级**排序后再调度或截取。不按分数排：分数随每批样本变化，而搜索聚合缓存键包含源顺序，按分数排会让缓存反复失效。新增按源顺序取舍的入口须同样排序；健康数据读取失败时降级为配置顺序。
- 失联源仍参与搜索，只缩短单源预算；预算触发的中止属于父级中止，不计样本，恢复靠定时探测发现。
- 失联源只标记，不自动停用：停用后不再产生样本，恢复无法被发现。

## 探测

由 cron `metadata`、`all`、`source-health` 执行（调度见 [部署](deployment.md#定时维护与源站探测)）。只请求启用普通源的搜索第一页，跳过搜索缓存读取，沿用真实搜索的样本分类与回源资源额度，结束后刷新样本缓冲；giri、xgcartoon 跳过，关键词按 UTC 日期轮换。

## 逐集解析型源站

统一用 `icetv-lazy://`：详情阶段返回懒地址，播放时经 `/api/episode-url` 解析。新增源动三处：

1. `src/lib/lazy-episodes.ts`：新增 kind 与路径白名单正则
2. `src/lib/downstream-sources/<site>.ts`：`episodes` 用 `buildLazyEpisodeUrl(kind, path)`，导出 `resolveXxxEpisodeUrlByPath(apiSite, path)`
3. `src/app/api/episode-url/route.ts`：在 `matchesLazyKind` 和 `resolveEpisodeUrl` 接上新 kind

不要在详情阶段全量抓播放页，不要绕过 `/api/episode-url` 在客户端直接解析源站地址。
