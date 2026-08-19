import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import {
  CardInteractionProvider,
  useCardInteractionManager,
} from '@/components/CardInteractionProvider';

jest.mock('@/components/MobileActionSheet', () => ({
  __esModule: true,
  default: ({
    isOpen,
    onClose,
    title,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
  }) =>
    isOpen ? (
      <button type='button' onClick={onClose}>
        关闭 {title}
      </button>
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
