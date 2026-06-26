import { Buffer } from 'node:buffer';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Socket } from 'node:net';
import { connect as tlsConnect, TLSSocket } from 'node:tls';

interface ProxyJsonOptions {
  timeoutMs: number;
  userAgent: string;
}

export function getProxyUrlForTarget(targetUrl: URL): URL | undefined {
  if (matchesNoProxy(targetUrl.hostname, targetUrl.port || '443')) {
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
  const targetPort = targetUrl.port || '443';
  const proxyRequest =
    proxyUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxyPort =
    proxyUrl.port || (proxyUrl.protocol === 'https:' ? '443' : '80');

  return new Promise((resolve, reject) => {
    let secureSocket: TLSSocket | undefined;
    let proxySocket: Socket | undefined;
    let settled = false;

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

    const timer = setTimeout(() => {
      fail(new Error('代理请求超时'));
    }, options.timeoutMs);

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
      connectRequest.destroy();
      reject(error);
    };

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

      const responseChunks: Buffer[] = [];

      secureSocket.setTimeout(options.timeoutMs);
      secureSocket.once('secureConnect', () => {
        secureSocket?.write(
          [
            `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.0`,
            `Host: ${targetUrl.hostname}`,
            'Accept: application/json',
            `User-Agent: ${options.userAgent}`,
            'Connection: close',
            '',
            '',
          ].join('\r\n'),
        );
      });
      secureSocket.on('data', (chunk: Buffer) => {
        responseChunks.push(chunk);
      });
      secureSocket.once('end', () => {
        try {
          finish(parseProxyJsonResponse(Buffer.concat(responseChunks)));
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

function parseProxyJsonResponse(responseBuffer: Buffer): unknown {
  const headerEndIndex = responseBuffer.indexOf('\r\n\r\n');

  if (headerEndIndex === -1) {
    throw new Error('响应头异常');
  }

  const headerText = responseBuffer
    .subarray(0, headerEndIndex)
    .toString('latin1');
  const [statusLine] = headerText.split('\r\n');
  const statusCode = Number(statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/)?.[1]);

  if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
    throw new Error(`代理请求失败: ${statusCode || 0}`);
  }

  const body = responseBuffer.subarray(headerEndIndex + 4).toString('utf8');

  return JSON.parse(body);
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
