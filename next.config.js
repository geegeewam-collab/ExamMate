/** @type {import('next').NextConfig} */

// Two builds from one codebase:
//  - Website + server on Vercel (normal `next build`): serves the app, /admin and /api/*.
//  - Android app (`npm run cap:sync`): a static export in ./out, built by scripts/export.mjs with EXPORT=1.
const exportBuild = process.env.EXPORT === '1';

module.exports = exportBuild
  ? { output: 'export', distDir: 'out', images: { unoptimized: true } }
  : {
      images: { unoptimized: true },
      // Baseline browser protections for the hosted web app. The native APK uses its own WebView origin.
      async headers() {
        return [{
          source: '/:path*',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
          ],
        }];
      },
    };
