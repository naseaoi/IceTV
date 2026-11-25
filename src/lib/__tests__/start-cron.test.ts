/** @jest-environment node */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

function boot() {
  const callbacks: ((res: {
    statusCode: number;
    resume: jest.Mock;
  }) => void)[] = [];
  const intervals: (() => void)[] = [];
  const timeouts: (() => void)[] = [];
  const exit = jest.fn();
  const clearInterval = jest.fn();
  const get = jest.fn((_url, callback) => {
    callbacks.push(callback);
    return { on: jest.fn(), setTimeout: jest.fn(), destroy: jest.fn() };
  });
  let now = 0;
  runInNewContext(readFileSync(path.resolve('start.js'), 'utf8'), {
    require: (id: string) =>
      id === 'http' ? { get } : id === 'path' ? path : {},
    __dirname: process.cwd(),
    process: { env: {}, exit },
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    Date: { now: () => now },
    setInterval: (callback: () => void) => {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval,
    setTimeout: (callback: () => void) => {
      timeouts.push(callback);
    },
  });
  return {
    callbacks,
    intervals,
    timeouts,
    exit,
    clearInterval,
    get,
    setNow: (value: number) => {
      now = value;
    },
  };
}

it('schedules one cron set when overlapping readiness requests both succeed', () => {
  const app = boot();
  app.intervals[0]();
  app.intervals[0]();
  expect(app.get).toHaveBeenCalledTimes(2);
  const res = { statusCode: 200, resume: jest.fn() };
  app.callbacks[0](res);
  app.callbacks[1](res);
  expect(app.timeouts).toHaveLength(3);
  expect(app.clearInterval).toHaveBeenCalledTimes(1);
  expect(res.resume).toHaveBeenCalledTimes(2);
  app.intervals[0]();
  expect(app.get).toHaveBeenCalledTimes(2);
});

it('keeps readiness timeout exit behavior', () => {
  const app = boot();
  app.intervals[0]();
  app.callbacks[0]({ statusCode: 503, resume: jest.fn() });
  app.setNow(120001);
  app.intervals[0]();
  expect(app.exit).toHaveBeenCalledWith(1);
  expect(app.timeouts).toHaveLength(0);
  expect(app.get).toHaveBeenCalledTimes(1);
});
