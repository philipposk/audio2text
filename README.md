# Mr.Transcribe - Audio to Text Transcription Web App

A modern web application that transcribes audio files to text with AI-powered refinement capabilities and messaging platform integration.

## Features

- 🎤 **Multi-format Audio Support**: Upload audio files in any format (MP3, WAV, M4A, FLAC, etc.)
- 🌍 **High-Quality Transcription**: Uses OpenAI Whisper API OR free local Whisper model (automatic fallback)
- 💰 **100% FREE Option**: Local Whisper transcription runs entirely on your machine - no API costs!
- 💬 **AI Chat Interface**: Chat with AI to refine, edit, and improve transcriptions
- 📄 **Multiple Export Formats**: Export transcriptions as TXT, DOCX, PDF, JSON, SRT, VTT
- 📱 **Messaging Integration**: Connect via Telegram, WhatsApp, or Messenger as "Mr.Transcribe"
- 🔄 **Iterative Refinement**: Keep refining transcriptions until you're satisfied

## Tech Stack

- **Frontend**: React, TailwindCSS, Vite
- **Backend**: Node.js, Express
- **Transcription**: OpenAI Whisper API (with automatic fallback to FREE local Whisper)
- **AI Chat**: OpenAI GPT-4 or Groq (Llama 3.1 70B)
- **Export**: docx, pdf-lib, json

## Setup

### Prerequisites

- Node.js 18+ and npm
- OpenAI API key (required for transcription)
- Groq API key (optional, for chat/refinement - will be preferred if provided)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your OpenAI API key

# Start development server
npm run dev
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# Required for transcription
OPENAI_API_KEY=your_openai_api_key_here

# Optional: For chat/refinement (will be preferred over OpenAI if provided)
GROQ_API_KEY=your_groq_api_key_here

# Server Configuration
PORT=3000
NODE_ENV=development
```

**Note**: 
- `OPENAI_API_KEY` is optional - if not provided or quota exceeded, the app automatically uses FREE local Whisper transcription
- `GROQ_API_KEY` is optional but recommended for faster/cheaper chat responses
- If both API keys are provided, Groq will be used for chat/refinement, OpenAI for transcription
- **FREE Mode**: If OpenAI quota is exceeded, the app automatically falls back to local Whisper (first use downloads ~500MB model, then works offline forever!)

## Deployment

Deploy to `mrtranscribe.6x7.gr` using Vercel, Netlify, or your preferred hosting.

## License

MIT License - see LICENSE file for details.

