import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { checkUrl, USER_AGENT } from './robots-check.js';
import { enrichJobWithAI } from './generate-content.js';
import { renderJobPage } from './templates.js';

// Top verified tech employers and startups hiring engineering, analyst, and support talent in India
const ATS_SOURCES = [
  // Lever Boards
  { name: 'Paytm', ats: 'lever', slug: 'paytm', homepage: 'https://paytm.com' },
  { name: 'Meesho', ats: 'lever', slug: 'meesho', homepage: 'https://meesho.com' },
  { name: 'CRED', ats: 'lever', slug: 'cred', homepage: 'https://cred.club' },
  { name: 'Fi Money', ats: 'lever', slug: 'fi', homepage: 'https://fi.money' },
  { name: 'Zeta', ats: 'lever', slug: 'zeta', homepage: 'https://zeta.tech' },
  { name: 'CoinMarketCap', ats: 'lever', slug: 'coinmarketcap', homepage: 'https://coinmarketcap.com' },

  // Greenhouse Boards
  { name: 'Postman', ats: 'greenhouse', slug: 'postman', homepage: 'https://postman.com' },
  { name: 'Razorpay', ats: 'greenhouse', slug: 'razorpaysoftwareprivatelimited', homepage: 'https://razorpay.com' },
  { name: 'InMobi', ats: 'greenhouse', slug: 'inmobi', homepage: 'https://inmobi.com' },
  { name: 'Glance', ats: 'greenhouse', slug: 'glance', homepage: 'https://glance.com' },
  { name: 'Groww', ats: 'greenhouse', slug: 'groww', homepage: 'https://groww.in' },
  { name: 'Slice', ats: 'greenhouse', slug: 'slice', homepage: 'https://sliceit.com' },
  { name: 'Stage', ats: 'greenhouse', slug: 'stage', homepage: 'https://stage.in' }
];

// Govt & PSU portals for Indian graduates
const GOVT_SOURCES = [
  {
    id: "ssc-cgl-chsl",
    sector: "govt",
    org: "Staff Selection Commission (SSC)",
    title: "Combined Graduate & Higher Secondary Level Exam",
    location: "All India",
    batch: "2023–2026 Graduates",
    salary: "₹25,500 – ₹81,100 (7th CPC)",
    lastDate: "Ongoing / Updated Monthly",
    vacancies: "~14,000+ Posts",
    applyUrl: "https://ssc.gov.in",
    about: "The Staff Selection Commission conducts nationwide recruitment for Group B and C technical and administrative positions across central ministries, IT wings, and departments. Open to fresh graduates across all streams.",
    eligibility: "Any degree (B.E., B.Tech, B.Sc, BCA, B.Com, B.A.) from a recognized university. Age 18–27/30 years with standard category relaxations. Selection through Computer Based Examinations."
  },
  {
    id: "nic-scientist-tech",
    sector: "govt",
    org: "National Informatics Centre (NIC)",
    title: "Scientist-B / Scientific Technical Assistant (IT & Systems)",
    location: "New Delhi & State Centres",
    batch: "2024–2026 Batches",
    salary: "Level 10 (₹56,100 – ₹1,77,500)",
    lastDate: "See Official Circular",
    vacancies: "Multiple Openings",
    applyUrl: "https://www.nic.in",
    about: "National Informatics Centre (NIC) is the premier science & technology organisation of the Government of India in informatics and IT-led governance solutions.",
    eligibility: "B.E. / B.Tech in Computer Science, Information Technology, Electronics, or MCA. Selection via written technical examination followed by interview."
  },
  {
    id: "ibps-it-officer",
    sector: "govt",
    org: "Institute of Banking Personnel Selection (IBPS)",
    title: "IT Specialist Officer (Scale I) — Public Sector Banks",
    location: "Pan-India",
    batch: "2023–2026 Batches",
    salary: "₹48,480 – ₹85,920 + Allowances",
    lastDate: "Annual National Drive",
    vacancies: "~700+ Posts",
    applyUrl: "https://www.ibps.in",
    about: "IBPS conducts common recruitment for IT Officers across major nationalized banks. Responsibilities include core banking network infrastructure, DBMS administration, and cyber security management.",
    eligibility: "Engineering degree in Computer Science, IT, Computer Applications, Electronics or MCA. Freshers eligible with no prior banking experience required."
  },
  {
    id: "rrb-je-it",
    sector: "govt",
    org: "Railway Recruitment Board (RRB)",
    title: "Junior Engineer (Information Technology)",
    location: "Zone-wise, All India",
    batch: "2023–2026 Batches",
    salary: "Level 6 (₹35,400 – ₹1,12,400)",
    lastDate: "See Regional RRB Notice",
    vacancies: "~350+ Posts",
    applyUrl: "https://www.rrbcdg.gov.in",
    about: "Indian Railways recruits Junior Engineers (IT) for railway digital passenger reservation software, rolling-stock IoT systems, and zonal communication networks.",
    eligibility: "Diploma or B.E./B.Tech in Computer Science, IT, BCA, or DOEACC 'B' level. Selection through Computer-Based Tests (CBT-1 & CBT-2)."
  }
];

