import { normalizeDanmakuRetrySeconds } from '@/features/play/lib/danmaku/cache-policy';

export type DanmakuMode = 0 | 1 | 2;

export interface DanmakuItem {
  text: string;
  time: number;
  mode: DanmakuMode;
  color: string;
}

export interface DanmakuFetchResult {
  items: DanmakuItem[];
  total: number;
  truncated: boolean;
}

export interface DanmakuMatchCandidate {
  episodeId: number;
  animeTitle: string;
  episodeTitle: string;
  typeDescription?: string;
}

export interface DanmakuSearchResult {
  candidates: DanmakuMatchCandidate[];
}

export type DanmakuProviderErrorKind =
  | 'not-configured'
  | 'episode-not-found'
  | 'rate-limited'
  | 'upstream-unavailable'
  | 'upstream-rejected'
  | 'invalid-response';

export class DanmakuProviderError extends Error {
  constructor(
    public readonly kind: DanmakuProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'DanmakuProviderError';
  }
}

export class DanmakuEpisodeNotFoundError extends Error {
  constructor() {
    super('弹幕集数映射已失效');
    this.name = 'DanmakuEpisodeNotFoundError';
  }
}

export class DanmakuRateLimitError extends DanmakuProviderError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const seconds = normalizeDanmakuRetrySeconds(retryAfterSeconds);
    super('rate-limited', `弹幕服务请求频繁，请 ${seconds} 秒后重试`);
    this.name = 'DanmakuRateLimitError';
    this.retryAfterSeconds = seconds;
  }
}

export type DanmakuReloadHandler = (options?: {
  refreshData?: boolean;
}) => void | Promise<void>;
