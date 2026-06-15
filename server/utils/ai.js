// Shared AI provider selection. Groq preferred (cheaper/faster), OpenAI fallback.
import OpenAI from 'openai';
import Groq from 'groq-sdk';

let openaiClient = null;
let groqClient = null;

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

export function getProvider() {
  if (getGroq()) return 'groq';
  if (getOpenAI()) return 'openai';
  return null;
}

// Models are overridable via env so a future decommission needs no code change.
// llama-3.1-70b-versatile was decommissioned by Groq → llama-3.3-70b-versatile.
const MODELS = {
  groq: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  openai: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
};

export async function chatComplete({ messages, temperature = 0.3, maxTokens = 4000 }) {
  const provider = getProvider();
  if (!provider) {
    const err = new Error('No AI API key configured. Set OPENAI_API_KEY or GROQ_API_KEY.');
    err.status = 500;
    throw err;
  }
  const client = provider === 'groq' ? getGroq() : getOpenAI();
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
