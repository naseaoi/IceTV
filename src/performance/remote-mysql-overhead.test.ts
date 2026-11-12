/** @jest-environment node */

import type { Pool } from 'mysql2/promise';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';

import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

jest.unmock('@/lib/upstream-resource-guard.server');
jest.mock('@/lib/shared-server-cache', () => {
  const actual = jest.requireActual('@/lib/shared-server-cache');
  return {
    ...actual,
    // 两版本均固定详情热态，避免较慢基线跨过开发环境的 10 秒 TTL。
    createSharedServerCache: (options: { name: string }) =>
      actual.createSharedServerCache(
        options.name === 'detail' ? { ...options, freshMs: 600_000 } : options,
      ),
  };
});
jest.mock('@/lib/upstream-fetch.server', () => ({
  fetchUpstream: (url: string, init?: RequestInit) => mockUpstream(url, init),
  fetchPrivateUpstream: (url: string, init?: RequestInit) =>
    mockUpstream(url, init),
}));

async function mockUpstream(url: string, init?: RequestInit) {
  const { withUpstreamResponse } =
    require('@/lib/upstream-resource-guard.server') as typeof import('@/lib/upstream-resource-guard.server');
  return withUpstreamResponse(
    url,
    async () => {
      mockOriginCalls += 1;
      return Response.json({
        list: [
          {
            vod_id: '1',
            vod_name: '测量视频',
            vod_pic: '',
            vod_year: '2026',
            vod_play_url: '第一集$https://media.example/1.m3u8',
          },
        ],
      });
    },
    { signal: init?.signal },
  );
}
let mockOriginCalls = 0;

interface CounterSnapshot {
  total: number;
  commands: Record<string, number>;
  sql: Record<string, number>;
  errors: Record<string, number>;
}
interface Sample {
  elapsedMs: number;
  admissionMs?: number;
  failure?: string;
}
interface Report {
  scenario: string;
  failures: number;
  warmupFailures: number;
  requests: number;
  commandsPerRequest: number;
  p50Ms: number;
  p95Ms: number;
  admissionP50Ms?: number;
  admissionP95Ms?: number;
  counter: CounterSnapshot;
  samples: Sample[];
}

