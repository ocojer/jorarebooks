// build.js — jorarebooks.com
// Run with: node build.js
// Output:   index.html (ready to upload to Netlify)
//
// Place this file in the same folder as template.html, HERO.jpg, and GODFATHER.jpeg

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const RSS_URL  = 'https://feeds.transistor.fm/rare-book-chat';
const TEMPLATE = path.join(__dirname, 'template.html');
const OUTPUT   = path.join(__dirname, 'index.html');

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

  output = output.replace('<!-- LATEST EPISODE -->', latestHtml);

  fs.writeFileSync(OUTPUT, output, 'utf8');

  console.log('\nDone. Deploy the following files to Netlify:');
  console.log('  index.html');
  console.log('  HERO.jpg');
  console.log('  GODFATHER.jpeg');
  console.log(`\nBuilt at: ${new Date().toLocaleString()}`);
}

build();
