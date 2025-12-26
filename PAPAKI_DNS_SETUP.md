# DNS Configuration for audio2text.6x7.gr on Papaki

## Current Setup

You have a CNAME record on Papaki:
- **Type**: CNAME
- **Name**: `audio2text` (or `audio2text.6x7.gr`)
- **Value**: `fe052388f074b507.vercel-dns-017.com`

## Verification Steps

### 1. Check Vercel Domain Settings

In Vercel → Settings → Domains → `audio2text.6x7.gr`:
- Look for the DNS configuration section
- Vercel should show you the exact CNAME value it expects
- Compare it with: `fe052388f074b507.vercel-dns-017.com`

### 2. Verify DNS Record on Papaki

On Papaki (https://www.papaki.com/cp2/manageDomain.aspx?domain=6x7.gr):

**The CNAME record should be:**
- **Type**: CNAME
- **Name/Host**: `audio2text` (NOT `audio2text.6x7.gr` - just the subdomain part)
- **Value/Target**: `fe052388f074b507.vercel-dns-017.com`
- **TTL**: 3600 (or default)

### 3. Common Issues

**If the domain still doesn't work:**

1. **Check the Name field:**
   - Should be: `audio2text` (without `.6x7.gr`)
   - NOT: `audio2text.6x7.gr`
   - NOT: `@`

2. **Check TTL:**
   - Lower TTL (300-600) = faster updates
   - Higher TTL (3600) = slower but more stable

3. **Wait for propagation:**
   - DNS changes can take 5-60 minutes
   - Sometimes up to 24 hours

### 4. Verify DNS is Working

Run this command to check:
```bash
dig audio2text.6x7.gr CNAME +short
```

Should return: `fe052388f074b507.vercel-dns-017.com`

Then check the final resolution:
```bash
dig audio2text.6x7.gr +short
```

Should show Vercel's IP addresses (not GitHub Pages).

## If Still Not Working

1. **Double-check Vercel settings:**
   - Go to Vercel → Settings → Domains
   - Click on `audio2text.6x7.gr`
   - Check if it shows "Valid Configuration" or any errors
   - Vercel will tell you exactly what DNS record it expects

2. **Verify on Papaki:**
   - Make sure the CNAME record is exactly as Vercel shows
   - No typos in the value
   - Name field is just `audio2text` (not the full domain)

3. **Clear DNS cache:**
   - Your browser might be caching the old DNS
   - Try: Incognito/Private browsing mode
   - Or wait a bit longer for DNS propagation

## Expected Result

Once DNS is properly configured:
- `audio2text.6x7.gr` should resolve to Vercel
- Should show the same content as `audio2text-seven.vercel.app`
- HTTPS should work automatically

