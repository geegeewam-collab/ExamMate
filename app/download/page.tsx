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

          <h2 className="dl-platform" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>On Android</h2>
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

          <h2 className="dl-platform" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 10 }}>On iPhone</h2>
          <p className="notice">Apple does not allow apps to be installed from a download link, so on iPhone you add Exam Mate to your Home Screen from Safari. It opens full screen like a normal app.</p>
          <a className="btn secondary lg" href="/">Open Exam Mate in Safari</a>
          <ol className="steps">
            <li><span className="step-num">1</span><div><b>Tap the Share button</b><p>It is the square with an arrow pointing up, at the bottom of Safari.</p></div></li>
            <li><span className="step-num">2</span><div><b>Tap Add to Home Screen, then Add</b><p>Scroll down in the Share menu if you do not see it.</p></div></li>
            <li><span className="step-num">3</span><div><b>Open Exam Mate from your Home Screen</b><p>Enter your license key. You only do this once.</p></div></li>
          </ol>

          <a className="link" href="/">Prefer the browser? Open the web version</a>
          {SUPPORT_URL && <a className="link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">Need a license key? Contact the seller</a>}
        </section>
      </main>
    </>
  );
}
