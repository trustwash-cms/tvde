'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';

export interface BookingProfile {
  id: string;
  name: string;
  publicSlug: string | null;
  embedPublicKey: string;
  publishEnabled: boolean;
  ownerUserId: string;
  owner?: { id: string; email: string; role?: string };
}

interface BookingProfileContextValue {
  profiles: BookingProfile[];
  profileId: string | null;
  activeProfile: BookingProfile | null;
  setProfileId: (id: string) => void;
  loading: boolean;
  reloadProfiles: () => void;
}

const BookingProfileContext = createContext<BookingProfileContextValue | null>(null);

function storageKey(workspaceId: string) {
  return `bookings_profile_id:${workspaceId}`;
}

export function BookingProfileProvider({
  workspaceId,
  children,
}: {
  workspaceId: string | null | undefined;
  children: React.ReactNode;
}) {
  const [profiles, setProfiles] = useState<BookingProfile[]>([]);
  const [profileId, setProfileIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setProfileId = useCallback(
    (id: string) => {
      setProfileIdState(id);
      if (workspaceId) {
        localStorage.setItem(storageKey(workspaceId), id);
      }
    },
    [workspaceId]
  );

  const loadProfiles = useCallback(() => {
    if (!workspaceId) {
      setProfiles([]);
      setProfileIdState(null);
      return;
    }

    setLoading(true);
    apiFetch<BookingProfile[]>(
      withWorkspaceQuery(API_PATHS.bookings.profiles, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      setLoading(false);
      if (!res.data?.length) {
        setProfiles([]);
        setProfileIdState(null);
        return;
      }

      setProfiles(res.data);
      const stored = localStorage.getItem(storageKey(workspaceId));
      const match = stored ? res.data.find((p) => p.id === stored) : null;
      setProfileIdState(match?.id ?? res.data[0].id);
    });
  }, [workspaceId]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const activeProfile = profiles.find((p) => p.id === profileId) ?? profiles[0] ?? null;

  const value = useMemo(
    () => ({
      profiles,
      profileId: activeProfile?.id ?? null,
      activeProfile,
      setProfileId,
      loading,
      reloadProfiles: loadProfiles,
    }),
    [profiles, activeProfile, setProfileId, loading, loadProfiles]
  );

  return <BookingProfileContext.Provider value={value}>{children}</BookingProfileContext.Provider>;
}

export function useBookingProfileContext() {
  const ctx = useContext(BookingProfileContext);
  if (!ctx) {
    throw new Error('useBookingProfileContext must be used within BookingProfileProvider');
  }
  return ctx;
}

export function withBookingProfileQuery(
  path: string,
  workspaceId: string | null | undefined,
  profileId: string | null | undefined,
  extra?: Record<string, string | null | undefined>
): string {
  return withWorkspaceQuery(path, workspaceId, {
    ...(profileId ? { profileId } : {}),
    ...extra,
  });
}
