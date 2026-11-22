const {
  ACTIVE_PHASES,
  transition,
  composeArgs,
  imageVersion,
} = require('./logic');
const docker = require('./docker');

function createUpdater(
  { container = 'icetv', healthTimeout = 240000 } = {},
  dependencies = docker,
) {
  const { runDocker, inspect, discover, waitHealthy } = dependencies;
  let job = { phase: 'idle' };
  let locked = false;
  let prepared = null;
  let activeTarget = null;
  const change = (phase, details) => {
    job = transition(job, phase, details);
  };
  const snapshot = (target) => ({
    capable: target.capable,
    ...(target.reason ? { reason: target.reason } : {}),
    ...(target.target ? { target: target.target } : {}),
    job: { ...job },
  });
  async function status() {
    // 重建期间容器会短暂消失，继续公开已验证的目标与任务状态。
    if (ACTIVE_PHASES.has(job.phase) && activeTarget)
      return snapshot(activeTarget);
    return snapshot(await discover(container));
  }
  const up = (target) =>
    runDocker(composeArgs(target.compose, 'up'), {
      timeout: healthTimeout,
      logOutput: true,
    });

  async function pull(target) {
    try {
      await runDocker(composeArgs(target.compose, 'pull'), {
        timeout: 30 * 60 * 1000,
        logOutput: true,
      });
      const image = await inspect('image', target.target.image);
      if (image.Id === target.imageId) {
        change('up-to-date', {
          message: '当前镜像已是最新，发布镜像可能尚未就绪',
          pulledVersion: imageVersion(image),
        });
      } else {
        prepared = { target, imageId: image.Id };
        change('pulled', {
          message: '新镜像已下载，可重启完成升级',
          pulledVersion: imageVersion(image),
        });
      }
    } catch {
      change('failed', {
        message: '镜像下载失败，请检查镜像仓库连接与 updater 日志',
      });
    } finally {
      locked = false;
    }
  }

  async function restart(target, imageId) {
    try {
      await up(target);
      change('verifying', { message: '正在等待新容器就绪' });
      await waitHealthy(target.compose, imageId, healthTimeout);
      change('succeeded', { message: '升级完成' });
    } catch {
      change('rolling-back', { message: '新容器启动失败，正在回退旧镜像' });
      try {
        await runDocker(['tag', target.imageId, target.target.image], {
          logOutput: true,
        });
        await up(target);
        await waitHealthy(target.compose, target.imageId, healthTimeout);
        change('rolled-back', {
          message:
            '新容器启动失败，已回退旧镜像；如有不可逆数据迁移，请恢复升级前备份',
        });
      } catch {
        change('failed', {
          message:
            '升级及自动回退失败，请检查 updater 日志并手动恢复镜像与数据库备份',
        });
      }
    } finally {
      prepared = null;
      locked = false;
    }
  }

  async function action(name) {
    if (
      locked ||
      ACTIVE_PHASES.has(job.phase) ||
      (name === 'restart' && job.phase !== 'pulled')
    ) {
      return { code: 409, status: await status() };
    }
    // 在第一个 await 前占锁，防止并发动作同时通过目标检查。
    locked = true;
    try {
      const target = await discover(container);
      if (!target.capable) return { code: 409, status: snapshot(target) };
      if (name === 'restart') {
        const localImage = await inspect('image', target.target.image);
        if (
          !prepared ||
          prepared.target.imageId !== target.imageId ||
          JSON.stringify(prepared.target.compose) !==
            JSON.stringify(target.compose) ||
          prepared.target.target.image !== target.target.image ||
          localImage.Id !== prepared.imageId
        ) {
          return {
            code: 409,
            status: {
              ...snapshot(target),
              job: { ...job, message: '目标容器或镜像已变化，请重新下载镜像' },
            },
          };
        }
        activeTarget = target;
        change('restarting', { message: '正在重建容器' });
        const response = snapshot(target);
        void restart(target, prepared.imageId);
        return { code: 200, status: response };
      }
      prepared = null;
      activeTarget = target;
      change('pulling', { message: '正在下载新镜像，当前服务继续运行' });
      const response = snapshot(target);
      void pull(target);
      return { code: 200, status: response };
    } finally {
      if (!ACTIVE_PHASES.has(job.phase)) locked = false;
    }
  }

  return { status, action };
}

module.exports = { createUpdater };
