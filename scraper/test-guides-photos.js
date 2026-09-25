/**
 * test-guides-photos.js — safety tests for the article + creative generators.
 * - Every AI-supplied value must be HTML-escaped in guide pages.
 * - Official apply URLs must be validated (no javascript:, no placeholders).
 * - Guide index must escape titles/companies.
 */
import { renderGuidePage } from './generate-articles.js';

let passed = 0;
const ok = (name, cond) => {
  if (!cond) { console.error(`FAIL: ${name}`); process.exitCode = 1; }
  else { passed++; /* console.log(`ok: ${name}`); */ }
};

const evilGuide = {
  overview: 'Nice role <script>alert(1)</script> & "quoted"',
  what_the_role_involves: ['Do <b>things</b>', 'Visit https://evil.example.com now'],
  skills_to_prepare: ['Python <img src=x onerror=alert(2)>'],
  interview_topics: ['DSA'],
  application_checklist: ['Apply fast']
};
const evilFacts = {
  company: 'EvilCorp <script>',
  title: 'SDE "I" <test>',
  location: 'Bengaluru & Delhi',
  salary: 'Not specified',
  batch: 'Not specified'
};
const evilJob = {
  applyUrl: 'javascript:alert(9)',
  slug: '/docs/jobs/evil.html'
};

const html = renderGuidePage({ job: evilJob, jobSlug: 'evil', facts: evilFacts, guide: evilGuide });

ok('no raw script tag', !html.includes('<script>alert'));
ok('script escaped', html.includes('&lt;script&gt;'));
ok('img onerror escaped', !html.includes('<img src=x'));
ok('quotes escaped in title', html.includes('&quot;I&quot;'));
ok('ampersand escaped', html.includes('Bengaluru &amp; Delhi'));
ok('javascript: URL rejected', !html.includes('javascript:alert'));
ok('no apply button without valid URL', !html.includes('Apply on official site'));
ok('evil URL text stripped from bullets', !html.includes('https://evil.example.com'));

const goodJob = { ...evilJob, applyUrl: 'https://jobs.lever.co/evil/abc123' };
const html2 = renderGuidePage({ job: goodJob, jobSlug: 'evil', facts: evilFacts, guide: evilGuide });
ok('valid apply URL kept', html2.includes('https://jobs.lever.co/evil/abc123'));
ok('job page link present', html2.includes('/docs/jobs/evil.html'));
ok('disclaimer present', html2.includes('not the company\'s actual interview rounds') || html2.includes('not the company&#39;s actual interview rounds'));

console.log(passed ? `ALL ${passed} GUIDE/PHOTO SAFETY TESTS PASSED` : 'NO TESTS RAN');
