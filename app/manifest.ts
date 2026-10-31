import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

// Lets people install the website like an app: Chrome "Install app", Safari "Add to Home Screen".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Exam Mate',
    short_name: 'Exam Mate',
    description: 'Snap the questions. Exam Mate reads the answers slowly so you can write them down.',
    start_url: '/',
    display: 'standalone',
    background_color: '#090c0f',
    theme_color: '#090c0f',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
