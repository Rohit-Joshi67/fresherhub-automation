import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { extractJobFromText } from './generate-content.js';
import { processJobPosting, makeSlug, toLegacyEnrichment, toFeedEntry } from './content-engine.js';
import { renderJobPage } from './templates.js';

/** A manual job is public only when verifiable and clean — same bar as the scraper. */
function isPublishable(spec) {
  // NOTE: operator-submitted postings have verification.status 'unknown'
  // (freshness cannot be independently confirmed), so they quarantine for
  // human review by design — same as the automated scrape.
  return !spec.quality_checks.needs_human_review
    && spec.verification.status === 'active'
    && spec.verification.entry_level_category !== 'experienced'
    && !!spec.source.official_application_url;
}

/** Load previously seen duplicate keys (shared with scrape.js). */
function loadKnownKeys(dataDir) {
  const keysPath = path.join(dataDir, 'content-keys.json');
  const keys = new Set();
  try {
    if (fs.existsSync(keysPath)) {
      for (const k of JSON.parse(fs.readFileSync(keysPath, 'utf8'))) keys.add(k);
    }
  } catch { /* start fresh */ }
  return keys;
}

function readJsonArray(p) {
  try {
    if (fs.existsSync(p)) {
      const v = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Array.isArray(v) ? v : [];
    }
  } catch { /* ignore */ }
  return [];
}

/** Append the full spec payload, instagram post, and review flag to the data files. */
function appendEngineOutputs(dataDir, slugName, page, spec, { publishable }) {
  const payloads = readJsonArray(path.join(dataDir, 'content-engine.json'));
  const igQueue = readJsonArray(path.join(dataDir, 'instagram-queue.json'));
  const reviews = readJsonArray(path.join(dataDir, 'review-queue.json'));

  const dropSlug = (arr) => arr.filter((e) => e.page !== page && e.slug !== page);

  if (publishable) {
    const cleanPayloads = dropSlug(payloads);
    cleanPayloads.unshift({ page, slug: slugName, ...spec });
    fs.writeFileSync(path.join(dataDir, 'content-engine.json'), JSON.stringify(cleanPayloads, null, 2), 'utf8');

    const cleanIg = dropSlug(igQueue);
    cleanIg.unshift({
      page, slug: slugName,
      company: spec.job.company, title: spec.job.title,
      apply_url: spec.source.official_application_url,
      ...spec.instagram
    });
    fs.writeFileSync(path.join(dataDir, 'instagram-queue.json'), JSON.stringify(cleanIg, null, 2), 'utf8');

    // Mark as queued so the automated scraper never re-queues this slug
    const sentPath = path.join(dataDir, 'instagram-sent.json');
    let sent = {};
    try { sent = JSON.parse(fs.readFileSync(sentPath, 'utf8')); } catch { /* fresh */ }
    sent[slugName] = new Date().toISOString();
    fs.writeFileSync(sentPath, JSON.stringify(sent, null, 2), 'utf8');
  }

  if (spec.quality_checks.needs_human_review) {
    const cleanReviews = dropSlug(reviews);
    cleanReviews.unshift({
      page, slug: slugName,
      company: spec.job.company, title: spec.job.title,
      category: spec.verification.entry_level_category,
      status: spec.verification.status,
      confidence: spec.verification.confidence,
      review_reason: spec.quality_checks.review_reason
    });
    fs.writeFileSync(path.join(dataDir, 'review-queue.json'), JSON.stringify(cleanReviews, null, 2), 'utf8');
  }

  // Persist the new duplicate key
  const keysPath = path.join(dataDir, 'content-keys.json');
  const keys = new Set(readJsonArray(keysPath));
  keys.add(spec.verification.duplicate_key);
  fs.writeFileSync(keysPath, JSON.stringify([...keys], null, 2), 'utf8');
}

function ask(rl, query, defaultValue = '') {
  return new Promise(resolve => {
    const prompt = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

// Check if running with arguments e.g.
// node manual-post.js --company "Google" --title "Software Engineer" --location "Bangalore" --batch "2024, 2025" --salary "18 LPA" --apply "https://careers.google.com" --sector "private"
function parseCliArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      params[key] = val;
    }
  }
  return params;
}

