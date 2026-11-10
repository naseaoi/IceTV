/** @jest-environment node */

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { refreshRecordAndFavorites } from '@/lib/cron/metadata-refresh';
import { db } from '@/lib/db';
import {
  getUserMessagePage,
  getUserMessageSummary,
  readAllUserMessages,
  readUserMessage,
} from '@/lib/messages.server';
import {
  getPlayRecordEpisodeDisplay,
  mergePlayRecordUpdateBaseline,
} from '@/lib/play-records';

import {
  createGiriTrackingHtml,
  giriTrackingRecord,
} from './__fixtures__/giri-tracking';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {},
  getAvailableApiSites: jest
    .fn()
    .mockResolvedValue([
      { key: 'giri', name: 'Giri资源', api: 'https://anime.girigirilove.icu' },
    ]),
  getConfigForRead: jest.fn().mockResolvedValue({
    SiteConfig: { Announcement: '' },
  }),
}));

jest.mock('@/lib/storage-type', () => ({ getStorageType: () => 'localdb' }));
jest.mock('@/lib/env.server', () => ({
  getOwnerUsername: () => 'giri-tracking-test',
  getOwnerPassword: () => '',
}));

installCryptoPolyfill();
installStreamPolyfills();

const username = 'giri-tracking-test';
const originalFetch = global.fetch;
let upstreamHtml: string;

