import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { setImmediate as scheduleImmediate } from 'node:timers';
import { createGunzip } from 'node:zlib';

import { runWithConcurrency } from '@/lib/concurrency';
import { getConfig, getConfigForRead, saveConfig } from '@/lib/config';
import {
  fetchStreamThroughProxy,
  fetchTextThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import { fetchWithUrlGuard, UrlValidationError } from '@/lib/url-guard';
import type { AdminConfig } from '@/types/admin';

const defaultUA = 'AptvPlayer/1.4.10';
const MAX_LIVE_PLAYLIST_BYTES = 5 * 1024 * 1024;
const MAX_EPG_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_EPG_TEXT_BYTES = 100 * 1024 * 1024;
const MAX_EPG_XML_BLOCK_CHARS = 2 * 1024 * 1024;
const EPG_PARSE_CHUNK_BYTES = 256 * 1024;
const DEFAULT_EPG_PAST_HOURS = 6;
const DEFAULT_EPG_FUTURE_HOURS = 48;
const DEFAULT_EPG_PROGRAMS_PER_CHANNEL = 240;

export interface LiveChannels {
  channelNumber: number;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
  epgUrl: string;
  epgs: {
    [key: string]: {
      start: string;
      end: string;
      title: string;
    }[];
  };
}

interface CacheEntry {
  data: LiveChannels;
  freshUntil: number;
}

type LiveConfigEntry = NonNullable<AdminConfig['LiveConfig']>[number];

const CACHE_FRESH_MS = 30 * 60 * 1000;
const DEFAULT_LIVE_REFRESH_CONCURRENCY = 2;
const cachedLiveChannels: { [key: string]: CacheEntry } = {};
const inflightRequests: { [key: string]: Promise<number> } = {};

export function deleteCachedLiveChannels(key: string) {
  delete cachedLiveChannels[key];
  delete inflightRequests[key];
}

export function isLiveEntryEnabledInConfig(config: {
  SiteConfig?: { EnableLiveEntry?: boolean };
}) {
  return config.SiteConfig?.EnableLiveEntry === true;
}

export async function isLiveEntryEnabled() {
  const config = await getConfigForRead();
  return isLiveEntryEnabledInConfig(config);
}

export async function getCachedLiveChannels(
  key: string,
): Promise<LiveChannels | null> {
  const entry = cachedLiveChannels[key];
  if (entry && Date.now() < entry.freshUntil) {
    return entry.data;
  }

  const config = await getConfigForRead();
  if (!isLiveEntryEnabledInConfig(config)) {
    return null;
  }

  const liveInfo = config.LiveConfig?.find((live) => live.key === key);
  if (!liveInfo) {
    return null;
  }

  if (entry) {
    void refreshLiveChannels(liveInfo).catch((error) => {
      console.warn(`后台刷新直播源失败 [${liveInfo.name || key}]:`, error);
    });
    return entry.data;
  }

  const channelNum = await refreshLiveChannels(liveInfo);
  if (channelNum === 0) {
    return null;
  }
  const writableConfig = await getConfig();
  const writableLiveInfo = writableConfig.LiveConfig?.find(
    (live) => live.key === key,
  );
  if (writableLiveInfo) {
    writableLiveInfo.channelNumber = channelNum;
    await saveConfig(writableConfig);
  }
  return cachedLiveChannels[key]?.data || null;
}

export async function refreshLiveChannels(liveInfo: {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}): Promise<number> {
  if (liveInfo.key in inflightRequests) {
    return inflightRequests[liveInfo.key];
  }

  const doRefresh = async (): Promise<number> => {
    const ua = liveInfo.ua?.trim() || defaultUA;
    const sourceUrl = liveInfo.url.trim();
    const data = await fetchLivePlaylistText(sourceUrl, ua);
    const result = parseLivePlaylist(liveInfo.key, data);
    const epgUrl = liveInfo.epg?.trim() || result.tvgUrl;
    const epgs = await parseEpg(
      epgUrl,
      ua,
      result.channels.map((channel) => ({
        tvgId: channel.tvgId,
        name: channel.name,
      })),
    );
    cachedLiveChannels[liveInfo.key] = {
      data: {
        channelNumber: result.channels.length,
        channels: result.channels,
        epgUrl: epgUrl,
        epgs: epgs,
      },
      freshUntil: Date.now() + CACHE_FRESH_MS,
    };
    return result.channels.length;
  };

  inflightRequests[liveInfo.key] = doRefresh().finally(() => {
    delete inflightRequests[liveInfo.key];
  });
  return inflightRequests[liveInfo.key];
}

export async function refreshLiveChannelSources(
  liveInfos: LiveConfigEntry[],
): Promise<void> {
  const tasks = liveInfos
    .filter((liveInfo) => !liveInfo.disabled)
    .map((liveInfo) => async () => {
      try {
        liveInfo.channelNumber = await refreshLiveChannels(liveInfo);
      } catch (error) {
        console.error(
          `刷新直播源失败 [${liveInfo.name || liveInfo.key}]:`,
          error,
        );
      }
    });

  await runWithConcurrency(tasks, getLiveRefreshConcurrency());
}

function getLiveRefreshConcurrency() {
  const parsed = Number.parseInt(
    process.env.LIVE_REFRESH_CONCURRENCY || '',
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIVE_REFRESH_CONCURRENCY;
  }
  return Math.min(2, parsed);
}

async function fetchLivePlaylistText(url: string, ua: string): Promise<string> {
  const targetUrl = new URL(url);

  try {
    const response = await fetchWithUrlGuard(targetUrl.toString(), {
      headers: {
        'User-Agent': ua,
      },
      timeoutMs: 15_000,
    });
    if (!response.ok) {
      throw new Error(`直播源请求失败: ${response.status}`);
    }
    const buffer = await readResponseBody(
      response,
      MAX_LIVE_PLAYLIST_BYTES,
      '直播源',
    );
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    if (error instanceof UrlValidationError || isResponseLimitError(error)) {
      throw error;
    }

    const proxyUrl = getProxyUrlForTarget(targetUrl);
    if (!proxyUrl) {
      throw error;
    }

    return fetchTextThroughProxy(targetUrl, proxyUrl, {
      timeoutMs: 15_000,
      userAgent: ua,
      maxBytes: MAX_LIVE_PLAYLIST_BYTES,
    });
  }
}

async function parseEpg(
  epgUrl: string,
  ua: string,
  channels: { tvgId: string; name: string }[],
): Promise<{
  [key: string]: {
    start: string;
    end: string;
    title: string;
  }[];
}> {
  if (!epgUrl) {
    return {};
  }

  try {
    return await fetchEpgData(epgUrl, ua, channels);
  } catch (error) {
    console.warn('解析节目单失败:', error);
  }

  return {};
}

async function fetchEpgData(
  url: string,
  ua: string,
  channels: { tvgId: string; name: string }[],
) {
  const targetUrl = new URL(url);

  try {
    const response = await fetchWithUrlGuard(targetUrl.toString(), {
      headers: {
        Accept: 'application/xml,text/xml,*/*',
        'User-Agent': ua,
      },
      timeoutMs: 30_000,
    });
    if (!response.ok) {
      throw new Error(`节目单请求失败: ${response.status}`);
    }
    return parseEpgResponseStream(
      response.body,
      response.headers,
      targetUrl,
      channels,
      MAX_EPG_RESPONSE_BYTES,
    );
  } catch (error) {
    if (error instanceof UrlValidationError || isResponseLimitError(error)) {
      throw error;
    }

    const proxyUrl = getProxyUrlForTarget(targetUrl);
    if (!proxyUrl) {
      throw error;
    }

    const response = await fetchStreamThroughProxy(targetUrl, proxyUrl, {
      timeoutMs: 30_000,
      userAgent: ua,
      maxBytes: MAX_EPG_RESPONSE_BYTES,
      accept: 'application/xml,text/xml,*/*',
    });
    return parseEpgResponseStream(
      response.body,
      response.headers,
      targetUrl,
      channels,
      MAX_EPG_RESPONSE_BYTES,
    );
  }
}

async function parseEpgResponseStream(
  body: ReadableStream<Uint8Array> | null,
  headers: Headers,
  url: URL,
  channels: { tvgId: string; name: string }[],
  maxResponseBytes: number,
) {
  if (!body) {
    return {};
  }

  const reader = body.getReader();
  const firstRead = await reader.read();
  if (firstRead.done || !firstRead.value) {
    reader.releaseLock();
    return {};
  }

  const firstChunk = Buffer.from(firstRead.value);
  const shouldGunzip = isGzipEpg(headers, url, firstChunk);

  async function* readChunks() {
    let totalBytes = firstChunk.length;
    if (totalBytes > maxResponseBytes) {
      throw new Error('节目单文件过大');
    }

    try {
      yield firstChunk;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > maxResponseBytes) {
          throw new Error('节目单文件过大');
        }
        yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }

  const input = Readable.from(readChunks());
  const decodedStream = shouldGunzip ? input.pipe(createGunzip()) : input;
  const decoder = new StringDecoder('utf8');
  const collector = new EpgXmlCollector(channels);
  let decodedBytes = 0;

  for await (const rawChunk of decodedStream) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    decodedBytes += chunk.length;
    if (decodedBytes > MAX_EPG_TEXT_BYTES) {
      throw new Error('节目单解压后文件过大');
    }

    for (
      let offset = 0;
      offset < chunk.length;
      offset += EPG_PARSE_CHUNK_BYTES
    ) {
      collector.push(
        decoder.write(chunk.subarray(offset, offset + EPG_PARSE_CHUNK_BYTES)),
      );
      if (offset + EPG_PARSE_CHUNK_BYTES < chunk.length) {
        await yieldToEventLoop();
      }
    }
  }

  collector.push(decoder.end());
  return collector.finish();
}

