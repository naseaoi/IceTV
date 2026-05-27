# Admin 模块

入口 [src/app/admin/page.tsx](../src/app/admin/page.tsx)，实现位于 [src/features/admin/](../src/features/admin/)。遵循 [架构规范](architecture.md)。

## 可复用 hooks

新增 tab 或对话框时优先复用：

| Hook                      | 用途                                |
| ------------------------- | ----------------------------------- |
| `useAdminPageActions`     | 配置读写等页面级操作                |
| `useAdminUserActions`     | 用户增删改、角色、用户组操作        |
| `useAdminSourceActions`   | 视频源 / 直播源 / 分类的 CRUD       |
| `useSourceValidation`     | 视频源有效性流式检测                |
| `useSourceBatchOperation` | 视频源批量启用/禁用/删除 + 确认弹窗 |
| `useAlertModal`           | 全局提示弹窗                        |
| `useLoadingState`         | 按钮/操作加载态                     |

## tab 拆分

巨型 tab 已拆为子组件目录：

- [components/tabs/user-config/](../src/features/admin/components/tabs/user-config/) — 用户与用户组的表单/对话框/列表
- [components/tabs/video-source/](../src/features/admin/components/tabs/video-source/) — 视频源行/表单/有效性弹窗
- [components/tabs/live-source/](../src/features/admin/components/tabs/live-source/) — 直播源行/添加/编辑表单

新对话框统一放入对应子目录，避免 tab 主文件膨胀。

## 测试

- [src/app/admin/page.test.tsx](../src/app/admin/page.test.tsx)
- [`src/features/admin/hooks/__tests__/`](../src/features/admin/hooks/__tests__/)
