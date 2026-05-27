# Admin 模块维护指南

管理后台（Admin）的代码分层、类型导入、Hook 复用及测试约定。

## 代码分层

```
src/app/admin/page.tsx          # 页面装配、折叠状态、路由级可见性、重置配置入口
src/features/admin/
  ├── components/tabs/*         # 各配置 tab 视图与交互
  ├── hooks/*                   # admin 行为 hooks（页面/用户/源/弹窗/加载态）
  ├── lib/*                     # 请求、权限、通知、样式
  ├── types.ts                  # admin 内部共享类型
  └── types/api.ts              # admin API 类型（新代码优先从此导入）
```

- `page.tsx` 只做装配，不写业务逻辑。
- 所有管理后台业务实现统一放在 `src/features/admin`。

## 类型导入

- 类型统一从 `src/features/admin/types/api.ts` 导入。
- `src/features/admin/types.ts` 为 admin 内部共享类型。

## Hook 复用

新增功能时优先复用以下 hooks，避免在 tab 内重复写请求模板：

- `useAdminPageActions` — 页面级操作（配置读写等）
- `useAdminUserActions` — 用户管理操作
- `useAdminSourceActions` — 播放源管理操作
- `useAlertModal` — 警告弹窗状态管理
- `useLoadingState` — 按钮/操作加载态管理

## 测试

最小回归覆盖：

- `src/app/admin/page.test.tsx`
- `src/features/admin/hooks/__tests__/useAdminPageActions.test.tsx`
- `src/features/admin/hooks/__tests__/useAdminUserActions.test.tsx`
- `src/features/admin/hooks/__tests__/useAdminSourceActions.test.tsx`
