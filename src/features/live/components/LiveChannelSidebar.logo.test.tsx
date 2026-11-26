import { fireEvent, render, screen } from '@testing-library/react';

import { ChannelLogoImage } from './LiveChannelSidebar';

it('HTTPS 直连失败后回落代理，再失败显示占位并在重新挂载时复用失败记忆', () => {
  const props = {
    url: 'https://logos.example/channel.png',
    name: '频道',
    source: 'live',
  };
  const first = render(<ChannelLogoImage {...props} />);
  expect(screen.getByRole('img').getAttribute('src')).toBe(props.url);
  expect(screen.getByRole('img').getAttribute('referrerpolicy')).toBe(
    'no-referrer',
  );
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('img').getAttribute('src')).toContain(
    '/api/proxy/logo?',
  );
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).toBeNull();
  expect(first.container.querySelector('svg')).not.toBeNull();
  first.unmount();
  render(<ChannelLogoImage {...props} />);
  expect(screen.queryByRole('img')).toBeNull();
});

it('HTTP 台标直接走代理，缺台标显示占位', () => {
  const first = render(
    <ChannelLogoImage
      url='http://logos.example/http.png'
      name='频道'
      source='live'
    />,
  );
  expect(screen.getByRole('img').getAttribute('src')).toContain(
    '/api/proxy/logo?',
  );
  first.unmount();
  const empty = render(<ChannelLogoImage url='' name='频道' source='live' />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(empty.container.querySelector('svg')).not.toBeNull();
});
