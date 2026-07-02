import { hashPassword, verifyPassword } from '../password';

describe('password hashing', () => {
  it('hashes and verifies bcrypt passwords', async () => {
    const hashed = await hashPassword('secret-pass');

    expect(hashed).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
    await expect(verifyPassword('secret-pass', hashed)).resolves.toEqual({
      match: true,
      needsRehash: false,
    });
    await expect(verifyPassword('wrong-pass', hashed)).resolves.toEqual({
      match: false,
      needsRehash: false,
    });
  });

  it('keeps legacy plain password compatibility', async () => {
    await expect(verifyPassword('legacy-pass', 'legacy-pass')).resolves.toEqual(
      {
        match: true,
        needsRehash: true,
      },
    );
    await expect(verifyPassword('wrong-pass', 'legacy-pass')).resolves.toEqual({
      match: false,
      needsRehash: false,
    });
  });

  it('verifies bcrypt 2y hashes', async () => {
    const hashed = await hashPassword('secret-pass');
    const phpStyleHash = hashed.replace(/^\$2[ab]\$/, '$2y$');

    await expect(verifyPassword('secret-pass', phpStyleHash)).resolves.toEqual({
      match: true,
      needsRehash: false,
    });
    await expect(verifyPassword('wrong-pass', phpStyleHash)).resolves.toEqual({
      match: false,
      needsRehash: false,
    });
  });
});
