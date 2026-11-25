import type { UserMessageSummary } from '@/lib/message-types';

import { createMessageSummaryPoller } from './message-summary-poller';

class TestChannel {
  static channels = new Set<TestChannel>();
  onmessage?: (event: { data: unknown }) => void;
  constructor(readonly name: string) {
    TestChannel.channels.add(this);
  }
  postMessage(data: unknown) {
    for (const channel of TestChannel.channels) {
      if (channel !== this && channel.name === this.name) {
        void Promise.resolve().then(() => {
          if (TestChannel.channels.has(channel)) channel.onmessage?.({ data });
        });
      }
    }
  }
  close() {
    TestChannel.channels.delete(this);
  }
}

function createLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request(
      name: string,
      optionsOrRun: { signal: AbortSignal } | (() => Promise<void>),
      callback?: () => Promise<void>,
    ) {
      const signal =
        typeof optionsOrRun === 'function' ? undefined : optionsOrRun.signal;
      const run = typeof optionsOrRun === 'function' ? optionsOrRun : callback!;
      const task = (tails.get(name) ?? Promise.resolve())
        .catch(() => {})
        .then(() => {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          return run();
        });
      tails.set(name, task);
      return task;
    },
  };
}

const originalChannel = global.BroadcastChannel;
const originalLocks = navigator.locks;
const pollers: ReturnType<typeof createMessageSummaryPoller>[] = [];
function summary(revision: string) {
  return { revision } as UserMessageSummary;
}
function start(
  username = 'alice',
  load = jest.fn().mockResolvedValue(summary('first')),
  isCurrentAccount = () => true,
) {
  const onSummary = jest.fn();
  const poller = createMessageSummaryPoller({
    username,
    load,
    onSummary,
    isCurrentAccount,
  });
  pollers.push(poller);
  return { ...poller, load, onSummary };
}
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(global, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: TestChannel,
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: createLocks(),
  });
  jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(async () => {
  pollers.splice(0).forEach((poller) => poller.stop());
  await flush();
  TestChannel.channels.clear();
  Object.defineProperty(global, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: originalChannel,
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: originalLocks,
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('两个可见标签页只有一个每分钟轮询并同步摘要，关主标签后接任', async () => {
  const first = start();
  const second = start();
  await flush();
  expect(first.load).toHaveBeenCalledTimes(1);
  expect(second.load).not.toHaveBeenCalled();
  expect(second.onSummary).toHaveBeenCalledWith(summary('first'), 'external');
  jest.advanceTimersByTime(60_000);
  await flush();
  expect(first.load).toHaveBeenCalledTimes(2);
  expect(second.load).not.toHaveBeenCalled();
  first.stop();
  await flush();
  jest.advanceTimersByTime(60_000);
  await flush();
  expect(second.load).toHaveBeenCalledTimes(1);
});

it('从标签已读立即查新摘要并广播，查询期间的写操作刷新排在旧响应之后', async () => {
  const first = start();
  const second = start();
  await flush();
  let resolve!: (value: UserMessageSummary) => void;
  first.load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  jest.advanceTimersByTime(60_000);
  await flush();
  second.load.mockResolvedValue(summary('read'));
  const mutation = second.refresh('local');
  await flush();
  expect(second.load).not.toHaveBeenCalled();
  resolve(summary('before-read'));
  await mutation;
  await flush();
  expect(second.onSummary).toHaveBeenLastCalledWith(summary('read'), 'local');
  expect(first.onSummary).toHaveBeenLastCalledWith(summary('read'), 'external');
});

it('隐藏全部页面暂停，恢复可见时补拉；连续 focus 合并', async () => {
  const visible = jest.spyOn(document, 'visibilityState', 'get');
  const first = start();
  await flush();
  visible.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  jest.advanceTimersByTime(120_000);
  await flush();
  expect(first.load).toHaveBeenCalledTimes(1);
  visible.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  await flush();
  expect(first.load).toHaveBeenCalledTimes(2);
});

it('不同账号独立选主，身份失效后不采纳在途响应', async () => {
  let active = true;
  let resolve!: (value: UserMessageSummary) => void;
  const first = start(
    'alice',
    jest.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
    () => active,
  );
  const second = start('bob');
  await flush();
  active = false;
  resolve(summary('private'));
  await flush();
  expect(first.onSummary).not.toHaveBeenCalled();
  expect(second.onSummary).toHaveBeenLastCalledWith(summary('first'), 'mount');
});

it('不支持跨标签能力时各自轮询并保留隐藏页暂停', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
  const first = start();
  const second = start();
  await flush();
  jest.advanceTimersByTime(60_000);
  await flush();
  expect(first.load).toHaveBeenCalledTimes(2);
  expect(second.load).toHaveBeenCalledTimes(2);
});
