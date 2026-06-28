// Shared AI provider selection for the text/LLM features (summary, translate,
// chapters, questions, Q&A, refine). Default preference: Groq (cheapest+fastest)
// → OpenRouter (cheap, huge model selection) → OpenAI. Override the primary with
// CHAT_PROVIDER=groq|openrouter|openai.
//
// NOTE: this is LLM-only. Audio→text (Whisper) is handled separately in
// utils/transcription.js — OpenRouter has no transcription endpoint.
import OpenAI from 'openai';
import Groq from 'groq-sdk';

let openaiClient = null;
let groqClient = null;
let openrouterClient = null;

export function getOpenAI() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000,
      maxRetries: 3
    });
  }
  return openaiClient;
}

export function getGroq() {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

// OpenRouter is OpenAI-API-compatible — reuse the OpenAI SDK with its base URL.
export function getOpenRouter() {
  if (!openrouterClient && process.env.OPENROUTER_API_KEY) {
    openrouterClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: 120000,
      maxRetries: 3,
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://audio2text.6x7.gr',
        'X-Title': 'Translator'
      }
    });
  }
  return openrouterClient;
}

const CLIENTS = { groq: getGroq, openrouter: getOpenRouter, openai: getOpenAI };

export function getProvider() {
  const pref = (process.env.CHAT_PROVIDER || '').toLowerCase();
  if (CLIENTS[pref] && CLIENTS[pref]()) return pref;
  // Default order: cheapest/fastest first.
  if (getGroq()) return 'groq';
  if (getOpenRouter()) return 'openrouter';
  if (getOpenAI()) return 'openai';
  return null;
}

// Models are overridable via env so a future decommission needs no code change.
// llama-3.1-70b-versatile was decommissioned by Groq → llama-3.3-70b-versatile.
const MODELS = {
  groq: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  openrouter: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
  openai: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
};

export async function chatComplete({ messages, temperature = 0.3, maxTokens = 4000 }) {
  const provider = getProvider();
  if (!provider) {
    const err = new Error('No AI API key configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY.');
    err.status = 500;
    throw err;
  }
  const client = CLIENTS[provider]();
  const completion = await client.chat.completions.create({
    model: MODELS[provider],
    messages,
    temperature,
    max_tokens: maxTokens
  });
  return {
    text: completion.choices[0].message.content,
    usage: completion.usage,
    provider,
    model: MODELS[provider]
  };
}
