/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  requireAdmin: jest.fn(),
  isGuardFailure: (value: { response?: unknown }) => Boolean(value.response),
}));
jest.mock('@/lib/db', () => ({
  db: {
    ensureUserProfile: jest.fn().mockResolvedValue({ nickname: 'Author' }),
    getVideoReview: jest.fn(),
    setVideoReview: jest.fn(),
    deleteVideoReview: jest.fn(),
    getMyVideoReviewPage: jest.fn(),
    getMyVideoReviewCount: jest.fn(),
    getMyVideoReviewRatings: jest.fn(),
    getWorkVideoReviewPage: jest.fn(),
    getPublicVideoReviewPage: jest.fn(),
  },
}));

installWebPolyfills();
const { NextResponse } = require('next/server');
const own = require('./route') as typeof import('./route');
const work = require('./work/route') as typeof import('./work/route');
const mine = require('./mine/route') as typeof import('./mine/route');
const admin =
  require('../admin/reviews/route') as typeof import('../admin/reviews/route');
const { requireActiveUser, requireAdmin } = require('@/lib/api-auth');
const { db } = require('@/lib/db');

function request(
  method = 'GET',
  query = '?title=Review%20Demo&year=2026',
  body?: unknown,
): NextRequest {
  return {
    method,
    nextUrl: new URL(`http://localhost/api/reviews${query}`),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireActiveUser.mockResolvedValue({ username: 'author', role: 'user' });
  requireAdmin.mockResolvedValue({ username: 'admin', role: 'admin' });
  db.getVideoReview.mockResolvedValue(videoReview);
  db.setVideoReview.mockResolvedValue(undefined);
  db.deleteVideoReview.mockResolvedValue(undefined);
  db.getWorkVideoReviewPage.mockResolvedValue({
    average: 8,
    count: 1,
    reviews: [],
  });
  db.getPublicVideoReviewPage.mockResolvedValue({
    items: [],
    nextCursor: null,
  });
});

