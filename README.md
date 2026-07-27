# FresherHub — Automated Fresher Job Aggregator

A self-updating site that tracks fresher-eligible IT job postings across 4
government portals and 55+ private company career pages, and shows each one
as an article with a preparation guide and a link to the official listing.

## How it works
```
config/companies.json   → the list of portals/career pages to check
scraper/scrape.js       → visits each one, finds fresher-relevant postings
.github/workflows/*.yml → runs the scraper automatically every day (free)
data/jobs.json          → the scraper's output — what the site displays
index.html              → the site itself (reads data/jobs.json)
```

No server, no database, no monthly cost. GitHub Actions runs the scraper on
a schedule, commits the results, and GitHub Pages serves the site.

## Setup
See **SETUP.md** for a full no-coding-required walkthrough.

## Customizing
- Add/remove companies: edit `config/companies.json`
- Change how often it runs: edit the `cron` line in
  `.github/workflows/scrape.yml`
- Adjust which titles count as "fresher-relevant": edit `FRESHER_KEYWORDS`
  and `EXCLUDE_KEYWORDS` near the top of `scraper/scrape.js`
- Change the auto-generated prep guide content: edit `scraper/templates.js`

## Reel scripts stay private
`data/reel-scripts.json` holds the AI-written hook/body/CTA for every
posting — but it is **never fetched or shown by index.html**. The public
website only ever loads `data/jobs.json` (articles, no reel scripts). To
actually use your reel scripts, open `data/reel-scripts.json` directly on
GitHub (or pull the repo) — this is exactly why keeping the repo private
(see `PRIVATE-REPO-SETUP.md`) matters: it's the only thing standing between
"only you can see this file" and "anyone can see this file."

## Respecting robots.txt (built in, not optional)
Before scraping any site, the automation checks that site's `robots.txt`
via `scraper/robots-check.js`. If a site disallows bots on that page, or
its rules can't be confirmed (site unreachable, blocking requests, etc.),
that site is **skipped entirely** for that run — no exceptions, no
override flag. Skipped sites and the reason are logged to
`data/jobs-review.json` under `robotsSkipped` so you can see what's being
respected. If a site you rely on shows up there consistently, that's a
signal to check that source manually instead of scraping it.

The bot also identifies itself honestly via a custom user agent
(`FresherHubBot`) rather than pretending to be a browser — add your real
contact email in `scraper/scrape.js` where the user agent string is set,
so any site owner with questions has a way to reach you.

## Limitations (read before relying on this)
- Scraping is keyword/heuristic-based, not a perfect structured feed — some
  noise is expected, especially at first.
- Some sites may block automated visits or change layout without notice —
  check `data/jobs-review.json` after a run to see what failed.
- This is intended for personal use in aggregating publicly available
  listings. If you plan wider distribution, review the terms of service of
  any site you add to `config/companies.json`.