export async function createManualJob(jobInput = {}) {
  const docsJobsDir = path.resolve('../docs/jobs');
  const dataDir = path.resolve('../data');
  if (!fs.existsSync(docsJobsDir)) fs.mkdirSync(docsJobsDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const company = (jobInput.company || '').trim();
  const title = (jobInput.title || '').trim();
  if (!company || !title) {
    throw new Error('Manual post requires both company and title — refusing to invent them.');
  }
  const location = (jobInput.location || '').trim();
  const sector = (jobInput.sector || 'private').toLowerCase();
  const applyUrl = (jobInput.applyUrl || '').trim();
  const customDescription = jobInput.description || '';
  const batchHint = (jobInput.batch || '').trim();
  const salaryHint = (jobInput.salary || '').trim();

  console.log(`\n⚙️  Processing manual job: ${company} — ${title}`);

  // NOTE: batch/salary hints are operator-supplied facts, never generated.
  // Anything not supplied stays "Not specified" — the engine never invents it.
  // publishedDate is left empty: an operator submission is freshness 'unknown'
  // until independently verified against the source.
  const rawJob = {
    company,
    title,
    location,
    description: customDescription
      || [batchHint && `Eligible batch: ${batchHint}.`, salaryHint && `Salary: ${salaryHint}.`].filter(Boolean).join(' ')
      || `${company} is hiring for ${title}.`,
    applyUrl,
    sourceUrl: applyUrl,
    sourceName: 'Manual post (operator submitted)',
    companyUrl: '',
    sector,
    userSupplied: true,
    userSalary: salaryHint || undefined,
    publishedDate: ''
  };

  // Run the full content engine: verification, classification, rewrite, instagram, quality flags
  console.log('🤖 Running content engine (verification + rewrite + instagram)...');
  const spec = await processJobPosting(rawJob, { runKeys: new Set(), publishedKeys: loadKnownKeys(dataDir) });
  const aiData = toLegacyEnrichment(spec);

  if (spec.verification.reverified) {
    console.log('⚠️  This looks like a duplicate of an already-published listing — flagged for review.');
  }

  const slugName = makeSlug(company, title);
  const fileName = `${slugName}.html`;
  const page = `/docs/jobs/${fileName}`;
  const publishable = isPublishable(spec);

  if (!publishable) {
    console.log('\n⛔ Quarantined — NOT published to the site.');
    console.log(`   Reasons: ${spec.quality_checks.review_reason || 'did not meet the publication bar'}`);
    console.log('   The listing was saved to data/review-queue.json for human review.');
    console.log('   Fix the issues (e.g. add the official application URL) and re-submit.\n');
    appendEngineOutputs(dataDir, slugName, page, spec, { publishable: false });
    return { quarantined: true, spec };
  }

  const pageJob = {
    ...toFeedEntry(spec, {
      id: slugName,
      sector: sector === 'govt' ? 'govt' : 'private',
      slug: `/docs/jobs/${fileName}`,
      posted: 'Just Now',
      isNew: true,
      batch: batchHint || aiData.eligibleBatch,
      salary: salaryHint || aiData.salaryRange
    }),
    slug: fileName,
    postedLabel: 'Just Now',
    lastDateLabel: jobInput.lastDate || spec.job.closing_date || 'Not specified',
    publishedDate: ''
  };

  // Render static HTML file
  const htmlPage = renderJobPage(pageJob, aiData, spec);
  const htmlFilePath = path.join(docsJobsDir, fileName);
  fs.writeFileSync(htmlFilePath, htmlPage, 'utf8');
  console.log(`✅ SEO Job page generated: docs/jobs/${fileName}`);

  // Construct job entry for data/jobs.json
  const now = new Date();
  const newJobEntry = { ...pageJob, slug: `/docs/jobs/${fileName}`, postedAt: now.toISOString() };

  // Record in the published registry so the automated scraper tracks it
  // (stable "posted" label + stale pruning after 45 days without re-verification)
  const publishedPath = path.join(dataDir, 'published.json');
  let published = {};
  try { published = JSON.parse(fs.readFileSync(publishedPath, 'utf8')); } catch { /* fresh */ }
  published[slugName] = published[slugName] || { firstSeen: now.toISOString(), company, title };
  published[slugName].lastSeen = now.toISOString();
  fs.writeFileSync(publishedPath, JSON.stringify(published, null, 2), 'utf8');

  // Append the full spec payload + instagram + review flag alongside the feed
  appendEngineOutputs(dataDir, slugName, page, spec, { publishable: true });

  // Load existing data/jobs.json
  const jobsJsonPath = path.join(dataDir, 'jobs.json');
  let jobs = [];
  if (fs.existsSync(jobsJsonPath)) {
    try {
      jobs = JSON.parse(fs.readFileSync(jobsJsonPath, 'utf8'));
    } catch (e) {
      jobs = [];
    }
  }

  // Remove existing job with same id if any, then prepend new job to top
  jobs = jobs.filter(j => j.id !== slugName);
  jobs.unshift(newJobEntry);

  fs.writeFileSync(jobsJsonPath, JSON.stringify(jobs, null, 2), 'utf8');
  console.log(`✅ Prepended to data/jobs.json (Total jobs: ${jobs.length})`);

  // Update data/jobs-meta.json
  const metaJsonPath = path.join(dataDir, 'jobs-meta.json');
  const privateCount = jobs.filter(j => j.sector === 'private').length;
  const govtCount = jobs.filter(j => j.sector === 'govt').length;

  fs.writeFileSync(metaJsonPath, JSON.stringify({
    updatedAt: now.toISOString(),
    totalJobs: jobs.length,
    privateCount,
    govtCount,
    status: 'healthy'
  }, null, 2), 'utf8');
  console.log(`✅ Updated data/jobs-meta.json`);

  console.log(`\n🎉 Job successfully posted!`);
  console.log(`📌 Title: ${title}`);
  console.log(`🏢 Company: ${company}`);
  console.log(`📍 Location: ${location}`);
  console.log(`💰 Package: ${aiData.salaryRange}`);
  console.log(`🔗 Local link: /docs/jobs/${fileName}`);
  console.log(`🌐 Live URL: https://freshersjobopening.online/docs/jobs/${fileName}\n`);

  return newJobEntry;
}

// Interactive CLI runner if run directly
async function main() {
  const cliArgs = parseCliArgs();

  // If raw text or reel transcript is passed via CLI flag:
  // e.g. node manual-post.js --text "Paytm is hiring Software Engineers for Noida..."
  // or node manual-post.js --reel "Amazon fresher hiring 2024 2025 batch 12 LPA"
  const rawText = cliArgs.text || cliArgs.reel || cliArgs.transcript;
  if (rawText) {
    console.log('\n📝 Analyzing raw text / reel transcript with AI...');
    let parsedFromText;
    try {
      parsedFromText = await extractJobFromText(rawText);
    } catch (e) {
      console.error(`\n❌ ${e.message}`);
      console.error('Tip: pass --company and --title explicitly when the transcript does not name them.\n');
      process.exit(1);
    }
    // --apply may arrive as boolean `true` when passed an empty value; only
    // accept a real string URL.
    if (typeof cliArgs.apply === 'string' && cliArgs.apply) parsedFromText.applyUrl = cliArgs.apply;
    if (cliArgs.company) parsedFromText.company = cliArgs.company;
    if (cliArgs.title) parsedFromText.title = cliArgs.title;
    if (cliArgs.location) parsedFromText.location = cliArgs.location;
    const result = await createManualJob(parsedFromText);
    if (result && result.quarantined) process.exit(2);
    return;
  }

  // If parameters passed via structured CLI flags
  if (cliArgs.company && cliArgs.title) {
    const result = await createManualJob({
      company: cliArgs.company,
      title: cliArgs.title,
      location: cliArgs.location,
      sector: cliArgs.sector,
      batch: cliArgs.batch,
      salary: cliArgs.salary,
      applyUrl: typeof cliArgs.apply === 'string' ? cliArgs.apply : '',
      description: cliArgs.description,
      lastDate: cliArgs.lastDate
    });
    if (result && result.quarantined) process.exit(2);
    return;
  }

  // Otherwise prompt interactively
  console.log('==============================================');
  console.log('   FresherHub — Manual Job Listing Publisher   ');
  console.log('==============================================\n');
  console.log('Options:');
  console.log('1. Paste Reel Transcript / Unstructured Text (AI extracts everything)');
  console.log('2. Enter Job Details Field-by-Field\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const choice = await ask(rl, 'Choose Mode (1 or 2)', '1');

    if (choice === '1') {
      console.log('\nPaste your reel transcript or text below (press Enter then Ctrl+D / send input):');
      const text = await ask(rl, 'Transcript / Text');
      const applyUrl = await ask(rl, 'Official Application URL (optional, leave blank if unknown)', '');
      rl.close();

      console.log('\n🤖 AI is parsing your text into job details...');
      let extracted;
      try {
        extracted = await extractJobFromText(text);
      } catch (e) {
        console.error(`\n❌ ${e.message}`);
        console.error('Tip: use mode 2 and enter the company and title manually.\n');
        return;
      }
      if (applyUrl) extracted.applyUrl = applyUrl;
      const result = await createManualJob(extracted);
      if (result && result.quarantined) console.log('(Exit: quarantined for human review.)');
      return;
    }

    const company = await ask(rl, 'Company / Organization Name');
    if (!company) {
      console.log('Company name is required. Exiting.');
      rl.close();
      return;
    }

    const title = await ask(rl, 'Job Role / Title');
    if (!title) {
      console.log('Job title is required. Exiting.');
      rl.close();
      return;
    }

    const location = await ask(rl, 'Location (City / State / Remote)', '');
    const sector = await ask(rl, 'Sector (private / govt)', 'private');
    const batch = await ask(rl, 'Eligible Passing Year / Batch (blank = not specified)', '');
    const salary = await ask(rl, 'Salary / Package (blank = not specified)', '');
    const applyUrl = await ask(rl, 'Official Application / Careers URL (blank = not specified)');
    const lastDate = await ask(rl, 'Last Date to Apply (blank = not specified)', '');
    const description = await ask(rl, 'Brief Description / Requirements (optional)');

    rl.close();

    await createManualJob({
      company,
      title,
      location,
      sector,
      batch,
      salary,
      applyUrl,
      lastDate,
      description
    });
  } catch (err) {
    rl.close();
    console.error('Error during manual post:', err);
  }
}

if (process.argv[1] && process.argv[1].endsWith('manual-post.js')) {
  main();
}
