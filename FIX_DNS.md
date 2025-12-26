# Fix DNS for mrtranscribe.6x7.gr

## Current Problem

The domain `mrtranscribe.6x7.gr` is currently pointing to **GitHub Pages** instead of **Vercel**.

DNS lookup shows:
```
mrtranscribe.6x7.gr → philipposk.github.io (WRONG!)
```

## Solution: Update DNS Records

### Step 1: Get Vercel DNS Configuration

1. Go to Vercel Dashboard: https://vercel.com/filippos-projects-06f05211/audio2text/settings/domains
2. Find `mrtranscribe.6x7.gr` in the domains list
3. Click on it or check the DNS configuration
4. Vercel will show you the DNS records needed

### Step 2: Update DNS at Your Domain Registrar

You need to update the DNS record for the **subdomain** `audio2text`.

**Current (WRONG):**
- Type: `CNAME`
- Name: `audio2text`
- Value: `philipposk.github.io` ❌

**New (CORRECT):**
- Type: `CNAME`
- Name: `audio2text`
- Value: `cname.vercel-dns.com` (or whatever Vercel shows you) ✅

### Step 3: Where to Update DNS

1. **Find your domain registrar** (where you manage 6x7.gr DNS)
2. **Go to DNS Management**
3. **Find the CNAME record for `audio2text`**
4. **Change the value** from `philipposk.github.io` to Vercel's CNAME value
5. **Save**

### Step 4: Wait for DNS Propagation

- Usually takes: 5-60 minutes
- Can take up to: 24 hours (rare)
- Check status: Visit https://mrtranscribe.6x7.gr

## Quick Check

After updating DNS, verify with:
```bash
dig mrtranscribe.6x7.gr +short
```

Should show Vercel's servers, not GitHub Pages IPs.

## Alternative: Check Vercel Domain Settings

In Vercel → Settings → Domains → `mrtranscribe.6x7.gr`:
- Check if it shows "Valid Configuration" or any errors
- Vercel will tell you exactly what DNS records are needed
- Copy those exact values to your domain registrar

