/**
 * test-sources.js — unit tests for the source adapters (no network).
 * Run: node test-sources.js
 */
import assert from 'assert';
import {
  parseMaxYears, isIndiaLocation, isFresherEligible,
  kekaFresherEligible, normalizeKekaJob,
  extractHiredoorHrefs, extractJobPostingJsonLd,
  extractHiredoorApplyLink, normalizeHiredoorJob, SOURCES
} from './sources.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    console.error(`  FAIL - ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('== parseMaxYears ==');
test('range "4 to 5 years" -> 5', () => assert.strictEqual(parseMaxYears('4 to 5 years'), 5));
test('"0-1 years" -> 1', () => assert.strictEqual(parseMaxYears('0-1 years'), 1));
test('"Fresher" -> null', () => assert.strictEqual(parseMaxYears('Fresher'), null));
test('empty -> null', () => assert.strictEqual(parseMaxYears(''), null));

console.log('== kekaFresherEligible ==');
test('4-5 years experience rejected', () => {
  assert.strictEqual(kekaFresherEligible({ title: 'Senior VC++ Developer', experience: '4 to 5 years' }), false);
});
test('0-1 years experience accepted', () => {
  assert.strictEqual(kekaFresherEligible({ title: 'SDE Intern', experience: '0 to 1 years' }), true);
});
test('no experience field + intern title accepted', () => {
  assert.strictEqual(kekaFresherEligible({ title: 'Software Development Intern' }), true);
});
test('no experience field + senior title rejected', () => {
  assert.strictEqual(kekaFresherEligible({ title: 'Senior Manager' }), false);
});

console.log('== normalizeKekaJob ==');
const kekaSrc = { name: 'Minfy', tenant: 'minfy' };
const kekaRecord = {
  id: 99123,
  title: 'Associate Cloud Engineer',
  description: '<p>Work on AWS deployments &amp; monitoring.</p>',
  excerpt: 'Entry-level cloud role',
  jobLocations: [{ id: 1, name: 'Bengaluru', city: 'Bengaluru', state: 'KA', countryCode: 'IN', countryName: 'India' }],
  jobType: 2,
  experience: '0 to 1 years',
  jobNumber: 'M000111',
  publishedOn: '2026-09-20T10:00:00.00Z',
  skillNames: []
};
test('maps fields without inventing salary', () => {
  const j = normalizeKekaJob(kekaRecord, kekaSrc, 'https://minfy.keka.com/careers/api/jobs/default/active');
  assert.strictEqual(j.title, 'Associate Cloud Engineer');
  assert.strictEqual(j.company, 'Minfy');
  assert.strictEqual(j.location, 'Bengaluru');
  assert.strictEqual(j.applyUrl, 'https://minfy.keka.com/careers/jobdetails/99123');
  assert.ok(j.description.includes('Experience required: 0 to 1 years.'));
  assert.ok(j.description.includes('Employment type: Full-time.'));
  assert.ok(j.description.includes('AWS deployments & monitoring')); // entities decoded
  assert.strictEqual(j.fromAtsLive, true);
  assert.strictEqual(j.publishedDate, '2026-09-20');
  assert.ok(!('salary' in j), 'salary must not exist on Keka jobs');
});
test('remote location mapping', () => {
  const j = normalizeKekaJob({ ...kekaRecord, jobLocations: [{ name: 'Remote', city: '.', state: 'TN', countryCode: 'IN' }] }, kekaSrc, 'x');
  assert.strictEqual(j.location, 'Remote');
});

console.log('== extractHiredoorHrefs ==');
test('finds job hrefs, ignores location hubs', () => {
  const html = `<a href="/jobs/applied-sciences-intern-949ec2">x</a>
    <a href="/jobs/bangalore">hub</a>
    <a href="/jobs/sde-intern-47f90d">y</a>
    <a href="/jobs/bangalore">hub again</a>`;
  const hrefs = extractHiredoorHrefs(html);
  assert.deepStrictEqual(hrefs, ['/jobs/applied-sciences-intern-949ec2', '/jobs/sde-intern-47f90d']);
});

