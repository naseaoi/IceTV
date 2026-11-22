const http = require('node:http');
const { authorized } = require('./logic');
const { createUpdater } = require('./service');

function readConfig(env = process.env) {
  const token = env.UPDATER_TOKEN;
  if (!token || token.length < 32 || token.trim() !== token) {
    throw new Error('UPDATER_TOKEN 必须为至少 32 字符的随机密钥');
  }
  const number = (key, fallback, maximum) => {
    const value = Number(env[key] || fallback);
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
      throw new Error(`${key} 无效`);
    return value;
  };
  const container = env.UPDATER_TARGET_CONTAINER || 'icetv';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container))
    throw new Error('UPDATER_TARGET_CONTAINER 无效');
  return {
    token,
    container,
    port: number('UPDATER_PORT', 9330, 65535),
    healthTimeout: number('UPDATER_HEALTH_TIMEOUT_MS', 240000, 2147483647),
  };
}

function createServer(config, updater = createUpdater(config)) {
  return http.createServer(
    { requestTimeout: 15000, headersTimeout: 10000 },
    async (req, res) => {
      const send = (code, value) => {
        res.writeHead(code, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(value === undefined ? '' : JSON.stringify(value));
      };
      req.resume();
      if (req.method === 'GET' && req.url === '/healthz') return send(204);
      if (!authorized(req.headers.authorization, config.token))
        return send(401, { error: '身份验证失败' });
      try {
        if (req.method === 'GET' && req.url === '/status')
          return send(200, await updater.status());
        if (req.method === 'POST' && ['/pull', '/restart'].includes(req.url)) {
          const result = await updater.action(req.url.slice(1));
          return send(result.code, result.status);
        }
        send(404, { error: '接口不存在' });
      } catch {
        console.error('[updater] Request failed');
        send(500, { error: '升级服务暂时不可用，请检查 updater 日志' });
      }
    },
  );
}

if (require.main === module) {
  try {
    const config = readConfig();
    const server = createServer(config);
    server.listen(config.port, '0.0.0.0', () =>
      console.log('[updater] Service ready'),
    );
    server.on('error', () => {
      console.error('[updater] HTTP 服务启动失败');
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`[updater] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { readConfig, createServer };
