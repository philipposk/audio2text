# Quick Fix: API Key Already Set

## If API Key is Already in Vercel

If you've already added `OPENAI_API_KEY` to Vercel but still getting 401 errors:

### Step 1: Redeploy

Environment variables only take effect after a new deployment:

1. **Go to Deployments tab** in Vercel
2. Click the **"..."** menu on the latest deployment
3. Click **"Redeploy"**
4. Wait for deployment to complete (1-2 minutes)

### Step 2: Verify the Key

Make sure the key:
- ✅ Starts with `sk-proj-` or `sk-`
- ✅ Has no spaces or line breaks
- ✅ Is the full key (very long string)
- ✅ Is set for "All Environments"

### Step 3: Check Deployment Logs

1. Go to **Deployments** → Latest deployment
2. Click on the deployment
3. Go to **Functions** tab
4. Check `/api/transcribe` function logs
5. Look for any errors related to the API key

### Step 4: Test Again

After redeploy:
1. Visit https://mrtranscribe.6x7.gr
2. Try uploading a small audio file
3. Check browser console for errors

## Common Issues

### Still Getting 401?

1. **Key might be invalid:**
   - Go to https://platform.openai.com/account/api-keys
   - Check if the key is still active
   - Create a new key if needed

2. **Key format issue:**
   - Make sure there are no extra spaces
   - Copy the entire key from OpenAI dashboard
   - Paste it directly into Vercel (don't edit it)

3. **Environment variable not applied:**
   - Make sure you clicked "Save" in Vercel
   - Redeploy the project
   - Wait for deployment to complete

### Check Vercel Function Logs

The most reliable way to debug:
1. Go to Vercel → Your Project → Deployments
2. Click latest deployment
3. Go to **Functions** tab
4. Click on `/api/transcribe`
5. Check the logs - they'll show the exact error

