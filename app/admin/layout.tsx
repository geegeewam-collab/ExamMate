import type { ReactNode } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Exam Mate Admin', robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
