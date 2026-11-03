'use client';

import type { ComponentProps } from 'react';

import Select from '@/components/Select';

type AdminSelectProps = Omit<ComponentProps<typeof Select>, 'variant'>;

export default function AdminSelect(props: AdminSelectProps) {
  return <Select {...props} variant='field' />;
}
