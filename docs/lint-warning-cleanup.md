# Lint Warning 清理计划

创建日期：2026-07-06

## 当前基线

当前 warning 共 213 个，分三类：

- `simple-import-sort/imports`：153 个
- `react-hooks/exhaustive-deps`：33 个
- `unused-imports/no-unused-vars`：27 个

阶段 1 后 warning 共 60 个：

- `react-hooks/exhaustive-deps`：33 个
- `unused-imports/no-unused-vars`：27 个
- `simple-import-sort/imports`：0 个

## 阶段 1：Import 排序

状态：已完成。

目标：

- 清理全部 `simple-import-sort/imports` warning。
- 只做机械排序，不改业务逻辑。
- 使用 ESLint autofix 完成。

验收：

- `simple-import-sort/imports` 数量为 0。已通过。
- `pnpm typecheck` 通过。已通过。
- `pnpm test -- --runInBand` 通过。已通过。

风险：

- 低。仅调整 import 顺序。
- 需要关注少量带副作用 import 的文件，确认排序后仍符合运行预期。

## 阶段 2：未使用变量

目标：

- 清理 `unused-imports/no-unused-vars` warning。
- 优先处理 catch 参数、旧 helper、未使用局部变量。
- 不为了消除 warning 删除仍有业务含义的占位参数。

验收：

- `unused-imports/no-unused-vars` 数量为 0。
- `pnpm typecheck` 通过。
- 相关测试通过。

风险：

- 中低。大部分是死变量，但需要逐项确认是否是接口占位。

## 阶段 3：Hooks 依赖

目标：

- 审查 `react-hooks/exhaustive-deps` warning。
- 优先处理播放、直播、搜索链路中的 stale closure 风险。
- 对确认为稳定 ref 模式的代码，用结构调整或局部说明收口。

验收：

- `react-hooks/exhaustive-deps` 数量明显下降。
- 播放进度、换源、直播、搜索相关测试通过。
- 不引入重复请求、重复保存、播放器重建等行为回归。

风险：

- 中高。不能批量自动修，需要逐个读业务上下文。

## 收口标准

全部阶段完成后：

- `pnpm lint:strict` 通过。
- `pnpm typecheck` 通过。
- `pnpm test -- --runInBand` 通过。
