# 待修：SQLite 契约测试受执行顺序影响失败

## 现象

`src/lib/__tests__/sqlite-storage-contract.test.ts` 的「通知写入失败回滚评价删除，用户名合并迁移通知并解决幂等冲突」：

- 单独运行通过。
- 同一进程内先跑 `src/lib/__tests__/shared-server-cache.test.ts` 再跑它，稳定失败：`deleteVideoReview(..., true)` 没有抛出 `notice failed`。
- 全量 `pnpm test --runInBand` 的默认顺序会触发；两个文件及其依赖均未被播放调优改动触及。

失败时用例内状态正常：评价行存在且 `is_public = 1`，`fail_notice` 触发器已创建，`user_notice_events` 为空。在 `expect(...).rejects` 之前先用 `try/await` 调用一次同样的删除则会正常抛错，原因未明。

## 复现

用自定义 `testSequencer` 固定顺序（Jest 默认按历史耗时与失败排序，`--runTestsByPath` 不保证顺序）：

```js
// seq.js
const Sequencer = require('@jest/test-sequencer').default;
const path = require('path');
const order = [
  'src/lib/__tests__/shared-server-cache.test.ts',
  'src/lib/__tests__/sqlite-storage-contract.test.ts',
].map((f) => path.resolve(f));
module.exports = class extends Sequencer {
  sort(tests) {
    return tests
      .slice()
      .sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
  }
};
```

```bash
npx jest --runInBand --testSequencer ./seq.js --runTestsByPath \
  src/lib/__tests__/shared-server-cache.test.ts \
  src/lib/__tests__/sqlite-storage-contract.test.ts
```

## 排查方向

- 两个文件共享同一进程内的 better-sqlite3 原生模块；`shared-server-cache.test.ts` 用 `jest.spyOn(db, ...)` 与 `jest.spyOn(Date, 'now')`，并在 `afterEach` 关闭 `:memory:` 库。
- 检查是否有跨文件残留的异步任务、事务状态或 `INSERT OR IGNORE` 与触发器 `RAISE(ABORT)` 的交互在不同条件下表现不同。

## 验收

上述两文件固定顺序运行与全量 `pnpm test --runInBand` 均通过，且不靠调整测试顺序规避。