function counter(action: 'reset' | 'snapshot'): Promise<CounterSnapshot> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${process.env.REMOTE_MYSQL_CONTROL_URL}/${action}`,
      {
        method: 'POST',
        headers: { authorization: process.env.REMOTE_MYSQL_CONTROL_TOKEN! },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode !== 200) return reject(new Error(text));
          try {
            resolve(JSON.parse(text) as CounterSnapshot);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(15_000, () =>
      request.destroy(new Error('测量控制接口超时')),
    );
    request.end();
  });
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

const runSuite =
  process.env.RUN_REMOTE_MYSQL_OVERHEAD_CHECK === '1'
    ? describe
    : describe.skip;
runSuite('远程 MySQL 每请求开销', () => {
  jest.setTimeout(600_000);
  const pools: Pool[] = [];
  const reports: Report[] = [];
  const rounds = Number(process.env.REMOTE_MYSQL_SAMPLES ?? 20);
  let restorePool: () => void;
  const originalFetch = global.fetch;

  beforeAll(() => {
    expect(process.env.MYSQL_TEST_URL).toMatch(/^mysql:\/\/.*@127\.0\.0\.1:/);
    expect(process.env.REMOTE_MYSQL_CONTROL_TOKEN).toBeTruthy();
    process.env.DATABASE_URL = process.env.MYSQL_TEST_URL;
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'mysql';
    installStreamPolyfills();
    installCryptoPolyfill();
    global.fetch = jest.fn(async () => {
      throw new Error('测量期间禁止外部网络');
    });
    // 只收集连接池以正常关闭；查询、事务与应用存储选择保持真实实现。
    const mysql = require('mysql2/promise') as typeof import('mysql2/promise');
    const createPool = mysql.createPool;
    const spy = jest
      .spyOn(mysql, 'createPool')
      .mockImplementation((options) => {
        const pool = createPool(options);
        pools.push(pool);
        return pool;
      });
    restorePool = () => spy.mockRestore();
  });

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
    restorePool?.();
    global.fetch = originalFetch;
  });

  async function measure(
    scenario: string,
    concurrency: number,
    call: (user: number) => Promise<Sample>,
  ) {
    // 预热与正式请求使用相同并发，使池连接与每连接 prepare 缓存进入可比较状态。
    const warmup = await Promise.all(
      Array.from({ length: concurrency }, (_, user) => call(user)),
    );
    await counter('reset');
    const samples: Sample[] = [];
    for (let round = 0; round < rounds; round += 1) {
      samples.push(
        ...(await Promise.all(
          Array.from({ length: concurrency }, (_, user) => call(user)),
        )),
      );
    }
    const counts = await counter('snapshot');
    expect(counts.total).toBeGreaterThan(0);
    const successes = samples.filter((sample) => !sample.failure);
    expect(successes.length).toBeGreaterThan(0);
    const admissions = successes.flatMap((sample) =>
      sample.admissionMs === undefined ? [] : [sample.admissionMs],
    );
    reports.push({
      scenario,
      failures: samples.length - successes.length,
      warmupFailures: warmup.filter((sample) => sample.failure).length,
      requests: samples.length,
      commandsPerRequest: counts.total / samples.length,
      p50Ms: percentile(
        successes.map((sample) => sample.elapsedMs),
        0.5,
      ),
      p95Ms: percentile(
        successes.map((sample) => sample.elapsedMs),
        0.95,
      ),
      ...(admissions.length
        ? {
            admissionP50Ms: percentile(admissions, 0.5),
            admissionP95Ms: percentile(admissions, 0.95),
          }
        : {}),
      counter: counts,
      samples,
    });
  }

  it('测量分片准入、普通/测速鉴权、冷缓存和 50 键播放记录', async () => {
    const { NextRequest } =
      require('next/server') as typeof import('next/server');
    const { db } = require('@/lib/db') as typeof import('@/lib/db');
    const { getConfig, saveConfig, invalidateConfigCache, getConfigForRead } =
      require('@/lib/config') as typeof import('@/lib/config');
    const { generateSignature, getSignatureData } =
      require('@/lib/auth.server') as typeof import('@/lib/auth.server');
    const { SOURCE_PROBE_HEADER } =
      require('@/features/play/lib/sourceProbeRequestPolicy') as typeof import('@/features/play/lib/sourceProbeRequestPolicy');
    const { GET: detail } =
      require('@/app/api/detail/route') as typeof import('@/app/api/detail/route');
    const { GET: playrecords } =
      require('@/app/api/playrecords/route') as typeof import('@/app/api/playrecords/route');
    const { withUpstreamResponse } =
      require('@/lib/upstream-resource-guard.server') as typeof import('@/lib/upstream-resource-guard.server');
    const { createSharedServerCache } =
      require('@/lib/shared-server-cache') as typeof import('@/lib/shared-server-cache');

    invalidateConfigCache();
    const config = await getConfig();
    config.SourceConfig = [
      {
        key: 'measured',
        name: '测量源',
        api: 'https://metadata.example/api.php',
        from: 'custom',
      },
      {
        key: 'denied',
        name: '未授权源',
        api: 'https://denied.example/api.php',
        from: 'custom',
      },
    ];
    config.UserConfig.Tags = [
      { name: 'measured-group', enabledApis: ['measured'] },
    ];
    await saveConfig(config);
    await db.registerUser('measured-user', 'test-password', undefined, [
      'measured-group',
    ]);
    await getConfigForRead();
    const expiresAt = Date.now() + 3600_000;
    const signature = await generateSignature(
      getSignatureData('account', expiresAt, 'measured-user'),
      process.env.AUTH_SECRET!,
    );
    const cookie = `auth=${encodeURIComponent(JSON.stringify({ username: 'measured-user', sessionType: 'account', expiresAt, signature }))}`;
    function request(url: string, probe = false) {
      return new NextRequest(`http://localhost${url}`, {
        headers: { cookie, ...(probe ? { [SOURCE_PROBE_HEADER]: '1' } : {}) },
      });
    }
    expect(
      (await detail(request('/api/detail?source=denied&id=1'))).status,
    ).toBe(400);

    const keys = Array.from({ length: 50 }, (_, i) => `measured+${i}`);
    for (let i = 0; i < keys.length; i += 1) {
      await db.savePlayRecord('measured-user', 'measured', String(i), {
        title: `视频 ${i}`,
        source_name: '测量源',
        year: '2026',
        cover: '',
        index: 1,
        total_episodes: 12,
        play_time: 10,
        total_time: 100,
        save_time: Date.now(),
      });
    }

    const segment = async (user: number): Promise<Sample> => {
      const start = performance.now();
      let admissionMs = 0;
      let response: Response;
      try {
        response = await withUpstreamResponse(
          'https://media.example/segment.ts',
          async () => {
            admissionMs = performance.now() - start;
            return new Response(new Uint8Array(32));
          },
          { kind: 'vod', identity: `user:segment-${user}` },
        );
        expect((await response.arrayBuffer()).byteLength).toBe(32);
      } catch (error) {
        // 基线并发拒绝单列失败率，完整等待同批请求结束，避免污染后续场景。
        if ((error as { name?: string }).name !== 'ResourceLimitError')
          throw error;
        return { elapsedMs: performance.now() - start, failure: String(error) };
      }
      return { elapsedMs: performance.now() - start, admissionMs };
    };
    await measure('VOD 分片（单发）', 1, segment);
    await measure('VOD 分片（10 并发）', 10, segment);

    // 详情保持本地热缓存，隔离 Guard 与源权限读取；冷共享缓存另设场景。
    for (const probe of [false, true]) {
      await measure(
        probe ? 'detail 测速（热详情）' : 'detail 鉴权与源过滤（热详情）',
        1,
        async () => {
          const start = performance.now();
          const response = await detail(
            request('/api/detail?source=measured&id=1', probe),
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            id: '1',
            source: 'measured',
          });
          return { elapsedMs: performance.now() - start };
        },
      );
    }
    expect(mockOriginCalls).toBeGreaterThan(0);

    const query = new URLSearchParams();
    for (const key of keys) query.append('keys', key);
    await measure('播放记录（50 键）', 1, async () => {
      const start = performance.now();
      const response = await playrecords(request(`/api/playrecords?${query}`));
      expect(response.status).toBe(200);
      expect(Object.keys(await response.json()).sort()).toEqual(
        [...keys].sort(),
      );
      return { elapsedMs: performance.now() - start };
    });

    const cache = createSharedServerCache<{ value: string }>({
      name: 'overhead-cold',
      enabled: true,
      freshMs: 600_000,
      staleMs: 0,
    });
    let cacheKey = 0;
    await measure('共享缓存冷键首请求（维护已预热）', 1, async () => {
      const start = performance.now();
      const loader = jest.fn(async () => ({ value: 'small' }));
      expect(await cache.getOrLoad(`cold-${cacheKey++}`, loader)).toEqual({
        value: 'small',
      });
      expect(loader).toHaveBeenCalledTimes(1);
      return { elapsedMs: performance.now() - start };
    });

    const report = {
      node: process.version,
      rttMs: Number(process.env.REMOTE_MYSQL_RTT_MS),
      rounds,
      poolSize: 10,
      scope:
        '附加 RTT；命令含 PREPARE/事务/释放，按全部尝试均摊；p50/p95 仅成功样本，失败另列；延迟含正文消费，分片另列 loader 前准入；冷键场景复用已初始化进程。',
      reports,
    };
    mkdirSync('tmp', { recursive: true });
    writeFileSync(
      'tmp/remote-mysql-overhead-report.json',
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const rows = reports.flatMap((row) => {
      const common = `${row.commandsPerRequest.toFixed(2)}`;
      const status = `失败 ${row.failures}/${row.requests}；预热失败 ${row.warmupFailures}`;
      const result = [
        `| ${row.scenario}（${status}） | ${common} | ${row.p50Ms.toFixed(1)} | ${row.p95Ms.toFixed(1)} |`,
      ];
      if (row.admissionP50Ms !== undefined)
        result.push(
          `| ${row.scenario}：准入 | ${common}（整请求） | ${row.admissionP50Ms.toFixed(1)} | ${row.admissionP95Ms!.toFixed(1)} |`,
        );
      return result;
    });
    console.log(
      `\n附加 RTT=${report.rttMs}ms；延迟单位 ms\n| 场景 | 数据库命令/请求 | p50 | p95 |\n| --- | ---: | ---: | ---: |\n${rows.join('\n')}`,
    );
  });
});
