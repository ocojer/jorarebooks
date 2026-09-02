// netlify/functions/stripe-webhook.js
//
// Registered in the Stripe Dashboard against this function's deployed
// URL. Handles two events:
//
//   checkout.session.completed — payment succeeded. Items are already
//   "On Hold" from create-checkout-session.js and deliberately stay
//   that way; marking Sold in Airtable is a manual step by design (see
//   project notes). This just logs the sale for traceability.
//
//   checkout.session.expired — customer abandoned checkout. Releases
//   each item back to "Available", but only if it's still "On Hold" —
//   never overwrites a status you may have changed manually since.

const https = require('https');
const Stripe = require('stripe');

// Lazy, same reasoning as create-checkout-session.js: the Stripe SDK
// throws immediately on an empty key, which would otherwise crash the
// whole module before the handler's own config check ever runs.
let _stripe = null;
function getStripe() {
  if (!_stripe) _stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

const AIRTABLE_BASE_ID = 'appcfXqSzvoq0by4T';
const AIRTABLE_TABLE = 'ITEMS';
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || '';

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

// ── Pull the list of Airtable record IDs back out of a session's
//    metadata. Defensive against malformed/missing metadata — returns
//    an empty array rather than throwing, since a webhook handler
//    should never 500 on data it can't fully trust. ─────────────────
function parseRecordIds(session) {
  try {
    const raw = session && session.metadata && session.metadata.record_ids;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string' && id) : [];
  } catch (e) {
    return [];
  }
}

// ── Release each record back to Available, but only the ones still
//    On Hold — never clobber a status changed since (e.g. already
//    manually marked Sold from a different sale). ───────────────────
async function releaseExpiredHolds(recordIds) {
  return Promise.all(recordIds.map(async (id) => {
    const record = await fetchAirtableRecord(id);
    if (record && record.fields && record.fields['AVAILABILITY'] === 'On Hold') {
      await patchAirtableAvailability(id, 'Available');
      return { id, released: true };
    }
    return { id, released: false };
  }));
}

const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not set.');
    return { statusCode: 500, body: 'Webhook not configured.' };
  }

  const sig = event.headers && (event.headers['stripe-signature'] || event.headers['Stripe-Signature']);
  let stripeEvent;
  try {
    stripeEvent = getStripe().webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const recordIds = parseRecordIds(session);
    console.log(`Checkout completed: session ${session.id}, items:`, recordIds);
  }

  if (stripeEvent.type === 'checkout.session.expired') {
    const session = stripeEvent.data.object;
    const recordIds = parseRecordIds(session);
    const results = await releaseExpiredHolds(recordIds);
    console.log(`Checkout expired: session ${session.id}, released:`, results);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

module.exports = { handler, parseRecordIds, releaseExpiredHolds };
