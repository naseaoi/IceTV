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
- 每个 `users` 行必须有 `user_profiles` 行；建号同事务写入，初始化时补齐。站长无 `users` 行，在会话恢复时按需 `ensureUserProfile()`。用户名比较先归一化。
- `user_profiles`、`user_follows`、`video_review_likes`、`video_review_reports`、`video_review_replies`、`video_review_reply_reports` 的用户删除与 SQLite 大小写合并必须覆盖所有用户名列；删除评价同事务清理点赞、举报、回复和回复举报。

## 评价回复

- 回复按评价作者、归一化标题与精确年份关联，单层平铺；被回复者从同一评价内的回复 ID 推导并保存用户名，展示时解析当前公开资料。正文上限共用 `REVIEW_REPLY_MAX_LENGTH`。不解析正文里的 `@昵称`，“提及”只指回复某条回复。
- 评价的 `first_published_at` 在首次变为公开时写入，之后编辑、改分、转私密再公开都不改变；关注动态以它为准，编辑旧评价不会再次通知关注者。
- 私密评价的回复与回复举报保留，但列表、消息和后台举报查询均经父评价的公开状态过滤；恢复公开后重新可见。回复作者始终可以删除本人回复，管理员删除使用独立后台 Guard。
- 删除用户时清除其评价下的回复、本人发送的回复及相关举报；仅被提及时置空 `reply_to`，保留其他人的正文。

## 收藏库与观看状态

- 播放页的收藏状态只看当前 `source+id` 收藏键是否存在（`isFavorited()` 单键读取），不要改用收藏库观看状态推导。
- 收藏仍按 `source+id` 存储。收藏查询投影与 JSON 同次写入，写入与用户名合并都经 `favoriteProjection()` 重建；启动按 `projection_version` 分批补齐，投影规则改变须升级版本并回填。
- 有效观看状态（想看 / 在看 / 看过）与看过时间只在 `src/features/favorites/lib/library-storage.ts` 的 SQL 中推导：手动 `watch_status` 优先，其次评分或末集进度 ≥ 90% 判看过，有播放记录判在看。收藏库、按作品查询、批量匹配与公开收藏共用这段 SQL，**不要在前端或其他查询里另写推导**，否则计数与列表对不上。
- 收藏列表与收藏数经收藏库查询获取（`libraryStatements()`，接口 `/api/favorites?format=library`，客户端 `src/features/favorites/lib/library-client.ts`）：「我的」页收藏栏按 `limit` 取前几条，登录写入的收藏计数取 `libraryTotal`。收藏范围统一为 `library_valid = 1`，公开范围再加 `profileFavoriteOriginSql()`；个人主页收藏数这类单独的 `COUNT` 必须沿用同样条件，否则与列表对不上。
- 状态修改与批量移出走 `POST /api/favorites/batch`；全选提交筛选条件加排除项，筛选语义与 `/api/favorites?format=library` 同一实现，不要先拉全量键再提交。
- `user_profiles.favorites_public` 存公开等级 0–3（不公开 / 仅收藏 / 加状态 / 加评分），接口字段为 `libraryVisibility`，本人始终按 3 级查看。公开评分只取 `is_public = 1` 的评价；精确年份的私密评价存在时不回落到空年份评价，避免泄露私密评分。

## 目录收藏

- 豆瓣 / Bangumi 目录收藏的键是 `douban+<id>` / `bangumi+<id>`，判定统一用 `isCatalogFavoriteSource()`（`src/lib/catalog-favorites.ts`）。它们没有播放源：点击按标题起播，元数据刷新等假设可播放源的路径须跳过；`douban` / `bangumi` 作为源 key 保留，后台、配置文件与订阅导入均拒绝。
- 写入收藏时服务端按作品身份（`title_norm` + 年份）合并目录收藏与真实源收藏，最终键可能与提交的键不同。调用方以 `saveFavorite()` 返回的键为准，不要沿用本地拼出的键。
- 保存目录收藏后客户端后台调用 `POST /api/favorites/catalog-bind`（`{ key }`）；收藏页在每个标签页会话内按账号调用一次 `{}`，最多绑定两条到期目录收藏。绑定复用 quick 选源服务、用户源权限与回源预算，要求标题身份一致、目录和详情年份精确匹配、完整详情有剧集；缺年份或详情已完结（含单集电影）永久跳过。
- `catalog_bind` 在收藏 JSON 中保存跳过或失败状态；失败从 30 分钟指数退避至最多 24 小时。绑定状态由服务端维护，重存保留，客户端不能覆盖。绑定成功以真实源键吸收目录项，保留 `catalog_origin`、保存时间、手动观看状态与评价身份；事务内复核目录快照，期间删除或修改不会被旧绑定结果覆盖。后台失败静默，成功触发现有收藏刷新事件。

