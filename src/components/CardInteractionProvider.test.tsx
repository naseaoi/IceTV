import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import {
  CardInteractionProvider,
  useCardInteractionManager,
} from '@/components/CardInteractionProvider';

jest.mock('@/components/card-actions/CardActionOverlay', () => ({
  __esModule: true,
  default: ({
    isOpen,
    onClose,
    title,
    actions,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    actions: import('@/components/card-actions/actions').CardAction[];
  }) =>
    isOpen ? (
      <div>
        {actions.map((action) => (
          <button
            key={action.id}
            disabled={action.disabled}
            onClick={() => {
              void action.onClick();
              onClose();
            }}
          >
            {action.label}
          </button>
        ))}
        <button type='button' onClick={onClose}>
          关闭 {title}
        </button>
      </div>
    ) : null,
}));

jest.mock('@/components/modals/ConfirmModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/lib/db.client', () => ({
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  getAllFavorites: jest.fn().mockResolvedValue({}),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

function ActionSheetHarness() {
  const { showActionSheet } = useCardInteractionManager();
  const [closedOwners, setClosedOwners] = useState<string[]>([]);

  const open = (ownerId: string) => {
    showActionSheet(ownerId, { title: ownerId, actions: [] }, () =>
      setClosedOwners((current) => [...current, ownerId]),
    );
  };

  return (
    <>
      <button type='button' onClick={() => open('first')}>
        打开第一个
      </button>
      <button type='button' onClick={() => open('second')}>
        打开第二个
      </button>
      <output>{closedOwners.join(',')}</output>
    </>
  );
}

describe('CardInteractionProvider', () => {
  it('closes and replaces action sheets outside state updater rendering', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    try {
      render(
        <CardInteractionProvider>
          <ActionSheetHarness />
        </CardInteractionProvider>,
      );

      fireEvent.click(screen.getByText('打开第一个'));
      fireEvent.click(screen.getByText('打开第二个'));
      expect(screen.getByText('first')).toBeInTheDocument();

      fireEvent.click(screen.getByText('关闭 second'));
      expect(screen.getByText('first,second')).toBeInTheDocument();
      expect(
        consoleError.mock.calls.some((call) =>
          String(call[0]).includes('Cannot update a component'),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});

it.each(['favorite', 'tracking', 'mark-update-read', 'delete'])(
  '菜单关闭和更换卡片实例后 %s 锁保持，导航可用',
  async (operation) => {
    let finish!: () => void;
    const mutate = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const navigate = jest.fn();
    function Harness() {
      const { showActionSheet } = useCardInteractionManager();
      return (
        <button
          onClick={() =>
            showActionSheet(String(Math.random()), {
              objectKey: 'src+1',
              title: '作品',
              actions: [
                { id: operation, label: '操作', icon: null, onClick: mutate },
                { id: 'play', label: '播放', icon: null, onClick: navigate },
              ],
            })
          }
        >
          打开
        </button>
      );
    }
    render(
      <CardInteractionProvider>
        <Harness />
      </CardInteractionProvider>,
    );
    fireEvent.click(screen.getByText('打开'));
    fireEvent.click(screen.getByText('操作'));
    fireEvent.click(screen.getByText('打开'));
    expect(screen.getByText('操作')).toBeDisabled();
    fireEvent.click(screen.getByText('操作'));
    fireEvent.click(screen.getByText('播放'));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    fireEvent.click(screen.getByText('打开'));
    expect(screen.getByText('操作')).toBeEnabled();
  },
);
