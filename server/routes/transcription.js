import express from 'express';
import multer from 'multer';
import { transcribeAudio } from '../utils/transcription.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = join(__dirname, '../../uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    // Accept audio files
    const audioMimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
      'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
      'audio/flac', 'audio/ogg', 'audio/webm', 'audio/amr',
      'audio/3gpp', 'audio/aac', 'audio/x-aac'
    ];
    
    if (audioMimeTypes.includes(file.mimetype) || 
        file.originalname.match(/\.(mp3|wav|m4a|flac|ogg|webm|amr|3gp|aac)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

// Transcribe audio file
router.post('/', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    console.log(`📝 Transcribing file: ${req.file.filename}`);

    // Transcribe using OpenAI Whisper API
    const transcription = await transcribeAudio(req.file.path, {
      language: req.body.language || 'el', // Default to Greek
      prompt: req.body.prompt || '',
      response_format: 'verbose_json'
    });

    // Clean up uploaded file
    await fs.unlink(req.file.path).catch(() => {});

    res.json({
      success: true,
      transcription: transcription.text,
      segments: transcription.segments || [],
      language: transcription.language,
      duration: transcription.duration
    });

  } catch (error) {
    console.error('Transcription error:', error);
    
    // Clean up file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(500).json({
      error: 'Transcription failed',
      message: error.message
    });
  }
});

// Get transcription status (for long files)
router.get('/status/:id', (req, res) => {
  // Placeholder for async transcription status
  res.json({ status: 'completed' });
});

export default router;

