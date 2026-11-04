# ExamMate 2.1.8 — Release Validation

## Changes

- Increased the photo-read per-call timeout to 36 seconds and total photo-read budget to 50 seconds.
- Increased the answer-call timeout to 35 seconds and the overall request budget to 108 seconds.
- Raised the `/api/answer` route execution allowance to 120 seconds.
- Preserved adaptive client page batching and server-side answer grouping. There is no fixed total paper page or question-count limit in the client flow.
- Natural student-style answer prompts and Voice Ask behavior are unchanged.
- Updated package/lockfile version to 2.1.8; Android default metadata to versionCode 10 / versionName 2.1.8; iOS generated build number to 10.

## Validation results

- Targeted server API and native release-metadata regression suites: **66 passed, 0 failed**. This includes a simulated 120-question paper, grouped answering, retry behavior, the shared natural-answer policy and the updated route-timeout contract.
- TypeScript syntax transpilation for the changed server routes and regression tests: passed.
- Package/lockfile/Android/iOS version metadata consistency checks: passed.

## Not completed in this environment

- Full repository test suite and full Next.js production build: not run. The project dependencies are not installed; `npm ci --offline` could not complete because the required `yauzl` package was not cached.
- A live Gemini image-reading request was not made. Provider latency varies by key, model availability and Google service load.
- Signed Android APK build was not run.
