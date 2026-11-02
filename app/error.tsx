'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep diagnostics local to the console; do not expose provider or server details in the interface.
    console.error('ExamMate screen error', error);
  }, [error]);

  return (
    <main className="app-error" role="alert">
      <section className="app-error-card">
        <div className="app-error-mark" aria-hidden="true">✦</div>
        <h1>Something interrupted ExamMate</h1>
        <p>The screen encountered an unexpected problem. Try loading it again. Your saved text and reading position may still be available.</p>
        <div className="app-error-actions">
          <button className="btn primary" onClick={() => reset()}>Try again</button>
          <a className="btn secondary" href="/">Return to Read</a>
        </div>
      </section>
    </main>
  );
}
