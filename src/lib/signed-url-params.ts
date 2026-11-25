export const SIGNED_URL_PARAM_RE =
  /[?&](sign|signature|auth_key|auth|token|expires?|expire|expires_at|hmac|x-amz-signature|security_token|oss_expires|wssecret|wstime|ccode|ksign)=/i;

export function hasSignedUrlParams(rawUrl: string): boolean {
  return rawUrl.includes('?') && SIGNED_URL_PARAM_RE.test(rawUrl);
}

const SIGNED_URL_MAX_FRESH_MS = 5 * 60 * 1000;
// 给解析响应传输、播放器初始化与时钟偏差预留余量。
const SIGNED_URL_EXPIRY_MARGIN_MS = 30 * 1000;

/** The caller checks for signing parameters before applying this TTL. */
export function getSignedUrlFreshMs(rawUrl: string, now = Date.now()): number {
  let expiresAt = now + SIGNED_URL_MAX_FRESH_MS;
  try {
    const url = new URL(rawUrl);
    const params = new URLSearchParams();
    url.searchParams.forEach((value, name) =>
      params.append(name.toLowerCase(), value),
    );
    for (const name of [
      'expires',
      'expire',
      'expires_at',
      't',
      'sign',
      'oss_expires',
      'auth_key',
      'wstime',
    ]) {
      for (const value of params.getAll(name)) {
        if (name === 't' && !/^\d{10,13}$/.test(value)) continue;
        const timestamp =
          name === 'auth_key'
            ? value.split('-', 1)[0]
            : name === 'sign'
              ? (value.match(/:(\d{10,13})$/)?.[1] ?? '')
              : value;
        if (name === 'wstime') {
          if (/^[\da-f]{8}$/i.test(timestamp)) {
            expiresAt = Math.min(
              expiresAt,
              Number.parseInt(timestamp, 16) * 1000 -
                SIGNED_URL_EXPIRY_MARGIN_MS,
            );
          }
        } else if (/^\d{1,13}$/.test(timestamp)) {
          expiresAt = Math.min(
            expiresAt,
            Number(timestamp) * (timestamp.length >= 12 ? 1 : 1000) -
              SIGNED_URL_EXPIRY_MARGIN_MS,
          );
        }
      }
    }
    const date = params
      .get('x-amz-date')
      ?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const duration = params.get('x-amz-expires');
    if (date && duration && /^\d{1,6}$/.test(duration)) {
      const [, year, month, day, hour, minute, second] = date.map(Number);
      expiresAt = Math.min(
        expiresAt,
        Date.UTC(year, month - 1, day, hour, minute, second) +
          Number(duration) * 1000 -
          SIGNED_URL_EXPIRY_MARGIN_MS,
      );
    }
  } catch {
    // Unrecognized URLs still use the short default lifetime.
  }
  return Math.max(0, expiresAt - now);
}
