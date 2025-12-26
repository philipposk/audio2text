import OpenAI from 'openai';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 2
});

/**
 * Transcribe audio file using OpenAI Whisper API
 * This provides much better quality than local Whisper, especially for Greek
 */
export async function transcribeAudio(filePath, options = {}) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    console.log('File stats:', { size: stats.size, path: filePath });

    // Create a readable stream from the file
    // OpenAI SDK v4 accepts File, Blob, or ReadStream
    const fileStream = fs.createReadStream(filePath);
    
    // Extract filename from path for OpenAI
    const fileName = filePath.split('/').pop() || 'audio.mp3';
    
    console.log('Sending file to OpenAI:', fileName, 'Size:', stats.size, 'bytes');

    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      language: options.language || 'el', // 'el' for Greek
      prompt: options.prompt || '',
      response_format: options.response_format || 'json',
      temperature: 0
    }, {
      // Pass filename as metadata
      filename: fileName
    });

    console.log('Transcription successful');
    return transcription;
  } catch (error) {
    console.error('OpenAI transcription error:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      code: error.code,
      type: error.type,
      cause: error.cause
    });
    
    // Handle specific OpenAI errors
    if (error.status === 401) {
      throw new Error('Invalid API key. Please check OPENAI_API_KEY in Vercel environment variables.');
    }
    
    if (error.message?.includes('Connection') || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      throw new Error(`Connection error: Unable to reach OpenAI API. ${error.message}`);
    }
    
    // Preserve original error message
    throw new Error(`Transcription failed: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Re-transcribe with specific instructions
 */
export async function retranscribeAudio(filePath, instructions) {
  try {
    const fileStream = fs.createReadStream(filePath);

    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      language: 'el',
      prompt: instructions,
      response_format: 'verbose_json',
      temperature: 0
    });

    return transcription;
  } catch (error) {
    console.error('Re-transcription error:', error);
    throw new Error(`Re-transcription failed: ${error.message}`);
  }
}

