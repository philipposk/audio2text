import { transcribeAudio } from '../server/utils/transcription.js';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure multer for file uploads (in-memory for Vercel)
// Vercel free tier has a 4.5MB request body limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB (under Vercel's 4.5MB free tier limit)
  fileFilter: (req, file, cb) => {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Handle file upload
    await new Promise((resolve, reject) => {
      upload.single('audio')(req, res, (err) => {
        if (err) {
          // Handle multer errors
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ 
              error: 'File too large', 
              message: 'Maximum file size is 4MB' 
            });
          }
          reject(err);
        } else {
          resolve();
        }
      });
    });

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Save file temporarily
    const tempPath = `/tmp/${Date.now()}-${req.file.originalname}`;
    await fs.writeFile(tempPath, req.file.buffer);

    try {
      // Transcribe
      const transcription = await transcribeAudio(tempPath, {
        language: req.body.language || 'el',
        prompt: req.body.prompt || '',
        response_format: 'verbose_json'
      });

      // Clean up
      await fs.unlink(tempPath).catch(() => {});

      return res.json({
        success: true,
        transcription: transcription.text,
        segments: transcription.segments || [],
        language: transcription.language,
        duration: transcription.duration
      });
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      
      // Handle OpenAI API errors
      if (error.status === 401) {
        return res.status(401).json({
          error: 'Invalid API key',
          message: 'OpenAI API key is incorrect or not set. Please configure OPENAI_API_KEY in Vercel environment variables.'
        });
      }
      
      throw error;
    }
  } catch (error) {
    console.error('Transcription error:', error);
    
    // Return appropriate status code based on error
    const statusCode = error.status || 500;
    return res.status(statusCode).json({
      error: 'Transcription failed',
      message: error.message
    });
  }
}
