export type HlsErrorTypes = {
  NETWORK_ERROR: string;
  MEDIA_ERROR: string;
};

export function getHlsErrorStatus(data: any): number | undefined {
  const candidates = [
    data?.response?.code,
    data?.response?.status,
    data?.networkDetails?.status,
  ];
  for (const item of candidates) {
    const status = Number(item);
    if (Number.isFinite(status) && status > 0) {
      return status;
    }
  }
  return undefined;
}

export function getHlsErrorText(data: any): string {
  return [
    data?.type,
    data?.details,
    data?.error?.message,
    data?.response?.text,
    data?.networkDetails?.statusText,
  ]
    .filter(Boolean)
    .join(' ');
}

export function resolveHlsSourceFailureReason(
  data: any,
  usingServerProxy: boolean,
  errorTypes: HlsErrorTypes,
): string {
  const status = getHlsErrorStatus(data);
  const text = getHlsErrorText(data).toLowerCase();
  if (status && status >= 500 && usingServerProxy) return `proxy-${status}`;
  if (text.includes('err_connection_closed')) return 'connection-closed';
  if (text.includes('connection_closed')) return 'connection-closed';
  if (!usingServerProxy && data?.type === errorTypes.NETWORK_ERROR) {
    return 'cors';
  }
  if (usingServerProxy && data?.type === errorTypes.NETWORK_ERROR) {
    return 'proxy-error';
  }
  if (text.includes('frag') || text.includes('segment')) {
    return 'segment-failed';
  }
  if (text.includes('manifest')) return 'manifest-failed';
  if (text.includes('level')) return 'playlist-failed';
  if (data?.type === errorTypes.MEDIA_ERROR) return 'hls-media';
  if (data?.type === errorTypes.NETWORK_ERROR) return 'hls-network';
  return 'hls-fatal';
}
