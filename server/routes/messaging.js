// Messaging integrations. Webhook endpoints for Telegram, WhatsApp (Twilio),
// and Messenger. Telegram is fully wired: receive voice/audio, transcribe,
// reply with text. WhatsApp/Messenger remain stubs pending vendor credentials.

import express from 'express';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { transcribeAudio } from '../utils/transcription.js';
import { createJob } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// ---------- Telegram ----------

const TG_API = (token) => `https://api.telegram.org/bot${token}`;
const TG_FILE_API = (token) => `https://api.telegram.org/file/bot${token}`;

async function tgGetFile(token, fileId) {
  const res = await fetch(`${TG_API(token)}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram getFile failed: ${JSON.stringify(json)}`);
  return json.result.file_path;
}

async function tgDownload(token, filePath, destPath) {
  const url = `${TG_FILE_API(token)}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telegram file download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
  return destPath;
}

async function tgSendMessage(token, chatId, text, replyToMessageId) {
  const res = await fetch(`${TG_API(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      parse_mode: 'Markdown'
    })
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error('[telegram] sendMessage failed', res.status, txt);
  }
}

/**
 * POST /api/messaging/telegram
 * Telegram bot webhook. Configure with:
 *   curl -F "url=https://YOUR_DOMAIN/api/messaging/telegram?secret=YOUR_SECRET" \
 *        https://api.telegram.org/bot<TOKEN>/setWebhook
 * Env:
 *   TELEGRAM_BOT_TOKEN     — required
 *   TELEGRAM_WEBHOOK_SECRET — optional shared secret (must match `?secret=` query)
 */
router.post('/telegram', async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(501).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(403).json({ error: 'Bad webhook secret' });
  }

  // Always 200 quickly so Telegram doesn't retry while we work.
  res.json({ ok: true });

  const message = req.body?.message || req.body?.channel_post;
  if (!message) return;
  const chatId = message.chat?.id;
  const replyTo = message.message_id;

  try {
    if (message.text === '/start' || message.text === '/help') {
      await tgSendMessage(token, chatId,
        '🎤 *Translator bot*\nSend a voice or audio message and I will transcribe it.',
        replyTo);
      return;
    }

    if (message.voice || message.audio) {
      const fileId = message.voice?.file_id || message.audio?.file_id;
      const tgPath = await tgGetFile(token, fileId);
      const localDir = join(__dirname, '../../uploads/telegram');
      await fsp.mkdir(localDir, { recursive: true });
      const localPath = join(localDir, `${Date.now()}-${fileId}.ogg`);
      await tgDownload(token, tgPath, localPath);

      try {
        if (!process.env.OPENAI_API_KEY) {
          await tgSendMessage(token, chatId, '⚠️ Transcription unavailable (server has no OPENAI_API_KEY).', replyTo);
          return;
        }
        const result = await transcribeAudio(localPath, {
          task: 'transcribe',
          language: message.from?.language_code || 'el',
          response_format: 'verbose_json'
        });
        await createJob({
          type: 'telegram',
          sourceName: `telegram:${chatId}:${replyTo}`,
          language: result.language,
          task: 'transcribe',
          method: 'openai',
          duration: result.duration || null,
          text: result.text,
          segments: result.segments || [],
          meta: { chatId, messageId: replyTo, from: message.from }
        });
        const truncated = result.text.length > 3500
          ? result.text.slice(0, 3500) + '…'
          : result.text;
        await tgSendMessage(token, chatId, `📝 ${truncated}`, replyTo);
      } finally {
        await fsp.unlink(localPath).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[telegram] handler error', err);
    if (chatId) {
      await tgSendMessage(token, chatId, `❌ Failed to transcribe: ${err.message}`, replyTo).catch(() => {});
    }
  }
});

// ---------- WhatsApp (Twilio) ----------

