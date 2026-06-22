// Whisper transcription utilities.
// Supports two tasks:
//   - task: 'transcribe' (default) -> /audio/transcriptions, keeps source language.
//   - task: 'translate'            -> /audio/translations, output is English text.
// Adds word-level timestamp granularities when verbose_json is requested.
// Provider: Groq Whisper preferred for transcription (cheaper/faster), OpenAI
// fallback; OpenAI only for the translate task.

import OpenAI from 'openai';
import fs from 'fs';
import { getGroq } from './ai.js';

let openaiClient = null;
function getOpenAIClient() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000,
      maxRetries: 3
    });
  }
  return openaiClient;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(error) {
  return (
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.cause?.code === 'ECONNRESET' ||
    /Connection|timeout/i.test(error.message || '')
  );
}

/**
 * Transcribe (or translate) an audio file via OpenAI.
 *
 * @param {string} filePath
 * @param {object} options
 * @param {'transcribe'|'translate'} [options.task='transcribe']
 * @param {string} [options.language='el']   - source language hint (ignored for translate)
 * @param {string} [options.prompt='']
 * @param {'json'|'verbose_json'|'text'|'srt'|'vtt'} [options.response_format='verbose_json']
 * @param {Array<'word'|'segment'>} [options.timestamp_granularities=['segment']]
 */
// Transcription models (env-overridable). Groq's whisper-large-v3-turbo is
// ~9x cheaper than OpenAI whisper-1 ($0.04/hr vs $0.36/hr) and faster, so it's
// preferred for the 'transcribe' task. The 'translate' task (audio→English) is
// not supported by Groq's turbo model, so that always uses OpenAI.
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

export async function transcribeAudio(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const fileName = filePath.split('/').pop() || 'audio.mp3';

  const task = options.task === 'translate' ? 'translate' : 'transcribe';
  const response_format = options.response_format || 'verbose_json';
  const granularities = options.timestamp_granularities || ['segment'];

  // Provider attempt order: for transcription, Groq first (cheaper/faster) then
  // OpenAI as fallback. For audio→English translation, OpenAI only.
  const groq = getGroq();
  const openai = getOpenAIClient();
  const providers = [];
  if (task === 'transcribe') {
    if (groq) providers.push({ name: 'groq', client: groq, model: GROQ_TRANSCRIBE_MODEL });
    if (openai) providers.push({ name: 'openai', client: openai, model: OPENAI_TRANSCRIBE_MODEL });
  } else if (openai) {
    providers.push({ name: 'openai', client: openai, model: OPENAI_TRANSCRIBE_MODEL });
  }
  if (providers.length === 0) {
    throw new Error(task === 'translate'
      ? 'Audio translation requires OPENAI_API_KEY.'
      : 'No transcription provider configured. Set GROQ_API_KEY or OPENAI_API_KEY.');
  }

  console.log(`[whisper] file=${fileName} size=${stats.size}B task=${task} providers=${providers.map(p => p.name).join('>')}`);

  let lastError;
  for (const provider of providers) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const fileStream = fs.createReadStream(filePath);
        const params = {
          file: fileStream,
          model: provider.model,
          response_format,
          temperature: 0
        };
        if (options.prompt) params.prompt = options.prompt;

        // The translate endpoint always outputs English and does NOT accept `language`.
        if (task === 'transcribe') {
          // Omit `language` for auto-detect ('auto' or empty). Whisper rejects the
          // literal string 'auto', and forcing a default would mis-transcribe audio
          // in other languages. When omitted, Whisper detects the language itself.
          const lang = options.language;
          if (lang && lang !== 'auto') params.language = lang;
          if (response_format === 'verbose_json') {
            params.timestamp_granularities = granularities;
          }
        }

        const result = task === 'translate'
          ? await provider.client.audio.translations.create(params)
          : await provider.client.audio.transcriptions.create(params);

        console.log(`[whisper] ok provider=${provider.name} attempt=${attempt} task=${task}`);
        return result;
      } catch (error) {
        lastError = error;
        console.error(`[whisper] provider=${provider.name} attempt=${attempt} failed: ${error.message}`);
        // Retry transient errors on the same provider; otherwise fall through to
        // the next provider (so a Groq quota/format issue still hits OpenAI).
        if (attempt < 3 && isRetryable(error)) {
          await sleep(2000 * attempt);
          continue;
        }
        break;
      }
    }
  }
  throw mapError(lastError);
}

function mapError(error) {
  if (!error) return new Error('Transcription failed: unknown error');
  if (error.status === 401) {
    return new Error('Invalid OpenAI API key. Check OPENAI_API_KEY.');
  }
  if (error.status === 429 || /quota|billing|exceeded/i.test(error.message || '')) {
    return new Error('OpenAI API quota exceeded. Visit https://platform.openai.com/account/billing');
  }
  if (/Connection|ECONNREFUSED|ETIMEDOUT/i.test(error.message || error.code || '')) {
    return new Error(`Connection error: ${error.message}`);
  }
  return new Error(`Transcription failed: ${error.message || 'unknown error'}`);
}

/**
 * Re-transcribe with custom prompt instructions (used to steer Whisper toward
 * domain vocabulary on a second pass).
 */
export async function retranscribeAudio(filePath, instructions, options = {}) {
  return transcribeAudio(filePath, {
    ...options,
    prompt: instructions,
    response_format: 'verbose_json'
  });
}
