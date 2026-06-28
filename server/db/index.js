// Persistence layer — two adapters:
//   • Supabase  (when SUPABASE_URL + SUPABASE_SERVICE_KEY are set)  → production/Vercel
//   • lowdb     (JSON file locally, Memory in tests)                 → dev / CI
//
// All exported functions keep the same signature regardless of adapter.

import { createClient } from '@supabase/supabase-js';
import { Low, Memory } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── adapter selection ────────────────────────────────────────────────────────

function useSupabase() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

function useMemoryAdapter() {
  return !!process.env.VERCEL || process.env.NODE_ENV === 'test';
}

// ─── shared id generator ──────────────────────────────────────────────────────

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPABASE ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

let _sb;
function sb() {
  if (!_sb) {
    _sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return _sb;
}

// snake_case DB row → camelCase app object
function jobFromRow(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    status: 'completed',
    type: r.type,
    sourceName: r.source_name,
    language: r.language,
    task: r.task,
    method: r.method,
    duration: r.duration,
    text: r.text,
    segments: r.segments || [],
    meta: r.meta || {},
  };
}

function stripSegments(job) {
  const { segments, ...rest } = job;
  return { ...rest, segmentCount: segments?.length || 0 };
}

// Build a short excerpt of `text` centered on the first match of `q`, so search
// results can show *why* a job matched without shipping the whole transcript.
function makeSnippet(text, q, radius = 90) {
  if (!text) return '';
  const i = text.toLowerCase().indexOf(String(q || '').toLowerCase());
  if (i < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + String(q).length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

// ─── Supabase: jobs ───────────────────────────────────────────────────────────

async function sb_createJob(payload) {
  const jobId = id();
  const row = {
    id: jobId,
    type: payload.type || 'transcription',
    source_name: payload.sourceName || null,
    language: payload.language || null,
    task: payload.task || 'transcribe',
    method: payload.method || null,
    duration: payload.duration || null,
    text: payload.text || '',
    segments: payload.segments || [],
    meta: payload.meta || {},
  };
  const { data, error } = await sb().from('translator_jobs').insert(row).select().single();
  if (error) throw new Error(error.message);
  return jobFromRow(data);
}

// Neutralize characters that have meaning in PostgREST's .or() filter grammar
// so a search term cannot inject extra filter conditions. Reserved: , . ( ) ":*
// and the ilike wildcards % _. We strip them rather than escape — a search box
// has no legitimate need for them, and stripping keeps the query simple.
function sanitizePostgrest(term) {
  return String(term).replace(/[,.()":*%_\\]/g, ' ').trim().slice(0, 200);
}

async function sb_listJobs({ limit = 50, offset = 0, q, language, task, type } = {}) {
  // Pull `text` only when searching, so list payloads stay small but search
  // results can carry a matched-excerpt snippet.
  const cols = 'id,created_at,type,source_name,language,task,method,duration,segments' + (q ? ',text' : '');
  let query = sb().from('translator_jobs').select(cols, { count: 'exact' });
  if (language) query = query.eq('language', language);
  if (task) query = query.eq('task', task);
  if (type) query = query.eq('type', type);
  if (q) {
    const safe = sanitizePostgrest(q);
    if (safe) query = query.or(`text.ilike.%${safe}%,source_name.ilike.%${safe}%`);
  }
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const jobs = (data || []).map((r) => {
    const job = stripSegments(jobFromRow(r));
    if (q) job.snippet = makeSnippet(r.text, q);
    delete job.text; // never ship the full transcript in a list response
    return job;
  });
  return { jobs, total: count || 0 };
}

async function sb_getJob(jobId) {
  const { data, error } = await sb().from('translator_jobs').select('*').eq('id', jobId).single();
  if (error) return null;
  return jobFromRow(data);
}

async function sb_getJobByShareToken(token) {
  const { data, error } = await sb().from('translator_jobs').select('*').filter('meta->>shareToken', 'eq', token).single();
  if (error) return null;
  return jobFromRow(data);
}

async function sb_updateJob(jobId, patch) {
  const col = {};
  if (patch.text !== undefined) col.text = patch.text;
  if (patch.segments !== undefined) col.segments = patch.segments;
  if (patch.language !== undefined) col.language = patch.language;
  if (patch.meta !== undefined) col.meta = patch.meta;
  if (patch.duration !== undefined) col.duration = patch.duration;
  const { data, error } = await sb().from('translator_jobs').update(col).eq('id', jobId).select().single();
  if (error) return null;
  return jobFromRow(data);
}

async function sb_deleteJob(jobId) {
  const { error } = await sb().from('translator_jobs').delete().eq('id', jobId);
  return !error;
}

// ─── Supabase: API keys ───────────────────────────────────────────────────────

async function sb_createApiKey({ label, plan = 'free', dailyMinutes = 30 }) {
  const key = 'tr_' + id() + id();
  const { data, error } = await sb().from('translator_api_keys').insert({
    id: id(), key, label: label || 'unnamed',
    revoked: false, quota_seconds: dailyMinutes * 60,
  }).select().single();
  if (error) throw new Error(error.message);
  return { key: data.key, label: data.label, plan, dailyMinutes, createdAt: data.created_at, revoked: false };
}

async function sb_findApiKey(key) {
  const { data } = await sb().from('translator_api_keys').select('*').eq('key', key).eq('revoked', false).single();
  if (!data) return null;
  return { key: data.key, label: data.label, revoked: false, quotaSeconds: data.quota_seconds, createdAt: data.created_at };
}

async function sb_listApiKeys() {
  const { data } = await sb().from('translator_api_keys').select('*').order('created_at', { ascending: false });
  return (data || []).map(k => ({ ...k, key: k.key.slice(0, 8) + '…' }));
}

async function sb_revokeApiKey(key) {
  const { error } = await sb().from('translator_api_keys').update({ revoked: true }).eq('key', key);
  return !error;
}

// ─── Supabase: usage ──────────────────────────────────────────────────────────

async function sb_recordUsage({ key, seconds = 0, endpoint }) {
  const day = todayUtc();
  // Upsert with increment via RPC or manual read-modify-write
  const { data: existing } = await sb().from('translator_usage').select('*').eq('key', key).eq('day', day).single();
  if (existing) {
    const endpoints = { ...existing.endpoints, [endpoint]: (existing.endpoints[endpoint] || 0) + 1 };
    await sb().from('translator_usage').update({
      seconds: existing.seconds + seconds,
      calls: existing.calls + 1,
      endpoints,
    }).eq('id', existing.id);
  } else {
    await sb().from('translator_usage').insert({
      key, day, seconds, calls: 1, endpoints: { [endpoint]: 1 },
    });
  }
}

async function sb_getUsageToday(key) {
  const day = todayUtc();
  const { data } = await sb().from('translator_usage').select('*').eq('key', key).eq('day', day).single();
  return data || { key, day, seconds: 0, calls: 0, endpoints: {} };
}

// ─── Supabase: glossaries ─────────────────────────────────────────────────────

async function sb_createGlossary({ name, sourceLang, targetLang, entries }) {
  const { data, error } = await sb().from('translator_glossaries').insert({
    id: 'gl_' + id(),
    name: name || 'untitled',
    source_lang: sourceLang || null,
    target_lang: targetLang || null,
    entries: entries || {},
  }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name, sourceLang: data.source_lang, targetLang: data.target_lang, entries: data.entries, createdAt: data.created_at };
}

async function sb_listGlossaries() {
  const { data } = await sb().from('translator_glossaries').select('*').order('created_at', { ascending: false });
  return (data || []).map(g => ({
    id: g.id, name: g.name,
    sourceLang: g.source_lang, targetLang: g.target_lang,
    entries: g.entries,
    entryCount: Object.keys(g.entries || {}).length,
    createdAt: g.created_at,
  }));
}

async function sb_getGlossary(glossaryId) {
  const { data } = await sb().from('translator_glossaries').select('*').eq('id', glossaryId).single();
  if (!data) return null;
  return { id: data.id, name: data.name, sourceLang: data.source_lang, targetLang: data.target_lang, entries: data.entries, createdAt: data.created_at };
}

async function sb_updateGlossary(glossaryId, patch) {
  const col = {};
  if (patch.name !== undefined) col.name = patch.name;
  if (patch.sourceLang !== undefined) col.source_lang = patch.sourceLang;
  if (patch.targetLang !== undefined) col.target_lang = patch.targetLang;
  if (patch.entries !== undefined) {
    const { data: existing } = await sb().from('translator_glossaries').select('entries').eq('id', glossaryId).single();
    col.entries = { ...(existing?.entries || {}), ...patch.entries };
  }
  const { data, error } = await sb().from('translator_glossaries').update(col).eq('id', glossaryId).select().single();
  if (error) return null;
  return { id: data.id, name: data.name, entries: data.entries };
}

async function sb_deleteGlossary(glossaryId) {
  const { error } = await sb().from('translator_glossaries').delete().eq('id', glossaryId);
  return !error;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOWDB ADAPTER (local dev + tests)
// ═══════════════════════════════════════════════════════════════════════════════

const defaultData = { jobs: [], apiKeys: [], usage: [], glossaries: [] };
let _db;

async function getDb() {
  if (_db) return _db;
  let adapter;
  if (useMemoryAdapter()) {
    adapter = new Memory();
  } else {
    const dataDir = join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    adapter = new JSONFile(join(dataDir, 'translator.json'));
  }
  _db = new Low(adapter, defaultData);
  await _db.read();
  _db.data ||= defaultData;
  await _db.write();
  return _db;
}

async function lo_createJob(payload) {
  const d = await getDb();
  const job = {
    id: id(), createdAt: new Date().toISOString(), status: 'completed',
    type: payload.type || 'transcription', sourceName: payload.sourceName || null,
    language: payload.language || null, task: payload.task || 'transcribe',
    method: payload.method || null, duration: payload.duration || null,
    text: payload.text || '', segments: payload.segments || [], meta: payload.meta || {},
  };
  d.data.jobs.unshift(job);
  d.data.jobs = d.data.jobs.slice(0, 500);
  await d.write();
  return job;
}

async function lo_listJobs({ limit = 50, offset = 0, q, language, task, type } = {}) {
  const d = await getDb();
  let rows = d.data.jobs;
  if (q) { const n = String(q).toLowerCase(); rows = rows.filter(j => (j.text || '').toLowerCase().includes(n) || (j.sourceName || '').toLowerCase().includes(n)); }
  if (language) rows = rows.filter(j => j.language === language);
  if (task) rows = rows.filter(j => j.task === task);
  if (type) rows = rows.filter(j => j.type === type);
  const jobs = rows.slice(offset, offset + limit).map((j) => {
    const job = stripSegments(j);
    if (q) { job.snippet = makeSnippet(j.text, q); delete job.text; }
    return job;
  });
  return { jobs, total: rows.length };
}

async function lo_getJob(jobId) {
  const d = await getDb();
  return d.data.jobs.find(j => j.id === jobId) || null;
}

async function lo_getJobByShareToken(token) {
  const d = await getDb();
  return d.data.jobs.find(j => j.meta?.shareToken === token) || null;
}

async function lo_updateJob(jobId, patch) {
  const d = await getDb();
  const job = d.data.jobs.find(j => j.id === jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  await d.write();
  return job;
}

async function lo_deleteJob(jobId) {
  const d = await getDb();
  const before = d.data.jobs.length;
  d.data.jobs = d.data.jobs.filter(j => j.id !== jobId);
  await d.write();
  return d.data.jobs.length < before;
}

async function lo_createApiKey({ label, plan = 'free', dailyMinutes = 30 }) {
  const d = await getDb();
  d.data.apiKeys ||= [];
  const key = 'tr_' + id() + id();
  const record = { key, label: label || 'unnamed', plan, dailyMinutes, createdAt: new Date().toISOString(), revoked: false };
  d.data.apiKeys.push(record);
  await d.write();
  return record;
}

async function lo_findApiKey(key) {
  const d = await getDb();
  d.data.apiKeys ||= [];
  return d.data.apiKeys.find(k => k.key === key && !k.revoked) || null;
}

async function lo_listApiKeys() {
  const d = await getDb();
  d.data.apiKeys ||= [];
  return d.data.apiKeys.map(k => ({ ...k, key: k.key.slice(0, 8) + '…' }));
}

async function lo_revokeApiKey(key) {
  const d = await getDb();
  d.data.apiKeys ||= [];
  const rec = d.data.apiKeys.find(k => k.key === key);
  if (!rec) return false;
  rec.revoked = true;
  await d.write();
  return true;
}

async function lo_recordUsage({ key, seconds = 0, endpoint }) {
  const d = await getDb();
  d.data.usage ||= [];
  const day = todayUtc();
  const existing = d.data.usage.find(u => u.key === key && u.day === day);
  if (existing) {
    existing.seconds += seconds;
    existing.calls += 1;
    existing.endpoints[endpoint] = (existing.endpoints[endpoint] || 0) + 1;
  } else {
    d.data.usage.push({ key, day, seconds, calls: 1, endpoints: { [endpoint]: 1 } });
  }
  const cutoff = new Date(Date.now() - 35 * 86400_000).toISOString().slice(0, 10);
  d.data.usage = d.data.usage.filter(u => u.day >= cutoff);
  await d.write();
}

async function lo_getUsageToday(key) {
  const d = await getDb();
  d.data.usage ||= [];
  const day = todayUtc();
  return d.data.usage.find(u => u.key === key && u.day === day) || { key, day, seconds: 0, calls: 0, endpoints: {} };
}

async function lo_createGlossary({ name, sourceLang, targetLang, entries }) {
  const d = await getDb();
  d.data.glossaries ||= [];
  const rec = { id: 'gl_' + id(), name: name || 'untitled', sourceLang: sourceLang || null, targetLang: targetLang || null, entries: entries || {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  d.data.glossaries.push(rec);
  await d.write();
  return rec;
}

async function lo_listGlossaries() {
  const d = await getDb();
  return (d.data.glossaries || []).map(g => ({ ...g, entryCount: Object.keys(g.entries || {}).length }));
}

async function lo_getGlossary(glossaryId) {
  const d = await getDb();
  return (d.data.glossaries || []).find(g => g.id === glossaryId) || null;
}

async function lo_updateGlossary(glossaryId, patch) {
  const d = await getDb();
  const g = (d.data.glossaries || []).find(x => x.id === glossaryId);
  if (!g) return null;
  if (patch.name !== undefined) g.name = patch.name;
  if (patch.sourceLang !== undefined) g.sourceLang = patch.sourceLang;
  if (patch.targetLang !== undefined) g.targetLang = patch.targetLang;
  if (patch.entries !== undefined) g.entries = { ...g.entries, ...patch.entries };
  g.updatedAt = new Date().toISOString();
  await d.write();
  return g;
}

async function lo_deleteGlossary(glossaryId) {
  const d = await getDb();
  const before = (d.data.glossaries || []).length;
  d.data.glossaries = (d.data.glossaries || []).filter(g => g.id !== glossaryId);
  await d.write();
  return (d.data.glossaries || []).length < before;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API — lazy dispatch to correct adapter
//
// The adapter is chosen on FIRST call (memoized), never at import time. This
// avoids a subtle data-loss trap: server/index.js runs dotenv.config() AFTER its
// route imports, which transitively import this module. If we picked the adapter
// at import time, process.env.SUPABASE_URL would still be unset and we'd silently
// fall back to lowdb even when Supabase is configured. Deciding lazily means the
// first real DB call happens long after env vars are loaded.
// ═══════════════════════════════════════════════════════════════════════════════

let _useSupabase = null;
function adapterChosen() {
  if (_useSupabase === null) _useSupabase = useSupabase();
  return _useSupabase;
}

// Build a dispatcher that routes to the Supabase or lowdb implementation on each
// call, resolving the adapter lazily and memoizing the choice.
function dispatch(sbFn, loFn) {
  return (...args) => (adapterChosen() ? sbFn : loFn)(...args);
}

export const createJob       = dispatch(sb_createJob,       lo_createJob);
export const listJobs        = dispatch(sb_listJobs,        lo_listJobs);
export const getJob          = dispatch(sb_getJob,          lo_getJob);
export const getJobByShareToken = dispatch(sb_getJobByShareToken, lo_getJobByShareToken);
export const updateJob       = dispatch(sb_updateJob,       lo_updateJob);
export const deleteJob       = dispatch(sb_deleteJob,       lo_deleteJob);

export const createApiKey    = dispatch(sb_createApiKey,    lo_createApiKey);
export const findApiKey      = dispatch(sb_findApiKey,      lo_findApiKey);
export const listApiKeys     = dispatch(sb_listApiKeys,     lo_listApiKeys);
export const revokeApiKey    = dispatch(sb_revokeApiKey,    lo_revokeApiKey);

export const recordUsage     = dispatch(sb_recordUsage,     lo_recordUsage);
export const getUsageToday   = dispatch(sb_getUsageToday,   lo_getUsageToday);

export const createGlossary  = dispatch(sb_createGlossary,  lo_createGlossary);
export const listGlossaries  = dispatch(sb_listGlossaries,  lo_listGlossaries);
export const getGlossary     = dispatch(sb_getGlossary,     lo_getGlossary);
export const updateGlossary  = dispatch(sb_updateGlossary,  lo_updateGlossary);
export const deleteGlossary  = dispatch(sb_deleteGlossary,  lo_deleteGlossary);
