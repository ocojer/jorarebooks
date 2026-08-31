// build.js — jorarebooks.com
// Run with: node build.js
// Output:   index.html (ready to upload to Netlify)
//
// Place this file in the same folder as template.html, HERO.jpg, and GODFATHER.jpeg

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const RSS_URL           = 'https://feeds.transistor.fm/rare-book-chat';
const TEMPLATE          = path.join(__dirname, 'template.html');
const STORY_TEMPLATE    = path.join(__dirname, 'story-template.html');
const SHOP_TEMPLATE     = path.join(__dirname, 'shop-template.html');
const SHOP_ITEM_TEMPLATE = path.join(__dirname, 'shop-item-template.html');
const OUTPUT            = path.join(__dirname, 'index.html');
const HOLDINGS_DIR      = path.join(__dirname, 'content', 'holdings');
const HOMEPAGE_FILE     = path.join(__dirname, 'content', 'homepage.json');
const COMING_SOON_FILE  = path.join(__dirname, 'content', 'coming-soon.json');
const SECTIONS_DIR      = path.join(__dirname, 'content', 'sections');
const PARTIALS_DIR      = path.join(__dirname, 'partials');
const SITE_INFO_FILE    = path.join(__dirname, 'content', 'site-info.json');

const AIRTABLE_BASE_ID  = 'appcfXqSzvoq0by4T';
const AIRTABLE_TABLE    = 'ITEMS';
const AIRTABLE_TOKEN    = process.env.AIRTABLE_TOKEN || '';

// Airtable attachment URLs (images, PDFs) are temporary signed URLs that
// expire a few hours after being issued. Every attachment gets downloaded
// once per build into this folder and served locally instead, so pages
// don't go stale between deploys. See localizeAttachments() below.
const ASSETS_DIR        = path.join(__dirname, 'shop-assets');

// Every image — from Airtable and from CMS uploads alike — gets resized
// and converted into WebP (+ JPEG fallback) at these two sizes, written
// here. "large" covers hero/main/story images; "thumb" covers grid
// cards, list rows, related items, and the item-page thumbnail strip.
const OPTIMIZED_DIR      = path.join(__dirname, 'optimized');
const IMAGE_SIZES = {
  large: { width: 1600, quality: 82 },
  thumb: { width: 500,  quality: 78 },
};

