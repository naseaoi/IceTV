# API 与权限维护地图

本文档用于后续维护，不再记录阶段性重构过程。

## 1. 关键模块总览

- `src/lib/api-auth.ts`
  - `requireActiveUser(request, options?)`：登录态 + 用户状态校验
  - `requireAdmin(request, options?)`：管理员/站长校验
  - `requireOwner(request, options?)`：仅站长校验
  - `isGuardFailure(result)`：统一失败分支判断
- `src/lib/env.server.ts`
  - `getOwnerUsername()`：`ICETV_USERNAME` > `MOONTV_USERNAME` > `USERNAME`
  - `getOwnerPassword()`：`ICETV_PASSWORD` > `MOONTV_PASSWORD` > `PASSWORD`
- `src/lib/config.ts`
  - 提供 `getConfig/resetConfig` 等配置读写能力
- `src/lib/db.ts`
  - 服务端统一数据访问入口

## 2. 鉴权语义约定（必须保持）

- 未登录：`401`
- 已登录但权限不足：`403`
- 参数错误：`400`
- 资源不存在：`404`
- 服务异常：`500`

说明：

- 非 admin 路由通常只需要 `requireActiveUser`。
- admin 路由按权限层级使用：
  - owner/admin 都可访问：`requireAdmin`
  - 仅 owner 可访问：`requireOwner`

## 3. 已接入 Guard 的核心路由

### 3.1 用户能力 API

- `src/app/api/favorites/route.ts`
- `src/app/api/playrecords/route.ts`
- `src/app/api/searchhistory/route.ts`
- `src/app/api/skipconfigs/route.ts`
- `src/app/api/search/route.ts`
- `src/app/api/search/resources/route.ts`
- `src/app/api/search/one/route.ts`
- `src/app/api/search/suggestions/route.ts`
- `src/app/api/search/ws/route.ts`
- `src/app/api/detail/route.ts`
- `src/app/api/change-password/route.ts`

### 3.2 管理 API

- `src/app/api/admin/config/route.ts`
- `src/app/api/admin/site/route.ts`
- `src/app/api/admin/source/route.ts`
- `src/app/api/admin/category/route.ts`
- `src/app/api/admin/live/route.ts`
- `src/app/api/admin/live/refresh/route.ts`
- `src/app/api/admin/user/route.ts`
- `src/app/api/admin/source/validate/route.ts`
- `src/app/api/admin/config_file/route.ts`（owner）
- `src/app/api/admin/config_subscription/fetch/route.ts`（owner）
- `src/app/api/admin/reset/route.ts`（owner）
- `src/app/api/admin/data_migration/export/route.ts`（owner）
- `src/app/api/admin/data_migration/import/route.ts`（owner）

## 4. 新增 API 的推荐模板

### 4.1 普通登录用户接口

```ts
const guardResult = await requireActiveUser(request);
if (isGuardFailure(guardResult)) return guardResult.response;

const username = guardResult.username;
```

### 4.2 管理员接口

```ts
const guardResult = await requireAdmin(request);
if (isGuardFailure(guardResult)) return guardResult.response;
```

### 4.3 站长接口

```ts
const guardResult = await requireOwner(request);
if (isGuardFailure(guardResult)) return guardResult.response;
```

## 5. 测试与回归建议

每个新的权限接口至少覆盖三种场景：

1. 未登录 -> `401`
2. 已登录但权限不足 -> `403`
3. 具备权限 -> `200`

推荐优先补齐的自动化测试位置：

- `src/app/api/admin/__tests__/auth-guard.test.ts`

## 6. 环境变量说明（Windows 重点）

- 推荐：`ICETV_USERNAME` / `ICETV_PASSWORD`
- 兼容：`MOONTV_USERNAME` / `MOONTV_PASSWORD` / `USERNAME` / `PASSWORD`

Windows 本地开发环境下，系统级 `USERNAME` 可能覆盖业务期望值，导致站长识别异常。默认优先使用 `ICETV_*`。
