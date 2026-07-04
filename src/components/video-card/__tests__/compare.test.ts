import { areVideoCardPropsEqual } from '../compare';
import type { VideoCardProps } from '../types';

const baseProps: VideoCardProps = {
  id: 'video-1',
  source: 'source-a',
  title: 'Demo',
  poster: '/poster.jpg',
  from: 'search',
  source_names: ['Source A', 'Source B'],
  aggregateGroup: [
    {
      id: 'video-1',
      title: 'Demo',
      poster: '/poster.jpg',
      episodes: ['1'],
      episodes_titles: ['Episode 1'],
      source: 'source-a',
      source_name: 'Source A',
      year: '2026',
      douban_id: 123,
    },
  ],
};

describe('areVideoCardPropsEqual', () => {
  it('accepts equivalent props with copied arrays', () => {
    expect(
      areVideoCardPropsEqual(baseProps, {
        ...baseProps,
        source_names: [...(baseProps.source_names || [])],
        aggregateGroup: baseProps.aggregateGroup?.map((item) => ({
          ...item,
          episodes: [...item.episodes],
          episodes_titles: [...item.episodes_titles],
        })),
      }),
    ).toBe(true);
  });

  it('detects source name changes', () => {
    expect(
      areVideoCardPropsEqual(baseProps, {
        ...baseProps,
        source_names: ['Source B', 'Source A'],
      }),
    ).toBe(false);
  });

  it('detects aggregate group identity changes', () => {
    expect(
      areVideoCardPropsEqual(baseProps, {
        ...baseProps,
        aggregateGroup: [
          {
            ...baseProps.aggregateGroup![0],
            source: 'source-b',
          },
        ],
      }),
    ).toBe(false);
  });
});
