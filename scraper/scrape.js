// scrape.js
// Visits every portal/career page in config/companies.json, looks for
// fresher-relevant postings, and writes the results to data/jobs.json
// (used directly by index.html) plus data/jobs-review.json (load errors
// and robots.txt-skipped sites — worth a glance, but nothing breaks if
// you never look).
//
// Before touching any page, this checks that site's robots.txt via
// robots-check.js. If a site disallows bots, or its rules can't be
// confirmed, that site is skipped entirely — no exceptions. This keeps
// the automation compliant with each source's own stated rules rather
// than assuming access is fine just because a page is public.
//
// Runs headless via Playwright so it can see JavaScript-rendered career
// pages, not just static HTML.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { generatePrep, generateAbout, generateEligibility } = require("./templates");
const { checkUrl, USER_AGENT } = require("./robots-check");

const ROOT = path.join(__dirname, "..");
const COMPANIES_PATH = path.join(ROOT, "config", "companies.json");
const JOBS_OUT_PATH = path.join(ROOT, "data", "jobs.json");
const REVIEW_OUT_PATH = path.join(ROOT, "data", "jobs-review.json");
const META_OUT_PATH = path.join(ROOT, "data", "jobs-meta.json");

// Titles must match one of these to be considered "fresher-relevant".
// Matched with word boundaries (\b) — plain .includes() caused false
// positives like "ge " matching inside "pa-ge " (from "Job Search page").
const FRESHER_KEYWORDS = [
  "fresher", "freshers", "graduate trainee", "trainee", "entry level",
  "entry-level", "campus placement", "associate engineer", "junior engineer",
  "0-1 year", "0-2 years", "no experience required", "early career",
  "new grad", "new graduate", "data entry operator", "systems engineer",
  "specialist engineer", "graduate engineer trainee"
];

// Titles containing these are excluded even if they matched above —
// seniority signals, and generic nav/footer/legal text that isn't an
// actual job listing.
const EXCLUDE_KEYWORDS = [
  "senior", "sr.", "lead", "manager", "principal", "architect",
  "5+ years", "7+ years", "10+ years", "director", "head of",
  "please visit", "explore", "accessible format", "search page",
  "job search", "cookie", "privacy", "terms of", "sign in", "log in",
  "subscribe", "newsletter", "view all", "see all", "learn more",
  "read more", "find out", "our culture", "about us", "contact us",
];

// A real job title almost always contains one of these role words.
// This is the main quality gate: it filters out generic hub/nav links
// (like "Early Careers" or "Students and new grads") that happen to
// contain a fresher keyword but aren't an actual posting.
const ROLE_WORDS = [
  "engineer", "developer", "officer", "trainee", "associate", "analyst",
  "executive", "operator", "clerk", "specialist", "technician", "programmer",
  "scientist", "consultant", "administrator", "coordinator", "assistant",
  "intern", "internship",
];

const REQUEST_TIMEOUT_MS = 25000;
const MAX_LINKS_PER_SITE = 8;

function loadCompanies() {
  const raw = JSON.parse(fs.readFileSync(COMPANIES_PATH, "utf8"));
  const govt = raw.govt.map((c) => ({ ...c, sector: "govt" }));
  const priv = raw.private.map((c) => ({ ...c, sector: "private" }));
  return [...govt, ...priv];
}

function hasWordBoundaryMatch(text, keyword) {
  // Escape regex special characters in the keyword, then require it to
  // not be glued to letters on either side (so "ge" in "page" doesn't
  // count, but "GE" as its own word, or "graduate trainee", does).
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i");
  return re.test(text);
}

function isFresherRelevant(text) {
  const t = text.toLowerCase().trim();
  if (t.length < 6) return false;
  if (EXCLUDE_KEYWORDS.some((k) => t.includes(k))) return false;

  const matchesFresherKeyword = FRESHER_KEYWORDS.some((k) => hasWordBoundaryMatch(t, k));
  if (!matchesFresherKeyword) return false;

  // Require it to also look like an actual role title, not a generic
  // link. "fresher" and "graduate" on their own are exempted from this
  // check since they're unambiguous even without a role word attached
  // (e.g. a link literally titled "Freshers 2026").
  const explicitlyFresherWorded = /\bfresher|graduate\b/i.test(t);
  const looksLikeARole = ROLE_WORDS.some((w) => t.includes(w));
  if (!explicitlyFresherWorded && !looksLikeARole) return false;

  return true;
}

