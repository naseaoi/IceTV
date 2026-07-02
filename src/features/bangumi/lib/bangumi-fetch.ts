import { Buffer } from 'node:buffer';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect, Socket } from 'node:net';
import { connect as tlsConnect, TLSSocket } from 'node:tls';

import {
  fetchJsonThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';

export type BangumiFetchInit = RequestInit & {
  timeoutMs?: number;
};

const BANGUMI_DEFAULT_TIMEOUT_MS = 25000;
const BANGUMI_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export async function fetchBangumiCalendarJson(
  targetUrl: URL,
  init: BangumiFetchInit,
): Promise<unknown> {
  const request = fetchBangumiCalendarJsonWithFallback(targetUrl, init);

  if (!init.timeoutMs) {
    return await request;
  }

  return await withTimeout(request, init.timeoutMs);
}

async function fetchBangumiCalendarJsonWithFallback(
  targetUrl: URL,
  init: BangumiFetchInit,
): Promise<unknown> {
  const proxyUrl = getProxyUrlForTarget(targetUrl);

  if (proxyUrl) {
    try {
      return await fetchJsonThroughProxy(targetUrl, proxyUrl, {
        timeoutMs: init.timeoutMs ?? BANGUMI_DEFAULT_TIMEOUT_MS,
        userAgent: 'IceTV',
      });
    } catch {}
  }

  for (const socksProxyUrl of getSocksProxyUrls()) {
    try {
      return await fetchBangumiCalendarThroughSocksProxy(
        targetUrl,
        socksProxyUrl,
        init,
      );
    } catch {
      continue;
    }
  }

  return await fetchBangumiCalendarDirect(targetUrl, init);
}

async function fetchBangumiCalendarDirect(
  targetUrl: URL,
  init: BangumiFetchInit,
): Promise<unknown> {
  const { timeoutMs, ...requestInit } = init;
  const headers = createBangumiRequestHeaders(requestInit);

  return await new Promise((resolve, reject) => {
    const request = (
      targetUrl.protocol === 'http:' ? httpRequest : httpsRequest
    )(
      targetUrl,
      {
        method: requestInit.method || 'GET',
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        const status = response.statusCode || 0;

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`获取 Bangumi 日历失败: ${status}`));
          return;
        }

        let totalBytes = 0;
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => {
          totalBytes += chunk.byteLength;

          if (totalBytes > BANGUMI_MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Bangumi 日历响应过大'));
            return;
          }

          chunks.push(chunk);
        });
        response.once('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('Bangumi 日历格式异常'));
          }
        });
        response.once('error', reject);
      },
    );

    const abortRequest = () => {
      request.destroy(new Error('Bangumi 日历请求取消'));
    };
    const cleanup = () => {
      requestInit.signal?.removeEventListener('abort', abortRequest);
    };

    request.setTimeout(timeoutMs ?? BANGUMI_DEFAULT_TIMEOUT_MS, () => {
      request.destroy(new Error('Bangumi 日历请求超时'));
    });
    request.once('error', (error) => {
      cleanup();
      reject(error);
    });
    request.once('close', cleanup);

    if (requestInit.signal?.aborted) {
      abortRequest();
      return;
    }

    requestInit.signal?.addEventListener('abort', abortRequest, {
      once: true,
    });
    request.end();
  });
}

async function fetchBangumiCalendarThroughSocksProxy(
  targetUrl: URL,
  proxyUrl: URL,
  init: BangumiFetchInit,
): Promise<unknown> {
  const timeoutMs = init.timeoutMs ?? BANGUMI_DEFAULT_TIMEOUT_MS;
  const headers = createBangumiRequestHeaders(init);

  return await new Promise((resolve, reject) => {
    let proxySocket: Socket | undefined;
    let secureSocket: TLSSocket | undefined;
    let settled = false;
    let responseBytes = 0;
    const responseChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      fail(new Error('Bangumi SOCKS 代理请求超时'));
    }, timeoutMs);

    const finish = (data: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(data);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      secureSocket?.destroy();
      proxySocket?.destroy();
      reject(error);
    };

    proxySocket = netConnect({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port || 1080),
    });
    proxySocket.once('error', fail);
    proxySocket.once('connect', () => {
      void (async () => {
        try {
          await connectSocks5Target(proxySocket!, targetUrl, proxyUrl);
          secureSocket = tlsConnect({
            socket: proxySocket,
            servername: targetUrl.hostname,
          });
          secureSocket.setTimeout(timeoutMs, () => {
            fail(new Error('Bangumi SOCKS 代理响应超时'));
          });
          secureSocket.once('secureConnect', () => {
            secureSocket?.write(
              createBangumiRawHttpRequest(targetUrl, headers),
            );
          });
          secureSocket.on('data', (chunk: Buffer) => {
            responseBytes += chunk.byteLength;

            if (responseBytes > BANGUMI_MAX_RESPONSE_BYTES) {
              fail(new Error('Bangumi 日历响应过大'));
              return;
            }

            responseChunks.push(chunk);
          });
          secureSocket.once('end', () => {
            try {
              finish(
                parseBangumiJsonHttpResponse(Buffer.concat(responseChunks)),
              );
            } catch (error) {
              fail(
                error instanceof Error
                  ? error
                  : new Error('Bangumi 日历格式异常'),
              );
            }
          });
          secureSocket.once('error', fail);
        } catch (error) {
          fail(
            error instanceof Error ? error : new Error('SOCKS 代理请求失败'),
          );
        }
      })();
    });
  });
}

function createBangumiRequestHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json, text/plain, */*');
  }

  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', 'IceTV');
  }

  return headers;
}

async function connectSocks5Target(
  socket: Socket,
  targetUrl: URL,
  proxyUrl: URL,
): Promise<void> {
  if (proxyUrl.username || proxyUrl.password) {
    throw new Error('Bangumi SOCKS 代理暂不支持认证');
  }

  const host = Buffer.from(targetUrl.hostname);

  if (host.byteLength > 255) {
    throw new Error('Bangumi 请求主机名过长');
  }

  const port = Number(
    targetUrl.port || (targetUrl.protocol === 'http:' ? 80 : 443),
  );

  socket.write(Buffer.from([0x05, 0x01, 0x00]));
  const authResponse = await readSocketChunk(socket);

  if (
    authResponse.length < 2 ||
    authResponse[0] !== 0x05 ||
    authResponse[1] !== 0x00
  ) {
    throw new Error('Bangumi SOCKS 代理认证失败');
  }

  socket.write(
    Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, host.byteLength]),
      host,
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    ]),
  );
  const connectResponse = await readSocketChunk(socket);

  if (
    connectResponse.length < 2 ||
    connectResponse[0] !== 0x05 ||
    connectResponse[1] !== 0x00
  ) {
    throw new Error('Bangumi SOCKS 代理连接失败');
  }
}

function readSocketChunk(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('data', handleData);
      socket.off('error', handleError);
      socket.off('end', handleEnd);
    };
    const handleData = (chunk: Buffer) => {
      cleanup();
      resolve(chunk);
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleEnd = () => {
      cleanup();
      reject(new Error('Bangumi SOCKS 代理连接关闭'));
    };

    socket.once('data', handleData);
    socket.once('error', handleError);
    socket.once('end', handleEnd);
  });
}

function createBangumiRawHttpRequest(targetUrl: URL, headers: Headers): string {
  const requestHeaders = new Headers(headers);

  requestHeaders.set('Host', getHostHeader(targetUrl));
  requestHeaders.set('Connection', 'close');

  return [
    `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.0`,
    ...Array.from(requestHeaders.entries()).map(
      ([key, value]) => `${key}: ${value}`,
    ),
    '',
    '',
  ].join('\r\n');
}

function parseBangumiJsonHttpResponse(responseBuffer: Buffer): unknown {
  const headerEndIndex = responseBuffer.indexOf('\r\n\r\n');

  if (headerEndIndex === -1) {
    throw new Error('Bangumi 日历响应头异常');
  }

  const headerText = responseBuffer
    .subarray(0, headerEndIndex)
    .toString('latin1');
  const [statusLine] = headerText.split('\r\n');
  const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)\s*(.*)$/);
  const status = Number(statusMatch?.[1]);

  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    throw new Error(`获取 Bangumi 日历失败: ${status || 0}`);
  }

  return JSON.parse(
    responseBuffer.subarray(headerEndIndex + 4).toString('utf8'),
  );
}

function getHostHeader(url: URL): string {
  const defaultPort = url.protocol === 'http:' ? '80' : '443';

  if (!url.port || url.port === defaultPort) {
    return url.hostname;
  }

  return `${url.hostname}:${url.port}`;
}

function getSocksProxyUrls(): URL[] {
  const seenUrls = new Set<string>();
  const proxyValues = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
  ];
  const proxyUrls: URL[] = [];

  for (const value of proxyValues) {
    if (!value) {
      continue;
    }

    try {
      const proxyUrl = new URL(value);

      if (proxyUrl.protocol !== 'socks5:' && proxyUrl.protocol !== 'socks5h:') {
        continue;
      }

      const key = proxyUrl.toString();

      if (!seenUrls.has(key)) {
        seenUrls.add(key);
        proxyUrls.push(proxyUrl);
      }
    } catch {
      continue;
    }
  }

  return proxyUrls;
}

function withTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Bangumi 日历请求超时'));
    }, timeoutMs);

    request
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}
