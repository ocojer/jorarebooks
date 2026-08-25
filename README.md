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

## Editing holdings

Two ways to do this:

1. **Browser** — go to `jorarebooks.com/admin`, log in with your GitHub
   account (`ocojer`), and add, edit, or remove holdings there, including
   uploading photos. This commits straight to GitHub and Netlify deploys it.
2. **By hand** — each holding is a small JSON file in `content/holdings/`.
   Add a new one, or edit an existing one, following the same shape:

   ```json
   {
     "order": 4,
     "title": "Holding title — wrap in <em></em> for italics",
     "description": "One or two sentences.",
     "image": "SOMEFILE.jpg",
     "alt": "Short description of the photo",
     "price": "Inquire for price",
     "url": "#"
   }
   ```

   `order` controls where it falls in the grid (lower numbers first). If
   `image` points to a file that isn't in the repo, the card falls back to a
   plain color block automatically — same as it always has.

Either way, `build.js` reads every file in `content/holdings/` at build time
and generates the grid — nothing in `template.html` needs to change.

## Design tokens

`styles.css` defines, in `:root`:

- `--font-display` / `--font-body` — Cormorant Garamond / DM Sans
- `--ink` / `--mid` / `--light` / `--border` / `--white` — the grayscale palette
- `--size-italic` — the shared size for intro text, podcast episode blurbs,
  and the Pawn Stars footnote
- `--size-headline`, `--size-body`, `--size-label` — reserved for the next
  pass of unifying the remaining one-off font sizes across the site (see
  Open Items below)

## Open items from Session 1

- Several small text sizes on the current homepage (card descriptions,
  section labels, the About panel) are still hardcoded one-offs rather than
  drawing from `--size-body` / `--size-label` — they're close but not
  identical to the standardized values (e.g. `.card-desc` is `0.8rem` vs.
  the `--size-body` token of `0.88rem`). Left untouched this session so
  nothing shifts visually without a side-by-side review first.
- `.card-title` (`clamp(0.95rem, 1.8vw, 1.1rem)`) is smaller than the
  `--size-headline` token (`clamp(1.5rem, 3vw, 2rem)`) documented for
  "holding headlines" — the token is sized for future full story pages;
  the compact grid card intentionally runs smaller. Worth confirming that's
  still the intent once story pages exist.
