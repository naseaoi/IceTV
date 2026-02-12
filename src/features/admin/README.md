# Admin Feature Structure

`src/features/admin` 是管理后台的功能边界目录，按职责拆分为：

- `components/`: 纯视图组件与 tab 组件
- `hooks/`: 管理后台专用状态 hooks
  - `useAdminPageActions`: 管理页配置加载与重置流程
  - `useAdminUserActions`: 用户相关写操作封装
  - `useAdminSourceActions`: 视频源/分类/直播源写操作封装
- `lib/`: 请求、权限、通知、样式等可复用逻辑
- `types.ts`: 管理后台内部共享类型
- `index.ts`: 对外统一导出入口

维护约定：

- 页面容器（`src/app/admin/page.tsx`）只负责装配、路由级状态与可见性控制。
- tab 组件负责页面内业务状态与交互，不直接依赖其他 feature 的实现细节。
- 与管理后台无关的通用能力仍放在 `src/lib` 或 `src/components`。
- 冒烟测试位于 `src/features/admin/hooks/__tests__/`，优先覆盖配置加载、重置、用户删除、源保存等关键路径。
