// Set NEXT_PUBLIC_API_URL in .env.local to your deployed admin project, e.g. https://exammate-admin.vercel.app
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
// Optional: where students go to get a license (a WhatsApp link, website, mailto:...).
export const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL || '';
