# 数据与存储约束

改存储层（`src/lib/sqlite.db.ts`、`src/lib/mysql.db.ts`）、配置、用户权限、邀请码前先读本文。配置读取三函数的选用见 [AGENTS.md](../AGENTS.md#配置读写)。

## 运行时配置

- 写入原地修改 `getConfig()` 返回的对象再 `saveConfig()`。版本号绑定在该对象身份上，展开或 `JSON` 克隆后保存会丢失版本，绕过读取时的冲突检测，覆盖期间的并发修改。
- 缓存 TTL 默认 60 秒，可由 `CONFIG_CACHE_TTL_MS` 覆盖；写路径一律先 `invalidateConfigCache()`，不依赖 TTL 长短。
- 订阅地址、自动更新、检查时间与原文的真相源是 `config_subscription`；直播频道数的真相源是 `live_source_state`。运行时配置 JSON 不保存这些字段，后台响应按需组装。
- 订阅更新与源配置修改经同一配置 CAS 事务提交，并复核订阅快照；直播刷新仅更新状态表，按当前源地址复核，删除源同事务清理状态。

## 用户权限

- 直播权限由 `SiteConfig.EnableLiveEntry` 与 `SiteConfig.LiveAccess` 共同决定；`LiveAccess` 为 `groups` 时仅站长、管理员及任一 `allowLive: true` 用户组成员可观看。直播 API、直播代理、直播页面及 layout / server-config 的逐用户 `ENABLE_LIVE_ENTRY` 统一经 `canUserWatchLive()` 判定。

- 用户权限以 `user_access` 和 `user_group_members` 为唯一真相源；鉴权按归一化用户名查主键，运行时配置不携带 `Users`。该字段只用于旧数据迁移，用户组定义 `Tags` 留在配置。
- `enabledApis` 为空数组时存为 `NULL`，含义是**不限制**而非禁止全部；没有有效个人源或组源列表时返回全部启用源。删除用户最后一个授权源会让其回落为全部可用。
- 视频源 `adminOnly` 存在配置 JSON 的 `SourceConfig` 里，由 `getAvailableApiSites()` 统一过滤：普通用户和没有 `user_access` 行的用户名看不到，管理员与站长不受影响，再与 `enabledApis` / 用户组取交集。个人 `enabledApis` 非空时整体覆盖用户组（不与组取交集），多个组取并集；该优先级只在 `resolveSourceAccessRule()`（`src/lib/source-access.ts`）实现，后台用户列表的生效源数量同用此函数。不传用户名的内部调用（定时任务）返回全部启用源。用户侧读取源列表一律经该函数，不直接遍历 `SourceConfig`。
- 新用户默认用户组 `UserConfig.DefaultUserGroup` 存在配置 JSON；`configSelfCheck()` 在其不对应任何 `Tags` 时清除，删组无需另行处理。注册与后台添加用户经 `registerUser()` 的 `userGroups` 参数在建号事务内写入组成员。
- 每个 `users` 行必须有 `user_access` 行；建号同事务写入，初始化时补齐。站长角色和封禁豁免由环境变量决定，表仅保存其源权限和用户组。
- 用户权限更新与批量操作在存储事务内复核角色；配置 CAS 同事务清理被删除组和源的用户引用，避免配置冲突后留下部分写入。
- 后台用户操作复用 `src/features/admin/services/userActions.ts`，不在 `route.ts` 里重新展开权限与用户组逻辑。后台用户列表走 `/api/admin/user` 的 SQL 游标分页，全部匹配批量操作提交筛选与排除项；`/api/admin/config` 仅返回用户总数。

## 邀请码

- 邀请码定义与用量的唯一真相源是 `invite_codes`，配置 JSON 仅保留注册开关。后台列表走 `/api/admin/invite-codes` 的 SQL 游标分页，注册摘要走 COUNT。
- 批量创建在单个事务内校验整批冲突与有效码总数上限，整批成功或全部不写入；单条创建复用同一路径。
- 失效码不会随激活自动删除：后台“清理失效”删除全部已过期与已用尽的码；定时 `metadata` 任务删除过期超过 30 天的码（`src/lib/cron/invite-code-retention.ts`）。表中没有用尽时间，未过期的已用尽码等到期后再按同一保留期清理。
- 名额占用走 `reserveInviteCodeUse()`，以数据库内的有效期与次数上限做条件 UPDATE，按受影响行数判成败；注册后续步骤失败调用 `releaseInviteCode()` 回滚。
- 存储初始化在事务内迁移旧配置与用量、CAS 移除配置中的邀请码。

## 用户活跃记录

不变量：**每个 `users` 行都必须有对应 `user_login_activity` 行**。

- 建号与活跃记录同事务写入；缺失行在存储层初始化时按当前时刻补齐。这是每次重新断言的不变量，不是一次性迁移。
- 补齐写的是合成时间戳，所以「清理不活跃用户」在补齐后一段时间内按阈值筛不出人，包括真正沉睡的账号。
- 站长账号来自环境变量，没有 `users` 行但可能有活跃记录行。按 `users` 反查孤儿记录会误伤它。
- 清理时 owner / admin 与操作者本人豁免，无活跃记录的用户不纳入候选。

## 新增按用户分表的数据

`deleteUser` 与 SQLite 用户名大小写合并都要覆盖，`video_reviews` 是现成参照。表内有多个用户名列时（如 `user_follows`）每一列都要覆盖。

随用户数据增长的列表在 SQL 层按游标分页（排序键 + 唯一键打破平局），不要全量查询后在内存切页。

播放记录批量删除每个请求最多接收 200 个键，校验后去重并以一条 SQL 删除当前用户的记录；空键数组为空操作，只有无请求体的删除请求执行全部清空。客户端对任意数量的键一次乐观更新并分批提交；批次之间独立提交，后续失败时已完成批次保留，失败提示及缓存恢复沿用单条删除流程。

## LinuxDo 身份

- `oauth_identities` 是外部身份归属的唯一真相源；主键 `(provider, provider_user_id)`，唯一键 `(provider, username)`，用户名按本站规则归一化。LinuxDo 用户名仅用于显示，登录归属按不可变 ID 查询，同名本站账号始终独立。
- `registerUser()` 的身份参数与账号、权限、资料和活跃记录同事务写入；身份冲突时整笔回滚。自动建号写随机密码哈希并记录 `auto_created`，存储条件删除也拒绝解绑。
- 删除用户及不活跃清理同事务清理身份；SQLite 大小写合并保留已有规范用户名的绑定，冲突旧绑定移除，其余迁移到规范用户名。两后端共享身份契约，MySQL 同时执行 fake pool 与真实数据库用例。
- userinfo 必需 `id`、`username` 与整数 `trust_level`；`active === false` 拒绝登录，缺字段记警告后兼容允许；`silenced` 不作为登录门槛。本站封禁仍在签发会话前校验。

## 用户发送的弹幕

- `user_danmaku` 保存登录用户发送的弹幕，独立于第三方弹幕缓存和用户弹幕开关、集映射表；`episode_key` 按共享约定逐字匹配，`time_ms` 是减去校准偏移后的弹幕集时间轴毫秒数。
- 删除用户（含不活跃清理）在事务内同步处理该表；SQLite 大小写迁移收集本表用户名并合并归属，包括仅有弹幕数据的站长账号。
- 发送限额使用共享资源表的独立 `user-danmaku-send` 命名空间，按规范用户名每分钟 10 条；该额度属于临时资源状态。站点关闭用户弹幕后仍可删除本人弹幕，管理员仍可清理存量内容。

## SQLite / MySQL 双后端

- 两侧共用的谓词（如 `src/lib/tracking-sql.ts`）只在数字、时间、布尔读取原语中区分方言，不在两套存储里分别改业务条件。
- MySQL 的 JSON 布尔读取不能用数值比较替代字符串 `'false'`；无效数字字符串的 CAST 可能转成 0 而非抛错，输入校验与跨后端用例仍须保留。
- 需要逐字节匹配的列在 MySQL 用 `utf8mb4_bin`，换成 `_ci` 排序规则会让两种存储的匹配结果不一致。
- 存储变更须跑 `pnpm test:mysql`，原因见 [AGENTS.md](../AGENTS.md#测试)。

## 观看历史与观看统计

- 三份数据各自独立：`play_records` 管继续观看与追更；`watch_history` 是「我的 - 历史」，每个用户在一个源的一部作品（`source + video_id`）一条，用户可物理删除；`playback_sessions` 与 `playback_watch_buckets` 是观看统计，用户不可删，删除历史或继续观看都不影响统计。删除账户时三者一并清除。
- 历史只在播放上报不带历史 id 时按 `(username, source, video_id)` 新建或取回；带 id 的上报只更新，命中 0 行即返回 `historyId: null`，**不得改成 upsert**，否则用户删除后仍在播放的页面会把记录写回。旧数据迁移同理只跑一次：完成标记是 `storage_migrations` 中的 `watch_history_v1`，与迁移写入同一事务提交；不能在启动时按缺失补建。
- `playback_watch_buckets.watch_ms` 是会话在一个 15 分钟 UTC 对齐桶内的**累计值**，写入取 `MAX`，重试与乱序不会重复累计；改成增量相加会在重发时翻倍。`measurement_version = 2` 的会话 `watch_seconds` 由服务端按桶汇总，`1` 为旧口径（客户端估算、无桶，只能按起播时间归属）。
- 年度报告只读统计会话与时间桶，不读取观看历史；v2 按真实桶归属时区日期，v1 将 `watch_seconds` 从 `started_at` 起连续摊开成合成桶，并单列估算时长。评价按 `created_at` 归属年份，编辑旧评价不计入当年。报告只统计「看过的作品数」而非「看完 N 部」：看过时间会随状态修改被移除，会话也不记录总集数，无法可靠判定完结。
- 周期统计原有总时长、分桶、活跃天数与常看时长仍按会话起播日期归属；新增 `hours` 使用年度报告共用的真实桶 / 旧会话估算口径，二者跨周期时总数可能不同。`currentStreak` 独立于选中的历史周期，按当前用户时区的真实观看日期从今天或昨天倒推，最多 366 天。常看集数按归一化作品身份下的不同 `episode_index` 去重，不等同于会话数。
- 个人近 90 天与后台源用量按会话 `started_at` 半开区间归属，正时长会话参与；作品数共用归一化标题 + 年份身份。个人查询走 `(username, started_at)` 索引；全站查询缺少用户名索引前缀，使用数据库共享缓存（5 分钟新鲜期、额外 5 分钟旧值期）合并同窗口读取。源名称在响应时优先取配置，配置缺失取区间内最近起播会话名称。
- `CRON_PLAYBACK_STATS_RETENTION_DAYS` 只清统计（会话及其桶）。历史没有保留期限，只随用户删除或删除账户消失。

- 公开年度报告以 `user_annual_recaps` 的 `(username, year)` 快照为真相源，访客读取不重新聚合本人统计。写入时评价摘要仅取公开评价，隐藏作息时清空小时、星期、深夜时长及最晚观看信息；可选年份仅来自已公开快照。发布受请求时区开放日期限制，管理员同样遵守。
- 快照刷新保留首次 `published_at`，取消公开删除行，重新公开生成新的发布时间。本人读取已开放报告时按原隐私设置刷新，以发布时间与更新时间作条件更新，避免并发取消或隐私修改被旧刷新覆盖。删除用户和 SQLite 用户名大小写合并覆盖快照表，合并冲突取较新的快照。
- `user_message_state.state_json.annualReportReadYear` 为年度消息的单调已读年水位，两后端在现有状态事务内取最大值合并；与社交通知时间水位独立，无新增表或批量消息行。

## 源站线路统计

- `source_route_stats.route_mode` 用 `browser-v2` / `server-v2` 保存全程直连 / 全程代理的新口径，接口仍收发 `browser` / `server`。管理端聚合只读 v2，旧 `browser` / `server` 行保留且不混入成功率；原始桶读取保留存储键以区分口径。
- 定时清理按日期作用于整表，覆盖新旧口径。新键适配现有 MySQL `VARCHAR(16)`，两后端均保持原表结构。

## 共享缓存

`src/lib/shared-server-cache.ts` 的 `invalidate()` / `clear()` 只清本实例内存，不删除数据库里的共享条目，下次加载可能读回旧值。业务失效依赖缓存键（源配置、策略版本等）变化，不依赖这两个方法。`shared_cache` 是可丢弃数据。加载前占租约会插入空占位行（空值、有效期为 0），释放租约时按持有 token 删除仍为空的占位行；改租约或写入逻辑时保留这一条件，否则失败与不缓存的加载会留下绕过清理预算的空行。

`getOrLoad()` 在本地或数据库命中最长保留期内的旧值时立即返回，持租约者后台刷新并在结束时释放租约；后台失败保留旧值原有的绝对过期时间。只有没有可用值的请求等待回源。显式 `refresh()` 等待在途刷新完成；租约续期、持有 token 校验及空占位行释放规则同样适用于后台刷新。
