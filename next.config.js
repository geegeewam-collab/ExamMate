/** @type {import('next').NextConfig} */

// Two builds from one codebase:
//  - Website + server on Vercel (normal `next build`): serves the app, /admin and /api/*.
//  - Android app (`npm run cap:sync`): a static export in ./out, built by scripts/export.mjs with EXPORT=1.
const exportBuild = process.env.EXPORT === '1';

module.exports = exportBuild
  ? { output: 'export', distDir: 'out', images: { unoptimized: true } }
  : { images: { unoptimized: true } };
