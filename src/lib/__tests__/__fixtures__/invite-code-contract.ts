import {
  type InviteCode,
  MAX_INVITE_CODES,
} from '@/features/admin/services/inviteCodes';
import type { IStorage } from '@/lib/types';
import type { AdminConfig } from '@/types/admin';

const makeCode = (
  code: string,
  extra: Partial<InviteCode> = {},
): InviteCode => ({
  code,
  createdAt: 1,
  expiresAt: Date.now() + 86400000,
  createdBy: 'owner',
  ...extra,
});

export function inviteCodeBatchContract(
  createStorage: () => IStorage,
  reset: (storage: IStorage) => Promise<void> = async () => {},
) {
  let storage: IStorage;
  beforeEach(async () => {
    storage = createStorage();
    await reset(storage);
    await storage.setAdminConfig({ UserConfig: {} } as AdminConfig);
  });
  afterEach(async () => {
    await reset(storage);
  });

  const fill = async (count: number) => {
    const items = Array.from({ length: count }, (_, index) =>
      makeCode(`FILL-${index}`),
    );
    expect(await storage.createInviteCodes(items)).toEqual({
      codes: items.map((item) => item.code),
    });
  };

  it('批量写入全部邀请码并重建失效同名记录', async () => {
    await storage.createInviteCode(makeCode('EXPIRED', { expiresAt: 1 }));
    await storage.createInviteCode(
      makeCode('EXHAUSTED', { maxUses: 1, usedCount: 1 }),
    );
    expect(await storage.countInviteCodes()).toBe(2);
    expect(await storage.countActiveInviteCodes()).toBe(0);
    const items = ['NEW', 'EXPIRED', 'EXHAUSTED'].map((code) =>
      makeCode(code, { maxUses: 3 }),
    );
    expect(await storage.createInviteCodes(items)).toEqual({
      codes: items.map((item) => item.code),
    });
    expect(await storage.countActiveInviteCodes()).toBe(3);
    expect(await storage.getAllInviteCodes()).toEqual(
      expect.arrayContaining(items.map((item) => ({ ...item, usedCount: 0 }))),
    );
    expect(await storage.getAllInviteCodes()).toHaveLength(3);
  });

  it('按余量截断批次且保留截断部分的失效同名记录，满额时拒绝写入', async () => {
    await fill(MAX_INVITE_CODES - 5);
    const expired = makeCode('EXPIRED', { expiresAt: 1, usedCount: 4 });
    await storage.createInviteCode(expired);
    const items = Array.from({ length: MAX_INVITE_CODES }, (_, index) =>
      makeCode(index === 5 ? 'EXPIRED' : `NEW-${index}`),
    );
    expect(await storage.createInviteCodes(items)).toEqual({
      codes: items.slice(0, 5).map((item) => item.code),
    });
    expect(await storage.countActiveInviteCodes()).toBe(MAX_INVITE_CODES);
    const before = await storage.getAllInviteCodes();
    expect(before).toContainEqual(expired);
    expect(await storage.createInviteCodes([makeCode('LAST')])).toBe('limit');
    expect(await storage.getAllInviteCodes()).toEqual(before);
  });

  it('空库一次创建至有效码总上限', async () => {
    await fill(MAX_INVITE_CODES);
    expect(await storage.countActiveInviteCodes()).toBe(MAX_INVITE_CODES);
  });

  it('批中后面的有效码冲突时不插入前面的码且不重建失效记录', async () => {
    await storage.createInviteCode(
      makeCode('EXPIRED', { expiresAt: 1, usedCount: 4 }),
    );
    await storage.createInviteCode(
      makeCode('ACTIVE', { maxUses: 3, usedCount: 1 }),
    );
    const before = await storage.getAllInviteCodes();
    expect(
      await storage.createInviteCodes([
        makeCode('NEW'),
        makeCode('EXPIRED'),
        makeCode('ACTIVE'),
      ]),
    ).toBe('exists');
    expect(await storage.getAllInviteCodes()).toEqual(before);
  });

  it('拒绝批内重复码且一个不写', async () => {
    expect(
      await storage.createInviteCodes([
        makeCode('DUPLICATE'),
        makeCode('DUPLICATE'),
      ]),
    ).toBe('exists');
    expect(await storage.getAllInviteCodes()).toEqual([]);
  });

  it('后面的插入失败时回滚整批及失效同名记录的替换', async () => {
    await storage.createInviteCode(
      makeCode('EXPIRED', { expiresAt: 1, usedCount: 4 }),
    );
    const before = await storage.getAllInviteCodes();
    const broken = {
      ...makeCode('BROKEN'),
      get createdBy(): string {
        throw new Error('invite batch failure');
      },
    };
    await expect(
      storage.createInviteCodes([makeCode('NEW'), makeCode('EXPIRED'), broken]),
    ).rejects.toThrow('invite batch failure');
    expect(await storage.getAllInviteCodes()).toEqual(before);
  });

  it('清理按到期截止时间删除，可选连同已用尽的码', async () => {
    const now = Date.now();
    await storage.createInviteCodes([
      makeCode('OLD', { expiresAt: now - 40 * 86400000 }),
      makeCode('RECENT', { expiresAt: now - 86400000 }),
      makeCode('USED-UP', { maxUses: 1, usedCount: 1 }),
      makeCode('ACTIVE', { maxUses: 2, usedCount: 1 }),
      makeCode('UNLIMITED'),
    ]);
    const page = await storage.queryInviteCodes({});
    expect(page.activeCount).toBe(2);
    expect(page.inactiveCount).toBe(3);

    expect(
      await storage.purgeInviteCodes({
        expiredBefore: now - 30 * 86400000,
        includeExhausted: false,
      }),
    ).toBe(1);
    expect(
      await storage.purgeInviteCodes({
        expiredBefore: now,
        includeExhausted: true,
      }),
    ).toBe(2);
    expect(
      (await storage.getAllInviteCodes()).map((item) => item.code).sort(),
    ).toEqual(['ACTIVE', 'UNLIMITED']);
    expect((await storage.queryInviteCodes({})).inactiveCount).toBe(0);
  });

  it.each([2, 3])(
    '并发批量创建按事务内的剩余 %i 个名额截断',
    async (remaining) => {
      await fill(MAX_INVITE_CODES - remaining);
      const batches = [
        [makeCode('LEFT-A'), makeCode('LEFT-B')],
        [makeCode('RIGHT-A'), makeCode('RIGHT-B')],
      ];
      const results = await Promise.all(
        batches.map((items) => storage.createInviteCodes(items)),
      );
      expect(results.filter((result) => result === 'limit')).toHaveLength(
        remaining === 2 ? 1 : 0,
      );
      const created = results.flatMap((result) =>
        typeof result === 'string' ? [] : result.codes,
      );
      expect(created).toHaveLength(remaining);
      if (remaining === 3) {
        expect(
          results
            .map((result) =>
              typeof result === 'string' ? 0 : result.codes.length,
            )
            .sort(),
        ).toEqual([1, 2]);
      }
      const codes = new Set(
        (await storage.getAllInviteCodes()).map((item) => item.code),
      );
      batches.flat().forEach((item) => {
        expect(codes.has(item.code)).toBe(created.includes(item.code));
      });
      expect(await storage.countActiveInviteCodes()).toBe(MAX_INVITE_CODES);
    },
  );
}
