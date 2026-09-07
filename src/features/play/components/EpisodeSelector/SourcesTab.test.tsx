import { fireEvent, render, screen } from '@testing-library/react';

import {
  getCompletedProbeInfo,
  isActivelyProbing,
  sortSourcesForDisplay,
  SourcesTab,
  VIDEO_INFO_BATCH_SIZE,
} from '@/features/play/components/EpisodeSelector/SourcesTab';
import type {
  ProbeEntry,
  VideoInfo,
} from '@/features/play/lib/sourceProbeStore';
import type { SearchResult } from '@/lib/types';

let mockProbeSnapshot = new Map<string, ProbeEntry>();
const mockGetOrProbe = jest.fn();

jest.mock('@/features/play/lib/sourceProbeStore', () => ({
  ...jest.requireActual('@/features/play/lib/sourceProbeStore'),
  getSnapshot: () => mockProbeSnapshot,
  subscribe: () => () => {},
  getOrProbe: (...args: unknown[]) => mockGetOrProbe(...args),
}));

function createSource(partial: Partial<SearchResult>): SearchResult {
  return {
    id: '1',
    title: 'test',
    poster: '',
    episodes: ['ep1'],
    episodes_titles: ['1'],
    source: 'source-a',
    source_name: 'Source A',
    year: '2026',
    ...partial,
  };
}

function createEntry(
  info: VideoInfo,
  source: ProbeEntry['source'] = 'probe',
  previousInfo?: VideoInfo,
): ProbeEntry {
  return {
    info,
    source,
    previousInfo,
    ts: Date.now(),
  };
}

