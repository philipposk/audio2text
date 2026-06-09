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

const MODELS = {
  groq: 'llama-3.1-70b-versatile',
  openai: 'gpt-4o-mini'
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
