import { SettingsPageClient } from '@/features/settings/SettingsPageClient';
import { toDisplayText } from '@/lib/display-text';

export function generateMetadata() {
  return { title: toDisplayText('设置') };
}

export default function SettingsPage() {
  return <SettingsPageClient />;
}
