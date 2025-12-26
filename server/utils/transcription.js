import OpenAI from 'openai';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
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

    // Create a readable stream from the file
    // OpenAI SDK v4 accepts File, Blob, or ReadStream
    const fileStream = fs.createReadStream(filePath);
    
    console.log('Sending file to OpenAI:', filePath);

    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      language: options.language || 'el', // 'el' for Greek
      prompt: options.prompt || '',
      response_format: options.response_format || 'json',
      temperature: 0
    });

    console.log('Transcription successful');
    return transcription;
  } catch (error) {
    console.error('OpenAI transcription error:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      code: error.code,
      type: error.type
    });
    
    // Preserve original error for better debugging
    if (error.message) {
      throw error;
    }
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

