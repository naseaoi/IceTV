# 消息与追更模块决策记录

2026-08-28 一轮审查与改造后留存。**这里只记代码和测试里读不出来的东西**:被否决的方案及其依据、排查中被数据推翻的判断、已知但故意不修的边界。实现细节看代码,改了什么看 git log。

## 已否决

### 追更"有未读更新"独立列 + 索引

立项时判断"记录多的用户每轮摘要都是分区全扫",复核后不成立:

- 两个后端的 `play_records` 主键都是 `(username, record_key)`,追更查询带 `WHERE username = ?`,走主键范围扫,只扫这一个用户的记录。
- 实测每用户记录数 6 / 5 / 4。即便重度用户到几百条,`json_extract` 逐行算一遍仍是微秒级。

代价那侧是实的:动 schema、写双后端迁移、保证列与 JSON 不漂移(所有写入路径收口到 `mergePlayRecordUpdateBaseline` 之后)。

**重新立项的触发条件**:单用户播放记录到万级。安全网已经有了(`pnpm test:mysql`)。

### 服务端摘要缓存

实现过又撤掉。单标签页轮询间隔 30 秒,3 秒的 fresh 窗口命中不了;真正的重复请求只有切回标签页时 `visibilitychange` 与 `focus` 连发那一次。为这点收益要挂 6 处失效调用,还要让 playrecords 路由反向依赖消息模块,不划算。

改在客户端拦:`useVisibilityPolling` 的 `minGapMs` + `messagesUpdated` 监听的 400ms 防抖。**放弃了多标签页去重**——客户端拦重复只在单个标签页内有效。

### 接真实 MySQL 之外的谓词分叉防线

两份手写谓词靠测试发现分叉,不如让它无法分叉。方言差异收成三个原语(`tracking-sql.ts`),谓词只写一份。剩余未覆盖面收窄到那三个原语。

## 排查中被数据推翻的判断(勿重走)

### worker 强制退出警告

1. 先怀疑 `:memory:` 的 sqlite 连接不 close 泄漏原生句柄 —— 三个 sqlite 套件独跑 0 警告,不成立。
2. 二分定位到 12 个 `src/components/*.test.tsx`,但同一组重跑三次全干净 —— 那次 WARN 是抽样噪声。

**这条警告出现与否本身不稳定**:60 和 120 个套件时出现,188 个时反而没出现。单次观测不足以判定任何子集。真实根因是 16 核上默认开 15 个 worker 过订阅。

### `deletePlayRecord` 失败时的派发行为

曾判断它失败仍会派发、与 `clearAllPlayRecords` 不对称。实际 `createOptimisticWriter` 在 `onServerError` 之后会 `throw`,两条路径失败时都到不了 `notifyMessagesUpdated()`,行为一致。

### 配置缓存 TTL 提到 60 秒的代价

曾判断"后台改动最多一分钟才生效"。`saveConfig` 会写穿模块缓存(`configCacheGeneration += 1`),保存即刻生效,不受 TTL 影响。

## 已知边界,故意不修

| 现象                                                                                | 影响                 | 为什么不修                                                     |
| ----------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------- |
| 删除失败时列表已乐观移除,`messagesUpdated` 未派发                                   | 角标滞后 ≤30 秒      | 下一轮轮询自愈,窄                                              |
| 亚秒级频繁切标签页时,补拉被 `minGapMs` 挡掉且 interval 被重置                       | 轮询可能推迟一个周期 | 停手即恢复;换掉的是"每次切页都发请求"                          |
| `limit=1` 且有公告时 `trackingLimit` 为 0,`nextCursor` 走 `Number.MAX_SAFE_INTEGER` | 无                   | 降序下等价于从追更列表头部重开,逻辑正确;客户端固定传 20,走不到 |

## 测试边界

`mysql-storage-contract.test.ts` 里的追更用例走 fake pool(JS 谓词模拟),验的是接线——参数顺序、排序口径、游标构造、`total` 与 `items` 同源。**不执行真 SQL**,证明不了两侧谓词等价。

覆盖 SQL 层要靠 `pnpm test:mysql`(需 Docker):起 `mysql:8.4` 容器跑 `mysql-tracking-live` 与 `tracking-backend-parity`,结束销毁容器。未配 `MYSQL_TEST_URL` 时这两套整体 skip,默认 `pnpm test` 不受影响。

这张网验证过真的会红:把 MySQL 方言的 `<> 'false'` 改成 `<> 0`,parity 与 golden 同时变红。

**仍未覆盖**:MySQL 侧只测了追更查询这一族,其余 `IStorage` 方法在真实 MySQL 上无测试。

## 顺带证实的事实

- MySQL 8.4 严格模式下 `CAST(JSON_UNQUOTE(...) AS SIGNED)` 遇 `'abc'` 返回 0 并给 `Warning 1292`,不报错;SQLite 的 `CAST('abc' AS INTEGER)` 同样是 0,两边一致。
- MySQL 8.4 移除了 `default-authentication-plugin` 变量,容器带这个参数会启动失败。
- Windows 上 `spawnSync` 直接调 `.cmd` 报 EINVAL,需走 `process.execPath` + jest 的 JS 入口。
