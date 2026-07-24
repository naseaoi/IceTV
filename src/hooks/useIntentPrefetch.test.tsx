import { act, renderHook } from '@testing-library/react';

const mockPrefetch = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: mockPrefetch }),
}));

import { useIntentPrefetch } from './useIntentPrefetch';

describe('useIntentPrefetch', () => {
  beforeEach(() => {
    mockPrefetch.mockReset();
  });

  it('只为同一路由发起一次预取', () => {
    const { result } = renderHook(() => useIntentPrefetch());

    act(() => {
      result.current('/douban?type=movie');
      result.current('/douban?type=movie');
      result.current('/search');
    });

    expect(mockPrefetch).toHaveBeenCalledTimes(2);
    expect(mockPrefetch).toHaveBeenNthCalledWith(1, '/douban?type=movie');
    expect(mockPrefetch).toHaveBeenNthCalledWith(2, '/search');
  });
});
