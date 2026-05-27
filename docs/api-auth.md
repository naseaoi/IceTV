# API 鉴权

## 核心模块

| 模块                                              | 职责                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| [src/lib/api-auth.ts](../src/lib/api-auth.ts)     | `requireActiveUser` / `requireAdmin` / `requireOwner` / `isGuardFailure`   |
| [src/lib/env.server.ts](../src/lib/env.server.ts) | `getOwnerUsername()` / `getOwnerPassword()`，优先级 `ICETV_*` > `MOONTV_*` |
| [src/lib/config.ts](../src/lib/config.ts)         | `getConfig` / `resetConfig`                                                |
| [src/lib/db.ts](../src/lib/db.ts)                 | 服务端统一数据访问入口                                                     |

## 权限层级

| Guard               | 可访问角色    |
| ------------------- | ------------- |
| `requireActiveUser` | 任意登录用户  |
| `requireAdmin`      | admin + owner |
| `requireOwner`      | 仅 owner      |

## 新增 API 模板

普通用户接口：

```ts
const guardResult = await requireActiveUser(request);
if (isGuardFailure(guardResult)) return guardResult.response;
const username = guardResult.username;
```

管理员接口：

```ts
const guardResult = await requireAdmin(request);
if (isGuardFailure(guardResult)) return guardResult.response;
```

站长接口：

```ts
const guardResult = await requireOwner(request);
if (isGuardFailure(guardResult)) return guardResult.response;
```

## 状态码

| 状态码 | 语义             |
| ------ | ---------------- |
| 401    | 未登录           |
| 403    | 已登录但权限不足 |
| 400    | 参数错误         |
| 404    | 资源不存在       |
| 500    | 服务异常         |

## 已接入 Guard 的路由

```bash
grep -rl "requireActiveUser\|requireAdmin\|requireOwner" src/app/api
```

## 测试

每个权限接口至少覆盖：未登录 → 401、权限不足 → 403、具备权限 → 200。

回归位置：[src/app/api/admin/**tests**/auth-guard.test.ts](../src/app/api/admin/__tests__/auth-guard.test.ts)

## 环境变量

- 推荐 `ICETV_USERNAME` / `ICETV_PASSWORD`
- 兼容 `MOONTV_USERNAME` / `MOONTV_PASSWORD`
- 不支持裸名 `USERNAME` / `PASSWORD`
