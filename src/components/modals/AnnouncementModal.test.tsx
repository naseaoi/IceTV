import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import AnnouncementModal from '@/components/modals/AnnouncementModal';

jest.mock('@/components/modals/ModalShell', () => ({
  __esModule: true,
  default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));

describe('AnnouncementModal', () => {
  it('保留公告文本换行并按纯文本渲染', () => {
    render(
      <AnnouncementModal
        isOpen
        message={'第一行\n<script>alert(1)</script>\n第二行'}
        onClose={jest.fn()}
      />,
    );

    const message = screen.getByText(
      (_, element) =>
        element?.textContent === '第一行\n<script>alert(1)</script>\n第二行',
    );

    expect(message).toHaveClass('whitespace-pre-line');
    expect(message.querySelector('script')).toBeNull();
  });
});
