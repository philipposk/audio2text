import { useState, useEffect, useRef, useCallback } from 'react';
import { I, LANGS } from './icons';
import { hexToSoft, fmtDuration, fmtDate, langInfo, fmtActionItem } from './lib/format';
import {
  transcribeFile, transcribeBatch, ingestUrl, translateJobSegments,
  chatRefine, listJobs, getJob, deleteJob, exportTranscript,
  listGlossaries, createGlossary, deleteGlossary, summarize, getChapters,
  getQuestions, updateSegments, jobAudioUrl, shareJob, getSharedTranscript,
  liveTranscribeChunk, liveFinalize, setApiKey, getApiKey, downloadBlob
} from './api';
import './styles/translator.css';

// ─── constants ───────────────────────────────────────────────────────────────
const ACCENTS = ['#1f5d4c', '#c7522a', '#3b3a8f', '#0e0e0d'];
const REFINE_SUGGESTIONS = [
  'Make it more formal',
  'Fix punctuation',
  'Shorten',
  'Keep brand names',
];
const EXPORT_FORMATS = ['srt', 'vtt', 'txt', 'docx', 'pdf', 'json'];

// ─── utils ───────────────────────────────────────────────────────────────────
// Pure formatters live in ./lib/format.js; highlight() stays here because it
// returns JSX.

