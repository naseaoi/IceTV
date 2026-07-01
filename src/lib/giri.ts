import { normalizeInlineText } from '@/lib/utils';

export interface GiriEpisodeEntry {
  playPath: string;
  title: string;
}

export interface GiriEpisodeVariant {
  groupId: string;
  label: string;
  isDefault: boolean;
  episodes: GiriEpisodeEntry[];
}

const GIRI_VARIANT_ID_MARKER = '__giri_';
const GIRI_EPISODE_LINK_REGEX =
  /href="(\/playGV\d+-(\d+)-\d+\/)"[^>]*>([\s\S]*?)<\/a>/g;

function cleanText(rawText: string): string {
  return normalizeInlineText(rawText.replace(/<[^>]+>/g, ' '));
}

function buildEpisodeEntries(matches: RegExpMatchArray[]): GiriEpisodeEntry[] {
  const entries: GiriEpisodeEntry[] = [];
  const seenPlayPaths = new Set<string>();

  for (const match of matches) {
    const playPath = match[1];
    if (!playPath || seenPlayPaths.has(playPath)) {
      continue;
    }

    seenPlayPaths.add(playPath);
    entries.push({
      playPath,
      title: cleanText(match[3] || ''),
    });
  }

  return entries;
}

// 截取 anthology-tab 区块内容
function sliceAnthologyTabSection(html: string): string {
  const startMatch = html.match(/<div class="anthology-tab[^"]*">/);
  if (!startMatch || startMatch.index === undefined) {
    return '';
  }

  const startIdx = startMatch.index + startMatch[0].length;
  const rest = html.slice(startIdx);
  const endMatch = rest.search(
    /<div class="anthology-list(?:-box)?[^"]*"|<\/div>\s*<\/div>\s*<div class="anthology/,
  );

  return endMatch >= 0 ? rest.slice(0, endMatch) : rest;
}

function extractVariantLabels(html: string): string[] {
  const tabContent = sliceAnthologyTabSection(html);
  if (!tabContent) {
    return [];
  }

  return Array.from(tabContent.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)).map(
    (match, index) => cleanText(match[1] || '') || `版本${index + 1}`,
  );
}

// 统计源站详情页版本数量
export function countGirigiriVariantTabs(html: string): number {
  return extractVariantLabels(html).length;
}

export function parseGirigiriVariantId(rawId: string): {
  videoId: string;
  groupId: string | null;
} {
  const match = rawId.match(
    new RegExp(`^(.*)${GIRI_VARIANT_ID_MARKER}(\\d+)$`),
  );
  if (!match) {
    return { videoId: rawId, groupId: null };
  }

  return {
    videoId: match[1],
    groupId: match[2],
  };
}

export function buildGirigiriVariantId(
  videoId: string,
  groupId: string,
  isDefault: boolean,
): string {
  return isDefault ? videoId : `${videoId}${GIRI_VARIANT_ID_MARKER}${groupId}`;
}

export function extractGirigiriEpisodeVariants(
  html: string,
): GiriEpisodeVariant[] {
  const matches = Array.from(html.matchAll(GIRI_EPISODE_LINK_REGEX));
  if (matches.length === 0) {
    return [];
  }

  const variantLabels = extractVariantLabels(html);
  const orderedGroupIds: string[] = [];
  const groupedMatches = new Map<string, RegExpMatchArray[]>();

  for (const match of matches) {
    const groupId = match[2];
    if (!groupId) {
      continue;
    }

    if (!groupedMatches.has(groupId)) {
      groupedMatches.set(groupId, []);
      orderedGroupIds.push(groupId);
    }

    groupedMatches.get(groupId)?.push(match);
  }

  return orderedGroupIds
    .map((groupId, index) => ({
      groupId,
      label: variantLabels[index] || `版本${index + 1}`,
      isDefault: index === 0,
      episodes: buildEpisodeEntries(groupedMatches.get(groupId) || []),
    }))
    .filter((variant) => variant.episodes.length > 0);
}

export function extractGirigiriEpisodeEntries(
  html: string,
): GiriEpisodeEntry[] {
  return extractGirigiriEpisodeVariants(html)[0]?.episodes || [];
}