function slugId(org, title) {
  const raw = `${org}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return raw.slice(0, 60);
}

async function scrapeCompany(browser, company) {
  // Respect robots.txt before doing anything else. If the site disallows
  // us, or we can't confirm it allows us, we skip it entirely — no
  // exceptions, regardless of how useful that source would be.
  const robotsResult = await checkUrl(company.url);
  if (!robotsResult.allowed) {
    return { found: [], skipped: true, reason: robotsResult.reason };
  }
  if (robotsResult.crawlDelayMs) {
    await new Promise((r) => setTimeout(r, robotsResult.crawlDelayMs));
  }

  const page = await browser.newPage({ userAgent: `${USER_AGENT}/1.0 (personal aggregator; contact: set-your-email-here)` });
  const found = [];
  try {
    await page.goto(company.url, { timeout: REQUEST_TIMEOUT_MS, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500); // let client-side rendering settle

    // Pull every visible link's text + href as a candidate posting
    const links = await page.$$eval("a", (as) =>
      as.map((a) => ({ text: (a.innerText || a.textContent || "").trim(), href: a.href }))
        .filter((x) => x.text && x.text.length > 4 && x.text.length < 120)
    );

    const seen = new Set();
    for (const link of links) {
      if (!isFresherRelevant(link.text)) continue;
      if (seen.has(link.text)) continue;
      seen.add(link.text);
      found.push({
        id: slugId(company.name, link.text),
        sector: company.sector,
        org: company.name,
        title: link.text,
        location: "See official listing",
        batch: "See official listing",
        salary: "See official listing",
        lastDate: "See official listing",
        vacancies: "See official listing",
        posted: new Date().toISOString().slice(0, 10),
        isNew: true,
        applyUrl: link.href || company.url,
        about: generateAbout(company.name, link.text, company.sector),
        eligibility: generateEligibility(company.sector),
        prep: generatePrep(company.sector, link.text),
        confidence: "auto", // flagged so the site/you can tell this wasn't hand-curated
      });
      if (found.length >= MAX_LINKS_PER_SITE) break;
    }
  } catch (err) {
    console.warn(`[skip] ${company.name}: ${err.message}`);
  } finally {
    await page.close();
  }
  return { found, skipped: false };
}

async function main() {
  const companies = loadCompanies();
  const browser = await chromium.launch();
  const allJobs = [];
  const errors = [];
  const robotsSkipped = [];

  for (const company of companies) {
    console.log(`Scanning ${company.name}...`);
    try {
      const result = await scrapeCompany(browser, company);
      if (result.skipped) {
        console.log(`  skipped — ${result.reason}`);
        robotsSkipped.push({ company: company.name, url: company.url, reason: result.reason });
        continue;
      }
      allJobs.push(...result.found);
      console.log(`  found ${result.found.length} candidate posting(s)`);
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  }

  await browser.close();

  // Split into "published" (site shows these) vs "review" (kept aside,
  // e.g. if you later add stricter confidence rules). For now everything
  // that matched the keyword filter is published — tune FRESHER_KEYWORDS /
  // EXCLUDE_KEYWORDS in this file over time as you see false positives.
  fs.mkdirSync(path.dirname(JOBS_OUT_PATH), { recursive: true });
  fs.writeFileSync(JOBS_OUT_PATH, JSON.stringify(allJobs, null, 2));
  fs.writeFileSync(REVIEW_OUT_PATH, JSON.stringify({ loadErrors: errors, robotsSkipped }, null, 2));
  fs.writeFileSync(
    META_OUT_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        totalJobs: allJobs.length,
        sitesWithErrors: errors.length,
        sitesSkippedByRobots: robotsSkipped.length,
      },
      null,
      2
    )
  );

  console.log(`\nDone. ${allJobs.length} postings written to data/jobs.json.`);
  if (errors.length) console.log(`${errors.length} site(s) failed to load — see data/jobs-review.json.`);
  if (robotsSkipped.length) console.log(`${robotsSkipped.length} site(s) skipped due to robots.txt rules — see data/jobs-review.json.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
