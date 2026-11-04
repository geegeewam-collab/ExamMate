# ExamMate 2.1.7 — Release Validation

## Changes covered

- Shared natural student-answering policy is included in examination-answer prompts and Voice Ask prompts.
- Quick mode remains concise while allowing complete, practical points.
- Learn mode adds working, clarification or examples contextually instead of forcing generic `Method:` and `Example:` sections.
- Existing API response schemas, reader-control actions, answer-line parsing and native release metadata remain unchanged apart from the version/build increment.

## Checks completed

- TypeScript compilation of the server API regression tests and native release-metadata tests: passed.
- Server API and native release-metadata test run: **64 passed, 0 failed**.
- Prompt construction checks: both Quick and Learn include the shared policy; Learn no longer forces a `Method:` section; Voice Ask includes the same policy.
- Version metadata checks: package and lockfile are 2.1.7; Android local fallback is versionCode 9 / versionName 2.1.7; iOS generated build number is 9.

## Checks not completed in this environment

- A full `npm ci` could not complete because the npm registry hostname did not resolve (`EAI_AGAIN`). The project dependencies were therefore unavailable for the complete repository test suite and Next.js production build.
- A signed Android APK build was not run.
- No live Gemini request was made. The prompt and API integration are regression-tested, but final answer-style quality should still be checked with the production Gemini model and representative examination questions before public rollout.

The completed checks validate the changed server paths and their API contracts; they are not a substitute for the full dependency-installed CI and device release checks.
