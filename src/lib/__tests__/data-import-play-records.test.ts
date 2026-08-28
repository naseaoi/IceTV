/** @jest-environment node */

jest.mock('../env.server', () => ({
  getOwnerUsername: () => 'owner',
}));

import { ImportValidationError, parseImportData } from '../data-import';
import { IMPORT_ADMIN_CONFIG as adminConfig } from './__fixtures__/import-admin-config';

const baseRecord = {
  title: '示例剧集',
  source_name: '示例源',
  cover: '/cover.jpg',
  year: '2026',
  index: 8,
  total_episodes: 12,
  play_time: 120,
  total_time: 1_200,
  save_time: 1_000,
};

function createImportData(record: Record<string, unknown>) {
  return {
    timestamp: '2026-08-28T00:00:00.000Z',
    serverVersion: '0.4.10',
    data: {
      adminConfig,
      userData: {
        owner: {
          playRecords: { 'source-a+video-1': record },
          favorites: {},
          searchHistory: [],
          skipConfigs: {},
          playbackSessions: {},
        },
      },
    },
  };
}

describe('data import play records', () => {
  it('拒绝只带组内总集数的记录', async () => {
    await expect(
      parseImportData(createImportData({ ...baseRecord, group_total: 24 })),
    ).rejects.toThrow(ImportValidationError);
  });

  it('拒绝只带组内集数的记录', async () => {
    await expect(
      parseImportData(createImportData({ ...baseRecord, group_index: 4 })),
    ).rejects.toThrow('组内集数与组内总集数必须成对出现');
  });

  it('接受成对出现的分组字段', async () => {
    const parsed = await parseImportData(
      createImportData({ ...baseRecord, group_index: 4, group_total: 24 }),
    );

    expect(
      parsed.snapshot.userData.owner.playRecords['source-a+video-1'],
    ).toMatchObject({ group_index: 4, group_total: 24 });
  });

  it('接受完全不带分组字段的记录', async () => {
    const parsed = await parseImportData(createImportData(baseRecord));
    const record =
      parsed.snapshot.userData.owner.playRecords['source-a+video-1'];

    expect(record.group_index).toBeUndefined();
    expect(record.group_total).toBeUndefined();
  });
});
