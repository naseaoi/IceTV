/** @jest-environment node */
import { createLiveLineId } from './liveLineId.server';

it('keeps line identity stable across ordering and subscription whitespace', () => {
  const source = { key: 'source', url: 'https://example.com/list', ua: '' };
  const urls = ['https://live.example/a?sign=1', 'https://live.example/b'];
  const first = urls.map((url) => createLiveLineId(source, url));
  const reordered = [...urls]
    .reverse()
    .map((url) =>
      createLiveLineId(
        { ...source, url: ` ${source.url} `, ua: ' AptvPlayer/1.4.10 ' },
        url,
      ),
    )
    .reverse();
  expect(first).toEqual(reordered);
  expect(first[0]).toMatch(/^[a-f0-9]{20}$/);
  expect(createLiveLineId(source, 'https://live.example/a?sign=2')).not.toBe(
    first[0],
  );
  expect(createLiveLineId({ ...source, ua: 'new-ua' }, urls[0])).not.toBe(
    first[0],
  );
  expect(createLiveLineId({ ...source, key: 'other' }, urls[0])).not.toBe(
    first[0],
  );
  expect(
    createLiveLineId({ ...source, url: `${source.url}2` }, urls[0]),
  ).not.toBe(first[0]);
});
