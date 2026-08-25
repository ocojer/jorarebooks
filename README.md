# jorarebooks.com

Source for Jeremy O'Connor's dealer site. Story-centered, editorial, minimal.

## Files

- `template.html` — the site. Contains a `<!-- LATEST EPISODE -->` placeholder
  that `build.js` fills in.
- `styles.css` — all site styling, as CSS custom properties (design tokens)
  plus rules. Edit this, not inline `<style>` tags.
- `build.js` — fetches the latest episode from the Rare Book Chat RSS feed
  and writes `index.html` (the deployed file). Not committed — see below.
- `HERO.jpg`, `GODFATHER.jpeg` — page images. Add any others (`YOCAM.jpg`,
  `MCBRIDE.jpg`, etc.) alongside them as holdings are added.
- `netlify.toml` — tells Netlify to run `node build.js` on every deploy.

## Local build

```
npm run build
# or
node build.js
```

Writes `index.html` in this folder. Open it locally to preview.

## Deploy

Push to `main`. Netlify is connected to this repo and rebuilds automatically —
it runs `node build.js` itself, so the live site always has the latest
episode baked in without you running anything locally.

## Editing the homepage

1. **Browser** — go to `jorarebooks.com/admin`, log in with your GitHub
   account (`ocojer`). You'll see three sections:
   - **Homepage** — the hero photo and the intro paragraphs below it.
   - **Current Holdings** — add, edit, or remove holdings, including photos,
     PDFs, and video links.
   - **Feature Sections** — full-width image + caption + description blocks
     (like the Godfather casting list). Add more and they stack in order.
2. **By hand** — the hero and intro live in `content/homepage.json`; each
   holding is its own file in `content/holdings/`; each feature section is
   its own file in `content/sections/`.

Either way, `build.js` reads these files at build time and generates the
page — nothing in `template.html` needs to change.

## Editing holdings

Two ways to do this:

1. **Browser** — same `/admin` page as above, under Current Holdings.
2. **By hand** — each holding is a small JSON file in `content/holdings/`.
   Add a new one, or edit an existing one, following the same shape:

   ```json
   {
     "order": 4,
     "title": "Holding title — wrap in <em></em> for italics",
     "description": "One or two sentences.",
     "image": "SOMEFILE.jpg",
     "alt": "Short description of the photo",
     "price": "Inquire",
     "pdf_url": "",
     "video_url": "",
     "url": "#"
   }
   ```

   `order` controls where it falls in the grid (lower numbers first). If
   `image` points to a file that isn't in the repo, the card falls back to a
   plain color block automatically — same as it always has.

   The bottom line of each card shows, in priority order: a "View PDF" link
   if `pdf_url` is set, a "Video" link if `video_url` is set, or — if
   neither is set — the `price` text as a clickable "Inquire" link that
   opens an email to jeremy@jorarebooks.com with the item name pre-filled
   in the subject.

Either way, `build.js` reads every file in `content/holdings/` at build time
and generates the grid — nothing in `template.html` needs to change.

## Editing feature sections

Full-width blocks below the holdings grid — same 1600px width, stacked in
`order`. Each is its own JSON file in `content/sections/`:

```json
{
  "order": 1,
  "image": "SOMEFILE.jpg",
  "alt": "Short description of the photo",
  "caption": "A short line under the photo.",
  "description": "Longer explanatory text below the caption."
}
```

Add more files to add more sections — they render one below the next.

## Story pages

Any holding can get its own page at jorarebooks.com/its-slug/ by setting a
**Story page slug** in `/admin` (or adding `"slug": "its-slug"` to its JSON
file by hand). Once set, `build.js` generates `its-slug/index.html`
automatically on every deploy — nothing else to configure.

**Story page text** is a list of blocks, each one a heading, a paragraph, a
pull-quote, or an image — add as many as the piece needs, in whatever order
and mix makes sense, reorder or delete freely. Fill in only the field that
matches what you want that block to be.

**PDF card**: if a holding has both a PDF link and a PDF cover image set,
the story page shows the cover alongside the text with its own download
link, sticky as the page scrolls. Without a cover image, "View PDF" just
appears in the actions row instead — no story page requires this.

**Video**: a YouTube link in the Video field embeds directly on the story
page, sized to match the text column.

**Prev/next**: automatic, based on each holding's `order` field, among
whichever holdings currently have a slug set.

**Shared layout**: `partials/masthead.html` and `partials/footer.html` are
injected into every page — the homepage *and* every story page — so a
masthead change updates everywhere at once. The homepage additionally uses
`partials/footer-home.html`, which adds the Pawn Stars paragraph; story
pages use the plain `footer.html` without it, so that story doesn't repeat
on every page.

## Design tokens

`styles.css` defines, in `:root`:

- `--font-display` / `--font-body` — Cormorant Garamond / DM Sans
- `--ink` / `--mid` / `--light` / `--border` / `--white` — the grayscale palette
- `--size-italic` — the shared size for intro text, podcast episode blurbs,
  and the Pawn Stars footnote
- `--size-headline` — used by story page titles (`.story-title`)
- `--size-body`, `--size-label` — reserved for a future pass of unifying
  the remaining one-off font sizes on the homepage (see Open Items below)

## Open items from Session 1

- Several small text sizes on the current homepage (card descriptions,
  section labels, the About panel) are still hardcoded one-offs rather than
  drawing from `--size-body` / `--size-label` — they're close but not
  identical to the standardized values (e.g. `.card-desc` is `0.72rem` vs.
  the `--size-body` token of `0.88rem`). Left untouched so nothing shifts
  visually without a side-by-side review first.
- `.card-title` (`clamp(0.95rem, 1.8vw, 1.1rem)`) is intentionally smaller
  than `--size-headline` — that token is now in active use for story page
  titles, and the compact grid card still runs smaller by design.
