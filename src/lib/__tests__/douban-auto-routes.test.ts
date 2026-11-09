import { getDoubanImageCandidates } from '../douban-image-url';
import {
  readDoubanFallbackRoute,
  recordDoubanRouteResult,
  rememberDoubanFallbackRoute,
} from '../douban-route-memory';

const raw = 'https://img3.doubanio.com/view/photo/m/public/p1.jpg';

describe('getDoubanImageCandidates in auto mode', () => {
  it('tries the Tencent and Ali mirrors before the server for signed-in users', () => {
    expect(
      getDoubanImageCandidates(raw, 'auto', { isAuthenticated: true }),
    ).toEqual([
      {
        url: 'https://img.doubanio.cmliussss.net/view/photo/m/public/p1.jpg',
        route: 'cmliussss-cdn-tencent',
      },
      {
        url: 'https://img.doubanio.cmliussss.com/view/photo/m/public/p1.jpg',
        route: 'cmliussss-cdn-ali',
      },
      {
        url: `/api/image-proxy?url=${encodeURIComponent(raw)}`,
        route: 'server',
      },
    ]);
  });

  it('leaves the server out for guests, including guests set to server', () => {
    for (const proxyType of ['auto', 'server']) {
      const routes = getDoubanImageCandidates(raw, proxyType, {
        isAuthenticated: false,
      }).map((candidate) => candidate.route);
      expect(routes).toEqual(['cmliussss-cdn-tencent', 'cmliussss-cdn-ali']);
    }
  });

  it('starts with the remembered route', () => {
    const routes = getDoubanImageCandidates(raw, 'auto', {
      isAuthenticated: true,
      preferredRoute: 'cmliussss-cdn-ali',
    }).map((candidate) => candidate.route);
    expect(routes).toEqual([
      'cmliussss-cdn-ali',
      'cmliussss-cdn-tencent',
      'server',
    ]);
  });

  it('recovers fallbacks from mirror URLs rendered by the server', () => {
    const [first, second, third] = getDoubanImageCandidates(
      'https://img.doubanio.cmliussss.net/view/photo/m/public/p1.jpg',
      'auto',
      { isAuthenticated: true },
    );
    expect(first.url).toBe(
      'https://img.doubanio.cmliussss.net/view/photo/m/public/p1.jpg',
    );
    expect(second.url).toBe(
      'https://img.doubanio.cmliussss.com/view/photo/m/public/p1.jpg',
    );
    expect(third.url).toContain(
      encodeURIComponent(
        'https://img1.doubanio.com/view/photo/m/public/p1.jpg',
      ),
    );
  });

  it('keeps a single address for fixed routes', () => {
    expect(
      getDoubanImageCandidates(raw, 'direct', { isAuthenticated: true }),
    ).toEqual([{ url: raw }]);
  });
});

describe('douban route memory', () => {
  const routes = ['zwei', 'tencent', 'server'];

  beforeEach(() => window.sessionStorage.clear());

  it('remembers a fallback for five minutes', () => {
    recordDoubanRouteResult('data', routes, 'zwei', 1, true);
    expect(readDoubanFallbackRoute('data')).toBe('tencent');
    expect(
      readDoubanFallbackRoute('data', Date.now() + 5 * 60 * 1000 + 1),
    ).toBeNull();
  });

  it('does not remember the default route or first-try successes', () => {
    recordDoubanRouteResult('data', routes, 'zwei', 0, true);
    expect(readDoubanFallbackRoute('data')).toBeNull();

    rememberDoubanFallbackRoute('data', 'tencent');
    recordDoubanRouteResult('data', ['tencent', 'zwei'], 'zwei', 1, true);
    expect(readDoubanFallbackRoute('data')).toBeNull();
  });

  it('forgets a remembered route once it fails', () => {
    rememberDoubanFallbackRoute('image', 'ali');
    recordDoubanRouteResult('image', ['ali', 'tencent'], 'tencent', 0, false);
    expect(readDoubanFallbackRoute('image')).toBeNull();
  });
});
