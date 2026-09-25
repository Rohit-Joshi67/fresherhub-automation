/**
 * test-sources.js — unit tests for the source adapters (no network).
 * Run: node test-sources.js
 */
import assert from 'assert';
import {
  parseMaxYears, isIndiaLocation, isFresherEligible,
  kekaFresherEligible, normalizeKekaJob, normalizeAshbyJob,
  extractGovtNotices,
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

console.log('== ashby ==');
test('normalizeAshbyJob maps fields without inventing data', () => {
  const j = normalizeAshbyJob(
    { title: 'Frontend Intern', location: 'Bengaluru, India', jobUrl: 'https://jobs.ashbyhq.com/acme/123', descriptionHtml: '<p>Build UI.</p>', publishedAt: '2026-09-20T10:00:00Z' },
    { name: 'Acme', slug: 'acme', homepage: 'https://acme.com' }
  );
  assert.strictEqual(j.title, 'Frontend Intern');
  assert.strictEqual(j.location, 'Bengaluru, India');
  assert.strictEqual(j.applyUrl, 'https://jobs.ashbyhq.com/acme/123');
  assert.strictEqual(j.description, 'Build UI.');
  assert.strictEqual(j.sector, 'private');
  assert.strictEqual(j.sourceName, 'Ashby ATS');
  assert.strictEqual(j.publishedDate, '2026-09-20');
});
test('normalizeAshbyJob leaves missing location unstated', () => {
  const j = normalizeAshbyJob({ title: 'SDE Intern', location: null }, { name: 'Acme', slug: 'acme', homepage: 'https://acme.com' });
  assert.strictEqual(j.location, '');
});

console.log('== govt ==');
test('extractGovtNotices keeps recruitment anchors, drops noise', () => {
  const html = `
    <a href="/notices/advt1.pdf">Recruitment of Executive Trainees (2026) through GATE 2024/2025/2026.</a>
    <a href="/notices/fraud.pdf">Public Notice : Recruitment Fraud Alert</a>
    <a href="/notices/admit.pdf">Download Admit Card for Computer-Based Test (CBT)</a>
    <a href="/home">Home</a>
    <a href="/notices/walkin.pdf">Walk-In for Various Positions (Project Engineer) dated 04/09/2026</a>`;
  const out = extractGovtNotices(html, 'https://example.gov.in/careers');
  const titles = out.map((n) => n.title);
  assert.ok(titles.some((t) => t.includes('Executive Trainees')), 'kept recruitment notice');
  assert.ok(titles.some((t) => t.includes('Walk-In')), 'kept walk-in notice');
  assert.ok(!titles.some((t) => t.includes('Fraud Alert')), 'dropped fraud alert');
  assert.ok(!titles.some((t) => t.includes('Admit Card')), 'dropped admit card');
  assert.ok(!titles.some((t) => t === 'Home'), 'dropped nav');
  assert.strictEqual(out[0].url, 'https://example.gov.in/notices/advt1.pdf');
  const walkin = out.find((n) => n.title.includes('Walk-In'));
  assert.strictEqual(walkin.dateText, '2026-09-04');
});
test('extractGovtNotices returns [] on WAF challenge pages', () => {
  const html = '<html><body><h1>Just a moment...</h1><p>Powered by Sucuri CloudProxy</p><a href="/x">Recruitment of Officers 2026 notice here</a></body></html>';
  assert.deepStrictEqual(extractGovtNotices(html, 'https://example.gov.in/'), []);
});
test('extractGovtNotices mines written-out dates', () => {
  const html = '<a href="/n.pdf">Recruitment of Junior Executives, last date extended to 27th September 2026</a>';
  const out = extractGovtNotices(html, 'https://example.gov.in/');
  assert.strictEqual(out[0].dateText, '2026-09-27');
});
test('extractGovtNotices drops date-extension notices without recruitment signal', () => {
  const html = '<a href="/n.pdf">Last Date of application for CRP-RRBs-XV extended to 27th September 2026</a>';
  assert.deepStrictEqual(extractGovtNotices(html, 'https://example.gov.in/'), []);
});
test('extractGovtNotices uses table-row context for generic anchors', () => {
  const html = '<table><tr><td>04/09/2026</td><td>Advt No 01/2026</td><td>Recruitment of Executive Trainees (2026) through GATE</td><td><a href="/advt.pdf">Download Advertisement</a></td></tr></table>';
  const out = extractGovtNotices(html, 'https://example.gov.in/careers');
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].title.includes('Executive Trainees'), `title was: ${out[0].title}`);
  assert.strictEqual(out[0].url, 'https://example.gov.in/advt.pdf');
  assert.strictEqual(out[0].dateText, '2026-09-04');
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
test('source ids are unique', () => {
  const ids = SOURCES.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate source ids');
});
test('at least 400 IT sources and 10 govt sources', () => {
  const itKinds = new Set(['lever', 'greenhouse', 'ashby', 'keka']);
  const it = SOURCES.filter((s) => itKinds.has(s.kind));
  const govt = SOURCES.filter((s) => s.kind === 'govt');
  assert.ok(it.length >= 400, `only ${it.length} IT sources`);
  assert.ok(govt.length >= 10, `only ${govt.length} govt sources`);
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
