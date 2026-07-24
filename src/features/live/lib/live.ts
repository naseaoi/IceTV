import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';

import { runWithConcurrency } from '@/lib/concurrency';
import { getConfig, getConfigForRead, saveConfig } from '@/lib/config';
import {
  fetchResponseThroughProxy,
  fetchTextThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import { fetchWithUrlGuard, UrlValidationError } from '@/lib/url-guard';
import type { AdminConfig } from '@/types/admin';

const defaultUA = 'AptvPlayer/1.4.10';
const MAX_LIVE_PLAYLIST_BYTES = 5 * 1024 * 1024;
const MAX_EPG_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_EPG_TEXT_BYTES = 100 * 1024 * 1024;

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
    const epgText = await fetchEpgText(epgUrl, ua);
    return parseEpgXmlForChannels(epgText, channels);
  } catch (error) {
    console.warn('解析节目单失败:', error);
  }

  return {};
}

async function fetchEpgText(url: string, ua: string): Promise<string> {
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
    const buffer = await readResponseBody(
      response,
      MAX_EPG_RESPONSE_BYTES,
      '节目单',
    );
    return decodeEpgBuffer(buffer, response.headers, targetUrl);
  } catch (error) {
    if (error instanceof UrlValidationError || isResponseLimitError(error)) {
      throw error;
    }

    const proxyUrl = getProxyUrlForTarget(targetUrl);
    if (!proxyUrl) {
      throw error;
    }

    const response = await fetchResponseThroughProxy(targetUrl, proxyUrl, {
      timeoutMs: 30_000,
      userAgent: ua,
      maxBytes: MAX_EPG_RESPONSE_BYTES,
      accept: 'application/xml,text/xml,*/*',
    });
    return decodeEpgBuffer(response.body, response.headers, targetUrl);
  }
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

function decodeEpgBuffer(buffer: Buffer, headers: Headers, url: URL): string {
  const contentEncoding = headers.get('content-encoding') || '';
  const shouldGunzip =
    contentEncoding.toLowerCase().includes('gzip') ||
    url.pathname.toLowerCase().endsWith('.gz') ||
    (buffer[0] === 0x1f && buffer[1] === 0x8b);
  const decodedBuffer = shouldGunzip ? gunzipSync(buffer) : buffer;
  if (decodedBuffer.length > MAX_EPG_TEXT_BYTES) {
    throw new Error('节目单解压后文件过大');
  }
  return decodedBuffer.toString('utf8').replace(/^\uFEFF/, '');
}

export function parseEpgXmlForChannels(
  content: string,
  channels: { tvgId: string; name: string }[],
): {
  [key: string]: {
    start: string;
    end: string;
    title: string;
  }[];
} {
  const result: {
    [key: string]: { start: string; end: string; title: string }[];
  } = {};
  const aliasToKeys = buildEpgAliasMap(channels);
  const epgChannelToKeys = new Map<string, Set<string>>();

  for (const channel of channels) {
    for (const key of getChannelResultKeys(channel)) {
      mergeKeySet(epgChannelToKeys, key, new Set([key]));
    }
  }

  const channelBlockRegex =
    /<channel\s+[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
  let channelMatch: RegExpExecArray | null;
  while ((channelMatch = channelBlockRegex.exec(content))) {
    const epgChannelId = channelMatch[1];
    const channelBody = channelMatch[2];
    const matchedKeys = matchEpgKeys(aliasToKeys, epgChannelId);
    const displayNameRegex =
      /<display-name(?:\s+[^>]*)?>([\s\S]*?)<\/display-name>/g;
    let displayNameMatch: RegExpExecArray | null;

    while ((displayNameMatch = displayNameRegex.exec(channelBody))) {
      const displayName = stripXmlText(displayNameMatch[1]);
      const keys = matchEpgKeys(aliasToKeys, displayName);
      for (const key of keys) {
        matchedKeys.add(key);
      }
    }

    if (matchedKeys.size > 0) {
      mergeKeySet(epgChannelToKeys, epgChannelId, matchedKeys);
    }
  }

  const programmeRegex = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/g;
  let programmeMatch: RegExpExecArray | null;
  while ((programmeMatch = programmeRegex.exec(content))) {
    const attrs = programmeMatch[1];
    const body = programmeMatch[2];
    const epgChannelId = getXmlAttr(attrs, 'channel');
    const start = getXmlAttr(attrs, 'start');
    const end = getXmlAttr(attrs, 'stop');
    if (!epgChannelId || !start || !end) {
      continue;
    }

    const keys =
      epgChannelToKeys.get(epgChannelId) ||
      matchEpgKeys(aliasToKeys, epgChannelId);
    if (!keys || keys.size === 0) {
      continue;
    }

    const titleMatch = body.match(/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/);
    const title = titleMatch ? stripXmlText(titleMatch[1]) : '';
    if (!title) {
      continue;
    }

    for (const key of keys) {
      if (!result[key]) {
        result[key] = [];
      }
      result[key].push({ start, end, title });
    }
  }

  return result;
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
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return match ? stripXmlText(match[1]) : '';
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