// ── Fetch Airtable inventory ────────────────────────────────
// Pulls all records from the Items table with Availability = Available.
// Returns an empty array (not a fatal error) if the token is missing or
// the request fails — so local builds without the token still work fine,
// they just skip the shop inventory.
function fetchAirtable() {
  if (!AIRTABLE_TOKEN) {
    console.log('No AIRTABLE_TOKEN set — skipping inventory fetch.');
    return Promise.resolve([]);
  }

  const filter = encodeURIComponent(`{AVAILABILITY} = "Available"`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?filterByFormula=${filter}&pageSize=100`;

  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };
    https.get(url, options, res => {
      if (res.statusCode === 401) {
        console.error('Airtable: invalid token.');
        return resolve([]);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            console.error('Airtable error:', json.error);
            return resolve([]);
          }
          console.log(`Airtable: fetched ${(json.records || []).length} items.`);
          resolve(json.records || []);
        } catch (e) {
          console.error('Airtable: failed to parse response.', e.message);
          resolve([]);
        }
      });
      res.on('error', e => {
        console.error('Airtable: request failed.', e.message);
        resolve([]);
      });
    }).on('error', e => {
      console.error('Airtable: connection failed.', e.message);
      resolve([]);
    });
  });
}

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

async function renderHero(data) {
  if (!data.hero_image) return '';
  return cmsImageHtml(data.hero_image, data.hero_alt || '', 'large');
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
async function renderSections() {
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

  const blocks = await Promise.all(sections.map(async s => {
    const caption = s.caption
      ? `<div class="wide-section-caption">${s.caption}</div>`
      : '';
    const description = s.description
      ? `<p class="wide-section-desc">${s.description}</p>`
      : '';
    const imgHtml = await cmsImageHtml(s.image, s.alt || '', 'large', 'class="wide-section-img"');
    return `      <figure class="wide-section">
        ${imgHtml}
        <figcaption>
          ${caption}
          ${description}
        </figcaption>
      </figure>`;
  }));
  return blocks.join('\n\n');
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
async function renderHoldings(holdings) {
  const cards = await Promise.all(holdings.map(async h => {
    const url = holdingUrl(h);
    const actionsHtml = cardActionsHtml(h);
    // .closest('picture') covers the WebP/JPEG <picture> wrapper; the
    // (||this) fallback covers the plain <img> case when optimization
    // failed and cmsImageHtml returned the original file directly.
    const onerror = `onerror="this.closest('.card-img-wrap').style.background='#ece7de'; (this.closest('picture')||this).style.display='none';"`;
    const imgHtml = await cmsImageHtml(h.image, h.alt || '', 'thumb', onerror);

    return `      <div class="holding-card">
        <a class="card-img-link" href="${url}">
          <div class="card-img-wrap">
            ${imgHtml}
          </div>
        </a>
        <div class="card-body">
          <div class="card-title">${h.title}</div>
          <p class="card-desc">${h.description}</p>
          <div class="card-actions">${actionsHtml}</div>
        </div>
      </div>`;
  }));
  return cards.join('\n\n');
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
async function renderStoryPage(holding, allHoldings, mastheadHtml, footerHtml) {
  const plainTitle = holding.title.replace(/<[^>]+>/g, '');
  const description = (holding.description || '').replace(/<[^>]+>/g, '').slice(0, 160);
  const canonicalUrl = `https://www.jorarebooks.com/${holding.slug}/`;

  const heroImageHtml = holding.image
    ? await cmsImageHtml(holding.image, holding.alt || '', 'large')
    : '';

  const blocks = Array.isArray(holding.story_body) ? holding.story_body : [];
  const bodyParts = await Promise.all(blocks.map(async b => {
    // Backward-compatible: older entries may just be plain strings.
    const block = typeof b === 'string' ? { text: b } : b;
    const parts = [];
    if (block.heading) parts.push(`      <h2 class="story-subhead">${block.heading}</h2>`);
    if (block.text) parts.push(`      <p>${block.text}</p>`);
    if (block.quote) parts.push(`      <blockquote class="story-quote">${block.quote}</blockquote>`);
    if (block.image) {
      const imgHtml = await cmsImageHtml(block.image, block.image_alt || '', 'large');
      parts.push(`      <figure class="story-inline-image">
        ${imgHtml}
        ${block.image_caption ? `<figcaption class="story-gallery-caption">${block.image_caption}</figcaption>` : ''}
      </figure>`);
    }
    return parts.join('\n');
  }));
  const bodyHtml = bodyParts.filter(Boolean).join('\n');

  const embedUrl = toYouTubeEmbedUrl(holding.video_url);
  const videoHtml = embedUrl
    ? `<div class="story-video">
      <div class="story-video-frame">
        <iframe src="${embedUrl}" title="${plainTitle}" allowfullscreen></iframe>
      </div>
    </div>`
    : '';

  const gallery = Array.isArray(holding.gallery) ? holding.gallery : [];
  const galleryItems = await Promise.all(gallery.map(async g => {
    const imgHtml = await cmsImageHtml(g.image, g.alt || '', 'large');
    return `      <figure class="story-gallery-item">
        ${imgHtml}
        ${g.caption ? `<figcaption class="story-gallery-caption">${g.caption}</figcaption>` : ''}
      </figure>`;
  }));
  const galleryHtml = galleryItems.length
    ? `<div class="story-gallery">
${galleryItems.join('\n')}
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
  const pdfCoverImgHtml = hasPdfCard
    ? await cmsImageHtml(holding.pdf_cover_image, 'Cover of the PDF', 'thumb')
    : '';
  const pdfCardHtml = hasPdfCard
    ? `<aside class="story-pdf-card">
        <a href="${holding.pdf_url}" target="_blank" rel="noopener noreferrer">
          ${pdfCoverImgHtml}
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

// ── Load content/site-info.json ──────────────────────────────
function loadSiteInfo() {
  if (!fs.existsSync(SITE_INFO_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SITE_INFO_FILE, 'utf8')); }
  catch (e) { console.error('Invalid JSON in site-info.json:', e.message); return {}; }
}

// ── Helpers for Airtable field access ────────────────────────
function field(record, name) {
  return (record.fields || {})[name] || '';
}

function fieldArr(record, name) {
  return Array.isArray((record.fields || {})[name]) ? record.fields[name] : [];
}

// ── Download one file, following redirects ───────────────────
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('error', err => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// ── Download one file into memory, following redirects — used for images,
//    which get piped straight into sharp rather than saved to disk raw.
function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadToBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Keep only characters that are safe in a URL path segment.
function safeFilename(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '-');
}

// ── Resize + convert one image source into a WebP + JPEG pair at a given
//    size preset, written into OPTIMIZED_DIR. Skips the work if both
//    files already exist from earlier in this same build run. Returns
//    the public (root-relative) paths for use in a <picture> tag.
async function makeImageVariant(sourceBuffer, keySlug, sizeName) {
  fs.mkdirSync(OPTIMIZED_DIR, { recursive: true });
  const preset = IMAGE_SIZES[sizeName];
  const webpName = `${keySlug}-${sizeName}.webp`;
  const jpgName  = `${keySlug}-${sizeName}.jpg`;
  const webpPath = path.join(OPTIMIZED_DIR, webpName);
  const jpgPath  = path.join(OPTIMIZED_DIR, jpgName);

  if (!fs.existsSync(webpPath) || !fs.existsSync(jpgPath)) {
    const img = sharp(sourceBuffer).rotate().resize({ width: preset.width, withoutEnlargement: true });
    await Promise.all([
      img.clone().webp({ quality: preset.quality }).toFile(webpPath),
      img.clone().jpeg({ quality: preset.quality, mozjpeg: true }).toFile(jpgPath),
    ]);
  }
  return { webp: `/optimized/${webpName}`, jpg: `/optimized/${jpgName}` };
}

// ── Download & convert every image attachment (IMAGE(S), PDF COVER IMAGE)
//    for one record into large/thumb WebP+JPEG pairs, stored back onto
//    the attachment object as att.large / att.thumb. Every downstream
//    renderer reads these off the same attachment objects via
//    firstImageVariant() / renderThumbs(), so this one pass covers shop
//    grid/list thumbnails, item page thumbnails and main image, and
//    related-item cards.
async function localizeImageAttachments(record) {
  for (const fieldName of ['IMAGE(S)', 'PDF COVER IMAGE']) {
    for (const att of fieldArr(record, fieldName)) {
      if (!att.url) continue;
      const keySlug = safeFilename(`${record.id}-${att.id || 'att'}`);
      try {
        const buffer = await downloadToBuffer(att.url);
        att.large = await makeImageVariant(buffer, keySlug, 'large');
        att.thumb = await makeImageVariant(buffer, keySlug, 'thumb');
      } catch (e) {
        console.error(`  Failed to process ${fieldName} for "${field(record, 'TITLE')}": ${e.message} — image will be skipped.`);
      }
    }
  }
}

// ── Download the actual PDF file (condition reports, etc.) as-is — not
//    an image, so nothing to convert, but same reasoning as above:
//    Airtable's signed URL expires, this makes the link permanent.
async function localizePdfAttachments(record) {
  for (const att of fieldArr(record, 'PDF')) {
    if (!att.url) continue;
    const fname = safeFilename(`${record.id}-${att.id || 'att'}-${att.filename || 'file.pdf'}`);
    const destPath = path.join(ASSETS_DIR, fname);
    if (!fs.existsSync(destPath)) {
      try {
        await downloadFile(att.url, destPath);
      } catch (e) {
        console.error(`  Failed to download PDF for "${field(record, 'TITLE')}": ${e.message} — leaving temporary Airtable URL in place.`);
        continue;
      }
    }
    att.url = `/shop-assets/${fname}`;
  }
}

async function localizeAttachments(record) {
  await localizePdfAttachments(record);
  await localizeImageAttachments(record);
}

// Runs localizeAttachments across every record, sequentially, so we don't
// hammer Airtable's CDN with dozens of simultaneous downloads at once.
async function localizeAllAttachments(records) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.mkdirSync(OPTIMIZED_DIR, { recursive: true });
  let count = 0;
  for (const record of records) {
    await localizeAttachments(record);
    count++;
  }
  console.log(`Localized attachments for ${count} inventory records.`);
}

