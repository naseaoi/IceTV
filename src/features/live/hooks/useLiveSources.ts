import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import { parseCustomTimeFormat } from '@/lib/time';

import type { EpgData, EpgProgram, LiveChannel, LiveSource } from '../types';

// ----- EPG 数据清洗 -----

/** 去除重叠节目、只保留今日节目、重叠时保留较短节目 */
export function cleanEpgData(programs: EpgProgram[]): EpgProgram[] {
  if (!programs || programs.length === 0) return programs;

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const todayEnd = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  );
  const todayStartMs = todayStart.getTime();
  const todayEndMs = todayEnd.getTime();

  // 过滤今日节目
  const timedPrograms = programs.map((program) => {
    const programStart = parseCustomTimeFormat(program.start);
    const programEnd = parseCustomTimeFormat(program.end);

    return {
      program,
      startMs: programStart.getTime(),
      endMs: programEnd.getTime(),
      startDateMs: new Date(
        programStart.getFullYear(),
        programStart.getMonth(),
        programStart.getDate(),
      ).getTime(),
      endDateMs: new Date(
        programEnd.getFullYear(),
        programEnd.getMonth(),
        programEnd.getDate(),
      ).getTime(),
    };
  });

  const todayPrograms = timedPrograms.filter((program) => {
    return (
      (program.startDateMs >= todayStartMs &&
        program.startDateMs < todayEndMs) ||
      (program.endDateMs >= todayStartMs && program.endDateMs < todayEndMs) ||
      (program.startDateMs < todayStartMs && program.endDateMs >= todayEndMs)
    );
  });

  // 按开始时间排序
  const sortedPrograms = [...todayPrograms].sort(
    (a, b) => a.startMs - b.startMs,
  );

  const cleanedPrograms: typeof sortedPrograms = [];

  for (let i = 0; i < sortedPrograms.length; i++) {
    const currentProgram = sortedPrograms[i];
    const existingProgram = cleanedPrograms[cleanedPrograms.length - 1];
    if (!existingProgram) {
      cleanedPrograms.push(currentProgram);
      continue;
    }

    const hasOverlap =
      (currentProgram.startMs >= existingProgram.startMs &&
        currentProgram.startMs < existingProgram.endMs) ||
      (currentProgram.endMs > existingProgram.startMs &&
        currentProgram.endMs <= existingProgram.endMs) ||
      (currentProgram.startMs <= existingProgram.startMs &&
        currentProgram.endMs >= existingProgram.endMs);

    if (!hasOverlap) {
      cleanedPrograms.push(currentProgram);
    } else {
      const currentDuration = currentProgram.endMs - currentProgram.startMs;
      const existingDuration = existingProgram.endMs - existingProgram.startMs;
      if (currentDuration < existingDuration) {
        cleanedPrograms[cleanedPrograms.length - 1] = currentProgram;
      }
    }
  }

  return cleanedPrograms.map((program) => program.program);
}

// ----- Hook 参数接口 -----
interface UseLiveSourcesParams {
  cleanupPlayer: () => void;
  channelListRef: MutableRefObject<HTMLDivElement | null>;
  groupContainerRef: MutableRefObject<HTMLDivElement | null>;
}

