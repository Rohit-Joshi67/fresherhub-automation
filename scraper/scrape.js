import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { enrichJobWithAI } from './generate-content.js';
import { renderJobPage } from './templates.js';

const COMPANIES = [
  { name: 'Razorpay', ats: 'greenhouse', slug: 'razorpay' },
  { name: 'Swiggy', ats: 'greenhouse', slug: 'swiggy' },
  { name: 'Meesho', ats: 'lever', slug: 'meesho' }
];

async function fetchJobs() {
  const jobs = [];

  for (const comp of COMPANIES) {
    try {
      if (comp.ats === 'greenhouse') {
        const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${comp.slug}/jobs?content=true`);
        if (res.ok) {
          const data = await res.json();
          data.jobs.slice(0, 3).forEach(j => {
            jobs.push({
              title: j.title,
              company: comp.name,
              location: j.location?.name || 'India',
              applyUrl: j.absolute_url,
              description: j.content || j.title
            });
          });
        }
      } else if (comp.ats === 'lever') {
        const res = await fetch(`https://api.lever.co/v0/postings/${comp.slug}?mode=json`);
        if (res.ok) {
          const data = await res.json();
          data.slice(0, 3).forEach(j => {
            jobs.push({
              title: j.text,
              company: comp.name,
              location: j.categories?.location || 'India',
              applyUrl: j.hostedUrl,
              description: j.descriptionPlain || j.text
            });
          });
        }
      }
    } catch (e) {
      console.error(`Error fetching ${comp.name}:`, e.message);
    }
  }
  return jobs;
}

async function run() {
  const jobs = await fetchJobs();
  const docsDir = path.resolve('../docs/jobs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  const generatedMeta = [];

  for (const job of jobs) {
    console.log(`Processing: ${job.company} - ${job.title}`);
    const aiData = await enrichJobWithAI(job);
    if (!aiData) continue;

    const fileSlug = `${job.company.toLowerCase()}-${job.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.html`;
    const htmlContent = renderJobPage(job, aiData);

    fs.writeFileSync(path.join(docsDir, fileSlug), htmlContent);

    generatedMeta.push({
      title: job.title,
      company: job.company,
      location: job.location,
      slug: `/jobs/${fileSlug}`,
      eligibleBatch: aiData.eligibleBatch,
      salary: aiData.salaryRange
    });

    // 4-second delay to comfortably respect the Gemini free RPM limit
    await new Promise(r => setTimeout(r, 4000));
  }

  fs.writeFileSync(path.resolve('../data/jobs.json'), JSON.stringify(generatedMeta, null, 2));
  console.log(`Successfully generated ${generatedMeta.length} enriched pages.`);
}

run();
