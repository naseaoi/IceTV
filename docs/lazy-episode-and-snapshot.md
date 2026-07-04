# 播放链路优化方案：集数懒解析 + 详情快照秒播

> 状态：已实现（2026-07-04），单测通过，待本地 e2e 验证（清单 2、3 项）
> 关联背景：giri / 西瓜卡通两类"逐集抓播放页换 m3u8"的源站，详情阶段全量回源导致打开慢、易触发上游限流。

## 一、问题

### 1.1 全量预解析（giri / 西瓜卡通）

这两类源站的集数列表来自详情页 HTML，但**每一集的真实 m3u8 需要单独抓一次该集的播放页**才能提取：

- giri：`/playGV{id}-{group}-{n}/` 页内 `var player_aaaa = {...}`
- 西瓜卡通：`/video/{cartoonId}/{chapterId}.html` 页内 `player.htm?vid=` → 拼 CDN playlist

当前 `getDetailFromGirigiri` / `getDetailFromXgcartoon` 在详情阶段以并发 4 把全部集数解析完。后果：

- 一部 77 集的番剧 = 78 个上游请求/次详情调用；
- 打开详情/播放页需等待全量解析完成（十几秒起）；
- 短时间重复访问会触发上游限流（已实测发生）；
- 单集解析偶发失败会静默丢集（第 22 集缺失问题的根源）。

### 1.2 续看路径重复回源

播放页链路固定为 `/api/detail` → 起播。服务端 SWR 缓存仅进程内（新鲜 10 分钟），客户端缓存仅内存（3 分钟、刷新即失）。"继续观看"隔天进来必然重新走一遍全量详情抓取。

## 二、方案 1：集数懒解析（lazy resolution）

### 2.1 核心思路

详情阶段只抓 1 次详情页拿结构（集数名 + 每集的上游路径），不解析任何 m3u8；真正播放某一集时按需解析那一集。上游压力从每次详情 O(N) 降为每看一集 O(1)。

### 2.2 懒地址协议

`episodes[]` 中该类源改存内部标记地址：

```
icetv-lazy://giri/playGV25627-1-9/
icetv-lazy://xgcartoon/video/{cartoonId}/{chapterId}.html
```

- 定义在 `src/lib/lazy-episodes.ts`（前后端共用，无服务端依赖）：`buildLazyEpisodeUrl` / `parseLazyEpisodeUrl` / `isLazyEpisodeUrl`。
- 解析时按 kind 做严格路径白名单校验：
  - giri：`^/playGV\d+-\d+-\d+/$`
  - xgcartoon：`^/video/[\w-]+/[\w-]+\.html$`

### 2.3 服务端

- `src/lib/downstream-sources/giri.ts`：`getDetailFromGirigiri` 不再逐集抓播放页，`episodes` 直接映射为懒地址；导出 `resolveGirigiriEpisodePlayUrlByPath(apiSite, playPath)` 供按需解析。
- `src/lib/downstream-sources/xgcartoon.ts`：同上，`episode_groups` 计数改为结构计数（不再有解析失败丢集，天然修复缺集类问题）；导出 `resolveXgcartoonEpisodeUrlByPath(apiSite, path)`。
- 新增 `GET /api/episode-url?source={key}&url={lazyUrl}`（`src/app/api/episode-url/route.ts`）：
  - 复用 `requireActiveUser` 鉴权；
  - 校验懒地址格式 + source 对应的 apiSite 类型与 kind 匹配（giri 地址只允许发往 giri 源站，杜绝 SSRF）；
  - 进程内 SWR 缓存（生产启用）：新鲜 30 分钟、软过期 2 小时，key 为 `{source}::{lazyUrl}`；
  - 返回 `{ url }`，`Cache-Control: private, no-store`。

### 2.4 客户端

- 新增 `src/features/play/lib/lazyEpisode.ts`：`resolveLazyEpisodeUrl(source, lazyUrl)`，带内存缓存与 in-flight 去重。
- **播放入口**（唯一 videoUrl 驱动点 `PlayPageClient` 的 effect）：目标集为懒地址时先清空 videoUrl → 调解析 API → 成功后 `setVideoUrl(真实地址)`；快速切集用取消标记防竞态；失败提示并走既有换源兜底。
- **测速**（`probeVodEpisodeUrl`，preferBestSource 与 SourcesTab 共用入口）：遇懒地址先解析再测，单源只解析第 1 集。
- **预热**：当前集解析成功后，后台预解析下一集（打进服务端 SWR 缓存），切集接近零等待。

### 2.5 兼容性

- 其他 CMS 源（`vod_play_url` 一次给全量真实地址）完全不受影响。
- 旧收藏/播放记录只存 index 与总数，不存地址，无迁移需求。
- `prefetchM3U8` 等对 URL 形态有判断的路径（`isVodM3u8Url`）对懒地址自然跳过。

## 三、方案 2：详情快照秒播（snapshot + revalidate）

### 3.1 核心思路

播放成功获取的详情持久化到 localStorage；再次进入（典型为"继续观看"）先用快照**立即完成初始化并起播**，同时后台静默刷新详情，刷新结果有变化再更新界面。

### 3.2 实现

- 新增 `src/features/play/lib/detailSnapshot.ts`：
  - key：`icetv-detail-snapshot:{source}:{id}`，值 `{ data, savedAt }`；
  - TTL 7 天；容量上限 30 条，超出按 savedAt 淘汰最旧。
- `usePlayInit.fetchSourceDetail`：
  - 命中快照 → 立即返回快照用于初始化，同时后台 `fetch /api/detail`，成功后写回快照；若集数/标题有实质变化（追更）则 `setDetail` + 合并 `availableSources`；
  - 未命中 → 走原流程，成功后写快照。
- `useSourceSwitch` 换源成功获取的详情同样写快照。

### 3.3 与懒解析的协同

快照里存的是懒地址（结构稳定、不含带时效的真实 CDN 链接），秒播时当前集地址仍会经 `/api/episode-url` 实时解析——**快照负责"立即有结构"，懒解析负责"地址永远新鲜"**，不存在播过期链接的风险。

### 3.4 更新可见性

后台刷新发现上游追更（集数变多）时直接更新 detail 状态；懒地址字符串不变，正在播放的集不受影响（videoUrl 无变化，播放器不重载）。

## 四、预期收益

| 指标                         | 现状                  | 优化后                               |
| ---------------------------- | --------------------- | ------------------------------------ |
| 打开 giri/西瓜详情的上游请求 | O(N)（77 集 = 78 个） | 1 个                                 |
| 详情等待时间                 | 10s+                  | 1s 级                                |
| 看完一部 12 集番的总上游请求 | ~13 × 详情访问次数    | 1 + 12（每集一次，且有服务端缓存）   |
| "继续观看"起播               | 全量详情回源后起播    | 快照即刻初始化，仅解析当前集         |
| 缺集类偶发 bug               | 单集解析失败即丢集    | 结构完整，失败仅影响当次播放并可重试 |

## 五、验证清单

1. 单测：lazy-episodes 构建/解析/校验；giri、xgcartoon detail 返回懒地址与分组计数；episode-url 解析函数。
2. 本地 e2e：giri 番剧详情秒开、播放正常、切集正常；西瓜多季合集分组分页 + 播放正常；换源测速正常。
3. 快照：二次进入播放页秒初始化；后台刷新后集数更新可见。
4. 回归：普通 CMS 源播放、换源、测速不受影响；全量 jest 通过。
