# Translator

Audio → text → translation web app with AI refinement, real subtitle export, URL ingest, and a persistent job history. Backend-first; UI is a separate concern.

## Features

- 🎤 **Multi-format audio**: MP3, WAV, M4A, FLAC, OGG, WEBM, AAC, AMR, 3GP, MP4.
- 🌍 **Transcription**: OpenAI Whisper API (cloud) with automatic fallback to local Whisper.
- 🔄 **Audio translation**: Whisper `translate` task — drops any source language into English audio→text.
- 📝 **Text translation**: `/api/translate` and `/api/translate/batch` for transcript → any of 25+ languages, glossary-aware. Provider auto-selected (Groq preferred, OpenAI fallback).
- ⏱ **Word-level timestamps**: optional `word_timestamps=true` returns OpenAI `verbose_json` word array.
- 🎬 **Real SRT / VTT**: subtitle export uses actual segment timestamps, not a placeholder block.
- 📥 **URL ingest**: paste a YouTube / Vimeo / SoundCloud / direct media URL — server downloads, transcribes, persists.
- 🗄 **Job history**: every transcription/translation is stored (lowdb file on local, in-memory on Vercel) and queryable at `/api/jobs`.
- 💬 **AI chat refinement**: iterative editing via Groq / GPT.
- 📄 **Exports**: TXT, DOCX, PDF, JSON, SRT, VTT — pulls from saved job or from request body.
- 🛡 **Hardening**: rate limits per-IP (60/min global, 10/min heavy endpoints), central error handler, host allowlist on ingest.
- ✅ **Tests**: vitest + supertest. `npm test`.

## Quickstart

```bash
npm install
cp .env.example .env
# fill in OPENAI_API_KEY and/or GROQ_API_KEY
npm run dev    # backend + Vite dev server
npm test       # run backend tests
```

Open http://localhost:3000/api/health to confirm the API is up.

## Backend API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | Service info + which providers are configured |
| POST | `/api/transcribe` | Audio file → transcription or English translation. Form fields: `audio`, `language`, `task=transcribe\|translate`, `word_timestamps`, `prompt` |
| POST | `/api/ingest` | `{ url, task?, language?, word_timestamps? }` — download URL, transcribe |
| POST | `/api/translate` | `{ text, sourceLang?, targetLang, preserveFormatting?, glossary? }` |
| POST | `/api/translate/batch` | `{ items: string[], sourceLang?, targetLang }` — preserves order for subtitles |
| GET  | `/api/translate/languages` | Supported language codes |
| POST | `/api/chat` | Conversational refinement |
| POST | `/api/chat/refine` | One-shot refine with instructions |
| POST | `/api/export/:format` | `{ transcription?, segments?, jobId?, title?, translatedSegments? }`; format ∈ txt/docx/pdf/json/srt/vtt |
| GET  | `/api/jobs?limit=&offset=` | List recent jobs |
| GET  | `/api/jobs/:id` | Full job (with segments) |
| DELETE | `/api/jobs/:id` | Remove a job |
| POST | `/api/summary` | `{ transcription?\|jobId?, kind?, targetLang?, length? }` → `{ tldr, keyPoints, actionItems, topics }` |
| POST | `/api/diarize` | `{ audioUrl, numSpeakers?, language? }` — pyannote via Replicate, persists speaker-labeled segments |
| GET  | `/api/diarize/info` | Whether diarization is enabled + which model |
| POST | `/api/jobs/:id/translate` | Translates every segment of a stored job → new job |
| GET  | `/api/jobs?q=&language=&task=&type=` | Search/filter history |
| WS   | `/api/live?language=&task=` | Live mic transcription. Send binary chunks, `{type:"flush"}` for interim, close for final. |
| POST | `/api/transcribe/batch` | Multi-file upload (≤25), bounded concurrency, returns per-file `{file, jobId, …}` |
| POST | `/api/tasks/transcribe` | Async transcription — returns `{taskId}` immediately. `callbackUrl` POSTed on completion. |
| GET  | `/api/tasks/:id` | Poll async task status |
| POST | `/api/detect-language` | Audio file (Whisper) or `{text}` (LLM) → `{language, name, confidence, method}` |
| POST | `/api/burn` | Multipart `video` + `jobId` (or `srt`) → MP4 with hard-coded subtitles via ffmpeg |
| PATCH | `/api/jobs/:id/speakers` | `{renames, merge}` — relabel/merge diarized speaker tags across all segments |
| POST | `/api/keys` (admin) | Create API key. Admin gated by `ADMIN_API_KEY`. |
| GET  | `/api/keys` (admin) | List keys (masked) |
| DELETE | `/api/keys/:key` (admin) | Revoke a key |
| GET  | `/api/keys/:key/usage` (admin) | Today's seconds + endpoint breakdown |
| GET  | `/api/openapi.json` | Machine-readable spec for codegen / docs |
| POST | `/api/messaging/telegram` | Live Telegram voice-note → transcription reply (set webhook + secret) |
| POST | `/api/messaging/whatsapp` | Twilio WhatsApp inbound → transcription reply (TwiML) |
| POST | `/api/messaging/messenger` | Webhook stub (Phase 3) |

