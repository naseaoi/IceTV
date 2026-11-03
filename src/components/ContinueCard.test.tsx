import { render, screen } from '@testing-library/react';

import ContinueCard from '@/components/ContinueCard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/components/CardInteractionProvider', () => ({
  useCardInteractionManager: () => ({
    showActionSheet: jest.fn(),
    showConfirm: jest.fn(),
  }),
}));

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

jest.mock('@/hooks/useLongPress', () => ({
  useLongPress: () => ({}),
}));

const baseProps = {
  source: 'source-key',
  id: 'video-id',
  title: '测试影片',
  poster: '/poster.webp',
  currentEpisode: 3,
  totalEpisodes: 12,
  progress: 50,
  resumeTime: 120,
};

describe('ContinueCard', () => {
  it('有集数时在集数下方显示源站名', () => {
    render(<ContinueCard {...baseProps} sourceName='测试源站' />);

    expect(screen.getByText('第 3 集 / 共 12 集')).toHaveAttribute(
      'data-continue-meta',
    );
    expect(screen.getByText('测试源站')).toHaveAttribute(
      'data-continue-source',
    );
  });

  it('有更新时并入集数行，不额外占行', () => {
    const { container } = render(
      <ContinueCard {...baseProps} hasUpdate availableEpisodes={14} />,
    );

    expect(screen.getByText('更新至 14 集').parentElement).toHaveAttribute(
      'data-continue-meta',
    );
    expect(container.querySelectorAll('p')).toHaveLength(3);
  });

  it('没有多集信息时显示年份和源站名', () => {
    render(
      <ContinueCard
        {...baseProps}
        currentEpisode={1}
        totalEpisodes={1}
        year='2026'
        sourceName='测试源站'
      />,
    );

    expect(screen.getByText('2026')).toHaveAttribute('data-continue-meta');
    expect(screen.getByText('测试源站')).toHaveAttribute(
      'data-continue-source',
    );
  });

  it('缺少源站名称时使用源标识兜底', () => {
    render(<ContinueCard {...baseProps} sourceName='' />);

    expect(screen.getByText('source-key')).toHaveAttribute(
      'data-continue-source',
    );
  });
});
