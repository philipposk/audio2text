// Local (free, offline) transcription fallback.
//
// Prefers faster-whisper (CTranslate2): 4x faster than openai-whisper, lower
// memory, built-in Silero VAD, and real segment timestamps. Falls back to the
// reference openai-whisper package if faster-whisper isn't installed, and emits
// a clear error if no local Whisper is available at all.
//
// Model size is env-tunable: FASTER_WHISPER_MODEL (default 'base'). Bigger =
// more accurate + slower: tiny < base < small < medium < large-v3.
//
// Not used on Vercel (no Python in the serverless runtime) — this is the
// self-hosted offline path when no OpenAI/Groq key is configured or the API is
// down.

import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { TEMP_DIR } from './paths.js';

const execAsync = promisify(exec);

const MODEL = process.env.FASTER_WHISPER_MODEL || 'base';
const PYTHON = process.env.PYTHON_BIN || 'python3';

// One script that prefers faster-whisper, then degrades to openai-whisper, then
// exits with a recognizable marker so Node can surface an install hint. Reads
// path/lang/model from argv. Emits a single JSON line on stdout.
const PY_SCRIPT = `import json, sys
path, lang, model_size = sys.argv[1], sys.argv[2], sys.argv[3]
lang = None if lang in ("", "auto") else lang

def via_faster_whisper():
    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(path, language=lang, vad_filter=True)
    segs = []
    for s in segments:
        segs.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text})
    return {
        "text": "".join(s["text"] for s in segs).strip(),
        "language": info.language,
        "duration": round(info.duration, 3),
        "segments": segs,
        "engine": "faster-whisper",
    }

def via_openai_whisper():
    import whisper
    model = whisper.load_model(model_size)
    result = model.transcribe(path, language=lang)
    segs = [{"start": round(s["start"], 3), "end": round(s["end"], 3), "text": s["text"]}
            for s in result.get("segments", [])]
    return {
        "text": result.get("text", "").strip(),
        "language": result.get("language", lang),
        "duration": segs[-1]["end"] if segs else 0,
        "segments": segs,
        "engine": "openai-whisper",
    }

try:
    out = via_faster_whisper()
except ImportError:
    try:
        out = via_openai_whisper()
    except ImportError:
        sys.stderr.write("NO_LOCAL_WHISPER")
        sys.exit(3)

print(json.dumps(out))
`;

async function runScript(filePath, language) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const scriptPath = join(TEMP_DIR, `local_whisper_${Date.now()}.py`);
  fs.writeFileSync(scriptPath, PY_SCRIPT);
  try {
    const { stdout } = await execAsync(
      `${PYTHON} "${scriptPath}" "${filePath}" "${language || 'auto'}" "${MODEL}"`,
      { maxBuffer: 32 * 1024 * 1024 }
    );
    return JSON.parse(stdout.trim().split('\n').pop());
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

/**
 * Transcribe an audio file locally (free, offline). Returns the same shape as
 * the API path: { text, language, segments, duration }.
 */
export async function transcribeAudioLocal(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const language = options.language || undefined;
  console.log(`[local-whisper] transcribing (model=${MODEL}, free/offline)…`);

  try {
    const result = await runScript(filePath, language);
    console.log(`[local-whisper] ok via ${result.engine}, ${result.segments?.length || 0} segment(s)`);
    return {
      text: result.text || '',
      language: result.language || language || 'en',
      segments: result.segments || [],
      duration: result.duration || 0,
      provider: result.engine || 'local'
    };
  } catch (error) {
    if (/NO_LOCAL_WHISPER/.test(error.stderr || error.message || '')) {
      throw new Error(
        'No local Whisper installed. Run: pip install faster-whisper  (or set OPENAI_API_KEY / GROQ_API_KEY to use the cloud API).'
      );
    }
    if (/not found|ENOENT/i.test(error.message || '')) {
      throw new Error(`Python not found (tried "${PYTHON}"). Set PYTHON_BIN or install Python 3.`);
    }
    console.error('[local-whisper] failed:', error.message);
    throw new Error(`Local transcription failed: ${error.message}`);
  }
}
