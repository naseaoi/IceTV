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

  it('giri 搜索会跳过已禁用原域名并按候选域名回退', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://ani.girigirilove.com')) {
        return createJsonResponse({
          list: [{ id: 101, name: 'Fallback Anime', pic: '/fallback.jpg' }],
        });
      }
      return createJsonResponse({}, false);
    });

    const results = await searchFirstPageFromApi(
      createGiriSite('https://anime.girigirilove.com'),
      'fallback',
    );
    const urls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(urls).toEqual([
      'https://anime.girigirilove.icu/index.php/ajax/suggest?mid=1&wd=fallback',
      'https://ani.girigirilove.com/index.php/ajax/suggest?mid=1&wd=fallback',
    ]);
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: '101',
        poster: 'https://ani.girigirilove.com/fallback.jpg',
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
      createGiriSite('https://anime.girigirilove.com'),
      '100',
    );
    const urls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(urls).not.toContain('https://anime.girigirilove.com/GV100/');
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
});