// Wrap case-insensitive matches of `query` in <mark> for in-transcript search.
function highlight(text, query) {
  if (!query || !text) return text;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(text).split(new RegExp(`(${safe})`, 'ig'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i}>{part}</mark>
      : part
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ activeView, onNav, jobCount, theme, onThemeToggle, apiKey }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">T</div>
        <div className="brand-name">Translator<em>·beta</em></div>
      </div>

      <div className="nav">
        <div className={`nav-item ${activeView === 'transcribe' ? 'active' : ''}`}
          onClick={() => onNav('transcribe')}>
          <span className="ico">{I.upload}</span><span>Transcribe</span>
        </div>
        <div className={`nav-item ${activeView === 'live' ? 'active' : ''}`}
          onClick={() => onNav('live')}>
          <span className="ico">{I.mic}</span><span>Live</span>
        </div>
        <div className={`nav-item ${activeView === 'history' ? 'active' : ''}`}
          onClick={() => onNav('history')}>
          <span className="ico">{I.history}</span><span>History</span>
          {jobCount > 0 && <span className="count">{jobCount}</span>}
        </div>

        <div className="nav-section">Workspace</div>
        <div className={`nav-item ${activeView === 'glossary' ? 'active' : ''}`}
          onClick={() => onNav('glossary')}>
          <span className="ico">{I.glossary}</span><span>Glossary</span>
        </div>
        <div className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
          onClick={() => onNav('settings')}>
          <span className="ico">{I.settings}</span><span>Settings</span>
        </div>
      </div>

      <div className="sidebar-foot">
        <div className="user" style={{ cursor: 'pointer' }} onClick={onThemeToggle} title="Toggle theme">
          <div className="avatar" style={{ fontSize: 11 }}>{theme === 'dark' ? '☀' : '🌙'}</div>
          <div className="user-meta">
            <span className="user-name">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            <span className="user-plan">{apiKey ? 'API key set' : 'No API key'}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Topbar ──────────────────────────────────────────────────────────────────
function Topbar({ appState, title, onReset }) {
  return (
    <div className="topbar">
      <div className="breadcrumb">
        <b>Transcribe</b>
        {appState === 'result' && title && <><span>/</span><span>{title}</span></>}
        {appState === 'transcribing' && <><span>/</span><span>Processing…</span></>}
        {appState === 'batch' && <><span>/</span><span>Batch</span></>}
      </div>
      <div className="topbar-actions">
        {appState !== 'empty' && (
          <button className="btn sm" onClick={onReset}>New</button>
        )}
      </div>
    </div>
  );
}

// ─── LangPicker modal ─────────────────────────────────────────────────────────
function LangPicker({ value, onChange, onClose, excludeAuto }) {
  const [q, setQ] = useState('');
  const filtered = LANGS.filter(l => {
    if (excludeAuto && l.code === 'auto') return false;
    return l.name.toLowerCase().includes(q.toLowerCase()) || l.code.includes(q.toLowerCase());
  });

  useEffect(() => {
    const close = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="lang-picker-overlay" onClick={onClose}>
      <div className="lang-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="lang-picker-search">
          {I.search}
          <input
            autoFocus
            placeholder="Search language…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <div className="lang-picker-list">
          {filtered.map(l => (
            <div
              key={l.code}
              className={`lang-picker-item ${value === l.code ? 'active' : ''}`}
              onClick={() => { onChange(l.code); onClose(); }}
            >
              <span className="lang-flag" style={{ background: l.color }}>{l.flag}</span>
              <span>{l.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── LangBar ─────────────────────────────────────────────────────────────────
function LangBar({ source, target, onSwap, onPickSource, onPickTarget, detectedLang }) {
  const src = langInfo(source);
  const tgt = langInfo(target);
  return (
    <div className="lang-bar">
      <div className="lang-cell" onClick={onPickSource}>
        <span className="lbl">From</span>
        <div className="lang-picker">
          <span className="lang-flag" style={{ background: src.color }}>{src.flag}</span>
          <span className="lang-name">{src.name}</span>
          <span style={{ color: 'var(--muted)' }}>{I.chev}</span>
          {source === 'auto' && detectedLang && (
            <span className="lang-detect">
              <span className="dot" />Detected: {detectedLang}
            </span>
          )}
        </div>
      </div>
      <div className="swap" onClick={onSwap} title="Swap">{I.swap}</div>
      <div className="lang-cell" onClick={onPickTarget}>
        <span className="lbl">To</span>
        <div className="lang-picker">
          <span className="lang-flag" style={{ background: tgt.color }}>{tgt.flag}</span>
          <span className="lang-name">{tgt.name}</span>
          <span style={{ color: 'var(--muted)' }}>{I.chev}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Modes ───────────────────────────────────────────────────────────────────
function Modes({ mode, onChange }) {
  const items = [
    { id: 'file', label: 'Upload file', ico: I.upload },
    { id: 'url', label: 'From URL', ico: I.link },
    { id: 'mic', label: 'Record', ico: I.mic_dot },
  ];
  return (
    <div className="modes">
      {items.map(it => (
        <div key={it.id} className={`mode ${mode === it.id ? 'active' : ''}`} onClick={() => onChange(it.id)}>
          {it.ico} {it.label}
        </div>
      ))}
    </div>
  );
}

// ─── FileDrop ─────────────────────────────────────────────────────────────────
function FileDrop({ onFile, onBatch }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const accept = (file) =>
    file.type.startsWith('audio/') || file.type.startsWith('video/') ||
    /\.(mp3|wav|m4a|flac|ogg|mp4|webm|aac|mov|mkv)$/i.test(file.name);

  // 1 file → single transcribe; 2+ → batch.
  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(accept);
    if (files.length === 0) return;
    if (files.length === 1) onFile(files[0]);
    else onBatch(files);
  };

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="audio/*,video/*,.mp3,.wav,.m4a,.flac,.ogg,.mp4,.webm,.aac"
        style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)}
      />
      <div className="dropzone-ico">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4M12 4l-4 4M12 4l4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      </div>
      <div>
        <h3>Drop a recording, paste, or browse</h3>
        <p>Up to 2 GB · one file or many · we'll detect the language automatically</p>
      </div>
      <div className="dropzone-formats">
        {['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'webm', 'aac'].map(f => (
          <span key={f} className="chip">{f}</span>
        ))}
      </div>
      <div className="dropzone-actions">
        <button className="btn accent" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}>
          Choose file
        </button>
      </div>
    </div>
  );
}

// ─── UrlInput ─────────────────────────────────────────────────────────────────
function UrlInput({ onUrl }) {
  const [val, setVal] = useState('');
  const submit = () => { if (val.trim()) onUrl(val.trim()); };
  return (
    <div className="url-input">
      <span className="ico">{I.link}</span>
      <input
        placeholder="Paste a YouTube, Vimeo, Loom or direct media URL…"
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        autoFocus
      />
      <button className="btn accent" onClick={submit} disabled={!val.trim()}>
        Transcribe {I.arrow}
      </button>
    </div>
  );
}

// ─── MicPanel ─────────────────────────────────────────────────────────────────
function MicPanel({ onStart }) {
  return (
    <div className="mic">
      <button className="mic-btn" onClick={onStart}>{I.mic}</button>
      <div className="mic-meta">
        <h4>Start recording</h4>
        <p>Live captions in 25+ languages · auto-saved on stop</p>
      </div>
      <div className="wave">
        {Array.from({ length: 28 }).map((_, i) => (
          <span key={i} style={{ height: `${8 + Math.abs(Math.sin(i * 0.6)) * 22}px`, opacity: 0.4 }} />
        ))}
      </div>
    </div>
  );
}

// ─── Transcribing ─────────────────────────────────────────────────────────────
function Transcribing({ fileName, fileSize }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="processing">
      <div className="proc-head">
        <div className="proc-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <div>
          <p className="proc-title">{fileName || 'Processing…'}</p>
          <p className="proc-sub">{fileSize ? `${fileSize} · ` : ''}This usually takes 30–60 seconds per 10 min of audio</p>
        </div>
        <div className="proc-elapsed">{mm}:{ss}</div>
      </div>

      <div className="live-wave">
        {Array.from({ length: 60 }).map((_, i) => (
          <span key={i} style={{ height: `${20 + Math.abs(Math.sin(i * 0.4)) * 44}px`, animationDelay: `${(i % 12) * 0.08}s` }} />
        ))}
      </div>

      <div className="steps">
        <div className="step done">
          <div className="step-label"><span className="step-dot" />Uploaded</div>
          <div className="step-detail">{fileName || '—'}</div>
        </div>
        <div className="step active">
          <div className="step-label"><span className="step-dot" />Transcribing</div>
          <div className="step-detail">Whisper · processing…</div>
        </div>
        <div className="step">
          <div className="step-label"><span className="step-dot" />Ready</div>
          <div className="step-detail">Almost there</div>
        </div>
      </div>
    </div>
  );
}

// ─── RecentCard ───────────────────────────────────────────────────────────────
function RecentCard({ job, query, onSelect, onDelete }) {
  const src = langInfo(job.language || 'auto');
  // Prefer the server's matched-excerpt snippet (search results), else the
  // transcript head (only present in local/dev list responses).
  const snippet = job.snippet || (job.transcription || job.text || '').slice(0, 120);

  return (
    <div className="recent-card" onClick={() => onSelect(job)}>
      <div className="recent-card-head">
        <div className="pair">
          <span className="lang-flag" style={{ background: src.color, width: 16, height: 16, fontSize: 8 }}>
            {src.flag}
          </span>
          {I.arrow}
          <span className="lang-flag" style={{ background: langInfo('en').color, width: 16, height: 16, fontSize: 8 }}>
            EN
          </span>
        </div>
        <span>{fmtDate(job.createdAt)}</span>
      </div>
      <div className="recent-card-title">{job.filename || job.sourceName || job.title || job.id}</div>
      <div className="recent-card-snippet">{query ? highlight(snippet, query) : snippet}{job.snippet ? '' : '…'}</div>
      <div className="recent-card-foot">
        <span>{I.play} {fmtDuration(job.duration)}</span>
        <span
          title="Delete"
          onClick={e => { e.stopPropagation(); onDelete(job.id); }}
          style={{ cursor: 'pointer', opacity: 0.5 }}
        >
          ✕
        </span>
      </div>
    </div>
  );
}

function RecentSection({ jobs, onSelect, onDeleteJob }) {
  if (!jobs.length) return null;
  return (
    <div className="recent">
      <div className="recent-head">
        <div className="recent-title">Recent</div>
      </div>
      <div className="recent-grid">
        {jobs.slice(0, 3).map(job => (
          <RecentCard key={job.id} job={job} onSelect={onSelect} onDelete={onDeleteJob} />
        ))}
      </div>
    </div>
  );
}

// ─── Batch view ───────────────────────────────────────────────────────────────
function BatchView({ batch, onOpen }) {
  if (batch.processing) {
    return (
      <div className="batch-list">
        {Array.from({ length: batch.count }).map((_, i) => (
          <div key={i} className="batch-row processing">
            <span className="batch-spinner" />
            <span className="batch-file">File {i + 1} of {batch.count}…</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="batch-list">
      {batch.results.map((r, i) => (
        <div
          key={i}
          className={`batch-row ${r.jobId ? 'ok' : 'fail'}`}
          onClick={r.jobId ? () => onOpen({ id: r.jobId }) : undefined}
          style={{ cursor: r.jobId ? 'pointer' : 'default' }}
        >
          <span className="batch-status">{r.jobId ? '✓' : '✕'}</span>
          <div className="batch-meta">
            <span className="batch-file">{r.file}</span>
            <span className="batch-preview">
              {r.jobId ? (r.preview || '').slice(0, 120) + '…' : r.error}
            </span>
          </div>
          {r.jobId && <span className="batch-open">{I.arrow}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Result view ──────────────────────────────────────────────────────────────
function ResultView({ job, translatedJob, source, target, onTranslate, translating, refineHistory, onRefine, onError, glossaries = [] }) {
  const [refineInput, setRefineInput] = useState('');
  const [copying, setCopying] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryKind, setSummaryKind] = useState('generic');
  const [chapters, setChapters] = useState(null);
  const [chaptering, setChaptering] = useState(false);
  const [questions, setQuestions] = useState(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [glossaryId, setGlossaryId] = useState('');
  const [editedSegs, setEditedSegs] = useState(null);
  const [editIdx, setEditIdx] = useState(-1);
  const [editText, setEditText] = useState('');
  const [activeSeg, setActiveSeg] = useState(-1);
  const audioRef = useRef(null);

  // Drop local edits + playback highlight when switching to a different job.
  useEffect(() => { setEditedSegs(null); setEditIdx(-1); setActiveSeg(-1); setChapters(null); setSummary(null); setQuestions(null); }, [job.id]);

  const src = langInfo(source !== 'auto' ? source : (job.language || 'auto'));
  const tgt = langInfo(target);

  // editedSegs (unsaved-but-applied local edits) take precedence over job data.
  const segments = editedSegs || job.segments || [];
  const translatedSegs = translatedJob?.segments || [];

  // Source audio is stored on self-hosted servers (not Vercel) for jobs created
  // via file upload. meta.audioFile (history) or hasAudio (fresh) signals it.
  const hasAudio = !!(job.meta?.audioFile || job.hasAudio);
  const seekTo = (sec) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Number(sec) || 0;
    a.play().catch(() => {});
  };

  // As the audio plays, highlight the segment covering the current time.
  const onTimeUpdate = () => {
    const a = audioRef.current;
    if (!a || !segments.length) return;
    const t = a.currentTime;
    let idx = -1;
    for (let i = 0; i < segments.length; i++) {
      const start = segments[i].start || 0;
      const end = segments[i].end ?? (segments[i + 1]?.start ?? Infinity);
      if (t >= start && t < end) { idx = i; break; }
    }
    if (idx !== activeSeg) setActiveSeg(idx);
  };

  // Keep the active line in view while it plays.
  useEffect(() => {
    if (activeSeg < 0) return;
    document.querySelector(`[data-seg="${activeSeg}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeSeg]);

  const startEdit = (i, current) => { setEditIdx(i); setEditText(current); };
  const cancelEdit = () => { setEditIdx(-1); setEditText(''); };
  const saveEdit = async (i) => {
    const next = segments.map((s, idx) => (idx === i ? { ...s, text: editText } : s));
    setEditedSegs(next);
    setEditIdx(-1);
    try {
      await updateSegments(job.id, next);
    } catch (err) {
      onError?.(err.message || 'Save failed');
    }
  };

  // After inline edits, rebuild full text from segments so copy/export/summary
  // reflect the corrections; otherwise prefer the stored transcription.
  const fullText = editedSegs
    ? editedSegs.map(s => s.text).join(' ')
    : (job.transcription || segments.map(s => s.text).join(' '));
  const translatedText = translatedJob?.transcription || translatedSegs.map(s => s.text).join(' ');

  const handleCopy = async (text, key) => {
    await navigator.clipboard.writeText(text).catch(() => { });
    setCopying(key);
    setTimeout(() => setCopying(null), 1500);
  };

  const handleExport = async (format) => {
    setExporting(format);
    try {
      const blob = await exportTranscript(format, {
        transcription: fullText,
        segments,
        jobId: job.id,
        title: job.filename,
        // Export route expects array of strings (text only), not segment objects
        translatedSegments: translatedSegs.length ? translatedSegs.map(s => s.text || '') : undefined,
      });
      downloadBlob(blob, `${job.filename || job.id}.${format}`);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(null);
    }
  };

  const submitRefine = async (msg) => {
    if (!msg.trim()) return;
    setRefineInput('');
    await onRefine(msg);
  };

  // Render the structured summary as shareable plain text.
  const summaryToText = (s) => {
    if (!s) return '';
    const lines = [];
    if (s.tldr?.length) { lines.push('TL;DR'); s.tldr.forEach(t => lines.push(`• ${fmtActionItem(t)}`)); lines.push(''); }
    if (s.keyPoints?.length) { lines.push('KEY POINTS'); s.keyPoints.forEach(t => lines.push(`• ${fmtActionItem(t)}`)); lines.push(''); }
    if (s.actionItems?.length) { lines.push('ACTION ITEMS'); s.actionItems.forEach(t => lines.push(`• ${fmtActionItem(t)}`)); lines.push(''); }
    if (s.topics?.length) lines.push('TOPICS: ' + s.topics.map(fmtActionItem).join(', '));
    return lines.join('\n').trim();
  };

  const handleSummarize = async (kind = summaryKind) => {
    setSummarizing(true);
    try {
      const res = await summarize({ transcription: fullText, jobId: job.id, kind, length: 'normal' });
      setSummary(res.summary || res);
    } catch (err) {
      onError?.(err.message || 'Summary failed');
    } finally {
      setSummarizing(false);
    }
  };

  const handleShare = async () => {
    try {
      const res = await shareJob(job.id);
      const url = `${window.location.origin}/s/${res.shareToken}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      setCopying('share');
      setTimeout(() => setCopying(null), 2000);
    } catch (err) {
      onError?.(err.message || 'Share failed');
    }
  };

  const handleChapters = async () => {
    setChaptering(true);
    try {
      const res = await getChapters({ jobId: job.id, transcription: fullText, segments });
      setChapters(res.chapters || []);
    } catch (err) {
      onError?.(err.message || 'Chapter detection failed');
    } finally {
      setChaptering(false);
    }
  };

  const handleQuestions = async () => {
    setLoadingQ(true);
    try {
      const res = await getQuestions({ jobId: job.id, transcription: fullText });
      setQuestions(res.questions || []);
    } catch (err) {
      onError?.(err.message || 'Question detection failed');
    } finally {
      setLoadingQ(false);
    }
  };

  // Jump to a time: seek audio if available, else scroll to the nearest segment.
  const goToTime = (sec) => {
    if (hasAudio) { seekTo(sec); return; }
    let idx = 0;
    for (let i = 0; i < segments.length; i++) { if ((segments[i].start || 0) <= sec) idx = i; else break; }
    document.querySelector(`[data-seg="${idx}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // Filter segments by search term (matches highlighted via highlight()).
  const matches = (txt) => !search || (txt || '').toLowerCase().includes(search.toLowerCase());
  const visibleSegs = search ? segments.filter(s => matches(s.text)) : segments;
  const visibleTransSegs = search ? translatedSegs.filter(s => matches(s.text)) : translatedSegs;

  // Low-confidence segments (Whisper avg_logprob below ~-0.4 correlates with
  // likely errors) — flag them so editors review the risky parts, not the whole.
  const isUncertain = (seg) => typeof seg.avg_logprob === 'number' && seg.avg_logprob < -0.4;
  const uncertainCount = segments.filter(isUncertain).length;
  const jumpUncertain = () => {
    const idx = segments.findIndex(isUncertain);
    if (idx < 0) return;
    document.querySelector(`[data-seg="${idx}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  const speakerCount = new Set(segments.map(s => s.speaker).filter(Boolean)).size;

  return (
    <>
      <div className="result">
        <div className="result-head">
          <div className="result-meta">
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{job.filename || job.id}</span>
            <span className="pill"><span className="dot" />{translatedJob ? 'Translated' : 'Transcribed'}</span>
            {job.duration && <span>{fmtDuration(job.duration)}</span>}
            <span>· {wordCount} words</span>
            {speakerCount > 0 && <span>· {speakerCount} speakers</span>}
          </div>
          <div className="result-actions">
            <button className="btn sm" onClick={() => handleCopy(fullText, 'orig')}>
              {I.copy} {copying === 'orig' ? 'Copied!' : 'Copy'}
            </button>
            <button className="btn sm" onClick={handleSummarize} disabled={summarizing}>
              {I.spark} {summarizing ? 'Summarizing…' : 'Summary'}
            </button>
            <button className="btn sm" onClick={handleChapters} disabled={chaptering}>
              {I.history} {chaptering ? 'Detecting…' : 'Chapters'}
            </button>
            <button className="btn sm" onClick={handleQuestions} disabled={loadingQ}>
              {I.spark} {loadingQ ? 'Scanning…' : 'Questions'}
            </button>
            <button className="btn sm" onClick={handleShare}>
              {copying === 'share' ? 'Link copied!' : 'Share'}
            </button>
            {!translatedJob && glossaries.length > 0 && (
              <select
                className="glossary-select"
                value={glossaryId}
                onChange={e => setGlossaryId(e.target.value)}
                title="Apply a glossary for consistent terms"
              >
                <option value="">No glossary</option>
                {glossaries.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            {!translatedJob && (
              <button className="btn sm accent" onClick={() => onTranslate(glossaryId)} disabled={translating}>
                {translating ? 'Translating…' : `Translate → ${tgt.name}`}
              </button>
            )}
          </div>
        </div>

        {/* Audio player (self-hosted file jobs only) */}
        {hasAudio && (
          <audio
            ref={audioRef}
            className="audio-player"
            controls
            preload="metadata"
            src={jobAudioUrl(job.id)}
            onTimeUpdate={onTimeUpdate}
          />
        )}

        {/* Search bar */}
        <div className="transcript-search">
          <span className="ico">{I.search}</span>
          <input
            placeholder="Search in transcript…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <span className="search-count">
              {visibleSegs.length + visibleTransSegs.length} match{visibleSegs.length + visibleTransSegs.length === 1 ? '' : 'es'}
            </span>
          )}
          {search && <span className="search-clear" onClick={() => setSearch('')}>✕</span>}
          {!search && uncertainCount > 0 && (
            <span className="uncertain-jump" onClick={jumpUncertain} title="Low-confidence segments to review">
              ⚠ {uncertainCount} to review
            </span>
          )}
        </div>

        {/* Chapters panel */}
        {chapters && chapters.length > 0 && (
          <div className="chapters-panel">
            <div className="chapters-head">
              <span className="summary-title">{I.history} Chapters</span>
              <span className="summary-close" onClick={() => setChapters(null)}>✕</span>
            </div>
            <div className="chapters-list">
              {chapters.map((c, i) => (
                <div key={i} className="chapter-row" onClick={() => goToTime(c.startSec)}>
                  <span className="chapter-time">{fmtDuration(c.startSec) || '0:00'}</span>
                  <div className="chapter-meta">
                    <span className="chapter-title">{c.title}</span>
                    {c.summary && <span className="chapter-summary">{c.summary}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary panel */}
        {summary && (
          <div className="summary-panel">
            <div className="summary-head">
              <span className="summary-title">{I.spark} Summary</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  className="glossary-select"
                  value={summaryKind}
                  disabled={summarizing}
                  onChange={e => { setSummaryKind(e.target.value); handleSummarize(e.target.value); }}
                  title="Summary style"
                >
                  <option value="generic">General</option>
                  <option value="meeting">Meeting</option>
                  <option value="lecture">Lecture</option>
                  <option value="podcast">Podcast</option>
                </select>
                <button className="btn ghost sm" title="Copy summary"
                  onClick={() => handleCopy(summaryToText(summary), 'sum')}>
                  {copying === 'sum' ? 'Copied!' : I.copy}
                </button>
                <button className="btn ghost sm" title="Download summary"
                  onClick={() => downloadBlob(new Blob([summaryToText(summary)], { type: 'text/plain' }), `${job.filename || job.id}-summary.txt`)}>
                  {I.download}
                </button>
                <span className="summary-close" onClick={() => setSummary(null)}>✕</span>
              </span>
            </div>
            {summary.overview && (
              <div className="summary-block">
                <h5>Overview</h5>
                <p style={{ margin: 0, color: 'var(--ink)', lineHeight: 1.5 }}>{summary.overview}</p>
              </div>
            )}
            {Array.isArray(summary.attendees) && summary.attendees.length > 0 && (
              <div className="summary-topics" style={{ marginBottom: 4 }}>
                {summary.attendees.map((a, i) => <span key={i} className="chip">{fmtActionItem(a)}</span>)}
              </div>
            )}
            {Array.isArray(summary.tldr) && summary.tldr.length > 0 && (
              <div className="summary-block">
                <h5>TL;DR</h5>
                <ul>{summary.tldr.map((t, i) => <li key={i}>{fmtActionItem(t)}</li>)}</ul>
              </div>
            )}
            {Array.isArray(summary.keyPoints) && summary.keyPoints.length > 0 && (
              <div className="summary-block">
                <h5>Key points</h5>
                <ul>{summary.keyPoints.map((t, i) => <li key={i}>{fmtActionItem(t)}</li>)}</ul>
              </div>
            )}
            {Array.isArray(summary.actionItems) && summary.actionItems.length > 0 && (
              <div className="summary-block">
                <h5>Action items</h5>
                <ul>{summary.actionItems.map((t, i) => (
                  <li key={i}>{fmtActionItem(t)}</li>
                ))}</ul>
              </div>
            )}
            {Array.isArray(summary.topics) && summary.topics.length > 0 && (
              <div className="summary-topics">
                {summary.topics.map((t, i) => <span key={i} className="chip">{fmtActionItem(t)}</span>)}
              </div>
            )}
            {Array.isArray(summary.sections) && summary.sections.length > 0 && (
              <div className="summary-block">
                <h5>Notes by topic</h5>
                {summary.sections.map((s, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <strong style={{ fontSize: 13 }}>{s.title}</strong>
                    {Array.isArray(s.notes) && s.notes.length > 0 && (
                      <ul style={{ margin: '4px 0' }}>{s.notes.map((n, j) => <li key={j}>{fmtActionItem(n)}</li>)}</ul>
                    )}
                    {Array.isArray(s.actions) && s.actions.length > 0 && (
                      <ul style={{ margin: '4px 0' }}>{s.actions.map((a, j) => (
                        <li key={j}>☐ {fmtActionItem(a)}</li>
                      ))}</ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Open questions panel */}
        {questions && (
          <div className="summary-panel">
            <div className="summary-head">
              <span className="summary-title">{I.spark} Open questions{questions.length ? ` (${questions.filter(q => !q.answered).length} open)` : ''}</span>
              <span className="summary-close" style={{ marginLeft: 'auto' }} onClick={() => setQuestions(null)}>✕</span>
            </div>
            {questions.length === 0 ? (
              <p style={{ color: 'var(--muted)', margin: 0 }}>No questions detected.</p>
            ) : (
              <ul style={{ margin: 0 }}>
                {questions.map((q, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <span style={{ marginRight: 6 }}>{q.answered ? '✅' : '❓'}</span>
                    <strong>{q.question}</strong>
                    {q.askedBy && <em style={{ color: 'var(--muted)' }}> — {q.askedBy}</em>}
                    {q.answer && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{q.answer}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className={`pane-grid ${translatedJob ? '' : 'single'}`}>
          {/* Original pane */}
          <div className="pane">
            <div className="pane-head">
              <div className="pane-lang">
                <span className="lang-flag" style={{ background: src.color }}>{src.flag}</span>
                {src.name} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12, marginLeft: 4 }}>Original</span>
              </div>
              <div className="pane-tools">
                <div className="pane-tool" title="Copy" onClick={() => handleCopy(fullText, 'orig2')}>{I.copy}</div>
              </div>
            </div>
            <div className="pane-body">
              {segments.length > 0 ? visibleSegs.map((seg, i) => (
                <p
                  key={i}
                  className={`speaker ${!search && i === activeSeg ? 'seg-active' : ''}`}
                  data-speaker={seg.speaker || 'Speaker'}
                  data-seg={search ? undefined : i}
                >
                  <span
                    className={`ts ${hasAudio ? 'seekable' : ''}`}
                    onClick={hasAudio ? () => seekTo(seg.start) : undefined}
                    title={hasAudio ? 'Play from here' : undefined}
                  >
                    {fmtDuration(seg.start)}
                  </span>
                  {editIdx === i ? (
                    <textarea
                      className="seg-edit"
                      autoFocus
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onBlur={() => saveEdit(i)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(i); }
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                  ) : (
                    <span
                      className={`${search ? '' : 'seg-text'} ${isUncertain(seg) ? 'seg-uncertain' : ''}`}
                      title={isUncertain(seg) ? 'Low confidence — review this line' : (search ? undefined : 'Double-click to edit')}
                      onDoubleClick={search ? undefined : () => startEdit(i, seg.text)}
                    >
                      {highlight(seg.text, search)}
                    </span>
                  )}
                </p>
              )) : (
                <p className="speaker">{highlight(fullText, search)}</p>
              )}
              {segments.length > 0 && visibleSegs.length === 0 && (
                <p className="speaker" style={{ color: 'var(--muted)' }}>No matches.</p>
              )}
            </div>
          </div>

          {/* Translation pane */}
          {translatedJob && (
            <div className="pane">
              <div className="pane-head">
                <div className="pane-lang">
                  <span className="lang-flag" style={{ background: tgt.color }}>{tgt.flag}</span>
                  {tgt.name} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12, marginLeft: 4 }}>Translation</span>
                </div>
                <div className="pane-tools">
                  <div className="pane-tool" title="Copy" onClick={() => handleCopy(translatedText, 'trans')}>{I.copy}</div>
                  <div className="pane-tool" title="More">{I.more}</div>
                </div>
              </div>
              <div className="pane-body">
                {translatedSegs.length > 0 ? visibleTransSegs.map((seg, i) => (
                  <p key={i} className="speaker" data-speaker={seg.speaker || 'Speaker'}>
                    <span className="ts">{fmtDuration(seg.start)}</span>
                    {highlight(seg.text, search)}
                  </p>
                )) : (
                  <p className="speaker">{highlight(translatedText, search)}</p>
                )}
                {translatedSegs.length > 0 && visibleTransSegs.length === 0 && (
                  <p className="speaker" style={{ color: 'var(--muted)' }}>No matches.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Refine bar */}
        <div className="refine">
          {refineHistory.length > 0 && (
            <div className="refine-history">
              {refineHistory.map((h, i) => (
                <div key={i} className="refine-history-item">
                  <span className="refine-q">{h.q}</span>
                  <span className="refine-a">{h.a}</span>
                </div>
              ))}
            </div>
          )}
          <div className="refine-input" onClick={() => { }}>
            <span className="spark">{I.spark}</span>
            <input
              placeholder="Ask Translator to refine…"
              value={refineInput}
              onChange={e => setRefineInput(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitRefine(refineInput); }}
              style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 14, color: 'var(--ink)' }}
            />
            <span className="kbd">⌘⏎</span>
          </div>
          <div className="refine-suggest">
            {REFINE_SUGGESTIONS.map(s => (
              <span key={s} className="suggest" onClick={() => submitRefine(s)}>{s}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Export toolbar */}
      <div className="result-toolbar">
        <div className="export-row">
          {EXPORT_FORMATS.map(fmt => (
            <button
              key={fmt}
              className="btn sm"
              onClick={() => handleExport(fmt)}
              disabled={exporting === fmt}
            >
              {exporting === fmt ? '…' : fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── History view ─────────────────────────────────────────────────────────────
function HistoryView({ jobs, onSelect, onDeleteJob, onSearch, loading }) {
  const [q, setQ] = useState('');

  // Search the FULL transcript text server-side (debounced), not just the 50
  // already-loaded jobs — Supabase doesn't ship transcript text in the list, so
  // client-only filtering would miss matches inside transcripts.
  useEffect(() => {
    const t = setTimeout(() => onSearch?.(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, onSearch]);

  return (
    <div style={{ padding: '24px 32px' }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">History</h1>
          <p className="page-sub">Search across every transcript — words spoken anywhere, not just titles.</p>
        </div>
      </div>

      <div className="url-input" style={{ marginBottom: 24 }}>
        <span className="ico">{I.search}</span>
        <input
          placeholder="Search inside all transcripts…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {q && <span className="search-clear" onClick={() => setQ('')}>✕</span>}
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}

      {!loading && jobs.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>{q ? `No transcripts match “${q}”.` : 'No jobs yet. Transcribe something to get started.'}</p>
      )}

      <div className="recent-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {jobs.map(job => (
          <RecentCard key={job.id} job={job} query={q} onSelect={onSelect} onDelete={onDeleteJob} />
        ))}
      </div>
    </div>
  );
}

// ─── Live recording view ──────────────────────────────────────────────────────
function LiveView({ source, onJobCreated }) {
  const [status, setStatus] = useState('idle'); // idle | recording | processing | error
  const [liveText, setLiveText] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [errMsg, setErrMsg] = useState('');

  const streamRef = useRef(null);
  const mrRef = useRef(null);
  const timerRef = useRef(null);
  const recordingRef = useRef(false);
  const idxRef = useRef(0);
  const clipsRef = useRef([]);          // [{ idx, text, segments, duration, language }]
  const pendingRef = useRef(new Set()); // in-flight /live/chunk POSTs
  const langRef = useRef('auto');

  const CLIP_MS = 5000; // each standalone clip is ~5s → near-live, Vercel-safe

  const stopTimer = () => clearInterval(timerRef.current);

  const pickMime = () =>
    MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';

  // Rebuild the visible transcript from whatever clips have returned, in order.
  const rebuildText = () => {
    const ordered = [...clipsRef.current].sort((a, b) => a.idx - b.idx);
    setLiveText(ordered.map(c => c.text).filter(Boolean).join(' ').trim());
  };

  const sendClip = (blob, idx) => {
    if (!blob || blob.size < 1200) return; // skip silent/near-empty clips
    const p = liveTranscribeChunk(blob, { language: langRef.current, task: 'transcribe' })
      .then(r => {
        // Lock onto the first detected language so later clips don't re-detect.
        if (langRef.current === 'auto' && r.language) langRef.current = r.language;
        clipsRef.current.push({ idx, text: r.text || '', segments: r.segments || [], duration: r.duration || 0, language: r.language });
        rebuildText();
      })
      .catch(err => { setErrMsg(err.message || 'Live chunk failed'); })
      .finally(() => { pendingRef.current.delete(p); });
    pendingRef.current.add(p);
  };

  // Record one standalone clip, then immediately start the next while this one
  // uploads. Restarting MediaRecorder per clip (vs timeslice) guarantees each
  // blob is a complete, independently-decodable file Whisper can read.
  const recordCycle = () => {
    if (!recordingRef.current || !streamRef.current) return;
    const mime = pickMime();
    const mr = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
    const parts = [];
    const myIdx = idxRef.current++;
    mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) parts.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(parts, { type: mime || 'audio/webm' });
      if (recordingRef.current) recordCycle(); // next clip starts right away
      sendClip(blob, myIdx);                    // transcribe this one in parallel
    };
    // Without this, a recorder error (codec hiccup, track ended) goes 'inactive'
    // WITHOUT firing onstop — the loop would die silently and "stop after one
    // sentence" with no message. Surface it instead.
    mr.onerror = (e) => {
      recordingRef.current = false;
      stopTimer();
      setErrMsg('Recording error: ' + (e?.error?.message || e?.error?.name || 'unknown'));
      setStatus('error');
    };
    mrRef.current = mr;
    try {
      mr.start();
    } catch (err) {
      recordingRef.current = false;
      stopTimer();
      setErrMsg('Could not start recorder: ' + err.message);
      setStatus('error');
      return;
    }
    setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, CLIP_MS);
  };

  const start = async () => {
    setErrMsg(''); setLiveText('');
    clipsRef.current = []; pendingRef.current = new Set(); idxRef.current = 0;
    langRef.current = source === 'auto' ? 'auto' : source;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // If the mic track ends mid-session (device unplugged, OS revokes), stop
      // cleanly instead of looping over a dead stream.
      stream.getTracks().forEach(t => t.addEventListener('ended', () => {
        if (recordingRef.current) {
          recordingRef.current = false;
          stopTimer();
          setErrMsg('Microphone disconnected.');
          setStatus('error');
        }
      }));
      recordingRef.current = true;
      setStatus('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
      recordCycle();
    } catch (err) {
      setErrMsg('Microphone access denied: ' + err.message);
      setStatus('error');
    }
  };

  const stop = async () => {
    recordingRef.current = false;
    stopTimer();
    setStatus('processing');

    const mr = mrRef.current;
    if (mr && mr.state !== 'inactive') mr.stop(); // flushes the final clip via onstop
    streamRef.current?.getTracks().forEach(t => t.stop());

    // Let the final clip's onstop queue its upload, then drain all pending POSTs.
    await new Promise(r => setTimeout(r, 400));
    await Promise.allSettled([...pendingRef.current]);

    // Stitch clips in order; offset each clip's segment times by the cumulative
    // duration of the clips before it so timestamps stay absolute.
    const ordered = [...clipsRef.current].sort((a, b) => a.idx - b.idx);
    let offset = 0;
    const segments = [];
    for (const c of ordered) {
      for (const s of c.segments) {
        segments.push({ ...s, start: (s.start || 0) + offset, end: (s.end || 0) + offset });
      }
      offset += c.duration || 0;
    }
    const text = ordered.map(c => c.text).filter(Boolean).join(' ').trim();
    if (!text && segments.length === 0) {
      setErrMsg('No speech captured.'); setStatus('error'); return;
    }
    try {
      const { jobId } = await liveFinalize({
        text, segments,
        language: ordered.find(c => c.language)?.language || (source === 'auto' ? null : source),
        task: 'transcribe', duration: offset, sourceName: 'Live recording'
      });
      if (jobId) onJobCreated(jobId); else setStatus('idle');
    } catch (err) {
      setErrMsg(err.message || 'Could not save recording'); setStatus('error');
    }
  };

  // Cleanup on unmount
  useEffect(() => () => {
    recordingRef.current = false;
    stopTimer();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div style={{ padding: '24px 32px' }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Live recording</h1>
          <p className="page-sub">Speak and see captions appear in real time. Auto-saved when you stop.</p>
        </div>
      </div>

      <div className="mic" style={{ marginBottom: 24 }}>
        <button
          className={`mic-btn ${status === 'recording' ? 'active' : ''}`}
          onClick={status === 'recording' ? stop : status === 'idle' || status === 'error' ? start : undefined}
          disabled={status === 'processing'}
          style={status === 'recording' ? { background: 'var(--accent)', color: '#fff' } : {}}
        >
          {status === 'processing' ? '…' : status === 'recording' ? '⏹' : I.mic}
        </button>
        <div className="mic-meta">
          {status === 'recording' && (
            <>
              <h4 style={{ color: 'var(--accent)' }}>Recording {mm}:{ss}</h4>
              <p>Click stop when done · transcript will be saved automatically</p>
            </>
          )}
          {status === 'processing' && (
            <>
              <h4>Transcribing…</h4>
              <p>Sending to Whisper · this takes a few seconds</p>
            </>
          )}
          {status === 'error' && (
            <>
              <h4 style={{ color: '#c7522a' }}>Error</h4>
              <p style={{ color: '#c7522a' }}>{errMsg}</p>
            </>
          )}
          {status === 'idle' && (
            <>
              <h4>Start recording</h4>
              <p>Live captions in 25+ languages · auto-saved on stop</p>
            </>
          )}
        </div>
        {status === 'recording' && (
          <div className="wave">
            {Array.from({ length: 28 }).map((_, i) => (
              <span key={i} style={{ height: `${8 + Math.abs(Math.sin(i * 0.6)) * 22}px` }} />
            ))}
          </div>
        )}
      </div>

      {errMsg && status === 'error' && (
        <div style={{ background: 'var(--accent-soft)', border: '1px solid #c7522a33', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#c7522a', marginBottom: 16 }}>
          {errMsg}
        </div>
      )}

      {liveText && (
        <div className="pane" style={{ minHeight: 200 }}>
          <div className="pane-head">
            <div className="pane-lang">Live transcript</div>
          </div>
          <div className="pane-body">
            <p className="speaker">{liveText}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Glossary view ────────────────────────────────────────────────────────────
function GlossaryView() {
  const [glossaries, setGlossaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTerms, setNewTerms] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listGlossaries();
      setGlossaries(data.glossaries || data || []);
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    // Backend expects entries: { sourceWord: targetWord } object, not array
    const entries = {};
    newTerms.split('\n').forEach(line => {
      const [src, ...rest] = line.split('=');
      if (src?.trim() && rest.length) entries[src.trim()] = rest.join('=').trim();
    });
    try {
      await createGlossary({ name: newName.trim(), entries });
      setCreating(false);
      setNewName('');
      setNewTerms('');
      load();
    } catch (err) {
      alert('Create failed: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this glossary?')) return;
    try {
      await deleteGlossary(id);
      load();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Glossary</h1>
          <p className="page-sub">Save word pairs to ensure consistent translation of technical terms.</p>
        </div>
        <button className="btn accent sm" onClick={() => setCreating(true)}>+ New glossary</button>
      </div>

      {creating && (
        <div className="pane" style={{ marginBottom: 24 }}>
          <div className="pane-head"><div className="pane-lang">New glossary</div></div>
          <div className="pane-body" style={{ padding: 16 }}>
            <input
              placeholder="Glossary name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              style={{ width: '100%', marginBottom: 12, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)', color: 'var(--ink)' }}
            />
            <textarea
              placeholder={"One term per line: source = translation\ne.g. Whisper = Whisper\nOpenAI = OpenAI"}
              value={newTerms}
              onChange={e => setNewTerms(e.target.value)}
              rows={6}
              style={{ width: '100%', marginBottom: 12, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--font-mono)', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn accent sm" onClick={handleCreate}>Create</button>
              <button className="btn sm" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}

      {!loading && glossaries.length === 0 && !creating && (
        <p style={{ color: 'var(--muted)' }}>No glossaries yet. Create one to improve translation consistency.</p>
      )}

      {glossaries.map(g => (
        <div key={g.id} className="pane" style={{ marginBottom: 16 }}>
          <div className="pane-head">
            <div className="pane-lang">{g.name}</div>
            <div className="pane-tools">
              <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 8 }}>
                {Object.keys(g.entries || {}).length} terms
              </span>
              <div className="pane-tool" title="Delete" onClick={() => handleDelete(g.id)}>✕</div>
            </div>
          </div>
          {Object.keys(g.entries || {}).length > 0 && (
            <div className="pane-body" style={{ padding: '8px 16px' }}>
              {Object.entries(g.entries || {}).slice(0, 5).map(([src, tgt], i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0', fontFamily: 'var(--font-mono)' }}>
                  <span style={{ color: 'var(--ink)', minWidth: 120 }}>{src}</span>
                  <span style={{ color: 'var(--muted)' }}>→</span>
                  <span style={{ color: 'var(--ink-2)' }}>{tgt}</span>
                </div>
              ))}
              {Object.keys(g.entries || {}).length > 5 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  +{Object.keys(g.entries).length - 5} more
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Settings view ────────────────────────────────────────────────────────────
function SettingsView({ apiKey, onApiKeyChange, accent, onAccentChange, theme, onThemeChange }) {
  const [draftKey, setDraftKey] = useState(apiKey);
  const [saved, setSaved] = useState(false);

  const save = () => {
    onApiKeyChange(draftKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Configure your Translator workspace.</p>
        </div>
      </div>

      <div className="pane" style={{ marginBottom: 20 }}>
        <div className="pane-head"><div className="pane-lang">API Key</div></div>
        <div className="pane-body" style={{ padding: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            Required when the server has <code>API_KEYS_REQUIRED=true</code>.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder="Paste your API key…"
              value={draftKey}
              onChange={e => setDraftKey(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)', color: 'var(--ink)' }}
            />
            <button className="btn accent sm" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
            {draftKey && (
              <button className="btn sm" onClick={() => { setDraftKey(''); onApiKeyChange(''); }}>Clear</button>
            )}
          </div>
        </div>
      </div>

      <div className="pane" style={{ marginBottom: 20 }}>
        <div className="pane-head"><div className="pane-lang">Appearance</div></div>
        <div className="pane-body" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {['light', 'dark'].map(t => (
              <button
                key={t}
                className={`btn sm ${theme === t ? 'accent' : ''}`}
                onClick={() => onThemeChange(t)}
                style={{ textTransform: 'capitalize' }}
              >
                {t}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Accent color</p>
          <div style={{ display: 'flex', gap: 10 }}>
            {ACCENTS.map(c => (
              <div
                key={c}
                onClick={() => onAccentChange(c)}
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: accent === c ? '2px solid var(--ink)' : '2px solid transparent',
                  outline: accent === c ? '2px solid var(--bg)' : 'none',
                  outlineOffset: 1,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: '#c7522a', color: '#fff', padding: '12px 20px', borderRadius: 10,
      zIndex: 9999, display: 'flex', gap: 12, alignItems: 'center', maxWidth: 480,
      boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
    }}>
      <span style={{ flex: 1, fontSize: 14 }}>{message}</span>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18 }}>✕</button>
    </div>
  );
}

// ─── Public shared-transcript page (no account needed) ────────────────────────
function SharePage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('t_theme') || 'light');
    getSharedTranscript(token).then(setData).catch(e => setError(e.message || 'Not found'));
  }, [token]);

  const segs = data?.segments || [];
  const fullText = data?.text || segs.map(s => s.text).join(' ');

  return (
    <div className="share-page">
      <header className="share-header">
        <div className="brand-mark">T</div>
        <span className="brand-name">Translator</span>
        <span className="share-badge">Shared transcript</span>
      </header>
      <main className="share-body">
        {error && <p className="share-error">{error}</p>}
        {!data && !error && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
        {data && (
          <>
            <div className="share-meta">
              {data.language && <span>{langInfo(data.language).name}</span>}
              {data.duration ? <span>· {fmtDuration(data.duration)}</span> : null}
              <button className="btn sm" style={{ marginLeft: 'auto' }}
                onClick={async () => { await navigator.clipboard.writeText(fullText).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? 'Copied!' : 'Copy text'}
              </button>
            </div>
            <div className="pane" style={{ borderRadius: 12 }}>
              <div className="pane-body">
                {segs.length > 0 ? segs.map((s, i) => (
                  <p key={i} className="speaker" data-speaker={s.speaker || 'Speaker'}>
                    <span className="ts">{fmtDuration(s.start)}</span>{s.text}
                  </p>
                )) : <p className="speaker">{fullText}</p>}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Public shared-transcript view: /s/<token> renders read-only, no app shell.
  const shareMatch = typeof window !== 'undefined' && window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)/);
  if (shareMatch) return <SharePage token={shareMatch[1]} />;

  return <MainApp />;
}

function MainApp() {
  // Persisted prefs
  const [theme, setTheme] = useState(() => localStorage.getItem('t_theme') || 'light');
  const [accent, setAccent] = useState(() => localStorage.getItem('t_accent') || '#1f5d4c');
  const [apiKey, setApiKeyState] = useState(() => getApiKey());

  // Nav
  const [activeView, setActiveView] = useState('transcribe');

  // Transcribe flow
  const [appState, setAppState] = useState('empty'); // empty | transcribing | result | batch
  const [batch, setBatch] = useState(null); // { processing, count, results }
  const [mode, setMode] = useState('file');
  const [source, setSource] = useState(() => localStorage.getItem('t_source') || 'auto');
  const [target, setTarget] = useState(() => localStorage.getItem('t_target') || 'en');
  const [detectedLang, setDetectedLang] = useState(null);
  // Accurate mode = larger/slower models (Groq whisper-large-v3 / gpt-4o-transcribe).
  const [accurate, setAccurate] = useState(() => localStorage.getItem('t_accurate') === '1');

  // Lang picker
  const [pickingLang, setPickingLang] = useState(null); // 'source' | 'target' | null

  // Job state
  const [currentJob, setCurrentJob] = useState(null);
  const [translatedJob, setTranslatedJob] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  // History
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  // Refine
  const [refineHistory, setRefineHistory] = useState([]);
  const [refining, setRefining] = useState(false);

  // Glossaries (for applying consistent terms during translation)
  const [glossaries, setGlossaries] = useState([]);

  // Error
  const [error, setError] = useState(null);

  // Load glossaries once for the translation picker.
  useEffect(() => {
    listGlossaries().then(d => setGlossaries(d.glossaries || d || [])).catch(() => {});
  }, []);

  // Apply theme + accent
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-soft', hexToSoft(accent, theme === 'dark'));
    localStorage.setItem('t_theme', theme);
    localStorage.setItem('t_accent', accent);
  }, [theme, accent]);

  // Remember the chosen languages across sessions.
  useEffect(() => { localStorage.setItem('t_source', source); }, [source]);
  useEffect(() => { localStorage.setItem('t_target', target); }, [target]);
  useEffect(() => { localStorage.setItem('t_accurate', accurate ? '1' : '0'); }, [accurate]);

  // ⌘K / Ctrl-K focuses the transcript search when viewing a result.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const input = document.querySelector('.transcript-search input');
        if (input) { e.preventDefault(); input.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load jobs on history view
  useEffect(() => {
    if (activeView === 'history' || activeView === 'transcribe') {
      loadJobs();
    }
  }, [activeView]);

  const loadJobs = async () => {
    setLoadingJobs(true);
    try {
      const data = await listJobs({ limit: 50 });
      setJobs(data.jobs || data || []);
    } catch { }
    setLoadingJobs(false);
  };

  // Server-side full-transcript search for the History view (stable identity so
  // the HistoryView debounce effect doesn't re-fire).
  const searchJobs = useCallback(async (q) => {
    setLoadingJobs(true);
    try {
      const data = await listJobs({ q: q || undefined, limit: 50 });
      setJobs(data.jobs || []);
    } catch { }
    setLoadingJobs(false);
  }, []);

  // ── actions ──

  const handleApiKeyChange = (key) => {
    setApiKey(key);
    setApiKeyState(key);
  };

  const handleThemeToggle = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  const handleSwap = () => {
    const s = source;
    setSource(target === 'auto' ? 'en' : target);
    setTarget(s === 'auto' ? 'en' : s);
  };

  const reset = () => {
    setAppState('empty');
    setCurrentJob(null);
    setTranslatedJob(null);
    setRefineHistory([]);
    setPendingFile(null);
    setDetectedLang(null);
    setBatch(null);
  };

  const startTranscribe = async (file, url) => {
    setAppState('transcribing');
    setError(null);
    // Capture file info in local vars — state update is async so pendingFile
    // won't reflect yet when we normalize the response below
    const fileName = file?.name || null;
    const fileSize = file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : null;
    if (file) setPendingFile({ name: fileName, size: fileSize });
    try {
      let job;
      if (file) {
        job = await transcribeFile(file, {
          task: 'transcribe',
          language: source === 'auto' ? undefined : source,
          wordTimestamps: true,
          quality: accurate ? 'accurate' : 'fast',
        });
      } else {
        job = await ingestUrl(url, {
          task: 'transcribe',
          language: source === 'auto' ? undefined : source,
          wordTimestamps: true,
          quality: accurate ? 'accurate' : 'fast',
        });
      }
      if (job.language) setDetectedLang(langInfo(job.language).name);
      // Normalize: backend returns jobId not id, may lack filename/title
      const normalized = {
        ...job,
        id: job.id || job.jobId,
        filename: job.filename || job.title || fileName || url || 'Recording',
      };
      setCurrentJob(normalized);
      setAppState('result');
      loadJobs();
      // Surface genuinely empty results instead of showing a blank transcript.
      const txt = (normalized.transcription || normalized.text || '').trim();
      if (!txt && !(normalized.segments || []).length) {
        setError('No speech detected — the recording may be silent, too quiet, or an unsupported format.');
      } else {
        await maybeAutoTranslate(normalized);
      }
    } catch (err) {
      setError(err.message || 'Transcription failed');
      setAppState('empty');
    }
  };

  const handleFile = (file) => startTranscribe(file, null);
  const handleUrl = (url) => startTranscribe(null, url);

  const handleBatch = async (files) => {
    setAppState('batch');
    setBatch({ processing: true, count: files.length, results: [] });
    setError(null);
    try {
      const res = await transcribeBatch(files, {
        task: 'transcribe',
        language: source === 'auto' ? undefined : source,
        quality: accurate ? 'accurate' : 'fast',
      });
      setBatch({ processing: false, count: res.total, ok: res.ok, failed: res.failed, results: res.results || [] });
      loadJobs();
    } catch (err) {
      setError(err.message || 'Batch transcription failed');
      setAppState('empty');
      setBatch(null);
    }
  };

  const handleTranslate = async (glossaryId) => {
    if (!currentJob) return;
    setTranslating(true);
    setError(null);
    try {
      // Backend returns { jobId } metadata only — fetch full job to get segments
      const meta = await translateJobSegments(currentJob.id, target, source === 'auto' ? currentJob.language : source, glossaryId || undefined);
      const jobId = meta.jobId || meta.id;
      if (!jobId) throw new Error('No jobId in translation response');
      const full = await getJob(jobId);
      setTranslatedJob(full?.job || full);
    } catch (err) {
      setError(err.message || 'Translation failed');
    } finally {
      setTranslating(false);
    }
  };

  // The FROM→TO picker promises translation, but every input path only
  // transcribes. So after a fresh transcription, auto-translate to the chosen
  // target when it differs from the detected language. Non-fatal: the transcript
  // still shows, and the manual "Translate →" button remains for re-runs.
  const maybeAutoTranslate = async (job) => {
    if (!job?.id) return;
    const detected = String(job.language || '').slice(0, 2).toLowerCase();
    const tgt = String(target || '').slice(0, 2).toLowerCase();
    if (!tgt || tgt === detected) return; // same language → nothing to translate
    setTranslating(true);
    try {
      const meta = await translateJobSegments(job.id, target, job.language || undefined, undefined);
      const newId = meta.jobId || meta.id;
      if (newId) { const full = await getJob(newId); setTranslatedJob(full?.job || full); }
    } catch { /* keep the transcript; user can retry via the Translate button */ }
    finally { setTranslating(false); }
  };

  const handleRefine = async (message) => {
    if (!currentJob || refining) return;
    setRefining(true);
    try {
      const res = await chatRefine({
        message,
        transcription: currentJob.transcription,
        // Alternate user/assistant for proper history format
        history: refineHistory.flatMap(h => [
          { role: 'user', content: h.q },
          { role: 'assistant', content: h.a },
        ]),
      });
      // Backend returns { response: text } — not reply/text
      setRefineHistory(h => [...h, { q: message, a: res.response || res.refinedTranscription || '' }]);
    } catch (err) {
      setError(err.message || 'Refine failed');
    } finally {
      setRefining(false);
    }
  };

  const handleSelectJob = async (job) => {
    const id = job.id || job.jobId;
    setAppState('result');
    setActiveView('transcribe');
    setTranslatedJob(null);
    setRefineHistory([]);

    // List view strips segments — fetch full job so transcript renders
    try {
      const data = await getJob(id);
      const full = data?.job || data || job;
      const normalized = {
        ...full,
        id: full.id || id,
        transcription: full.transcription || full.text || '',
        filename: full.filename || full.sourceName || full.title || id,
      };
      setCurrentJob(normalized);
      if (normalized.language) setDetectedLang(langInfo(normalized.language).name);
    } catch {
      // Fallback to passed-in stub so UI at least shows something
      const normalized = {
        ...job,
        id,
        transcription: job.transcription || job.text || '',
        filename: job.filename || job.sourceName || job.title || id,
      };
      setCurrentJob(normalized);
      if (normalized.language) setDetectedLang(langInfo(normalized.language).name);
    }
  };

  const handleDeleteJob = async (id) => {
    try {
      await deleteJob(id);
      setJobs(j => j.filter(jj => jj.id !== id));
      if (currentJob?.id === id) reset();
    } catch (err) {
      setError(err.message || 'Delete failed');
    }
  };

  const handleLiveJobCreated = async (jobId) => {
    try {
      const data = await getJob(jobId);
      const job = data?.job || data;
      if (job) {
        await handleSelectJob(job);
        await maybeAutoTranslate(job); // honor the FROM→TO target for live too
      }
    } catch { }
  };

  // ── render ──

  const renderTranscribeView = () => (
    <>
      <Topbar
        appState={appState}
        title={currentJob?.filename}
        onReset={reset}
      />
      <div className="content">
        {appState === 'empty' && (
          <>
            <div className="page-head">
              <div>
                <h1 className="page-title">Translate <em>anything</em> you can hear.</h1>
                <p className="page-sub">Upload, paste a link, or record live. We'll transcribe and translate in seconds.</p>
              </div>
            </div>
            <LangBar
              source={source} target={target}
              onSwap={handleSwap}
              onPickSource={() => setPickingLang('source')}
              onPickTarget={() => setPickingLang('target')}
              detectedLang={detectedLang}
            />
            <Modes mode={mode} onChange={setMode} />
            <label className="accurate-toggle" title="Accurate mode uses larger, slower models (Groq whisper-large-v3 / gpt-4o-transcribe) for lower error rates. Off = fast & cheap (turbo).">
              <input type="checkbox" checked={accurate} onChange={e => setAccurate(e.target.checked)} />
              <span>Accurate mode {accurate ? '· slower, lower error rate' : '· fast & cheap'}</span>
            </label>
            {mode === 'file' && <FileDrop onFile={handleFile} onBatch={handleBatch} />}
            {mode === 'url' && <UrlInput onUrl={handleUrl} />}
            {mode === 'mic' && <MicPanel onStart={() => setActiveView('live')} />}
            <RecentSection jobs={jobs} onSelect={handleSelectJob} onDeleteJob={handleDeleteJob} />
          </>
        )}

        {appState === 'batch' && batch && (
          <>
            <div className="page-head">
              <div>
                <h1 className="page-title">
                  {batch.processing ? <>Transcribing {batch.count} files<em>…</em></> : 'Batch complete'}
                </h1>
                <p className="page-sub">
                  {batch.processing
                    ? 'Processing in parallel · this runs in the background'
                    : `${batch.ok} succeeded${batch.failed ? `, ${batch.failed} failed` : ''} of ${batch.count}`}
                </p>
              </div>
            </div>
            <BatchView batch={batch} onOpen={handleSelectJob} />
          </>
        )}

        {appState === 'transcribing' && (
          <>
            <div className="page-head">
              <div>
                <h1 className="page-title">Listening<em>…</em></h1>
                <p className="page-sub">This usually takes about a minute per 10 minutes of audio.</p>
              </div>
            </div>
            <Transcribing
              fileName={pendingFile?.name}
              fileSize={pendingFile?.size}
            />
          </>
        )}

        {appState === 'result' && currentJob && (
          <>
            <div className="page-head">
              <div>
                <h1 className="page-title">{currentJob.filename || 'Transcript'}</h1>
                <p className="page-sub">
                  {detectedLang ? `Auto-detected ${detectedLang}` : langInfo(source).name} → {langInfo(target).name}
                  {currentJob.createdAt ? ` · ${new Date(currentJob.createdAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              <LangBar
                source={currentJob.language || source}
                target={target}
                onSwap={handleSwap}
                onPickSource={() => setPickingLang('source')}
                onPickTarget={() => setPickingLang('target')}
              />
            </div>
            <ResultView
              job={currentJob}
              translatedJob={translatedJob}
              source={currentJob.language || source}
              target={target}
              onTranslate={handleTranslate}
              translating={translating}
              refineHistory={refineHistory}
              onRefine={handleRefine}
              onError={setError}
              glossaries={glossaries}
            />
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="app">
      <Sidebar
        activeView={activeView}
        onNav={(v) => { setActiveView(v); }}
        jobCount={jobs.length}
        theme={theme}
        onThemeToggle={handleThemeToggle}
        apiKey={apiKey}
      />

      <div className="main">
        {activeView === 'transcribe' && renderTranscribeView()}

        {activeView === 'live' && (
          <>
            <div className="topbar">
              <div className="breadcrumb"><b>Live</b></div>
            </div>
            <div className="content">
              <LiveView source={source} onJobCreated={handleLiveJobCreated} />
            </div>
          </>
        )}

        {activeView === 'history' && (
          <>
            <div className="topbar">
              <div className="breadcrumb"><b>History</b></div>
            </div>
            <div className="content">
              <HistoryView
                jobs={jobs}
                onSelect={handleSelectJob}
                onDeleteJob={handleDeleteJob}
                onSearch={searchJobs}
                loading={loadingJobs}
              />
            </div>
          </>
        )}

        {activeView === 'glossary' && (
          <>
            <div className="topbar">
              <div className="breadcrumb"><b>Glossary</b></div>
            </div>
            <div className="content">
              <GlossaryView />
            </div>
          </>
        )}

        {activeView === 'settings' && (
          <>
            <div className="topbar">
              <div className="breadcrumb"><b>Settings</b></div>
            </div>
            <div className="content">
              <SettingsView
                apiKey={apiKey}
                onApiKeyChange={handleApiKeyChange}
                accent={accent}
                onAccentChange={setAccent}
                theme={theme}
                onThemeChange={setTheme}
              />
            </div>
          </>
        )}
      </div>

      {/* Language picker modal */}
      {pickingLang && (
        <LangPicker
          value={pickingLang === 'source' ? source : target}
          excludeAuto={pickingLang === 'target'}
          onChange={(code) => {
            if (pickingLang === 'source') setSource(code);
            else setTarget(code);
          }}
          onClose={() => setPickingLang(null)}
        />
      )}

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
    </div>
  );
}
