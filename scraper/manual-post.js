import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { enrichJobWithAI, generateHeuristicEnrichment } from './generate-content.js';
import { renderJobPage } from './templates.js';

function makeSlug(company, title) {
  return `${company}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
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

  const company = jobInput.company || 'TechCorp';
  const title = jobInput.title || 'Graduate Software Trainee';
  const location = jobInput.location || 'Bengaluru / Pan-India';
  const sector = (jobInput.sector || 'private').toLowerCase();
  const applyUrl = jobInput.applyUrl || 'https://careers.example.com';
  const customDescription = jobInput.description || '';
  const batchHint = jobInput.batch || '2024, 2025 & 2026 Graduates';
  const salaryHint = jobInput.salary || '₹5.5 – ₹10.0 LPA (Fresher Band)';

  console.log(`\n⚙️  Processing manual job: ${company} — ${title}`);

  const rawJob = {
    company,
    title,
    location,
    description: customDescription || `${company} is looking for ${title} in ${location}. Eligible batch: ${batchHint}. Expected salary: ${salaryHint}.`,
    applyUrl
  };

  // Generate enriched content via AI or heuristic fallback
  console.log('🤖 Generating AI preparation guide and structured metadata...');
  let aiData;
  try {
    aiData = await enrichJobWithAI(rawJob);
  } catch (err) {
    console.warn('AI call failed, using heuristic engine:', err.message);
    aiData = generateHeuristicEnrichment(rawJob);
  }

  // Override with user provided details if specified
  if (jobInput.batch) aiData.eligibleBatch = jobInput.batch;
  if (jobInput.salary) aiData.salaryRange = jobInput.salary;

  const slugName = makeSlug(company, title);
  const fileName = `${slugName}.html`;
  const jobWithSlug = { ...rawJob, slug: fileName };

  // Render static HTML file
  const htmlPage = renderJobPage(jobWithSlug, aiData);
  const htmlFilePath = path.join(docsJobsDir, fileName);
  fs.writeFileSync(htmlFilePath, htmlPage, 'utf8');
  console.log(`✅ SEO Job page generated: docs/jobs/${fileName}`);

  // Construct job entry for data/jobs.json
  const now = new Date();
  const newJobEntry = {
    id: slugName,
    sector: sector === 'govt' ? 'govt' : 'private',
    org: company,
    title: title,
    location: location,
    batch: aiData.eligibleBatch,
    salary: aiData.salaryRange,
    posted: 'Just Now',
    postedAt: now.toISOString(),
    isNew: true,
    lastDate: jobInput.lastDate || 'Accepting Applications',
    vacancies: aiData.vacancies || 'Multiple Openings',
    applyUrl: applyUrl,
    slug: `/docs/jobs/${fileName}`,
    about: aiData.roleSummary,
    eligibility: `Open to graduates in relevant streams (${aiData.eligibleBatch}). Hands-on skills in ${(aiData.techStack || ['CS Fundamentals']).slice(0, 3).join(', ')} preferred.`,
    prep: [
      { t: "Aptitude & Reasoning Focus", items: aiData.aptitudeTopics },
      { t: "Technical Assessment & Coding", items: aiData.codingTopics },
      { t: "Interview Strategy", items: aiData.interviewTips }
    ]
  };

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

  // If parameters passed via CLI, use them directly
  if (cliArgs.company && cliArgs.title) {
    await createManualJob({
      company: cliArgs.company,
      title: cliArgs.title,
      location: cliArgs.location,
      sector: cliArgs.sector,
      batch: cliArgs.batch,
      salary: cliArgs.salary,
      applyUrl: cliArgs.apply,
      description: cliArgs.description,
      lastDate: cliArgs.lastDate
    });
    return;
  }

  // Otherwise prompt interactively
  console.log('==============================================');
  console.log('   FresherHub — Manual Job Listing Publisher   ');
  console.log('==============================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
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

    const location = await ask(rl, 'Location (City / State / Remote)', 'Pan-India');
    const sector = await ask(rl, 'Sector (private / govt)', 'private');
    const batch = await ask(rl, 'Eligible Passing Year / Batch', '2024, 2025 & 2026 Graduates');
    const salary = await ask(rl, 'Salary / Package', '₹4.5 – ₹8.0 LPA');
    const applyUrl = await ask(rl, 'Official Application / Careers URL');
    const lastDate = await ask(rl, 'Last Date to Apply', 'Accepting Applications');
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
