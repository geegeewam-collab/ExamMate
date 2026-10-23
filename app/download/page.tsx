import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Download Exam Mate',
  description: 'Get Exam Mate on your phone.',
};

// Where the APK lives. On Vercel this is worked out from your GitHub repo automatically
// (latest GitHub Release, file ExamMate.apk). Override with NEXT_PUBLIC_APK_URL if needed.
const owner = process.env.VERCEL_GIT_REPO_OWNER;
const repo = process.env.VERCEL_GIT_REPO_SLUG;
const APK_URL =
  process.env.NEXT_PUBLIC_APK_URL ||
  (owner && repo ? `https://github.com/${owner}/${repo}/releases/latest/download/ExamMate.apk` : '');
const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL || '';

export default function Download() {
  return (
    <>
      <div className="bg" aria-hidden="true" />
      <main className="auth">
        <section className="glass auth-card dl">
          <div className="logo"><img src="/icon-256.png" alt="" width={84} height={84} /></div>
          <h1>Exam Mate</h1>
          <p className="sub">Snap the questions. It reads the answers slowly so you can write them down.</p>

          {APK_URL ? (
            <a className="btn primary lg" href={APK_URL}>Download for Android</a>
          ) : (
            <p className="notice">The Android download link is not set up yet.</p>
          )}

          <ol className="steps">
            <li><span className="step-num">1</span><div><b>Download and open the file</b><p>If your phone asks, allow installs from your browser or Files app.</p></div></li>
            <li><span className="step-num">2</span><div><b>Install it</b><p>If Play Protect says the app is unrecognised, tap More details, then Install anyway.</p></div></li>
            <li><span className="step-num">3</span><div><b>Open Exam Mate and enter your license key</b><p>You only do this once.</p></div></li>
          </ol>

          <a className="link" href="/">On iPhone, or prefer the browser? Open the web version</a>
          {SUPPORT_URL && <a className="link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">Need a license key? Contact the seller</a>}
        </section>
      </main>
    </>
  );
}
