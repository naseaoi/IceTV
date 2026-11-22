const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');

const ACTIVE_PHASES = new Set([
  'pulling',
  'restarting',
  'verifying',
  'rolling-back',
]);
const TRANSITIONS = {
  idle: ['pulling'],
  pulling: ['pulled', 'up-to-date', 'failed'],
  pulled: ['pulling', 'restarting'],
  'up-to-date': ['pulling'],
  restarting: ['verifying', 'rolling-back', 'failed'],
  verifying: ['succeeded', 'rolling-back'],
  succeeded: ['pulling'],
  'rolling-back': ['rolled-back', 'failed'],
  'rolled-back': ['pulling'],
  failed: ['pulling'],
};

function transition(job, phase, details = {}, now = Date.now()) {
  if (!TRANSITIONS[job.phase]?.includes(phase)) {
    throw new Error('任务状态转换无效');
  }
  const previous = phase === 'pulling' ? {} : job;
  return {
    ...previous,
    ...details,
    phase,
    ...(phase === 'pulling' ? { startedAt: now } : {}),
    updatedAt: now,
  };
}

function isFixedImage(image) {
  if (image.includes('@')) return true;
  const last = image.slice(image.lastIndexOf('/') + 1);
  const tag = last.includes(':') ? last.slice(last.lastIndexOf(':') + 1) : '';
  return /^v?\d+\.\d+\.\d+(?:[-+].*)?$/.test(tag);
}

function parseComposeLabels(labels = {}) {
  const get = (key) => labels[`com.docker.compose.${key}`];
  const project = get('project');
  const service = get('service');
  const workingDir = get('project.working_dir');
  const configFiles = get('project.config_files');
  if (!project || !service || !workingDir || !configFiles) {
    throw new Error('目标容器缺少 Compose 标签');
  }
  if (
    !/^[a-z0-9][a-z0-9_-]*$/.test(project) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(service) ||
    !path.posix.isAbsolute(workingDir)
  ) {
    throw new Error('目标容器的 Compose 标签无效');
  }
  const paths = (value) =>
    value.split(',').map((item) => {
      const file = item.trim();
      if (!file) throw new Error('Compose 文件标签无效');
      return path.posix.resolve(workingDir, file);
    });
  return {
    project,
    service,
    workingDir,
    configFiles: paths(configFiles),
    envFiles: get('project.environment_file')
      ? paths(get('project.environment_file'))
      : [],
  };
}

function composeArgs(compose, action) {
  const args = [
    'compose',
    '-p',
    compose.project,
    '--project-directory',
    compose.workingDir,
  ];
  for (const file of compose.configFiles) args.push('-f', file);
  for (const file of compose.envFiles) args.push('--env-file', file);
  if (action === 'pull') args.push('pull', compose.service);
  // 固定使用已拉取的本地镜像，避免 pull_policy: always 覆盖回退标签。
  else if (action === 'up')
    args.push('up', '-d', '--no-deps', '--pull', 'never', compose.service);
  else if (action === 'ps') args.push('ps', '-a', '-q', compose.service);
  else throw new Error('Compose 操作无效');
  return args;
}

function imageVersion(image) {
  const entry = image.Config?.Env?.find((value) =>
    value.startsWith('NEXT_PUBLIC_APP_VERSION='),
  );
  return entry ? entry.slice('NEXT_PUBLIC_APP_VERSION='.length) || null : null;
}

function authorized(header, token) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(
    digest(typeof header === 'string' ? header : ''),
    digest(`Bearer ${token}`),
  );
}

function healthResult(container, expectedImage, runningSince, now) {
  const state = container.State;
  if (container.Image !== expectedImage)
    return { result: 'failed', runningSince: null };
  if (
    ['exited', 'dead', 'removing'].includes(state.Status) ||
    state.Health?.Status === 'unhealthy'
  ) {
    return { result: 'failed', runningSince: null };
  }
  if (state.Status !== 'running')
    return { result: 'waiting', runningSince: null };
  if (state.Health)
    return {
      result: state.Health.Status === 'healthy' ? 'ready' : 'waiting',
      runningSince: null,
    };
  const identity = `${container.Id}:${state.StartedAt}:${container.RestartCount}`;
  const since =
    runningSince?.identity === identity ? runningSince : { identity, at: now };
  return {
    result: now - since.at >= 20000 ? 'ready' : 'waiting',
    runningSince: since,
  };
}

module.exports = {
  ACTIVE_PHASES,
  transition,
  isFixedImage,
  parseComposeLabels,
  composeArgs,
  imageVersion,
  authorized,
  healthResult,
};
