export class ResponseSizeLimitError extends Error {
  constructor(public readonly maxBytes: number) {
    super('Response body too large');
    this.name = 'ResponseSizeLimitError';
  }
}

export function parseContentLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (!raw) {
    return null;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function assertContentLength(headers: Headers, maxBytes: number): void {
  const contentLength = parseContentLength(headers);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new ResponseSizeLimitError(maxBytes);
  }
}

export async function readArrayBufferLimited(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  assertContentLength(response.headers, maxBytes);

  if (!response.body) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ResponseSizeLimitError(maxBytes);
    }

    chunks.push(value);
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output.buffer;
}

export async function readTextLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const buffer = await readArrayBufferLimited(response, maxBytes);
  return new TextDecoder().decode(buffer);
}

export function createLimitedReadableStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): ReadableStream<Uint8Array> | null {
  if (!stream) {
    return stream;
  }

  const reader = stream.getReader();
  let total = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        controller.error(new ResponseSizeLimitError(maxBytes));
        return;
      }

      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
