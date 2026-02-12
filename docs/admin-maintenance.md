# Admin 维护约定

## 代码分层

- `src/app/admin/page.tsx` 仅负责页面装配、折叠状态、路由级可见性与重置配置入口。
- 管理后台业务实现统一放在 `src/features/admin`：
  - `components/tabs/*`：各配置 tab 视图与交互
  - `hooks/*`：admin 行为 hooks（页面动作、用户动作、源动作）
  - `lib/*`：请求/权限/通知/样式
  - `types/*`：admin 专属类型

## 类型导入约定

- `src/lib/admin.types.ts` 保留兼容导出；新代码优先从 `src/features/admin/types/api.ts` 导入类型。

## 实现复用约定

- 管理后台新增功能时，优先复用 `useAdminPageActions`、`useAdminUserActions`、`useAdminSourceActions`，避免在 tab 内重复写请求模板。

## 最小回归建议

- `src/app/admin/page.test.tsx`
- `src/features/admin/hooks/__tests__/useAdminPageActions.test.tsx`
- `src/features/admin/hooks/__tests__/useAdminUserActions.test.tsx`
- `src/features/admin/hooks/__tests__/useAdminSourceActions.test.tsx`