// India location matching
function isIndiaLocation(locationStr) {
  if (!locationStr) return true; // Many remote or unspecified postings are open to India
  const loc = locationStr.toLowerCase();
  const indiaKeywords = [
    'india', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'gurgaon', 'gurugram',
    'noida', 'delhi', 'mumbai', 'chennai', 'kolkata', 'remote', 'ahmedabad', 'remote - india'
  ];
  return indiaKeywords.some(k => loc.includes(k));
}

// Fresher role heuristics
function isFresherEligible(title) {
  const t = title.toLowerCase();

  // Exclude senior / executive / manager roles
  const excludeWords = [
    'vice president', 'director', 'manager', 'head', 'lead', 'staff',
    'senior', 'sr.', 'principal', 'architect', 'specialist iii', 'ii '
  ];
  if (excludeWords.some(w => t.includes(w))) return false;

  // Positive fresher keywords
  const fresherWords = [
    'fresher', 'graduate', 'intern', 'trainee', 'analyst', 'associate',
    'junior', 'entry', 'sde 1', 'sde-1', 'sde i', 'engineer 1', 'engineer i',
    'qa engineer', 'software engineer', 'developer', 'operations', 'support',
    'specialist', 'apprentice', 'fellow', 'consultant'
  ];
  return fresherWords.some(w => t.includes(w));
}

