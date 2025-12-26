import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, transcription, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: messages,
      temperature: 0.7,
      max_tokens: 2000
    });

    const aiResponse = completion.choices[0].message.content;

    return res.json({
      success: true,
      response: aiResponse,
      usage: completion.usage
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({
      error: 'Chat failed',
      message: error.message
    });
  }
}
