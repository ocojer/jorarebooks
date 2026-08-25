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
const HOMEPAGE_FILE     = path.join(__dirname, 'content', 'homepage.json');
const COMING_SOON_FILE  = path.join(__dirname, 'content', 'coming-soon.json');
const SECTIONS_DIR      = path.join(__dirname, 'content', 'sections');

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

// ── Load content/homepage.json (hero image + intro text) ────
function loadHomepage() {
  if (!fs.existsSync(HOMEPAGE_FILE)) {
    console.error(`Homepage content file not found at ${HOMEPAGE_FILE}`);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(HOMEPAGE_FILE, 'utf8'));
  } catch (e) {
    console.error(`Invalid JSON in ${HOMEPAGE_FILE}: ${e.message}`);
    return {};
  }
}

function renderHero(data) {
  if (!data.hero_image) return '';
  return `<img src="${data.hero_image}" alt="${data.hero_alt || ''}">`;
}

function renderIntro(data) {
  const paragraphs = Array.isArray(data.intro_paragraphs) ? data.intro_paragraphs : [];
  const paraHtml = paragraphs
    .map(p => `    <p class="intro" style="margin-bottom:0.3rem;">${p}</p>`)
    .join('\n');
  const signoffHtml = data.signoff
    ? `    <p class="intro" style="text-align:right; padding-right:3rem; margin-top:0.5rem; margin-bottom:clamp(2rem, 5vw, 3rem);">${data.signoff}</p>`
    : '';
  return [paraHtml, signoffHtml].filter(Boolean).join('\n');
}

function renderComingSoon() {
  if (!fs.existsSync(COMING_SOON_FILE)) {
    console.error(`Coming-soon content file not found at ${COMING_SOON_FILE}`);
    return '';
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(COMING_SOON_FILE, 'utf8'));
  } catch (e) {
    console.error(`Invalid JSON in ${COMING_SOON_FILE}: ${e.message}`);
    return '';
  }
  const note = data.note ? `      <p>${data.note}</p>` : '';
  const comingSoonText = data.coming_soon_text ? `      <p>${data.coming_soon_text}</p>` : '';
  return [note, comingSoonText].filter(Boolean).join('\n');
}

// ── Build stacked wide sections from content/sections/*.json ──
function renderSections() {
  if (!fs.existsSync(SECTIONS_DIR)) {
    console.error(`Sections folder not found at ${SECTIONS_DIR}`);
    return '';
  }

  const files = fs.readdirSync(SECTIONS_DIR).filter(f => f.endsWith('.json'));

  const sections = files.map(file => {
    const raw = fs.readFileSync(path.join(SECTIONS_DIR, file), 'utf8');
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error(`Skipping ${file} — invalid JSON: ${e.message}`);
      return null;
    }
  }).filter(Boolean);

  sections.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  return sections.map(s => {
    const caption = s.caption
      ? `<div class="wide-section-caption">${s.caption}</div>`
      : '';
    const description = s.description
      ? `<p class="wide-section-desc">${s.description}</p>`
      : '';
    return `      <figure class="wide-section">
        <img src="${s.image}" alt="${s.alt || ''}" class="wide-section-img">
        <figcaption>
          ${caption}
          ${description}
        </figcaption>
      </figure>`;
  }).join('\n\n');
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

    const actions = [];
    if (h.pdf_url && h.pdf_url.trim()) {
      actions.push(`<a class="card-action" href="${h.pdf_url}" target="_blank" rel="noopener noreferrer">View PDF</a>`);
    }
    if (h.video_url && h.video_url.trim()) {
      actions.push(`<a class="card-action" href="${h.video_url}" target="_blank" rel="noopener noreferrer">Video</a>`);
    }
    if (actions.length === 0) {
      const inquireText = h.price && h.price.trim() ? h.price : 'Inquire';
      const plainTitle = h.title.replace(/<[^>]+>/g, '');
      const subject = encodeURIComponent(`Inquiry: ${plainTitle}`);
      actions.push(`<a class="card-action" href="mailto:jeremy@jorarebooks.com?subject=${subject}">${inquireText}</a>`);
    }
    const actionsHtml = actions.join('<span class="card-action-sep">·</span>');

    return `      <div class="holding-card">
        <a class="card-img-link" href="${url}">
          <div class="card-img-wrap">
            <img src="${h.image}" alt="${h.alt || ''}" onerror="this.style.display='none'; this.parentElement.style.background='#ece7de';">
          </div>
        </a>
        <div class="card-body">
          <div class="card-title">${h.title}</div>
          <p class="card-desc">${h.description}</p>
          <div class="card-actions">${actionsHtml}</div>
        </div>
      </div>`;
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
  console.log('Rendering homepage content...');
  const homepageData = loadHomepage();
  const heroHtml = renderHero(homepageData);
  const introHtml = renderIntro(homepageData);

  console.log('Rendering holdings...');
  const holdingsHtml = renderHoldings();

  console.log('Rendering sections...');
  const sectionsHtml = renderSections();

  console.log('Rendering coming-soon text...');
  const comingSoonHtml = renderComingSoon();

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
  if (!output.includes('<!-- HERO_IMAGE -->')) {
    console.error('Template is missing the <!-- HERO_IMAGE --> placeholder.');
    process.exit(1);
  }
  if (!output.includes('<!-- INTRO -->')) {
    console.error('Template is missing the <!-- INTRO --> placeholder.');
    process.exit(1);
  }
  if (!output.includes('<!-- SECTIONS -->')) {
    console.error('Template is missing the <!-- SECTIONS --> placeholder.');
    process.exit(1);
  }
  if (!output.includes('<!-- COMING_SOON -->')) {
    console.error('Template is missing the <!-- COMING_SOON --> placeholder.');
    process.exit(1);
  }

  output = output.replace('<!-- LATEST EPISODE -->', latestHtml);
  output = output.replace('<!-- HOLDINGS -->', holdingsHtml);
  output = output.replace('<!-- HERO_IMAGE -->', heroHtml);
  output = output.replace('<!-- INTRO -->', introHtml);
  output = output.replace('<!-- SECTIONS -->', sectionsHtml);
  output = output.replace('<!-- COMING_SOON -->', comingSoonHtml);

  fs.writeFileSync(OUTPUT, output, 'utf8');

  console.log('\nDone. Deploy the following files to Netlify:');
  console.log('  index.html');
  console.log('  HERO.jpg');
  console.log('  GODFATHER.jpeg');
  console.log(`\nBuilt at: ${new Date().toLocaleString()}`);
}

build();
