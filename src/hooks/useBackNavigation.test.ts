import { renderHook } from '@testing-library/react';

const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/play',
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

import { useBackNavigation } from './useBackNavigation';

function setNavigation(entries: string[] | null) {
  const value = entries
    ? {
        canGoBack: entries.length > 1,
        currentEntry: { index: entries.length - 1 },
        entries: () =>
          entries.map((url, index) => ({
            url: `${window.location.origin}${url}`,
            index,
          })),
      }
    : undefined;
  Object.defineProperty(window, 'navigation', {
    configurable: true,
    value,
  });
}

describe('useBackNavigation', () => {
  beforeEach(() => {
    mockBack.mockReset();
    mockReplace.mockReset();
  });

  afterAll(() => {
    setNavigation(null);
  });

  it('上一条历史就是 returnTo 时后退，保留来源页滚动位置', () => {
    window.history.replaceState(null, '', '/play?id=1&returnTo=%2F%3Ftab%3Dtv');
    setNavigation(['/?tab=tv', '/play?id=1&returnTo=%2F%3Ftab%3Dtv']);

    const { result } = renderHook(() => useBackNavigation('/'));
    result.current();

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('上一条历史不是 returnTo 时替换到 returnTo', () => {
    window.history.replaceState(null, '', '/play?id=1&returnTo=%2Ffavorites');
    setNavigation(['/search?q=a', '/play?id=1&returnTo=%2Ffavorites']);

    const { result } = renderHook(() => useBackNavigation('/'));
    result.current();

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/favorites');
  });

  it('不支持 Navigation API 时替换到 returnTo', () => {
    window.history.replaceState(null, '', '/play?id=1&returnTo=%2Ffavorites');
    setNavigation(null);

    const { result } = renderHook(() => useBackNavigation('/'));
    result.current();

    expect(mockReplace).toHaveBeenCalledWith('/favorites');
  });
});
