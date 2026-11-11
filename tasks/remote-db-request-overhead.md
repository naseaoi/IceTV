# 待办：远程 MySQL / 多实例部署下的每请求数据库往返

## 背景

当前生产是单实例本机 SQLite（better-sqlite3 同步调用，无网络往返），以下开销几乎不可见。项目同时支持 MySQL 存储与多实例部署（含 Vercel）；数据库离应用越远，每条串行 SQL 都直接变成一次 RTT 的请求延迟，分片请求还按片放大。本待办在面向 MySQL / 多实例部署者优化时单独处理。

行号以当时代码为准，动手前重新定位。

## 优化项

### 1. 分片的多维连接租约串行申请（最高优先）

- 位置：`src/lib/upstream-resource-guard.server.ts`；`src/lib/mysql-resource-store.ts`；`src/lib/sqlite-resource-store.ts`。
- 现状：VOD 分片与测速按 global → host → user 三维**串行**各开一个事务占连接租约，metadata（清单、密钥）为 global → host 两维。MySQL 单维 acquire 为 INSERT usage → SELECT FOR UPDATE → DELETE 过期 → COUNT/MIN → INSERT lease 共 5 SQL 加 BEGIN/COMMIT，三维每片约 21 个顺序数据库命令；释放每维 1 DELETE，续租每维一个事务。global 行是共享锁热点。
- 方向：提供原子的多维 admission 存储操作，按固定顺序锁定各资源键，同一事务检查全部限额并写入 token；release / renew 按 token + 资源列表批量执行。
- 约束：不改成进程内计数，不取消任何维度；保留各维度不同的 429/503、失败回滚、30 秒失联过期、10 秒续租、正文结束才释放、续租失败中止、数据库故障 fail-closed。

### 2. 鉴权与源权限过滤重复读取同一用户

- 位置：`src/lib/api-auth.ts`；`src/lib/config.ts` 的 `getAvailableApiSites()`；`src/lib/mysql-user-access.ts`、`src/lib/sqlite-user-access.ts`。
- 现状：quick / search / detail / episode-url / source-selection / proxy-modes / source-route-stats 等接口先由 Guard 读一次完整 UserAccess，源过滤再读一次，普通用户共 4 SELECT，其中两次组查询串行。
- 方向：Guard 在请求内带出本次读到的权限快照交给源过滤复用（请求内复用，不做跨请求 TTL）。
- 约束：角色、封禁、删号仍以数据库当前值为准；保留 adminOnly、个人源覆盖组源、NULL / 空数组语义，站长环境账号单独处理。

### 3. 测速包装与内部 handler 重复完整鉴权

- 位置：`src/features/play/lib/sourceProbeGuard.server.ts`；`src/app/api/detail/route.ts`；`src/app/api/episode-url/route.ts`。
- 现状：测速包装已鉴权后构造新请求交给 detail / episode-url handler，handler 再鉴权一次，叠加第 2 项后普通用户每次测速前置约 6 SELECT。
- 方向：包装层把可信内部鉴权上下文传给 handler，不经客户端可伪造的请求头。
- 约束：测速的额外资源租约、20 秒总时限与普通预算双重约束保持；取消贯穿内部 handler，暂缓不记源失败。

### 4. 冷缓存首请求等待持久化、清理与冗余释放

- 位置：`src/lib/shared-server-cache.ts`；`src/lib/mysql.db.ts` 的共享缓存方法；`src/lib/shared-resource-quota.server.ts`。
- 现状：loader 已得到结果并写入本地后，首个请求仍串行等待 `setSharedCache` → 每分钟一次的 `pruneSharedCache` → finally 中的租约释放（成功写入已清 lease_token，MySQL 仍再发 DELETE + UPDATE）。首个取得资源 store 的请求也会等待每分钟的资源清理。
- 方向：记录 `setSharedCache()` 是否按 token 成功写入，成功时跳过 release；清理交给单实例每分钟最多一轮的维护任务，移出响应链。
- 约束：保留跨实例租约、续期、token 校验、失效代次、旧值绝对到期；serverless 不能假设响应后 Promise 继续执行，不能简单裸 `void` 写入。

### 5. 逐集解析与特殊源搜索只有进程内缓存（多实例）

- 位置：`src/app/api/episode-url/cache.ts`；`src/lib/downstream.ts`；`src/lib/downstream-sources/giri.ts`、`xgcartoon.ts`。
- 现状：episode-url 只有本地 SWR；girigiri / 西瓜卡通的 quick 搜索绕过通用搜索页共享缓存，多实例间重复解析与搜索。
- 方向：对公开、不依赖 Cookie / 出口的解析结果接入共享缓存，TTL 按地址有效期；按源 API 与解析策略版本隔离。
- 约束：IP / 会话绑定地址不跨出口共享，签名短寿命结果不延长 TTL；单实例低复用时共享租约可能更慢，先测复用率。

### 6. 播放记录按键批量读取逐键串行

- 位置：`src/app/api/playrecords/route.ts` 的 `keys` 分支。
- 现状：播放页多候选起播时一次最多 50 个键，逐键调用 `db.getPlayRecord()` 串行查询，远程 MySQL 下为最多 50 次 RTT。
- 方向：存储层新增按当前用户 + 键集合的单条 `IN` 查询，SQLite 与 MySQL 两侧同步实现并补契约测试。
- 约束：保留数量与键长度上限、用户隔离与缺失键省略语义。

## 验收

- 先补测量：`node scripts/run-upstream-concurrency-check.js` 只覆盖内存 SQLite；需加受控 RTT 的 MySQL 场景，分别记录鉴权、准入、回源、缓存持久化耗时与 SQL 条数。
- 前后在同一远程 MySQL（固定 RTT）下对比签名分片准入 p50 / p95、每接口 SQL 数与锁等待。
- `pnpm test:mysql` 与全量检查通过；资源限额集成测试按 AGENTS.md 要求 `jest.unmock` 资源保护边界。
