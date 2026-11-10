import ProfilePageClient from '@/features/profile/ProfilePageClient';
import { getInitialProfileView } from '@/lib/user-profile.server';

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  const initialProfile = await getInitialProfileView(profileId);
  return (
    <ProfilePageClient
      key={profileId}
      profileId={profileId}
      initialProfile={initialProfile}
    />
  );
}
