# CCS Ventas Cars — front-door site

Static site + one Vercel serverless function. No framework, no build step.

| Path | What it is |
|---|---|
| `index.html` | The whole site. Dealer values live in `CONFIG` (bottom script) and `:root` tokens. `/es` serves the same file in Spanish. |
| `api/lead.js` | `POST /api/lead` → forwards form leads to GoHighLevel (`GHL_WEBHOOK_URL`). 503 if unset, so the page falls back to a prefilled email. |
| `privacy-policy.html`, `terms-of-service.html` | Static legal pages (A2P/10DLC). |
| `vercel.json` | `/es` rewrite, clean legal URLs, security + cache headers. |
| `scripts/set-domain.mjs` | Run once the production domain is chosen: `node scripts/set-domain.mjs example.com` (canonical, hreflang, og:image, JSON-LD, sitemap, robots). |
| `hero.jpg`, `logo.jpg`, `og.jpg`, `favicon.ico`, `apple-touch-icon.png` | Assets. `hero.jpg` = dealer's own homepage slider with the white swoosh repainted dark. |

## Deploy (Vercel)
1. Import the repo → Framework preset **Other**, Build command **empty**, Output directory **`.`**.
2. Settings → Environment Variables: `GHL_WEBHOOK_URL` = GHL inbound-webhook URL (Production + Preview). Redeploy.
3. Submit both forms on the preview URL and confirm the lead lands in GHL.

## Before go-live
- Don't point `ccsventascars.com` at Vercel while DealerCenter hosts it — every inventory/credit-app link points there.
- GTM: set `CONFIG.gtmId` and add the GTM `<noscript>` iframe as the first child of `<body>`.
- If `CONFIG.heroImage` changes, update the hero `<link rel="preload">` in `<head>` too.