// ----- Hook 返回接口 -----
interface UseLiveSourcesReturn {
  loading: boolean;
  loadingStage: 'loading' | 'fetching' | 'ready';
  loadingMessage: string;
  loadingProgress: number;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  liveSources: LiveSource[];
  currentSource: LiveSource | null;
  currentSourceRef: MutableRefObject<LiveSource | null>;
  currentChannels: LiveChannel[];
  currentChannel: LiveChannel | null;
  currentChannelRef: MutableRefObject<LiveChannel | null>;
  videoUrl: string;
  isVideoLoading: boolean;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  unsupportedType: string | null;
  setUnsupportedType: Dispatch<SetStateAction<string | null>>;
  isSwitchingSource: boolean;
  groupedChannels: Record<string, LiveChannel[]>;
  selectedGroup: string;
  setSelectedGroup: Dispatch<SetStateAction<string>>;
  activeTab: 'channels' | 'sources';
  setActiveTab: Dispatch<SetStateAction<'channels' | 'sources'>>;
  isChannelListCollapsed: boolean;
  setIsChannelListCollapsed: Dispatch<SetStateAction<boolean>>;
  filteredChannels: LiveChannel[];
  epgData: EpgData | null;
  isEpgLoading: boolean;
  handleSourceChange: (source: LiveSource) => Promise<void>;
  handleChannelChange: (channel: LiveChannel) => Promise<void>;
  handleGroupChange: (group: string) => void;
  scrollToChannel: (channel: LiveChannel) => void;
  router: ReturnType<typeof useRouter>;
}

