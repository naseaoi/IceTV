import {
  buildPlayPagePath,
  parsePlayPagePath,
  readCurrentPlayReturnTo,
  replacePlayPageUrl,
} from '@/features/play/lib/playPageUrl';
import {
  readPlayReturnTo,
  rememberPlayReturnTo,
} from '@/lib/navigation-return';

function visit(url: string) {
  window.history.replaceState(null, '', url);
}

describe('播放页短地址', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('源与编号编码后放入路径，解析时还原', () => {
    const target = { source: 'a/b', id: '编号?x=1' };
    const path = buildPlayPagePath(target);

    expect(path).toBe('/play/a%2Fb/%E7%BC%96%E5%8F%B7%3Fx%3D1');
    expect(parsePlayPagePath(path)).toEqual(target);
    expect(parsePlayPagePath('/play')).toBeNull();
    expect(parsePlayPagePath('/play/a/b/c')).toBeNull();
    expect(parsePlayPagePath('/play/a/%E0%A4%A')).toBeNull();
  });

  it('源或编号是点号路径段时保留查询式地址，避免被地址规范化折叠', () => {
    visit('/play?source=..&id=.&title=x');

    replacePlayPageUrl({ source: '..', id: '.' });

    expect(window.location.pathname).toBe('/play');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('source')).toBe('..');
    expect(params.get('id')).toBe('.');
    expect(params.has('title')).toBe(false);
  });

  it('带来源的入口记下来源，刷新短地址后仍能读到', () => {
    visit('/play?source=a&id=1&title=x&returnTo=%2Fsearch%3Fq%3Dx');

    replacePlayPageUrl({ source: 'a', id: '1' });

    expect(window.location.pathname).toBe('/play/a/1');
    expect(readCurrentPlayReturnTo()).toBe('/search?q=x');
  });

  it('不带来源的新入口清掉同一播放页的旧来源', () => {
    rememberPlayReturnTo('/play/a/1', '/lists');
    visit('/play?source=a&id=1&title=x');

    replacePlayPageUrl({ source: 'a', id: '1' });

    expect(readCurrentPlayReturnTo()).toBeNull();
    expect(readPlayReturnTo('/play/a/1')).toBeNull();
  });

  it('短地址上换源时来源随播放页迁移', () => {
    rememberPlayReturnTo('/play/a/1', '/search?q=x');
    visit('/play/a/1?tab=reviews');

    replacePlayPageUrl({ source: 'b', id: '2' });

    expect(window.location.pathname).toBe('/play/b/2');
    expect(window.location.search).toBe('?tab=reviews');
    expect(readPlayReturnTo('/play/b/2')).toBe('/search?q=x');
  });
});