describe('SourcesTab source sorting', () => {
  it('换源测速一次并发 4 个源站', () => {
    expect(VIDEO_INFO_BATCH_SIZE).toBe(4);
  });

  it('pending 条目使用上一次完成结果参与排序', () => {
    const previousFailure: VideoInfo = {
      quality: '错误',
      loadSpeed: '未知',
      pingTime: 0,
      hasError: true,
    };
    const entry = createEntry(
      { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
      'pending',
      previousFailure,
    );

    expect(getCompletedProbeInfo(entry)).toBe(previousFailure);
  });

  it('只有拿到并发槽位的条目才处于检测中', () => {
    const queued = createEntry(
      { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
      'queued',
    );
    const active = createEntry(
      { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
      'pending',
    );

    expect(isActivelyProbing(queued)).toBe(false);
    expect(isActivelyProbing(active)).toBe(true);
    expect(getCompletedProbeInfo(queued)).toBeUndefined();
  });

  it('失败源重测时保持在成功源之后', () => {
    const failedSource = createSource({
      id: 'failed',
      source: 'source-failed',
      source_name: 'Failed',
    });
    const successSource = createSource({
      id: 'success',
      source: 'source-success',
      source_name: 'Success',
    });
    const failedInfo: VideoInfo = {
      quality: '错误',
      loadSpeed: '未知',
      pingTime: 0,
      hasError: true,
    };
    const successInfo: VideoInfo = {
      quality: '1080p',
      loadSpeed: '1 MB/s',
      pingTime: 40,
    };
    const snapshot = new Map<string, ProbeEntry>([
      [
        'source-failed-failed',
        createEntry(
          { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
          'pending',
          failedInfo,
        ),
      ],
      ['source-success-success', createEntry(successInfo)],
    ]);

    const sorted = sortSourcesForDisplay(
      [failedSource, successSource],
      snapshot,
    );

    expect(sorted.map((source) => source.id)).toEqual(['success', 'failed']);
  });
});

describe('SourcesTab probe status', () => {
  const source = createSource({});
  const failure: VideoInfo = {
    quality: '错误',
    loadSpeed: '未知',
    pingTime: 0,
    hasError: true,
  };

  beforeEach(() => {
    mockProbeSnapshot = new Map();
    mockGetOrProbe.mockReset().mockResolvedValue(undefined);
  });

  it('检测失败时显示红字，并保留不会触发换源的重试入口', () => {
    mockProbeSnapshot.set('source-a-1', createEntry(failure));
    const onSourceChange = jest.fn();
    render(
      <SourcesTab
        availableSources={[source]}
        sourceSearchLoading={false}
        sourceSearchError={null}
        onSourceChange={onSourceChange}
      />,
    );

    expect(screen.getByText('检测失败')).toHaveClass(
      'text-red-600',
      'dark:text-red-400',
    );
    expect(screen.getByTitle('分辨率')).toHaveTextContent('未知');
    expect(screen.queryByText('0.00s')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));
    expect(mockGetOrProbe).toHaveBeenCalledWith(
      source,
      expect.objectContaining({ force: true }),
    );
    expect(onSourceChange).not.toHaveBeenCalled();
  });

  it.each([
    [
      '检测中',
      createEntry(
        { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
        'pending',
        failure,
      ),
    ],
    [
      '1080p',
      createEntry({ quality: '1080p', loadSpeed: '1 MB/s', pingTime: 40 }),
    ],
  ])('%s 状态不显示失败标识', (status, entry) => {
    mockProbeSnapshot.set('source-a-1', entry);
    render(
      <SourcesTab
        availableSources={[source]}
        sourceSearchLoading={false}
        sourceSearchError={null}
      />,
    );

    expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.queryByText('检测失败')).not.toBeInTheDocument();
    expect(screen.queryByText('重试')).not.toBeInTheDocument();
  });

  it('尚无检测结果的源站不误标失败', () => {
    render(
      <SourcesTab
        availableSources={[source]}
        sourceSearchLoading={false}
        sourceSearchError={null}
      />,
    );

    expect(screen.queryByText('检测失败')).not.toBeInTheDocument();
    expect(screen.queryByText('重试')).not.toBeInTheDocument();
    expect(screen.getByTitle('分辨率')).toHaveTextContent('未知');
  });

  it.each(['未知', '', '  ', '错误', 'MP4'])(
    '检测结果 %s 没有分辨率时显示未知，保留速度和耗时',
    (quality) => {
      mockProbeSnapshot.set(
        'source-a-1',
        createEntry({
          quality,
          loadSpeed: '1 MB/s',
          pingTime: 1422,
        }),
      );
      render(
        <SourcesTab
          availableSources={[source]}
          sourceSearchLoading={false}
          sourceSearchError={null}
        />,
      );

      expect(screen.getByTitle('分辨率')).toHaveTextContent('未知');
      expect(screen.getByTitle('分辨率')).toHaveClass(
        'text-gray-500',
        'dark:text-gray-400',
      );
      expect(screen.getByText('1 MB/s')).toBeInTheDocument();
      expect(screen.getByText('1.42s')).toBeInTheDocument();
      expect(screen.queryByText('检测失败')).not.toBeInTheDocument();
    },
  );

  it.each([
    [40, '0.04s'],
    [160, '0.16s'],
    [2503, '2.50s'],
  ])('%i 毫秒以 %s 展示，分辨率保持不变', (pingTime, expected) => {
    mockProbeSnapshot.set(
      'source-a-1',
      createEntry({
        quality: '1080p',
        loadSpeed: '1 MB/s',
        pingTime,
      }),
    );
    render(
      <SourcesTab
        availableSources={[source]}
        sourceSearchLoading={false}
        sourceSearchError={null}
      />,
    );

    expect(screen.getByTitle('分辨率')).toHaveTextContent('1080p');
    expect(screen.getByTitle('分辨率')).toHaveClass(
      'text-green-600',
      'dark:text-green-400',
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(`${pingTime}ms`)).not.toBeInTheDocument();
    expect(mockProbeSnapshot.get('source-a-1')?.info.pingTime).toBe(pingTime);
  });

  it('检测中不把初始 0 当成已测得的耗时', () => {
    mockProbeSnapshot.set(
      'source-a-1',
      createEntry(
        { quality: '未知', loadSpeed: '测量中...', pingTime: 0 },
        'pending',
      ),
    );
    render(
      <SourcesTab
        availableSources={[source]}
        sourceSearchLoading={false}
        sourceSearchError={null}
      />,
    );

    expect(screen.getByTitle('分辨率')).toHaveTextContent('未知');
    expect(screen.getByText('检测中')).toBeInTheDocument();
    expect(screen.queryByText('0.00s')).not.toBeInTheDocument();
  });
});
