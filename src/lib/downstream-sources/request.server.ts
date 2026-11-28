import 'server-only';

import { getUpstreamErrorType } from '@/lib/proxy-diagnostics';
import {
  readJsonLimited,
  readTextLimited,
  UPSTREAM_METADATA_MAX_BYTES,
} from '@/lib/proxy-response-limits';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { fetchUpstream } from '@/lib/upstream-fetch.server';

import { createTimedAbortController } from './shared';

export interface SourceRequestOptions extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal;
  timeoutMs?: number;
}

class SourceStatusError extends Error {}

/**
 * 特殊源统一回源：超时默认 10 秒，正文限字节读取。失败抛出
 * `${label}请求失败 (状态码或底层错误类型)` 或 `${label}请求超时`，不含关键词与完整地址；
 * 父级取消与 ResourceLimitError 原样抛出。
 */
async function requestSource<T>(
  label: string,
  url: string,
  options: SourceRequestOptions,
  read: (response: Response) => Promise<T>,
): Promise<{ data: T; finalUrl: string }> {
  const { signal, timeoutMs = 10000, ...init } = options;
  const abortState = createTimedAbortController(signal, timeoutMs);
  try {
    const response = await fetchUpstream(url, {
      ...init,
      signal: abortState.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceStatusError(`${label}请求失败 (${response.status})`);
    }
    return { data: await read(response), finalUrl: response.url || url };
  } catch (error) {
    if (error instanceof ResourceLimitError) throw error;
    if (error instanceof SourceStatusError) throw error;
    if (abortState.isTimeout()) throw new Error(`${label}请求超时`);
    if (signal?.aborted) throw error;
    throw new Error(
      `${label}请求失败 (${getUpstreamErrorType(error) || 'unknown'})`,
      { cause: error },
    );
  } finally {
    abortState.cleanup();
  }
}

export async function requestSourceText(
  label: string,
  url: string,
  options: SourceRequestOptions = {},
): Promise<{ text: string; finalUrl: string }> {
  const { data, finalUrl } = await requestSource(label, url, options, (res) =>
    readTextLimited(res, UPSTREAM_METADATA_MAX_BYTES),
  );
  return { text: data, finalUrl };
}

export async function requestSourceJson(
  label: string,
  url: string,
  options: SourceRequestOptions = {},
): Promise<unknown> {
  const { data } = await requestSource(label, url, options, (res) =>
    readJsonLimited<unknown>(res, UPSTREAM_METADATA_MAX_BYTES),
  );
  return data;
}
