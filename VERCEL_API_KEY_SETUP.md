# Set OpenAI API Key in Vercel

## Problem

You're seeing this error:
```
401 Incorrect API key provided
```

This means the `OPENAI_API_KEY` environment variable is not set or is incorrect in Vercel.

## Solution: Add API Key to Vercel

### Step 1: Get Your OpenAI API Key

1. Go to: https://platform.openai.com/account/api-keys
2. Click **"Create new secret key"**
3. Copy the key (you'll only see it once!)
4. Save it somewhere safe

### Step 2: Add to Vercel Environment Variables

1. **Go to Vercel Dashboard:**
   - Visit: https://vercel.com/dashboard
   - Click on your **audio2text** (or **mr-transcribe**) project

2. **Go to Settings:**
   - Click the **Settings** tab (top menu)

3. **Open Environment Variables:**
   - Click **Environment Variables** in the left sidebar

4. **Add the API Key:**
   - Click **"Add New"**
   - **Key**: `OPENAI_API_KEY`
   - **Value**: Paste your OpenAI API key (starts with `sk-proj-...` or `sk-...`)
   - **Environment**: Select all (Production, Preview, Development)
   - Click **"Save"**

### Step 3: Redeploy

After adding the environment variable:

1. **Option A - Automatic Redeploy:**
   - Vercel will automatically redeploy when you add environment variables
   - Wait 1-2 minutes for the deployment to complete

2. **Option B - Manual Redeploy:**
   - Go to **Deployments** tab
   - Click the **"..."** menu on the latest deployment
   - Click **"Redeploy"**

### Step 4: Verify It's Working

1. Visit: https://mrtranscribe.6x7.gr
2. Try uploading a small audio file (under 4MB)
3. The transcription should work now!

## Important Notes

- **Never commit your API key to Git** - it should only be in Vercel's environment variables
- **The key starts with `sk-proj-` or `sk-`** - make sure you copy the entire key
- **Environment variables are case-sensitive** - use exactly `OPENAI_API_KEY`
- **You need to redeploy** after adding environment variables for them to take effect

## Troubleshooting

### Still getting 401 error?

1. **Double-check the key:**
   - Make sure you copied the entire key (no spaces, no line breaks)
   - Verify it starts with `sk-proj-` or `sk-`

2. **Check Vercel settings:**
   - Go to Settings → Environment Variables
   - Make sure `OPENAI_API_KEY` is listed
   - Make sure it's enabled for **Production** environment

3. **Redeploy:**
   - Sometimes you need to manually trigger a redeploy
   - Go to Deployments → Latest → Redeploy

4. **Check Vercel logs:**
   - Go to your deployment → Functions tab
   - Check the logs for any errors
   - Look for the `/api/transcribe` function logs

### API key format

Your OpenAI API key should look like:
- `sk-proj-...` (newer format)
- `sk-...` (older format)

If it doesn't start with `sk-`, it's not a valid API key.

## Security Best Practices

- ✅ Store API keys in Vercel environment variables (never in code)
- ✅ Use different keys for development and production if needed
- ✅ Rotate keys periodically
- ✅ Never share your API keys publicly
- ✅ Monitor API usage in OpenAI dashboard

