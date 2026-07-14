'use client';

import { ModuleAccessGuard } from '@/components/module-access-guard';

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return <ModuleAccessGuard moduleKey="calendar">{children}</ModuleAccessGuard>;
}
