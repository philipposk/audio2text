# Legacy standalone Vercel functions (superseded)

These were the original per-endpoint Vercel serverless functions. They are now
fully replaced by the Express app served through `api/index.js` (which has the
current logic: Groq Whisper, glossary priming, all new endpoints, etc.).

They were moved here because, while in `api/`, Vercel routed `/api/health`,
`/api/transcribe`, etc. to these stale files instead of the Express app —
shadowing the real handlers. Preserved for reference; do not put back in `api/`.