describe('Giri tracking from upstream metadata to stored messages', () => {
  beforeEach(async () => {
    upstreamHtml = createGiriTrackingHtml(9, 9);
    global.fetch = jest.fn(async () => new Response(upstreamHtml));
    await db.savePlayRecord(username, 'giri', '27100', giriTrackingRecord);
  });

  afterEach(async () => {
    await db.deleteFavorite(username, 'giri', '27100');
    await db.deletePlayRecord(username, 'giri', '27100');
    global.fetch = originalFetch;
  });

  it('收藏在已有回源结果上生成更新，已读、静音与播放接管保持一致', async () => {
    await db.deletePlayRecord(username, 'giri', '27100');
    await db.saveFavorite(username, 'giri', '27100', {
      title: giriTrackingRecord.title,
      source_name: 'Giri资源',
      cover: '',
      year: '2026',
      total_episodes: 16,
      save_time: 1,
      origin: 'vod',
      metadata_checked_at: 0,
    });
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);
    await refreshRecordAndFavorites();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const summary = await getUserMessageSummary(username);
    expect(summary).toMatchObject({
      trackingUnreadCount: 1,
      latestUnreadAt: expect.any(Number),
      latestUnread: { type: 'tracking-update', toEpisodes: 18 },
    });
    expect(summary.latestTracking).toMatchObject({
      fromEpisodes: 16,
      toEpisodes: 18,
    });
    expect(summary.latestTracking!.id).toMatch(/^favorite-tracking:/);
    expect((await getUserMessagePage(username, 20)).items).toContainEqual(
      summary.latestTracking,
    );
    await readUserMessage(username, summary.latestTracking!.id);
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);
    const read = await db.getFavorite(username, 'giri', '27100');
    await db.saveFavorite(username, 'giri', '27100', {
      ...read!,
      metadata_checked_at: 0,
    });
    upstreamHtml = createGiriTrackingHtml(10, 10);
    await refreshRecordAndFavorites();
    expect(
      (await getUserMessageSummary(username)).latestTracking,
    ).toMatchObject({ fromEpisodes: 18, toEpisodes: 20 });
    await db.updateUserMessageState(username, {
      notificationSettings: {
        mutedKinds: ['tracking-update'],
        now: Date.now(),
      },
    });
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);
    await db.updateUserMessageState(username, {
      notificationSettings: { mutedKinds: [], now: Date.now() },
    });
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(1);
    await readAllUserMessages(username);
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);
    const acknowledged = await db.getFavorite(username, 'giri', '27100');
    await db.saveFavorite(username, 'giri', '27100', {
      ...acknowledged!,
      metadata_checked_at: 0,
    });
    upstreamHtml = createGiriTrackingHtml(11, 11);
    await refreshRecordAndFavorites();
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(1);
    await db.savePlayRecord(username, 'giri', '27100', {
      ...giriTrackingRecord,
      tracking_enabled: false,
    });
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);
  });

  it.each(['简中 8', '简中8', '简中'])(
    '旧记录 %s 从 8/8 更新到 8/9 后可查询、已读并再次提醒',
    async (label) => {
      await db.savePlayRecord(username, 'giri', '27100', {
        ...giriTrackingRecord,
        group_label: label,
        update_baseline_group_total: undefined,
      });
      expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(
        0,
      );

      await refreshRecordAndFavorites();

      const updated = await db.getPlayRecord(username, 'giri', '27100');
      expect(updated).toMatchObject({
        index: 17,
        group_label: '简中',
        group_index: 8,
        group_total: 9,
        update_baseline_group_total: 8,
        update_detected_at: expect.any(Number),
      });
      expect(getPlayRecordEpisodeDisplay(updated!)).toEqual({
        currentEpisode: 8,
        totalEpisodes: 9,
      });
      const summary = await getUserMessageSummary(username);
      expect(summary.trackingUnreadCount).toBe(1);
      expect(summary.latestTracking).toMatchObject({
        title: '碧蓝之海 第三季',
        sourceName: 'Giri资源',
        fromEpisodes: 8,
        toEpisodes: 9,
      });
      const page = await getUserMessagePage(username, 20);
      expect(page.total).toBe(1);
      expect(page.items).toEqual([summary.latestTracking]);

      await db.savePlayRecord(username, 'giri', '27100', {
        ...updated!,
        metadata_checked_at: 0,
      });
      await refreshRecordAndFavorites();
      expect((await getUserMessageSummary(username)).revision).toBe(
        summary.revision,
      );

      await readUserMessage(username, summary.latestTracking!.id);
      expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(
        0,
      );
      const read = await db.getPlayRecord(username, 'giri', '27100');
      await db.savePlayRecord(username, 'giri', '27100', {
        ...read!,
        metadata_checked_at: 0,
      });
      upstreamHtml = createGiriTrackingHtml(10, 10);
      await refreshRecordAndFavorites();
      expect(
        (await getUserMessageSummary(username)).latestTracking,
      ).toMatchObject({
        fromEpisodes: 9,
        toEpisodes: 10,
      });
    },
  );

  it('仅简中更新时从 8/8 变为 8/9 并提醒', async () => {
    upstreamHtml = createGiriTrackingHtml(8, 9);
    await refreshRecordAndFavorites();
    expect(await db.getPlayRecord(username, 'giri', '27100')).toMatchObject({
      index: 16,
      group_index: 8,
      group_total: 9,
      update_baseline_group_total: 8,
    });
    expect(
      (await getUserMessageSummary(username)).latestTracking,
    ).toMatchObject({
      fromEpisodes: 8,
      toEpisodes: 9,
    });
  });

  it('真正切换到繁中时重建基线，不把换组当作新集数', async () => {
    const switched = mergePlayRecordUpdateBaseline(giriTrackingRecord, {
      ...giriTrackingRecord,
      index: 1,
      total_episodes: 18,
      group_label: '繁中',
      group_index: 1,
      group_total: 9,
    });
    await db.savePlayRecord(username, 'giri', '27100', switched);
    await refreshRecordAndFavorites();
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);
  });

  it('其他分组更新时不提醒，所看分组更新后才提醒', async () => {
    upstreamHtml = createGiriTrackingHtml(9, 8);
    await refreshRecordAndFavorites();
    const unchanged = await db.getPlayRecord(username, 'giri', '27100');
    expect(getPlayRecordEpisodeDisplay(unchanged!)).toEqual({
      currentEpisode: 8,
      totalEpisodes: 8,
    });
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);

    await db.savePlayRecord(username, 'giri', '27100', {
      ...unchanged!,
      metadata_checked_at: 0,
    });
    upstreamHtml = createGiriTrackingHtml(9, 9);
    await refreshRecordAndFavorites();
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(1);
  });

  it('取消追更后仍刷新集数但不生成提醒', async () => {
    await db.savePlayRecord(username, 'giri', '27100', {
      ...giriTrackingRecord,
      tracking_enabled: false,
    });
    await refreshRecordAndFavorites();
    expect(await db.getPlayRecord(username, 'giri', '27100')).toMatchObject({
      group_index: 8,
      group_total: 9,
      tracking_enabled: false,
    });
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);
  });

  it('播放最新集后清除提醒，重复刷新不会重新变成未读', async () => {
    await refreshRecordAndFavorites();
    const updated = await db.getPlayRecord(username, 'giri', '27100');
    const watched = mergePlayRecordUpdateBaseline(updated, {
      ...updated!,
      index: 18,
      group_index: 9,
      metadata_checked_at: 0,
    });
    await db.savePlayRecord(username, 'giri', '27100', watched);
    await refreshRecordAndFavorites();
    expect((await getUserMessageSummary(username)).trackingUnreadCount).toBe(0);
  });
});
