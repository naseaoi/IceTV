// 扩展 HTMLVideoElement 类型以支持 hls / flv 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;

    flv?: any;
  }
}

// 直播频道接口
export interface LiveChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
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
