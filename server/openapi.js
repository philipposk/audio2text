// Hand-maintained OpenAPI 3.1 spec. Served at /api/openapi.json so frontends
// and codegen tools can introspect the API. Kept here to avoid pulling in a
// full spec generator.

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Translator API',
    version: '2.1.0',
    description: 'Audio → text → translation backend. Supports transcription, translation, diarization, live streaming, subtitle export, and meeting summaries.'
  },
  servers: [
    { url: '/', description: 'Current host' }
  ],
  components: {
    securitySchemes: {
      ApiKeyHeader: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      BearerToken: { type: 'http', scheme: 'bearer' }
    },
    schemas: {
      Segment: {
        type: 'object',
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          text: { type: 'string' },
          speaker: { type: 'string', nullable: true }
        }
      },
      Job: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['transcription', 'translation', 'ingest', 'diarization', 'live', 'telegram', 'whatsapp'] },
          createdAt: { type: 'string', format: 'date-time' },
          language: { type: 'string', nullable: true },
          task: { type: 'string', enum: ['transcribe', 'translate', 'diarize'] },
          duration: { type: 'number', nullable: true },
          text: { type: 'string' },
          segments: { type: 'array', items: { $ref: '#/components/schemas/Segment' } }
        }
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, message: { type: 'string' } }
      }
    }
  },
  security: [{ ApiKeyHeader: [] }, { BearerToken: [] }, {}],
  paths: {
    '/api/health': { get: { summary: 'Service health + provider flags', responses: { 200: { description: 'OK' } } } },

    '/api/transcribe': {
      post: {
        summary: 'Transcribe (or translate→English) an audio file',
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: {
            type: 'object',
            properties: {
              audio: { type: 'string', format: 'binary' },
              task: { type: 'string', enum: ['transcribe', 'translate'], default: 'transcribe' },
              language: { type: 'string', default: 'el' },
              word_timestamps: { type: 'boolean' },
              quality: { type: 'string', enum: ['fast', 'accurate'], default: 'fast', description: 'accurate = Groq whisper-large-v3 / OpenAI gpt-4o-transcribe' },
              prompt: { type: 'string' }
            }, required: ['audio']
          } } }
        },
        responses: { 200: { description: 'Job created' }, 429: { description: 'Quota exceeded' } }
      }
    },

    '/api/transcribe/batch': {
      post: {
        summary: 'Batch transcribe up to 25 files',
        responses: { 200: { description: 'Per-file results' } }
      }
    },

    '/api/translate': {
      post: {
        summary: 'Translate text to a target language',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              sourceLang: { type: 'string' },
              targetLang: { type: 'string' },
              preserveFormatting: { type: 'boolean', default: true },
              glossary: { type: 'object', additionalProperties: { type: 'string' } }
            }, required: ['text', 'targetLang']
          } } }
        },
        responses: { 200: { description: 'Translated text' }, 413: { description: 'Input too long' } }
      }
    },

    '/api/translate/batch': { post: { summary: 'Translate an ordered list of strings (subtitle-safe)' } },
    '/api/translate/languages': { get: { summary: 'List supported language codes' } },

    '/api/ingest': { post: { summary: 'Download URL (YouTube/Vimeo/etc.) and transcribe' } },

    '/api/detect-language': { post: { summary: 'Detect language of audio or text' } },

    '/api/summary': { post: { summary: 'Generate TL;DR + key points + action items; kind=meeting also returns overview, attendees, and per-topic sections (notes + owner-attributed actions)' } },
    '/api/questions': { post: { summary: 'Detect questions raised in a transcript and flag which were left unanswered (jobId or transcription)' } },
    '/api/chapters': { post: { summary: 'Split a transcript into titled topic chapters with start times' } },

    '/api/live/chunk': { post: { summary: 'Transcribe one short live clip (multipart audio); no job created — Vercel-compatible live transcription' } },
    '/api/live/finalize': { post: { summary: 'Persist an accumulated live transcript as a single job' } },
    '/api/diarize': { post: { summary: 'Speaker diarization via Replicate (file upload or audioUrl)' } },
    '/api/diarize/info': { get: { summary: 'Diarization configuration' } },

    '/api/burn': { post: { summary: 'Hardcode subtitles into video' } },

    '/api/share/{token}': { get: { summary: 'Public read-only shared transcript (no auth, transcript fields only)' } },

    '/api/jobs': {
      get: {
        summary: 'List jobs with optional filters',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'language', in: 'query', schema: { type: 'string' } },
          { name: 'task', in: 'query', schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } }
        ],
        responses: { 200: { description: 'Job list' } }
      }
    },
    '/api/jobs/{id}': { get: { summary: 'Get full job with segments' }, delete: { summary: 'Delete a job' } },
    '/api/jobs/{id}/audio': { get: { summary: 'Stream the stored source audio (HTTP range supported)' } },
    '/api/jobs/{id}/segments': { patch: { summary: 'Replace segments (inline transcript editing); re-syncs flat text' } },
    '/api/jobs/{id}/translate': { post: { summary: 'Bulk-translate every segment (optional glossaryId), persist as new job' } },
    '/api/jobs/{id}/speakers': { patch: { summary: 'Rename / merge speaker labels' } },
    '/api/jobs/{id}/ask': { post: { summary: 'Grounded Q&A — answer a question using ONLY this job\'s transcript' } },
    '/api/jobs/{id}/share': { post: { summary: 'Create a public share token' }, delete: { summary: 'Revoke sharing' } },

    '/api/tasks/transcribe': { post: { summary: 'Async transcription (returns taskId)' } },
    '/api/tasks/{id}': { get: { summary: 'Get async task status' } },

    '/api/chat': { post: { summary: 'Conversational refinement' } },
    '/api/chat/refine': { post: { summary: 'One-shot refinement with instructions' } },

    '/api/export/{format}': { post: { summary: 'Export transcript (txt/docx/pdf/json/srt/vtt)' } },

    '/api/messaging/telegram': { post: { summary: 'Telegram webhook' } },
    '/api/messaging/whatsapp': { post: { summary: 'WhatsApp (Twilio) webhook' } },
    '/api/messaging/messenger': { post: { summary: 'Messenger webhook' } },

    '/api/keys': {
      post: { summary: 'Create API key (admin)' },
      get: { summary: 'List API keys (admin, masked)' }
    },
    '/api/keys/{key}': { delete: { summary: 'Revoke API key (admin)' } },
    '/api/keys/{key}/usage': { get: { summary: 'Get today\'s usage for a key (admin)' } }
  }
};
