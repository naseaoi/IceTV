'use client';

import { useState } from 'react';

interface ExpandableTextProps {
  text: string;
  // 折叠时展示的行数；超过 maxChars 字或 lines 行才出现展开按钮
  lines?: number;
  maxChars?: number;
  className?: string;
  buttonClassName?: string;
  collapseLabel?: string;
}

export default function ExpandableText({
  text,
  lines = 4,
  maxChars = 160,
  className = '',
  buttonClassName = '',
  collapseLabel = '收起',
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.length > maxChars || text.split('\n').length > lines;
  const clamped = collapsible && !expanded;

  return (
    <>
      <p
        className={`whitespace-pre-wrap break-words ${className}`}
        style={
          clamped
            ? {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: lines,
                overflow: 'hidden',
              }
            : undefined
        }
      >
        {text}
      </p>
      {collapsible && (
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setExpanded((previous) => !previous)}
          className={
            buttonClassName ||
            'mt-1 text-xs font-medium text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
          }
        >
          {expanded ? collapseLabel : '展开全文'}
        </button>
      )}
    </>
  );
}
