import express from 'express';
import OpenAI from 'openai';
import Groq from 'groq-sdk';

const router = express.Router();

// Initialize OpenAI if API key is provided
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

// Initialize Groq if API key is provided
const groq = process.env.GROQ_API_KEY ? new Groq({
  apiKey: process.env.GROQ_API_KEY
}) : null;

// Determine which AI provider to use (prefer Groq if available, fallback to OpenAI)
const getAIProvider = () => {
  if (groq) return 'groq';
  if (openai) return 'openai';
  return null;
};

// Chat with AI to refine transcription
router.post('/', async (req, res) => {
  try {
    const { message, transcription, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const provider = getAIProvider();
    if (!provider) {
      return res.status(500).json({ error: 'No AI API key configured. Please set OPENAI_API_KEY or GROQ_API_KEY' });
    }

    // Build conversation context
    const systemPrompt = `You are Mr.Transcribe, a helpful AI assistant specialized in refining and improving audio transcriptions. 
Your role is to:
1. Help users improve transcriptions by fixing errors, grammar, and formatting
2. Add punctuation, capitalization, and proper structure
3. Translate if requested
4. Format text according to user preferences
5. Answer questions about the transcription
6. Make the text more readable and professional

The user has provided a transcription that may need refinement. Be helpful, accurate, and follow their instructions precisely.

Current transcription:
${transcription || 'No transcription provided yet'}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message }
    ];

    let completion;
    if (provider === 'groq') {
      completion = await groq.chat.completions.create({
        model: 'llama-3.1-70b-versatile',
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      });
    } else {
      completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      });
    }

    const aiResponse = completion.choices[0].message.content;

    res.json({
      success: true,
      response: aiResponse,
      usage: completion.usage,
      provider: provider
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      error: 'Chat failed',
      message: error.message
    });
  }
});

// Get refined transcription based on chat instructions
router.post('/refine', async (req, res) => {
  try {
    const { transcription, instructions } = req.body;

    if (!transcription || !instructions) {
      return res.status(400).json({ error: 'Transcription and instructions are required' });
    }

    const provider = getAIProvider();
    if (!provider) {
      return res.status(500).json({ error: 'No AI API key configured. Please set OPENAI_API_KEY or GROQ_API_KEY' });
    }

    const systemPrompt = `You are a transcription refinement expert. Refine the following transcription according to the user's instructions. 
Return ONLY the refined transcription text, without additional commentary unless specifically requested.

Original transcription:
${transcription}

User instructions:
${instructions}`;

    let completion;
    if (provider === 'groq') {
      completion = await groq.chat.completions.create({
        model: 'llama-3.1-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Please refine the transcription according to my instructions.' }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });
    } else {
      completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Please refine the transcription according to my instructions.' }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });
    }

    const refinedText = completion.choices[0].message.content;

    res.json({
      success: true,
      refinedTranscription: refinedText,
      provider: provider
    });

  } catch (error) {
    console.error('Refinement error:', error);
    res.status(500).json({
      error: 'Refinement failed',
      message: error.message
    });
  }
});

export default router;

