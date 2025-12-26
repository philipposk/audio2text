# Mr.Transcribe - Audio to Text Transcription Web App

A modern web application that transcribes audio files to text with AI-powered refinement capabilities and messaging platform integration.

## Features

- 🎤 **Multi-format Audio Support**: Upload audio files in any format (MP3, WAV, M4A, FLAC, etc.)
- 🌍 **High-Quality Transcription**: Uses OpenAI Whisper API for accurate transcription, especially for Greek
- 💬 **AI Chat Interface**: Chat with AI to refine, edit, and improve transcriptions
- 📄 **Multiple Export Formats**: Export transcriptions as TXT, DOCX, PDF, JSON, SRT, VTT
- 📱 **Messaging Integration**: Connect via Telegram, WhatsApp, or Messenger as "Mr.Transcribe"
- 🔄 **Iterative Refinement**: Keep refining transcriptions until you're satisfied

## Tech Stack

- **Frontend**: React, TailwindCSS, Vite
- **Backend**: Node.js, Express
- **Transcription**: OpenAI Whisper API
- **AI Chat**: OpenAI GPT-4
- **Export**: docx, pdf-lib, json

## Setup

### Prerequisites

- Node.js 18+ and npm
- OpenAI API key

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

```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
NODE_ENV=development
```

## Deployment

Deploy to `audio2text.6x7.gr` using Vercel, Netlify, or your preferred hosting.

## License

MIT License - see LICENSE file for details.

