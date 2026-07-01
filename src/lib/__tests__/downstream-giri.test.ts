import type { ApiSite } from '@/lib/config';
import { getDetailFromApi, searchFirstPageFromApi } from '@/lib/downstream';

const originalFetch = global.fetch;

function createJsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response;
}

function createTextResponse(data: string, ok = true): Response {
  return {
    ok,
    text: async () => data,
  } as Response;
}

function createGiriSite(api: string): ApiSite {
  return {
    key: 'giri',
    name: 'Giri',
    api,
  };
}

function createGenericSite(): ApiSite {
  return {
    key: 'generic-mp4',
    name: 'Generic MP4',
    api: 'https://api.example',
  };
}

describe('downstream giri source', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('识别 icu 域名并使用 giri 搜索入口', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      createJsonResponse({
        list: [{ id: 100, name: 'Test Anime', pic: '/cover.jpg' }],
      }),
    );

    const results = await searchFirstPageFromApi(
      createGiriSite('https://anime.girigirilove.icu'),
      'test',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://anime.girigirilove.icu/index.php/ajax/suggest?mid=1&wd=test',
      expect.any(Object),
    );
    expect(results).toEqual([
      expect.objectContaining({
        id: '100',
        title: 'Test Anime',
        poster: 'https://anime.girigirilove.icu/cover.jpg',
        source: 'giri',
      }),
    ]);
  });

  it('giri 搜索以后台配置域名为准', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://anime.girigirilove.icu')) {
        return createJsonResponse({
          list: [{ id: 101, name: 'Fallback Anime', pic: '/fallback.jpg' }],
        });
      }
      return createJsonResponse({}, false);
    });

    const results = await searchFirstPageFromApi(
      createGiriSite('https://anime.girigirilove.icu'),
      'fallback',
    );
    const urls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(urls).toEqual([
      'https://anime.girigirilove.icu/index.php/ajax/suggest?mid=1&wd=fallback',
    ]);
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: '101',
        poster: 'https://anime.girigirilove.icu/fallback.jpg',
      }),
    );
  });

  it('giri 详情会沿用成功域名获取播放页', async () => {
    const detailHtml = `
      <html>
        <h3 class="slide-info-title">Detail Anime</h3>
        <div id="height_limit">简介</div>
        <em class="cor4">年份：</em> 2026
        <div class="detail-pic"><img data-src="/detail.jpg"></div>
        <div class="anthology-list-box">
          <a href="/playGV100-1-1/">第1集</a>
        </div>
      </html>
    `;
    const playHtml = `
      <html>
        <a class="player-title-link">Detail Anime</a>
        <div class="small-text">播放简介</div>
        <div class="cor4" title="2026"></div>
        <div class="this-pic"><img data-src="/play.jpg"></div>
        <script>
          var player_aaaa={"encrypt":0,"url":"https://cdn.example/video.m3u8"};
        </script>
      </html>
    `;
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://anime.girigirilove.icu/GV100/') {
        return createTextResponse(detailHtml);
      }
      if (url === 'https://anime.girigirilove.icu/playGV100-1-1/') {
        return createTextResponse(playHtml);
      }
      return createTextResponse('', false);
    });

    const detail = await getDetailFromApi(
      createGiriSite('https://anime.girigirilove.icu'),
      '100',
    );
    const urls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(urls).toContain('https://anime.girigirilove.icu/GV100/');
    expect(urls).toContain('https://anime.girigirilove.icu/playGV100-1-1/');
    expect(detail).toEqual(
      expect.objectContaining({
        title: 'Detail Anime',
        poster: 'https://anime.girigirilove.icu/detail.jpg',
        episodes: ['https://cdn.example/video.m3u8'],
        episodes_titles: ['第1集'],
      }),
    );
  });

  it('giri 详情会保留播放页返回的 mp4 地址', async () => {
    const detailHtml = `
      <html>
        <h3 class="slide-info-title">MP4 Anime</h3>
        <div class="anthology-list-box">
          <a href="/playGV200-1-1/">第1集</a>
        </div>
      </html>
    `;
    const playHtml = `
      <html>
        <script>
          var player_aaaa={"encrypt":0,"url":"https://cdn.example/video.mp4?token=abc"};
        </script>
      </html>
    `;
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://ani.girigirilove.com/GV200/') {
        return createTextResponse(detailHtml);
      }
      if (url === 'https://ani.girigirilove.com/playGV200-1-1/') {
        return createTextResponse(playHtml);
      }
      return createTextResponse('', false);
    });

    const detail = await getDetailFromApi(
      createGiriSite('https://ani.girigirilove.com'),
      '200',
    );

    expect(detail.episodes).toEqual([
      'https://cdn.example/video.mp4?token=abc',
    ]);
    expect(detail.episodes_titles).toEqual(['第1集']);
  });

  it('通用 CMS 搜索会保留 mp4 播放地址', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      createJsonResponse({
        pagecount: 1,
        list: [
          {
            vod_id: 300,
            vod_name: 'MP4 Video',
            vod_pic: 'https://cdn.example/poster.jpg',
            vod_play_url:
              '第1集$https://cdn.example/video.mp4?token=abc#第2集$https://cdn.example/video.m3u8',
            vod_year: '2026',
            vod_content: '',
          },
        ],
      }),
    );

    const results = await searchFirstPageFromApi(createGenericSite(), 'mp4');

    expect(results[0]).toEqual(
      expect.objectContaining({
        id: '300',
        episodes: [
          'https://cdn.example/video.mp4?token=abc',
          'https://cdn.example/video.m3u8',
        ],
        episodes_titles: ['第1集', '第2集'],
      }),
    );
  });
});