## 片单

- 片单条目是独立的作品快照，取消收藏、目录收藏合并和来源移除均不改动条目；目录或无来源的条目不保存可播放源编号。作品去重使用服务端归一化标题与精确年份，空年份与具体年份各自独立。
- 单个用户至多 50 个片单、每单至多 200 部作品。数量检查与写入在同一事务；SQLite 用即时事务，MySQL 先锁用户资料再锁片单，覆盖没有 `users` 行的站长。大小写合并保留两侧既有片单，合并后的数量超过上限时只限制继续新建。
- 元数据、条目和排序修改同事务维护计数、版本与更新时间；重复作品添加返回已有条目且不推进版本。排序提交全部条目 ID 与当前版本，版本过期返回 409 `LIST_VERSION_CONFLICT`，版本有效但条目集合不一致返回 400。客户端刷新冲突后的片单再重新排序。
- 可见性分三档，存于 `user_lists.is_public`：0 私密、1 登录用户可见、2 含游客；接口字段为 `visibility`（`private` / `members` / `everyone`）。个人主页片单列表与登录用户读取都按 `is_public >= 1` 过滤，新增读取路径沿用同一比较，不要写成 `= 1`。
- 片单详情（`GET /api/lists/[id]`）与片单广场（`GET /api/lists/plaza`）对游客开放，存储层以 `viewer = null` 只返回等级 2 的片单；个人片单列表、个人主页与全部写操作仍要求登录。`/lists/[id]` 不挂 `AuthenticatedRoute`，游客读到 404 时由页面展示统一登录提示（片单可能只对登录用户公开），游客视角的作品卡片只保留直达播放。
- `user_lists.view_count` 累计非作者的成功详情访问；自增只修改该列，保留排序乐观锁 `version` 与「最新」排序键 `updated_at`，计数失败只记服务端日志并正常返回详情。登录访客按归一化用户名、游客按 `getClientIp()` 区分，未知 IP 不计数；同一访客对同一片单 24 小时内只计一次，进程内最多保留 10,000 条记录并淘汰最旧项。去重每实例独立，多实例、重启或容量淘汰会多计；游客 IP 信任边界沿用 [项目约束](../AGENTS.md#外部请求与客户端-ip)，默认取值可由客户端伪造而刷量。
- 广场只收录非空且有作者资料行的片单，登录用户读取等级 1 和 2，游客只读取等级 2。`hot` 按热度分 `view_count + like_count * 10` 倒序、`new` 按更新时间倒序，同值按片单 ID 正序；每页 24 条，SQL 以排序值与 ID 做游标分页。游标绑定排序方式，非法排序或游标返回 400；响应只含公开作者资料，封面取条目顺序的前四项。
- `list_likes` 按片单与归一化用户名去重，`user_lists.like_count` 在同一事务按实际点赞行重算；点赞、取消与重复请求均保持 `version`、`updated_at` 不变。写入口要求登录和昵称，只允许操作可读的他人片单；私密片单保留点赞记录，详情的 `liked` 对游客恒为 false。
- 广场与不带作品匹配的个人片单摘要通过窗口查询只读取每单前四项封面；带作品匹配的查询读取完整条目以保持 `contains` 与 `containsItemId` 的语义。
- 广场计数、详情条目数与主页 `listCount` 的可见范围与对应列表查询一致，改其一须同步其余；详情计数只读取片单行且不计浏览量，主页本人计入全部片单，他人只计等级 1 和 2（含空片单）。
- 他人私密片单、无权写入的片单与不存在的片单统一返回 404。公开响应只含 `profileId`、昵称与头像种子，登录名只在存储层传递。

## 入口复用

- 标记评分面板由根布局的 `WatchRecordProvider` 挂载，卡片菜单经 `useOpenWatchRecord()` 打开（`src/components/watch-record-context.ts`）；「加入片单」弹窗同样由根布局的 `ListPickerProvider` 挂载，经 `useOpenListPicker()`（`src/components/list-picker-context.ts`）打开。两者未登录时返回 null 隐藏入口。新入口复用它，评价编辑复用 `src/features/reviews/`。
- 卡片右键 / 长按菜单统一经 `buildCardActions()`（`src/components/card-actions/actions.tsx`）组装，顺序固定为播放 → 收藏 → 加入片单 → 标记评分 → 标为已读 / 追更 → 外部详情 → 删除记录；卡片只决定提供哪些项，不要在卡片里手排数组。
