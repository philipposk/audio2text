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
      return res.status(500).json({ 
        error: 'OpenAI API key not configured',
        message: 'OPENAI_API_KEY environment variable is missing. Please add it in Vercel Settings → Environment Variables.'
      });
    }

    // Log first few characters for debugging (don't log full key)
    console.log('API Key present:', process.env.OPENAI_API_KEY ? `sk-...${process.env.OPENAI_API_KEY.slice(-4)}` : 'MISSING');
    console.log('File received:', req.file.originalname, 'Size:', req.file.size, 'bytes');

    // Save file temporarily to /tmp (required for Vercel serverless)
    const tempPath = `/tmp/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    
    try {
      // Write buffer to temp file
      await fs.writeFile(tempPath, req.file.buffer);
      console.log('File written to:', tempPath);

      // Transcribe using the file path
      const transcription = await transcribeAudio(tempPath, {
        language: req.body.language || 'el',
        prompt: req.body.prompt || '',
        response_format: 'verbose_json'
      });

      // Clean up temp file
      await fs.unlink(tempPath).catch((err) => {
        console.error('Error cleaning up temp file:', err);
      });

      return res.json({
        success: true,
        transcription: transcription.text,
        segments: transcription.segments || [],
        language: transcription.language,
        duration: transcription.duration
      });
    } catch (error) {
      // Clean up temp file on error
      await fs.unlink(tempPath).catch(() => {});
      
      // Handle OpenAI API errors
      if (error.status === 401 || error.message?.includes('401') || error.message?.includes('Incorrect API key')) {
        return res.status(401).json({
          error: 'Invalid API key',
          message: 'OpenAI API key is incorrect, expired, or revoked. Please: 1) Check if the key is still valid at https://platform.openai.com/account/api-keys 2) Create a new key if needed 3) Update OPENAI_API_KEY in Vercel Settings → Environment Variables 4) Redeploy the project.'
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
