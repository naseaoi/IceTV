# 前端界面约束

改页面、组件、样式或后台界面前先读本文。会静默失效的 Tailwind 与滚动约束在 [AGENTS.md](../AGENTS.md#界面硬约束)。

## 视觉

- 强调色统一用 `brand-*`（`tailwind.config.ts` 定义的冰蓝色阶），`gray` 已覆盖为冷调中性灰；分区标题等装饰统一用中性灰，主色只出现在选中态、进度和主操作上。
- 弹窗、下拉、菜单等浮层用实底（`bg-white` / `dark:bg-gray-900` + 细 ring），遮罩只压暗不模糊。吸顶导航与筛选栏同样用实底，底色与页面背景一致（`bg-gray-50` / `dark:bg-gray-950`），靠底部分隔线与内容区分；全站不用毛玻璃。叠在海报上的徽标与按钮用不低于 `bg-black/70` 的深色实底保证可读。弹窗标题、关闭与按钮复用 `src/components/modals/modal-styles.ts`。
- 吸附在桌面顶栏下方的子栏（分区筛选栏、搜索结果栏）根元素加 `data-nav-subbar`，顶栏据此去掉自己的底线，两者连成一块吸顶区，只在子栏底部留一条分隔线。只在部分断点吸附的子栏，只给在顶栏可见断点上吸附的那个元素加。
- 图标用 `lucide-react` 或 SVG，不用 emoji。
- 提醒小圆点（版本更新等）用纯色实心点，不加描边。版本更新提醒只对站长显示，入口统一走 `useHasUpdate()`。
- 悬浮在内容之上的圆形图标按钮（横排滚动箭头、回顶、列表定位）复用 `FLOATING_CONTROL_CLASS`（`src/components/floating-control.ts`），中性实底不用主色，尺寸与定位由调用方追加。
- 海报卡片的徽标、悬停与按压样式取自 `poster-card-layout.ts`（`POSTER_BADGE_*`、`POSTER_CARD_INTERACTION_CLASS`、`POSTER_HOVER_SHADE_CLASS`），悬停收藏按钮用 `PosterFavoriteButton`。海报四角只放状态：左上来源、右上集数或评分、左下更新或我的评分（同一位置只显示一个）、右下悬停收藏；年份、来源数等次要信息放标题下的副标题行，播放、外链、删除等操作走卡片菜单。
- 网格加副标题行时，虚拟网格行高改用 `POSTER_VIRTUAL_GRID_WITH_SUBTITLE_LAYOUT`（`poster-grid-layout.ts`），骨架传 `subtitle`，否则滚动定位与骨架高度会错位。

## 布局与导航

- 桌面端导航是 `src/components/TopNav.tsx`（由 `PageLayout` 挂载），页面水平容器统一用 `PAGE_CONTAINER_CLASS`（`src/components/page-container.ts`），否则内容与导航左边缘错位。
- 移动端顶部区域由 `PageLayout` 按路径决定：首页与 `/douban` 走 `MobileChannelHeader`（频道条，频道列表与高亮规则在 `src/components/channel-nav.ts`，与桌面顶栏共用），其余页面走 `MobileHeader`；传 `mobileHeader={false}` 表示页面自带顶部区域（搜索、`/me`）。频道页忽略 `mobileHeader` 的标题和操作按钮，入口不要放在那里。
- 只改地址栏参数、不想重新请求服务端组件时，用 `window.history.replaceState(null, '', url)` 并让页面从 `useSearchParams()` 读取参数（如继续观看页的 `filter`）。传入 `window.history.state` 会带上 Next 内部标记 `__NA`，路由不会同步新地址，之后的路由重渲染或前进后退会把地址和页面状态恢复成旧值。
- 账号相关能力（退出、登录跳转、版本更新标记、设置 / 改密 / 版本面板）在 `src/components/user-menu/`，桌面 `UserMenu` 与移动端 `/settings` 共用。
- 消息面板是固定高度的居中浮层，列表、通知设置与评价详情在同一框内滚动，空、加载与错误状态在框内居中。改回随内容伸缩会让面板在切换视图、加载完成或标记已读时整体上下跳动。
- `/me` 下各标签页的外壳（`PageLayout`、个人横幅、标签栏）由 `app/me/layout.tsx` 的 `MeShell` 提供，子页面与其 `loading.tsx` 只渲染内容区，**再套 `PageLayout` 会出现双层导航**。概览页及其骨架放在路由组 `app/me/(overview)/`，`app/me/` 根目录不放 `loading.tsx`，否则冷加载其他标签会先闪出概览骨架。海报网格统一用 `POSTER_GRID_CLASS`（`src/components/poster-grid-layout.ts`）。
- 年度报告 `/recap/[year]`（本人）与 `/u/[profileId]/recap/[year]`（公开快照）是不套 `PageLayout` 的全屏层，跟随站点主题。两条路由的 layout 都套 `RecapRoot`（`src/features/annual-report/components/RecapRoot.tsx`），它引入 `recap.css`（专用动效与细字重映射，减弱动效在同文件降级）并单独加载 200/300 字重；全站 Inter 只加载 400–800，挪出 `.recap-root` 的 `font-extralight` / `font-light` 会静默回退成常规字重。卡片文案的人称、昵称、年份切换与退出链接都取自 `RecapAudience`（`lib/audience.ts`），不在卡片里写死「你」或 `/me`；公开快照隐藏作息时由 `buildSlides()` 跳过作息卡片。舞台的点击、滚轮与触摸只响应舞台自身 DOM 内的事件，经 portal 挂到 body 的弹窗（如分享面板）冒泡上来不翻页，键盘翻页在有 `ModalShell` 打开时暂停。翻页手势只在卡片滚动区已到边缘时生效，内容超高的卡片先滚动再翻页。桌面 9:16 舞台的启用条件是宽 ≥ 768px 且高 ≥ 600px，不用 `md:`，否则手机横屏会被挤成窄条。卡片内容垂直居中用 `SlideBody` 的 `center`（`safe center`），直接写 `justify-center` 会在矮视口裁掉顶部且无法滚回。

## 加载反馈与骨架

- 骨架块用 `globals.css` 的 `skeleton` 类（自带底色与扫光，只加在叶子块上，父子叠加会出现两层动画），转圈用 `src/components/Spinner.tsx`（ArtPlayer 缓冲图标复用其 `SPINNER_MARKUP`），整页加载 / 错误用 `LoadingStatePanel`，播放器内遮罩用 `PlayerStateOverlay`。不要再手写 `animate-pulse` 灰块或 `animate-spin` 图标。
- `PlayerStateOverlay` 须与播放器容器同级挂在 `playerOverlay` 位置，`globals.css` 靠 `:has()` 在遮罩显示时隐藏内置缓冲指示。
- 骨架与真实组件共用布局常量（`poster-card-layout.ts`、`continue-card/layout.ts`、`section-header.ts`、`src/features/home/lib/home-layout.ts`、`src/features/search/lib/search-layout.ts`），文字行用 `SkeletonText` 传入与真实文字相同的字号、行高与间距类，与标签同行的计数（含筛选胶囊、标签页等按钮内的计数）用 `SkeletonNumber` 传入与真实数字相同的字号字重类（宽度由隐形等宽数字撑出），不用固定宽度的灰块，否则按钮在占位与真实数字之间来回变宽；位数取已知值，`LibraryToolbar` 按 `countsKey` 记住上次位数。**不要手写像素高度**。改卡片、标题或间距时改共享常量，骨架随之同步；只改真实组件一侧会让骨架换成内容时跳动。
- 列表骨架数量跟随已知的真实条数，只用手上已有的数量，不为骨架另发计数请求：本标签页内的快照与已知计数（如 `src/lib/my-review-count.ts`、播放记录快照）优先，其次是计数 cookie。本人列表（收藏、继续观看、评价、观看历史）在拿到数据后把条数写入计数 cookie，路由 `loading.tsx` 与 `page.tsx` 经 `getListSkeletonCount()` 读取，首屏 HTML 即按真实条数渲染；cookie 名单与读写统一在 `src/lib/list-count-cookies.ts`，新增本人列表时加入名单。登录时先清空再由 `src/lib/list-count-seed.server.ts` 按列表接口同一口径写入当前账号的计数（新增本人列表时同步补上），退出时清空；cookie 不区分账号，因此计数不落 localStorage。缺少 cookie 按 0 处理。只有搜索结果、分类等无法预知条数或总是满页的列表用固定默认值。
- 已知为 0 时渲染与空状态同高的空状态骨架（与空状态共用留白常量，如 `LibraryEmptySkeleton`、`HISTORY_PREVIEW_EMPTY_CLASS`），不画列表骨架，也不提前渲染真实空状态：计数可能来自其他设备写入前的旧值，"还没有……"再变成列表看起来像出错。最终什么都不渲染的区块（首页继续观看、搜索历史）已知为 0 时不占位。首屏骨架期间分页底栏不再显示 `Spinner`，转圈只用于加载更多。
- 封面统一用 `CoverImage`：它自己用 `IntersectionObserver` 与 `imageScheduler` 决定何时挂载 `<img>`，所以图片固定 `loading='eager'`，改回原生懒加载会让超时计时早于请求开始。等待上限是后台"图片代理超时"加 5 秒，服务端还在回源时前端不先判失败；超时只显示占位、不写失败缓存，加载错误才写（10 分钟），且写入本轮全部候选地址，重新挂载时首个候选即命中。源站封面 `auto` 模式下，代理失败且直连成功的域名在本标签页改为直连，10 分钟后重新尝试代理；两者都失败视为图片本身的问题，不改变同域名其他封面的加载方式。
- `CoverImage` 的加载态先等 200ms：缓存命中的图片在此之前完成就直接显示，不播扫光与淡入；超过才显示扫光，完成后淡入。会话级显示记录（`src/lib/cover-image-cache.ts`）只表示这张图显示过，不区分尺寸规格；记录命中但 `<img>` 挂载后仍未完成（换了规格或浏览器缓存已淘汰）时回到普通加载流程。
- 列表骨架只用于尚无结果的首次加载。已展示过结果后切换筛选、排序或搜索，保留屏幕上的旧结果（列表或空状态）并变暗、标 `aria-busy` 与 `inert`，新结果到达再替换；刷新期间同时停用无限滚动，否则触发标记不复位会让自动加载停住。游标分页列表统一用 `src/hooks/usePagedQuery.ts`（收藏、我的评价已接入）：它负责请求竞态与取消、组件实例内的首页快照、加载更多去重，返回 `initialLoading`（显示骨架）与 `refreshing`（变暗旧结果）。快照不跨页面保留；本地写入用 `updateData` 改当前数据，收到写入事件调 `refresh` 清空快照重新拉取。

## 动效

- 缓动统一用 `globals.css` 的 `--motion-spring`（明显回弹）、`--motion-spring-soft`（轻微回弹）、`--motion-ease-out` 与 `--motion-ease-in`，不在组件里另写贝塞尔曲线。弹簧曲线由 `linear()` 采样，不支持时退回近似的 `cubic-bezier`。
- 浮层进出场：下拉与菜单加 `motion-popover`，弹窗面板加 `motion-dialog`，遮罩加 `motion-backdrop`，统一用 `data-open` 切换。挂载与卸载交给 `usePresence`，**卸载延时要比 CSS 离场过渡长约 40ms**，否则开发模式或主线程繁忙时离场动画会被截断。下拉与菜单用 `--popover-origin` 指定展开原点、`--popover-shift` 指定位移方向。
- 居中弹窗一律用 `ModalShell`，它负责进出场、遮罩、滚动锁定与 Esc（叠放时只关最上层），不再手写遮罩与 `fixed` 面板。父组件条件渲染会让弹窗瞬间卸载、退场动画丢失：常驻的弹窗由父组件传 `isOpen` 控制，关闭时会被清空的目标数据用 `useRetainedValue` 保留最后一份，撑住退场期间的内容；按需加载、打开时才挂载的面板在内部用同文件的 `useDeferredClose(onClose)` 拿到 `open` 与 `requestClose`，所有关闭入口都走 `requestClose`，退场结束后才通知父组件卸载。弹窗内容放在 `ModalShell` 的子组件里，每次打开重新挂载，初始状态在首帧直接从本地存储读出，不在副作用里补读，避免内容跳动。消息面板等不经 `ModalShell` 的自绘浮层自行监听 Esc 时，先用 `hasOpenModalShell()` 判断，有弹窗叠在上面就不处理，否则会和上层弹窗一起被关闭。
- 同一区域整组内容切换（如“常看”切换周/月/年）时，内容容器以当前范围为 `key` 重新挂载，条目加 `motion-swap-in` 并给出 `--stagger-index`，容器的 `--swap-shift` 用正负表示切换方向；首次展示不加。
- 导航与标签栏的选中条用 `useSlidingIndicator`：目标项加 `data-indicator-target`，容器设为定位元素。指示条由 Web Animations 驱动 `transform`，在合成层运行，换页时主线程繁忙也不掉帧，不要改回 `left`/`width` 过渡。随页面重新挂载的导航（顶栏、移动端频道条）传 `memoryKey`，新页面才能从上一页的位置滑过来；链接式导航配合同文件的 `usePendingTarget`，点击后立即切换选中态，不等路由完成。
- 收藏爱心的回弹与粒子只在用户点击后、收藏状态真正翻转时播放，异步加载或其他页面同步的状态变化不播放。评分星的弹起同理，由 `RatingInput` 在用户改分时传 `pop` 给 `RatingStars`，外部传入的新分值不播放。
- 计数（点赞、粉丝、未读）用 `AnimatedCount`，数值变化时按增减方向滚动；首次渲染不播放，跨实体复用同一组件时（如切换个人主页）用 `key` 重置。
- 列表增删与重排用 `useListLayoutMotion(keys)`：容器设为定位元素并挂返回的 ref，列表项根元素加 `data-list-motion-key`，值与 React key 一致。被删项由 React 移出后，原节点放回容器原位置作为残影淡出，其余项按布局偏移（`offsetLeft`/`offsetTop`，不受进行中的变换影响）做 FLIP 滑动。增或删超过 8 项、只在末尾追加（加载更多）、首批数据到达时直接切换。子项是无法加属性的组件时传 `matchChildOrder`，按直接子元素顺序对应 keys，`ScrollableRow` 已内置。虚拟网格按序号绝对定位，不接这个 hook。分组列表（如消息面板）整表共用一个容器，分组标题与空状态也带 key；每组各用一个容器时，组被删空会随容器卸载丢掉离场动画，下一组也不会滑动补位。
- 动效须处理 `prefers-reduced-motion`：CSS 动效在 `globals.css` 的减弱动效媒体查询里降级，JS 驱动的动效自行检查该媒体查询。

## 通用组件

- 下拉统一用 `src/components/Select.tsx`（`field` 表单整宽、`pill` 工具栏胶囊），`AdminSelect` 只是 `field` 的包装。下拉层挂到 `body` 上按触发器 `fixed` 定位，放在弹窗等滚动容器内不会被裁切，下方空间不足时向上展开；`field` 与触发器等宽，`pill` 随最长选项自适应。“更多”操作菜单统一用 `src/components/MoreMenu.tsx`，同样挂 `body`。
- 操作结果、错误与提醒的轻提示统一调 `showToast()`（`src/lib/toast.ts`），由根布局的 `ToastViewport` 渲染；`triggerGlobalError()`、消息中心新消息提醒、站长的新版本提醒都走这条路径。只需告知结果的场景不用 `AlertModal` 加 `timer`，弹窗留给需要用户确认的情况。
  - 同一 `key` 的提示原地更新文案并重新计时，同时播放一次回弹，不叠加；默认 `key` 为语气加文案，所以连续重复同一操作只会回弹不会刷屏。轮询类提醒传固定 `key`，需要主动收起时调 `dismissToast(key)`。
  - `notice` 用于需要用户留意的提醒，可带一个 `action`；点击后执行回调并收起提示。
  - 离场动画时长由 CSS 的 `.toast-*` 动画决定，`TOAST_LEAVE_MS` 必须与之一致，否则节点会在动画结束前被移除或残留。
  - 只在用户主动触发、且界面上没有其他可见变化的操作后提示成功；列表行消失、按钮状态切换等已有直接反馈的操作不再叠加提示。
- 长文本折叠用 `src/components/ExpandableText.tsx`；弹窗外壳 `ModalShell` 支持 `backdropClassName`（遮罩底色）与 `initialFocusRef`（打开后聚焦的元素）。
- 卡片菜单与标记评分入口见 [评价与收藏](reviews-favorites.md#入口复用)。

## 后台

- 新增 tab：在 `src/features/admin/lib/admin-tabs.ts` 注册，在 `AdminTabContent.tsx` 挂载；`useAdminTab.ts` 经注册表解析，无需改动。
- 弹窗复用 `ConfirmModal` / `AlertModal`；表单样式复用 `src/features/admin/lib/buttonStyles.ts`（`buttonStyles` / `inputStyles` / `checkboxStyles`）。
- 设置类内容用 `AdminSettings.tsx` 的 `AdminSettingsGroup` / `AdminSettingRow`，开关用 `AdminStatusSwitch`，列表行操作收进 `MoreMenu`。`AdminSettingRow` 的 `description` 放标题下方的说明，测试结果、致谢链接等短状态用 `labelAddon` 与标题同行。
- `ADMIN_PANEL_CLASS` 外框不裁切溢出，行内下拉才能伸出；贴边底色的子元素自行加圆角，不要给外框补 `overflow-hidden`。
