import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CMS Multi-tenant',
  description: 'Sistema de gestão de conteúdo multi-tenant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
