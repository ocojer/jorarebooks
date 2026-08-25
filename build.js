// build.js — jorarebooks.com
// Run with: node build.js
// Output:   index.html (ready to upload to Netlify)
//
// Place this file in the same folder as template.html, HERO.jpg, and GODFATHER.jpeg

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const RSS_URL           = 'https://feeds.transistor.fm/rare-book-chat';
const TEMPLATE          = path.join(__dirname, 'template.html');
const STORY_TEMPLATE    = path.join(__dirname, 'story-template.html');
const OUTPUT            = path.join(__dirname, 'index.html');
const HOLDINGS_DIR      = path.join(__dirname, 'content', 'holdings');
const HOMEPAGE_FILE     = path.join(__dirname, 'content', 'homepage.json');
const COMING_SOON_FILE  = path.join(__dirname, 'content', 'coming-soon.json');
const SECTIONS_DIR      = path.join(__dirname, 'content', 'sections');
const PARTIALS_DIR      = path.join(__dirname, 'partials');

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
// ── Load and sort all holdings from content/holdings/*.json ──
function loadHoldings() {
  if (!fs.existsSync(HOLDINGS_DIR)) {
    console.error(`Holdings folder not found at ${HOLDINGS_DIR}`);
    return [];
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
  return holdings;
}

// A holding with a slug gets its own story page at /slug/ — that takes
// priority over the manually-set url field, which is now just a fallback
// for holdings that don't have a story page yet.
function holdingUrl(h) {
  if (h.slug && h.slug.trim()) return `/${h.slug}/`;
  return h.url && h.url.trim() ? h.url : '#';
}

// Shared by both the homepage card and the story page's own action row,
// so "View PDF" / "Video" / "Inquire" behave identically in both places.
function cardActionsHtml(h) {
  const actions = [];
  if (h.pdf_url && h.pdf_url.trim()) {
    const pdfTitle = h.pdf_caption ? ` title="${h.pdf_caption}"` : '';
    actions.push(`<a class="card-action" href="${h.pdf_url}" target="_blank" rel="noopener noreferrer"${pdfTitle}>View PDF</a>`);
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
  return actions.join('<span class="card-action-sep">·</span>');
}

// ── Build the holdings grid HTML ─────────────────────────────
function renderHoldings(holdings) {
  return holdings.map(h => {
    const url = holdingUrl(h);
    const actionsHtml = cardActionsHtml(h);

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
// ── Load a shared partial (masthead, footer) ─────────────────
function loadPartial(name) {
  const file = path.join(PARTIALS_DIR, name);
  if (!fs.existsSync(file)) {
    console.error(`Partial not found: ${file}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

// Converts a youtube.com/watch, youtu.be, or existing embed URL into an
// embeddable URL. Returns null for anything else (Vimeo, etc.) so the
// story page just skips the embed rather than showing a broken iframe —
// the "Video" action link still works regardless.
function toYouTubeEmbedUrl(url) {
  if (!url) return null;
  let match = url.match(/[?&]v=([\w-]+)/);
  if (match) return `https://www.youtube.com/embed/${match[1]}`;
  match = url.match(/youtu\.be\/([\w-]+)/);
  if (match) return `https://www.youtube.com/embed/${match[1]}`;
  match = url.match(/youtube\.com\/embed\/([\w-]+)/);
  if (match) return `https://www.youtube.com/embed/${match[1]}`;
  return null;
}

// ── Build one holding's story page ───────────────────────────
function renderStoryPage(holding, allHoldings, mastheadHtml, footerHtml) {
  const plainTitle = holding.title.replace(/<[^>]+>/g, '');
  const description = (holding.description || '').replace(/<[^>]+>/g, '').slice(0, 160);
  const canonicalUrl = `https://www.jorarebooks.com/${holding.slug}/`;

  const heroImageHtml = holding.image
    ? `<img src="/${holding.image}" alt="${holding.alt || ''}">`
    : '';

  const blocks = Array.isArray(holding.story_body) ? holding.story_body : [];
  const bodyHtml = blocks.map(b => {
    // Backward-compatible: older entries may just be plain strings.
    const block = typeof b === 'string' ? { text: b } : b;
    const parts = [];
    if (block.heading) parts.push(`      <h2 class="story-subhead">${block.heading}</h2>`);
    if (block.text) parts.push(`      <p>${block.text}</p>`);
    if (block.quote) parts.push(`      <blockquote class="story-quote">${block.quote}</blockquote>`);
    if (block.image) {
      parts.push(`      <figure class="story-inline-image">
        <img src="/${block.image}" alt="${block.image_alt || ''}">
        ${block.image_caption ? `<figcaption class="story-gallery-caption">${block.image_caption}</figcaption>` : ''}
      </figure>`);
    }
    return parts.join('\n');
  }).filter(Boolean).join('\n');

  const embedUrl = toYouTubeEmbedUrl(holding.video_url);
  const videoHtml = embedUrl
    ? `<div class="story-video">
      <div class="story-video-frame">
        <iframe src="${embedUrl}" title="${plainTitle}" allowfullscreen></iframe>
      </div>
    </div>`
    : '';

  const gallery = Array.isArray(holding.gallery) ? holding.gallery : [];
  const galleryHtml = gallery.length
    ? `<div class="story-gallery">
${gallery.map(g => `      <figure class="story-gallery-item">
        <img src="/${g.image}" alt="${g.alt || ''}">
        ${g.caption ? `<figcaption class="story-gallery-caption">${g.caption}</figcaption>` : ''}
      </figure>`).join('\n')}
    </div>`
    : '';

  const pdfReminderHtml = (holding.pdf_url && holding.pdf_url.trim())
    ? `<p class="story-pdf-reminder">Full description${holding.pdf_caption ? ' — ' + holding.pdf_caption : ''}. <a href="${holding.pdf_url}" target="_blank" rel="noopener noreferrer">View PDF</a></p>`
    : '';

  // Everything that scrolls goes in one column — body, video, gallery, and
  // the closing PDF reminder — so that when the PDF card sits alongside it,
  // its sticky position spans the whole read, not just the opening text.
  const mainContentHtml = `<div class="story-body">
${bodyHtml}
      </div>
      ${videoHtml}
      ${galleryHtml}
      ${pdfReminderHtml}`;

  // The PDF gets its own cover card beside the text, but only if there's
  // actually a cover image to show — otherwise "View PDF" in the actions
  // row below is enough, and the column just runs single-width.
  const hasPdfCard = !!(holding.pdf_url && holding.pdf_url.trim() && holding.pdf_cover_image && holding.pdf_cover_image.trim());
  const pdfCaptionHtml = holding.pdf_caption
    ? `<span class="story-pdf-caption">${holding.pdf_caption}</span>`
    : '';
  const pdfCardHtml = hasPdfCard
    ? `<aside class="story-pdf-card">
        <a href="${holding.pdf_url}" target="_blank" rel="noopener noreferrer">
          <img src="/${holding.pdf_cover_image}" alt="Cover of the PDF">
        </a>
        <a class="story-pdf-link" href="${holding.pdf_url}" target="_blank" rel="noopener noreferrer">View PDF ↓</a>
        ${pdfCaptionHtml}
      </aside>`
    : '';

  const layoutHtml = hasPdfCard
    ? `<div class="story-layout">
      <div class="story-main">
        ${mainContentHtml}
      </div>
      ${pdfCardHtml}
    </div>`
    : `<div class="story-main">
      ${mainContentHtml}
    </div>`;

  const actionsHtml = cardActionsHtml(holding);

  // Prev/next only among holdings that actually have a story page.
  const storyHoldings = allHoldings.filter(h => h.slug && h.slug.trim());
  const idx = storyHoldings.findIndex(h => h.slug === holding.slug);
  const prev = idx > 0 ? storyHoldings[idx - 1] : null;
  const next = idx >= 0 && idx < storyHoldings.length - 1 ? storyHoldings[idx + 1] : null;

  const prevHtml = prev
    ? `<a class="story-prev" href="/${prev.slug}/">← ${prev.title.replace(/<[^>]+>/g, '')}</a>`
    : '<span></span>';
  const nextHtml = next
    ? `<a class="story-next" href="/${next.slug}/">${next.title.replace(/<[^>]+>/g, '')} →</a>`
    : '';

  let output = fs.readFileSync(STORY_TEMPLATE, 'utf8');

  const required = [
    '<!-- MASTHEAD -->', '<!-- FOOTER -->', '<!-- STORY_HERO_IMAGE -->',
    '<!-- STORY_TITLE -->', '<!-- STORY_LAYOUT -->',
    '<!-- STORY_ACTIONS -->', '<!-- STORY_PREV -->', '<!-- STORY_NEXT -->'
  ];
  for (const marker of required) {
    if (!output.includes(marker)) {
      console.error(`story-template.html is missing the ${marker} placeholder.`);
      process.exit(1);
    }
  }

  output = output
    .replace('<!-- PAGE_TITLE -->', plainTitle)
    .replace('<!-- PAGE_DESCRIPTION -->', description)
    .replace('<!-- CANONICAL_URL -->', canonicalUrl)
    .replace('<!-- MASTHEAD -->', mastheadHtml)
    .replace('<!-- STORY_HERO_IMAGE -->', heroImageHtml)
    .replace('<!-- STORY_TITLE -->', holding.title)
    .replace('<!-- STORY_LAYOUT -->', layoutHtml)
    .replace('<!-- STORY_ACTIONS -->', actionsHtml)
    .replace('<!-- STORY_PREV -->', prevHtml)
    .replace('<!-- STORY_NEXT -->', nextHtml)
    .replace('<!-- FOOTER -->', footerHtml);

  return output;
}

async function build() {
  console.log('Loading shared partials...');
  const mastheadHtml = loadPartial('masthead.html');
  const footerHtml = loadPartial('footer.html');
  const footerHomeHtml = loadPartial('footer-home.html');

  console.log('Rendering homepage content...');
  const homepageData = loadHomepage();
  const heroHtml = renderHero(homepageData);
  const introHtml = renderIntro(homepageData);

  console.log('Loading holdings...');
  const holdings = loadHoldings();
  const holdingsHtml = renderHoldings(holdings);

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
  if (!output.includes('<!-- MASTHEAD -->')) {
    console.error('Template is missing the <!-- MASTHEAD --> placeholder.');
    process.exit(1);
  }
  if (!output.includes('<!-- FOOTER -->')) {
    console.error('Template is missing the <!-- FOOTER --> placeholder.');
    process.exit(1);
  }

  output = output.replace('<!-- LATEST EPISODE -->', latestHtml);
  output = output.replace('<!-- HOLDINGS -->', holdingsHtml);
  output = output.replace('<!-- HERO_IMAGE -->', heroHtml);
  output = output.replace('<!-- INTRO -->', introHtml);
  output = output.replace('<!-- SECTIONS -->', sectionsHtml);
  output = output.replace('<!-- COMING_SOON -->', comingSoonHtml);
  output = output.replace('<!-- MASTHEAD -->', mastheadHtml);
  output = output.replace('<!-- FOOTER -->', footerHomeHtml);

  fs.writeFileSync(OUTPUT, output, 'utf8');

  console.log('Building story pages...');
  const storyHoldings = holdings.filter(h => h.slug && h.slug.trim());
  for (const holding of storyHoldings) {
    const storyHtml = renderStoryPage(holding, holdings, mastheadHtml, footerHtml);
    const outDir = path.join(__dirname, holding.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), storyHtml, 'utf8');
    console.log(`  /${holding.slug}/`);
  }

  console.log('\nDone. Deploy the following to Netlify:');
  console.log('  index.html, styles.css, and every holding\'s image');
  console.log(`  plus a folder per story page: ${storyHoldings.map(h => h.slug).join(', ') || '(none yet)'}`);
  console.log(`\nBuilt at: ${new Date().toLocaleString()}`);
}

build();
