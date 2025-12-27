import OpenAI from 'openai';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lazy initialization of OpenAI client
let openaiClient = null;
const getOpenAIClient = () => {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000, // 2 minute timeout for large files
      maxRetries: 3
    });
  }
  return openaiClient;
};

/**
 * Transcribe audio file using OpenAI Whisper API
 * This provides much better quality than local Whisper, especially for Greek
 */
export async function transcribeAudio(filePath, options = {}) {
  try {
    // Get OpenAI client (lazy initialization)
    const openai = getOpenAIClient();
    if (!openai) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.');
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    console.log('File stats:', { size: stats.size, path: filePath });
    
    // Extract filename from path for OpenAI
    const fileName = filePath.split('/').pop() || 'audio.mp3';
    
    console.log('Sending file to OpenAI:', fileName, 'Size:', stats.size, 'bytes');

    // Use ReadStream - OpenAI SDK supports this
    // Retry logic for connection issues
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Attempt ${attempt} to transcribe...`);
        // Recreate stream for each attempt (streams can only be read once)
        const fileStream = fs.createReadStream(filePath);
        
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
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        // Don't retry on quota or authentication errors
        if (error.status === 429 || error.status === 401 || 
            error.message?.includes('quota') || error.message?.includes('billing')) {
          throw error;
        }
        
        // If it's a connection error and we have retries left, wait and retry
        if (attempt < 3 && (
          error.code === 'ECONNRESET' || 
          error.message?.includes('Connection') || 
          error.message?.includes('timeout') ||
          error.cause?.code === 'ECONNRESET'
        )) {
          console.log(`Connection error on attempt ${attempt}, retrying in ${2 * attempt} seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
          continue;
        }
        throw error;
      }
    }
    
    throw lastError;

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
      throw new Error('Invalid API key. Please check OPENAI_API_KEY in your environment variables.');
    }
    
    if (error.status === 429 || error.statusCode === 429) {
      throw new Error('OpenAI API quota exceeded. Please check your OpenAI billing and plan. You may need to add credits or upgrade your plan. Visit https://platform.openai.com/account/billing');
    }
    
    // Check error response body for quota messages
    if (error.response?.status === 429 || error.response?.statusText === 'Too Many Requests') {
      throw new Error('OpenAI API quota exceeded. Please check your OpenAI billing and add credits to your account. Visit https://platform.openai.com/account/billing');
    }
    
    if (error.message?.includes('quota') || error.message?.includes('billing') || 
        error.message?.includes('exceeded') || error.cause?.message?.includes('quota')) {
      throw new Error('OpenAI API quota exceeded. Please check your OpenAI billing and add credits to your account. Visit https://platform.openai.com/account/billing');
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
    // Get OpenAI client (lazy initialization)
    const openai = getOpenAIClient();
    if (!openai) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.');
    }

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