describe('/api/reviews', () => {
  it('uses the authenticated username and normalized server identity', async () => {
    const response = await own.GET(
      request('GET', '?title=%20Review.Demo!%20&year=unknown&username=other'),
    );
    expect(await response.json()).toEqual({ review: videoReview });
    expect(db.getVideoReview).toHaveBeenCalledWith('author', 'reviewdemo', '');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('preserves creation time and updates the matched unknown-year review', async () => {
    db.getVideoReview.mockResolvedValue({ ...videoReview, year: '' });
    const response = await own.PUT(
      request('PUT', '', {
        ...videoReview,
        title: 'Review Demo!',
        title_norm: 'forged',
        created_at: 99999,
        content: ' Good ',
      }),
    );
    expect(response.status).toBe(200);
    expect(db.setVideoReview).toHaveBeenCalledWith(
      'author',
      expect.objectContaining({
        title_norm: 'reviewdemo',
        year: '',
        created_at: 1000,
        content: 'Good',
      }),
    );
  });

  it('assigns server timestamps for new reviews', async () => {
    db.getVideoReview
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(videoReview);
    await own.PUT(request('PUT', '', videoReview));
    const saved = db.setVideoReview.mock.calls[0][1];
    expect(saved.created_at).toBe(saved.updated_at);
    expect(saved.created_at).toBeGreaterThan(1000);
  });

  it.each([
    { title: '' },
    { title: 'x'.repeat(201) },
    { title: '!' },
    { rating: 0 },
    { rating: 11 },
    { rating: 0.9 },
    { rating: 10.1 },
    { rating: 0.99 },
    { rating: 10.01 },
    { rating: NaN },
    { rating: Infinity },
    { rating: -Infinity },
    { rating: '8.6' },
    { rating: undefined },
    { rating: null, content: ' ' },
    { content: 'x'.repeat(5001) },
    { is_public: 1 },
    { source_key: 'x'.repeat(301) },
    { cover: 'x'.repeat(1001) },
    { year: 'x'.repeat(17) },
    { douban_id: -1 },
  ])('rejects invalid input %j', async (extra) => {
    const response = await own.PUT(
      request('PUT', '', { ...videoReview, ...extra }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeTruthy();
    expect(db.setVideoReview).not.toHaveBeenCalled();
  });

  it.each([
    [1, 1],
    [10, 10],
    [1.5, 1.5],
    [8.6, 8.6],
    [8.65, 8.7],
    [8.64, 8.6],
    [null, null],
  ])('saves rating %s as %s', async (rating, expected) => {
    db.getVideoReview
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...videoReview, rating: expected });
    const response = await own.PUT(
      request('PUT', '', { ...videoReview, rating }),
    );
    expect(response.status).toBe(200);
    expect(db.setVideoReview).toHaveBeenCalledWith(
      'author',
      expect.objectContaining({ rating: expected }),
    );
    expect((await response.json()).review.rating).toBe(expected);
  });

  it('returns 400 for malformed JSON', async () => {
    const req = request('PUT');
    (req.json as jest.Mock).mockRejectedValue(new SyntaxError('bad json'));
    expect((await own.PUT(req)).status).toBe(400);
  });

  it('deletes the exact unknown-year record without selecting the newer known year', async () => {
    const records = new Map([
      ['', { ...videoReview, year: '', updated_at: 1000 }],
      ['2026', { ...videoReview, year: '2026', updated_at: 2000 }],
    ]);
    db.getVideoReview.mockResolvedValue(records.get('2026'));
    db.deleteVideoReview.mockImplementationOnce(
      async (_username: string, _title: string, year: string) => {
        records.delete(year);
      },
    );
    const response = await own.DELETE(
      request('DELETE', '?exact=1&title_norm=reviewdemo&year='),
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(db.getVideoReview).not.toHaveBeenCalled();
    expect(db.deleteVideoReview).toHaveBeenCalledWith(
      'author',
      'reviewdemo',
      '',
    );
    expect([...records.keys()]).toEqual(['2026']);
  });

  it('deletes the matched own record and is idempotent when absent', async () => {
    db.getVideoReview.mockResolvedValueOnce({ ...videoReview, year: '' });
    expect(await (await own.DELETE(request('DELETE'))).json()).toEqual({
      ok: true,
    });
    expect(db.deleteVideoReview).toHaveBeenCalledWith(
      'author',
      'reviewdemo',
      '',
    );
    db.getVideoReview.mockResolvedValueOnce(null);
    await own.DELETE(request('DELETE'));
    expect(db.deleteVideoReview).toHaveBeenCalledTimes(1);
  });

  it.each(['GET', 'PUT', 'DELETE'] as const)(
    'enforces active-user guard for %s',
    async (method) => {
      requireActiveUser.mockResolvedValue({
        response: NextResponse.json({ error: '请先登录' }, { status: 401 }),
      });
      expect((await own[method](request(method))).status).toBe(401);
      expect(db.getVideoReview).not.toHaveBeenCalled();
    },
  );
});

describe('/api/reviews/mine', () => {
  it('returns all own public and private reviews in storage order without caching', async () => {
    const reviews = [
      { ...videoReview, rating: 8.7, is_public: false, updated_at: 3000 },
      { ...videoReview, title_norm: 'anotherwork', updated_at: 2000 },
    ];
    const page = {
      items: reviews,
      nextCursor: null,
      total: 2,
      counts: { all: 2, public: 1, private: 1, text: 0 },
    };
    db.getMyVideoReviewPage.mockResolvedValueOnce(page);
    const req = request('GET', '/mine?username=other');
    const response = await mine.GET(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(requireActiveUser).toHaveBeenCalledWith(req, {
      unauthorizedMessage: '请先登录',
      includeUserStateCode: false,
    });
    expect(db.getMyVideoReviewPage).toHaveBeenCalledWith('author', {
      cursor: undefined,
      q: '',
      filter: 'all',
      sort: 'updated',
    });
  });

  it('returns an empty list when the user has no reviews', async () => {
    const page = {
      items: [],
      nextCursor: null,
      total: 0,
      counts: { all: 0, public: 0, private: 0, text: 0 },
    };
    db.getMyVideoReviewPage.mockResolvedValueOnce(page);
    expect(await (await mine.GET(request('GET', '/mine'))).json()).toEqual(
      page,
    );
  });

  it('uses dedicated own count and lightweight rating reads', async () => {
    db.getMyVideoReviewCount.mockResolvedValueOnce(17);
    db.getMyVideoReviewRatings.mockResolvedValueOnce([
      { title_norm: 'reviewdemo', year: '', rating: null },
    ]);
    expect(
      await (await mine.GET(request('GET', '/mine?view=count'))).json(),
    ).toEqual({ count: 17 });
    expect(
      await (await mine.GET(request('GET', '/mine?view=ratings'))).json(),
    ).toEqual({
      ratings: [{ title_norm: 'reviewdemo', year: '', rating: null }],
    });
    expect(db.getMyVideoReviewPage).not.toHaveBeenCalled();
    expect(db.getMyVideoReviewRatings).toHaveBeenCalledWith('author');
  });

  it.each([
    '?cursor=broken',
    '?filter=invalid',
    '?sort=invalid',
    `?q=${'x'.repeat(201)}`,
  ])('rejects invalid own page parameters %s', async (query) => {
    expect((await mine.GET(request('GET', `/mine${query}`))).status).toBe(400);
    expect(db.getMyVideoReviewPage).not.toHaveBeenCalled();
  });

  it.each([401, 403])('enforces the active-user guard (%s)', async (status) => {
    requireActiveUser.mockResolvedValueOnce({
      response: NextResponse.json({ error: '访问受限' }, { status }),
    });
    expect((await mine.GET(request('GET', '/mine'))).status).toBe(status);
    expect(db.getMyVideoReviewPage).not.toHaveBeenCalled();
  });

  it('hides storage errors', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.getMyVideoReviewPage.mockRejectedValueOnce(
      new Error('database-password'),
    );
    try {
      const response = await mine.GET(request('GET', '/mine'));
      expect(response.status).toBe(500);
      expect((await response.json()).error).not.toContain('database-password');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('/api/reviews/work', () => {
  it('preserves the numeric average precision', async () => {
    db.getWorkVideoReviewPage.mockResolvedValueOnce({
      average: 8.65,
      count: 2,
      reviews: [],
    });
    expect(await (await work.GET(request())).json()).toEqual({
      average: 8.65,
      count: 2,
      reviews: [],
    });
  });
  it('returns work summary using normalized title and year', async () => {
    expect(await (await work.GET(request())).json()).toEqual({
      average: 8,
      count: 1,
      reviews: [],
    });
    expect(db.getWorkVideoReviewPage).toHaveBeenCalledWith(
      'reviewdemo',
      '2026',
      'author',
      undefined,
    );
  });
  it('requires login and rejects missing titles', async () => {
    expect((await work.GET(request('GET', ''))).status).toBe(400);
    requireActiveUser.mockResolvedValue({
      response: NextResponse.json({ error: '用户已被封禁' }, { status: 403 }),
    });
    expect((await work.GET(request())).status).toBe(403);
    expect(db.getWorkVideoReviewPage).not.toHaveBeenCalled();
  });
});

describe('/api/admin/reviews', () => {
  it('passes literal search text to the public-only page query', async () => {
    const response = await admin.GET(request('GET', '?q=%25_'));
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(db.getPublicVideoReviewPage).toHaveBeenCalledWith(undefined, '%_');
  });
  it('rejects malformed cursors and oversized keywords', async () => {
    expect((await admin.GET(request('GET', '?cursor=broken'))).status).toBe(
      400,
    );
    expect(
      (await admin.GET(request('GET', `?q=${'x'.repeat(201)}`))).status,
    ).toBe(400);
    expect(db.getPublicVideoReviewPage).not.toHaveBeenCalled();
  });
  it('deletes only the exact public record', async () => {
    expect(
      await (
        await admin.DELETE(
          request('DELETE', '', {
            username: 'AUTHOR',
            title_norm: 'reviewdemo',
            year: '',
          }),
        )
      ).json(),
    ).toEqual({ ok: true });
    expect(db.deleteVideoReview).toHaveBeenCalledWith(
      'author',
      'reviewdemo',
      '',
      true,
    );
  });
  it('validates deletion keys', async () => {
    expect(
      (await admin.DELETE(request('DELETE', '', { username: 'author' })))
        .status,
    ).toBe(400);
    expect(db.deleteVideoReview).not.toHaveBeenCalled();
  });
  it.each(['GET', 'DELETE'] as const)(
    'requires admin access for %s',
    async (method) => {
      requireAdmin.mockResolvedValue({
        response: NextResponse.json({ error: '权限不足' }, { status: 403 }),
      });
      expect((await admin[method](request(method))).status).toBe(403);
      expect(db.getPublicVideoReviewPage).not.toHaveBeenCalled();
      expect(db.deleteVideoReview).not.toHaveBeenCalled();
    },
  );
  it('hides internal errors', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.getPublicVideoReviewPage.mockRejectedValueOnce(
      new Error('database-password'),
    );
    const response = await admin.GET(request());
    expect(response.status).toBe(500);
    expect((await response.json()).error).not.toContain('database-password');
    spy.mockRestore();
  });
});
