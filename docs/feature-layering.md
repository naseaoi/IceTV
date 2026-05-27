# Feature 分层规范

所有 feature（业务域）统一按以下结构分层，避免 page 文件堆积业务逻辑、components 与 features 边界模糊。

## 目录结构

```
src/
├── app/                       # 仅路由装配 + 渲染分支
│   └── <route>/page.tsx       # 入口 client，调用 features 中的 hooks 与组件
├── components/                # 跨 feature 通用 UI（VideoCard、PageLayout、modals 等）
├── hooks/                     # 跨 feature 通用 hooks
├── lib/                       # 跨 feature 通用工具与服务端访问
└── features/<domain>/         # 业务域
    ├── components/            # 该业务域专属 UI
    ├── hooks/                 # 该业务域专属行为 hooks
    ├── lib/                   # 该业务域专属纯逻辑、策略
    └── types/                 # 该业务域的类型
        ├── api.ts             # 对外（API / 跨业务域）共享类型
        └── internal.ts        # 仅业务域内部使用的类型
```

当前已建立的 feature：

- `features/admin` — 管理后台
- `features/home` — 首页
- `features/live` — 直播
- `features/play` — 播放页
- `features/search` — 搜索

## 核心约定

### page 只装配，不写业务

`src/app/<route>/page.tsx` 只允许：

- import features 下的 hooks / 组件
- 装配 hooks、传递 props
- 处理路由级别的 loading / error 分支

业务实现（状态管理、请求、副作用、子视图）一律放进 `features/<domain>/{hooks,lib,components}`。

### 组件归属判断

只被某一业务域使用 → `features/<domain>/components/`。
被两个以上业务域使用 → `src/components/`。

### Hook 归属判断

只用于某业务域的状态/副作用 → `features/<domain>/hooks/`。
跨业务域通用（如 `useLongPress`、`useModalState`） → `src/hooks/`。

### 类型归属判断

只在业务域内传递 → `features/<domain>/types/internal.ts`。
API 响应、跨业务域共享 → `features/<domain>/types/api.ts`。

### 命名

- 文件使用短横线命名（`source-match.ts`），不混用蛇形（`source_match.ts`）。
- React 组件文件使用大驼峰（`HomeClient.tsx`）。
- Hook 文件使用 `use` 前缀小驼峰（`useEpisodeSwitch.ts`）。

### 路径引用

- 跨目录引用统一使用 `@/...` 绝对路径，不使用 `../../..` 相对路径。
- 动态 `import('./xxx.js')`：因 tsconfig 使用 `moduleResolution: Node16`，相对动态 import 须显式带 `.js` 后缀；webpack 端已在 `next.config.js` 通过 `resolve.extensionAlias` 把 `.js` 映射回 `.ts`。

## 维护

新增 feature 时先建立完整目录骨架（即使部分子目录暂时为空），后续添加文件时按上述归属规则归位。

模板：

```
features/<new-domain>/
├── components/
├── hooks/
├── lib/
└── types/
    ├── api.ts
    └── internal.ts
```
