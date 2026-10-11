# Slow Reader

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. `npm run dev`, then open http://localhost:3000
4. Push to GitHub, import the repo in Vercel, add the same variables under Project Settings > Environment Variables, then redeploy.

- `GEMINI_API_KEY`: your key from Google AI Studio.
- `READER_PASSCODE`: any passcode you choose. Type it into the page once.
- `GEMINI_MODEL`: optional, defaults to `gemini-2.5-flash`.

Never commit `.env.local`.
