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

export function getHlsResourceRetryDelay(data: any): number | null {
  const status = getHlsErrorStatus(data);
  if (status !== 429 && status !== 503) return null;
  const details = data?.networkDetails;
  const header = (name: string): string | null => {
    try {
      return (
        details?.getResponseHeader?.(name) ??
        details?.headers?.get?.(name) ??
        null
      );
    } catch {
      return null;
    }
  };
  if (header('x-icetv-resource-limited') !== '1') return null;
  const raw = header('retry-after');
  const seconds = raw === null ? NaN : Number(raw);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(raw || '') - Date.now();
  return Math.min(
    300_000,
    Math.max(1000, Number.isFinite(delay) ? delay : 1000),
  );
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
