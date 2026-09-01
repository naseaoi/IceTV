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