export function useLiveSources({
  cleanupPlayer,
  channelListRef,
  groupContainerRef,
}: UseLiveSourcesParams): UseLiveSourcesReturn {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ----- State -----
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'loading' | 'fetching' | 'ready'
  >('loading');
  const [loadingMessage, setLoadingMessage] = useState('正在加载直播源...');
  const [error, setError] = useState<string | null>(null);

  const [liveSources, setLiveSources] = useState<LiveSource[]>([]);
  const [currentSource, setCurrentSource] = useState<LiveSource | null>(null);
  const currentSourceRef = useRef<LiveSource | null>(null);
  useEffect(() => {
    currentSourceRef.current = currentSource;
  }, [currentSource]);

  const [currentChannels, setCurrentChannels] = useState<LiveChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<LiveChannel | null>(
    null,
  );
  const currentChannelRef = useRef<LiveChannel | null>(null);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const [needLoadSource] = useState(searchParams.get('source'));
  const [needLoadChannel] = useState(searchParams.get('id'));

  const [videoUrl, setVideoUrl] = useState('');
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [unsupportedType, setUnsupportedType] = useState<string | null>(null);
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);

  const [groupedChannels, setGroupedChannels] = useState<
    Record<string, LiveChannel[]>
  >({});
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'channels' | 'sources'>(
    'channels',
  );
  const [isChannelListCollapsed, setIsChannelListCollapsed] = useState(false);
  const [filteredChannels, setFilteredChannels] = useState<LiveChannel[]>([]);

  const [epgData, setEpgData] = useState<EpgData | null>(null);
  const [isEpgLoading, setIsEpgLoading] = useState(false);
  const epgRequestIdRef = useRef(0);

  // ----- 滚动到频道 -----
  const scrollToChannel = (channel: LiveChannel) => {
    if (!channelListRef.current) return;
    const targetElement = channelListRef.current.querySelector(
      `[data-channel-id="${channel.id}"]`,
    ) as HTMLButtonElement;
    if (targetElement) {
      const container = channelListRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = targetElement.getBoundingClientRect();
      const scrollTop =
        container.scrollTop +
        (elementRect.top - containerRect.top) -
        containerRect.height / 2 +
        elementRect.height / 2;
      container.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
    }
  };

  // ----- 模拟点击分组 -----
  const simulateGroupClick = (group: string, retryCount = 0) => {
    if (!groupContainerRef.current) {
      if (retryCount < 10) {
        setTimeout(() => simulateGroupClick(group, retryCount + 1), 200);
      }
      return;
    }
    const targetButton = groupContainerRef.current.querySelector(
      `[data-group="${group}"]`,
    ) as HTMLButtonElement;
    if (targetButton) {
      setSelectedGroup(group);
      targetButton.click();
    }
  };

  // ----- 获取频道列表 -----
  const fetchChannels = async (source: LiveSource) => {
    try {
      setIsVideoLoading(true);

      const response = await fetch(`/api/live/channels?source=${source.key}`);
      if (!response.ok) throw new Error('获取频道列表失败');

      const result = await response.json();
      if (!result.success) throw new Error(result.error || '获取频道列表失败');

      const channelsData = result.data;
      if (!channelsData || channelsData.length === 0) {
        setCurrentChannels([]);
        setGroupedChannels({});
        setFilteredChannels([]);
        setLiveSources((prev) =>
          prev.map((s) =>
            s.key === source.key ? { ...s, channelNumber: 0 } : s,
          ),
        );
        setIsVideoLoading(false);
        return;
      }

      const channels: LiveChannel[] = channelsData.map((channel: any) => ({
        id: channel.id,
        tvgId: channel.tvgId || channel.name,
        name: channel.name,
        logo: channel.logo,
        group: channel.group || '其他',
        url: channel.url,
      }));

      setCurrentChannels(channels);
      setLiveSources((prev) =>
        prev.map((s) =>
          s.key === source.key ? { ...s, channelNumber: channels.length } : s,
        ),
      );

      // 默认选中频道
      if (channels.length > 0) {
        if (needLoadChannel) {
          const foundChannel = channels.find((c) => c.id === needLoadChannel);
          if (foundChannel) {
            setCurrentChannel(foundChannel);
            setVideoUrl(foundChannel.url);
            setTimeout(() => scrollToChannel(foundChannel), 200);
          } else {
            setCurrentChannel(channels[0]);
            setVideoUrl(channels[0].url);
          }
        } else {
          setCurrentChannel(channels[0]);
          setVideoUrl(channels[0].url);
        }
      }

      // 按分组组织频道
      const grouped = channels.reduce<Record<string, LiveChannel[]>>(
        (acc, channel) => {
          const group = channel.group || '其他';
          if (!acc[group]) acc[group] = [];
          acc[group].push(channel);
          return acc;
        },
        {},
      );

      setGroupedChannels(grouped);

      // 确定目标分组
      let targetGroup = '';
      if (needLoadChannel) {
        const foundChannel = channels.find((c) => c.id === needLoadChannel);
        if (foundChannel) targetGroup = foundChannel.group || '其他';
      }
      if (!targetGroup || !grouped[targetGroup]) {
        targetGroup = Object.keys(grouped)[0] || '';
      }

      setFilteredChannels(targetGroup ? grouped[targetGroup] : channels);

      if (targetGroup) {
        setActiveTab('channels');
        setTimeout(() => simulateGroupClick(targetGroup), 500);
      }

      setIsVideoLoading(false);
    } catch (err) {
      console.error('获取频道列表失败:', err);
      setCurrentChannels([]);
      setGroupedChannels({});
      setFilteredChannels([]);
      setLiveSources((prev) =>
        prev.map((s) =>
          s.key === source.key ? { ...s, channelNumber: 0 } : s,
        ),
      );
      setIsVideoLoading(false);
    }
  };

  // ----- 获取直播源列表 -----
  const fetchLiveSources = async () => {
    try {
      setLoadingStage('fetching');
      setLoadingMessage('正在获取直播源...');

      const response = await fetch('/api/live/sources');
      if (!response.ok) throw new Error('获取直播源失败');

      const result = await response.json();
      if (!result.success) throw new Error(result.error || '获取直播源失败');

      const sources: LiveSource[] = result.data;
      setLiveSources(sources);

      if (sources.length > 0) {
        const firstSource = sources[0];
        if (needLoadSource) {
          const foundSource = sources.find((s) => s.key === needLoadSource);
          if (foundSource) {
            setCurrentSource(foundSource);
            await fetchChannels(foundSource);
          } else {
            setCurrentSource(firstSource);
            await fetchChannels(firstSource);
          }
        } else {
          setCurrentSource(firstSource);
          await fetchChannels(firstSource);
        }
      }

      setLoadingStage('ready');
      setLoadingMessage('准备就绪...');
      setTimeout(() => setLoading(false), 1000);
    } catch (err) {
      console.error('获取直播源失败:', err);
      setLiveSources([]);
      setLoading(false);
    } finally {
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.delete('source');
      newSearchParams.delete('id');
      const newUrl = newSearchParams.toString()
        ? `?${newSearchParams.toString()}`
        : window.location.pathname;
      router.replace(newUrl);
    }
  };

  // ----- 切换直播源 -----
  const handleSourceChange = async (source: LiveSource) => {
    try {
      setIsSwitchingSource(true);
      cleanupPlayer();
      setUnsupportedType(null);
      setEpgData(null);
      setCurrentSource(source);
      await fetchChannels(source);
    } catch (err) {
      console.error('切换直播源失败:', err);
    } finally {
      setIsSwitchingSource(false);
      setActiveTab('channels');
    }
  };

  // ----- 切换频道 -----
  const loadChannelEpg = async (
    channel: LiveChannel,
    source: LiveSource | null,
  ) => {
    const requestId = epgRequestIdRef.current + 1;
    epgRequestIdRef.current = requestId;

    if (!channel.tvgId || !source) {
      setEpgData(null);
      setIsEpgLoading(false);
      return;
    }

    try {
      setIsEpgLoading(true);
      const response = await fetch(
        `/api/live/epg?source=${source.key}&tvgId=${channel.tvgId}`,
      );
      if (!response.ok || epgRequestIdRef.current !== requestId) return;

      const result = await response.json();
      if (epgRequestIdRef.current !== requestId) return;
      if (result.success) {
        setEpgData({
          ...result.data,
          programs: cleanEpgData(result.data.programs),
        });
      }
    } catch (error) {
      if (epgRequestIdRef.current === requestId) {
        console.error('鑾峰彇鑺傜洰鍗曚俊鎭け璐?', error);
      }
    } finally {
      if (epgRequestIdRef.current === requestId) {
        setIsEpgLoading(false);
      }
    }
  };

  const handleChannelChange = async (channel: LiveChannel) => {
    if (isSwitchingSource) return;

    cleanupPlayer();
    setUnsupportedType(null);
    setCurrentChannel(channel);
    setVideoUrl(channel.url);

    setTimeout(() => scrollToChannel(channel), 100);
    void loadChannelEpg(channel, currentSource);
  };

  // ----- 切换分组 -----
  const handleGroupChange = (group: string) => {
    if (isSwitchingSource) return;
    setSelectedGroup(group);
    const filtered = currentChannels.filter((ch) => ch.group === group);
    setFilteredChannels(filtered);

    if (currentChannel && filtered.some((ch) => ch.id === currentChannel.id)) {
      setTimeout(() => scrollToChannel(currentChannel), 100);
    } else if (channelListRef.current) {
      channelListRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // ----- 初始化 -----
  useEffect(() => {
    fetchLiveSources();
  }, []);

  // ----- 加载进度 -----
  const loadingStageOrder = ['loading', 'fetching', 'ready'];
  const loadingStageIndex = loadingStageOrder.indexOf(loadingStage);
  const loadingProgress =
    ((loadingStageIndex + 1) / loadingStageOrder.length) * 100;

  return {
    loading,
    loadingStage,
    loadingMessage,
    loadingProgress,
    error,
    setError,
    liveSources,
    currentSource,
    currentSourceRef,
    currentChannels,
    currentChannel,
    currentChannelRef,
    videoUrl,
    isVideoLoading,
    setIsVideoLoading,
    unsupportedType,
    setUnsupportedType,
    isSwitchingSource,
    groupedChannels,
    selectedGroup,
    setSelectedGroup,
    activeTab,
    setActiveTab,
    isChannelListCollapsed,
    setIsChannelListCollapsed,
    filteredChannels,
    epgData,
    isEpgLoading,
    handleSourceChange,
    handleChannelChange,
    handleGroupChange,
    scrollToChannel,
    router,
  };
}
