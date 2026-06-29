import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import {
  getSignatureData,
  parseAuthCookieValue,
  verifySignature,
} from '@/lib/auth';
import { getConfig, getPublicConfig } from '@/lib/config';
import { getOwnerPassword, getOwnerUsername } from '@/lib/env.server';

import LivePageClient from './LivePageClient';

export default async function LivePage() {
  const config = await getPublicConfig();

  if (!config.EnableLiveEntry) {
    notFound();
  }

  if (!(await isAuthenticatedLiveViewer())) {
    redirect('/login?redirect=%2Flive');
  }

  return <LivePageClient />;
}

async function isAuthenticatedLiveViewer(): Promise<boolean> {
  const cookieStore = await cookies();
  const authInfo = parseAuthCookieValue(cookieStore.get('auth')?.value || '');

  if (!authInfo?.username || !authInfo.expiresAt || !authInfo.signature) {
    return false;
  }

  if (Date.now() > authInfo.expiresAt) {
    return false;
  }

  const validSignature = await verifySignature(
    getSignatureData('account', authInfo.expiresAt, authInfo.username),
    authInfo.signature,
    getOwnerPassword(),
  );

  if (!validSignature) {
    return false;
  }

  if (authInfo.username === getOwnerUsername()) {
    return true;
  }

  const fullConfig = await getConfig();
  const user = fullConfig.UserConfig.Users.find(
    (entry) => entry.username === authInfo.username,
  );

  return Boolean(user && !user.banned);
}
