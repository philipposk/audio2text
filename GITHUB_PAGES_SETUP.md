# GitHub Pages Setup for Mr.Transcribe

## ⚠️ Important Note

**GitHub Pages is STATIC ONLY** - it cannot run the Node.js backend API. 

For a **full-stack app** like Mr.Transcribe, you have two options:

### Option 1: Use Vercel/Netlify (Recommended) ✅

These platforms support full-stack apps with backend APIs:
- **Vercel**: Best for Next.js/React apps with API routes
- **Netlify**: Good for serverless functions
- Both support custom domains like `audio2text.6x7.gr`

**Why?** Your app needs:
- Backend API at `/api/transcribe`
- Backend API at `/api/chat`
- Backend API at `/api/export`
- File upload handling
- Environment variables for OpenAI API

GitHub Pages **cannot** do any of this.

### Option 2: GitHub Pages (Frontend Only) ⚠️

If you only want to show the frontend UI (without functionality):

1. **Build to `/docs` folder**:
   ```bash
   npm run build:pages
   ```

2. **Configure GitHub Pages**:
   - Go to Settings > Pages
   - Source: Deploy from a branch
   - Branch: `main`
   - Folder: `/docs`
   - Save

3. **Limitations**:
   - ❌ No transcription (needs backend API)
   - ❌ No chat (needs backend API)
   - ❌ No file upload (needs backend API)
   - ✅ Only static frontend will work

## Recommended: Deploy to Vercel

1. Go to https://vercel.com
2. Import `philipposk/audio2text`
3. Add environment variable: `OPENAI_API_KEY`
4. Deploy
5. Add custom domain: `audio2text.6x7.gr`

This gives you the **full working app** with all features!

## Current Setup

- Frontend builds to `/docs` folder
- Ready for GitHub Pages (static only)
- But backend won't work on GitHub Pages

**Recommendation**: Use Vercel for full functionality.

