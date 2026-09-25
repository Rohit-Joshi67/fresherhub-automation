import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  processJobPosting, makeDuplicateKey, makeSlug,
  toLegacyEnrichment, toFeedEntry
} from './content-engine.js';
import { SOURCES, fetchSourceJobs, sleep } from './sources.js';
import { checkUrl } from './robots-check.js';
import { renderJobPage } from './templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const jobsDir = path.join(__dirname, '..', 'docs', 'jobs');
const guidesDir = path.join(__dirname, '..', 'docs', 'guides');
const keysPath = path.join(dataDir, 'content-keys.json');
const publishedPath = path.join(dataDir, 'published.json');
const instagramSentPath = path.join(dataDir, 'instagram-sent.json');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(jobsDir, { recursive: true });

const STALE_PRUNE_DAYS = 45;

// ---------------------------------------------------------------------------
// Sector from title keywords (cosmetic grouping for the homepage; the engine
// does the real classification). Never a factual claim about the company.
// ---------------------------------------------------------------------------
function sectorFor(title) {
  const t = (title || '').toLowerCase();
  if (/engineer|developer|sde|software|cloud|devops|qa|sdet|data|analyst|ml|ai\b/.test(t)) return 'IT & Software';
  if (/design|ux|ui|product/.test(t)) return 'Design & Product';
  if (/marketing|sales|growth|seo|content/.test(t)) return 'Marketing & Sales';
  if (/finance|account|audit|bank/.test(t)) return 'BFSI & FinTech';
  if (/hr|human resource|recruit|talent/.test(t)) return 'HR & Operations';
  if (/support|operations|logistics|supply/.test(t)) return 'Operations';
  return 'Private';
}

function postedLabel(firstSeenIso) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(firstSeenIso).getTime()) / 86400000));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
  return String(firstSeenIso).split('T')[0];
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// A job is published to the public site only when it is verifiable and clean.
function isPublishable(spec) {
  // Publish only postings we have positive evidence are currently open.
  // 'unknown' (e.g. unverifiable application link, operator submissions) is
  // not enough — the posting stays quarantined until verified.
  return !spec.quality_checks.needs_human_review
    && spec.verification.status === 'active'
    && spec.verification.entry_level_category !== 'experienced'
    && !!spec.source.official_application_url;
}