function isGzipEpg(headers: Headers, url: URL, firstChunk: Buffer) {
  const contentEncoding = headers.get('content-encoding') || '';
  const hasGzipHint =
    contentEncoding.toLowerCase().includes('gzip') ||
    url.pathname.toLowerCase().endsWith('.gz');
  if (firstChunk.length < 2) {
    return hasGzipHint;
  }
  return firstChunk[0] === 0x1f && firstChunk[1] === 0x8b;
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => scheduleImmediate(resolve));
}

async function readResponseBody(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new Error(`${label}文件过大`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function isResponseLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.endsWith('文件过大');
}

export function parseEpgXmlForChannels(
  content: string,
  channels: { tvgId: string; name: string }[],
  options: EpgParseOptions = {},
): {
  [key: string]: {
    start: string;
    end: string;
    title: string;
  }[];
} {
  const collector = new EpgXmlCollector(channels, options);
  collector.push(content);
  return collector.finish();
}

type EpgParseOptions = {
  now?: number;
  pastHours?: number;
  futureHours?: number;
  maxProgramsPerChannel?: number;
};

type EpgProgram = {
  start: string;
  end: string;
  title: string;
};

class EpgXmlCollector {
  private buffer = '';
  private readonly result: Record<string, EpgProgram[]> = {};
  private readonly aliasToKeys: Map<string, Set<string>>;
  private readonly epgChannelToKeys = new Map<string, Set<string>>();
  private readonly now: number;
  private readonly pastMs: number;
  private readonly futureMs: number;
  private readonly maxProgramsPerChannel: number;

  constructor(
    channels: { tvgId: string; name: string }[],
    options: EpgParseOptions = {},
  ) {
    this.aliasToKeys = buildEpgAliasMap(channels);
    this.now = options.now ?? Date.now();
    this.pastMs =
      readPositiveNumber(options.pastHours, DEFAULT_EPG_PAST_HOURS) *
      60 *
      60 *
      1000;
    this.futureMs =
      readPositiveNumber(options.futureHours, DEFAULT_EPG_FUTURE_HOURS) *
      60 *
      60 *
      1000;
    this.maxProgramsPerChannel = Math.floor(
      readPositiveNumber(
        options.maxProgramsPerChannel,
        DEFAULT_EPG_PROGRAMS_PER_CHANNEL,
      ),
    );

    for (const channel of channels) {
      for (const key of getChannelResultKeys(channel)) {
        mergeKeySet(this.epgChannelToKeys, key, new Set([key]));
      }
    }
  }

  push(content: string) {
    if (!content) return;
    this.buffer += content;
    this.consumeBlocks();
  }

  finish() {
    this.consumeBlocks();
    this.buffer = '';
    return this.result;
  }

  private consumeBlocks() {
    while (this.buffer) {
      const startMatch = /<(channel|programme)\b/i.exec(this.buffer);
      if (!startMatch || startMatch.index === undefined) {
        this.buffer = this.buffer.slice(-64);
        return;
      }

      if (startMatch.index > 0) {
        this.buffer = this.buffer.slice(startMatch.index);
      }

      const blockType = startMatch[1].toLowerCase() as 'channel' | 'programme';
      const closeMatch = new RegExp(`</${blockType}\\s*>`, 'i').exec(
        this.buffer,
      );
      if (!closeMatch || closeMatch.index === undefined) {
        this.trimOversizedBlock();
        return;
      }

      const blockEnd = closeMatch.index + closeMatch[0].length;
      const block = this.buffer.slice(0, blockEnd);
      this.buffer = this.buffer.slice(blockEnd);

      if (blockType === 'channel') {
        this.consumeChannel(block);
      } else {
        this.consumeProgramme(block);
      }
    }
  }

  private trimOversizedBlock() {
    if (this.buffer.length <= MAX_EPG_XML_BLOCK_CHARS) return;
    const nextStart = /<(channel|programme)\b/i.exec(this.buffer.slice(1));
    this.buffer = nextStart
      ? this.buffer.slice((nextStart.index || 0) + 1)
      : this.buffer.slice(-64);
  }

  private consumeChannel(block: string) {
    const openTag = block.match(/^<channel\s+([^>]*)>/i);
    if (!openTag) return;

    const epgChannelId = getXmlAttr(openTag[1], 'id');
    if (!epgChannelId) return;

    const matchedKeys = matchEpgKeys(this.aliasToKeys, epgChannelId);
    const displayNameRegex =
      /<display-name(?:\s+[^>]*)?>([\s\S]*?)<\/display-name>/gi;
    let displayNameMatch: RegExpExecArray | null;
    while ((displayNameMatch = displayNameRegex.exec(block))) {
      const displayName = stripXmlText(displayNameMatch[1]);
      for (const key of matchEpgKeys(this.aliasToKeys, displayName)) {
        matchedKeys.add(key);
      }
    }

    if (matchedKeys.size > 0) {
      mergeKeySet(this.epgChannelToKeys, epgChannelId, matchedKeys);
    }
  }

  private consumeProgramme(block: string) {
    const openTag = block.match(/^<programme\s+([^>]*)>/i);
    if (!openTag) return;

    const attrs = openTag[1];
    const epgChannelId = getXmlAttr(attrs, 'channel');
    const start = getXmlAttr(attrs, 'start');
    const end = getXmlAttr(attrs, 'stop');
    if (
      !epgChannelId ||
      !start ||
      !end ||
      !isEpgProgramInWindow(start, end, this.now, this.pastMs, this.futureMs)
    ) {
      return;
    }

    const keys =
      this.epgChannelToKeys.get(epgChannelId) ||
      matchEpgKeys(this.aliasToKeys, epgChannelId);
    if (!keys || keys.size === 0) return;

    const titleMatch = block.match(/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripXmlText(titleMatch[1]) : '';
    if (!title) return;

    const program = { start, end, title };
    for (const key of keys) {
      const programs = this.result[key] || [];
      if (programs.length >= this.maxProgramsPerChannel) continue;
      programs.push(program);
      this.result[key] = programs;
    }
  }
}

function isEpgProgramInWindow(
  start: string,
  end: string,
  now: number,
  pastMs: number,
  futureMs: number,
) {
  const startMs = parseEpgTimestamp(start);
  const endMs = parseEpgTimestamp(end);
  if (startMs === null || endMs === null) {
    return true;
  }
  return endMs >= now - pastMs && startMs <= now + futureMs;
}

function parseEpgTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const xmlTvMatch = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2})|\s*Z)?$/,
  );
  if (xmlTvMatch) {
    const [
      ,
      year,
      month,
      day,
      hour,
      minute,
      second,
      sign,
      zoneHour,
      zoneMinute,
    ] = xmlTvMatch;
    const utc = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    if (!sign) {
      return utc;
    }
    const offsetMs = (Number(zoneHour) * 60 + Number(zoneMinute)) * 60 * 1000;
    return sign === '+' ? utc - offsetMs : utc + offsetMs;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function buildEpgAliasMap(channels: { tvgId: string; name: string }[]) {
  const aliasToKeys = new Map<string, Set<string>>();
  for (const channel of channels) {
    const keys = getChannelResultKeys(channel);
    for (const value of [channel.tvgId, channel.name]) {
      for (const alias of createEpgAliases(value)) {
        mergeKeySet(aliasToKeys, alias, keys);
      }
    }
  }
  return aliasToKeys;
}

function getChannelResultKeys(channel: { tvgId: string; name: string }) {
  return new Set([channel.tvgId, channel.name].filter(Boolean));
}

function matchEpgKeys(aliasToKeys: Map<string, Set<string>>, value: string) {
  const matchedKeys = new Set<string>();
  for (const alias of createEpgAliases(value)) {
    const keys = aliasToKeys.get(alias);
    if (!keys) {
      continue;
    }
    for (const key of keys) {
      matchedKeys.add(key);
    }
  }
  return matchedKeys;
}

function createEpgAliases(value: string) {
  const values = new Set<string>();
  const raw = value.trim();
  if (!raw) {
    return values;
  }

  values.add(raw);
  values.add(raw.replace(/[\[(（【].*?[\])）】]/g, ''));
  values.add(raw.split('@')[0]);
  values.add(raw.split('.')[0]);
  values.add(raw.replace(/\.(cn|com|tv).*$/i, ''));

  const normalizedValues = new Set<string>();
  for (const item of values) {
    const normalized = normalizeEpgAlias(item);
    if (normalized) {
      normalizedValues.add(normalized);
    }
  }
  return normalizedValues;
}

function normalizeEpgAlias(value: string) {
  return value
    .toLowerCase()
    .replace(/[\[(（【].*?[\])）】]/g, '')
    .replace(/(4k|8k|1080p|720p|2160p|uhd|fhd|hd|sd)/gi, '')
    .replace(/(高清|超清|标清|频道|综合|蓝光)/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function mergeKeySet(
  target: Map<string, Set<string>>,
  key: string,
  values: Set<string>,
) {
  if (!key) {
    return;
  }
  const current = target.get(key) || new Set<string>();
  for (const value of values) {
    current.add(value);
  }
  target.set(key, current);
}

function getXmlAttr(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`${name}=(['"])(.*?)\\1`, 'i'));
  return match ? stripXmlText(match[2]) : '';
}

function stripXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/**
 * 解析M3U文件内容，提取频道信息
 * @param m3uContent M3U文件的内容字符串
 * @returns 频道信息数组
 */
export function parseLivePlaylist(
  sourceKey: string,
  content: string,
): {
  tvgUrl: string;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
} {
  const normalizedContent = content.replace(/^\uFEFF/, '');
  if (
    /^\s*#EXTM3U/im.test(normalizedContent) ||
    /^\s*#EXTINF:/im.test(normalizedContent)
  ) {
    return parseM3U(sourceKey, normalizedContent);
  }

  return parseTextIptv(sourceKey, normalizedContent);
}

function parseM3U(
  sourceKey: string,
  m3uContent: string,
): {
  tvgUrl: string;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
} {
  const channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[] = [];

  const lines = m3uContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let tvgUrl = '';
  let channelIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检查是否是 #EXTM3U 行，提取 tvg-url
    if (line.startsWith('#EXTM3U')) {
      // 支持两种格式：x-tvg-url 和 url-tvg
      const tvgUrlMatch = line.match(/(?:x-tvg-url|url-tvg)="([^"]*)"/);
      tvgUrl = tvgUrlMatch ? tvgUrlMatch[1].split(',')[0].trim() : '';
      continue;
    }

    // 检查是否是 #EXTINF 行
    if (line.startsWith('#EXTINF:')) {
      // 提取 tvg-id
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      const tvgId = tvgIdMatch ? tvgIdMatch[1] : '';

      // 提取 tvg-name
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
      const tvgName = tvgNameMatch ? tvgNameMatch[1] : '';

      // 提取 tvg-logo
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
      const logo = tvgLogoMatch ? tvgLogoMatch[1] : '';

      // 提取 group-title
      const groupTitleMatch = line.match(/group-title="([^"]*)"/);
      const group = groupTitleMatch ? groupTitleMatch[1] : '无分组';

      // 提取标题（#EXTINF 行最后的逗号后面的内容）
      const titleMatch = line.match(/,([^,]*)$/);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // 优先使用 tvg-name，如果没有则使用标题
      const name = title || tvgName || '';

      // 检查下一行是否是URL
      if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
        const url = lines[i + 1];

        // 只有当有名称和URL时才添加到结果中
        if (name && url) {
          channels.push({
            id: `${sourceKey}-${channelIndex}`,
            tvgId,
            name,
            logo,
            group,
            url,
          });
          channelIndex++;
        }

        // 跳过下一行，因为已经处理了
        i++;
      }
    }
  }

  return { tvgUrl, channels };
}

function parseTextIptv(
  sourceKey: string,
  content: string,
): {
  tvgUrl: string;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
} {
  const channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[] = [];
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let group = '未分组';
  let channelIndex = 0;

  for (const line of lines) {
    const separatorIndex = line.indexOf(',');
    if (separatorIndex === -1) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!name || !value) {
      continue;
    }

    if (value.toLowerCase() === '#genre#') {
      group = name;
      continue;
    }

    channels.push({
      id: `${sourceKey}-${channelIndex}`,
      tvgId: name,
      name,
      logo: '',
      group,
      url: value,
    });
    channelIndex++;
  }

  return { tvgUrl: '', channels };
}
