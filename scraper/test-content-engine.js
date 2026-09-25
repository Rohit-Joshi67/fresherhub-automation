/** Test the content engine against the spec: no invention, correct schema, correct flags. */
import { processJobPosting } from './content-engine.js';

const SPEC_TOP = ['verification', 'source', 'job', 'website_content', 'instagram', 'quality_checks'];

const samples = [
  {
    name: 'fresher-with-facts',
    title: 'Software Development Engineer 1',
    company: 'Groww',
    location: 'Bengaluru, Karnataka',
    description: `We are hiring SDE 1 for our backend team in Bengaluru. You will build scalable APIs in Java and Spring Boot, write SQL queries, and collaborate with product managers. Requirements: B.E./B.Tech in Computer Science, 0-1 years of experience, strong DSA fundamentals. Salary: Rs. 12 LPA. Freshers with good problem solving are encouraged to apply.`,
    applyUrl: 'https://boards.greenhouse.io/groww/jobs/12345',
    sourceUrl: 'https://boards-api.greenhouse.io/v1/boards/groww/jobs?content=true',
    sourceName: 'Greenhouse ATS',
    companyUrl: 'https://groww.in',
    sector: 'private',
    fromAtsLive: true,
    publishedDate: '2026-09-25'
  },
  {
    name: 'senior-should-flag',
    title: 'Senior Engineering Manager, Payments',
    company: 'Razorpay',
    location: 'Bengaluru',
    description: 'Lead a team of 8 engineers. Requires 6+ years of experience building payment systems. B.Tech required.',
    applyUrl: 'https://boards.greenhouse.io/razorpaysoftwareprivatelimited/jobs/999',
    sourceUrl: 'https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs?content=true',
    sourceName: 'Greenhouse ATS',
    companyUrl: 'https://razorpay.com',
    sector: 'private',
    fromAtsLive: true
  },
  {
    name: 'thin-no-invention',
    title: 'Associate',
    company: 'MysteryCo',
    location: '',
    description: 'Great role.',
    applyUrl: 'not a url',
    sector: 'private',
    fromAtsLive: false
  }
];

let failures = 0;
// runKeys: keys seen within this run. publishedKeys: keys from earlier runs
// (a repeat there means "still live", not a duplicate).
const runKeys = new Set();
const publishedKeys = new Set();

for (const s of samples) {
  const spec = await processJobPosting(s, { runKeys, publishedKeys });
  const keys = Object.keys(spec);
  const missing = SPEC_TOP.filter((k) => !keys.includes(k));
  if (missing.length) { console.error(`FAIL [${s.name}] missing top-level keys: ${missing}`); failures++; }

  const v = spec.verification, q = spec.quality_checks, j = spec.job;
  console.log(`\n=== ${s.name} ===`);
  console.log('category:', v.entry_level_category, '| evidence:', JSON.stringify(v.entry_level_evidence));
  console.log('status:', v.status, '| confidence:', v.confidence, '| dup:', q.potential_duplicate);
  console.log('salary:', JSON.stringify(j.salary), '| salary_verified:', q.salary_verified);
  console.log('apply_url:', JSON.stringify(spec.source.official_application_url), '| verified:', q.application_url_verified);
  console.log('needs_human_review:', q.needs_human_review, '| reason:', JSON.stringify(q.review_reason));
  console.log('summary:', spec.website_content.summary.slice(0, 120) + '...');
  console.log('ig headline:', spec.instagram.headline, '| tags:', spec.instagram.hashtags.slice(0, 4).join(' '));

  // Assertions per spec
  const asserts = {
    'fresher-with-facts': () => [
      [v.entry_level_category === 'fresher', 'should classify fresher'],
      [v.status === 'active', 'ATS-live job should be active'],
      [q.salary_verified === true && /12/.test(j.salary), 'salary Rs. 12 LPA must be preserved verbatim-ish'],
      [q.needs_human_review === false, 'clean fresher job should not need review'],
      [!/guaranteed|dream job|100% hiring/i.test(spec.instagram.caption), 'no hype in caption']
    ],
    'senior-should-flag': () => [
      [v.entry_level_category === 'experienced', 'should classify experienced'],
      [q.needs_human_review === true, 'experienced role must route to human review']
    ],
    'thin-no-invention': () => [
      [j.salary === 'Not specified', 'must NOT invent salary'],
      [j.location === 'Not specified', 'must NOT invent location'],
      [spec.source.official_application_url === null, 'bogus URL must become null'],
      [q.needs_human_review === true, 'thin posting must route to human review'],
      [q.facts_invented === false, 'facts_invented flag must be false']
    ]
  };
  for (const [ok, msg] of asserts[s.name]()) {
    if (!ok) { console.error(`  ASSERT FAIL: ${msg}`); failures++; }
    else console.log(`  ok: ${msg}`);
  }
}

// Duplicate check: reprocess sample 1 in the SAME run -> must flag potential_duplicate
const dup = await processJobPosting(samples[0], { runKeys, publishedKeys });
if (!dup.quality_checks.potential_duplicate) { console.error('FAIL: duplicate not detected'); failures++; }
else console.log('\nok: duplicate detection works');

// Re-verification check: same job in a NEW run against published history ->
// must NOT be flagged as a duplicate, and must carry the reverified flag
const published = new Set([dup.verification.duplicate_key]);
const reverify = await processJobPosting(samples[0], { runKeys: new Set(), publishedKeys: published });
if (reverify.quality_checks.potential_duplicate) { console.error('FAIL: re-verified listing wrongly flagged as duplicate'); failures++; }
else console.log('ok: re-verified listing is not flagged as duplicate');
if (reverify.verification.reverified !== true) { console.error('FAIL: reverified flag missing'); failures++; }
else console.log('ok: reverified flag set');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
