import { act, renderHook, waitFor } from '@testing-library/react';

import { useLiveSources } from '@/features/live/hooks/useLiveSources';

const mockRouter = { replace: jest.fn() };
const mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

const source = {
  key: 'src',
  name: '测试源',
  url: 'https://example.com/list.m3u',
  from: 'config',
};

const channels = [
  {
    id: 'ch1',
    tvgId: 'ch1',
    name: '频道一',
    logo: '',
    group: '央视',
    url: 'https://example.com/ch1.m3u8',
  },
  {
    id: 'ch2',
    tvgId: 'ch2',
    name: '频道二',
    logo: '',
    group: '央视',
    url: 'https://example.com/ch2.m3u8',
  },
];

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe('useLiveSources', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/live/sources')) {
        return jsonResponse({ success: true, data: [source] });
      }
      if (url.startsWith('/api/live/channels')) {
        return jsonResponse({ success: true, data: channels });
      }
      return jsonResponse({ success: false });
    }) as typeof fetch;
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('keeps the player when the active channel is selected again', async () => {
    const cleanupPlayer = jest.fn();
    const { result } = renderHook(() =>
      useLiveSources({
        cleanupPlayer,
        channelListRef: { current: null },
        groupContainerRef: { current: null },
      }),
    );

    await waitFor(() => expect(result.current.currentChannel?.id).toBe('ch1'));

    await act(async () => {
      await result.current.handleChannelChange(result.current.currentChannel!);
    });
    expect(cleanupPlayer).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleChannelChange(channels[1]);
    });
    expect(cleanupPlayer).toHaveBeenCalledTimes(1);
    expect(result.current.currentChannel?.id).toBe('ch2');
    expect(result.current.videoUrl).toBe(channels[1].url);
  });
});
