// build.js — jorarebooks.com
// Run with: node build.js
// Output:   index.html (ready to upload to Netlify)
//
// Place this file in the same folder as template.html, HERO.jpg, and GODFATHER.jpeg

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const RSS_URL       = 'https://feeds.transistor.fm/rare-book-chat';
const TEMPLATE      = path.join(__dirname, 'template.html');
const OUTPUT        = path.join(__dirname, 'index.html');
const HOLDINGS_DIR  = path.join(__dirname, 'content', 'holdings');

// ── Fetch URL, following redirects ─────────────────────────
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Strip HTML and CDATA wrappers ───────────────────────────
function clean(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ── Extract a tag value from XML ────────────────────────────
function getTag(xml, tag) {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m) return m[1].trim();
  }
  return '';
}

// ── Build the holdings grid HTML from content/holdings/*.json ──
function renderHoldings() {
  if (!fs.existsSync(HOLDINGS_DIR)) {
    console.error(`Holdings folder not found at ${HOLDINGS_DIR}`);
    return '';
  }

  const files = fs.readdirSync(HOLDINGS_DIR).filter(f => f.endsWith('.json'));

  const holdings = files.map(file => {
    const raw = fs.readFileSync(path.join(HOLDINGS_DIR, file), 'utf8');
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error(`Skipping ${file} — invalid JSON: ${e.message}`);
      return null;
    }
  }).filter(Boolean);

  holdings.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  return holdings.map(h => {
    const url = h.url && h.url.trim() ? h.url : '#';
    const price = h.price && h.price.trim() ? h.price : 'Inquire for price';
    return `      <a class="holding-card" href="${url}">
        <div class="card-img-wrap">
          <img src="${h.image}" alt="${h.alt || ''}" onerror="this.style.display='none'; this.parentElement.style.background='#ece7de';">
        </div>
        <div class="card-body">
          <div class="card-title">${h.title}</div>
          <p class="card-desc">${h.description}</p>
          <div class="card-price">${price}</div>
        </div>
      </a>`;
  }).join('\n\n');
}

// ── Build the latest episode HTML block ─────────────────────
function renderLatestEpisode(item) {
  const title   = clean(getTag(item, 'title')) || 'Latest Episode';
  const desc    = clean(getTag(item, 'description'));
  const audio   = (item.match(/<enclosure[^>]+url="([^"]+)"/i) || [])[1] || '';
  const pubDate = getTag(item, 'pubDate');
  const date    = pubDate
    ? new Date(pubDate).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      })
    : '';

  return `<div class="latest-episode">
      <span class="latest-label">Latest Episode</span>
      <p class="latest-title">${title}</p>
      ${date ? `<span class="latest-date">${date}</span>` : ''}
      ${desc ? `<p class="latest-desc">${desc}</p>
      <button class="latest-more" onclick="toggleDesc(this)">Read more</button>` : ''}
      ${audio ? `<audio class="latest-audio" controls preload="none" src="${audio}"></audio>` : ''}
    </div>`;
}

// ── Main ────────────────────────────────────────────────────
async function build() {
  console.log('Rendering holdings...');
  const holdingsHtml = renderHoldings();

  console.log('Fetching RSS feed...');

  let rss;
  try {
    rss = await fetch(RSS_URL);
  } catch (e) {
    console.error('Failed to fetch RSS:', e.message);
    process.exit(1);
  }

  const items = rss.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  if (!items.length) {
    console.error('No episodes found in feed.');
    process.exit(1);
  }

  console.log(`Found ${items.length} episodes. Using most recent.`);

  const latestHtml = renderLatestEpisode(items[0]);

  let output = fs.readFileSync(TEMPLATE, 'utf8');

  if (!output.includes('<!-- LATEST EPISODE -->')) {
    console.error('Template is missing the <!-- LATEST EPISODE --> placeholder.');
    process.exit(1);
  }
  if (!output.includes('<!-- HOLDINGS -->')) {
    console.error('Template is missing the <!-- HOLDINGS --> placeholder.');
    process.exit(1);
  }

  output = output.replace('<!-- LATEST EPISODE -->', latestHtml);
  output = output.replace('<!-- HOLDINGS -->', holdingsHtml);

  fs.writeFileSync(OUTPUT, output, 'utf8');

  console.log('\nDone. Deploy the following files to Netlify:');
  console.log('  index.html');
  console.log('  HERO.jpg');
  console.log('  GODFATHER.jpeg');
  console.log(`\nBuilt at: ${new Date().toLocaleString()}`);
}

build();
