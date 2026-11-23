import {
  getSignedUrlFreshMs,
  hasSignedUrlParams,
} from '@/lib/signed-url-params';

const now = Date.UTC(2026, 10, 23, 12);
const expires = Math.floor(now / 1000) + 120;

it.each([
  `sign=hash&t=${expires}`,
  `sign=hash%3D%3A${expires}`,
  `expires_at=${expires}`,
  `expires_at=${expires * 1000}`,
  `expires=${expires}`,
  `auth_key=${expires}-random-user-hash`,
  `wssecret=hash&wstime=${expires.toString(16)}`,
  'x-amz-signature=hash&x-amz-date=20261123T120000Z&x-amz-expires=120',
])('签名地址 %s 的缓存预留 30 秒有效期余量', (query) => {
  const url = `https://cdn.example/video.mp4?${query}`;
  expect(hasSignedUrlParams(url)).toBe(true);
  expect(getSignedUrlFreshMs(url, now)).toBe(90_000);
});

it.each([-120, 0, 20, 30])('已过期或剩余 %s 秒时不缓存', (seconds) => {
  const t = Math.floor(now / 1000) + seconds;
  expect(
    getSignedUrlFreshMs(`https://cdn.example/1.mp4?sign=x&t=${t}`, now),
  ).toBe(0);
});

it('多种到期字段并存时使用最早期限，长期与未知签名最多缓存五分钟', () => {
  expect(
    getSignedUrlFreshMs(
      `https://cdn.example/1.mp4?sign=x&t=${expires}&expires_at=${expires - 30}`,
      now,
    ),
  ).toBe(60_000);
  for (const query of [
    `sign=x&t=${expires + 3600}`,
    'sign=unknown',
    'sign=x&t=1',
    'sign=x&t=invalid',
  ]) {
    expect(getSignedUrlFreshMs(`https://cdn.example/1.mp4?${query}`, now)).toBe(
      300_000,
    );
  }
  expect(hasSignedUrlParams('https://cdn.example/1.mp4?t=1')).toBe(false);
});
