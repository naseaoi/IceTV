'use client';

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ThHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  readAdminTableColumnWidth,
  writeAdminTableColumnWidth,
} from '@/lib/local-preferences';

const DEFAULT_MIN_WIDTH = 72;
const DEFAULT_MAX_WIDTH = 1200;
const COLUMN_WIDTH_CHANGE_EVENT = 'admin-table-column-width-change';

interface ResizableTableHeaderProps extends ThHTMLAttributes<HTMLTableCellElement> {
  tableId: string;
  columnId: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  hideDivider?: boolean;
}

interface ColumnWidthChangeDetail {
  tableId: string;
  columnId: string;
  width: number;
}

interface AdjacentColumnResize {
  columnId: string;
  startWidth: number;
  minWidth: number;
  maxWidth: number;
  currentWidth: number;
}

interface ResizeState {
  pointerId: number;
  startX: number;
  startWidth: number;
  adjacent: AdjacentColumnResize;
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

function readColumnLimit(
  cell: HTMLTableCellElement,
  key: 'columnMinWidth' | 'columnMaxWidth',
  fallback: number,
): number {
  const value = Number.parseFloat(cell.dataset[key] || '');
  return Number.isFinite(value) ? value : fallback;
}

function emitColumnWidthChange(detail: ColumnWidthChangeDetail): void {
  window.dispatchEvent(
    new CustomEvent<ColumnWidthChangeDetail>(COLUMN_WIDTH_CHANGE_EVENT, {
      detail,
    }),
  );
}

function freezeCurrentColumnWidths(header: HTMLTableCellElement): void {
  const table = header.closest('table');
  if (!table) {
    return;
  }
  table
    .querySelectorAll<HTMLTableCellElement>(
      'thead tr:first-child > th[data-resizable-column="true"]',
    )
    .forEach((cell) => {
      const tableId = cell.dataset.tableId;
      const columnId = cell.dataset.columnId;
      if (!tableId || !columnId) {
        return;
      }
      const minWidth = readColumnLimit(
        cell,
        'columnMinWidth',
        DEFAULT_MIN_WIDTH,
      );
      const maxWidth = readColumnLimit(
        cell,
        'columnMaxWidth',
        DEFAULT_MAX_WIDTH,
      );
      emitColumnWidthChange({
        tableId,
        columnId,
        width: clampWidth(
          cell.getBoundingClientRect().width,
          minWidth,
          maxWidth,
        ),
      });
    });
}

export function ResizableTableHeader({
  tableId,
  columnId,
  defaultWidth,
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
  hideDivider = false,
  className = '',
  style,
  children,
  ...props
}: ResizableTableHeaderProps) {
  const normalizedDefaultWidth = clampWidth(defaultWidth, minWidth, maxWidth);
  const [width, setWidth] = useState(normalizedDefaultWidth);
  const widthRef = useRef(normalizedDefaultWidth);
  const headerRef = useRef<HTMLTableCellElement>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const bodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(
    null,
  );

  useEffect(() => {
    const storedWidth = readAdminTableColumnWidth(tableId, columnId);
    const nextWidth = clampWidth(
      storedWidth ?? normalizedDefaultWidth,
      minWidth,
      maxWidth,
    );
    widthRef.current = nextWidth;
    setWidth(nextWidth);
  }, [columnId, maxWidth, minWidth, normalizedDefaultWidth, tableId]);

  useEffect(() => {
    const handleColumnWidthChange = (event: Event) => {
      const detail = (event as CustomEvent<ColumnWidthChangeDetail>).detail;
      if (detail.tableId !== tableId || detail.columnId !== columnId) {
        return;
      }
      const nextWidth = clampWidth(detail.width, minWidth, maxWidth);
      widthRef.current = nextWidth;
      setWidth(nextWidth);
    };
    window.addEventListener(COLUMN_WIDTH_CHANGE_EVENT, handleColumnWidthChange);
    return () => {
      window.removeEventListener(
        COLUMN_WIDTH_CHANGE_EVENT,
        handleColumnWidthChange,
      );
      if (bodyStyleRef.current) {
        document.body.style.userSelect = bodyStyleRef.current.userSelect;
        document.body.style.cursor = bodyStyleRef.current.cursor;
      }
    };
  }, [columnId, maxWidth, minWidth, tableId]);

  const prepareResize = (
    pointerId: number,
    startX: number,
  ): ResizeState | null => {
    const header = headerRef.current;
    const adjacent = header?.nextElementSibling;
    if (!(header && adjacent instanceof HTMLTableCellElement)) {
      return null;
    }
    const adjacentColumnId = adjacent.dataset.columnId;
    if (adjacent.dataset.resizableColumn !== 'true' || !adjacentColumnId) {
      return null;
    }

    freezeCurrentColumnWidths(header);
    const adjacentMinWidth = readColumnLimit(
      adjacent,
      'columnMinWidth',
      DEFAULT_MIN_WIDTH,
    );
    const adjacentMaxWidth = readColumnLimit(
      adjacent,
      'columnMaxWidth',
      DEFAULT_MAX_WIDTH,
    );
    const startWidth = clampWidth(
      header.getBoundingClientRect().width,
      minWidth,
      maxWidth,
    );
    const adjacentStartWidth = clampWidth(
      adjacent.getBoundingClientRect().width,
      adjacentMinWidth,
      adjacentMaxWidth,
    );
    widthRef.current = startWidth;
    setWidth(startWidth);
    return {
      pointerId,
      startX,
      startWidth,
      adjacent: {
        columnId: adjacentColumnId,
        startWidth: adjacentStartWidth,
        minWidth: adjacentMinWidth,
        maxWidth: adjacentMaxWidth,
        currentWidth: adjacentStartWidth,
      },
    };
  };

  const applyResizeDelta = (resize: ResizeState, rawDelta: number) => {
    const growLimit = Math.min(
      maxWidth - resize.startWidth,
      resize.adjacent.startWidth - resize.adjacent.minWidth,
    );
    const shrinkLimit = Math.min(
      resize.startWidth - minWidth,
      resize.adjacent.maxWidth - resize.adjacent.startWidth,
    );
    const delta = Math.min(growLimit, Math.max(-shrinkLimit, rawDelta));
    const nextWidth = Math.round(resize.startWidth + delta);
    const adjacentWidth = Math.round(resize.adjacent.startWidth - delta);
    resize.adjacent.currentWidth = adjacentWidth;
    widthRef.current = nextWidth;
    setWidth(nextWidth);
    emitColumnWidthChange({
      tableId,
      columnId: resize.adjacent.columnId,
      width: adjacentWidth,
    });
  };

  const restoreBodyStyle = () => {
    if (!bodyStyleRef.current) {
      return;
    }
    document.body.style.userSelect = bodyStyleRef.current.userSelect;
    document.body.style.cursor = bodyStyleRef.current.cursor;
    bodyStyleRef.current = null;
  };

  const finishResize = () => {
    const resize = resizeRef.current;
    if (!resize) {
      return;
    }
    resizeRef.current = null;
    writeAdminTableColumnWidth(tableId, columnId, widthRef.current);
    writeAdminTableColumnWidth(
      tableId,
      resize.adjacent.columnId,
      resize.adjacent.currentWidth,
    );
    restoreBodyStyle();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const resize = prepareResize(event.pointerId, event.clientX);
    if (!resize) {
      return;
    }
    resizeRef.current = resize;
    bodyStyleRef.current = {
      userSelect: document.body.style.userSelect,
      cursor: document.body.style.cursor,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }
    applyResizeDelta(resize, event.clientX - resize.startX);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const resize = prepareResize(-1, 0);
    if (!resize) {
      return;
    }
    const step = event.shiftKey ? 24 : 8;
    applyResizeDelta(resize, event.key === 'ArrowRight' ? step : -step);
    writeAdminTableColumnWidth(tableId, columnId, widthRef.current);
    writeAdminTableColumnWidth(
      tableId,
      resize.adjacent.columnId,
      resize.adjacent.currentWidth,
    );
  };

  const columnStyle: CSSProperties = {
    ...style,
    width,
    minWidth: width,
    maxWidth: width,
  };

  return (
    <th
      {...props}
      ref={headerRef}
      data-resizable-column='true'
      data-table-id={tableId}
      data-column-id={columnId}
      data-column-min-width={minWidth}
      data-column-max-width={maxWidth}
      className={`relative overflow-hidden whitespace-nowrap ${className}`}
      style={columnStyle}
    >
      {children}
      {!hideDivider && (
        <button
          type='button'
          aria-label={`调整${typeof children === 'string' ? children : '当前列'}宽度`}
          className='absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none select-none before:absolute before:inset-y-1 before:left-1/2 before:w-px before:bg-gradient-to-b before:from-transparent before:via-gray-300 before:to-transparent focus-visible:outline-none focus-visible:before:w-0.5 focus-visible:before:via-blue-500 dark:before:via-gray-600'
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
          onKeyDown={handleKeyDown}
        />
      )}
    </th>
  );
}