function twiml(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

async function twilioFetchMedia(url) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) throw new Error('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set');
  const auth = Buffer.from(`${sid}:${tok}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Twilio media fetch ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

router.post('/whatsapp', async (req, res) => {
  res.set('Content-Type', 'text/xml');

  const body = req.body || {};
  const numMedia = parseInt(body.NumMedia || '0', 10);
  const mediaUrl = body.MediaUrl0;
  const mediaType = body.MediaContentType0 || '';
  const from = body.From || 'unknown';

  if (!mediaUrl || numMedia === 0) {
    return res.send(twiml('🎤 Translator. Send a voice/audio message and I will transcribe it.'));
  }
  if (!mediaType.startsWith('audio/')) {
    return res.send(twiml('Please send an audio attachment.'));
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.send(twiml('⚠️ Server has no OPENAI_API_KEY configured.'));
  }
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return res.send(twiml('⚠️ Server missing Twilio credentials.'));
  }

  // Ack with TwiML immediately so Twilio doesn't retry; we then send a
  // follow-up message via the REST API once transcription is done. For now
  // we transcribe synchronously and reply inline because Twilio's webhook
  // timeout is 15s — fine for short voice notes.
  try {
    const buf = await twilioFetchMedia(mediaUrl);
    const localDir = join(__dirname, '../../uploads/whatsapp');
    await fsp.mkdir(localDir, { recursive: true });
    const ext = mediaType.split('/')[1] || 'ogg';
    const localPath = join(localDir, `${Date.now()}-${from.replace(/[^0-9a-zA-Z]/g, '')}.${ext}`);
    await fsp.writeFile(localPath, buf);
    try {
      const result = await transcribeAudio(localPath, {
        task: 'transcribe',
        response_format: 'verbose_json'
      });
      await createJob({
        type: 'whatsapp',
        sourceName: `whatsapp:${from}`,
        language: result.language,
        task: 'transcribe',
        method: 'openai',
        duration: result.duration || null,
        text: result.text,
        segments: result.segments || [],
        meta: { from, mediaType, mediaUrl }
      });
      const truncated = result.text.length > 1500
        ? result.text.slice(0, 1500) + '…'
        : result.text;
      return res.send(twiml(`📝 ${truncated}`));
    } finally {
      await fsp.unlink(localPath).catch(() => {});
    }
  } catch (err) {
    console.error('[whatsapp] error', err);
    return res.send(twiml(`❌ Failed: ${err.message}`));
  }
});

// ---------- Messenger ----------

router.get('/messenger', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.MESSENGER_VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

async function fbSendMessage(pageToken, recipientId, text) {
  const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(pageToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text: text.slice(0, 2000) }
    })
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error('[messenger] send failed', res.status, txt);
  }
}

/**
 * POST /api/messaging/messenger
 * Env:
 *   MESSENGER_PAGE_TOKEN     — long-lived page access token
 *   MESSENGER_VERIFY_TOKEN   — webhook verify secret (used by the GET handler above)
 *
 * Telegram-style flow: ack 200 immediately, download any audio attachments,
 * transcribe, reply with the text.
 */
router.post('/messenger', async (req, res) => {
  res.sendStatus(200);

  const pageToken = process.env.MESSENGER_PAGE_TOKEN;
  if (!pageToken) {
    console.warn('[messenger] webhook hit but MESSENGER_PAGE_TOKEN not set');
    return;
  }

  const entries = req.body?.entry || [];
  for (const entry of entries) {
    for (const event of entry.messaging || []) {
      const senderId = event.sender?.id;
      const attachments = event.message?.attachments || [];
      const audio = attachments.find(
        (a) => a.type === 'audio' || (a.type === 'file' && /audio\//.test(a.payload?.url || ''))
      );

      try {
        if (event.message?.text === '/start' || event.message?.text === '/help') {
          await fbSendMessage(pageToken, senderId,
            '🎤 Translator — send a voice or audio message and I will transcribe it.');
          continue;
        }
        if (!audio || !audio.payload?.url) continue;
        if (!process.env.OPENAI_API_KEY) {
          await fbSendMessage(pageToken, senderId, '⚠️ Transcription unavailable (no OPENAI_API_KEY).');
          continue;
        }

        const audioRes = await fetch(audio.payload.url);
        if (!audioRes.ok) throw new Error(`Audio download ${audioRes.status}`);
        const buf = Buffer.from(await audioRes.arrayBuffer());
        const localDir = join(__dirname, '../../uploads/messenger');
        await fsp.mkdir(localDir, { recursive: true });
        const localPath = join(localDir, `${Date.now()}-${senderId}.mp4`);
        await fsp.writeFile(localPath, buf);

        try {
          const result = await transcribeAudio(localPath, {
            task: 'transcribe',
            response_format: 'verbose_json'
          });
          await createJob({
            type: 'messenger',
            sourceName: `messenger:${senderId}`,
            language: result.language,
            task: 'transcribe',
            method: 'openai',
            duration: result.duration || null,
            text: result.text,
            segments: result.segments || [],
            meta: { senderId, attachmentUrl: audio.payload.url }
          });
          const truncated = result.text.length > 1800
            ? result.text.slice(0, 1800) + '…'
            : result.text;
          await fbSendMessage(pageToken, senderId, `📝 ${truncated}`);
        } finally {
          await fsp.unlink(localPath).catch(() => {});
        }
      } catch (err) {
        console.error('[messenger] handler error', err);
        if (senderId) {
          await fbSendMessage(pageToken, senderId, `❌ Failed: ${err.message}`).catch(() => {});
        }
      }
    }
  }
});

export default router;
