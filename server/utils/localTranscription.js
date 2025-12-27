import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Transcribe using Python Whisper (more reliable than JS version)
 */
async function transcribeWithPythonWhisper(filePath, language = 'en') {
  const tempScriptPath = join(__dirname, '../../temp/whisper_transcribe.py');
  let scriptCreated = false;
  
  try {
    // Create temp directory if it doesn't exist
    const tempDir = join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Create Python script file
    const pythonScript = `import whisper
import json
import sys

model = whisper.load_model("base")
result = model.transcribe(sys.argv[1], language=sys.argv[2])
print(json.dumps({"text": result["text"], "language": result["language"]}))`;

    fs.writeFileSync(tempScriptPath, pythonScript);
    scriptCreated = true;

    // Run Python script with file path and language as arguments
    const { stdout, stderr } = await execAsync(
      `python3 "${tempScriptPath}" "${filePath}" "${language}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (stderr && !stderr.includes('Using cached') && !stderr.includes('100%') && !stderr.includes('Downloading')) {
      console.warn('Whisper warnings:', stderr.substring(0, 200));
    }

    const result = JSON.parse(stdout.trim());
    return result;
  } catch (error) {
    console.error('Python Whisper error:', error.message);
    throw error;
  } finally {
    // Clean up temp script
    if (scriptCreated && fs.existsSync(tempScriptPath)) {
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Transcribe audio file using local Whisper model
 * This is FREE and runs entirely on your machine
 */
export async function transcribeAudioLocal(filePath, options = {}) {
  try {
    console.log('Starting local transcription (FREE, using Python Whisper)...');
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const language = options.language || 'en'; // Default to English for testing
    
    console.log('Transcribing with Python Whisper (first use may download model)...');
    const result = await transcribeWithPythonWhisper(filePath, language);

    // Format response similar to OpenAI API
    const transcription = {
      text: result.text || '',
      language: result.language || language,
      segments: [],
      duration: 0
    };

    console.log('✓ Local transcription completed successfully!');
    return transcription;

  } catch (error) {
    console.error('Local transcription error:', error);
    throw new Error(`Local transcription failed: ${error.message}`);
  }
}