## Auth model

Optional today, enforceable tomorrow:

- Send `x-api-key: tr_xxx` (or `Authorization: Bearer tr_xxx`) on any `/api/*` call.
- Anonymous calls are allowed unless `API_KEYS_REQUIRED=true`.
- Heavy endpoints (`/api/transcribe`, `/api/ingest`, `/api/burn`, `/api/diarize`, `/api/tasks`) deduct audio seconds from the key's daily budget. Default `dailyMinutes=30`. Returns 429 when exceeded.
- `ADMIN_API_KEY` (env) bypasses quotas and unlocks `/api/keys` CRUD.

## Architecture

```
server/
├── index.js              createApp() factory + listen
├── db/index.js           lowdb job store (Memory adapter on Vercel)
├── middleware/
│   ├── rateLimit.js      apiLimiter + heavyLimiter
│   └── errorHandler.js   notFound + errorHandler
├── routes/
│   ├── transcription.js  POST /api/transcribe   (whisper transcribe|translate)
│   ├── translate.js      POST /api/translate    (text translation)
│   ├── ingest.js         POST /api/ingest       (yt-dlp URL → transcribe)
│   ├── chat.js           POST /api/chat         (refine)
│   ├── export.js         POST /api/export/:fmt  (real SRT/VTT from segments)
│   ├── jobs.js           GET  /api/jobs         (history)
│   └── messaging.js      Webhook stubs
└── utils/
    ├── ai.js             chatComplete() — provider auto-select
    ├── transcription.js  Whisper transcribe/translate w/ retry
    └── localTranscription.js  Local Python Whisper fallback
api/                       Vercel serverless mirrors
tests/                     Vitest + supertest
data/translator.json       Local job store (gitignored)
docs/deployment/           DNS/Vercel deploy notes
```

## Roadmap

Backend status:

- ✅ Audio chunking for files > 24MB (ffmpeg-static segments)
- ✅ Speaker diarization via Replicate (pyannote/whisperX) — needs `REPLICATE_API_TOKEN`
- ✅ Live mic streaming over WebSocket `/api/live`
- ✅ Telegram bot wired (voice → transcription reply)
- ✅ Summary endpoint (TL;DR / key points / action items / topics)
- ✅ Subtitle-translate combo (`POST /api/jobs/:id/translate`)
- ✅ API-key auth + per-key daily quota (`API_KEYS_REQUIRED`, `ADMIN_API_KEY`)
- ✅ WhatsApp (Twilio) inbound wired
- ✅ Batch transcription (≤25 files, bounded concurrency)
- ✅ Async job queue with `callbackUrl` webhook
- ✅ Speaker rename + merge (`PATCH /api/jobs/:id/speakers`)
- ✅ Hard-coded subtitle burn-in (`POST /api/burn`)
- ✅ Language detection (audio + text)
- ✅ OpenAPI 3.1 spec served at `/api/openapi.json`
- ✅ Pino structured logging w/ secret redaction
- ✅ ESLint flat config + GitHub Actions CI on Node 20/22
- ⏳ Diarization upload-via-file (Replicate requires public URL; needs S3 presign)
- ⏳ Messenger inbound logic (Telegram + WhatsApp are templates)
- ⏳ Full auth provider (Clerk / Supabase) + Stripe billing

See `docs/deployment/` for DNS/Vercel setup notes.

## License

MIT — see `LICENSE`.
