import { render, screen } from '@testing-library/react';

import { LivePlayerOverlay } from '@/features/live/LivePageClient';

jest.mock('@/components/LoadingStatePanel', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe('LivePlayerOverlay', () => {
  it('keeps loading and unsupported overlays transparent to player input', () => {
    const { rerender } = render(
      <LivePlayerOverlay unsupportedType={null} isVideoLoading />,
    );

    expect(screen.getByText('IPTV 加载中...').parentElement).toHaveClass(
      'pointer-events-none',
    );

    rerender(
      <LivePlayerOverlay unsupportedType='flv' isVideoLoading={false} />,
    );

    expect(screen.getByText('暂不支持的直播流类型').parentElement).toHaveClass(
      'pointer-events-none',
    );
  });
});
