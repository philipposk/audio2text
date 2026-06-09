export default function handler(req, res) {
  res.json({
    status: 'ok',
    service: 'Translator',
    version: '2.0.0',
    runtime: 'vercel',
    providers: {
      openai: !!process.env.OPENAI_API_KEY,
      groq: !!process.env.GROQ_API_KEY
    }
  });
}
