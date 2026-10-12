/* =====================================================================
   POST /api/lead — forwards website leads to the GoHighLevel inbound
   webhook in env GHL_WEBHOOK_URL.

   Status codes the page relies on:
     200  forwarded to GHL (or honeypot hit, silently dropped)
     400  bad payload (missing name/phone, unknown form)
     403  cross-site POST
     503  GHL_WEBHOOK_URL not set      → page falls back to prefilled email
     502  GHL rejected / timed out     → page falls back to prefilled email
   Only allow-listed fields are forwarded. Never add SSN / DOB / income.
   ===================================================================== */

const FORMS = new Set(['finance_start', 'trade_in']);

const FIELDS = [
  'form_id', 'site_language', 'page_url', 'submitted_at', 'dealer',
  'first_name', 'last_name', 'full_name', 'phone', 'email',
  'preferred_language', 'down_payment', 'vehicle_interest',
  'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_mileage',
  'sms_consent_marketing', 'sms_consent_transactional'
];

const MAX_BODY = 16 * 1024;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;   // Vercel already parsed it
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error('too_large');
  }
  return raw ? JSON.parse(raw) : {};
}

const clean = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);

function toE164(phone) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  // Same-origin only: browsers always send Origin on fetch POST.
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!origin || !host) return send(res, 403, { ok: false, error: 'forbidden' });
  try {
    if (new URL(origin).host !== host) return send(res, 403, { ok: false, error: 'forbidden' });
  } catch {
    return send(res, 403, { ok: false, error: 'forbidden' });
  }

  let input;
  try {
    input = await readBody(req);
  } catch {
    return send(res, 400, { ok: false, error: 'bad_json' });
  }
  if (!input || typeof input !== 'object') return send(res, 400, { ok: false, error: 'bad_json' });

  // Honeypot: real people never see this field.
  if (clean(input.website)) return send(res, 200, { ok: true });

  const lead = {};
  for (const k of FIELDS) {
    if (k.startsWith('sms_consent_')) lead[k] = input[k] === true;   // unchecked unless explicitly true
    else if (input[k] != null && input[k] !== '') lead[k] = clean(input[k]);
  }

  if (!FORMS.has(lead.form_id)) return send(res, 400, { ok: false, error: 'unknown_form' });
  const phone = toE164(lead.phone || '');
  if (!phone) return send(res, 400, { ok: false, error: 'bad_phone' });
  lead.phone = phone;
  if (!lead.full_name) lead.full_name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
  if (!lead.full_name) return send(res, 400, { ok: false, error: 'missing_name' });
  if (!lead.first_name) {
    const [first, ...rest] = lead.full_name.split(/\s+/);
    lead.first_name = first;
    if (rest.length && !lead.last_name) lead.last_name = rest.join(' ');
  }
  lead.site_language = lead.site_language === 'es' ? 'es' : 'en';

  // Consent evidence for A2P/TCPA records.
  lead.received_at = new Date().toISOString();
  lead.consent_ip = clean(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0]);
  lead.consent_user_agent = clean(req.headers['user-agent']);
  lead.source = 'website';
  lead.tags = ['website-lead', lead.form_id, 'lang-' + lead.site_language];

  const hook = process.env.GHL_WEBHOOK_URL;
  if (!hook) {
    console.error('[lead] GHL_WEBHOOK_URL is not set; lead not forwarded', lead.form_id);
    return send(res, 503, { ok: false, error: 'not_configured' });
  }

  try {
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) {
      console.error('[lead] GHL responded', r.status);
      return send(res, 502, { ok: false, error: 'upstream' });
    }
  } catch (err) {
    console.error('[lead] GHL request failed', err && err.name);
    return send(res, 502, { ok: false, error: 'upstream' });
  }

  return send(res, 200, { ok: true });
};
