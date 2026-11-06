# 前端界面约束

改页面、组件、样式或后台界面前先读本文。会静默失效的 Tailwind 与滚动约束在 [AGENTS.md](../AGENTS.md#界面硬约束)。

## 视觉

- 强调色统一用 `brand-*`（`tailwind.config.ts` 定义的冰蓝色阶），`gray` 已覆盖为冷调中性灰；分区标题等装饰统一用中性灰，主色只出现在选中态、进度和主操作上。
- 弹窗、下拉、菜单等浮层用实底（`bg-white` / `dark:bg-gray-900` + 细 ring），遮罩只压暗不模糊。毛玻璃只用于吸顶导航与筛选栏；叠在海报上的徽标与按钮用不低于 `bg-black/70` 的深色实底保证可读。弹窗标题、关闭与按钮复用 `src/components/modals/modal-styles.ts`。
- 图标用 `lucide-react` 或 SVG，不用 emoji。
- 悬浮在内容之上的圆形图标按钮（横排滚动箭头、回顶、列表定位）复用 `FLOATING_CONTROL_CLASS`（`src/components/floating-control.ts`），中性实底不用主色，尺寸与定位由调用方追加。
- 海报卡片的徽标、悬停与按压样式取自 `poster-card-layout.ts`（`POSTER_BADGE_*`、`POSTER_CARD_INTERACTION_CLASS`、`POSTER_HOVER_SHADE_CLASS`），悬停收藏按钮用 `PosterFavoriteButton`。海报四角只放状态：左上来源、右上集数或评分、左下更新或我的评分（同一位置只显示一个）、右下悬停收藏；年份、来源数等次要信息放标题下的副标题行，播放、外链、删除等操作走卡片菜单。
- 网格加副标题行时，虚拟网格行高改用 `POSTER_VIRTUAL_GRID_WITH_SUBTITLE_LAYOUT`（`poster-grid-layout.ts`），骨架传 `subtitle`，否则滚动定位与骨架高度会错位。

## 布局与导航

- 桌面端导航是 `src/components/TopNav.tsx`（由 `PageLayout` 挂载），页面水平容器统一用 `PAGE_CONTAINER_CLASS`（`src/components/page-container.ts`），否则内容与导航左边缘错位。
- 移动端顶部区域由 `PageLayout` 按路径决定：首页与 `/douban` 走 `MobileChannelHeader`（频道条，频道列表与高亮规则在 `src/components/channel-nav.ts`，与桌面顶栏共用），其余页面走 `MobileHeader`；传 `mobileHeader={false}` 表示页面自带顶部区域（搜索、`/me`）。频道页忽略 `mobileHeader` 的标题和操作按钮，入口不要放在那里。
- 账号相关能力（退出、登录跳转、版本更新标记、设置 / 改密 / 版本面板）在 `src/components/user-menu/`，桌面 `UserMenu` 与移动端 `/settings` 共用。
- `/me` 下各标签页的外壳（`PageLayout`、个人横幅、标签栏）由 `app/me/layout.tsx` 的 `MeShell` 提供，子页面与其 `loading.tsx` 只渲染内容区，**再套 `PageLayout` 会出现双层导航**。概览页及其骨架放在路由组 `app/me/(overview)/`，`app/me/` 根目录不放 `loading.tsx`，否则冷加载其他标签会先闪出概览骨架。海报网格统一用 `POSTER_GRID_CLASS`（`src/components/poster-grid-layout.ts`）。

## 加载反馈与骨架

- 骨架块用 `globals.css` 的 `skeleton` 类（自带底色与扫光，只加在叶子块上，父子叠加会出现两层动画），转圈用 `src/components/Spinner.tsx`（ArtPlayer 缓冲图标复用其 `SPINNER_MARKUP`），整页加载 / 错误用 `LoadingStatePanel`，播放器内遮罩用 `PlayerStateOverlay`。不要再手写 `animate-pulse` 灰块或 `animate-spin` 图标。
- `PlayerStateOverlay` 须与播放器容器同级挂在 `playerOverlay` 位置，`globals.css` 靠 `:has()` 在遮罩显示时隐藏内置缓冲指示。
- 骨架与真实组件共用布局常量（`poster-card-layout.ts`、`continue-card/layout.ts`、`section-header.ts`、`src/features/home/lib/home-layout.ts`、`src/features/search/lib/search-layout.ts`），文字行用 `SkeletonText` 传入与真实文字相同的字号、行高与间距类，与标签同行的计数用 `SkeletonNumber` 传入与真实数字相同的字号字重类（宽度由隐形等宽数字撑出），**不要手写像素高度**。改卡片、标题或间距时改共享常量，骨架随之同步；只改真实组件一侧会让骨架换成内容时跳动。
- 列表骨架数量跟随已知的真实条数（服务端计数、`fav_count` cookie、播放记录快照、接口返回的各筛选计数、本次会话上次看到的数量），只在完全未知时用默认值；已知为 0 时直接渲染空状态，不先闪骨架。首屏骨架期间分页底栏不再显示 `Spinner`，转圈只用于加载更多。

## 通用组件

- 下拉统一用 `src/components/Select.tsx`（`field` 表单整宽、`pill` 工具栏胶囊），`AdminSelect` 只是 `field` 的包装。
- 长文本折叠用 `src/components/ExpandableText.tsx`；弹窗外壳 `ModalShell` 支持 `backdropClassName`（遮罩底色）与 `initialFocusRef`（打开后聚焦的元素）。
- 卡片菜单与标记评分入口见 [评价与收藏](reviews-favorites.md#入口复用)。

## 后台

- 新增 tab：在 `src/features/admin/lib/admin-tabs.ts` 注册，在 `AdminTabContent.tsx` 挂载；`useAdminTab.ts` 经注册表解析，无需改动。
- 弹窗复用 `ConfirmModal` / `AlertModal`；表单样式复用 `src/features/admin/lib/buttonStyles.ts`（`buttonStyles` / `inputStyles` / `checkboxStyles`）。
- 设置类内容用 `AdminSettings.tsx` 的 `AdminSettingsGroup` / `AdminSettingRow`，开关用 `AdminStatusSwitch`，列表行操作收进 `AdminRowMenu`。
- `ADMIN_PANEL_CLASS` 外框不裁切溢出，行内下拉才能伸出；贴边底色的子元素自行加圆角，不要给外框补 `overflow-hidden`。
