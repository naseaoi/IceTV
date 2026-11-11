#!/usr/bin/env node
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rtt = Number(process.env.REMOTE_MYSQL_RTT_MS ?? 20);
const samples = Number(process.env.REMOTE_MYSQL_SAMPLES ?? 20);
if (!Number.isFinite(rtt) || rtt < 0 || rtt > 200)
  throw new Error('REMOTE_MYSQL_RTT_MS 必须在 0 到 200 之间');
if (!Number.isSafeInteger(samples) || samples < 5 || samples > 100)
  throw new Error('REMOTE_MYSQL_SAMPLES 必须是 5 到 100 的整数');

const container = `icetv-mysql-overhead-${process.pid}-${randomBytes(4).toString('hex')}`;
const password = randomBytes(18).toString('hex');
const controlToken = randomBytes(18).toString('hex');
const database = 'icetv_overhead';
const sockets = new Set();
const timers = new Set();
let commandCounts = {};
let sqlCounts = {};
let errors = {};
let lastTrafficAt = Date.now();
let child;
let created = false;
let proxy;
let control;
const commandNames = {
  1: 'COM_QUIT',
  2: 'COM_INIT_DB',
  3: 'COM_QUERY',
  14: 'COM_PING',
  22: 'COM_STMT_PREPARE',
  23: 'COM_STMT_EXECUTE',
  24: 'COM_STMT_SEND_LONG_DATA',
  25: 'COM_STMT_CLOSE',
  26: 'COM_STMT_RESET',
  28: 'COM_STMT_FETCH',
  31: 'COM_RESET_CONNECTION',
};

function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

function inspectCommands() {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUIntLE(0, 3);
      if (buffered.length < length + 4) break;
      const packet = buffered.subarray(4, length + 4);
      // 握手与认证使用非零序号；按完整协议包解析，避免 TCP 拆包或粘包造成误计数。
      if (buffered[3] === 0 && packet.length) {
        const command = packet[0];
        const name = commandNames[command] ?? `COM_${command}`;
        commandCounts[name] = (commandCounts[name] ?? 0) + 1;
        if (command === 3 || command === 22) {
          const sql = packet
            .subarray(1)
            .toString('utf8')
            .replace(/\s+/g, ' ')
            .trim();
          sqlCounts[sql] = (sqlCounts[sql] ?? 0) + 1;
        }
      }
      buffered = buffered.subarray(length + 4);
    }
  };
}

function inspectErrors() {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUIntLE(0, 3);
      if (buffered.length < length + 4) break;
      const packet = buffered.subarray(4, length + 4);
      if (packet.length >= 9 && packet[0] === 0xff) {
        const error = `${packet.readUInt16LE(1)}: ${packet.subarray(9).toString('utf8')}`;
        errors[error] = (errors[error] ?? 0) + 1;
      }
      buffered = buffered.subarray(length + 4);
    }
  };
}

function forward(source, destination, inspect) {
  let pendingBytes = 0;
  const resume = () => {
    if (pendingBytes < 1024 * 1024 && !destination.writableNeedDrain)
      source.resume();
  };
  destination.on('drain', resume);
  source.on('data', (chunk) => {
    lastTrafficAt = Date.now();
    inspect?.(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes >= 1024 * 1024) source.pause();
    const timer = setTimeout(() => {
      timers.delete(timer);
      pendingBytes -= chunk.length;
      if (!destination.destroyed) {
        if (!destination.write(chunk)) source.pause();
        else resume();
      }
      lastTrafficAt = Date.now();
    }, rtt / 2);
    timers.add(timer);
  });
}

async function main() {
  docker(['version', '--format', '{{.Server.Version}}']);
  docker([
    'run',
    '-d',
    '--name',
    container,
    '-e',
    `MYSQL_ROOT_PASSWORD=${password}`,
    '-e',
    `MYSQL_DATABASE=${database}`,
    '-p',
    '127.0.0.1::3306',
    'mysql:8.4',
  ]);
  created = true;
  const port = Number(docker(['port', container, '3306/tcp']).split(':').pop());
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      // 宿主机映射只连最终服务，避免把初始化期间的临时 mysqld 当成就绪。
      docker([
        'exec',
        container,
        'mysql',
        '-h127.0.0.1',
        '-uroot',
        `-p${password}`,
        database,
        '-e',
        'SELECT 1',
      ]);
      break;
    } catch {
      if (Date.now() >= deadline) throw new Error('MySQL 容器 180 秒内未就绪');
      await wait(1500);
    }
  }

  proxy = net.createServer((client) => {
    const upstream = net.connect(port, '127.0.0.1');
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.setNoDelay(true);
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
      socket.on('close', () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }
    forward(client, upstream, inspectCommands());
    forward(upstream, client, inspectErrors());
  });
  const proxyPort = await listen(proxy);
  control = http.createServer(async (request, response) => {
    if (request.headers.authorization !== controlToken) {
      response.writeHead(403).end();
      return;
    }
    if (!['/reset', '/snapshot'].includes(request.url)) {
      response.writeHead(404).end();
      return;
    }
    // 仅在测量区间外等待静默，纳入响应结束后已排队的维护 SQL，等待时间不计入请求延迟。
    const until = Date.now() + 10_000;
    while (timers.size || Date.now() - lastTrafficAt < Math.max(100, rtt * 3)) {
      if (Date.now() >= until) {
        response.writeHead(503).end('数据库流量未静默');
        return;
      }
      await wait(10);
    }
    if (request.url === '/reset') {
      commandCounts = {};
      sqlCounts = {};
      errors = {};
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        total: Object.values(commandCounts).reduce(
          (sum, count) => sum + count,
          0,
        ),
        commands: commandCounts,
        sql: sqlCounts,
        errors,
      }),
    );
  });
  const controlPort = await listen(control);
  console.log(
    `MySQL 8.4；附加 RTT ${rtt}ms（每方向 ${rtt / 2}ms）；样本 ${samples}；连接池 10`,
  );
  const env = {
    ...process.env,
    RUN_REMOTE_MYSQL_OVERHEAD_CHECK: '1',
    REMOTE_MYSQL_RTT_MS: String(rtt),
    REMOTE_MYSQL_SAMPLES: String(samples),
    REMOTE_MYSQL_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
    REMOTE_MYSQL_CONTROL_TOKEN: controlToken,
    MYSQL_TEST_URL: `mysql://root:${password}@127.0.0.1:${proxyPort}/${database}`,
    DATABASE_URL: `mysql://root:${password}@127.0.0.1:${proxyPort}/${database}`,
    NEXT_PUBLIC_STORAGE_TYPE: 'mysql',
    MYSQL_CONNECTION_LIMIT: '10',
    MYSQL_MAX_IDLE: '10',
    CONFIG_CACHE_TTL_MS: '600000',
    AUTH_SECRET: randomBytes(32).toString('hex'),
    ICETV_USERNAME: 'overhead-owner',
  };
  delete env.MYSQL_SSL_CA;
  child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/jest/bin/jest.js'),
      '--runInBand',
      '--runTestsByPath',
      'src/performance/remote-mysql-overhead.test.ts',
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function cleanup() {
  child?.kill();
  for (const timer of timers) clearTimeout(timer);
  for (const socket of sockets) socket.destroy();
  proxy?.close();
  control?.close();
  if (created) {
    docker(['rm', '-f', '-v', container]);
    created = false;
    console.log('测量容器已销毁');
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });
}
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
