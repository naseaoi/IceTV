# 播放记录保存的时序仲裁（待办，未排期）

## 问题

同一账号对同一 `source+id` 的进度保存，服务端按到达顺序无条件覆盖。较早采样的请求晚到时，会覆盖较新的进度，继续观看倒退到旧集或旧时间。

- 多标签页：两个标签页播放同一作品，A 的旧进度请求延迟或重试，晚于 B 的新进度到达。
- 单标签页：退出事件（pagehide / beforeunload / hidden）在已有在途保存时立即发出 keepalive 请求，两者存在乱序可能（前一个先发，通常先到）。

相关代码：

- 客户端串行只在页面内：`src/features/play/hooks/usePlayProgress.ts`、`usePlayPageState.ts`
- 服务端直接合并后保存：`src/app/api/playrecords/route.ts`（`mergePlayRecordUpdateBaseline`）、`src/lib/play-records.ts`
- 存储层无条件覆盖：`src/lib/sqlite.db.ts`、`src/lib/mysql.db.ts` 的播放记录写入

## 暂不处理的原因

触发需要并发播放同一作品且请求乱序，概率低。直接按客户端 `save_time` 拒绝旧请求，会因多设备时钟偏差误拒正常保存。

## 可选方向

- 客户端为每个播放会话生成会话 ID 与单调序号，服务端在同一会话内拒绝序号回退的写入；跨会话仍按到达顺序。
- 存储层用条件更新（`WHERE` 比较序号）保证原子性，SQLite 与 MySQL 两侧同时实现，并跑 `pnpm test:mysql`。

## 验收

- 同一会话旧序号晚到不覆盖新进度；不同设备时钟偏差不影响正常保存。
- 路由、存储契约测试与 MySQL 真实用例覆盖上述场景。
