// 扩展 HTMLVideoElement 类型以支持 hls / flv 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;

    flv?: any;
  }
}

// 服务器中转探测结论；unknown 含未检测、结果过期与本轮暂缓
export type LiveLineHealthStatus =
  | 'ok'
  | 'slow'
  | 'failed'
  | 'ended'
  | 'unknown';

export type LiveLineHealthReason =
  | 'timeout'
  | 'unreachable'
  | 'forbidden'
  | 'not_found'
  | 'http_error'
  | 'invalid_playlist'
  | 'segment_failed';

export interface LiveLineHealth {
  status: LiveLineHealthStatus;
  /** 最近一次完成探测的时间（ms）；unknown 且从未检测时缺省 */
  checkedAt?: number;
  /** 清单首字节耗时（ms） */
  latencyMs?: number;
  /** status 为 failed 时的失败分类 */
  reason?: LiveLineHealthReason;
}

// 直播频道接口（一条订阅条目即一条线路）
export interface LiveChannel {
  id: string;
  /** 线路指纹：源 + 订阅地址 + 有效 UA + 频道地址的哈希，订阅重排后保持不变 */
  lineId: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  /** 健康读取失败或尚未接入时缺省，按 unknown 处理 */
  health?: LiveLineHealth;
}

// 直播源接口
export interface LiveSource {
  key: string;
  name: string;
  url: string; // m3u 地址
  ua?: string;
  epg?: string; // 节目单
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}

export type LivePanelTab = 'channels' | 'epg' | 'sources';

// EPG 节目信息
export interface EpgProgram {
  start: string;
  end: string;
  title: string;
}

// EPG 数据
export interface EpgData {
  tvgId: string;
  source: string;
  epgUrl: string;
  programs: EpgProgram[];
}
