import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useEffect,
  useRef,
} from 'react';

import type ArtplayerType from 'artplayer';

import type { LiveChannel, LiveSource } from '../types';
import {
  createHlsLoaderClass,
  destroyManagedHls,
  getManagedVideo,
  getPlayerModules,
  runManagedVideoCleanup,
} from '@/lib/player-runtime';
import {
  createArtPlayerConfig,
  createHlsConfig,
  configureArtplayerStatics,
  ensureVideoSource,
  handleHlsFatalError,
} from '@/lib/player-utils';

const LIVE_PRECHECK_CACHE_TTL_MS = 5 * 60 * 1000;
const livePrecheckCache = new Map<
  string,
  { type: string; expiresAt: number }
>();

function getLivePrecheckCacheKey(sourceKey: string, url: string): string {
  return `${sourceKey}::${url}`;
}

function isLikelyM3U8(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return /\.m3u8(?:$|[?#])/i.test(url);
  }
}

function setLivePrecheckCache(sourceKey: string, url: string, type: string) {
  livePrecheckCache.set(getLivePrecheckCacheKey(sourceKey, url), {
    type,
    expiresAt: Date.now() + LIVE_PRECHECK_CACHE_TTL_MS,
  });
}

async function resolveLiveStreamType(
  videoUrl: string,
  sourceKey: string,
): Promise<string> {
  const cacheKey = getLivePrecheckCacheKey(sourceKey, videoUrl);
  const cached = livePrecheckCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.type;
  }
  if (cached) {
    livePrecheckCache.delete(cacheKey);
  }

  if (isLikelyM3U8(videoUrl)) {
    setLivePrecheckCache(sourceKey, videoUrl, 'm3u8');
    return 'm3u8';
  }

  const precheckUrl = `/api/live/precheck?url=${encodeURIComponent(videoUrl)}&icetv-source=${sourceKey}`;
  const precheckResponse = await fetch(precheckUrl);
  if (!precheckResponse.ok) {
    console.error('Live precheck failed:', precheckResponse.statusText);
    return 'm3u8';
  }

  const precheckResult = await precheckResponse.json();
  const type = precheckResult.success ? precheckResult.type : 'm3u8';
  setLivePrecheckCache(sourceKey, videoUrl, type);
  return type;
}

function cleanupPlayer(artPlayerRef: MutableRefObject<ArtplayerType | null>) {
  if (!artPlayerRef.current) return;

  try {
    const video = artPlayerRef.current.video;
    if (video) {
      runManagedVideoCleanup(video);
      video.pause();
      video.src = '';
      video.load();
    }
    destroyManagedHls(video);
    if (video?.flv) {
      try {
        video.flv.unload?.();
        video.flv.destroy();
        video.flv = null;
      } catch (flvError) {
        console.warn('FLV cleanup failed:', flvError);
        video.flv = null;
      }
    }

    const player = artPlayerRef.current as unknown as {
      off(event: string): void;
      destroy(): void;
      video: HTMLVideoElement;
    };
    player.off('ready');
    player.off('loadstart');
    player.off('loadeddata');
    player.off('canplay');
    player.off('waiting');
    player.off('error');
    artPlayerRef.current.destroy();
    artPlayerRef.current = null;
  } catch (err) {
    console.warn('Live player cleanup failed:', err);
    artPlayerRef.current = null;
  }
}

interface UseLivePlayerParams {
  videoUrl: string;
  currentChannel: LiveChannel | null;
  currentSourceRef: MutableRefObject<LiveSource | null>;
  loading: boolean;
  artRef: MutableRefObject<HTMLDivElement | null>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setUnsupportedType: Dispatch<SetStateAction<string | null>>;
}

