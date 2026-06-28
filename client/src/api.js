// Thin wrapper over the Translator backend. Uses the same-origin /api prefix
// proxied by Vite in dev (see vite.config.js) and the production server in
// prod.

const BASE = '/api';

function authHeaders() {
  const key = localStorage.getItem('translator_api_key');
  return key ? { 'x-api-key': key } : {};
}

async function jsonFetch(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init.headers || {}) }
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (body && body.error) || (typeof body === 'string' ? body : 'Request failed');
    throw Object.assign(new Error(msg), { status: res.status, body });
  }
  return body;
}

async function formFetch(path, formData) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: formData
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error || 'Upload failed'), { status: res.status, body });
  return body;
}

// ---- core endpoints ----

export const health = () => jsonFetch('/health');
export const listLanguages = () => jsonFetch('/translate/languages');

export const transcribeFile = (file, { task = 'transcribe', language = 'auto', wordTimestamps = false, prompt = '' } = {}) => {
  const fd = new FormData();
  fd.append('audio', file);
  fd.append('task', task);
  if (language && language !== 'auto') fd.append('language', language);
  if (wordTimestamps) fd.append('word_timestamps', 'true');
  if (prompt) fd.append('prompt', prompt);
  return formFetch('/transcribe', fd);
};

export const ingestUrl = (url, { task = 'transcribe', language = 'auto', wordTimestamps = false } = {}) =>
  jsonFetch('/ingest', {
    method: 'POST',
    body: JSON.stringify({ url, task, language: language === 'auto' ? undefined : language, word_timestamps: wordTimestamps })
  });

// Batch transcription — up to 25 files in one request. Returns
// { total, ok, failed, results:[{file, jobId, preview, error?}] }.
export const transcribeBatch = (files, { task = 'transcribe', language = 'auto' } = {}) => {
  const fd = new FormData();
  for (const f of files) fd.append('audio', f);
  fd.append('task', task);
  if (language && language !== 'auto') fd.append('language', language);
  return formFetch('/transcribe/batch', fd);
};

export const translateText = ({ text, sourceLang, targetLang, glossaryId, glossary }) =>
  jsonFetch('/translate', {
    method: 'POST',
    body: JSON.stringify({ text, sourceLang: sourceLang === 'auto' ? undefined : sourceLang, targetLang, glossaryId, glossary })
  });

export const translateJobSegments = (jobId, targetLang, sourceLang, glossaryId) =>
  jsonFetch(`/jobs/${jobId}/translate`, {
    method: 'POST',
    body: JSON.stringify({ targetLang, sourceLang, glossaryId })
  });

export const detectLanguage = (text) =>
  jsonFetch('/detect-language', { method: 'POST', body: JSON.stringify({ text }) });

export const detectLanguageAudio = (file) => {
  const fd = new FormData();
  fd.append('audio', file);
  return formFetch('/detect-language', fd);
};

export const summarize = ({ transcription, jobId, kind = 'generic', length = 'normal', targetLang }) =>
  jsonFetch('/summary', {
    method: 'POST',
    body: JSON.stringify({ transcription, jobId, kind, length, targetLang })
  });

export const chatRefine = ({ message, transcription, history = [] }) =>
  jsonFetch('/chat', { method: 'POST', body: JSON.stringify({ message, transcription, history }) });

// AI topic chapters with start times (for clickable markers).
export const getChapters = ({ jobId, transcription, segments } = {}) =>
  jsonFetch('/chapters', { method: 'POST', body: JSON.stringify({ jobId, transcription, segments }) });

// ---- jobs ----

export const listJobs = ({ q, language, task, type, limit = 50, offset = 0 } = {}) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (language) params.set('language', language);
  if (task) params.set('task', task);
  if (type) params.set('type', type);
  params.set('limit', limit);
  params.set('offset', offset);
  return jsonFetch(`/jobs?${params}`);
};
export const getJob = (id) => jsonFetch(`/jobs/${id}`);
export const deleteJob = (id) => jsonFetch(`/jobs/${id}`, { method: 'DELETE' });
export const renameSpeakers = (id, renames, merge = []) =>
  jsonFetch(`/jobs/${id}/speakers`, { method: 'PATCH', body: JSON.stringify({ renames, merge }) });

// Edit transcript segments (inline correction). Backend re-syncs the flat text.
export const updateSegments = (id, segments) =>
  jsonFetch(`/jobs/${id}/segments`, { method: 'PATCH', body: JSON.stringify({ segments }) });

// Stream URL for a job's stored source audio (range-enabled, for playback).
export const jobAudioUrl = (id) => `${BASE}/jobs/${id}/audio`;

// ---- exports ----

export const exportTranscript = async (format, { transcription, segments, jobId, title, translatedSegments }) => {
  const res = await fetch(`${BASE}/export/${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ transcription, segments, jobId, title, translatedSegments })
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || 'Export failed');
  }
  return res.blob();
};

// ---- glossaries ----

export const listGlossaries = () => jsonFetch('/glossaries');
export const createGlossary = (g) => jsonFetch('/glossaries', { method: 'POST', body: JSON.stringify(g) });
export const getGlossary = (id) => jsonFetch(`/glossaries/${id}`);
export const deleteGlossary = (id) => jsonFetch(`/glossaries/${id}`, { method: 'DELETE' });

// ---- live websocket ----

export function openLiveSocket({ language = 'el', task = 'transcribe', ext = 'webm' } = {}) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}${BASE}/live?language=${language}&task=${task}&ext=${ext}`;
  return new WebSocket(url);
}

// ---- helpers ----

export const setApiKey = (k) => {
  if (k) localStorage.setItem('translator_api_key', k);
  else localStorage.removeItem('translator_api_key');
};
export const getApiKey = () => localStorage.getItem('translator_api_key') || '';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
