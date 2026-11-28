import { act, renderHook } from '@testing-library/react';
import type Artplayer from 'artplayer';
import type { MutableRefObject } from 'react';

import { useEpisodeSwitch } from '@/features/play/hooks/useEpisodeSwitch';
import type { EpisodeProgressEntry } from '@/lib/episode-progress';
import type { SearchResult } from '@/lib/types';

function ref<T>(current: T): MutableRefObject<T> {
  return { current };
}

const detail = {
  source: 'a',
  id: '1',
  episodes: ['e1', 'e2', 'e3', 'e4'],
  episodes_titles: ['第1集', '第2集', '第3集', '第4集'],
} as SearchResult;

function setup(table: Record<number, EpisodeProgressEntry>, episodeIndex = 3) {
  const refs = {
    artPlayerRef: ref({ currentTime: 303 } as Artplayer),
    detailRef: ref<SearchResult | null>(detail),
    currentEpisodeIndexRef: ref(episodeIndex),
    resumeTimeRef: ref<number | null>(null),
    resumeModeRef: ref<'history' | 'forced' | null>(null),
    stableCurrentTimeRef: ref(303),
    clearTargetEpisodeProgressRef: ref(false),
    sourceSwitchEpisodeAnchorRef: ref(null),
    playbackRequestModeRef: ref<'initial' | 'episode'>('initial'),
    skipConfigRef: ref({ enable: false, intro_time: 0, outro_time: 0 }),
  };
  const save = jest.fn();
  const { result } = renderHook(() =>
    useEpisodeSwitch({
      ...refs,
      doSaveCurrentProgress: save,
      getEpisodeEntry: (index) => table[index],
      setError: jest.fn(),
      setIsVideoLoading: jest.fn(),
      setVideoLoadingStage: jest.fn(),
      setVideoLoadingAttempt: jest.fn(),
      setRealtimeLoadSpeed: jest.fn(),
      setCurrentEpisodeIndex: jest.fn(),
    } as Parameters<typeof useEpisodeSwitch>[0]),
  );
  return { refs, save, switchEpisode: result.current.switchEpisode };
}

describe('useEpisodeSwitch 每集续播', () => {
  it('切到看到一半的集从该集上次位置续播，先保存离开的集', () => {
    const { refs, save, switchEpisode } = setup({
      2: { k: 'n:3', t: 125, d: 1400, at: 1 },
    });
    act(() => switchEpisode(2));
    expect(save).toHaveBeenCalledTimes(1);
    expect(refs.resumeTimeRef.current).toBe(125);
    expect(refs.resumeModeRef.current).toBe('forced');
    expect(refs.playbackRequestModeRef.current).toBe('episode');
  });

  it('播到结尾的集与没有记录的集从头播', () => {
    const finished = setup({ 2: { k: 'n:3', t: 1397, d: 1400, at: 1 } });
    act(() => finished.switchEpisode(2));
    expect(finished.refs.resumeTimeRef.current).toBe(0);
    expect(finished.refs.resumeModeRef.current).toBeNull();

    const empty = setup({});
    act(() => empty.switchEpisode(1));
    expect(empty.refs.resumeTimeRef.current).toBe(0);
  });

  it('只有切到紧接的下一集才按离开下一集保存', () => {
    const next = setup({}, 1);
    act(() => next.switchEpisode(2));
    expect(next.save).toHaveBeenCalledWith(true, true);

    const skip = setup({}, 1);
    act(() => skip.switchEpisode(3));
    expect(skip.save).toHaveBeenCalledWith(true, false);

    const previous = setup({}, 1);
    act(() => previous.switchEpisode(0));
    expect(previous.save).toHaveBeenCalledWith(true, false);
  });
});
