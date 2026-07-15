// 扩展 HTMLVideoElement 类型以支持 hls 属性
// 注意: live/page.tsx 中也有相同的 declare global，声明为 hls?: any，
// TypeScript 接口合并要求同名属性类型完全一致，因此这里也必须使用 any。
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

export type SessionLostReason =
  | 'ok'
  | 'missing_cookie'
  | 'invalid_signature'
  | 'missing_signature'
  | 'missing_username'
  | 'user_not_found'
  | 'user_banned'
  | 'server_error';

export type SessionLostDetail = {
  reason: SessionLostReason;
  sourceUrl: string;
  loginUrl: string;
  inPlayerPage: boolean;
};

export type PlayCheckpoint = {
  source: string;
  id: string;
  episodeIndex: number;
  currentTime: number;
  title: string;
  saveTime: number;
};

// Wake Lock API 类型声明
export interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

export const PLAY_CHECKPOINT_KEY = 'icetv_play_checkpoint';
export const LEGACY_PLAY_CHECKPOINT_KEY = 'moontv_play_checkpoint';
