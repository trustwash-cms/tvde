'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  API_PATHS,
  WEB_ROUTES,
  canAccessDashboardArea,
  isDriverRole,
  type Role,
  type UserDocumentItem,
  type UserProfileDetail,
} from '@tvde/shared';
import { UserDocumentsSection } from '@/components/users/user-documents-section';
import { apiFetch, getApiErrorMessage } from '@/lib/api';

export function DocumentosPanel() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  const [documents, setDocuments] = useState<UserDocumentItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const meRes = await apiFetch<{ role: Role }>(API_PATHS.auth.me);
      if (cancelled) return;

      if (!meRes.success || !meRes.data) {
        setError(getApiErrorMessage(meRes));
        setLoading(false);
        return;
      }

      if (!isDriverRole(meRes.data.role) || !canAccessDashboardArea(meRes.data.role, 'documentos')) {
        router.replace(WEB_ROUTES.dashboard.root);
        return;
      }

      const profileRes = await apiFetch<UserProfileDetail>(API_PATHS.users.meProfile);
      if (cancelled) return;

      setLoading(false);

      if (!profileRes.success || !profileRes.data) {
        setError(getApiErrorMessage(profileRes));
        return;
      }

      setUserId(profileRes.data.user.id);
      setDocuments(profileRes.data.documents);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar documentos…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <UserDocumentsSection
      userId={userId}
      documents={documents}
      onDocumentsChange={setDocuments}
      selfMode
      canUpload={false}
      canDelete={false}
      layout="cards"
      showHeader={false}
    />
  );
}
