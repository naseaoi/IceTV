import { ensureVideoSource } from '@/lib/player-utils';

function sourceUrls(video: HTMLVideoElement) {
  return Array.from(video.getElementsByTagName('source')).map((s) => s.src);
}

describe('ensureVideoSource', () => {
  it('保留 hls.js 的 blob 媒体源在最前，播放地址只作为末尾备选', () => {
    const video = document.createElement('video');
    const mediaSource = document.createElement('source');
    mediaSource.src = 'blob:http://localhost/media-source';
    video.appendChild(mediaSource);

    ensureVideoSource(video, 'http://localhost/a.m3u8');
    ensureVideoSource(video, 'http://localhost/b.m3u8');

    expect(sourceUrls(video)).toEqual([
      'blob:http://localhost/media-source',
      'http://localhost/b.m3u8',
    ]);
    expect(video.disableRemotePlayback).toBe(false);
  });

  it('没有 blob 媒体源时只保留一个当前地址', () => {
    const video = document.createElement('video');

    ensureVideoSource(video, 'http://localhost/a.mp4');
    ensureVideoSource(video, 'http://localhost/a.mp4');

    expect(sourceUrls(video)).toEqual(['http://localhost/a.mp4']);
  });
});
