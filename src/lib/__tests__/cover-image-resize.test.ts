/**
 * @jest-environment node
 */
import {
  downloadAndResizeCoverImage,
  MAX_COVER_IMAGE_BYTES,
  resizeCoverImage,
} from '@/lib/cover-image-resize';
import { ResourceLimitError } from '@/lib/server-resource-errors';

jest.mock('server-only', () => ({}));

const pendingTranscodes: Array<() => void> = [];

jest.mock('sharp', () => ({
  __esModule: true,
  default: (_source: Buffer, options: { limitInputPixels: number }) => {
    expect(options.limitInputPixels).toBe(25_000_000);
    const pipeline = {
      rotate: () => pipeline,
      resize: () => pipeline,
      webp: () => pipeline,
      toBuffer: () =>
        new Promise<Buffer>((resolve) => {
          pendingTranscodes.push(() => resolve(Buffer.from([1])));
        }),
    };
    return pipeline;
  },
}));

async function flushMicrotasks() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

it('转码并发与排队均有上限，超出时报繁忙', async () => {
  const options = { width: 300, quality: 75 };
  const accepted = Array.from({ length: 4 + 16 }, () =>
    resizeCoverImage(new ArrayBuffer(8), options),
  );
  await flushMicrotasks();
  expect(pendingTranscodes).toHaveLength(4);

  await expect(
    resizeCoverImage(new ArrayBuffer(8), options),
  ).rejects.toBeInstanceOf(ResourceLimitError);

  while (pendingTranscodes.length > 0) {
    pendingTranscodes.shift()?.();
    await flushMicrotasks();
  }
  await expect(Promise.all(accepted)).resolves.toHaveLength(20);
});

it('reserves source bytes before downloading and releases failed reservations', async () => {
  const rejectors: Array<(error: Error) => void> = [];
  const download = jest.fn(
    () =>
      new Promise<ArrayBuffer>((_resolve, reject) => rejectors.push(reject)),
  );
  const tasks = Array.from({ length: 6 }, () =>
    downloadAndResizeCoverImage(download, { width: 300, quality: 75 }).catch(
      () => null,
    ),
  );
  const overflow = jest.fn();
  await expect(
    downloadAndResizeCoverImage(overflow, { width: 300, quality: 75 }),
  ).rejects.toMatchObject({ status: 503, retryAfterSeconds: 2 });
  expect(overflow).not.toHaveBeenCalled();
  expect(download).toHaveBeenCalledTimes(6);
  rejectors.forEach((reject) => reject(new Error('download failed')));
  await Promise.all(tasks);
  const retry = downloadAndResizeCoverImage(async () => new ArrayBuffer(8), {
    width: 300,
    quality: 75,
  });
  await flushMicrotasks();
  pendingTranscodes.shift()?.();
  await expect(retry).resolves.toBeInstanceOf(ArrayBuffer);
});

it('keeps full-size sources charged during transcode and shrinks small reservations', async () => {
  const tasks = Array.from({ length: 6 }, () =>
    downloadAndResizeCoverImage(
      async () => new ArrayBuffer(MAX_COVER_IMAGE_BYTES),
      { width: 300, quality: 75 },
    ),
  );
  await flushMicrotasks();
  const overflow = jest.fn();
  await expect(
    downloadAndResizeCoverImage(overflow, { width: 300, quality: 75 }),
  ).rejects.toBeInstanceOf(ResourceLimitError);
  expect(overflow).not.toHaveBeenCalled();
  while (pendingTranscodes.length) {
    pendingTranscodes.shift()?.();
    await flushMicrotasks();
  }
  await Promise.all(tasks);
  const small: Promise<ArrayBuffer>[] = [];
  for (let index = 0; index < 20; index++) {
    small.push(
      downloadAndResizeCoverImage(async () => new ArrayBuffer(8), {
        width: 300,
        quality: 75,
      }),
    );
    await flushMicrotasks();
  }
  await expect(
    downloadAndResizeCoverImage(overflow, { width: 300, quality: 75 }),
  ).rejects.toBeInstanceOf(ResourceLimitError);
  expect(overflow).not.toHaveBeenCalled();
  while (pendingTranscodes.length) {
    pendingTranscodes.shift()?.();
    await flushMicrotasks();
  }
  await expect(Promise.all(small)).resolves.toHaveLength(20);
});
