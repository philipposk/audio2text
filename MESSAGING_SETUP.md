# Messaging Platform Integration Guide

## Overview

Mr.Transcribe can be accessed via Telegram, WhatsApp, and Messenger as a bot named "Mr.Transcribe". Users can send audio messages and receive transcriptions directly in their messaging app.

## Telegram Bot Setup

### 1. Create Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Follow instructions to name your bot (e.g., "Mr.Transcribe")
4. Save the bot token you receive

### 2. Configure Webhook

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://audio2text.6x7.gr/api/messaging/telegram"
```

### 3. Update Environment Variables

Add to your `.env` file:
```
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### 4. Implement Handler

The webhook endpoint at `/api/messaging/telegram` will receive:
- Voice messages
- Audio files
- Text commands

Example response:
```javascript
// Send transcription back to user
await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: message.chat.id,
    text: transcription
  })
});
```

## WhatsApp Business API Setup

### 1. Get WhatsApp Business Account

1. Sign up for [WhatsApp Business API](https://business.whatsapp.com/)
2. Complete verification process
3. Get your API credentials

### 2. Configure Webhook

In your WhatsApp Business dashboard:
- Webhook URL: `https://audio2text.6x7.gr/api/messaging/whatsapp`
- Verify token: Set in environment variable

### 3. Environment Variables

```
WHATSAPP_API_KEY=your_api_key
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token
```

## Facebook Messenger Setup

### 1. Create Facebook App

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Create a new app
3. Add "Messenger" product

### 2. Create Page

1. Create a Facebook Page (or use existing)
2. Link page to your app
3. Get Page Access Token

### 3. Configure Webhook

- Webhook URL: `https://audio2text.6x7.gr/api/messaging/messenger`
- Verify Token: Set in environment variable
- Subscribe to: `messages`, `messaging_postbacks`

### 4. Environment Variables

```
MESSENGER_VERIFY_TOKEN=your_verify_token
MESSENGER_PAGE_ACCESS_TOKEN=your_page_access_token
```

## Testing

### Test Telegram Bot

1. Find your bot on Telegram
2. Send a voice message
3. Bot should respond with transcription

### Test WhatsApp

1. Send audio message to your WhatsApp Business number
2. Bot should respond with transcription

### Test Messenger

1. Message your Facebook Page
2. Send audio attachment
3. Bot should respond with transcription

## Security

- Always validate webhook requests
- Use HTTPS for all webhook URLs
- Store API keys securely in environment variables
- Implement rate limiting
- Validate user permissions

## Next Steps

1. Implement full message handlers in `server/routes/messaging.js`
2. Add audio file download logic for each platform
3. Implement user session management
4. Add error handling and retries
5. Set up monitoring and logging

