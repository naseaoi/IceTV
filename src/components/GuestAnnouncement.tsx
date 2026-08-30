'use client';

import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import AnnouncementModal from '@/components/modals/AnnouncementModal';
import { useSite } from '@/components/SiteProvider';
import {
  readSeenAnnouncement,
  writeSeenAnnouncement,
} from '@/lib/local-preferences';

export default function GuestAnnouncement() {
  const { session } = useAuthSession();
  const { announcement } = useSite();
  const [isOpen, setIsOpen] = useState(false);

  const isGuest = session.status === 'guest';

  useEffect(() => {
    if (!isGuest || !announcement) {
      setIsOpen(false);
      return;
    }

    setIsOpen(readSeenAnnouncement() !== announcement);
  }, [announcement, isGuest]);

  if (!isGuest || !announcement) {
    return null;
  }

  const handleClose = () => {
    setIsOpen(false);
    writeSeenAnnouncement(announcement);
  };

  return (
    <AnnouncementModal
      isOpen={isOpen}
      message={announcement}
      onClose={handleClose}
    />
  );
}
