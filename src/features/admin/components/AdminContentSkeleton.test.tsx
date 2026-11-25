import { render, screen } from '@testing-library/react';

import AdminContentSkeleton, {
  AdminAnnouncementRowsSkeleton,
  AdminReviewRowsSkeleton,
  AdminSkeletonContext,
  AdminUserDanmakuRowsSkeleton,
  AdminUserRowsSkeleton,
} from '@/features/admin/components/AdminContentSkeleton';
import { COMMON_RUNTIME_PARAM_GROUPS } from '@/features/admin/lib/runtime-param-fields';
import type { AdminConfig } from '@/types/admin';

it('站点骨架的扫光仅出现在叶子块', () => {
  const { container } = render(<AdminContentSkeleton activeTab='site' />);
  expect(container.querySelector('.skeleton .skeleton')).toBeNull();
  expect(container.firstElementChild).not.toHaveClass('rounded-xl');
});

it('运行参数骨架与真实字段分组共用元数据', () => {
  render(<AdminContentSkeleton activeTab='runtime' />);
  for (const group of COMMON_RUNTIME_PARAM_GROUPS) {
    expect(
      screen.getByRole('heading', { name: group.title }),
    ).toBeInTheDocument();
    for (const field of group.fields)
      expect(screen.getByText(field.label)).toBeInTheDocument();
  }
});

it('动态内容骨架沿用当前标签和已加载的实际列表数量', () => {
  const config = {
    CustomCategories: Array.from({ length: 6 }, () => ({})),
  } as AdminConfig;
  const { container } = render(
    <AdminSkeletonContext.Provider value={{ activeTab: 'category', config }}>
      <AdminContentSkeleton />
    </AdminSkeletonContext.Provider>,
  );
  expect(container.querySelectorAll('.divide-y > div')).toHaveLength(6);
  expect(container.querySelectorAll('.sm\\:w-auto')).toHaveLength(6);
});

it('空列表按最终空态高度占位', () => {
  const config = { SourceConfig: [] } as unknown as AdminConfig;
  const { container } = render(
    <AdminContentSkeleton activeTab='video-source' config={config} />,
  );
  expect(container.querySelector('.py-12')).toBeInTheDocument();
});

it.each([
  'user',
  'announcements',
  'video-source',
  'live-source',
  'category',
] as const)('配置未知时 %s 列表只转圈', (activeTab) => {
  const { container } = render(
    <AdminContentSkeleton activeTab={activeTab} config={null} />,
  );
  expect(container.querySelector('.ice-spinner')).toBeInTheDocument();
  expect(container.querySelector('.divide-y .skeleton')).toBeNull();
});

it.each([
  ['用户', AdminUserRowsSkeleton],
  ['公告', AdminAnnouncementRowsSkeleton],
  ['评价', AdminReviewRowsSkeleton],
  ['弹幕', AdminUserDanmakuRowsSkeleton],
] as const)('%s 按已知条数渲染骨架', (_label, Rows) => {
  const { container } = render(<Rows count={3} />);
  expect(container.querySelectorAll('.divide-y > div')).toHaveLength(3);
});

it('用户首屏条数以每页上限裁剪', () => {
  const { container } = render(<AdminUserRowsSkeleton count={100} />);
  expect(container.querySelectorAll('.divide-y > div')).toHaveLength(50);
});

it.each([
  AdminReviewRowsSkeleton,
  AdminUserDanmakuRowsSkeleton,
  AdminAnnouncementRowsSkeleton,
  AdminUserRowsSkeleton,
])('已知为空时使用空状态骨架', (Rows) => {
  const { container } = render(<Rows count={0} />);
  expect(container.querySelector('.skeleton')).toBeInTheDocument();
  expect(container.querySelector('.ice-spinner')).toBeNull();
  expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument();
});