console.log('== extractJobPostingJsonLd ==');
const detailHtml = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"HireDoor"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"SDE Intern","description":"<p>Build APIs.</p>","datePosted":"2026-09-16T07:32:24.911Z","validThrough":"2026-10-16T07:32:24.911Z","hiringOrganization":{"@type":"Organization","name":"Refold AI"},"employmentType":"INTERN","experienceRequirements":"Fresher / 0-1 years","skills":"Python, React","jobLocation":[{"@type":"Place","address":{"@type":"PostalAddress","addressCountry":"IN","addressLocality":"Bengaluru"}}],"baseSalary":{"@type":"MonetaryAmount","currency":"INR","value":{"@type":"QuantitativeValue","unitText":"MONTH","minValue":40000,"maxValue":50000}}}</script>
</head><body>... "applicationLink\\":\\"https://careers.refold.ai/jobs/123\\",\\"applyMethod\\":\\"external\\" ...</body></html>`;
test('extracts the JobPosting block', () => {
  const jp = extractJobPostingJsonLd(detailHtml);
  assert.ok(jp, 'should find JobPosting');
  assert.strictEqual(jp.title, 'SDE Intern');
  assert.strictEqual(jp.hiringOrganization.name, 'Refold AI');
});
test('extracts escaped applicationLink', () => {
  assert.strictEqual(extractHiredoorApplyLink(detailHtml), 'https://careers.refold.ai/jobs/123');
});
test('normalizeHiredoorJob never takes estimated salary', () => {
  const jp = extractJobPostingJsonLd(detailHtml);
  const j = normalizeHiredoorJob(jp, extractHiredoorApplyLink(detailHtml), 'https://hiredoor.in/jobs/sde-intern-47f90d');
  assert.strictEqual(j.company, 'Refold AI');
  assert.strictEqual(j.location, 'Bengaluru');
  assert.strictEqual(j.applyUrl, 'https://careers.refold.ai/jobs/123');
  assert.strictEqual(j.sourceName, 'HireDoor');
  assert.strictEqual(j.publishedDate, '2026-09-16');
  assert.strictEqual(j.validThrough, '2026-10-16T07:32:24.911Z');
  assert.ok(j.description.includes('Fresher / 0-1 years'));
  assert.ok(!('salary' in j), 'estimated baseSalary must not be consumed');
  assert.strictEqual(j.verifiedListing, undefined, 'no Verified-label trust flag');
  assert.strictEqual(j.applyUrlLive, false, 'liveness unknown until probed');
});
test('normalizeHiredoorJob leaves missing location unstated', () => {
  const jp = { '@type': 'JobPosting', title: 'SDE Intern', hiringOrganization: { name: 'Refold AI' }, jobLocation: [] };
  const j = normalizeHiredoorJob(jp, 'https://careers.refold.ai/jobs/123', 'https://hiredoor.in/jobs/x-1234');
  assert.strictEqual(j.location, '', 'must not fall back to India');
});

console.log('== registry sanity ==');
test('all sources have id/kind/name/checkUrl', () => {
  for (const s of SOURCES) {
    assert.ok(s.id && s.kind && s.name && s.checkUrl, `bad source: ${JSON.stringify(s)}`);
  }
  assert.ok(SOURCES.some((s) => s.kind === 'keka'), 'keka present');
  assert.ok(SOURCES.some((s) => s.kind === 'hiredoor'), 'hiredoor present');
  assert.ok(SOURCES.some((s) => s.kind === 'lever'), 'lever present');
  assert.ok(SOURCES.some((s) => s.kind === 'greenhouse'), 'greenhouse present');
});
test('india location matcher', () => {
  assert.strictEqual(isIndiaLocation('Bengaluru, India'), true);
  assert.strictEqual(isIndiaLocation('Remote'), true);
  assert.strictEqual(isIndiaLocation('San Francisco, USA'), false);
});
test('fresher title heuristics', () => {
  assert.strictEqual(isFresherEligible('Software Engineer Intern'), true);
  assert.strictEqual(isFresherEligible('Senior Manager'), false);
});

console.log(`\n${passed} tests passed${process.exitCode ? ' (WITH FAILURES)' : ''}.`);