export function useLivePlayer({
  videoUrl,
  currentChannel,
  currentSourceRef,
  loading,
  artRef,
  setError,
  setIsVideoLoading,
  setUnsupportedType,
}: UseLivePlayerParams) {
  const artPlayerRef = useRef<ArtplayerType | null>(null);
  const loadedUrlRef = useRef('');

  const doCleanup = () => {
    setUnsupportedType(null);
    loadedUrlRef.current = '';
    cleanupPlayer(artPlayerRef);
  };

  useEffect(() => {
    let cancelled = false;

    const preload = async () => {
      if (!videoUrl || !artRef.current || !currentChannel) {
        return;
      }

      try {
        const { Artplayer, Hls } = await getPlayerModules();

        if (cancelled || !artRef.current) return;

        const sourceKey = currentSourceRef.current?.key || '';
        const type = await resolveLiveStreamType(videoUrl, sourceKey);

        if (cancelled || !artRef.current) return;

        const targetUrl = `/api/proxy/m3u8?url=${encodeURIComponent(videoUrl)}&icetv-source=${sourceKey}&icetv-live=1`;

        if (type !== 'm3u8') {
          loadedUrlRef.current = '';
          cleanupPlayer(artPlayerRef);
          setUnsupportedType(type);
          setIsVideoLoading(false);
          return;
        }

        setUnsupportedType(null);

        if (artPlayerRef.current && loadedUrlRef.current === targetUrl) {
          return;
        }

        const LiveHlsLoader = createHlsLoaderClass(
          Hls.DefaultConfig.loader as unknown as new (config: unknown) => {
            load: (...args: unknown[]) => void;
          },
          {
            rewriteContext: (context) => {
              const currentUrl = context.url;
              if (!currentUrl) return;

              const isLiveDirectConnect =
                typeof window !== 'undefined' &&
                localStorage.getItem('liveDirectConnect') === 'true';

              try {
                const nextUrl = new URL(currentUrl, window.location.origin);
                nextUrl.searchParams.set('icetv-source', sourceKey);
                if (
                  isLiveDirectConnect &&
                  (context.type === 'manifest' || context.type === 'level')
                ) {
                  nextUrl.searchParams.set('allowCORS', 'true');
                }
                context.url = nextUrl.toString();
              } catch {
                const separator = currentUrl.includes('?') ? '&' : '?';
                let nextUrl = `${currentUrl}${separator}icetv-source=${encodeURIComponent(sourceKey)}`;
                if (
                  isLiveDirectConnect &&
                  (context.type === 'manifest' || context.type === 'level')
                ) {
                  nextUrl = `${nextUrl}&allowCORS=true`;
                }
                context.url = nextUrl;
              }
            },
          },
        );

        const m3u8Loader = (video: HTMLVideoElement, url: string) => {
          const managedVideo = getManagedVideo(video);
          runManagedVideoCleanup(managedVideo);
          destroyManagedHls(managedVideo);

          const hls = new Hls({
            ...createHlsConfig({
              lowLatencyMode: true,
              maxBufferLength: 30,
              backBufferLength: 30,
            }),
            loader: LiveHlsLoader as unknown as typeof Hls.DefaultConfig.loader,
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          managedVideo.hls = hls;

          hls.on(Hls.Events.ERROR, function (_event: any, data: any) {
            console.error('HLS Error:', _event, data);
            if (data.fatal) {
              handleHlsFatalError(hls, data.type, Hls.ErrorTypes);
            }
          });
        };

        if (artPlayerRef.current) {
          setIsVideoLoading(true);
          artPlayerRef.current.switch = targetUrl;
          if (artPlayerRef.current.video) {
            ensureVideoSource(artPlayerRef.current.video, targetUrl);
          }
          loadedUrlRef.current = targetUrl;
          return;
        }

        const customType = { m3u8: m3u8Loader };
        configureArtplayerStatics(Artplayer);

        artPlayerRef.current = new Artplayer({
          container: artRef.current,
          url: targetUrl,
          ...createArtPlayerConfig({
            isLive: true,
            moreVideoAttr: { preload: 'metadata' },
          }),
          type,
          customType,
        });
        loadedUrlRef.current = targetUrl;

        const ap = artPlayerRef.current as unknown as {
          on(event: string, callback: (...args: unknown[]) => void): void;
          video: HTMLVideoElement;
        };
        ap.on('ready', () => {
          setError(null);
          setIsVideoLoading(false);
        });
        ap.on('loadstart', () => {
          setIsVideoLoading(true);
        });
        ap.on('loadeddata', () => {
          setIsVideoLoading(false);
        });
        ap.on('canplay', () => {
          setIsVideoLoading(false);
        });
        ap.on('waiting', () => {
          setIsVideoLoading(true);
        });
        ap.on('error', (err: unknown) => {
          console.error('Live player error:', err);
        });

        if (artPlayerRef.current?.video) {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            targetUrl,
          );
        }
      } catch (err) {
        console.error('Live player init failed:', err);
      }
    };
    preload();

    return () => {
      cancelled = true;
    };
  }, [videoUrl, currentChannel, loading]);

  useEffect(() => {
    return () => {
      loadedUrlRef.current = '';
      cleanupPlayer(artPlayerRef);
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      loadedUrlRef.current = '';
      cleanupPlayer(artPlayerRef);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      loadedUrlRef.current = '';
      cleanupPlayer(artPlayerRef);
    };
  }, []);

  return { artPlayerRef, cleanupPlayer: doCleanup };
}
