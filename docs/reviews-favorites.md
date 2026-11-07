# 评价、收藏与社交约束

改评价、收藏库、观看状态、个人主页、关注或卡片菜单前先读本文。存储通用要求见 [数据与存储](data-storage.md)。

## 作品身份

- 评价按作品身份存储：`normalizeWorkTitle()` + `normalizeWorkYear()`（`src/lib/source-match.ts`）。标题归一化与换源候选、搜索聚合共用，**改标题归一化会让已存评价静默匹配不到**，换源后也不再继承。年份比较各处另有实现（换源候选用同文件内的 `isYearMatched()`，搜索聚合自行处理），改年份规则须逐处核对。
- `title_norm` 与 `year` 由服务端计算，不信任客户端；MySQL 列保持 `utf8mb4_bin`。
- 年份为空视为通配：查询用 `year IN (?, '')`，PUT 命中空年份记录时沿用其年份，避免同一作品出现两份评价。收藏库在 SQL 中按精确年份优先、空年份兜底关联评价；精确记录存在且评分为空时保留空值。

## 评价

- 评分为 1.0–10.0 的一位小数：服务端先校验范围再 `Math.round(r * 10) / 10`，前端换算与展示统一走 `src/lib/rating.ts`，不要各处手写 `toFixed` 或步进精度。
- 正文上限是前后端共用的 `REVIEW_CONTENT_MAX_LENGTH`（`src/lib/video-reviews.ts`），不要另写数字。
- 私密评价只对作者可见；作品汇总、后台列表与后台删除都带 `is_public = 1`，新增读取路径须同样过滤。
- 本人评价数与轻量评分索引走 `/api/reviews/mine?view=count|ratings`，收藏库页走 `/api/favorites?format=library`，不要为此翻取完整列表。
- 评价与收藏相互独立：取消收藏不删评价。播放页评价与标记评分面板保存时由前端补收藏，「我的评价」编辑只改评价。
- 保存评价、点赞、举报和关注的服务端写入口必须校验昵称，缺失返回 403 `NICKNAME_REQUIRED`；注册昵称与账号同事务保存，失败释放邀请码名额。

## 用户资料与关注

- 公开评价、个人主页、关注列表与关注动态使用 `profileId`、昵称和头像标识，登录名仅用于服务端身份和后台接口。公开评价与回复的 `author.role` 仅向站长、管理员返回 `owner` / `admin`（归一化环境变量站长优先，其余取 `user_access.role`），普通用户省略该字段。
- 每个 `users` 行必须有 `user_profiles` 行；建号同事务写入，初始化与 `replaceAllData()` 结尾补齐。站长无 `users` 行，在会话恢复时按需 `ensureUserProfile()`。用户名比较先归一化。
- `user_profiles`、`user_follows`、`video_review_likes`、`video_review_reports`、`video_review_replies`、`video_review_reply_reports` 的删除、清空、替换、导入导出与 SQLite 大小写合并必须覆盖所有用户名列；删除评价同事务清理点赞、举报、回复和回复举报。导入昵称冲突置空、资料标识冲突重生成。

## 评价回复

- 回复按评价作者、归一化标题与精确年份关联，单层平铺；被回复者从同一评价内的回复 ID 推导并保存用户名，展示时解析当前公开资料。正文上限共用 `REVIEW_REPLY_MAX_LENGTH`。
- 私密评价的回复与回复举报保留，但列表、消息和后台举报查询均经父评价的公开状态过滤；恢复公开后重新可见。回复作者始终可以删除本人回复，管理员删除使用独立后台 Guard。
- 删除用户时清除其评价下的回复、本人发送的回复及相关举报；仅被提及时置空 `reply_to`，保留其他人的正文。备份回复以发送者为外层归属，评价作者与被提及者都参加站长重映射；稳定回复 ID 重复时拒绝导入。

## 收藏库与观看状态

- 收藏仍按 `source+id` 存储。收藏查询投影与 JSON 同次写入，导入、替换与用户名合并都经 `favoriteProjection()` 重建；启动按 `projection_version` 分批补齐，投影规则改变须升级版本并回填。
- 有效观看状态（想看 / 在看 / 看过）与看过时间只在 `src/features/favorites/lib/library-storage.ts` 的 SQL 中推导：手动 `watch_status` 优先，其次评分或末集进度 ≥ 90% 判看过，有播放记录判在看。收藏库、按作品查询、批量匹配与公开收藏共用这段 SQL，**不要在前端或其他查询里另写推导**，否则计数与列表对不上。
- 状态修改与批量移出走 `POST /api/favorites/batch`；全选提交筛选条件加排除项，筛选语义与 `/api/favorites?format=library` 同一实现，不要先拉全量键再提交。
- `user_profiles.favorites_public` 存公开等级 0–3（不公开 / 片单 / 加状态 / 加评分），接口字段为 `libraryVisibility`，本人始终按 3 级查看。公开评分只取 `is_public = 1` 的评价；精确年份的私密评价存在时不回落到空年份评价，避免泄露私密评分。

## 目录收藏

- 豆瓣 / Bangumi 目录收藏的键是 `douban+<id>` / `bangumi+<id>`，判定统一用 `isCatalogFavoriteSource()`（`src/lib/catalog-favorites.ts`）。它们没有播放源：点击按标题起播，元数据刷新等假设可播放源的路径须跳过；`douban` / `bangumi` 作为源 key 保留，后台、配置文件与订阅导入均拒绝。
- 写入收藏时服务端按作品身份（`title_norm` + 年份）合并目录收藏与真实源收藏，最终键可能与提交的键不同。调用方以 `saveFavorite()` 返回的键为准，不要沿用本地拼出的键。

## 入口复用

- 标记评分面板由根布局的 `WatchRecordProvider` 挂载，卡片菜单经 `useOpenWatchRecord()` 打开（`src/components/watch-record-context.ts`），未登录时返回 null 隐藏入口。新入口复用它，评价编辑复用 `src/features/reviews/`。
- 卡片右键 / 长按菜单统一经 `buildCardActions()`（`src/components/card-actions/actions.tsx`）组装，顺序固定为播放 → 收藏 → 标记评分 → 标为已读 / 追更 → 外部详情 → 删除记录；卡片只决定提供哪些项，不要在卡片里手排数组。
