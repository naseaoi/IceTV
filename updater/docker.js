const { spawn } = require('node:child_process');
const { stat } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const {
  composeArgs,
  parseComposeLabels,
  isFixedImage,
  imageVersion,
  healthResult,
} = require('./logic');

function runDocker(args, { timeout = 30000, logOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stop = () => {
      // Compose 是 CLI 子进程，超时须终止整组，避免回退时旧命令继续重建。
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') child.kill('SIGKILL');
        }
      } else child.kill('SIGKILL');
    };
    let stdout = '';
    let tail = '';
    let overflow = false;
    let timedOut = false;
    const appendTail = (data) => {
      tail = (tail + data.toString()).slice(-8192);
    };
    child.stdout.on('data', (data) => {
      if (logOutput) appendTail(data);
      else if (stdout.length + data.length <= 2 * 1024 * 1024)
        stdout += data.toString();
      else {
        overflow = true;
        stop();
      }
    });
    child.stderr.on('data', appendTail);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Docker 命令无法启动'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (tail.trim())
        console.error(
          '[updater] Docker output:',
          tail.trim().split(/\r?\n/).slice(-20).join('\n'),
        );
      if (code !== 0 || overflow || timedOut)
        reject(new Error('Docker 命令执行失败'));
      else resolve(stdout.trim());
    });
  });
}

async function inspect(kind, name, run = runDocker) {
  const output = await run([kind, 'inspect', name]);
  const values = JSON.parse(output);
  if (values.length !== 1) throw new Error('无法识别目标镜像或容器');
  return values[0];
}

async function discover(containerName, run = runDocker) {
  let container;
  try {
    container = await inspect('container', containerName, run);
  } catch {
    return { capable: false, reason: '找不到目标容器或 Docker 不可用' };
  }
  try {
    const compose = parseComposeLabels(container.Config.Labels || {});
    const image = container.Config.Image;
    if (isFixedImage(image))
      return { capable: false, reason: '固定版本或 digest 镜像需手动升级' };
    try {
      if (!(await stat(compose.workingDir)).isDirectory()) throw new Error();
      for (const file of [...compose.configFiles, ...compose.envFiles]) {
        if (!(await stat(file)).isFile()) throw new Error();
      }
    } catch {
      return {
        capable: false,
        reason: 'Compose 工作目录或配置文件未按宿主同一路径挂载',
      };
    }
    const ids = (await run(composeArgs(compose, 'ps')))
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length !== 1 || !container.Id.startsWith(ids[0])) {
      return { capable: false, reason: '网页升级仅支持单实例 Compose 服务' };
    }
    if (container.State.Status !== 'running')
      return { capable: false, reason: '目标容器尚未运行' };
    const current = await inspect('image', container.Image, run);
    return {
      capable: true,
      target: {
        container: containerName,
        project: compose.project,
        service: compose.service,
        image,
        currentVersion: imageVersion(current),
      },
      compose,
      imageId: container.Image,
    };
  } catch (error) {
    console.error('[updater] Target discovery failed:', error.message);
    return { capable: false, reason: '无法读取有效的 Compose 配置或目标镜像' };
  }
}

async function waitHealthy(compose, imageId, timeout, run = runDocker) {
  const deadline = Date.now() + timeout;
  let runningSince = null;
  while (Date.now() < deadline) {
    const command = (args) =>
      run(args, {
        timeout: Math.max(1, Math.min(30000, deadline - Date.now())),
      });
    const ids = (await command(composeArgs(compose, 'ps')))
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length > 1) throw new Error('重建后发现多个实例');
    if (ids.length === 1) {
      const container = await inspect('container', ids[0], command);
      const health = healthResult(container, imageId, runningSince, Date.now());
      if (health.result === 'ready') return;
      if (health.result === 'failed') throw new Error('容器健康检查失败');
      runningSince = health.runningSince;
    } else runningSince = null;
    await delay(Math.min(1000, Math.max(0, deadline - Date.now())));
  }
  throw new Error('容器健康检查超时');
}

module.exports = { runDocker, inspect, discover, waitHealthy };