// ── First image attachment's optimized variant for a given size, or null
//    if there isn't one (missing field, or it failed to process).
function firstImageVariant(record, fieldName, size) {
  const atts = fieldArr(record, fieldName);
  return (atts.length && atts[0][size]) ? atts[0][size] : null;
}

// ── Renders a <picture> element with a WebP source and a JPEG fallback —
//    covers the ~97% of visitors on WebP-capable browsers and falls
//    through to the <img> tag for the small remainder (old Safari/IE).
function pictureTag(variant, alt, extraImgAttrs = '') {
  if (!variant) return '';
  const safeAlt = (alt || '').replace(/"/g, '&quot;');
  return `<picture><source srcset="${variant.webp}" type="image/webp"><img src="${variant.jpg}" alt="${safeAlt}"${extraImgAttrs ? ' ' + extraImgAttrs : ''}></picture>`;
}

// ── Resolve + optimize a CMS-uploaded image (Sveltia commits these flat
//    into the repo root — see media_folder/public_folder in config.yml)
//    into a <picture> tag at the given size. Falls back to the original
//    uploaded file directly if optimization fails for any reason, so a
//    bad image never means a blank page — just a non-optimized one.
async function cmsImageHtml(relativePath, alt, size, extraImgAttrs = '') {
  if (!relativePath || !relativePath.trim()) return '';
  const clean = relativePath.replace(/^\/+/, '');
  const sourcePath = path.join(__dirname, clean);
  const safeAlt = (alt || '');
  if (!fs.existsSync(sourcePath)) {
    console.error(`  CMS image not found on disk, skipping optimization: ${clean}`);
    return `<img src="/${clean}" alt="${safeAlt.replace(/"/g, '&quot;')}"${extraImgAttrs ? ' ' + extraImgAttrs : ''}>`;
  }
  const keySlug = safeFilename(clean.replace(/\.[^.]+$/, ''));
  try {
    const variant = await makeImageVariant(fs.readFileSync(sourcePath), keySlug, size);
    return pictureTag(variant, safeAlt, extraImgAttrs);
  } catch (e) {
    console.error(`  Failed to optimize ${clean}: ${e.message} — using original file.`);
    return `<img src="/${clean}" alt="${safeAlt.replace(/"/g, '&quot;')}"${extraImgAttrs ? ' ' + extraImgAttrs : ''}>`;
  }
}

// ── Derive a URL-safe slug from an Airtable record ───────────
function itemSlug(record) {
  const manual = field(record, 'SLUG');
  if (manual && manual.trim()) return manual.trim();
  const title = field(record, 'TITLE');
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Render all Airtable attachment images as thumbnail strip — each
//    tile shows the small "thumb" variant; clicking swaps the sticky
//    main image to the "large" variant (see switchImage() in the
//    shop-item-template.html script block).
function renderThumbs(record) {
  const atts = fieldArr(record, 'IMAGE(S)');
  if (!atts.length) return '';
  return atts.filter(att => att.thumb && att.large).map((att, i) => {
    const alt = (att.filename || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `<div class="shop-item-thumb${i === 0 ? ' active' : ''}"
      onclick="switchImage('${att.large.webp}','${att.large.jpg}','${alt}',this)">
      ${pictureTag(att.thumb, att.filename || '', 'loading="lazy"')}
    </div>`;
  }).join('\n');
}

// ── Render the contact block from site-info ──────────────────
function renderContactBlock(siteInfo) {
  const parts = [];
  if (siteInfo.phone && siteInfo.phone_display) {
    parts.push(`📞 <a href="tel:${siteInfo.phone}">${siteInfo.phone_display}</a>`);
  }
  if (siteInfo.email) {
    parts.push(`✉ <a href="mailto:${siteInfo.email}">${siteInfo.email}</a>`);
  }
  return parts.join(' &nbsp;·&nbsp; ');
}

// ── Convert a YouTube URL to embed URL ───────────────────────
function toEmbedUrl(url) {
  if (!url) return null;
  let m = url.match(/[?&]v=([\w-]+)/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = url.match(/youtu\.be\/([\w-]+)/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  return null;
}

// ── Render the item description body (first para, pull quote,
//    remaining paras, optional video, PDF) ────────────────────
function renderItemBody(record) {
  const desc = field(record, 'DESCRIPTION');
  const pullQuote = field(record, 'PULL QUOTE');
  const pullAttr = field(record, 'PULL QUOTE ATTRIBUTION');
  const videoUrl = field(record, 'VIDEO URL');
  const pdfAtts = fieldArr(record, 'PDF');
  const pdfCoverAtts = fieldArr(record, 'PDF COVER IMAGE');

  // Split description into paragraphs
  const paras = desc.split(/\n+/).map(p => p.trim()).filter(Boolean);

  let html = '';

  // First paragraph — the summary that does the selling
  if (paras.length > 0) {
    html += `<div class="shop-item-desc"><p>${paras[0]}</p></div>\n`;
  }

  // Pull quote after first paragraph
  if (pullQuote) {
    html += `<div class="shop-item-pull-quote">
      <div class="shop-item-pull-quote-text">"${pullQuote}"</div>
      ${pullAttr ? `<div class="shop-item-pull-quote-attr">${pullAttr}</div>` : ''}
    </div>\n`;
  }

  // Remaining paragraphs
  if (paras.length > 1) {
    html += `<div class="shop-item-desc">\n`;
    paras.slice(1).forEach(p => { html += `      <p>${p}</p>\n`; });
    html += `</div>\n`;
  }

  // Video embed
  const embedUrl = toEmbedUrl(videoUrl);
  if (embedUrl) {
    html += `<div class="shop-item-video">
      <div class="shop-item-video-frame">
        <iframe src="${embedUrl}" title="${field(record, 'TITLE')}" allowfullscreen></iframe>
      </div>
    </div>\n`;
  }

  // PDF link — with optional cover image card
  if (pdfAtts.length) {
    const pdfUrl = pdfAtts[0].url;
    const pdfName = field(record, 'TITLE') || pdfAtts[0].filename;
    html += `<div class="shop-item-pdf">
      <span class="shop-item-pdf-icon">📄</span>
      <span class="shop-item-pdf-name">${pdfName} — Full Description</span>
      <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="shop-item-pdf-link">View PDF</a>
    </div>\n`;
  }

  return html;
}

// ── Render a single shop item page ───────────────────────────
function renderShopItemPage(record, allRecords, mastheadHtml, footerHtml, siteInfo) {
  const title = field(record, 'TITLE');
  const author = field(record, 'AUTHOR');
  const artist = field(record, 'ARTIST/ILLUSTRATOR');
  const authorDisplay = [author, artist].filter(Boolean).join('; ');
  const date = field(record, 'DATE');
  const place = field(record, 'PLACE');
  const publisher = field(record, 'PUBLISHER');
  const categories = fieldArr(record, 'CATEGORY');
  const price = field(record, 'PRICE/INQUIRE');
  const listPrice = field(record, 'MARKET PRICE');
  const inquireOnly = record.fields['INQUIRE ONLY?'];
  const slug = itemSlug(record);

  const headline = field(record, 'HEADLINE');
  const notes = field(record, 'NOTES');
  const notesHtml = notes
    ? '<div class="shop-item-notes"><button class="notes-toggle" onclick="toggleNotes(this)" aria-expanded="false"><span class="notes-toggle-icon"></span>Notes</button><div class="notes-body">' + notes.split(/\n+/).map(p => p.trim()).filter(Boolean).map(p => '<p>' + p + '</p>').join('') + '</div></div>'
    : '';
  const headlineHtml = headline ? '<div class="shop-item-headline">' + headline + '</div>' : '';
  const placeDate = [place, publisher, date].filter(Boolean).join(': ').replace(/: (\d)/, ', $1') || '';
  const categoryDisplay = categories.join(' · ');
  const canonicalUrl = `https://www.jorarebooks.com/shop/${slug}/`;
  const seoDesc = field(record, 'SEO DESCRIPTION') ||
    `${title}${authorDisplay ? ` by ${authorDisplay}` : ''}. ${field(record, 'DESCRIPTION').slice(0, 140)}`;

  // Price display
  const showPrice = !inquireOnly && (price || listPrice);
  const priceDisplay = showPrice
    ? (price || `$${Number(listPrice).toLocaleString()}`)
    : 'Inquire';

  // Action buttons
  const priceNote = siteInfo.shipping_note
    ? `<span class="shop-item-price-note">${siteInfo.shipping_note}</span>` : '';

  let actionsHtml = '';
  if (inquireOnly || !showPrice) {
    actionsHtml = `<button class="shop-btn-inquire" onclick="openModal('${title.replace(/'/g, "\\'")}')">Inquire</button>`;
  } else {
    actionsHtml = `<button class="shop-btn-cart" onclick="alert('Cart coming soon')">Add to Cart</button>
      <button class="shop-btn-inquire" onclick="openModal('${title.replace(/'/g, "\\'")}')">Inquire</button>`;
  }

  // Contact block
  const contactHtml = renderContactBlock(siteInfo);

  // Main image — large variant, matching what the thumbnail strip swaps to
  const mainVariant = firstImageVariant(record, 'IMAGE(S)', 'large');
  const mainImgHtml = pictureTag(mainVariant, title, 'loading="eager"');

  // Related items — same category, excluding self, up to 4
  const related = allRecords
    .filter(r => {
      if (itemSlug(r) === slug) return false;
      if (field(r, 'AVAILABILITY') !== 'Available') return false;
      const rCats = fieldArr(r, 'CATEGORY');
      return categories.some(c => rCats.includes(c));
    })
    .slice(0, 4);

  const relatedHtml = related.length ? `
    <div class="shop-item-related">
      <span class="shop-item-related-label">Related items</span>
      <div class="shop-item-related-grid">
        ${related.map(r => {
          const rSlug = itemSlug(r);
          const rVariant = firstImageVariant(r, 'IMAGE(S)', 'thumb');
          const rTitle = field(r, 'TITLE');
          const rAuthor = field(r, 'AUTHOR');
          const rPrice = field(r, 'PRICE/INQUIRE') || (r.fields['INQUIRE ONLY?'] ? 'Inquire' : '');
          return `<a href="/shop/${rSlug}/" class="related-card">
            <div class="related-card-img">${pictureTag(rVariant, rTitle, 'loading="lazy"')}</div>
            <div class="related-card-author">${rAuthor}</div>
            <div class="related-card-title">${rTitle}</div>
            <div class="related-card-price">${rPrice}</div>
          </a>`;
        }).join('\n')}
      </div>
    </div>` : '';

  let output = fs.readFileSync(SHOP_ITEM_TEMPLATE, 'utf8');
  output = output
    .replace(/<!-- ITEM_TITLE -->/g, title)
    .replace('<!-- ITEM_SEO_DESC -->', seoDesc)
    .replace('<!-- ITEM_CANONICAL -->', canonicalUrl)
    .replace('<!-- MASTHEAD -->', mastheadHtml)
    .replace('<!-- ITEM_THUMBS -->', renderThumbs(record))
    .replace('<!-- ITEM_MAIN_IMAGE -->', mainImgHtml)
    .replace('<!-- ITEM_CATEGORY -->', categoryDisplay)
    .replace('<!-- ITEM_AUTHOR -->', authorDisplay)
    .replace('<!-- ITEM_TITLE_DISPLAY -->', title)
    .replace('<!-- ITEM_PLACE_DATE -->', placeDate)
    .replace('<!-- ITEM_HEADLINE -->', headlineHtml)
    .replace('<!-- ITEM_PRICE -->', priceDisplay)
    .replace('<!-- ITEM_PRICE_NOTE -->', priceNote)
    .replace('<!-- ITEM_ACTIONS -->', actionsHtml)
    .replace('<!-- ITEM_CONTACT -->', contactHtml)
    .replace('<!-- ITEM_DESCRIPTION_BODY -->', renderItemBody(record))
    .replace('<!-- ITEM_NOTES -->', notesHtml)
    .replace('<!-- ITEM_BREADCRUMB_CATEGORY -->', categoryDisplay
      ? `<a href="/shop/?cat=${encodeURIComponent(categories[0] || '')}">${categories[0] || ''}</a>` : '')
    .replace('<!-- ITEM_BREADCRUMB_TITLE -->', title)
    .replace('<!-- ITEM_RELATED -->', relatedHtml)
    .replace('<!-- FOOTER -->', footerHtml);

  return output;
}

// ── Render the /shop/ listing page ───────────────────────────
function renderShopPage(records, mastheadHtml, footerHtml, siteInfo) {
  const categories = [...new Set(
    records.flatMap(r => fieldArr(r, 'CATEGORY'))
  )].sort();

  const filterButtons = [
    `<button class="filter-btn active" onclick="filterCategory('all',this)">All</button>`,
    ...categories.map(cat =>
      `<button class="filter-btn" onclick="filterCategory('${cat}',this)">${cat}</button>`
    )
  ].join('\n      ');

  // Grid cards
  const gridItems = records.map(r => {
    const slug = itemSlug(r);
    const title = field(r, 'TITLE');
    const author = field(r, 'AUTHOR');
    const date = field(r, 'DATE');
    const place = field(r, 'PLACE');
    const price = field(r, 'PRICE/INQUIRE');
    const inquireOnly = r.fields['INQUIRE ONLY?'];
    const priceDisplay = (!inquireOnly && price) ? price : 'Inquire';
    const imgVariant = firstImageVariant(r, 'IMAGE(S)', 'thumb');
    const cats = fieldArr(r, 'CATEGORY').join(',');
    const isArchive = r.fields['IS ARCHIVE?'];
    const meta = [place, date].filter(Boolean).join(', ');

    return `<a href="/shop/${slug}/" class="grid-card" data-categories="${cats}">
      <div class="grid-img-wrap">
        <div class="grid-img">${pictureTag(imgVariant, title, 'loading="lazy"')}</div>
        ${isArchive ? '<span class="grid-badge">Archive</span>' : ''}
      </div>
      <div class="grid-author">${author}</div>
      <div class="grid-title">${title}</div>
      ${meta ? `<div class="grid-meta">${meta}</div>` : ''}
      <div class="grid-price">${priceDisplay}</div>
    </a>`;
  }).join('\n\n');

  // List cards
  const listItems = records.map(r => {
    const slug = itemSlug(r);
    const title = field(r, 'TITLE');
    const author = field(r, 'AUTHOR');
    const date = field(r, 'DATE');
    const place = field(r, 'PLACE');
    const publisher = field(r, 'PUBLISHER');
    const price = field(r, 'PRICE/INQUIRE');
    const marketPrice = field(r, 'MARKET PRICE');
    const inquireOnly = r.fields['INQUIRE ONLY?'];
    const showPrice = !inquireOnly && (price || marketPrice);
    const priceDisplay = showPrice ? (price || `$${Number(marketPrice).toLocaleString()}`) : null;
    const desc = field(r, 'DESCRIPTION');
    const pullQuote = field(r, 'PULL QUOTE');
    const imgVariant = firstImageVariant(r, 'IMAGE(S)', 'thumb');
    const cats = fieldArr(r, 'CATEGORY').join(',');
    const isArchive = r.fields['IS ARCHIVE?'];
    const meta = [place, publisher, date].filter(Boolean).join(' · ');
    const subject = encodeURIComponent(`Inquiry: ${title}`);
    const email = siteInfo.email || 'info@jorarebooks.com';

    // Use a div with onclick rather than <a> wrapping other <a> tags
    // (nested links are invalid HTML and break browser rendering)
    const rightHtml = `
      ${isArchive ? '<span class="list-badge">Archive</span>' : ''}
      ${priceDisplay ? `<span class="list-price">${priceDisplay}</span>` : ''}
      ${showPrice
        ? `<button class="list-btn list-btn-cart" onclick="event.stopPropagation();alert('Cart coming soon')">Add to Cart</button>`
        : `<a href="mailto:${email}?subject=${subject}" class="list-btn list-btn-inquire" onclick="event.stopPropagation()">Inquire</a>`}
      <a href="/shop/${slug}/" class="list-view" onclick="event.stopPropagation()">View →</a>`;

    return `<div class="list-card" data-categories="${cats}" onclick="window.location='/shop/${slug}/'" style="cursor:pointer;">
      <div class="list-img">${pictureTag(imgVariant, title, 'loading="lazy"')}</div>
      <div class="list-body">
        ${pullQuote ? `<div class="list-pull">"${pullQuote}"</div>` : ''}
        <div class="list-author">${author}</div>
        <div class="list-title">${title}</div>
        ${meta ? `<div class="list-meta">${meta}</div>` : ''}
        ${desc ? `<div class="list-desc">${desc}</div>` : ''}
      </div>
      <div class="list-right">${rightHtml}</div>
    </div>`;
  }).join('\n\n');

  let output = fs.readFileSync(SHOP_TEMPLATE, 'utf8');
  output = output
    .replace('<!-- MASTHEAD -->', mastheadHtml)
    .replace('<!-- SHOP_COUNT -->', records.length)
    .replace('<!-- SHOP_FILTERS -->', filterButtons)
    .replace('<!-- SHOP_GRID_ITEMS -->', gridItems)
    .replace('<!-- SHOP_LIST_ITEMS -->', listItems);

  return output;
}

async function build() {
  console.log('Loading shared partials...');
  const mastheadHtml = loadPartial('masthead.html');
  const footerHtml = loadPartial('footer.html');
  const footerHomeHtml = loadPartial('footer-home.html');

  console.log('Loading site info...');
  const siteInfo = loadSiteInfo();

  console.log('Fetching Airtable inventory...');
  const inventoryRecords = await fetchAirtable();
  console.log(`Inventory: ${inventoryRecords.length} available items.`);
  if (inventoryRecords.length > 0) { console.log("DEBUG fields:", Object.keys(inventoryRecords[0].fields || {}).join(", ")); }

  console.log('Downloading and localizing Airtable attachments (images, PDFs)...');
  await localizeAllAttachments(inventoryRecords);

  console.log('Rendering homepage content...');
  const homepageData = loadHomepage();
  const heroHtml = await renderHero(homepageData);
  const introHtml = renderIntro(homepageData);

  console.log('Loading holdings...');
  const holdings = loadHoldings();
  const holdingsHtml = await renderHoldings(holdings);

  console.log('Rendering sections...');
  const sectionsHtml = await renderSections();

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
    const storyHtml = await renderStoryPage(holding, holdings, mastheadHtml, footerHtml);
    const outDir = path.join(__dirname, holding.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), storyHtml, 'utf8');
    console.log(`  /${holding.slug}/`);
  }

  console.log('Building shop pages...');
  if (inventoryRecords.length > 0) {
    // Shop listing page
    const shopHtml = renderShopPage(inventoryRecords, mastheadHtml, footerHtml, siteInfo);
    const shopDir = path.join(__dirname, 'shop');
    fs.mkdirSync(shopDir, { recursive: true });
    fs.writeFileSync(path.join(shopDir, 'index.html'), shopHtml, 'utf8');
    console.log('  /shop/');

    // Individual item pages
    for (const record of inventoryRecords) {
      const slug = itemSlug(record);
      const itemHtml = renderShopItemPage(record, inventoryRecords, mastheadHtml, footerHtml, siteInfo);
      const itemDir = path.join(__dirname, 'shop', slug);
      fs.mkdirSync(itemDir, { recursive: true });
      fs.writeFileSync(path.join(itemDir, 'index.html'), itemHtml, 'utf8');
      console.log(`  /shop/${slug}/`);
    }
  } else {
    console.log('  No inventory records — skipping shop pages.');
  }

  console.log('\nDone. Deploy the following to Netlify:');
  console.log('  index.html, styles.css, and every holding\'s image');
  console.log(`  plus a folder per story page: ${storyHoldings.map(h => h.slug).join(', ') || '(none yet)'}`);
  console.log(`\nBuilt at: ${new Date().toLocaleString()}`);
}

build();