// Fetch all jobs across configured ATS endpoints
async function fetchAtsJobs() {
  const jobs = [];

  for (const src of ATS_SOURCES) {
    try {
      // 1. Check robots.txt permissions
      const robotsCheck = await checkUrl(src.homepage);
      if (!robotsCheck.allowed) {
        console.log(`[Robots.txt Skip] ${src.name}: ${robotsCheck.reason}`);
        continue;
      }
      if (robotsCheck.crawlDelayMs) {
        await new Promise(r => setTimeout(r, Math.min(robotsCheck.crawlDelayMs, 1000)));
      }

      console.log(`[Scanning ATS] Fetching ${src.name} (${src.ats})...`);

      if (src.ats === 'greenhouse') {
        const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${src.slug}/jobs?content=true`, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 10000
        });
        if (res.ok) {
          const data = await res.json();
          const items = data.jobs || [];
          for (const j of items) {
            const locName = j.location?.name || 'India';
            if (isIndiaLocation(locName) && isFresherEligible(j.title)) {
              jobs.push({
                title: j.title.trim(),
                company: src.name,
                location: locName.trim(),
                applyUrl: j.absolute_url,
                description: j.content || j.title,
                sector: 'private'
              });
            }
          }
        }
      } else if (src.ats === 'lever') {
        const res = await fetch(`https://api.lever.co/v0/postings/${src.slug}?mode=json`, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 10000
        });
        if (res.ok) {
          const items = await res.json();
          if (Array.isArray(items)) {
            for (const j of items) {
              const locName = j.categories?.location || 'India';
              if (isIndiaLocation(locName) && isFresherEligible(j.text)) {
                jobs.push({
                  title: j.text.trim(),
                  company: src.name,
                  location: locName.trim(),
                  applyUrl: j.hostedUrl,
                  description: j.descriptionPlain || j.text,
                  sector: 'private'
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[Error] Failed scanning ${src.name}:`, err.message);
    }
  }

  return jobs;
}

function makeSlug(company, title) {
  const str = `${company}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return str.slice(0, 65);
}

async function run() {
  console.log('=== Starting FresherHub Multi-Source Job Automation ===\n');

  // Step 1: Fetch fresh ATS listings
  const rawAtsJobs = await fetchAtsJobs();
  console.log(`\nFound ${rawAtsJobs.length} active fresher-eligible openings across ATS feeds.`);

  // Step 2: Ensure destination folders exist
  const docsJobsDir = path.resolve('../docs/jobs');
  const dataDir = path.resolve('../data');
  if (!fs.existsSync(docsJobsDir)) fs.mkdirSync(docsJobsDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const finalJobFeed = [];

  // Step 3: Enrich and generate static pages for ATS jobs
  for (const job of rawAtsJobs) {
    console.log(`Enriching: ${job.company} — ${job.title}`);
    const aiData = await enrichJobWithAI(job);

    const slugName = makeSlug(job.company, job.title);
    const fileName = `${slugName}.html`;

    const jobWithSlug = { ...job, slug: fileName };
    const htmlPage = renderJobPage(jobWithSlug, aiData);

    fs.writeFileSync(path.join(docsJobsDir, fileName), htmlPage, 'utf8');

    finalJobFeed.push({
      id: slugName,
      sector: 'private',
      org: job.company,
      title: job.title,
      location: job.location,
      batch: aiData.eligibleBatch,
      salary: aiData.salaryRange,
      posted: 'Today',
      isNew: true,
      lastDate: 'Accepting Applications',
      vacancies: aiData.vacancies || 'Multiple',
      applyUrl: job.applyUrl,
      slug: `/docs/jobs/${fileName}`,
      about: aiData.roleSummary,
      eligibility: `Open to graduates in relevant streams (${aiData.eligibleBatch}). Hands-on skills in ${aiData.techStack.slice(0, 3).join(', ')} preferred.`,
      prep: [
        { t: "Aptitude & Reasoning Focus", items: aiData.aptitudeTopics },
        { t: "Technical Assessment & Coding", items: aiData.codingTopics },
        { t: "Interview Strategy", items: aiData.interviewTips }
      ]
    });

    // Small respectful pause between AI calls
    await new Promise(r => setTimeout(r, 600));
  }

  // Step 4: Add verified Govt & PSU listings
  for (const g of GOVT_SOURCES) {
    finalJobFeed.push({
      ...g,
      posted: 'Active Cycle',
      isNew: false,
      prep: [
        {
          t: "Syllabus & Quantitative Focus",
          items: [
            "Arithmetic, Algebra, Number Systems, Data Interpretation",
            "General Intelligence & Logical Reasoning (Verbal and Non-verbal)"
          ]
        },
        {
          t: "General Awareness & Technical",
          items: [
            "Current Affairs (last 6-8 months), Indian Polity, Economy basics",
            "Core domain computer science / engineering topics for technical posts"
          ]
        },
        {
          t: "Official Guidelines & Previous Papers",
          items: [
            `Download official notifications and previous papers from ${g.applyUrl}`,
            "Practice online mock tests adhering strictly to examination time limits"
          ]
        }
      ]
    });
  }

  // Step 5: Save synchronized master data/jobs.json
  const jobsJsonPath = path.join(dataDir, 'jobs.json');
  fs.writeFileSync(jobsJsonPath, JSON.stringify(finalJobFeed, null, 2), 'utf8');

  // Step 6: Save metadata for homepage status badge
  const metaJsonPath = path.join(dataDir, 'jobs-meta.json');
  fs.writeFileSync(metaJsonPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    totalJobs: finalJobFeed.length,
    privateCount: rawAtsJobs.length,
    govtCount: GOVT_SOURCES.length,
    status: 'healthy'
  }, null, 2), 'utf8');

  console.log(`\nAutomation Complete!`);
  console.log(`- ${finalJobFeed.length} total jobs written to data/jobs.json`);
  console.log(`- ${rawAtsJobs.length} static SEO pages generated in docs/jobs/`);
  console.log(`- data/jobs-meta.json updated.`);
}

run();

