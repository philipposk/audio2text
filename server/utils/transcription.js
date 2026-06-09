// OpenAI Whisper transcription utilities.
// Supports two tasks:
//   - task: 'transcribe' (default) -> /audio/transcriptions, keeps source language.
//   - task: 'translate'            -> /audio/translations, output is English text.
// Adds word-level timestamp granularities when verbose_json is requested.

import OpenAI from 'openai';
import fs from 'fs';

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

function isHardFail(error) {
  if (error.status === 401 || error.status === 429) return true;
  return /quota|billing|exceeded/i.test(error.message || '');
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
export async function transcribeAudio(filePath, options = {}) {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY.');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const fileName = filePath.split('/').pop() || 'audio.mp3';
  console.log(`[whisper] file=${fileName} size=${stats.size}B task=${options.task || 'transcribe'}`);

  const task = options.task === 'translate' ? 'translate' : 'transcribe';
  const response_format = options.response_format || 'verbose_json';
  const granularities = options.timestamp_granularities || ['segment'];

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const fileStream = fs.createReadStream(filePath);
      const params = {
        file: fileStream,
        model: 'whisper-1',
        response_format,
        temperature: 0
      };
      if (options.prompt) params.prompt = options.prompt;

      // The translate endpoint always outputs English and does NOT accept `language`.
      if (task === 'transcribe') {
        params.language = options.language || 'el';
        if (response_format === 'verbose_json') {
          params.timestamp_granularities = granularities;
        }
      }

      const result = task === 'translate'
        ? await openai.audio.translations.create(params)
        : await openai.audio.transcriptions.create(params);

      console.log(`[whisper] ok attempt=${attempt} task=${task}`);
      return result;
    } catch (error) {
      lastError = error;
      console.error(`[whisper] attempt=${attempt} failed: ${error.message}`);
      if (isHardFail(error)) throw mapError(error);
      if (attempt < 3 && isRetryable(error)) {
        await sleep(2000 * attempt);
        continue;
      }
      throw mapError(error);
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
