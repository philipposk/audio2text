# Translator

Translator is a website that turns audio into written text and then translates it. You give it a recording (a file you upload, a link to a YouTube/Vimeo video, or even your live microphone) and it writes out everything that was said. From there it can translate that text into another language, clean it up, or turn it into subtitles for a video. It is meant for anyone who needs spoken words turned into accurate, editable, shareable text without doing it by hand.

(The folder is named "audio2text", but the app itself is called Translator.)

## What it does
- Listens to a recording and writes down what was said.
- Works with lots of audio types and even video links (YouTube, Vimeo, SoundCloud).
- Translates the written text into more than 25 languages.
- Can translate directly from another language into English.
- Makes real subtitles for videos and can even burn them onto the video.
- Lets you tidy up or rewrite the text with an AI helper.
- Saves a history of everything you've transcribed so you can find it later.
- Exports the result as a Word doc, PDF, plain text, or subtitle file.
- Can label who said what when there are multiple speakers.

## Status
Working app. It's a website you run in your browser, backed by a server that does the listening and translating.

---
### For developers
Node.js app. Backend is Express (`server/index.js`), with a React + Vite frontend (`client/`, built to `dist/`). Transcription uses the OpenAI Whisper API with a local Whisper fallback; translation/chat auto-selects between Groq and OpenAI. Job history is stored via lowdb (in-memory on Vercel). Speaker separation (diarization) runs through Replicate. Live mic streaming over WebSocket at `/api/live`.

Run locally:
```bash
npm install
cp .env.example .env   # set OPENAI_API_KEY and/or GROQ_API_KEY
npm run dev            # backend + Vite dev server
npm test               # vitest + supertest
```
Health check: http://localhost:3000/api/health. Full REST API reference, auth/quota model, and deployment notes are in the project's `docs/deployment/` folder and the git history. Deployable via Docker (`Dockerfile`, `docker-compose.yml`) or Vercel (`vercel.json`, mirrored serverless handlers in `api/`). License: MIT.
