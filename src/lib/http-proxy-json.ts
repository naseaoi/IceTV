import { Buffer } from 'node:buffer';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Socket } from 'node:net';
import { connect as tlsConnect, TLSSocket } from 'node:tls';

interface ProxyJsonOptions {
  timeoutMs: number;
  userAgent: string;
}

interface ProxyTextOptions extends ProxyJsonOptions {
  maxBytes: number;
  headers?: Record<string, string>;
}

export interface ProxyFetchResult {
  status: number;
  statusText: string;
  headers: Headers;
  body: Buffer;
}

export interface ProxyStreamResult {
  status: number;
  statusText: string;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
}

export function getProxyUrlForTarget(targetUrl: URL): URL | undefined {
  if (matchesNoProxy(targetUrl.hostname, getDefaultPort(targetUrl))) {
    return undefined;
  }

  const proxyValues = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
  ];

  for (const value of proxyValues) {
    if (!value) {
      continue;
    }

    try {
      const proxyUrl = new URL(value);

      if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
        return proxyUrl;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export function fetchJsonThroughProxy(
  targetUrl: URL,
  proxyUrl: URL,
  options: ProxyJsonOptions,
): Promise<unknown> {
  return fetchResponseThroughProxy(targetUrl, proxyUrl, {
    ...options,
    accept: 'application/json',
    maxBytes: 10 * 1024 * 1024,
  }).then((response) => JSON.parse(response.body.toString('utf8')));
}

export function fetchTextThroughProxy(
  targetUrl: URL,
  proxyUrl: URL,
  options: ProxyTextOptions,
): Promise<string> {
  return fetchResponseThroughProxy(targetUrl, proxyUrl, {
    ...options,
    accept: 'text/plain,*/*',
  }).then((response) => response.body.toString('utf8'));
}

export function fetchResponseThroughProxy(
  targetUrl: URL,
  proxyUrl: URL,
  options: ProxyTextOptions & { accept: string },
): Promise<ProxyFetchResult> {
  return fetchThroughProxy(targetUrl, proxyUrl, options).then((buffer) => {
    return parseProxyResponse(buffer);
  });
}

export function fetchStreamThroughProxy(
  targetUrl: URL,
  proxyUrl: URL,
  options: ProxyTextOptions & { accept: string },
): Promise<ProxyStreamResult> {
  if (targetUrl.protocol === 'http:') {
    return fetchHttpStreamThroughProxy(targetUrl, proxyUrl, options);
  }

  return fetchHttpsStreamThroughProxy(targetUrl, proxyUrl, options);
}

function fetchHttpStreamThroughProxy(
  targetUrl: URL,
  proxyUrl: URL,
  options: ProxyTextOptions & { accept: string },
): Promise<ProxyStreamResult> {
  const proxyRequest =
    proxyUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxyPort =
    proxyUrl.port || (proxyUrl.protocol === 'https:' ? '443' : '80');

  return new Promise((resolve, reject) => {
    const request = proxyRequest({
      hostname: proxyUrl.hostname,
      port: proxyPort,
      method: 'GET',
      path: targetUrl.toString(),
      headers: {
        Host: getHostHeader(targetUrl),
        Accept: options.accept,
        'User-Agent': options.userAgent,
        Connection: 'close',
        ...options.headers,
        ...getProxyAuthorizationHeaders(proxyUrl),
      },
    });

    request.setTimeout(options.timeoutMs);
    request.once('response', (response) => {
      const headers = headersFromNodeHeaders(response.headers);
      const status = response.statusCode || 0;
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`代理请求失败: ${status}`));
        return;
      }

      resolve({
        status,
        statusText: response.statusMessage || '',
        headers,
        body: nodeStreamToReadableStream(response, options.maxBytes),
      });
    });
    request.once('timeout', () => {
      request.destroy(new Error('代理响应超时'));
    });
    request.once('error', reject);
    request.end();
  });
}

