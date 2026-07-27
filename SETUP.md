# FresherHub — Setup Guide (no coding required)

This turns FresherHub into a site that updates itself daily, for free, with
nothing running on your own computer. You'll spend about 15 minutes doing
this setup once. After that, it runs on its own.

## What you're about to do
1. Put these files on GitHub (free account).
2. Turn on GitHub Pages — this hosts your website for free.
3. Turn on GitHub Actions — this runs the scraper every day automatically.
4. Click one button to run it the first time.

---

## Step 1 — Create a GitHub account
Go to [github.com](https://github.com) and sign up if you don't already have
an account. It's free.

## Step 2 — Create a new repository
1. Click the **+** icon (top right) → **New repository**.
2. Name it something like `fresherhub`.
3. Set it to **Public** (required for free GitHub Pages).
4. Click **Create repository**.

## Step 3 — Upload these files
1. On your new repository's page, click **Add file → Upload files**.
2. Drag in **everything** from this folder, keeping the folder structure
   (the `.github`, `config`, `data`, and `scraper` folders, plus
   `index.html`, `README.md`, and this `SETUP.md`).
3. Click **Commit changes**.

> If GitHub's upload page flattens your folders, instead install
> [GitHub Desktop](https://desktop.github.com), clone your new empty repo,
> copy these files into the folder it creates, and commit + push from there.
> It preserves folder structure automatically.

## Step 4 — Turn on GitHub Pages
1. In your repository, go to **Settings → Pages**.
2. Under "Build and deployment," set **Source** to **Deploy from a branch**.
3. Set **Branch** to `main` and folder to `/ (root)`. Click **Save**.
4. GitHub will show you a URL like `https://yourusername.github.io/fresherhub/`
   — that's your live site. It may take a minute or two to go live.

## Step 5 — Turn on GitHub Actions (the automation)
1. Go to the **Actions** tab in your repository.
2. If prompted, click **"I understand my workflows, enable them."**
3. You should see a workflow called **"Scrape fresher postings."**

## Step 6a — (Optional but recommended) Add AI-written articles
Without this, postings show a simple auto-generated summary. With it,
Claude writes a real article + a reel script for every posting.
1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
   (pay-as-you-go — a few cents per job posting).
2. In your repo, go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret**. Name it `ANTHROPIC_API_KEY`, paste your
   key, click **Add secret**.
4. That's it — the next run will pick it up automatically.

## Step 7 — Run it for the first time
1. Still in the **Actions** tab, click **"Scrape fresher postings."**
2. Click **Run workflow** (top right) → **Run workflow** again to confirm.
3. Wait 2–5 minutes. Refresh the page — you'll see a green checkmark when done.
4. Visit your site URL from Step 4 — it should now show live postings and a
   "Data last refreshed" note at the top.

From here on, it repeats **automatically every day** — you never need to
touch it again unless you want to change something.

---

## The two things you might occasionally do

**Add or remove a company:** open `config/companies.json` on GitHub (click
the file → pencil icon to edit), add a line in the same format, commit. It's
picked up on the next scheduled run.

**Something looks wrong / a company shows nothing:** that company's career
page likely changed its layout, or blocks automated visits. Check
`data/jobs-review.json` after a run — it lists which sites failed to load.
This is expected occasionally; it doesn't break anything else. You can
manually re-check that one company's page yourself, or just leave it —
it'll keep trying daily.

---

## Using your own domain (once you buy one)
1. In your domain registrar's DNS settings, add a **CNAME record** pointing
   your domain (or subdomain, e.g. `www`) to `yourusername.github.io`.
   For a root/apex domain, add the **A records** GitHub publishes at
   [docs.github.com → "Managing a custom domain"](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).
2. Back in **Settings → Pages** on your repo, enter your domain under
   **Custom domain** and save. Enable **Enforce HTTPS** once it's verified
   (can take up to 24 hours).

## Want to turn scripts into actual videos with your face?
Every posting now includes an AI-written reel script (hook, body, CTA) with
a "Copy full script" button. Turning that into an actual video and posting
it to Instagram needs a couple of external accounts that can't be
automated from scratch — see **video-automation/README.md** for the honest,
step-by-step version of what that involves.

## Important honesty notes

- **This is best-effort, not perfect.** The scraper reads whatever public
  page you point it at. Custom, JavaScript-heavy career pages (most big
  companies) don't have a clean, structured format, so postings are matched
  by keyword ("fresher," "graduate trainee," "entry level," etc.) rather
  than perfectly parsed. Expect occasional noise — extra or missed entries.
- **Always apply on the official site.** Every posting on FresherHub links
  back to the original page. Treat FresherHub as a discovery tool, not the
  final source of truth for dates, eligibility, or salary.
- **Respect each site's terms.** This scraper visits public pages at a slow,
  low-frequency rate (once a day) and identifies itself in its browser
  requests. Some sites' terms of service restrict automated access — if you
  plan to rely on this for more than personal use, it's worth reviewing the
  terms of any site you add, and adding your real contact email in
  `scraper/scrape.js` where the placeholder user agent string is set.
- **Government portals are the hardest to scrape reliably** — they change
  layouts often and sometimes block automated tools outright. If a
  government portal consistently fails, checking it manually once a week is
  the more reliable option for now.
