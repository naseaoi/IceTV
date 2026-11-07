'use client';

import { useState } from 'react';

export function useRetainedValue<T>(
  value: T | null | undefined,
): T | null | undefined {
  const [retained, setRetained] = useState(value);
  if (value != null && value !== retained) {
    setRetained(value);
  }
  return value ?? retained;
}
