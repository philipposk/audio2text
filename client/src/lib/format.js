// Pure presentation helpers shared across the UI. No React, no side effects —
// kept out of App.jsx so components stay focused on rendering.
import { LANGS } from '../icons';

// Compute a soft tint of the accent colour for backgrounds.
export function hexToSoft(hex, dark) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (dark) return `rgba(${r},${g},${b},0.14)`;
  const m = 0.88;
  return `rgb(${Math.round(r + (255 - r) * m)}, ${Math.round(g + (255 - g) * m)}, ${Math.round(b + (255 - b) * m)})`;
}

// Seconds → "m:ss".
export function fmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ISO timestamp → relative day label.
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) return 'Today';
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

// Resolve a language by ISO code ('el') OR the full English name Whisper returns
// in verbose_json ('greek'). Falls back to a synthesized entry so an uncommon
// language still displays sensibly instead of collapsing to "Auto-detect".
export function langInfo(code) {
  if (!code) return LANGS[0];
  const lc = String(code).toLowerCase();
  const byCode = LANGS.find(l => l.code === lc);
  if (byCode) return byCode;
  const byName = LANGS.find(l => l.name.toLowerCase() === lc);
  if (byName) return byName;
  if (lc === 'auto') return LANGS[0];
  const flag = lc.slice(0, 2).toUpperCase();
  return { code: lc, name: lc.charAt(0).toUpperCase() + lc.slice(1), flag, color: '#7c7a72' };
}

// Summary action items may be plain strings or {task,owner,due} objects —
// normalize to a readable line (rendering a raw object as a React child throws).
export function fmtActionItem(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const parts = [item.task || item.text || ''];
    if (item.owner) parts.push(`— ${item.owner}`);
    if (item.due) parts.push(`(${item.due})`);
    return parts.filter(Boolean).join(' ');
  }
  return String(item ?? '');
}
