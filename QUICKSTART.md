# Quick Start Guide

## Local Development

### 1. Install Dependencies

```bash
cd "/Users/phktistakis/Devoloper Projects/audio2text"
npm install
```

### 2. Set Up Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=sk-your-key-here
```

### 3. Start Development Server

```bash
npm run dev
```

This will start:
- Backend server on `http://localhost:3000`
- Frontend dev server on `http://localhost:5173`

### 4. Test the Application

1. Open `http://localhost:5173` in your browser
2. Upload an audio file (MP3, WAV, M4A, etc.)
3. Wait for transcription
4. Use the chat interface to refine the transcription
5. Export in your preferred format

## Key Features

✅ **High-Quality Transcription**: Uses OpenAI Whisper API for accurate Greek transcription
✅ **AI Chat Interface**: Refine and improve transcriptions through conversation
✅ **Multiple Export Formats**: TXT, DOCX, PDF, JSON, SRT, VTT
✅ **Messaging Integration**: Ready for Telegram, WhatsApp, Messenger

## Troubleshooting

### Transcription Quality Issues

The app uses OpenAI Whisper API which provides much better quality than local models, especially for Greek. If you experience issues:

1. Check your OpenAI API key is valid
2. Ensure you have API credits
3. Try different audio formats (WAV usually works best)

### Port Already in Use

If port 3000 or 5173 is in use:
- Change `PORT` in `.env` for backend
- Change port in `vite.config.js` for frontend

### File Upload Errors

- Check file size (max 100MB)
- Ensure file is a valid audio format
- Check server logs for detailed errors

## Next Steps

1. Deploy to production (see DEPLOY.md)
2. Set up messaging platforms (see MESSAGING_SETUP.md)
3. Customize UI and branding
4. Add additional features as needed

