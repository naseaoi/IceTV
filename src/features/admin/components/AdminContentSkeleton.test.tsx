import { render, screen } from '@testing-library/react';

import AdminContentSkeleton, {
  AdminSkeletonContext,
} from '@/features/admin/components/AdminContentSkeleton';
import { COMMON_RUNTIME_PARAM_GROUPS } from '@/features/admin/lib/runtime-param-fields';
import type { AdminConfig } from '@/types/admin';

it('站点骨架使用新版设置分区，扫光仅出现在叶子块', () => {
  const { container } = render(<AdminContentSkeleton activeTab='site' />);
  expect(
    screen.getAllByRole('heading').map((heading) => heading.textContent),
  ).toEqual(['基本信息', '数据与图片代理', '功能', '本地设置默认值']);
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
