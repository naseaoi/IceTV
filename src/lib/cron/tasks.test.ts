const mockRefreshSubscribedConfig = jest.fn();
const mockRefreshConfiguredLiveChannels = jest.fn();
const mockRefreshRecordAndFavorites = jest.fn();
const mockCleanupPlaybackSessions = jest.fn();

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
jest.mock('./playback-retention', () => ({
  cleanupPlaybackSessions: (...args: unknown[]) =>
    mockCleanupPlaybackSessions(...args),
}));

const { executeCronTask } = require('./tasks') as typeof import('./tasks');

describe('cron task dispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('按任务只执行对应的刷新', async () => {
    await executeCronTask('config');
    expect(mockRefreshSubscribedConfig).toHaveBeenCalledTimes(1);
    expect(mockRefreshConfiguredLiveChannels).not.toHaveBeenCalled();
    expect(mockRefreshRecordAndFavorites).not.toHaveBeenCalled();
    expect(mockCleanupPlaybackSessions).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await executeCronTask('live');
    expect(mockRefreshSubscribedConfig).not.toHaveBeenCalled();
    expect(mockRefreshConfiguredLiveChannels).toHaveBeenCalledTimes(1);
    expect(mockRefreshRecordAndFavorites).not.toHaveBeenCalled();
    expect(mockCleanupPlaybackSessions).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await executeCronTask('metadata');
    expect(mockRefreshSubscribedConfig).not.toHaveBeenCalled();
    expect(mockRefreshConfiguredLiveChannels).not.toHaveBeenCalled();
    expect(mockRefreshRecordAndFavorites).toHaveBeenCalledTimes(1);
    expect(mockCleanupPlaybackSessions).toHaveBeenCalledTimes(1);
  });

  it('all 任务按顺序执行全部维护步骤', async () => {
    const calls: string[] = [];
    mockRefreshSubscribedConfig.mockImplementation(() => {
      calls.push('config');
    });
    mockRefreshConfiguredLiveChannels.mockImplementation(() => {
      calls.push('live');
    });
    mockRefreshRecordAndFavorites.mockImplementation(() => {
      calls.push('metadata');
    });
    mockCleanupPlaybackSessions.mockImplementation(() => {
      calls.push('retention');
    });

    await executeCronTask('all');

    expect(calls).toEqual(['config', 'live', 'metadata', 'retention']);
  });
});
