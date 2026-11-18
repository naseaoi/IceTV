import { act, renderHook } from '@testing-library/react';

import { usePlaybackIntentPrefetch } from '@/hooks/usePlaybackIntentPrefetch';
import {
  canUseHoverPrefetch,
  canUseNetworkPrefetch,
  PREFETCH_INTENT_DELAY_MS,
  warmupForPlayback,
} from '@/lib/video-prefetch';

const mockPrefetch = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: mockPrefetch }),
}));
jest.mock('@/lib/video-prefetch', () => ({
  PREFETCH_INTENT_DELAY_MS: 180,
  canUseHoverPrefetch: jest.fn(),
  canUseNetworkPrefetch: jest.fn(),
  warmupForPlayback: jest.fn(),
  warmupSearchForTitle: jest.fn(),
}));
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(canUseHoverPrefetch).mockReturnValue(true);
  jest.mocked(canUseNetworkPrefetch).mockReturnValue(true);
});
afterEach(() => jest.useRealTimers());

it('挂载不预热，悬停延迟后预热路由和详情，离开取消', () => {
  const { result } = renderHook(() =>
    usePlaybackIntentPrefetch({ source: 'a', id: '1' }),
  );
  expect(mockPrefetch).not.toHaveBeenCalled();
  act(() => {
    result.current.onMouseEnter();
    jest.advanceTimersByTime(PREFETCH_INTENT_DELAY_MS - 1);
  });
  expect(warmupForPlayback).not.toHaveBeenCalled();
  act(() => {
    result.current.onMouseLeave();
    jest.advanceTimersByTime(1);
  });
  expect(warmupForPlayback).not.toHaveBeenCalled();
  act(() => {
    result.current.onFocus();
    jest.advanceTimersByTime(PREFETCH_INTENT_DELAY_MS);
  });
  expect(mockPrefetch).toHaveBeenCalledWith('/play');
  expect(warmupForPlayback).toHaveBeenCalledWith('a', '1');
});
it('省流量时 hover 与 focus 都不预热', () => {
  jest.mocked(canUseHoverPrefetch).mockReturnValue(false);
  jest.mocked(canUseNetworkPrefetch).mockReturnValue(false);
  const { result } = renderHook(() =>
    usePlaybackIntentPrefetch({ source: 'a', id: '1' }),
  );
  act(() => {
    result.current.onMouseEnter();
    result.current.onFocus();
    jest.advanceTimersByTime(PREFETCH_INTENT_DELAY_MS);
  });
  expect(mockPrefetch).not.toHaveBeenCalled();
});