async function run() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes('--verify-sources');
  const sourceFilter = (args.find((a) => a.startsWith('--source=')) || '').slice('--source='.length);

  // ---- Step 1: fetch raw jobs from every permitted source ----
  const rawJobs = [];
  const sourceStats = [];
  const sitesSkippedByRobots = [];
  const sitesWithErrors = [];

  const activeSources = SOURCES.filter(
    (src) => !sourceFilter || src.id === sourceFilter || src.kind === sourceFilter
  );

  // Bounded-concurrency pool: 400+ sources can't run one-by-one.
  // Per-source politeness is preserved (robots check + crawl-delay per source);
  // concurrency only overlaps independent sources.
  const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.SOURCE_CONCURRENCY) || 8));

  async function fetchOne(src) {
    // Documented public APIs (Ashby's public job-posting API, built for job
    // boards/feed partners) carry their own permission; robots.txt does not
    // meaningfully apply to the API host. Everything else is robots-gated.
    const robots = src.publicApi
      ? { allowed: true, crawlDelayMs: 0 }
      : await checkUrl(src.checkUrl);
    if (!robots.allowed) {
      console.warn(`[Robots] ${src.name} blocked/unverifiable (${robots.reason || 'disallowed'}) — skipping`);
      return { stat: { source: src.id, name: src.name, kind: src.kind, fetched: 0, skipped: 'robots' }, skippedName: src.name, jobs: [] };
    }
    if (robots.crawlDelayMs) await sleep(robots.crawlDelayMs);

    let jobs;
    try {
      jobs = await fetchSourceJobs(src);
    } catch (e) {
      console.warn(`[${src.name}] fetch failed: ${e.message}`);
      return { stat: { source: src.id, name: src.name, kind: src.kind, fetched: 0, error: String(e.message || e).slice(0, 160) }, errorName: src.name, jobs: [] };
    }
    // A source returning zero jobs is a legitimate empty result, not an error.
    return { stat: { source: src.id, name: src.name, kind: src.kind, fetched: jobs.length }, jobs: jobs.map((j) => ({ ...j, _sourceId: src.id, _sourceName: src.name })) };
  }

  let nextIdx = 0;
  async function poolWorker() {
    while (true) {
      const i = nextIdx++;
      if (i >= activeSources.length) return;
      const r = await fetchOne(activeSources[i]);
      rawJobs.push(...r.jobs);
      sourceStats.push(r.stat);
      if (r.skippedName) sitesSkippedByRobots.push(r.skippedName);
      if (r.errorName) sitesWithErrors.push(r.errorName);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, activeSources.length) }, () => poolWorker()));
  // Deterministic ordering for logs and tests.
  sourceStats.sort((a, b) => String(a.source).localeCompare(String(b.source)));

  if (verifyOnly) {
    console.log('\n== Source verification ==');
    for (const s of sourceStats) {
      console.log(`  ${s.name} [${s.kind}] -> ${s.fetched} candidate jobs${s.skipped ? ` (${s.skipped})` : ''}`);
    }
    console.log(`\nTotal candidate jobs: ${rawJobs.length}`);
    fs.writeFileSync(path.join(dataDir, 'source-check.json'), JSON.stringify({
      checkedAt: new Date().toISOString(),
      sources: sourceStats,
      totalCandidates: rawJobs.length,
      skippedByRobots: sitesSkippedByRobots,
      errors: sitesWithErrors
    }, null, 2), 'utf8');
    console.log('Wrote data/source-check.json');
    return;
  }

  // ---- Step 2: cross-source dedupe (URL-agnostic) ----
  const seenInRun = new Set();
  const uniqueJobs = [];
  let duplicateSkips = 0;
  for (const j of rawJobs) {
    const key = makeDuplicateKey(j.company, j.title, j.location, '');
    if (seenInRun.has(key)) { duplicateSkips++; continue; }
    seenInRun.add(key);
    uniqueJobs.push(j);
  }

  // ---- Step 3: published registry — stable first-seen dates, stale pruning ----
  const nowIso = new Date().toISOString();
  const published = loadJson(publishedPath, {});
  const liveSlugs = new Set();
  for (const j of uniqueJobs) {
    const slug = makeSlug(j.company, j.title);
    liveSlugs.add(slug);
    if (!published[slug]) published[slug] = { firstSeen: nowIso, company: j.company, title: j.title };
    published[slug].lastSeen = nowIso;
  }
  const prunedSlugs = [];
  for (const slug of Object.keys(published)) {
    const ageMs = Date.now() - new Date(published[slug].lastSeen).getTime();
    if (!liveSlugs.has(slug) && ageMs > STALE_PRUNE_DAYS * 86400000) {
      prunedSlugs.push(slug);
      const pagePath = path.join(jobsDir, `${slug}.html`);
      if (fs.existsSync(pagePath)) fs.unlinkSync(pagePath);
      delete published[slug];
    }
  }
  fs.writeFileSync(publishedPath, JSON.stringify(published, null, 2), 'utf8');

  // ---- Step 4: content engine + quarantine ----
  // runKeys: dedupes listings that appear twice within THIS run.
  // publishedKeys: keys published by earlier runs — seeing one again means
  // the listing is still live (re-verification), never a duplicate.
  const runKeys = new Set();
  const publishedKeys = new Set(loadJson(keysPath, []));
  const instagramSent = loadJson(instagramSentPath, {});
  const finalJobFeed = [];
  const contentPayloads = [];
  const instagramQueue = [];
  const reviewQueue = [];
  let publishedCount = 0;
  let quarantinedCount = 0;

  for (const job of uniqueJobs) {
    const spec = await processJobPosting(job, { runKeys, publishedKeys });
    const slugBase = makeSlug(job.company, job.title);
    const fileName = `${slugBase}.html`;
    const firstSeen = (published[slugBase] && published[slugBase].firstSeen) || nowIso;
    const posted = postedLabel(firstSeen);

    if (isPublishable(spec)) {
      const aiData = toLegacyEnrichment(spec);
      const feedEntry = toFeedEntry(spec, {
        id: slugBase,
        sector: sectorFor(job.title),
        slug: `/docs/jobs/${fileName}`,
        posted,
        isNew: (Date.now() - new Date(firstSeen).getTime()) < 7 * 86400000,
        batch: aiData.eligibleBatch,
        salary: aiData.salaryRange
      });

      // Static SEO page — job object carries honest labels for the template.
      // (Template builds its own /docs/jobs/<slug> paths, so it gets the bare filename.)
      const pageJob = {
        ...feedEntry,
        slug: fileName,
        postedLabel: posted,
        lastDateLabel: spec.job.closing_date || 'Not specified',
        publishedDate: spec.job.published_date || ''
      };
      // Role-specific prep guide link (guides are generated in Step 6; the
      // link appears from the next run for brand-new guides).
      if (fs.existsSync(path.join(guidesDir, `${slugBase}-interview-prep.html`))) {
        pageJob.guideUrl = `/guides/${slugBase}-interview-prep.html`;
      }
      const pageHtml = renderJobPage(pageJob, aiData, spec);
      fs.writeFileSync(path.join(jobsDir, fileName), pageHtml, 'utf8');

      finalJobFeed.push(feedEntry);
      contentPayloads.push({ page: `/docs/jobs/${fileName}`, ...spec });

      if (!instagramSent[slugBase]) {
        instagramQueue.push({
          page: `/docs/jobs/${fileName}`,
          company: spec.job.company,
          title: spec.job.title,
          apply_url: spec.source.official_application_url,
          ...spec.instagram
        });
        instagramSent[slugBase] = nowIso;
      }
      publishedCount++;
    } else {
      quarantinedCount++;
      reviewQueue.push({
        page: `/docs/jobs/${fileName}`,
        company: spec.job.company,
        title: spec.job.title,
        source: job._sourceName || spec.source.source_name,
        category: spec.verification.entry_level_category,
        status: spec.verification.status,
        confidence: spec.verification.confidence,
        review_reason: spec.quality_checks.review_reason
      });
    }

    await sleep(600); // pacing between Gemini calls
  }

  finalJobFeed.sort((a, b) => (b.isNew - a.isNew) || a.org.localeCompare(b.org));

  // ---- Step 5: write outputs ----
  fs.writeFileSync(path.join(dataDir, 'jobs.json'), JSON.stringify(finalJobFeed, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'jobs-meta.json'), JSON.stringify({
    updatedAt: nowIso,
    totalJobs: finalJobFeed.length,
    publishedCount,
    quarantinedCount,
    reviewCount: reviewQueue.length,
    privateCount: finalJobFeed.filter((j) => j.sector !== 'govt').length,
    govtCount: finalJobFeed.filter((j) => j.sector === 'govt').length,
    sourceCounts: sourceStats,
    sitesSkippedByRobots,
    sitesWithErrors,
    prunedPages: prunedSlugs.length,
    status: 'healthy'
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'content-engine.json'), JSON.stringify(contentPayloads, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'instagram-queue.json'), JSON.stringify(instagramQueue, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'review-queue.json'), JSON.stringify(reviewQueue, null, 2), 'utf8');
  fs.writeFileSync(keysPath, JSON.stringify([...new Set([...publishedKeys, ...runKeys])], null, 2), 'utf8');
  fs.writeFileSync(instagramSentPath, JSON.stringify(instagramSent, null, 2), 'utf8');

  // ---- Step 6: prep guides + instagram creatives (new items only) ----
  // Never fails the run: both modules skip quietly without an API key and
  // catch their own errors. Per-run caps keep the scheduled job bounded.
  const repoRoot = path.join(__dirname, '..');
  try {
    const { generateArticles } = await import('./generate-articles.js');
    const n = await generateArticles({ jobs: finalJobFeed, repoRoot, maxPerRun: 20 });
    console.log(`- ${n} new prep guides generated`);
  } catch (e) {
    console.warn('[guides] skipped:', e.message);
  }
  try {
    const { generatePhotos } = await import('./generate-photos.js');
    const n = await generatePhotos({ jobs: finalJobFeed, repoRoot, dataDir, maxPerRun: 10 });
    console.log(`- ${n} new instagram creatives generated`);
  } catch (e) {
    console.warn('[photos] skipped:', e.message);
  }
  // Stage the new output dirs. The scheduled workflow's commit step runs
  // `git add data/ docs/jobs/` and commits everything staged — its paths
  // can't be edited without the Workflows permission, so we stage the extra
  // dirs here. (Move this into the workflow when that permission lands.)
  try {
    execSync('git add docs/guides docs/instagram', { cwd: repoRoot, stdio: 'ignore' });
  } catch {}

  console.log(`\nAutomation Complete!`);
  console.log(`- ${rawJobs.length} candidate jobs fetched from ${sourceStats.length} sources`);
  console.log(`- ${duplicateSkips} cross-source duplicates skipped`);
  console.log(`- ${publishedCount} jobs published (pages + feed)`);
  console.log(`- ${quarantinedCount} jobs quarantined to review queue`);
  console.log(`- ${prunedSlugs.length} stale pages pruned`);
  console.log(`- ${instagramQueue.length} new instagram posts queued (${Object.keys(instagramSent).length} total tracked)`);
}

run().catch((e) => { console.error('Scraper failed:', e); process.exit(1); });
