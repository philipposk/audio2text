# Deployment Guide for Mr.Transcribe

## Deploy to audio2text.6x7.gr

### Option 1: Vercel (Recommended)

1. **Connect GitHub Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/philipposk/audio2text.git
   git push -u origin main
   ```

2. **Deploy on Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Add environment variables:
     - `OPENAI_API_KEY`: Your OpenAI API key
   - Deploy

3. **Configure Custom Domain**
   - In Vercel dashboard, go to Settings > Domains
   - Add `audio2text.6x7.gr`
   - Follow DNS configuration instructions

### Option 2: Netlify

1. **Build Configuration**
   - Build command: `npm run build`
   - Publish directory: `dist`

2. **Environment Variables**
   - Add `OPENAI_API_KEY` in Netlify dashboard

### Option 3: Traditional Server (Node.js)

1. **Install Dependencies**
   ```bash
   npm install --production
   ```

2. **Build Frontend**
   ```bash
   npm run build
   ```

3. **Start Server**
   ```bash
   npm start
   ```

4. **Use PM2 for Process Management**
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name mr-transcribe
   pm2 save
   pm2 startup
   ```

## Environment Variables

Required:
- `OPENAI_API_KEY`: Your OpenAI API key

Optional (for messaging platforms):
- `TELEGRAM_BOT_TOKEN`: Telegram bot token
- `WHATSAPP_API_KEY`: WhatsApp Business API key
- `MESSENGER_VERIFY_TOKEN`: Facebook Messenger verify token
- `MESSENGER_PAGE_ACCESS_TOKEN`: Facebook Messenger page access token

## Setting Up Messaging Platforms

### Telegram Bot Setup

1. Create a bot with [@BotFather](https://t.me/botfather)
2. Get your bot token
3. Set webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://audio2text.6x7.gr/api/messaging/telegram`

### WhatsApp Setup

1. Set up WhatsApp Business API
2. Configure webhook in your WhatsApp Business account
3. Point webhook to: `https://audio2text.6x7.gr/api/messaging/whatsapp`

### Messenger Setup

1. Create Facebook App and Page
2. Set up Messenger product
3. Configure webhook: `https://audio2text.6x7.gr/api/messaging/messenger`

## GitHub Repository Setup

1. Initialize repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Mr.Transcribe web app"
   ```

2. Push to GitHub:
   ```bash
   git remote add origin https://github.com/philipposk/audio2text.git
   git branch -M main
   git push -u origin main
   ```

3. Ensure MIT license is in the repository (already included)

