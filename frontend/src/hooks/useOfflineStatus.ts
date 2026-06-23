'use client';

import { useState, useEffect } from 'react';

export interface OfflineStatus {
  isOnline: boolean;
  hasPendingSync: boolean;
}

export function useOfflineStatus(): OfflineStatus {
  const [isOnline, setIsOnline] = useState(true);
  const [hasPendingSync, setHasPendingSync] = useState(false);

  useEffect(() => {
    // Initialize with navigator.onLine
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check for pending sync operations in IndexedDB
    const checkPendingSync = async () => {
      if ('indexedDB' in window) {
        try {
          const { getPendingCount } = await import('@/utils/backgroundSync');
          const count = await getPendingCount();
          setHasPendingSync(count > 0);
        } catch (error) {
          console.error('Error checking pending sync:', error);
        }
      }
    };

    checkPendingSync();

    // Recheck pending sync when coming back online
    window.addEventListener('online', checkPendingSync);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', checkPendingSync);
    };
  }, []);

  return { isOnline, hasPendingSync };
}
