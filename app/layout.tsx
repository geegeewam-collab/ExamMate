import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Exam Mate',
  description: 'Snap the questions. Exam Mate reads the answers slowly so you can write them down.',
  // Lets iPhone users add the site to their Home Screen and open it full screen, like an app.
  appleWebApp: { capable: true, title: 'Exam Mate' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f0eb' },
    { media: '(prefers-color-scheme: dark)', color: '#090c0f' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
