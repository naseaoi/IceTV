# 开发文档

## 架构与分层规范

### 目录

```text
src/
├── app/<route>/page.tsx     # 仅装配 + 渲染分支，不写业务
├── components/              # 跨 feature 通用 UI
├── hooks/                   # 跨 feature 通用 hooks
├── lib/                     # 跨 feature 通用工具
└── features/<domain>/
    ├── components/          # 业务域专属 UI
    ├── hooks/               # 业务域专属 hooks
    ├── lib/                 # 业务域专属纯逻辑
    └── types/
        ├── api.ts           # API / 跨业务域共享类型
        └── internal.ts      # 业务域内部类型
```

Feature 列表：`admin` · `home` · `live` · `play` · `search` · `douban`

### 归属判断

| 资产                 | 归属                                        |
| -------------------- | ------------------------------------------- |
| 只被某一业务域使用   | `features/<domain>/components\|hooks\|lib/` |
| 被两个以上业务域使用 | `src/components\|hooks\|lib/`               |
| 业务域内部类型       | `features/<domain>/types/internal.ts`       |
| API / 跨业务域类型   | `features/<domain>/types/api.ts`            |

### 命名

- 文件：短横线（`source-match.ts`），不用蛇形
- 组件：大驼峰（`HomeClient.tsx`）
- Hook：`use` + 小驼峰（`useEpisodeSwitch.ts`）
- 导入：统一 `@/...` 绝对路径

### 动态 import

tsconfig `moduleResolution: Node16` 要求相对动态 import 显式带 `.js`：

```ts
const { MySqlStorage } = await import('./mysql.db.js');
```

Webpack 端由 `next.config.js` 的 `resolve.extensionAlias` 把 `.js` 映射回 `.ts`。

### Feature 骨架

建立完整骨架，即使部分子目录为空：

```text
features/<new-domain>/
├── components/
├── hooks/
├── lib/
└── types/
    ├── api.ts
    └── internal.ts
```

## Admin 模块

入口 [src/app/admin/page.tsx](../src/app/admin/page.tsx)，实现位于 [src/features/admin/](../src/features/admin/)。

### 可复用 hooks

Tab 或对话框优先复用：

| Hook                      | 用途                                |
| ------------------------- | ----------------------------------- |
| `useAdminPageActions`     | 配置读写等页面级操作                |
| `useAdminUserActions`     | 用户增删改、角色、用户组操作        |
| `useAdminSourceActions`   | 视频源 / 直播源 / 分类的 CRUD       |
| `useSourceValidation`     | 视频源有效性流式检测                |
| `useSourceBatchOperation` | 视频源批量启用/禁用/删除 + 确认弹窗 |
| `useAlertModal`           | 全局提示弹窗                        |
| `useLoadingState`         | 按钮/操作加载态                     |

### Tab 目录

Tab 子组件目录：

- [components/tabs/user-config/](../src/features/admin/components/tabs/user-config/) — 用户与用户组的表单/对话框/列表
- [components/tabs/video-source/](../src/features/admin/components/tabs/video-source/) — 视频源行/表单/有效性弹窗
- [components/tabs/live-source/](../src/features/admin/components/tabs/live-source/) — 直播源行/添加/编辑表单

新对话框统一放入对应子目录。

### 测试

- [src/app/admin/page.test.tsx](../src/app/admin/page.test.tsx)
- [src/features/admin/hooks/**tests**/](../src/features/admin/hooks/__tests__/)

## API 鉴权

### 核心模块

| 模块                                              | 职责                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| [src/lib/api-auth.ts](../src/lib/api-auth.ts)     | `requireActiveUser` / `requireAdmin` / `requireOwner` / `isGuardFailure` |
| [src/lib/env.server.ts](../src/lib/env.server.ts) | `getOwnerUsername()` / `getOwnerPassword()`                              |
| [src/lib/config.ts](../src/lib/config.ts)         | `getConfig` / `resetConfig`                                              |
| [src/lib/db.ts](../src/lib/db.ts)                 | 服务端统一数据访问入口                                                   |

### 权限层级

| Guard               | 可访问角色    |
| ------------------- | ------------- |
| `requireActiveUser` | 任意登录用户  |
| `requireAdmin`      | admin + owner |
| `requireOwner`      | 仅 owner      |

### API 模板

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

### 状态码

| 状态码 | 语义             |
| ------ | ---------------- |
| 401    | 未登录           |
| 403    | 已登录但权限不足 |
| 400    | 参数错误         |
| 404    | 资源不存在       |
| 500    | 服务异常         |

### Guard 路由检查

```bash
grep -rl "requireActiveUser\|requireAdmin\|requireOwner" src/app/api
```

### 测试

每个权限接口至少覆盖：未登录 → 401、权限不足 → 403、具备权限 → 200。

回归位置：[src/app/api/admin/**tests**/auth-guard.test.ts](../src/app/api/admin/__tests__/auth-guard.test.ts)

### 环境变量

- `ICETV_USERNAME` / `ICETV_PASSWORD`
- 不支持裸名 `USERNAME` / `PASSWORD`
