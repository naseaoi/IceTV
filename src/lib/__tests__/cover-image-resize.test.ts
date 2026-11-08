/**
 * @jest-environment node
 */
import { resizeCoverImage } from '@/lib/cover-image-resize';
import { ResourceLimitError } from '@/lib/server-resource-errors';

jest.mock('server-only', () => ({}));

const pendingTranscodes: Array<() => void> = [];

jest.mock('sharp', () => ({
  __esModule: true,
  default: () => {
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