function fetchHttpsStreamThroughProxy(
  targetUrl: URL,
  proxyUrl: URL,
  options: ProxyTextOptions & { accept: string },
): Promise<ProxyStreamResult> {
  const targetPort = getDefaultPort(targetUrl);
  const proxyRequest =
    proxyUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxyPort =
    proxyUrl.port || (proxyUrl.protocol === 'https:' ? '443' : '80');

  return new Promise((resolve, reject) => {
    let secureSocket: TLSSocket | undefined;
    let settled = false;
    let responseBytes = 0;
    let headerBuffer = Buffer.alloc(0);
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null =
      null;

    const fail = (error: Error) => {
      if (settled) {
        controllerRef?.error(error);
        secureSocket?.destroy();
        return;
      }
      settled = true;
      secureSocket?.destroy();
      reject(error);
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
      cancel() {
        secureSocket?.destroy();
      },
    });

    const connectRequest = proxyRequest({
      hostname: proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetUrl.hostname}:${targetPort}`,
      headers: {
        Host: `${targetUrl.hostname}:${targetPort}`,
        ...getProxyAuthorizationHeaders(proxyUrl),
      },
    });

    connectRequest.setTimeout(options.timeoutMs);
    connectRequest.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理连接失败: ${response.statusCode || 0}`));
        return;
      }

      secureSocket = tlsConnect({ socket, servername: targetUrl.hostname });
      secureSocket.setTimeout(options.timeoutMs);
      secureSocket.once('secureConnect', () => {
        secureSocket?.write(
          [
            `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.0`,
            `Host: ${getHostHeader(targetUrl)}`,
            `Accept: ${options.accept}`,
            `User-Agent: ${options.userAgent}`,
            ...Object.entries(options.headers || {}).map(
              ([key, value]) => `${key}: ${value}`,
            ),
            'Connection: close',
            '',
            '',
          ].join('\r\n'),
        );
      });
      secureSocket.on('data', (chunk: Buffer) => {
        if (!settled) {
          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          const headerEndIndex = headerBuffer.indexOf('\r\n\r\n');
          if (headerEndIndex === -1) {
            return;
          }

          const parsed = parseProxyHeader(
            headerBuffer.subarray(0, headerEndIndex),
          );
          if (parsed.status < 200 || parsed.status >= 300) {
            fail(new Error(`代理请求失败: ${parsed.status}`));
            return;
          }

          settled = true;
          resolve({
            status: parsed.status,
            statusText: parsed.statusText,
            headers: parsed.headers,
            body: stream,
          });

          const bodyChunk = headerBuffer.subarray(headerEndIndex + 4);
          if (bodyChunk.length > 0) {
            enqueueProxyStreamChunk(
              bodyChunk,
              options.maxBytes,
              (nextBytes) => {
                responseBytes = nextBytes;
              },
              responseBytes,
              controllerRef,
              fail,
            );
          }
          return;
        }

        enqueueProxyStreamChunk(
          chunk,
          options.maxBytes,
          (nextBytes) => {
            responseBytes = nextBytes;
          },
          responseBytes,
          controllerRef,
          fail,
        );
      });
      secureSocket.once('end', () => {
        controllerRef?.close();
      });
      secureSocket.once('error', fail);
      secureSocket.once('timeout', () => {
        fail(new Error('代理响应超时'));
      });
    });
    connectRequest.once('timeout', () => {
      connectRequest.destroy(new Error('代理请求超时'));
    });
    connectRequest.once('error', reject);
    connectRequest.end();
  });
}

