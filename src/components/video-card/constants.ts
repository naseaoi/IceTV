import type React from 'react';

export const noSelectStyle = {
  WebkitUserSelect: 'none',
  userSelect: 'none',
  WebkitTouchCallout: 'none',
} as React.CSSProperties;

export function preventContextMenu(event: React.MouseEvent) {
  event.preventDefault();
  return false;
}
