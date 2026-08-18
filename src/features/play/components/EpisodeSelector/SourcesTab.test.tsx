import {
  getCompletedProbeInfo,
  isActivelyProbing,
  sortSourcesForDisplay,
  VIDEO_INFO_BATCH_SIZE,
} from '@/features/play/components/EpisodeSelector/SourcesTab';
import type {
  ProbeEntry,
  VideoInfo,
} from '@/features/play/lib/sourceProbeStore';
import type { SearchResult } from '@/lib/types';

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