function fetchThroughProxy(
  targetUrl: URL,
  proxyUrl: URL,
  options: ProxyTextOptions & { accept: string },
): Promise<Buffer> {
  const targetPort = getDefaultPort(targetUrl);
  const proxyRequest =
    proxyUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxyPort =
    proxyUrl.port || (proxyUrl.protocol === 'https:' ? '443' : '80');

  return new Promise<Buffer>((resolve, reject) => {
    let secureSocket: TLSSocket | undefined;
    let proxySocket: Socket | undefined;
    let activeRequest: { destroy(): void } | undefined;
    let settled = false;

    const timer = setTimeout(() => {
      fail(new Error('代理请求超时'));
    }, options.timeoutMs);

    const finish = (data: Buffer) => {
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
      activeRequest?.destroy();
      reject(error);
    };

    const collectChunk = (chunk: Buffer) => {
      responseBytes += chunk.length;
      if (responseBytes > options.maxBytes) {
        fail(new Error('代理响应过大'));
        return;
      }
      responseChunks.push(chunk);
    };

    let responseBytes = 0;
    const responseChunks: Buffer[] = [];

    const fetchHttpTargetThroughProxy = () => {
      const request = proxyRequest({
        hostname: proxyUrl.hostname,
        port: proxyPort,
        method: 'GET',
        path: targetUrl.toString(),
        headers: {
          Host: getHostHeader(targetUrl),
          Accept: options.accept,
          'User-Agent': options.userAgent,
          Connection: 'close',
          ...options.headers,
          ...getProxyAuthorizationHeaders(proxyUrl),
        },
      });
      activeRequest = request;

      request.setTimeout(options.timeoutMs);
      request.on('response', (response) => {
        const headerLines = [
          `HTTP/1.1 ${response.statusCode || 0} ${response.statusMessage || ''}`,
          ...Object.entries(response.headers).flatMap(([key, value]) => {
            if (Array.isArray(value)) {
              return value.map((item) => `${key}: ${item}`);
            }
            return value === undefined ? [] : [`${key}: ${value}`];
          }),
          '',
          '',
        ];
        responseChunks.push(Buffer.from(headerLines.join('\r\n'), 'latin1'));
        response.on('data', collectChunk);
        response.once('end', () => {
          finish(Buffer.concat(responseChunks));
        });
        response.once('error', fail);
      });
      request.once('timeout', () => {
        fail(new Error('代理响应超时'));
      });
      request.once('error', fail);
      request.end();
    };

    if (targetUrl.protocol === 'http:') {
      fetchHttpTargetThroughProxy();
      return;
    }

    const connectRequest = proxyRequest({
      hostname: proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetUrl.hostname}:${targetPort}`,
      headers: {
        Host: `${targetUrl.hostname}:${targetPort}`,
        ...getProxyAuthorizationHeaders(proxyUrl),
      },
    });
    activeRequest = connectRequest;

    connectRequest.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        fail(new Error(`代理连接失败: ${response.statusCode || 0}`));
        return;
      }

      proxySocket = socket;
      secureSocket = tlsConnect({
        socket,
        servername: targetUrl.hostname,
      });

      secureSocket.setTimeout(options.timeoutMs);
      secureSocket.once('secureConnect', () => {
        secureSocket?.write(
          [
            `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.0`,
            `Host: ${getHostHeader(targetUrl)}`,
            `Accept: ${options.accept}`,
            `User-Agent: ${options.userAgent}`,
            ...Object.entries(options.headers || {}).map(
              ([key, value]) => `${key}: ${value}`,
            ),
            'Connection: close',
            '',
            '',
          ].join('\r\n'),
        );
      });
      secureSocket.on('data', collectChunk);
      secureSocket.once('end', () => {
        try {
          finish(Buffer.concat(responseChunks));
        } catch (error) {
          fail(error instanceof Error ? error : new Error('代理响应解析失败'));
        }
      });
      secureSocket.once('error', fail);
      secureSocket.once('timeout', () => {
        fail(new Error('代理响应超时'));
      });
    });

    connectRequest.once('error', fail);
    connectRequest.end();
  });
}

function parseProxyResponse(responseBuffer: Buffer): ProxyFetchResult {
  const headerEndIndex = responseBuffer.indexOf('\r\n\r\n');

  if (headerEndIndex === -1) {
    throw new Error('响应头异常');
  }

  const headerText = responseBuffer
    .subarray(0, headerEndIndex)
    .toString('latin1');
  const [statusLine] = headerText.split('\r\n');
  const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)\s*(.*)$/);
  const statusCode = Number(statusMatch?.[1]);
  const statusText = statusMatch?.[2] || '';

  if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
    throw new Error(`代理请求失败: ${statusCode || 0}`);
  }

  const headers = new Headers();
  for (const line of headerText.split('\r\n').slice(1)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    headers.append(
      line.slice(0, separatorIndex).trim(),
      line.slice(separatorIndex + 1).trim(),
    );
  }

  return {
    status: statusCode,
    statusText,
    headers,
    body: responseBuffer.subarray(headerEndIndex + 4),
  };
}

function parseProxyHeader(headerBuffer: Buffer): {
  status: number;
  statusText: string;
  headers: Headers;
} {
  const headerText = headerBuffer.toString('latin1');
  const [statusLine] = headerText.split('\r\n');
  const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)\s*(.*)$/);
  const status = Number(statusMatch?.[1]);
  const statusText = statusMatch?.[2] || '';

  return {
    status,
    statusText,
    headers: headersFromHeaderText(headerText),
  };
}

function headersFromHeaderText(headerText: string): Headers {
  const headers = new Headers();
  for (const line of headerText.split('\r\n').slice(1)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    headers.append(
      line.slice(0, separatorIndex).trim(),
      line.slice(separatorIndex + 1).trim(),
    );
  }
  return headers;
}

function headersFromNodeHeaders(
  nodeHeaders: Record<string, string | string[] | number | undefined>,
): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, item));
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }
  return headers;
}

function nodeStreamToReadableStream(
  stream: NodeJS.ReadableStream & { destroy(error?: Error): void },
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let total = 0;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('data', (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maxBytes) {
          stream.destroy(new Error('代理响应过大'));
          controller.error(new Error('代理响应过大'));
          return;
        }
        controller.enqueue(chunk);
      });
      stream.once('end', () => {
        controller.close();
      });
      stream.once('error', (error) => {
        controller.error(error);
      });
    },
    cancel() {
      stream.destroy();
    },
  });
}

function enqueueProxyStreamChunk(
  chunk: Buffer,
  maxBytes: number,
  setTotal: (nextBytes: number) => void,
  currentBytes: number,
  controller: ReadableStreamDefaultController<Uint8Array> | null,
  fail: (error: Error) => void,
) {
  const nextBytes = currentBytes + chunk.byteLength;
  if (nextBytes > maxBytes) {
    fail(new Error('代理响应过大'));
    return;
  }
  setTotal(nextBytes);
  controller?.enqueue(chunk);
}

function getDefaultPort(url: URL): string {
  if (url.port) {
    return url.port;
  }
  return url.protocol === 'http:' ? '80' : '443';
}

function getHostHeader(url: URL): string {
  const defaultPort = url.protocol === 'http:' ? '80' : '443';
  if (!url.port || url.port === defaultPort) {
    return url.hostname;
  }
  return `${url.hostname}:${url.port}`;
}

function matchesNoProxy(hostname: string, port: string): boolean {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;

  if (!noProxy) {
    return false;
  }

  const normalizedHostname = hostname.toLowerCase();

  return noProxy.split(',').some((entry) => {
    const value = entry.trim().toLowerCase();

    if (!value) {
      return false;
    }

    if (value === '*') {
      return true;
    }

    const portMatch = value.match(/:(\d+)$/);

    if (portMatch && portMatch[1] !== port) {
      return false;
    }

    const host = value.replace(/:(\d+)$/, '').replace(/^\./, '');

    return (
      normalizedHostname === host || normalizedHostname.endsWith(`.${host}`)
    );
  });
}

function getProxyAuthorizationHeaders(proxyUrl: URL): Record<string, string> {
  if (!proxyUrl.username && !proxyUrl.password) {
    return {};
  }

  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password);
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');

  return {
    'Proxy-Authorization': `Basic ${credentials}`,
  };
}
