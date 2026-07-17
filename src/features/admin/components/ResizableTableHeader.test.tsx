import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY } from '@/lib/local-preferences';

import { ResizableTableHeader } from './ResizableTableHeader';

describe('ResizableTableHeader', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: jest.fn(),
    });
  });

  function renderHeader() {
    render(
      <table>
        <thead>
          <tr>
            <ResizableTableHeader
              tableId='source-list'
              columnId='name'
              defaultWidth={160}
              minWidth={96}
            >
              名称
            </ResizableTableHeader>
            <ResizableTableHeader
              tableId='source-list'
              columnId='status'
              defaultWidth={120}
              minWidth={88}
              hideDivider
            >
              状态
            </ResizableTableHeader>
          </tr>
        </thead>
      </table>,
    );
    const nameHeader = screen.getByText('名称').closest('th')!;
    const statusHeader = screen.getByText('状态').closest('th')!;
    jest
      .spyOn(nameHeader, 'getBoundingClientRect')
      .mockReturnValue({ width: 160 } as DOMRect);
    jest
      .spyOn(statusHeader, 'getBoundingClientRect')
      .mockReturnValue({ width: 120 } as DOMRect);
    return { nameHeader, statusHeader };
  }

  function firePointerEvent(
    element: HTMLElement,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    clientX: number,
  ) {
    const event = new MouseEvent(type, { bubbles: true, clientX });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(element, event);
  }

  it('restores a stored column width', async () => {
    localStorage.setItem(
      ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify({ 'source-list': { name: 240 } }),
    );

    const { nameHeader } = renderHeader();

    await waitFor(() => expect(nameHeader).toHaveStyle({ width: '240px' }));
  });

  it('resizes inside the table and stores both adjacent columns', () => {
    const { nameHeader, statusHeader } = renderHeader();
    const resizeHandle = screen.getByRole('button', { name: '调整名称宽度' });

    firePointerEvent(resizeHandle, 'pointerdown', 100);
    firePointerEvent(resizeHandle, 'pointermove', 124);
    firePointerEvent(resizeHandle, 'pointerup', 124);

    expect(nameHeader).toHaveStyle({ width: '184px' });
    expect(statusHeader).toHaveStyle({ width: '96px' });
    expect(
      JSON.parse(
        localStorage.getItem(ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY) || '{}',
      ),
    ).toEqual({ 'source-list': { name: 184, status: 96 } });
  });

  it('supports keyboard resizing', () => {
    const { nameHeader, statusHeader } = renderHeader();
    const resizeHandle = screen.getByRole('button', { name: '调整名称宽度' });

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });

    expect(nameHeader).toHaveStyle({ width: '168px' });
    expect(statusHeader).toHaveStyle({ width: '112px' });
    expect(
      JSON.parse(
        localStorage.getItem(ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY) || '{}',
      ),
    ).toEqual({ 'source-list': { name: 168, status: 112 } });
  });

  it('enforces the minimum width of the adjacent column', () => {
    const { nameHeader, statusHeader } = renderHeader();
    const resizeHandle = screen.getByRole('button', { name: '调整名称宽度' });

    firePointerEvent(resizeHandle, 'pointerdown', 100);
    firePointerEvent(resizeHandle, 'pointermove', 300);

    expect(nameHeader).toHaveStyle({ width: '192px' });
    expect(statusHeader).toHaveStyle({ width: '88px' });
  });
});
