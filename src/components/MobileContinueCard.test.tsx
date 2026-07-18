import { render, screen } from '@testing-library/react';

import MobileContinueCard from '@/components/MobileContinueCard';

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

describe('MobileContinueCard', () => {
  it('有集数时在集数下方显示源站名', () => {
    render(<MobileContinueCard {...baseProps} sourceName='测试源站' />);

    expect(screen.getByText('第 3 集 / 共 12 集')).toHaveAttribute(
      'data-mobile-continue-meta',
    );
    expect(screen.getByText('测试源站')).toHaveAttribute(
      'data-mobile-continue-source',
    );
  });

  it('没有多集信息时显示年份和源站名', () => {
    render(
      <MobileContinueCard
        {...baseProps}
        currentEpisode={1}
        totalEpisodes={1}
        year='2026'
        sourceName='测试源站'
      />,
    );

    expect(screen.getByText('2026')).toHaveAttribute(
      'data-mobile-continue-meta',
    );
    expect(screen.getByText('测试源站')).toHaveAttribute(
      'data-mobile-continue-source',
    );
  });

  it('缺少源站名称时使用源标识兜底', () => {
    render(<MobileContinueCard {...baseProps} sourceName='' />);

    expect(screen.getByText('source-key')).toHaveAttribute(
      'data-mobile-continue-source',
    );
  });
});
