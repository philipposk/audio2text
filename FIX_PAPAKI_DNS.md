# Fix DNS at Papaki - Point audio2text.6x7.gr to Vercel

## Current Problem

Your DNS is still pointing to GitHub Pages:
```bash
$ dig audio2text.6x7.gr CNAME +short
philipposk.github.io.  ❌ WRONG!
```

It should point to Vercel instead.

## Solution: Update CNAME Record at Papaki

### Step 1: Get the Correct CNAME from Vercel

1. **Go to Vercel Dashboard:**
   - https://vercel.com/dashboard
   - Click on your **audio2text** project
   - Go to **Settings** → **Domains**
   - Find `audio2text.6x7.gr` in the list
   - Click on it to see the DNS configuration

2. **Copy the CNAME value:**
   - Vercel will show you something like:
     - `fe052388f074b507.vercel-dns-017.com`
     - OR `cname.vercel-dns.com`
   - **Copy this exact value** - you'll need it!

### Step 2: Update DNS at Papaki

1. **Log into Papaki:**
   - Go to: https://www.papaki.com/cp2/manageDomain.aspx?domain=6x7.gr
   - Or navigate: Papaki Dashboard → Your Domains → 6x7.gr → DNS Management

2. **Find the CNAME record for `audio2text`:**
   - Look for a CNAME record with:
     - **Name/Host**: `audio2text` (or `audio2text.6x7.gr`)
     - **Current Value**: `philipposk.github.io` (or similar)

3. **Edit the CNAME record:**
   - Click **Edit** on the `audio2text` CNAME record
   - **Change the Value/Target** from `philipposk.github.io` to the Vercel CNAME you copied
   - Example: `fe052388f074b507.vercel-dns-017.com`
   - **Keep the Name/Host as**: `audio2text` (just the subdomain, not the full domain)
   - Click **Save**

### Step 3: Verify the Change

After saving, wait 5-10 minutes, then check:

```bash
dig audio2text.6x7.gr CNAME +short
```

**Should return:**
```
fe052388f074b507.vercel-dns-017.com
```
(or whatever Vercel showed you)

**NOT:**
```
philipposk.github.io
```

### Step 4: Wait for Propagation

- **Usually takes:** 5-60 minutes
- **Can take up to:** 24 hours (rare)
- **Check in Vercel:**
  - Go to Settings → Domains → `audio2text.6x7.gr`
  - Click **Refresh**
  - Status should change to **"Valid Configuration"** ✅

### Step 5: Test the Site

Once DNS propagates:
- Visit: https://audio2text.6x7.gr
- Should show your Vercel deployment (same as audio2text-seven.vercel.app)
- HTTPS should work automatically

## Important Notes

1. **The CNAME Name field should be:**
   - ✅ `audio2text` (just the subdomain)
   - ❌ NOT `audio2text.6x7.gr` (full domain)
   - ❌ NOT `@` (that's for root domain)

2. **If you can't find the record:**
   - You may need to **create a new CNAME record** instead of editing
   - Type: `CNAME`
   - Name: `audio2text`
   - Value: (from Vercel)
   - TTL: 3600 (or default)

3. **If there are multiple CNAME records:**
   - Delete the one pointing to `philipposk.github.io`
   - Keep only the one pointing to Vercel

## Quick Checklist

- [ ] Got CNAME value from Vercel Settings → Domains
- [ ] Logged into Papaki DNS management
- [ ] Found/edited the `audio2text` CNAME record
- [ ] Changed value from `philipposk.github.io` to Vercel CNAME
- [ ] Saved the changes
- [ ] Waited 5-60 minutes
- [ ] Verified with `dig audio2text.6x7.gr CNAME +short`
- [ ] Checked Vercel shows "Valid Configuration"
- [ ] Tested https://audio2text.6x7.gr in browser

## Still Not Working?

1. **Double-check the CNAME value:**
   - Make sure you copied it exactly from Vercel
   - No typos, no extra spaces

2. **Check Vercel domain status:**
   - Go to Vercel → Settings → Domains
   - See if there are any error messages
   - Vercel will tell you exactly what it expects

3. **Clear browser cache:**
   - Try incognito/private mode
   - Or wait longer for DNS propagation

4. **Contact Papaki support:**
   - If DNS changes aren't taking effect after 24 hours

