const mockPurgeUserNotices = jest.fn();
const mockPurgeSourceRouteStatsBefore = jest.fn();
const mockPurgeSourceProxyFailuresBefore = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    purgeSourceProxyFailuresBefore: (...args: unknown[]) =>
      mockPurgeSourceProxyFailuresBefore(...args),
    purgeUserNotices: (...args: unknown[]) => mockPurgeUserNotices(...args),
    purgeSourceRouteStatsBefore: (...args: unknown[]) =>
      mockPurgeSourceRouteStatsBefore(...args),
  },
}));

const mockRefreshSubscribedConfig = jest.fn();
const mockRefreshConfiguredLiveChannels = jest.fn();
const mockRefreshRecordAndFavorites = jest.fn();
const mockCleanupPlaybackSessions = jest.fn();
const mockCleanupSourceHealth = jest.fn();
const mockCleanupInviteCodes = jest.fn();
const mockProbeConfiguredSources = jest.fn();
const mockProbeConfiguredLiveLines = jest.fn();
jest.mock('./live-health', () => ({
  probeConfiguredLiveLines: (...args: unknown[]) =>
    mockProbeConfiguredLiveLines(...args),
}));

jest.mock('./source-health', () => ({
  probeConfiguredSources: (...args: unknown[]) =>
    mockProbeConfiguredSources(...args),
}));

jest.mock('@/lib/source-health.server', () => ({
  cleanupSourceHealth: (...args: unknown[]) => mockCleanupSourceHealth(...args),
}));

jest.mock('./config-refresh', () => ({
  refreshSubscribedConfig: (...args: unknown[]) =>
    mockRefreshSubscribedConfig(...args),
}));
jest.mock('./live-refresh', () => ({
  refreshConfiguredLiveChannels: (...args: unknown[]) =>
    mockRefreshConfiguredLiveChannels(...args),
}));
jest.mock('./metadata-refresh', () => ({
  refreshRecordAndFavorites: (...args: unknown[]) =>
    mockRefreshRecordAndFavorites(...args),
}));
jest.mock('./invite-code-retention', () => ({
  cleanupInviteCodes: (...args: unknown[]) => mockCleanupInviteCodes(...args),
}));
jest.mock('./playback-retention', () => ({
  cleanupPlaybackSessions: (...args: unknown[]) =>
    mockCleanupPlaybackSessions(...args),
}));

const { executeCronTask } = require('./tasks') as typeof import('./tasks');

describe('cron task dispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-11-08T00:30:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('按任务只执行对应的刷新', async () => {
    await executeCronTask('config');
    expect(mockRefreshSubscribedConfig).toHaveBeenCalledTimes(1);
    expect(mockRefreshConfiguredLiveChannels).not.toHaveBeenCalled();
    expect(mockRefreshRecordAndFavorites).not.toHaveBeenCalled();
    expect(mockCleanupPlaybackSessions).not.toHaveBeenCalled();
    expect(mockCleanupSourceHealth).not.toHaveBeenCalled();
    expect(mockPurgeSourceRouteStatsBefore).not.toHaveBeenCalled();
    expect(mockProbeConfiguredSources).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await executeCronTask('live');
    expect(mockRefreshSubscribedConfig).not.toHaveBeenCalled();
    expect(mockRefreshConfiguredLiveChannels).toHaveBeenCalledTimes(1);
    expect(mockProbeConfiguredLiveLines).toHaveBeenCalledTimes(1);
    expect(mockRefreshRecordAndFavorites).not.toHaveBeenCalled();
    expect(mockCleanupPlaybackSessions).not.toHaveBeenCalled();
    expect(mockCleanupSourceHealth).not.toHaveBeenCalled();
    expect(mockPurgeSourceRouteStatsBefore).not.toHaveBeenCalled();
    expect(mockProbeConfiguredSources).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await executeCronTask('metadata');
    expect(mockRefreshSubscribedConfig).not.toHaveBeenCalled();
    expect(mockRefreshConfiguredLiveChannels).not.toHaveBeenCalled();
    expect(mockRefreshRecordAndFavorites).toHaveBeenCalledTimes(1);
    expect(mockCleanupPlaybackSessions).toHaveBeenCalledTimes(1);
    expect(mockCleanupInviteCodes).toHaveBeenCalledTimes(1);
    expect(mockCleanupSourceHealth).toHaveBeenCalledTimes(1);
    expect(mockPurgeUserNotices).toHaveBeenCalledWith(
      Date.now() - 30 * 86400000,
    );
    expect(mockPurgeSourceRouteStatsBefore).toHaveBeenCalledWith('2026-10-02');
    expect(mockPurgeSourceProxyFailuresBefore).toHaveBeenCalledWith(
      '2026-10-02',
    );
    expect(mockProbeConfiguredSources).toHaveBeenCalledTimes(1);
  });

  it('live-health only probes live lines', async () => {
    await executeCronTask('live-health');
    expect(mockProbeConfiguredLiveLines).toHaveBeenCalledTimes(1);
    expect(mockRefreshConfiguredLiveChannels).not.toHaveBeenCalled();
    expect(mockProbeConfiguredSources).not.toHaveBeenCalled();
  });

  it('source-health only probes sources', async () => {
    await executeCronTask('source-health');
    expect(mockProbeConfiguredSources).toHaveBeenCalledTimes(1);
    expect(mockRefreshSubscribedConfig).not.toHaveBeenCalled();
    expect(mockRefreshConfiguredLiveChannels).not.toHaveBeenCalled();
    expect(mockRefreshRecordAndFavorites).not.toHaveBeenCalled();
    expect(mockCleanupPlaybackSessions).not.toHaveBeenCalled();
    expect(mockCleanupSourceHealth).not.toHaveBeenCalled();
    expect(mockPurgeSourceRouteStatsBefore).not.toHaveBeenCalled();
  });

  it('all 任务按顺序执行全部维护步骤', async () => {
    const calls: string[] = [];
    mockRefreshSubscribedConfig.mockImplementation(() => {
      calls.push('config');
    });
    mockRefreshConfiguredLiveChannels.mockImplementation(() => {
      calls.push('live');
    });
    mockProbeConfiguredLiveLines.mockImplementation(() => {
      calls.push('live-health');
    });
    mockRefreshRecordAndFavorites.mockImplementation(() => {
      calls.push('metadata');
    });
    mockCleanupPlaybackSessions.mockImplementation(() => {
      calls.push('retention');
    });
    mockCleanupInviteCodes.mockImplementation(() => {
      calls.push('invites');
    });

    mockCleanupSourceHealth.mockImplementation(() => {
      calls.push('health');
    });

    mockPurgeSourceRouteStatsBefore.mockImplementation(() => {
      calls.push('routes');
    });

    mockProbeConfiguredSources.mockImplementation(() => {
      calls.push('probe');
    });

    await executeCronTask('all');

    expect(calls).toEqual([
      'config',
      'live',
      'live-health',
      'metadata',
      'retention',
      'invites',
      'health',
      'routes',
      'probe',
    ]);
  });
});
