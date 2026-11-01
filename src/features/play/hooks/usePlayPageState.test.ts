import { renderHook } from '@testing-library/react';
import type { ReadonlyURLSearchParams } from 'next/navigation';

import { usePlayPageState } from '@/features/play/hooks/usePlayPageState';

function params(query: string) {
  return new URLSearchParams(query) as unknown as ReadonlyURLSearchParams;
}

describe('usePlayPageState 地址参数', () => {
  it('只在首次渲染读取地址参数，换源同步地址后的重渲染不改动页面状态', () => {
    const { result, rerender } = renderHook(
      ({ searchParams }) => usePlayPageState(searchParams),
      {
        initialProps: {
          searchParams: params('source=a&id=a-id&title=%E6%B5%8B%E8%AF%95'),
        },
      },
    );

    rerender({
      searchParams: params('source=b&id=b-id&title=%E5%85%B6%E4%BB%96'),
    });

    expect(result.current.currentSource).toBe('a');
    expect(result.current.currentId).toBe('a-id');
    expect(result.current.videoTitle).toBe('测试');
  });
});
