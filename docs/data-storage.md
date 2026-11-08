# 数据与存储约束

改存储层（`src/lib/sqlite.db.ts`、`src/lib/mysql.db.ts`）、配置、用户权限、邀请码或导入导出前先读本文。配置读取三函数的选用见 [AGENTS.md](../AGENTS.md#配置读写)。

## 运行时配置

- 写入原地修改 `getConfig()` 返回的对象再 `saveConfig()`。版本号绑定在该对象身份上，展开或 `JSON` 克隆后保存会丢失版本，绕过读取时的冲突检测，覆盖期间的并发修改。
- 缓存 TTL 默认 60 秒，可由 `CONFIG_CACHE_TTL_MS` 覆盖；写路径一律先 `invalidateConfigCache()`，不依赖 TTL 长短。
- 订阅地址、自动更新、检查时间与原文的真相源是 `config_subscription`；直播频道数的真相源是 `live_source_state`。运行时配置 JSON 不保存这些字段，后台响应和备份按需组装；频道数不导出，导入后刷新重建。
- 订阅更新与源配置修改经同一配置 CAS 事务提交，并复核订阅快照；直播刷新仅更新状态表，按当前源地址复核，删除源同事务清理状态。

## 用户权限

- 直播权限由 `SiteConfig.EnableLiveEntry` 与 `SiteConfig.LiveAccess` 共同决定；`LiveAccess` 为 `groups` 时仅站长、管理员及任一 `allowLive: true` 用户组成员可观看。直播 API、直播代理、直播页面及 layout / server-config 的逐用户 `ENABLE_LIVE_ENTRY` 统一经 `canUserWatchLive()` 判定。

- 用户权限以 `user_access` 和 `user_group_members` 为唯一真相源；鉴权按归一化用户名查主键，运行时配置不携带 `Users`。该字段只用于旧数据迁移与备份兼容，用户组定义 `Tags` 留在配置。
- `enabledApis` 为空数组时存为 `NULL`，含义是**不限制**而非禁止全部；没有有效个人源或组源列表时返回全部启用源。删除用户最后一个授权源会让其回落为全部可用。
- 视频源 `adminOnly` 存在配置 JSON 的 `SourceConfig` 里，由 `getAvailableApiSites()` 统一过滤：普通用户和没有 `user_access` 行的用户名看不到，管理员与站长不受影响，再与 `enabledApis` / 用户组取交集。不传用户名的内部调用（定时任务）返回全部启用源。用户侧读取源列表一律经该函数，不直接遍历 `SourceConfig`。
- 新用户默认用户组 `UserConfig.DefaultUserGroup` 存在配置 JSON；`configSelfCheck()` 在其不对应任何 `Tags` 时清除，删组无需另行处理。注册与后台添加用户经 `registerUser()` 的 `userGroups` 参数在建号事务内写入组成员。
- 每个 `users` 行必须有 `user_access` 行；建号同事务写入，初始化与 `replaceAllData()` 结尾补齐。站长角色和封禁豁免由环境变量决定，表仅保存其源权限和用户组。
- 用户权限更新与批量操作在存储事务内复核角色；配置 CAS 同事务清理被删除组和源的用户引用，避免配置冲突后留下部分写入。
- 后台用户操作复用 `src/features/admin/services/userActions.ts`，不在 `route.ts` 里重新展开权限与用户组逻辑。后台用户列表走 `/api/admin/user` 的 SQL 游标分页，全部匹配批量操作提交筛选与排除项；`/api/admin/config` 仅返回用户总数。

## 邀请码

- 邀请码定义与用量的唯一真相源是 `invite_codes`，配置 JSON 仅保留注册开关。后台列表走 `/api/admin/invite-codes` 的 SQL 游标分页，注册摘要走 COUNT；完整列表仅用于备份导出。
- 批量创建在单个事务内校验整批冲突与有效码总数上限，整批成功或全部不写入；单条创建复用同一路径。
- 名额占用走 `reserveInviteCodeUse()`，以数据库内的有效期与次数上限做条件 UPDATE，按受影响行数判成败；注册后续步骤失败调用 `releaseInviteCode()` 回滚。
- 存储初始化在事务内迁移旧配置与用量、CAS 移除配置中的邀请码；导出把表数据组装到 `UserConfig.InviteCodes`，导入在同一替换事务还原表并剥离该配置字段。

## 用户活跃记录

不变量：**每个 `users` 行都必须有对应 `user_login_activity` 行**。

- 建号与活跃记录同事务写入；缺失行在存储层初始化时和 `replaceAllData()` 结尾按当前时刻补齐。这是每次重新断言的不变量，不是一次性迁移。
- 补齐写的是合成时间戳，所以「清理不活跃用户」在补齐后一段时间内按阈值筛不出人，包括真正沉睡的账号。
- 站长账号来自环境变量，没有 `users` 行但可能有活跃记录行。按 `users` 反查孤儿记录会误伤它。
- 清理时 owner / admin 与操作者本人豁免，无活跃记录的用户不纳入候选。

## 新增按用户分表的数据

`deleteUser`、`clearAllData`、`replaceAllData`、导入导出与 SQLite 用户名大小写合并都要覆盖，`video_reviews` 是现成参照。表内有多个用户名列时（如 `user_follows`）每一列都要覆盖。

随用户数据增长的列表在 SQL 层按游标分页（排序键 + 唯一键打破平局），不要全量查询后在内存切页。

## 用户发送的弹幕

- `user_danmaku` 保存登录用户发送的弹幕，独立于第三方弹幕缓存和用户弹幕开关、集映射表；`episode_key` 按共享约定逐字匹配，`time_ms` 是减去校准偏移后的弹幕集时间轴毫秒数。
- 删除用户（含不活跃清理）、清空数据和替换式导入在各自事务内同步处理该表；SQLite 大小写迁移收集本表用户名并合并归属，包括仅有弹幕数据的站长账号。
- 备份按用户导出 `userDanmaku`，导入归属以外层用户名为准，沿用站长重映射。条目经共享约定归一化，重复 ID 拒绝导入，全站按 `createdAt` 保留最新 50,000 条并返回裁剪报告；旧备份缺省为空列表。
- 发送限额使用共享资源表的独立 `user-danmaku-send` 命名空间，按规范用户名每分钟 10 条；该额度属于临时资源状态，不随弹幕导入导出。站点关闭用户弹幕后仍可删除本人弹幕，管理员仍可清理存量内容。

## SQLite / MySQL 双后端

- 两侧共用的谓词（如 `src/lib/tracking-sql.ts`）只在数字、时间、布尔读取原语中区分方言，不在两套存储里分别改业务条件。
- MySQL 的 JSON 布尔读取不能用数值比较替代字符串 `'false'`；无效数字字符串的 CAST 可能转成 0 而非抛错，输入校验与跨后端用例仍须保留。
- 需要逐字节匹配的列在 MySQL 用 `utf8mb4_bin`，换成 `_ci` 排序规则会让两种存储的匹配结果不一致。
- 存储变更须跑 `pnpm test:mysql`，原因见 [AGENTS.md](../AGENTS.md#测试)。

## 共享缓存

`src/lib/shared-server-cache.ts` 的 `invalidate()` / `clear()` 只清本实例内存，不删除数据库里的共享条目，下次加载可能读回旧值。业务失效依赖缓存键（源配置、策略版本等）变化，不依赖这两个方法。`shared_cache` 是可丢弃数据，不参与导入导出。
