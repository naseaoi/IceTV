# 架构与分层规范

## 目录

```
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

现有 feature：`admin` · `home` · `live` · `play` · `search` · `douban`

## 归属判断

| 资产                 | 归属                                        |
| -------------------- | ------------------------------------------- |
| 只被某一业务域使用   | `features/<domain>/components\|hooks\|lib/` |
| 被两个以上业务域使用 | `src/components\|hooks\|lib/`               |
| 业务域内部类型       | `features/<domain>/types/internal.ts`       |
| API / 跨业务域类型   | `features/<domain>/types/api.ts`            |

## 命名

- 文件：短横线（`source-match.ts`），不用蛇形
- 组件：大驼峰（`HomeClient.tsx`）
- Hook：`use` + 小驼峰（`useEpisodeSwitch.ts`）
- 导入：统一 `@/...` 绝对路径

## 动态 import

tsconfig `moduleResolution: Node16` 要求相对动态 import 显式带 `.js`：

```ts
const { MySqlStorage } = await import('./mysql.db.js');
```

Webpack 端由 `next.config.js` 的 `resolve.extensionAlias` 把 `.js` 映射回 `.ts`。

## 新增 feature

建立完整骨架，即使部分子目录为空：

```
features/<new-domain>/
├── components/
├── hooks/
├── lib/
└── types/
    ├── api.ts
    └── internal.ts
```
