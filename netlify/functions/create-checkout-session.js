// netlify/functions/create-checkout-session.js
//
// Called by cart.js's startCheckout(). Receives Airtable record IDs from
// the client cart, re-verifies every item fresh against Airtable (never
// trusts client-supplied price or availability), builds a Stripe
// Checkout Session, and — if session creation succeeds — sets each item
// to "On Hold" so nobody else can buy it while this checkout is open.
//
// The hold is released automatically by stripe-webhook.js if the
// session expires unpaid. If payment succeeds, the item stays On Hold
// indefinitely — marking it Sold in Airtable is a deliberate manual
// step, not automated (see project notes).

const https = require('https');
const Stripe = require('stripe');

// Instantiated lazily, not at module load — the Stripe SDK throws
// immediately if given an empty key, which would otherwise crash the
// whole function (before the handler's own "not configured yet" check
// ever runs) if STRIPE_SECRET_KEY were ever unset.
let _stripe = null;
function getStripe() {
  if (!_stripe) _stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

const AIRTABLE_BASE_ID = 'appcfXqSzvoq0by4T';
const AIRTABLE_TABLE = 'ITEMS';
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || '';

const SITE_URL = 'https://www.jorarebooks.com';
const FREE_SHIPPING_THRESHOLD_CENTS = 25000; // $250
const FLAT_SHIPPING_CENTS = 1000; // $10
const SESSION_LIFETIME_SECONDS = 30 * 60; // Stripe's minimum allowed
const MAX_ITEMS_PER_CHECKOUT = 20;

function field(record, name) {
  return (record.fields || {})[name] || '';
}

// ── Fetch one record fresh from Airtable by record ID ───────
function fetchAirtableRecord(id) {
  return new Promise((resolve) => {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${encodeURIComponent(id)}`;
    https.get(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// ── Update one record's AVAILABILITY field ───────────────────
function patchAirtableAvailability(id, availability) {
  return new Promise((resolve) => {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${encodeURIComponent(id)}`;
    const payload = JSON.stringify({ fields: { 'AVAILABILITY': availability } });
    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', (e) => {
      console.error(`Airtable patch failed for ${id}:`, e.message);
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

// ── Price in cents, preferring the numeric MARKET PRICE field,
//    falling back to parsing digits out of PRICE/INQUIRE ───────
function priceToCents(record) {
  const listPrice = field(record, 'MARKET PRICE');
  if (listPrice) {
    const n = Number(listPrice);
    if (!isNaN(n) && n > 0) return Math.round(n * 100);
  }
  const priceStr = field(record, 'PRICE/INQUIRE');
  const n = parseFloat((priceStr || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

// ── Given already-validated Airtable records, build the exact
//    params object for stripe.checkout.sessions.create. Kept as a
//    pure function, separate from any network calls, so it can be
//    tested directly against fake records. ──────────────────────
function buildCheckoutSessionParams(records) {
  const lineItems = records.map(record => ({
    price_data: {
      currency: 'usd',
      product_data: { name: field(record, 'TITLE') },
      unit_amount: priceToCents(record),
      tax_behavior: 'exclusive'
    },
    quantity: 1
  }));

  const subtotalCents = lineItems.reduce((sum, li) => sum + li.price_data.unit_amount, 0);
  const freeShipping = subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS;
  const recordIds = records.map(r => r.id);

  return {
    mode: 'payment',
    line_items: lineItems,
    // NJ is the only Stripe Tax location registered for this account —
    // automatic_tax only ever charges tax when the shipping address is
    // NJ, and charges nothing everywhere else. See project notes.
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    shipping_address_collection: { allowed_countries: ['US'] },
    shipping_options: [{
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: freeShipping ? 0 : FLAT_SHIPPING_CENTS, currency: 'usd' },
        display_name: freeShipping ? 'Free shipping' : 'Standard shipping',
        tax_behavior: 'exclusive',
        tax_code: 'txcd_92010001' // Stripe's "Shipping" tax code
      }
    }],
    metadata: { record_ids: JSON.stringify(recordIds) },
    success_url: `${SITE_URL}/checkout/success/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/shop/`,
    expires_at: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS
  };
}

// ── Validate one fetched record against what the client claimed.
//    Returns { ok: true } or { ok: false, reason }. ──────────────
function validateRecord(record) {
  if (!record || !record.fields) return { ok: false, reason: 'not_found' };
  const availability = field(record, 'AVAILABILITY');
  if (availability !== 'Available') return { ok: false, reason: 'unavailable' };
  const inquireOnly = record.fields['INQUIRE ONLY?'];
  const price = field(record, 'PRICE/INQUIRE');
  const listPrice = field(record, 'MARKET PRICE');
  const hasPrice = !inquireOnly && (price || listPrice);
  if (!hasPrice) return { ok: false, reason: 'inquire_only' };
  return { ok: true };
}

const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Checkout is not configured yet.' }) };
  }

  let ids;
  try {
    const body = JSON.parse(event.body || '{}');
    ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter(id => typeof id === 'string' && id))] : [];
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  if (!ids.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Your cart is empty.' }) };
  }
  if (ids.length > MAX_ITEMS_PER_CHECKOUT) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Too many items for a single checkout.' }) };
  }

  const records = await Promise.all(ids.map(fetchAirtableRecord));

  const unavailable = [];
  const validRecords = [];
  records.forEach((record, i) => {
    const result = validateRecord(record);
    if (result.ok) {
      validRecords.push(record);
    } else {
      unavailable.push({ id: ids[i], title: record ? field(record, 'TITLE') : null, reason: result.reason });
    }
  });

  if (unavailable.length) {
    return {
      statusCode: 409,
      body: JSON.stringify({
        error: 'Some items in your cart are no longer available.',
        unavailable
      })
    };
  }

  const params = buildCheckoutSessionParams(validRecords);

  let session;
  try {
    session = await getStripe().checkout.sessions.create(params);
  } catch (e) {
    console.error('Stripe session creation failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start checkout. Please try again.' }) };
  }

  // Soft-lock every item now that a real session exists. Best-effort —
  // if an individual Airtable patch fails, we still send the customer
  // to Stripe rather than blocking the sale; the webhook's expiry
  // handler will simply have less to release for that one item.
  await Promise.all(validRecords.map(record => patchAirtableAvailability(record.id, 'On Hold')));

  return {
    statusCode: 200,
    body: JSON.stringify({ url: session.url })
  };
};

module.exports = { handler, buildCheckoutSessionParams, priceToCents, validateRecord };
