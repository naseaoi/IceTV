import { renderHook } from '@testing-library/react';

import { useSourcePlaybackStatsRecorder } from '@/features/play/hooks/useSourcePlaybackStatsRecorder';
import { readSourcePlaybackStats } from '@/lib/source-playback-stats';

type RecorderProps = Parameters<typeof useSourcePlaybackStatsRecorder>[0];

const FIRST_EPISODE: RecorderProps = {
  sourceKey: 'a',
  videoId: 'a-id',
  episodeIndex: 0,
  videoUrl: 'https://a.example/0.m3u8',
};

function setupRecorder(initialProps: RecorderProps = FIRST_EPISODE) {
  return renderHook(
    (props: RecorderProps) => useSourcePlaybackStatsRecorder(props),
    { initialProps },
  );
}

describe('useSourcePlaybackStatsRecorder', () => {
  let now = 0;

  beforeEach(() => {
    localStorage.clear();
    now = 1_000;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('同一次加载只记一次起播，重渲染和重复起播不重置起点', () => {
    const { result, rerender } = setupRecorder();

    now = 1_800;
    rerender({ ...FIRST_EPISODE });
    now = 3_500;
    result.current.recordPlaybackStarted();
    now = 9_000;
    result.current.recordPlaybackStarted();
    result.current.recordPlaybackFailed();

    expect(readSourcePlaybackStats().get('a')).toMatchObject({
      startupMs: 2_500,
      successes: 1,
      failures: 0,
    });
  });

  it('换集后重新计时并允许再记一次', () => {
    const { result, rerender } = setupRecorder();
    now = 2_000;
    result.current.recordPlaybackStarted();

    now = 10_000;
    rerender({
      ...FIRST_EPISODE,
      episodeIndex: 1,
      videoUrl: 'https://a.example/1.m3u8',
    });
    now = 10_400;
    result.current.recordPlaybackStarted();

    expect(readSourcePlaybackStats().get('a')).toMatchObject({
      startupMs: 820,
      successes: 2,
    });
  });

  it('起播前失败只记一次，之后起播不再计入', () => {
    const { result } = setupRecorder();

    result.current.recordPlaybackFailed();
    result.current.recordPlaybackFailed();
    result.current.recordPlaybackStarted();

    expect(readSourcePlaybackStats().get('a')).toMatchObject({
      startupMs: null,
      successes: 0,
      failures: 1,
    });
  });

  it('逐集解析型源解析出地址仍是同一次加载，起播耗时包含解析', () => {
    const lazyEpisode = { ...FIRST_EPISODE, videoUrl: '' };
    const { result, rerender } = setupRecorder(lazyEpisode);

    now = 4_000;
    rerender(FIRST_EPISODE);
    now = 5_000;
    result.current.recordPlaybackStarted();

    expect(readSourcePlaybackStats().get('a')).toMatchObject({
      startupMs: 4_000,
      successes: 1,
    });
  });

  it('解析期间已记失败，解析出地址后起播不再重复计入', () => {
    const lazyEpisode = { ...FIRST_EPISODE, videoUrl: '' };
    const { result, rerender } = setupRecorder(lazyEpisode);

    result.current.recordPlaybackFailed();
    rerender(FIRST_EPISODE);
    result.current.recordPlaybackStarted();

    expect(readSourcePlaybackStats().get('a')).toMatchObject({
      successes: 0,
      failures: 1,
    });
  });

  it('播放地址尚未解析出来也能记失败，未选定源时不记录', () => {
    const { result, rerender } = setupRecorder({
      sourceKey: '',
      videoId: '',
      episodeIndex: 0,
      videoUrl: '',
    });
    result.current.recordPlaybackFailed();
    expect(readSourcePlaybackStats().size).toBe(0);

    rerender({
      sourceKey: 'lazy',
      videoId: 'lazy-id',
      episodeIndex: 0,
      videoUrl: '',
    });
    result.current.recordPlaybackFailed();

    expect(readSourcePlaybackStats().get('lazy')).toMatchObject({
      successes: 0,
      failures: 1,
    });
  });
});
