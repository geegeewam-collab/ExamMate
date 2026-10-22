# Exam Mate Admin

Deploy this folder as its own Vercel project (Root Directory: `admin`). Full setup is in the main README.

- `/admin` : dashboard (password: `ADMIN_PASSWORD`)
- `POST /api/license/validate` : activate a key on a device
- `POST /api/license/verify` : is this token still valid
- `POST /api/answer` : photos in, answers out (needs a valid license token)
- `npm test` : server tests (no network needed)

Environment variables: see `.env.example`.
