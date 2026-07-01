const ORIGINAL_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;
const ORIGINAL_UPDATE_BRANCH = process.env.NEXT_PUBLIC_UPDATE_BRANCH;

function loadVersionModule() {
  jest.resetModules();
  return require('../version') as typeof import('../version.js');
}

describe('version metadata', () => {
  afterEach(() => {
    if (ORIGINAL_APP_VERSION === undefined) {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
    } else {
      process.env.NEXT_PUBLIC_APP_VERSION = ORIGINAL_APP_VERSION;
    }

    if (ORIGINAL_UPDATE_BRANCH === undefined) {
      delete process.env.NEXT_PUBLIC_UPDATE_BRANCH;
    } else {
      process.env.NEXT_PUBLIC_UPDATE_BRANCH = ORIGINAL_UPDATE_BRANCH;
    }

    jest.resetModules();
  });

  it('uses explicit dev app version and defaults update branch to dev', () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '0.4.2-dev.1';
    delete process.env.NEXT_PUBLIC_UPDATE_BRANCH;

    const { CURRENT_UPDATE_BRANCH, CURRENT_VERSION } = loadVersionModule();

    expect(CURRENT_VERSION).toBe('0.4.2-dev.1');
    expect(CURRENT_UPDATE_BRANCH).toBe('dev');
  });

  it('keeps explicit update branch before inferred branch', () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '0.4.2-dev.1';
    process.env.NEXT_PUBLIC_UPDATE_BRANCH = 'preview';

    const { CURRENT_UPDATE_BRANCH } = loadVersionModule();

    expect(CURRENT_UPDATE_BRANCH).toBe('preview');
  });
});
