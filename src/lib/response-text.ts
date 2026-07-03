export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  label = '响应体',
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new Error(`${label}超过大小限制`);
    }
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`${label}超过大小限制`);
    }
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error(`${label}超过大小限制`);
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}
