export const SIGNED_URL_PARAM_RE =
  /[?&](sign|signature|auth_key|auth|token|expires?|expire|hmac|x-amz-signature|security_token|oss_expires|wssecret|wstime|ccode|ksign)=/i;

export function hasSignedUrlParams(rawUrl: string): boolean {
  return rawUrl.includes('?') && SIGNED_URL_PARAM_RE.test(rawUrl);
}
