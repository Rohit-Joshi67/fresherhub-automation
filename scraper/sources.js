/**
 * sources.js — Job source registry + adapters
 * ===========================================
 * Every job source FresherHub pulls from lives here. Each source declares:
 *   { id, kind, name, checkUrl, ...kind-specific params }
 *
 * Adapter contract: fetchSourceJobs(source) -> Promise<Array<RawJob>>
 * RawJob: { title, company, location, description, applyUrl, sourceUrl,
 *           sourceName, companyUrl, publishedDate, validThrough,
 *           fromAtsLive, applyUrlLive, sector }
 *
 * HARD RULES:
 * - Only sources we are permitted to access: official public ATS APIs,
 *   public career-portal endpoints inside robots.txt Allow rules, and
 *   public listing pages the site's robots.txt explicitly allows.
 * - HireDoor's /api/* is DISALLOWED by their robots.txt -> we only read the
 *   server-rendered public HTML pages (/jobs), never their internal API.
 * - Salary figures labelled "Estimated" by a source are NOT treated as facts
 *   and are never populated into the job payload.
 */

import { checkUrl, USER_AGENT } from './robots-check.js';
import { fetchTextCapped, fetchJsonCapped, fetchWithTimeout } from './http.js';

// ---------------------------------------------------------------------------
// Source registry
// ---------------------------------------------------------------------------
export const SOURCES = [
  // ---- Lever boards (official public postings API) ----
  { id: 'lever-paytm', kind: 'lever', name: 'Paytm', slug: 'paytm', homepage: 'https://paytm.com', checkUrl: 'https://api.lever.co/v0/postings/paytm?mode=json' },
  { id: 'lever-meesho', kind: 'lever', name: 'Meesho', slug: 'meesho', homepage: 'https://meesho.com', checkUrl: 'https://api.lever.co/v0/postings/meesho?mode=json' },
  { id: 'lever-cred', kind: 'lever', name: 'CRED', slug: 'cred', homepage: 'https://cred.club', checkUrl: 'https://api.lever.co/v0/postings/cred?mode=json' },
  { id: 'lever-fi', kind: 'lever', name: 'Fi Money', slug: 'fi', homepage: 'https://fi.money', checkUrl: 'https://api.lever.co/v0/postings/fi?mode=json' },
  { id: 'lever-zeta', kind: 'lever', name: 'Zeta', slug: 'zeta', homepage: 'https://zeta.tech', checkUrl: 'https://api.lever.co/v0/postings/zeta?mode=json' },
  { id: 'lever-coinmarketcap', kind: 'lever', name: 'CoinMarketCap', slug: 'coinmarketcap', homepage: 'https://coinmarketcap.com', checkUrl: 'https://api.lever.co/v0/postings/coinmarketcap?mode=json' },

  // ---- Greenhouse boards (official public boards API) ----
  { id: 'gh-postman', kind: 'greenhouse', name: 'Postman', slug: 'postman', homepage: 'https://postman.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/postman/jobs?content=true' },
  { id: 'gh-razorpay', kind: 'greenhouse', name: 'Razorpay', slug: 'razorpaysoftwareprivatelimited', homepage: 'https://razorpay.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/razorpaysoftwareprivatelimited/jobs?content=true' },
  { id: 'gh-inmobi', kind: 'greenhouse', name: 'InMobi', slug: 'inmobi', homepage: 'https://inmobi.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/inmobi/jobs?content=true' },
  { id: 'gh-glance', kind: 'greenhouse', name: 'Glance', slug: 'glance', homepage: 'https://glance.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/glance/jobs?content=true' },
  { id: 'gh-groww', kind: 'greenhouse', name: 'Groww', slug: 'groww', homepage: 'https://groww.in', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/groww/jobs?content=true' },
  { id: 'gh-slice', kind: 'greenhouse', name: 'Slice', slug: 'slice', homepage: 'https://sliceit.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/slice/jobs?content=true' },
  { id: 'gh-stage', kind: 'greenhouse', name: 'Stage', slug: 'stage', homepage: 'https://stage.in', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/stage/jobs?content=true' },

  // ---- Keka career portals (India's largest HRMS; tenant robots.txt is
  // Disallow:/ + Allow:/careers, and every endpoint below lives under
  // /careers/. Public JSON endpoints used by Keka's own career widget.)
  { id: 'keka-10decoders', kind: 'keka', name: '10Decoders', tenant: '10decoders', checkUrl: 'https://10decoders.keka.com/careers' },
  { id: 'keka-minfy', kind: 'keka', name: 'Minfy', tenant: 'minfy', checkUrl: 'https://minfy.keka.com/careers' },
  { id: 'keka-signzy', kind: 'keka', name: 'Signzy', tenant: 'signzy', checkUrl: 'https://signzy.keka.com/careers' },
  { id: 'keka-wingify', kind: 'keka', name: 'Wingify', tenant: 'wingify', checkUrl: 'https://wingify.keka.com/careers' },
  { id: 'keka-zaggle', kind: 'keka', name: 'Zaggle', tenant: 'zaggle', checkUrl: 'https://zaggle.keka.com/careers' },
  { id: 'keka-inito', kind: 'keka', name: 'Inito', tenant: 'inito', checkUrl: 'https://inito.keka.com/careers' },


  // ---- Lever boards (bulk-verified 2026-09-25) ----
  { id: 'lever-15five', kind: 'lever', name: '15Five', slug: '15five', homepage: 'https://www.15five.com', checkUrl: 'https://api.lever.co/v0/postings/15five?mode=json' },
  { id: 'lever-1inch', kind: 'lever', name: '1inch Network', slug: '1inch', homepage: 'https://1inch.io', checkUrl: 'https://api.lever.co/v0/postings/1inch?mode=json' },
  { id: 'lever-accesssoftek', kind: 'lever', name: 'Access Softek', slug: 'accesssoftek', homepage: 'https://accesssoftek.com', checkUrl: 'https://api.lever.co/v0/postings/accesssoftek?mode=json' },
  { id: 'lever-activecampaign', kind: 'lever', name: 'ActiveCampaign', slug: 'activecampaign', homepage: 'https://www.activecampaign.com', checkUrl: 'https://api.lever.co/v0/postings/activecampaign?mode=json' },
  { id: 'lever-aircall', kind: 'lever', name: 'Aircall', slug: 'aircall', homepage: 'https://aircall.io', checkUrl: 'https://api.lever.co/v0/postings/aircall?mode=json' },
  { id: 'lever-alloy', kind: 'lever', name: 'Alloy', slug: 'alloy', homepage: 'https://www.alloy.com', checkUrl: 'https://api.lever.co/v0/postings/alloy?mode=json' },
  { id: 'lever-altaml', kind: 'lever', name: 'AltAML', slug: 'altaml', homepage: 'https://altaml.com', checkUrl: 'https://api.lever.co/v0/postings/altaml?mode=json' },
  { id: 'lever-ambirobotics', kind: 'lever', name: 'Ambi Robotics', slug: 'ambirobotics', homepage: 'https://ambirobotics.com', checkUrl: 'https://api.lever.co/v0/postings/ambirobotics?mode=json' },
  { id: 'lever-anchorage', kind: 'lever', name: 'Anchorage Digital', slug: 'anchorage', homepage: 'https://anchorage.com', checkUrl: 'https://api.lever.co/v0/postings/anchorage?mode=json' },
  { id: 'lever-azul', kind: 'lever', name: 'Azul', slug: 'azul', homepage: 'https://azul.com', checkUrl: 'https://api.lever.co/v0/postings/azul?mode=json' },
  { id: 'lever-binance', kind: 'lever', name: 'Binance', slug: 'binance', homepage: 'https://binance.com', checkUrl: 'https://api.lever.co/v0/postings/binance?mode=json' },
  { id: 'lever-bluecatnetworks', kind: 'lever', name: 'BlueCat Networks', slug: 'bluecatnetworks', homepage: 'https://bluecatnetworks.com', checkUrl: 'https://api.lever.co/v0/postings/bluecatnetworks?mode=json' },
  { id: 'lever-bluelightconsulting', kind: 'lever', name: 'Bluelight Consulting', slug: 'bluelightconsulting', homepage: 'https://bluelightconsulting.com', checkUrl: 'https://api.lever.co/v0/postings/bluelightconsulting?mode=json' },
  { id: 'lever-bounteous', kind: 'lever', name: 'Bounteous', slug: 'bounteous', homepage: 'https://bounteous.com', checkUrl: 'https://api.lever.co/v0/postings/bounteous?mode=json' },
  { id: 'lever-clari', kind: 'lever', name: 'Clari', slug: 'clari', homepage: 'https://clari.com', checkUrl: 'https://api.lever.co/v0/postings/clari?mode=json' },
  { id: 'lever-cloudinary', kind: 'lever', name: 'Cloudinary', slug: 'cloudinary', homepage: 'https://cloudinary.com', checkUrl: 'https://api.lever.co/v0/postings/cloudinary?mode=json' },
  { id: 'lever-cscgeneration2', kind: 'lever', name: 'CSC Generation', slug: 'cscgeneration-2', homepage: 'https://cscgeneration.com', checkUrl: 'https://api.lever.co/v0/postings/cscgeneration-2?mode=json' },
  { id: 'lever-entefy', kind: 'lever', name: 'Entefy', slug: 'entefy', homepage: 'https://entefy.com', checkUrl: 'https://api.lever.co/v0/postings/entefy?mode=json' },
  { id: 'lever-entrata', kind: 'lever', name: 'Entrata', slug: 'entrata', homepage: 'https://entrata.com', checkUrl: 'https://api.lever.co/v0/postings/entrata?mode=json' },
  { id: 'lever-everbridge', kind: 'lever', name: 'Everbridge', slug: 'everbridge', homepage: 'https://everbridge.com', checkUrl: 'https://api.lever.co/v0/postings/everbridge?mode=json' },
  { id: 'lever-extremenetworks', kind: 'lever', name: 'Extreme Networks', slug: 'extremenetworks', homepage: 'https://extremenetworks.com', checkUrl: 'https://api.lever.co/v0/postings/extremenetworks?mode=json' },
  { id: 'lever-fampay', kind: 'lever', name: 'FamPay', slug: 'fampay', homepage: 'https://fampay.in', checkUrl: 'https://api.lever.co/v0/postings/fampay?mode=json' },
  { id: 'lever-fieldnation', kind: 'lever', name: 'Field Nation', slug: 'fieldnation', homepage: 'https://jobs.lever.co/fieldnation', checkUrl: 'https://api.lever.co/v0/postings/fieldnation?mode=json' },
  { id: 'lever-filevine', kind: 'lever', name: 'Filevine', slug: 'filevine', homepage: 'https://filevine.com', checkUrl: 'https://api.lever.co/v0/postings/filevine?mode=json' },
  { id: 'lever-fly', kind: 'lever', name: 'Fly.io', slug: 'fly', homepage: 'https://fly.io', checkUrl: 'https://api.lever.co/v0/postings/fly?mode=json' },
  { id: 'lever-franklinai', kind: 'lever', name: 'Franklin AI', slug: 'franklinai', homepage: 'https://franklin.ai', checkUrl: 'https://api.lever.co/v0/postings/franklinai?mode=json' },
  { id: 'lever-freshworks', kind: 'lever', name: 'Freshworks', slug: 'freshworks', homepage: 'https://freshworks.com', checkUrl: 'https://api.lever.co/v0/postings/freshworks?mode=json' },
  { id: 'lever-funxyz', kind: 'lever', name: 'fun.xyz', slug: 'funxyz', homepage: 'https://fun.xyz', checkUrl: 'https://api.lever.co/v0/postings/funxyz?mode=json' },
  { id: 'lever-gopuff', kind: 'lever', name: 'Gopuff', slug: 'gopuff', homepage: 'https://gopuff.com', checkUrl: 'https://api.lever.co/v0/postings/gopuff?mode=json' },
  { id: 'lever-gradion', kind: 'lever', name: 'Gradion', slug: 'gradion', homepage: 'https://jobs.lever.co/gradion', checkUrl: 'https://api.lever.co/v0/postings/gradion?mode=json' },
  { id: 'lever-idt', kind: 'lever', name: 'IDT Corporation', slug: 'idt', homepage: 'https://jobs.lever.co/idt', checkUrl: 'https://api.lever.co/v0/postings/idt?mode=json' },
  { id: 'lever-impossiblecloud', kind: 'lever', name: 'Impossible Cloud', slug: 'impossiblecloud', homepage: 'https://impossiblecloud.com', checkUrl: 'https://api.lever.co/v0/postings/impossiblecloud?mode=json' },
  { id: 'lever-intropic', kind: 'lever', name: 'Intropic', slug: 'intropic', homepage: 'https://intropic.com', checkUrl: 'https://api.lever.co/v0/postings/intropic?mode=json' },
  { id: 'lever-jumpcloud', kind: 'lever', name: 'JumpCloud', slug: 'jumpcloud', homepage: 'https://jumpcloud.com', checkUrl: 'https://api.lever.co/v0/postings/jumpcloud?mode=json' },
  { id: 'lever-lalamove', kind: 'lever', name: 'Lalamove', slug: 'lalamove', homepage: 'https://lalamove.com', checkUrl: 'https://api.lever.co/v0/postings/lalamove?mode=json' },
  { id: 'lever-lever', kind: 'lever', name: 'Lever', slug: 'lever', homepage: 'https://www.lever.co', checkUrl: 'https://api.lever.co/v0/postings/lever?mode=json' },
  { id: 'lever-limitbreak', kind: 'lever', name: 'Limit Break', slug: 'limitbreak', homepage: 'https://jobs.lever.co/limitbreak', checkUrl: 'https://api.lever.co/v0/postings/limitbreak?mode=json' },
  { id: 'lever-linkedin', kind: 'lever', name: 'LinkedIn', slug: 'linkedin', homepage: 'https://www.linkedin.com', checkUrl: 'https://api.lever.co/v0/postings/linkedin?mode=json' },
  { id: 'lever-lyrebirdstudio', kind: 'lever', name: 'Lyrebird Studio', slug: 'lyrebirdstudio', homepage: 'https://jobs.lever.co/lyrebirdstudio', checkUrl: 'https://api.lever.co/v0/postings/lyrebirdstudio?mode=json' },
  { id: 'lever-magnetforensics', kind: 'lever', name: 'Magnet Forensics', slug: 'magnetforensics', homepage: 'https://magnetforensics.com', checkUrl: 'https://api.lever.co/v0/postings/magnetforensics?mode=json' },
  { id: 'lever-mindtickle', kind: 'lever', name: 'Mindtickle', slug: 'mindtickle', homepage: 'https://jobs.lever.co/mindtickle', checkUrl: 'https://api.lever.co/v0/postings/mindtickle?mode=json' },
  { id: 'lever-mobileaction', kind: 'lever', name: 'MobileAction', slug: 'mobile-action', homepage: 'https://mobileaction.co', checkUrl: 'https://api.lever.co/v0/postings/mobile-action?mode=json' },
  { id: 'lever-moonsonglabs', kind: 'lever', name: 'MoonSong Labs', slug: 'moonsong-labs', homepage: 'https://jobs.lever.co/moonsong-labs', checkUrl: 'https://api.lever.co/v0/postings/moonsong-labs?mode=json' },
  { id: 'lever-multiplylabs', kind: 'lever', name: 'Multiply Labs', slug: 'multiplylabs', homepage: 'https://jobs.lever.co/multiplylabs', checkUrl: 'https://api.lever.co/v0/postings/multiplylabs?mode=json' },
  { id: 'lever-muttdata', kind: 'lever', name: 'Mutt Data', slug: 'muttdata', homepage: 'https://muttdata.ai', checkUrl: 'https://api.lever.co/v0/postings/muttdata?mode=json' },
  { id: 'lever-mythicaicom', kind: 'lever', name: 'Mythic', slug: 'mythic-ai.com', homepage: 'https://jobs.lever.co/mythic-ai.com', checkUrl: 'https://api.lever.co/v0/postings/mythic-ai.com?mode=json' },
  { id: 'lever-neon', kind: 'lever', name: 'Neon', slug: 'neon', homepage: 'https://neon.tech', checkUrl: 'https://api.lever.co/v0/postings/neon?mode=json' },
  { id: 'lever-neuron7', kind: 'lever', name: 'Neuron7.ai', slug: 'neuron7', homepage: 'https://neuron7.ai', checkUrl: 'https://api.lever.co/v0/postings/neuron7?mode=json' },
  { id: 'lever-octoenergy', kind: 'lever', name: 'Octopus Energy', slug: 'octoenergy', homepage: 'https://octoenergy.com', checkUrl: 'https://api.lever.co/v0/postings/octoenergy?mode=json' },
  { id: 'lever-olo', kind: 'lever', name: 'Olo', slug: 'olo', homepage: 'https://olo.com', checkUrl: 'https://api.lever.co/v0/postings/olo?mode=json' },
  { id: 'lever-oowlish', kind: 'lever', name: 'Oowlish', slug: 'oowlish', homepage: 'https://jobs.lever.co/oowlish', checkUrl: 'https://api.lever.co/v0/postings/oowlish?mode=json' },
  { id: 'lever-outreach', kind: 'lever', name: 'Outreach', slug: 'outreach', homepage: 'https://outreach.io', checkUrl: 'https://api.lever.co/v0/postings/outreach?mode=json' },
  { id: 'lever-palantir', kind: 'lever', name: 'Palantir', slug: 'palantir', homepage: 'https://jobs.lever.co/palantir', checkUrl: 'https://api.lever.co/v0/postings/palantir?mode=json' },
  { id: 'lever-pigment', kind: 'lever', name: 'Pigment', slug: 'pigment', homepage: 'https://pigment.com', checkUrl: 'https://api.lever.co/v0/postings/pigment?mode=json' },
  { id: 'lever-plivo', kind: 'lever', name: 'Plivo', slug: 'plivo', homepage: 'https://plivo.com', checkUrl: 'https://api.lever.co/v0/postings/plivo?mode=json' },
  { id: 'lever-porter', kind: 'lever', name: 'Porter', slug: 'porter', homepage: 'https://jobs.lever.co/porter', checkUrl: 'https://api.lever.co/v0/postings/porter?mode=json' },
  { id: 'lever-portpro', kind: 'lever', name: 'PortPro', slug: 'portpro', homepage: 'https://portpro.io', checkUrl: 'https://api.lever.co/v0/postings/portpro?mode=json' },
  { id: 'lever-prismic', kind: 'lever', name: 'Prismic', slug: 'prismic', homepage: 'https://prismic.io', checkUrl: 'https://api.lever.co/v0/postings/prismic?mode=json' },
  { id: 'lever-procreate', kind: 'lever', name: 'Procreate', slug: 'procreate', homepage: 'https://procreate.com', checkUrl: 'https://api.lever.co/v0/postings/procreate?mode=json' },
  { id: 'lever-qonto', kind: 'lever', name: 'Qonto', slug: 'qonto', homepage: 'https://qonto.com', checkUrl: 'https://api.lever.co/v0/postings/qonto?mode=json' },
  { id: 'lever-quantco', kind: 'lever', name: 'QuantCo', slug: 'quantco-', homepage: 'https://jobs.lever.co/quantco-', checkUrl: 'https://api.lever.co/v0/postings/quantco-?mode=json' },
  { id: 'lever-reachindustries', kind: 'lever', name: 'Reach Industries', slug: 'reach.industries', homepage: 'https://jobs.lever.co/reach.industries', checkUrl: 'https://api.lever.co/v0/postings/reach.industries?mode=json' },
  { id: 'lever-restaurant365', kind: 'lever', name: 'Restaurant365', slug: 'restaurant365', homepage: 'https://restaurant365.com', checkUrl: 'https://api.lever.co/v0/postings/restaurant365?mode=json' },
  { id: 'lever-revealtech', kind: 'lever', name: 'Reveal Group', slug: 'revealtech', homepage: 'https://jobs.lever.co/revealtech', checkUrl: 'https://api.lever.co/v0/postings/revealtech?mode=json' },
  { id: 'lever-revefi', kind: 'lever', name: 'Revefi', slug: 'revefi', homepage: 'https://revefi.com', checkUrl: 'https://api.lever.co/v0/postings/revefi?mode=json' },
  { id: 'lever-revenueanalytics', kind: 'lever', name: 'Revenue Analytics', slug: 'revenueanalytics', homepage: 'https://revenueanalytics.com', checkUrl: 'https://api.lever.co/v0/postings/revenueanalytics?mode=json' },
  { id: 'lever-secureframe', kind: 'lever', name: 'SecureFrame', slug: 'secureframe', homepage: 'https://secureframe.com', checkUrl: 'https://api.lever.co/v0/postings/secureframe?mode=json' },
  { id: 'lever-shieldai', kind: 'lever', name: 'Shield AI', slug: 'shieldai', homepage: 'https://shield.ai', checkUrl: 'https://api.lever.co/v0/postings/shieldai?mode=json' },
  { id: 'lever-soum', kind: 'lever', name: 'Soum', slug: 'soum', homepage: 'https://soum.sa', checkUrl: 'https://api.lever.co/v0/postings/soum?mode=json' },
  { id: 'lever-spotify', kind: 'lever', name: 'Spotify', slug: 'spotify', homepage: 'https://www.spotify.com', checkUrl: 'https://api.lever.co/v0/postings/spotify?mode=json' },
  { id: 'lever-stackedsp', kind: 'lever', name: 'StackedSP', slug: 'stackedsp', homepage: 'https://jobs.lever.co/stackedsp', checkUrl: 'https://api.lever.co/v0/postings/stackedsp?mode=json' },
  { id: 'lever-swile', kind: 'lever', name: 'Swile', slug: 'swile', homepage: 'https://jobs.lever.co/swile', checkUrl: 'https://api.lever.co/v0/postings/swile?mode=json' },
  { id: 'lever-teikametrics', kind: 'lever', name: 'Teikametrics', slug: 'teikametrics', homepage: 'https://teikametrics.com', checkUrl: 'https://api.lever.co/v0/postings/teikametrics?mode=json' },
  { id: 'lever-teller', kind: 'lever', name: 'Teller', slug: 'teller', homepage: 'https://teller.io', checkUrl: 'https://api.lever.co/v0/postings/teller?mode=json' },
  { id: 'lever-theodo', kind: 'lever', name: 'Theodo', slug: 'theodo', homepage: 'https://theodo.com', checkUrl: 'https://api.lever.co/v0/postings/theodo?mode=json' },
  { id: 'lever-toptal', kind: 'lever', name: 'Toptal', slug: 'toptal', homepage: 'https://toptal.com', checkUrl: 'https://api.lever.co/v0/postings/toptal?mode=json' },
  { id: 'lever-traackr', kind: 'lever', name: 'Traackr', slug: 'traackr', homepage: 'https://traackr.com', checkUrl: 'https://api.lever.co/v0/postings/traackr?mode=json' },
  { id: 'lever-ttecdigital', kind: 'lever', name: 'TTEC Digital', slug: 'ttecdigital', homepage: 'https://ttecdigital.com', checkUrl: 'https://api.lever.co/v0/postings/ttecdigital?mode=json' },
  { id: 'lever-turgonai', kind: 'lever', name: 'Turgon AI', slug: 'turgon-ai', homepage: 'https://jobs.lever.co/turgon-ai', checkUrl: 'https://api.lever.co/v0/postings/turgon-ai?mode=json' },
  { id: 'lever-vana', kind: 'lever', name: 'Vana', slug: 'vana', homepage: 'https://vana.org', checkUrl: 'https://api.lever.co/v0/postings/vana?mode=json' },
  { id: 'lever-voleon', kind: 'lever', name: 'Voleon', slug: 'voleon', homepage: 'https://voleon.com', checkUrl: 'https://api.lever.co/v0/postings/voleon?mode=json' },
  { id: 'lever-waabi', kind: 'lever', name: 'Waabi', slug: 'waabi', homepage: 'https://waabi.ai', checkUrl: 'https://api.lever.co/v0/postings/waabi?mode=json' },
  { id: 'lever-walkme', kind: 'lever', name: 'WalkMe', slug: 'walkme', homepage: 'https://www.walkme.com', checkUrl: 'https://api.lever.co/v0/postings/walkme?mode=json' },
  { id: 'lever-weekdayworks', kind: 'lever', name: 'Weekday', slug: 'weekdayworks', homepage: 'https://weekday.works', checkUrl: 'https://api.lever.co/v0/postings/weekdayworks?mode=json' },
  { id: 'lever-workwave', kind: 'lever', name: 'WorkWave', slug: 'workwave', homepage: 'https://workwave.com', checkUrl: 'https://api.lever.co/v0/postings/workwave?mode=json' },
  { id: 'lever-xsolla', kind: 'lever', name: 'Xsolla', slug: 'xsolla', homepage: 'https://xsolla.com', checkUrl: 'https://api.lever.co/v0/postings/xsolla?mode=json' },
  { id: 'lever-yuno', kind: 'lever', name: 'Yuno', slug: 'yuno', homepage: 'https://jobs.lever.co/yuno', checkUrl: 'https://api.lever.co/v0/postings/yuno?mode=json' },
  { id: 'lever-zaimler', kind: 'lever', name: 'zaimler', slug: 'zaimler', homepage: 'https://jobs.lever.co/zaimler', checkUrl: 'https://api.lever.co/v0/postings/zaimler?mode=json' },
  { id: 'lever-zoox', kind: 'lever', name: 'Zoox', slug: 'zoox', homepage: 'https://zoox.com', checkUrl: 'https://api.lever.co/v0/postings/zoox?mode=json' },

  // ---- Greenhouse boards (bulk-verified 2026-09-25) ----
  { id: 'gh-6sense', kind: 'greenhouse', name: '6sense', slug: '6sense', homepage: 'https://6sense.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/6sense/jobs?content=true' },
  { id: 'gh-adyen', kind: 'greenhouse', name: 'Adyen', slug: 'adyen', homepage: 'https://www.adyen.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/adyen/jobs?content=true' },
  { id: 'gh-affirm', kind: 'greenhouse', name: 'Affirm', slug: 'affirm', homepage: 'https://www.affirm.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/affirm/jobs?content=true' },
  { id: 'gh-affle', kind: 'greenhouse', name: 'Affle', slug: 'affle', homepage: 'https://job-boards.greenhouse.io/affle', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/affle/jobs?content=true' },
  { id: 'gh-airbnb', kind: 'greenhouse', name: 'Airbnb', slug: 'airbnb', homepage: 'https://www.airbnb.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/airbnb/jobs?content=true' },
  { id: 'gh-airtable', kind: 'greenhouse', name: 'Airtable', slug: 'airtable', homepage: 'https://www.airtable.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/airtable/jobs?content=true' },
  { id: 'gh-algolia', kind: 'greenhouse', name: 'Algolia', slug: 'algolia', homepage: 'https://www.algolia.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/algolia/jobs?content=true' },
  { id: 'gh-amplitude', kind: 'greenhouse', name: 'Amplitude', slug: 'amplitude', homepage: 'https://amplitude.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/amplitude/jobs?content=true' },
  { id: 'gh-anthropic', kind: 'greenhouse', name: 'Anthropic', slug: 'anthropic', homepage: 'https://www.anthropic.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true' },
  { id: 'gh-apollo', kind: 'greenhouse', name: 'Apollo.io', slug: 'apollo', homepage: 'https://www.apollo.io', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/apollo/jobs?content=true' },
  { id: 'gh-appsflyer', kind: 'greenhouse', name: 'AppsFlyer', slug: 'appsflyer', homepage: 'https://www.appsflyer.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/appsflyer/jobs?content=true' },
  { id: 'gh-asana', kind: 'greenhouse', name: 'Asana', slug: 'asana', homepage: 'https://asana.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/asana/jobs?content=true' },
  { id: 'gh-attentive', kind: 'greenhouse', name: 'Attentive', slug: 'attentive', homepage: 'https://www.attentive.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/attentive/jobs?content=true' },
  { id: 'gh-automatticcareers', kind: 'greenhouse', name: 'Automattic', slug: 'automatticcareers', homepage: 'https://automattic.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/automatticcareers/jobs?content=true' },
  { id: 'gh-block', kind: 'greenhouse', name: 'Block', slug: 'block', homepage: 'https://block.xyz', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/block/jobs?content=true' },
  { id: 'gh-branch', kind: 'greenhouse', name: 'Branch', slug: 'branch', homepage: 'https://www.branch.io', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/branch/jobs?content=true' },
  { id: 'gh-braze', kind: 'greenhouse', name: 'Braze', slug: 'braze', homepage: 'https://www.braze.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/braze/jobs?content=true' },
  { id: 'gh-brex', kind: 'greenhouse', name: 'Brex', slug: 'brex', homepage: 'https://www.brex.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/brex/jobs?content=true' },
  { id: 'gh-buildkite', kind: 'greenhouse', name: 'Buildkite', slug: 'buildkite', homepage: 'https://buildkite.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/buildkite/jobs?content=true' },
  { id: 'gh-canonical', kind: 'greenhouse', name: 'Canonical', slug: 'canonical', homepage: 'https://canonical.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/canonical/jobs?content=true' },
  { id: 'gh-carta', kind: 'greenhouse', name: 'Carta', slug: 'carta', homepage: 'https://carta.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/carta/jobs?content=true' },
  { id: 'gh-cbinsights', kind: 'greenhouse', name: 'CB Insights', slug: 'cbinsights', homepage: 'https://www.cbinsights.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/cbinsights/jobs?content=true' },
  { id: 'gh-chime', kind: 'greenhouse', name: 'Chime', slug: 'chime', homepage: 'https://job-boards.greenhouse.io/chime', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/chime/jobs?content=true' },
  { id: 'gh-circleci', kind: 'greenhouse', name: 'CircleCI', slug: 'circleci', homepage: 'https://circleci.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/circleci/jobs?content=true' },
  { id: 'gh-cloudflare', kind: 'greenhouse', name: 'Cloudflare', slug: 'cloudflare', homepage: 'https://www.cloudflare.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true' },
  { id: 'gh-cloudsek', kind: 'greenhouse', name: 'CloudSEK', slug: 'cloudsek', homepage: 'https://cloudsek.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/cloudsek/jobs?content=true' },
  { id: 'gh-cockroachlabs', kind: 'greenhouse', name: 'Cockroach Labs', slug: 'cockroachlabs', homepage: 'https://www.cockroachlabs.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/cockroachlabs/jobs?content=true' },
  { id: 'gh-coinbase', kind: 'greenhouse', name: 'Coinbase', slug: 'coinbase', homepage: 'https://www.coinbase.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=true' },
  { id: 'gh-collibra', kind: 'greenhouse', name: 'Collibra', slug: 'collibra', homepage: 'https://www.collibra.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/collibra/jobs?content=true' },
  { id: 'gh-contentful', kind: 'greenhouse', name: 'Contentful', slug: 'contentful', homepage: 'https://www.contentful.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/contentful/jobs?content=true' },
  { id: 'gh-coupang', kind: 'greenhouse', name: 'Coupang', slug: 'coupang', homepage: 'https://www.coupang.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/coupang/jobs?content=true' },
  { id: 'gh-coursera', kind: 'greenhouse', name: 'Coursera', slug: 'coursera', homepage: 'https://www.coursera.org', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/coursera/jobs?content=true' },
  { id: 'gh-customerio', kind: 'greenhouse', name: 'Customer.io', slug: 'customerio', homepage: 'https://customer.io', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/customerio/jobs?content=true' },
  { id: 'gh-dashlane', kind: 'greenhouse', name: 'Dashlane', slug: 'dashlane', homepage: 'https://www.dashlane.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/dashlane/jobs?content=true' },
  { id: 'gh-databricks', kind: 'greenhouse', name: 'Databricks', slug: 'databricks', homepage: 'https://www.databricks.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true' },
  { id: 'gh-datadog', kind: 'greenhouse', name: 'Datadog', slug: 'datadog', homepage: 'https://www.datadoghq.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true' },
  { id: 'gh-dataiku', kind: 'greenhouse', name: 'Dataiku', slug: 'dataiku', homepage: 'https://www.dataiku.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/dataiku/jobs?content=true' },
  { id: 'gh-descript', kind: 'greenhouse', name: 'Descript', slug: 'descript', homepage: 'https://www.descript.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/descript/jobs?content=true' },
  { id: 'gh-discord', kind: 'greenhouse', name: 'Discord', slug: 'discord', homepage: 'https://discord.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true' },
  { id: 'gh-doctolib', kind: 'greenhouse', name: 'Doctolib', slug: 'doctolib', homepage: 'https://www.doctolib.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/doctolib/jobs?content=true' },
  { id: 'gh-doubleverify', kind: 'greenhouse', name: 'DoubleVerify', slug: 'doubleverify', homepage: 'https://doubleverify.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/doubleverify/jobs?content=true' },
  { id: 'gh-dropbox', kind: 'greenhouse', name: 'Dropbox', slug: 'dropbox', homepage: 'https://www.dropbox.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/dropbox/jobs?content=true' },
  { id: 'gh-druva', kind: 'greenhouse', name: 'Druva', slug: 'druva', homepage: 'https://www.druva.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/druva/jobs?content=true' },
  { id: 'gh-duolingo', kind: 'greenhouse', name: 'Duolingo', slug: 'duolingo', homepage: 'https://www.duolingo.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/duolingo/jobs?content=true' },
  { id: 'gh-elastic', kind: 'greenhouse', name: 'Elastic', slug: 'elastic', homepage: 'https://www.elastic.co', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/elastic/jobs?content=true' },
  { id: 'gh-energyhub', kind: 'greenhouse', name: 'EnergyHub', slug: 'energyhub', homepage: 'https://www.energyhub.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/energyhub/jobs?content=true' },
  { id: 'gh-everlaw', kind: 'greenhouse', name: 'Everlaw', slug: 'everlaw', homepage: 'https://www.everlaw.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/everlaw/jobs?content=true' },
  { id: 'gh-fastly', kind: 'greenhouse', name: 'Fastly', slug: 'fastly', homepage: 'https://www.fastly.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/fastly/jobs?content=true' },
  { id: 'gh-figma', kind: 'greenhouse', name: 'Figma', slug: 'figma', homepage: 'https://www.figma.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true' },
  { id: 'gh-fireblocks', kind: 'greenhouse', name: 'Fireblocks', slug: 'fireblocks', homepage: 'https://fireblocks.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/fireblocks/jobs?content=true' },
  { id: 'gh-five9', kind: 'greenhouse', name: 'Five9', slug: 'five9', homepage: 'https://www.five9.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/five9/jobs?content=true' },
  { id: 'gh-fivetran', kind: 'greenhouse', name: 'Fivetran', slug: 'fivetran', homepage: 'https://www.fivetran.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/fivetran/jobs?content=true' },
  { id: 'gh-gemini', kind: 'greenhouse', name: 'Gemini', slug: 'gemini', homepage: 'https://www.gemini.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/gemini/jobs?content=true' },
  { id: 'gh-ghost', kind: 'greenhouse', name: 'Ghost', slug: 'ghost', homepage: 'https://ghost.org', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/ghost/jobs?content=true' },
  { id: 'gh-gitlab', kind: 'greenhouse', name: 'GitLab', slug: 'gitlab', homepage: 'https://about.gitlab.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true' },
  { id: 'gh-greenhouse', kind: 'greenhouse', name: 'Greenhouse', slug: 'greenhouse', homepage: 'https://www.greenhouse.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/greenhouse/jobs?content=true' },
  { id: 'gh-gusto', kind: 'greenhouse', name: 'Gusto', slug: 'gusto', homepage: 'https://gusto.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/gusto/jobs?content=true' },
  { id: 'gh-hellofresh', kind: 'greenhouse', name: 'HelloFresh', slug: 'hellofresh', homepage: 'https://www.hellofresh.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/hellofresh/jobs?content=true' },
  { id: 'gh-heygen', kind: 'greenhouse', name: 'HeyGen', slug: 'heygen', homepage: 'https://www.heygen.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/heygen/jobs?content=true' },
  { id: 'gh-highradius', kind: 'greenhouse', name: 'HighRadius', slug: 'highradius', homepage: 'https://www.highradius.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/highradius/jobs?content=true' },
  { id: 'gh-honeycomb', kind: 'greenhouse', name: 'Honeycomb', slug: 'honeycomb', homepage: 'https://www.honeycomb.io', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/honeycomb/jobs?content=true' },
  { id: 'gh-hubspot', kind: 'greenhouse', name: 'HubSpot', slug: 'hubspot', homepage: 'https://www.hubspot.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/hubspot/jobs?content=true' },
  { id: 'gh-inkind', kind: 'greenhouse', name: 'inKind', slug: 'inkind', homepage: 'https://inkind.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/inkind/jobs?content=true' },
  { id: 'gh-instacart', kind: 'greenhouse', name: 'Instacart', slug: 'instacart', homepage: 'https://www.instacart.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/instacart/jobs?content=true' },
  { id: 'gh-intercom', kind: 'greenhouse', name: 'Intercom', slug: 'intercom', homepage: 'https://www.intercom.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/intercom/jobs?content=true' },
  { id: 'gh-iterable', kind: 'greenhouse', name: 'Iterable', slug: 'iterable', homepage: 'https://iterable.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/iterable/jobs?content=true' },
  { id: 'gh-kaizengaming', kind: 'greenhouse', name: 'Kaizen Gaming', slug: 'kaizengaming', homepage: 'https://www.kaizengaming.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/kaizengaming/jobs?content=true' },
  { id: 'gh-kiavi', kind: 'greenhouse', name: 'Kiavi', slug: 'kiavi', homepage: 'https://kiavi.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/kiavi/jobs?content=true' },
  { id: 'gh-klaviyo', kind: 'greenhouse', name: 'Klaviyo', slug: 'klaviyo', homepage: 'https://www.klaviyo.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/klaviyo/jobs?content=true' },
  { id: 'gh-labelbox', kind: 'greenhouse', name: 'Labelbox', slug: 'labelbox', homepage: 'https://labelbox.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/labelbox/jobs?content=true' },
  { id: 'gh-launchdarkly', kind: 'greenhouse', name: 'LaunchDarkly', slug: 'launchdarkly', homepage: 'https://launchdarkly.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/launchdarkly/jobs?content=true' },
  { id: 'gh-lightmatter', kind: 'greenhouse', name: 'Lightmatter', slug: 'lightmatter', homepage: 'https://lightmatter.co', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/lightmatter/jobs?content=true' },
  { id: 'gh-lyft', kind: 'greenhouse', name: 'Lyft', slug: 'lyft', homepage: 'https://www.lyft.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/lyft/jobs?content=true' },
  { id: 'gh-mirakl', kind: 'greenhouse', name: 'Mirakl', slug: 'mirakl', homepage: 'https://www.mirakl.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/mirakl/jobs?content=true' },
  { id: 'gh-mixpanel', kind: 'greenhouse', name: 'Mixpanel', slug: 'mixpanel', homepage: 'https://mixpanel.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/mixpanel/jobs?content=true' },
  { id: 'gh-mongodb', kind: 'greenhouse', name: 'MongoDB', slug: 'mongodb', homepage: 'https://www.mongodb.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/mongodb/jobs?content=true' },
  { id: 'gh-monzo', kind: 'greenhouse', name: 'Monzo', slug: 'monzo', homepage: 'https://monzo.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/monzo/jobs?content=true' },
  { id: 'gh-n26', kind: 'greenhouse', name: 'N26', slug: 'n26', homepage: 'https://n26.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/n26/jobs?content=true' },
  { id: 'gh-neo4j', kind: 'greenhouse', name: 'Neo4j', slug: 'neo4j', homepage: 'https://neo4j.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/neo4j/jobs?content=true' },
  { id: 'gh-netlify', kind: 'greenhouse', name: 'Netlify', slug: 'netlify', homepage: 'https://www.netlify.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/netlify/jobs?content=true' },
  { id: 'gh-newrelic', kind: 'greenhouse', name: 'New Relic', slug: 'newrelic', homepage: 'https://newrelic.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/newrelic/jobs?content=true' },
  { id: 'gh-nextdoor', kind: 'greenhouse', name: 'Nextdoor', slug: 'nextdoor', homepage: 'https://nextdoor.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/nextdoor/jobs?content=true' },
  { id: 'gh-nubank', kind: 'greenhouse', name: 'Nubank', slug: 'nubank', homepage: 'https://www.nubank.com.br', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/nubank/jobs?content=true' },
  { id: 'gh-okta', kind: 'greenhouse', name: 'Okta', slug: 'okta', homepage: 'https://www.okta.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/okta/jobs?content=true' },
  { id: 'gh-okx', kind: 'greenhouse', name: 'OKX', slug: 'OKX', homepage: 'https://okx.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/OKX/jobs?content=true' },
  { id: 'gh-orca', kind: 'greenhouse', name: 'Orca Security', slug: 'orca', homepage: 'https://orca.security', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/orca/jobs?content=true' },
  { id: 'gh-pagerduty', kind: 'greenhouse', name: 'PagerDuty', slug: 'pagerduty', homepage: 'https://www.pagerduty.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/pagerduty/jobs?content=true' },
  { id: 'gh-pendo', kind: 'greenhouse', name: 'Pendo', slug: 'pendo', homepage: 'https://www.pendo.io', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/pendo/jobs?content=true' },
  { id: 'gh-pinterest', kind: 'greenhouse', name: 'Pinterest', slug: 'pinterest', homepage: 'https://www.pinterest.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/pinterest/jobs?content=true' },
  { id: 'gh-planetscale', kind: 'greenhouse', name: 'PlanetScale', slug: 'planetscale', homepage: 'https://planetscale.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/planetscale/jobs?content=true' },
  { id: 'gh-practicebetter', kind: 'greenhouse', name: 'Practice Better', slug: 'practicebetter', homepage: 'https://practicebetter.io', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/practicebetter/jobs?content=true' },
  { id: 'gh-prisma', kind: 'greenhouse', name: 'Prisma', slug: 'prisma', homepage: 'https://www.prisma.io', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/prisma/jobs?content=true' },
  { id: 'gh-proton', kind: 'greenhouse', name: 'Proton', slug: 'proton', homepage: 'https://proton.me', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/proton/jobs?content=true' },
  { id: 'gh-pubmatic', kind: 'greenhouse', name: 'PubMatic', slug: 'pubmatic', homepage: 'https://pubmatic.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/pubmatic/jobs?content=true' },
  { id: 'gh-qualtrics', kind: 'greenhouse', name: 'Qualtrics', slug: 'qualtrics', homepage: 'https://www.qualtrics.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/qualtrics/jobs?content=true' },
  { id: 'gh-reddit', kind: 'greenhouse', name: 'Reddit', slug: 'reddit', homepage: 'https://www.reddit.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/reddit/jobs?content=true' },
  { id: 'gh-remote', kind: 'greenhouse', name: 'Remote', slug: 'remote', homepage: 'https://remote.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/remote/jobs?content=true' },
  { id: 'gh-riotgames', kind: 'greenhouse', name: 'Riot Games', slug: 'riotgames', homepage: 'https://www.riotgames.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/riotgames/jobs?content=true' },
  { id: 'gh-robinhood', kind: 'greenhouse', name: 'Robinhood', slug: 'robinhood', homepage: 'https://robinhood.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/robinhood/jobs?content=true' },
  { id: 'gh-roblox', kind: 'greenhouse', name: 'Roblox', slug: 'roblox', homepage: 'https://www.roblox.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/roblox/jobs?content=true' },
  { id: 'gh-rti', kind: 'greenhouse', name: 'Real-Time Innovations', slug: 'rti', homepage: 'https://www.rti.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/rti/jobs?content=true' },
  { id: 'gh-salesloft', kind: 'greenhouse', name: 'Salesloft', slug: 'salesloft', homepage: 'https://www.salesloft.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/salesloft/jobs?content=true' },
  { id: 'gh-scaleai', kind: 'greenhouse', name: 'Scale AI', slug: 'scaleai', homepage: 'https://scale.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true' },
  { id: 'gh-sendbird', kind: 'greenhouse', name: 'Sendbird', slug: 'sendbird', homepage: 'https://sendbird.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/sendbird/jobs?content=true' },
  { id: 'gh-sezzle', kind: 'greenhouse', name: 'Sezzle', slug: 'sezzle', homepage: 'https://sezzle.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/sezzle/jobs?content=true' },
  { id: 'gh-shifttechnology', kind: 'greenhouse', name: 'Shift Technology', slug: 'shifttechnology', homepage: 'https://www.shift-technology.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/shifttechnology/jobs?content=true' },
  { id: 'gh-sigmacomputing', kind: 'greenhouse', name: 'Sigma Computing', slug: 'sigmacomputing', homepage: 'https://www.sigmacomputing.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/sigmacomputing/jobs?content=true' },
  { id: 'gh-sofi', kind: 'greenhouse', name: 'SoFi', slug: 'sofi', homepage: 'https://www.sofi.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/sofi/jobs?content=true' },
  { id: 'gh-solutions', kind: 'greenhouse', name: 'Cadence', slug: 'solutions', homepage: 'https://www.cadence.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/solutions/jobs?content=true' },
  { id: 'gh-sovrn', kind: 'greenhouse', name: 'Sovrn', slug: 'sovrn', homepage: 'https://www.sovrn.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/sovrn/jobs?content=true' },
  { id: 'gh-spacex', kind: 'greenhouse', name: 'SpaceX', slug: 'spacex', homepage: 'https://www.spacex.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/spacex/jobs?content=true' },
  { id: 'gh-storyblok', kind: 'greenhouse', name: 'Storyblok', slug: 'storyblok', homepage: 'https://www.storyblok.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/storyblok/jobs?content=true' },
  { id: 'gh-stripe', kind: 'greenhouse', name: 'Stripe', slug: 'stripe', homepage: 'https://stripe.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true' },
  { id: 'gh-sumologic', kind: 'greenhouse', name: 'Sumo Logic', slug: 'sumologic', homepage: 'https://www.sumologic.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/sumologic/jobs?content=true' },
  { id: 'gh-taboola', kind: 'greenhouse', name: 'Taboola', slug: 'taboola', homepage: 'https://www.taboola.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/taboola/jobs?content=true' },
  { id: 'gh-tenstorrent', kind: 'greenhouse', name: 'Tenstorrent', slug: 'tenstorrent', homepage: 'https://tenstorrent.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/tenstorrent/jobs?content=true' },
  { id: 'gh-thetradedesk', kind: 'greenhouse', name: 'The Trade Desk', slug: 'thetradedesk', homepage: 'https://www.thetradedesk.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/thetradedesk/jobs?content=true' },
  { id: 'gh-thoughtworks', kind: 'greenhouse', name: 'Thoughtworks', slug: 'thoughtworks', homepage: 'https://www.thoughtworks.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/thoughtworks/jobs?content=true' },
  { id: 'gh-tigergraph', kind: 'greenhouse', name: 'TigerGraph', slug: 'tigergraph', homepage: 'https://www.tigergraph.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/tigergraph/jobs?content=true' },
  { id: 'gh-togetherai', kind: 'greenhouse', name: 'Together AI', slug: 'togetherai', homepage: 'https://www.together.ai', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/togetherai/jobs?content=true' },
  { id: 'gh-tripadvisor', kind: 'greenhouse', name: 'Tripadvisor', slug: 'tripadvisor', homepage: 'https://job-boards.greenhouse.io/tripadvisor', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/tripadvisor/jobs?content=true' },
  { id: 'gh-triplelift', kind: 'greenhouse', name: 'TripleLift', slug: 'triplelift', homepage: 'https://triplelift.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/triplelift/jobs?content=true' },
  { id: 'gh-twilio', kind: 'greenhouse', name: 'Twilio', slug: 'twilio', homepage: 'https://www.twilio.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true' },
  { id: 'gh-twitch', kind: 'greenhouse', name: 'Twitch', slug: 'twitch', homepage: 'https://job-boards.greenhouse.io/twitch', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/twitch/jobs?content=true' },
  { id: 'gh-udacity', kind: 'greenhouse', name: 'Udacity', slug: 'udacity', homepage: 'https://www.udacity.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/udacity/jobs?content=true' },
  { id: 'gh-udemy', kind: 'greenhouse', name: 'Udemy', slug: 'udemy', homepage: 'https://www.udemy.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/udemy/jobs?content=true' },
  { id: 'gh-vercel', kind: 'greenhouse', name: 'Vercel', slug: 'vercel', homepage: 'https://job-boards.greenhouse.io/vercel', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/vercel/jobs?content=true' },
  { id: 'gh-webflow', kind: 'greenhouse', name: 'Webflow', slug: 'webflow', homepage: 'https://webflow.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/webflow/jobs?content=true' },
  { id: 'gh-wise', kind: 'greenhouse', name: 'Wise', slug: 'wise', homepage: 'https://wise.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/wise/jobs?content=true' },
  { id: 'gh-wonderschool', kind: 'greenhouse', name: 'Wonderschool', slug: 'wonderschool', homepage: 'https://wonderschool.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/wonderschool/jobs?content=true' },
  { id: 'gh-xendit', kind: 'greenhouse', name: 'Xendit', slug: 'xendit', homepage: 'https://www.xendit.co', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/xendit/jobs?content=true' },
  { id: 'gh-yipitdata', kind: 'greenhouse', name: 'YipitData', slug: 'yipitdata', homepage: 'https://www.yipitdata.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/yipitdata/jobs?content=true' },
  { id: 'gh-zoominfo', kind: 'greenhouse', name: 'ZoomInfo', slug: 'zoominfo', homepage: 'https://www.zoominfo.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/zoominfo/jobs?content=true' },
  { id: 'gh-zscaler', kind: 'greenhouse', name: 'Zscaler', slug: 'zscaler', homepage: 'https://zscaler.com', checkUrl: 'https://boards-api.greenhouse.io/v1/boards/zscaler/jobs?content=true' },

  // ---- Ashby boards (bulk-verified 2026-09-25) ----
  { id: 'ashby-airbyte', kind: 'ashby', publicApi: true, name: 'Airbyte', slug: 'airbyte', homepage: 'https://airbyte.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/airbyte' },
  { id: 'ashby-airwallex', kind: 'ashby', publicApi: true, name: 'Airwallex', slug: 'airwallex', homepage: 'https://www.airwallex.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/airwallex' },
  { id: 'ashby-alchemy', kind: 'ashby', publicApi: true, name: 'Alchemy', slug: 'alchemy', homepage: 'https://alchemy.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/alchemy' },
  { id: 'ashby-alephalpha', kind: 'ashby', publicApi: true, name: 'Aleph Alpha', slug: 'AlephAlpha', homepage: 'https://www.aleph-alpha.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/AlephAlpha' },
  { id: 'ashby-anyscale', kind: 'ashby', publicApi: true, name: 'Anyscale', slug: 'anyscale', homepage: 'https://www.anyscale.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/anyscale' },
  { id: 'ashby-applied', kind: 'ashby', publicApi: true, name: 'Applied Intuition', slug: 'applied', homepage: 'https://www.applied.co', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/applied' },
  { id: 'ashby-archive', kind: 'ashby', publicApi: true, name: 'Archive', slug: 'archive', homepage: 'https://archive.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/archive' },
  { id: 'ashby-artisan', kind: 'ashby', publicApi: true, name: 'Artisan', slug: 'artisan', homepage: 'https://www.artisan.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/artisan' },
  { id: 'ashby-ashby', kind: 'ashby', publicApi: true, name: 'Ashby', slug: 'ashby', homepage: 'https://www.ashbyhq.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/ashby' },
  { id: 'ashby-astronomer', kind: 'ashby', publicApi: true, name: 'Astronomer', slug: 'astronomer', homepage: 'https://www.astronomer.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/astronomer' },
  { id: 'ashby-atlan', kind: 'ashby', publicApi: true, name: 'Atlan', slug: 'atlan', homepage: 'https://atlan.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/atlan' },
  { id: 'ashby-attio', kind: 'ashby', publicApi: true, name: 'Attio', slug: 'attio', homepage: 'https://attio.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/attio' },
  { id: 'ashby-avallon', kind: 'ashby', publicApi: true, name: 'Avallon AI', slug: 'avallon', homepage: 'https://www.avallon.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/avallon' },
  { id: 'ashby-axiom', kind: 'ashby', publicApi: true, name: 'Axiom', slug: 'axiom', homepage: 'https://axiom.co', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/axiom' },
  { id: 'ashby-baseten', kind: 'ashby', publicApi: true, name: 'Baseten', slug: 'baseten', homepage: 'https://www.baseten.co', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/baseten' },
  { id: 'ashby-benchling', kind: 'ashby', publicApi: true, name: 'Benchling', slug: 'benchling', homepage: 'https://www.benchling.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/benchling' },
  { id: 'ashby-bland', kind: 'ashby', publicApi: true, name: 'Bland', slug: 'bland', homepage: 'https://www.bland.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/bland' },
  { id: 'ashby-capchase', kind: 'ashby', publicApi: true, name: 'Capchase', slug: 'capchase', homepage: 'https://www.capchase.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/capchase' },
  { id: 'ashby-cartesia', kind: 'ashby', publicApi: true, name: 'Cartesia', slug: 'cartesia', homepage: 'https://cartesia.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/cartesia' },
  { id: 'ashby-castle', kind: 'ashby', publicApi: true, name: 'Castle', slug: 'castle', homepage: 'https://castle.finance', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/castle' },
  { id: 'ashby-cerebras', kind: 'ashby', publicApi: true, name: 'Cerebras', slug: 'cerebras', homepage: 'https://www.cerebras.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/cerebras' },
  { id: 'ashby-checkly', kind: 'ashby', publicApi: true, name: 'Checkly', slug: 'checkly', homepage: 'https://www.checklyhq.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/checkly' },
  { id: 'ashby-clerk', kind: 'ashby', publicApi: true, name: 'Clerk', slug: 'clerk', homepage: 'https://clerk.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/clerk' },
  { id: 'ashby-clickhouse', kind: 'ashby', publicApi: true, name: 'ClickHouse', slug: 'clickhouse', homepage: 'https://clickhouse.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/clickhouse' },
  { id: 'ashby-coder', kind: 'ashby', publicApi: true, name: 'Coder', slug: 'coder', homepage: 'https://coder.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/coder' },
  { id: 'ashby-cognition', kind: 'ashby', publicApi: true, name: 'Cognition', slug: 'cognition', homepage: 'https://cognition.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/cognition' },
  { id: 'ashby-cohere', kind: 'ashby', publicApi: true, name: 'Cohere', slug: 'cohere', homepage: 'https://cohere.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/cohere' },
  { id: 'ashby-column', kind: 'ashby', publicApi: true, name: 'Column', slug: 'column', homepage: 'https://column.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/column' },
  { id: 'ashby-composio', kind: 'ashby', publicApi: true, name: 'Composio', slug: 'composio', homepage: 'https://composio.dev', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/composio' },
  { id: 'ashby-cradlebio', kind: 'ashby', publicApi: true, name: 'Cradle', slug: 'cradlebio', homepage: 'https://www.cradle.bio', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/cradlebio' },
  { id: 'ashby-cursor', kind: 'ashby', publicApi: true, name: 'Cursor', slug: 'cursor', homepage: 'https://www.cursor.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/cursor' },
  { id: 'ashby-datafold', kind: 'ashby', publicApi: true, name: 'Datafold', slug: 'datafold', homepage: 'https://www.datafold.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/datafold' },
  { id: 'ashby-decagon', kind: 'ashby', publicApi: true, name: 'Decagon', slug: 'decagon', homepage: 'https://www.decagon.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/decagon' },
  { id: 'ashby-deel', kind: 'ashby', publicApi: true, name: 'Deel', slug: 'deel', homepage: 'https://www.deel.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/deel' },
  { id: 'ashby-deepl', kind: 'ashby', publicApi: true, name: 'DeepL', slug: 'DeepL', homepage: 'https://www.deepl.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/DeepL' },
  { id: 'ashby-dehazelabs', kind: 'ashby', publicApi: true, name: 'DehazeLabs', slug: 'DehazeLabs', homepage: 'https://www.dehazelabs.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/DehazeLabs' },
  { id: 'ashby-ditto', kind: 'ashby', publicApi: true, name: 'Ditto Insurance', slug: 'ditto', homepage: 'https://joinditto.in', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/ditto' },
  { id: 'ashby-dmatrix', kind: 'ashby', publicApi: true, name: 'd-Matrix', slug: 'd-Matrix', homepage: 'https://www.d-matrix.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/d-Matrix' },
  { id: 'ashby-docker', kind: 'ashby', publicApi: true, name: 'Docker', slug: 'docker', homepage: 'https://www.docker.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/docker' },
  { id: 'ashby-drata', kind: 'ashby', publicApi: true, name: 'Drata', slug: 'drata', homepage: 'https://jobs.ashbyhq.com/drata', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/drata' },
  { id: 'ashby-drivewealth', kind: 'ashby', publicApi: true, name: 'DriveWealth', slug: 'drivewealth', homepage: 'https://drivewealth.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/drivewealth' },
  { id: 'ashby-dust', kind: 'ashby', publicApi: true, name: 'Dust', slug: 'dust', homepage: 'https://dust.tt', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/dust' },
  { id: 'ashby-elevenlabs', kind: 'ashby', publicApi: true, name: 'ElevenLabs', slug: 'elevenlabs', homepage: 'https://elevenlabs.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/elevenlabs' },
  { id: 'ashby-fireworks', kind: 'ashby', publicApi: true, name: 'Fireworks AI', slug: 'fireworks', homepage: 'https://fireworks.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/fireworks' },
  { id: 'ashby-float', kind: 'ashby', publicApi: true, name: 'Float', slug: 'float', homepage: 'https://www.floatfinancial.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/float' },
  { id: 'ashby-freshpaint', kind: 'ashby', publicApi: true, name: 'Freshpaint', slug: 'freshpaint', homepage: 'https://www.freshpaint.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/freshpaint' },
  { id: 'ashby-furtherai', kind: 'ashby', publicApi: true, name: 'FurtherAI', slug: 'furtherai', homepage: 'https://www.further.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/furtherai' },
  { id: 'ashby-gorgias', kind: 'ashby', publicApi: true, name: 'Gorgias', slug: 'gorgias', homepage: 'https://www.gorgias.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/gorgias' },
  { id: 'ashby-granola', kind: 'ashby', publicApi: true, name: 'Granola', slug: 'granola', homepage: 'https://www.granola.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/granola' },
  { id: 'ashby-harvey', kind: 'ashby', publicApi: true, name: 'Harvey', slug: 'harvey', homepage: 'https://www.harvey.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/harvey' },
  { id: 'ashby-hex', kind: 'ashby', publicApi: true, name: 'Hex', slug: 'hex', homepage: 'https://hex.tech', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/hex' },
  { id: 'ashby-hightouch', kind: 'ashby', publicApi: true, name: 'Hightouch', slug: 'hightouch', homepage: 'https://hightouch.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/hightouch' },
  { id: 'ashby-hiveco', kind: 'ashby', publicApi: true, name: 'Hive', slug: 'hive.co', homepage: 'https://www.hive.co', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/hive.co' },
  { id: 'ashby-humanitec', kind: 'ashby', publicApi: true, name: 'Humanitec', slug: 'humanitec', homepage: 'https://humanitec.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/humanitec' },
  { id: 'ashby-ideogram', kind: 'ashby', publicApi: true, name: 'Ideogram', slug: 'ideogram', homepage: 'https://jobs.ashbyhq.com/ideogram', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/ideogram' },
  { id: 'ashby-influxdata', kind: 'ashby', publicApi: true, name: 'InfluxData', slug: 'influxdata', homepage: 'https://www.influxdata.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/influxdata' },
  { id: 'ashby-inngest', kind: 'ashby', publicApi: true, name: 'Inngest', slug: 'inngest', homepage: 'https://www.inngest.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/inngest' },
  { id: 'ashby-knock', kind: 'ashby', publicApi: true, name: 'Knock', slug: 'knock', homepage: 'https://knock.app', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/knock' },
  { id: 'ashby-lancedb', kind: 'ashby', publicApi: true, name: 'LanceDB', slug: 'lancedb', homepage: 'https://lancedb.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/lancedb' },
  { id: 'ashby-langchain', kind: 'ashby', publicApi: true, name: 'LangChain', slug: 'langchain', homepage: 'https://www.langchain.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/langchain' },
  { id: 'ashby-langfuse', kind: 'ashby', publicApi: true, name: 'Langfuse', slug: 'langfuse', homepage: 'https://langfuse.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/langfuse' },
  { id: 'ashby-lgads', kind: 'ashby', publicApi: true, name: 'LG Ad Solutions', slug: 'lgads', homepage: 'https://www.lgads.tv', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/lgads' },
  { id: 'ashby-lightdash', kind: 'ashby', publicApi: true, name: 'Lightdash', slug: 'lightdash', homepage: 'https://www.lightdash.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/lightdash' },
  { id: 'ashby-linear', kind: 'ashby', publicApi: true, name: 'Linear', slug: 'linear', homepage: 'https://linear.app', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/linear' },
  { id: 'ashby-llamaindex', kind: 'ashby', publicApi: true, name: 'LlamaIndex', slug: 'llamaindex', homepage: 'https://llamaindex.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/llamaindex' },
  { id: 'ashby-lovable', kind: 'ashby', publicApi: true, name: 'Lovable', slug: 'lovable', homepage: 'https://jobs.ashbyhq.com/lovable', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/lovable' },
  { id: 'ashby-materialize', kind: 'ashby', publicApi: true, name: 'Materialize', slug: 'materialize', homepage: 'https://materialize.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/materialize' },
  { id: 'ashby-meow', kind: 'ashby', publicApi: true, name: 'Meow', slug: 'meow', homepage: 'https://www.meow.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/meow' },
  { id: 'ashby-mercury', kind: 'ashby', publicApi: true, name: 'Mercury', slug: 'mercury', homepage: 'https://mercury.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/mercury' },
  { id: 'ashby-method', kind: 'ashby', publicApi: true, name: 'Method', slug: 'method', homepage: 'https://methodfi.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/method' },
  { id: 'ashby-middesk', kind: 'ashby', publicApi: true, name: 'Middesk', slug: 'middesk', homepage: 'https://www.middesk.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/middesk' },
  { id: 'ashby-midjourney', kind: 'ashby', publicApi: true, name: 'Midjourney', slug: 'midjourney', homepage: 'https://jobs.ashbyhq.com/midjourney', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/midjourney' },
  { id: 'ashby-modal', kind: 'ashby', publicApi: true, name: 'Modal', slug: 'modal', homepage: 'https://modal.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/modal' },
  { id: 'ashby-moderntreasury', kind: 'ashby', publicApi: true, name: 'Modern Treasury', slug: 'moderntreasury', homepage: 'https://www.moderntreasury.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/moderntreasury' },
  { id: 'ashby-montecarlodata', kind: 'ashby', publicApi: true, name: 'Monte Carlo', slug: 'montecarlodata', homepage: 'https://montecarlodata.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/montecarlodata' },
  { id: 'ashby-motherduck', kind: 'ashby', publicApi: true, name: 'MotherDuck', slug: 'motherduck', homepage: 'https://motherduck.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/motherduck' },
  { id: 'ashby-mudflap', kind: 'ashby', publicApi: true, name: 'Mudflap', slug: 'mudflap', homepage: 'https://www.mudflapinc.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/mudflap' },
  { id: 'ashby-n8n', kind: 'ashby', publicApi: true, name: 'n8n', slug: 'n8n', homepage: 'https://n8n.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/n8n' },
  { id: 'ashby-nanonets', kind: 'ashby', publicApi: true, name: 'Nanonets', slug: 'nanonets', homepage: 'https://nanonets.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/nanonets' },
  { id: 'ashby-navi', kind: 'ashby', publicApi: true, name: 'Navi', slug: 'navi', homepage: 'https://www.navi.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/navi' },
  { id: 'ashby-nexxa', kind: 'ashby', publicApi: true, name: 'Nexxa', slug: 'nexxa', homepage: 'https://nexxa.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/nexxa' },
  { id: 'ashby-notion', kind: 'ashby', publicApi: true, name: 'Notion', slug: 'notion', homepage: 'https://www.notion.so', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/notion' },
  { id: 'ashby-openai', kind: 'ashby', publicApi: true, name: 'OpenAI', slug: 'openai', homepage: 'https://openai.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/openai' },
  { id: 'ashby-opslevel', kind: 'ashby', publicApi: true, name: 'OpsLevel', slug: 'opslevel', homepage: 'https://www.opslevel.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/opslevel' },
  { id: 'ashby-orum', kind: 'ashby', publicApi: true, name: 'Orum', slug: 'orum', homepage: 'https://orum.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/orum' },
  { id: 'ashby-oyster', kind: 'ashby', publicApi: true, name: 'Oyster HR', slug: 'oyster', homepage: 'https://www.oysterhr.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/oyster' },
  { id: 'ashby-parafin', kind: 'ashby', publicApi: true, name: 'Parafin', slug: 'parafin', homepage: 'https://www.parafin.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/parafin' },
  { id: 'ashby-permitflow', kind: 'ashby', publicApi: true, name: 'PermitFlow', slug: 'permitflow', homepage: 'https://www.permitflow.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/permitflow' },
  { id: 'ashby-perplexity', kind: 'ashby', publicApi: true, name: 'Perplexity AI', slug: 'perplexity', homepage: 'https://www.perplexity.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/perplexity' },
  { id: 'ashby-persona', kind: 'ashby', publicApi: true, name: 'Persona', slug: 'persona', homepage: 'https://withpersona.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/persona' },
  { id: 'ashby-phasebiolabs', kind: 'ashby', publicApi: true, name: 'Phase Biolabs', slug: 'phasebiolabs', homepage: 'https://jobs.ashbyhq.com/phasebiolabs', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/phasebiolabs' },
  { id: 'ashby-pika', kind: 'ashby', publicApi: true, name: 'Pika', slug: 'pika', homepage: 'https://pika.art', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/pika' },
  { id: 'ashby-pinecone', kind: 'ashby', publicApi: true, name: 'Pinecone', slug: 'pinecone', homepage: 'https://pinecone.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/pinecone' },
  { id: 'ashby-plaid', kind: 'ashby', publicApi: true, name: 'Plaid', slug: 'plaid', homepage: 'https://plaid.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/plaid' },
  { id: 'ashby-posthog', kind: 'ashby', publicApi: true, name: 'PostHog', slug: 'posthog', homepage: 'https://posthog.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/posthog' },
  { id: 'ashby-prefect', kind: 'ashby', publicApi: true, name: 'Prefect', slug: 'prefect', homepage: 'https://www.prefect.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/prefect' },
  { id: 'ashby-railway', kind: 'ashby', publicApi: true, name: 'Railway', slug: 'railway', homepage: 'https://railway.app', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/railway' },
  { id: 'ashby-ramp', kind: 'ashby', publicApi: true, name: 'Ramp', slug: 'ramp', homepage: 'https://ramp.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/ramp' },
  { id: 'ashby-rasa', kind: 'ashby', publicApi: true, name: 'Rasa', slug: 'rasa', homepage: 'https://rasa.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/rasa' },
  { id: 'ashby-raycast', kind: 'ashby', publicApi: true, name: 'Raycast', slug: 'raycast', homepage: 'https://www.raycast.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/raycast' },
  { id: 'ashby-reducto', kind: 'ashby', publicApi: true, name: 'Reducto', slug: 'reducto', homepage: 'https://reducto.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/reducto' },
  { id: 'ashby-render', kind: 'ashby', publicApi: true, name: 'Render', slug: 'render', homepage: 'https://render.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/render' },
  { id: 'ashby-replit', kind: 'ashby', publicApi: true, name: 'Replit', slug: 'replit', homepage: 'https://replit.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/replit' },
  { id: 'ashby-resend', kind: 'ashby', publicApi: true, name: 'Resend', slug: 'resend', homepage: 'https://resend.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/resend' },
  { id: 'ashby-revenuecat', kind: 'ashby', publicApi: true, name: 'RevenueCat', slug: 'revenuecat', homepage: 'https://revenuecat.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/revenuecat' },
  { id: 'ashby-runpod', kind: 'ashby', publicApi: true, name: 'RunPod', slug: 'runpod', homepage: 'https://runpod.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/runpod' },
  { id: 'ashby-runwayml', kind: 'ashby', publicApi: true, name: 'Runway', slug: 'runway-ml', homepage: 'https://runwayml.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/runway-ml' },
  { id: 'ashby-sanity', kind: 'ashby', publicApi: true, name: 'Sanity', slug: 'sanity', homepage: 'https://www.sanity.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/sanity' },
  { id: 'ashby-sardine', kind: 'ashby', publicApi: true, name: 'Sardine', slug: 'sardine', homepage: 'https://www.sardine.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/sardine' },
  { id: 'ashby-sarvam', kind: 'ashby', publicApi: true, name: 'Sarvam AI', slug: 'sarvam', homepage: 'https://www.sarvam.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/sarvam' },
  { id: 'ashby-semgrep', kind: 'ashby', publicApi: true, name: 'Semgrep', slug: 'semgrep', homepage: 'https://semgrep.dev', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/semgrep' },
  { id: 'ashby-sentry', kind: 'ashby', publicApi: true, name: 'Sentry', slug: 'sentry', homepage: 'https://sentry.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/sentry' },
  { id: 'ashby-sierra', kind: 'ashby', publicApi: true, name: 'Sierra', slug: 'sierra', homepage: 'https://sierra.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/sierra' },
  { id: 'ashby-signoz', kind: 'ashby', publicApi: true, name: 'SigNoz', slug: 'signoz', homepage: 'https://signoz.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/signoz' },
  { id: 'ashby-socket', kind: 'ashby', publicApi: true, name: 'Socket', slug: 'socket', homepage: 'https://socket.dev', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/socket' },
  { id: 'ashby-solidroad', kind: 'ashby', publicApi: true, name: 'Solidroad', slug: 'solidroad', homepage: 'https://solidroad.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/solidroad' },
  { id: 'ashby-sphinx', kind: 'ashby', publicApi: true, name: 'Sphinx', slug: 'Sphinx', homepage: 'https://www.sphinx.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/Sphinx' },
  { id: 'ashby-stradahq', kind: 'ashby', publicApi: true, name: 'Strada', slug: 'stradahq', homepage: 'https://jobs.ashbyhq.com/stradahq', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/stradahq' },
  { id: 'ashby-stytch', kind: 'ashby', publicApi: true, name: 'Stytch', slug: 'stytch', homepage: 'https://stytch.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/stytch' },
  { id: 'ashby-suno', kind: 'ashby', publicApi: true, name: 'Suno', slug: 'suno', homepage: 'https://suno.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/suno' },
  { id: 'ashby-supabase', kind: 'ashby', publicApi: true, name: 'Supabase', slug: 'supabase', homepage: 'https://supabase.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/supabase' },
  { id: 'ashby-synctera', kind: 'ashby', publicApi: true, name: 'Synctera', slug: 'synctera', homepage: 'https://www.synctera.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/synctera' },
  { id: 'ashby-synthesia', kind: 'ashby', publicApi: true, name: 'Synthesia', slug: 'synthesia', homepage: 'https://www.synthesia.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/synthesia' },
  { id: 'ashby-tavus', kind: 'ashby', publicApi: true, name: 'Tavus', slug: 'tavus', homepage: 'https://www.tavus.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/tavus' },
  { id: 'ashby-temporal', kind: 'ashby', publicApi: true, name: 'Temporal', slug: 'temporal', homepage: 'https://temporal.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/temporal' },
  { id: 'ashby-tensorwave', kind: 'ashby', publicApi: true, name: 'TensorWave', slug: 'TensorWave', homepage: 'https://www.tensorwave.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/TensorWave' },
  { id: 'ashby-tilthq', kind: 'ashby', publicApi: true, name: 'Tilt', slug: 'tilthq', homepage: 'https://jobs.ashbyhq.com/tilthq', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/tilthq' },
  { id: 'ashby-unify', kind: 'ashby', publicApi: true, name: 'Unify', slug: 'unify', homepage: 'https://unify.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/unify' },
  { id: 'ashby-unit', kind: 'ashby', publicApi: true, name: 'Unit', slug: 'unit', homepage: 'https://unit.co', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/unit' },
  { id: 'ashby-vanta', kind: 'ashby', publicApi: true, name: 'Vanta', slug: 'vanta', homepage: 'https://www.vanta.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/vanta' },
  { id: 'ashby-vapi', kind: 'ashby', publicApi: true, name: 'Vapi', slug: 'vapi', homepage: 'https://vapi.ai', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/vapi' },
  { id: 'ashby-warp', kind: 'ashby', publicApi: true, name: 'Warp', slug: 'warp', homepage: 'https://www.warp.dev', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/warp' },
  { id: 'ashby-wayflyer', kind: 'ashby', publicApi: true, name: 'Wayflyer', slug: 'wayflyer', homepage: 'https://www.wayflyer.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/wayflyer' },
  { id: 'ashby-weaviate', kind: 'ashby', publicApi: true, name: 'Weaviate', slug: 'weaviate', homepage: 'https://weaviate.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/weaviate' },
  { id: 'ashby-wiz', kind: 'ashby', publicApi: true, name: 'Wiz', slug: 'wiz', homepage: 'https://www.wiz.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/wiz' },
  { id: 'ashby-workos', kind: 'ashby', publicApi: true, name: 'WorkOS', slug: 'workos', homepage: 'https://workos.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/workos' },
  { id: 'ashby-worldly', kind: 'ashby', publicApi: true, name: 'Worldly', slug: 'worldly', homepage: 'https://www.worldly.io', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/worldly' },
  { id: 'ashby-ycombinator', kind: 'ashby', publicApi: true, name: 'Y Combinator', slug: 'ycombinator', homepage: 'https://www.ycombinator.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/ycombinator' },
  { id: 'ashby-yendo', kind: 'ashby', publicApi: true, name: 'Yendo', slug: 'yendo', homepage: 'https://yendo.com', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/yendo' },
  { id: 'ashby-zed', kind: 'ashby', publicApi: true, name: 'Zed', slug: 'zed', homepage: 'https://zed.dev', checkUrl: 'https://api.ashbyhq.com/posting-api/job-board/zed' },

  // ---- Keka boards (bulk-verified 2026-09-25) ----
  { id: 'keka-academian', kind: 'keka', name: 'Academian', tenant: 'academian', homepage: 'https://academian.com', checkUrl: 'https://academian.keka.com/careers' },
  { id: 'keka-acsii', kind: 'keka', name: 'ACS International India', tenant: 'acsii', homepage: 'https://acsii.keka.com/careers', checkUrl: 'https://acsii.keka.com/careers' },
  { id: 'keka-akaike', kind: 'keka', name: 'Akaike Technologies', tenant: 'akaike', homepage: 'https://akaike.keka.com/careers', checkUrl: 'https://akaike.keka.com/careers' },
  { id: 'keka-athenainfonomics', kind: 'keka', name: 'Athena Infonomics', tenant: 'athenainfonomics', homepage: 'https://athenainfonomics.com', checkUrl: 'https://athenainfonomics.keka.com/careers' },
  { id: 'keka-avengers', kind: 'keka', name: 'Avengers', tenant: 'avengers', homepage: 'https://avengers.keka.com/careers', checkUrl: 'https://avengers.keka.com/careers' },
  { id: 'keka-beyondkey', kind: 'keka', name: 'Beyond Key', tenant: 'beyondkey', homepage: 'https://beyondkey.com', checkUrl: 'https://beyondkey.keka.com/careers' },
  { id: 'keka-beyondroot', kind: 'keka', name: 'Beyond Root Technologies', tenant: 'beyondroot', homepage: 'https://beyondroot.keka.com/careers', checkUrl: 'https://beyondroot.keka.com/careers' },
  { id: 'keka-brandstory', kind: 'keka', name: 'BrandStory', tenant: 'brandstory', homepage: 'https://brandstory.keka.com/careers', checkUrl: 'https://brandstory.keka.com/careers' },
  { id: 'keka-clickpost', kind: 'keka', name: 'ClickPost', tenant: 'clickpost', homepage: 'https://clickpost.ai', checkUrl: 'https://clickpost.keka.com/careers' },
  { id: 'keka-cloudesign', kind: 'keka', name: 'Cloudesign', tenant: 'cloudesign', homepage: 'https://cloudesign.keka.com/careers', checkUrl: 'https://cloudesign.keka.com/careers' },
  { id: 'keka-cloudkaptan', kind: 'keka', name: 'CloudKaptan', tenant: 'cloudkaptan', homepage: 'https://cloudkaptan.com', checkUrl: 'https://cloudkaptan.keka.com/careers' },
  { id: 'keka-codewinglet', kind: 'keka', name: 'Codewinglet', tenant: 'codewinglet', homepage: 'https://codewinglet.com', checkUrl: 'https://codewinglet.keka.com/careers' },
  { id: 'keka-conneqtiongroup', kind: 'keka', name: 'Conneqtion Group', tenant: 'conneqtiongroup', homepage: 'https://conneqtiongroup.com', checkUrl: 'https://conneqtiongroup.keka.com/careers' },
  { id: 'keka-dayalgroup', kind: 'keka', name: 'Dayal Infosystems', tenant: 'dayalgroup', homepage: 'https://dayalgroup.keka.com/careers', checkUrl: 'https://dayalgroup.keka.com/careers' },
  { id: 'keka-deccanaiauto', kind: 'keka', name: 'Deccan AI', tenant: 'deccanaiauto', homepage: 'https://deccan.ai', checkUrl: 'https://deccanaiauto.keka.com/careers' },
  { id: 'keka-enablistar', kind: 'keka', name: 'Enablistar', tenant: 'enablistar', homepage: 'https://enablistar.com', checkUrl: 'https://enablistar.keka.com/careers' },
  { id: 'keka-entropik', kind: 'keka', name: 'Entropik', tenant: 'entropik', homepage: 'https://entropik.keka.com/careers', checkUrl: 'https://entropik.keka.com/careers' },
  { id: 'keka-everestims', kind: 'keka', name: 'EverestIMS Technologies', tenant: 'everestims', homepage: 'https://everestims.com', checkUrl: 'https://everestims.keka.com/careers' },
  { id: 'keka-finacplus', kind: 'keka', name: 'FinacPlus', tenant: 'finacplus', homepage: 'https://finacplus.com', checkUrl: 'https://finacplus.keka.com/careers' },
  { id: 'keka-fynd', kind: 'keka', name: 'Fynd', tenant: 'fynd', homepage: 'https://fynd.com', checkUrl: 'https://fynd.keka.com/careers' },
  { id: 'keka-gameberry', kind: 'keka', name: 'Gameberry Labs', tenant: 'gameberry', homepage: 'https://gameberry.keka.com/careers', checkUrl: 'https://gameberry.keka.com/careers' },
  { id: 'keka-grow', kind: 'keka', name: 'Grow Solutions', tenant: 'grow', homepage: 'https://growsolutions.in', checkUrl: 'https://grow.keka.com/careers' },
  { id: 'keka-idreamcareer', kind: 'keka', name: 'iDreamCareer', tenant: 'idreamcareer', homepage: 'https://idreamcareer.keka.com/careers', checkUrl: 'https://idreamcareer.keka.com/careers' },
  { id: 'keka-impactanalytics', kind: 'keka', name: 'Impact Analytics', tenant: 'impactanalytics', homepage: 'https://impactanalytics.co', checkUrl: 'https://impactanalytics.keka.com/careers' },
  { id: 'keka-impronics', kind: 'keka', name: 'Impronics', tenant: 'impronics', homepage: 'https://impronics.keka.com/careers', checkUrl: 'https://impronics.keka.com/careers' },
  { id: 'keka-intentwise', kind: 'keka', name: 'Intentwise', tenant: 'intentwise', homepage: 'https://intentwise.com', checkUrl: 'https://intentwise.keka.com/careers' },
  { id: 'keka-irsl', kind: 'keka', name: 'IRIS RegTech Solutions', tenant: 'irsl', homepage: 'https://irsl.keka.com/careers', checkUrl: 'https://irsl.keka.com/careers' },
  { id: 'keka-kapturecrm', kind: 'keka', name: 'Kapture CX', tenant: 'kapturecrm', homepage: 'https://kapturecrm.keka.com/careers', checkUrl: 'https://kapturecrm.keka.com/careers' },
  { id: 'keka-kinsfolk', kind: 'keka', name: 'Kinsfolk', tenant: 'kinsfolk', homepage: 'https://kinsfolksolutions.com', checkUrl: 'https://kinsfolk.keka.com/careers' },
  { id: 'keka-lambdatest', kind: 'keka', name: 'LambdaTest', tenant: 'lambdatest', homepage: 'https://lambdatest.keka.com/careers', checkUrl: 'https://lambdatest.keka.com/careers' },
  { id: 'keka-logicwind', kind: 'keka', name: 'Logicwind', tenant: 'logicwind', homepage: 'https://logicwind.com', checkUrl: 'https://logicwind.keka.com/careers' },
  { id: 'keka-lumel', kind: 'keka', name: 'Lumel', tenant: 'lumel', homepage: 'https://lumel.com', checkUrl: 'https://lumel.keka.com/careers' },
  { id: 'keka-makunaiglobal', kind: 'keka', name: 'Makunai Global', tenant: 'makunaiglobal', homepage: 'https://makunaiglobal.keka.com/careers', checkUrl: 'https://makunaiglobal.keka.com/careers' },
  { id: 'keka-niyo', kind: 'keka', name: 'Niyo', tenant: 'niyo', homepage: 'https://niyo.keka.com/careers', checkUrl: 'https://niyo.keka.com/careers' },
  { id: 'keka-occamsadvisory', kind: 'keka', name: 'Occams Advisory', tenant: 'occamsadvisory', homepage: 'https://occamsadvisory.com', checkUrl: 'https://occamsadvisory.keka.com/careers' },
  { id: 'keka-oneplus', kind: 'keka', name: 'OnePlus India', tenant: 'oneplus', homepage: 'https://oneplus.keka.com/careers', checkUrl: 'https://oneplus.keka.com/careers' },
  { id: 'keka-pcsinfinity', kind: 'keka', name: 'PcsInfinity', tenant: 'pcsinfinity', homepage: 'https://pcsinfinity.keka.com/careers', checkUrl: 'https://pcsinfinity.keka.com/careers' },
  { id: 'keka-pennanttech', kind: 'keka', name: 'Pennant Technologies', tenant: 'pennanttech', homepage: 'https://pennanttech.keka.com/careers', checkUrl: 'https://pennanttech.keka.com/careers' },
  { id: 'keka-primetrace', kind: 'keka', name: 'Primetrace', tenant: 'primetrace', homepage: 'https://primetrace.keka.com/careers', checkUrl: 'https://primetrace.keka.com/careers' },
  { id: 'keka-prismforce', kind: 'keka', name: 'Prismforce', tenant: 'prismforce', homepage: 'https://prismforce.keka.com/careers', checkUrl: 'https://prismforce.keka.com/careers' },
  { id: 'keka-proclinkconsulting', kind: 'keka', name: 'Proclink Consulting', tenant: 'proclinkconsulting', homepage: 'https://proclinkconsulting.keka.com/careers', checkUrl: 'https://proclinkconsulting.keka.com/careers' },
  { id: 'keka-qodoro', kind: 'keka', name: 'Qodoro', tenant: 'qodoro', homepage: 'https://qodoro.com', checkUrl: 'https://qodoro.keka.com/careers' },
  { id: 'keka-qualminds', kind: 'keka', name: 'QualMinds', tenant: 'qualminds', homepage: 'https://qualminds.com', checkUrl: 'https://qualminds.keka.com/careers' },
  { id: 'keka-queuebuster', kind: 'keka', name: 'QueueBuster', tenant: 'queuebuster', homepage: 'https://queuebuster.keka.com/careers', checkUrl: 'https://queuebuster.keka.com/careers' },
  { id: 'keka-rigi', kind: 'keka', name: 'Rigi', tenant: 'rigi', homepage: 'https://rigi.keka.com/careers', checkUrl: 'https://rigi.keka.com/careers' },
  { id: 'keka-saneforce', kind: 'keka', name: 'SANeForce', tenant: 'saneforce', homepage: 'https://saneforce.keka.com/careers', checkUrl: 'https://saneforce.keka.com/careers' },
  { id: 'keka-sisinty', kind: 'keka', name: 'GrowthSchool', tenant: 'sisinty', homepage: 'https://sisinty.keka.com/careers', checkUrl: 'https://sisinty.keka.com/careers' },
  { id: 'keka-softlinkglobal', kind: 'keka', name: 'Softlink Global', tenant: 'softlinkglobal', homepage: 'https://softlinkglobal.com', checkUrl: 'https://softlinkglobal.keka.com/careers' },
  { id: 'keka-spyneai', kind: 'keka', name: 'Spyne', tenant: 'spyneai', homepage: 'https://spyneai.keka.com/careers', checkUrl: 'https://spyneai.keka.com/careers' },
  { id: 'keka-supplychainhub', kind: 'keka', name: 'SupplyChainHub', tenant: 'supplychainhub', homepage: 'https://supplychainhub.keka.com/careers', checkUrl: 'https://supplychainhub.keka.com/careers' },
  { id: 'keka-surveysparrow', kind: 'keka', name: 'SurveySparrow', tenant: 'surveysparrow', homepage: 'https://surveysparrow.keka.com/careers', checkUrl: 'https://surveysparrow.keka.com/careers' },
  { id: 'keka-talakunchi', kind: 'keka', name: 'Talakunchi', tenant: 'talakunchi', homepage: 'https://talakunchi.com', checkUrl: 'https://talakunchi.keka.com/careers' },
  { id: 'keka-tarento', kind: 'keka', name: 'Tarento', tenant: 'tarento', homepage: 'https://tarento.com', checkUrl: 'https://tarento.keka.com/careers' },
  { id: 'keka-techblocks', kind: 'keka', name: 'TechBlocks', tenant: 'techblocks', homepage: 'https://techblocks.com', checkUrl: 'https://techblocks.keka.com/careers' },
  { id: 'keka-techdome', kind: 'keka', name: 'Techdome', tenant: 'techdome', homepage: 'https://techdome.keka.com/careers', checkUrl: 'https://techdome.keka.com/careers' },
  { id: 'keka-tekmindz', kind: 'keka', name: 'TekMindz', tenant: 'tekmindz', homepage: 'https://tekmindz.keka.com/careers', checkUrl: 'https://tekmindz.keka.com/careers' },
  { id: 'keka-thoughtfocus', kind: 'keka', name: 'ThoughtFocus', tenant: 'thoughtfocus', homepage: 'https://thoughtfocus.com', checkUrl: 'https://thoughtfocus.keka.com/careers' },
  { id: 'keka-toddle', kind: 'keka', name: 'Toddle', tenant: 'toddle', homepage: 'https://toddleapp.com', checkUrl: 'https://toddle.keka.com/careers' },
  { id: 'keka-truagency', kind: 'keka', name: 'Tru Inc', tenant: 'truagency', homepage: 'https://truagency.com', checkUrl: 'https://truagency.keka.com/careers' },
  { id: 'keka-valorem', kind: 'keka', name: 'FloBiz', tenant: 'valorem', homepage: 'https://valorem.keka.com/careers', checkUrl: 'https://valorem.keka.com/careers' },
  { id: 'keka-voidsolutions', kind: 'keka', name: 'Void Solutions', tenant: 'voidsolutions', homepage: 'https://voidsolutions.keka.com/careers', checkUrl: 'https://voidsolutions.keka.com/careers' },
  { id: 'keka-vyaparapp', kind: 'keka', name: 'Vyapar', tenant: 'vyaparapp', homepage: 'https://vyaparapp.keka.com/careers', checkUrl: 'https://vyaparapp.keka.com/careers' },
  { id: 'keka-wohlig', kind: 'keka', name: 'Wohlig', tenant: 'wohlig', homepage: 'https://wohlig.com', checkUrl: 'https://wohlig.keka.com/careers' },
  { id: 'keka-zocket', kind: 'keka', name: 'Zocket', tenant: 'zocket', homepage: 'https://zocket.keka.com/careers', checkUrl: 'https://zocket.keka.com/careers' },
  { id: 'keka-zono', kind: 'keka', name: 'Zono', tenant: 'zono', homepage: 'https://zono.keka.com/careers', checkUrl: 'https://zono.keka.com/careers' },
  // ---- Govt notice boards (official recruitment pages; robots.txt verified
  // per-origin at runtime, fail-closed. SSC's JSON API needs an undocumented
  // attribute whitelist from its lazy JS chunk — parked, UPSC used instead.
  // IOCL sits behind a JS challenge: included for completeness, the adapter
  // returns [] until a JS-capable fetcher exists.)
  { id: 'govt-npcil', kind: 'govt', feed: 'html', name: 'NPCIL', homepage: 'https://npcil.nic.in', noticePage: 'https://npcil.nic.in/content/289_1_Opportunities.aspx', checkUrl: 'https://npcil.nic.in/content/289_1_Opportunities.aspx' },
  { id: 'govt-bpcl', kind: 'govt', feed: 'html', name: 'BPCL', homepage: 'https://www.bharatpetroleum.in', noticePage: 'https://www.bharatpetroleum.in/Careers/Job-Openings.aspx', checkUrl: 'https://www.bharatpetroleum.in/Careers/Job-Openings.aspx' },
  { id: 'govt-hpcl', kind: 'govt', feed: 'html', name: 'HPCL', homepage: 'https://www.hindustanpetroleum.com', noticePage: 'https://www.hindustanpetroleum.com/job-openings', checkUrl: 'https://www.hindustanpetroleum.com/job-openings' },
  { id: 'govt-cdac', kind: 'govt', feed: 'html', name: 'C-DAC', homepage: 'https://cdac.in', noticePage: 'https://cdac.in/index.aspx?id=current_jobs', checkUrl: 'https://cdac.in/index.aspx?id=current_jobs' },
  { id: 'govt-pgcil', kind: 'govt', feed: 'html', name: 'PowerGrid', homepage: 'https://www.powergrid.in', noticePage: 'https://www.powergrid.in/en/job-opportunities', checkUrl: 'https://www.powergrid.in/en/job-opportunities' },
  { id: 'govt-iocl', kind: 'govt', feed: 'html', name: 'IOCL', homepage: 'https://iocl.com', noticePage: 'https://iocl.com/latest-job-opening', checkUrl: 'https://iocl.com/latest-job-opening' },
  { id: 'govt-sbi', kind: 'govt', feed: 'html', name: 'SBI', homepage: 'https://sbi.bank.in', noticePage: 'https://sbi.bank.in/web/careers/current-openings', checkUrl: 'https://sbi.bank.in/web/careers/current-openings' },
  { id: 'govt-ibps', kind: 'govt', feed: 'html', name: 'IBPS', homepage: 'https://www.ibps.in', noticePage: 'https://www.ibps.in/', checkUrl: 'https://www.ibps.in/' },
  { id: 'govt-lic', kind: 'govt', feed: 'html', name: 'LIC', homepage: 'https://licindia.in', noticePage: 'https://licindia.in/careers', checkUrl: 'https://licindia.in/careers' },
  { id: 'govt-upsc', kind: 'govt', feed: 'html', name: 'UPSC', homepage: 'https://upsc.gov.in', noticePage: 'https://upsc.gov.in/whats-new', checkUrl: 'https://upsc.gov.in/whats-new' },

  // ---- HireDoor (public server-rendered listing pages; robots.txt allows
  // /jobs and /latest-jobs, disallows /api/* -> HTML only, 3 pages max)
  { id: 'hiredoor', kind: 'hiredoor', name: 'HireDoor', pages: 5, maxJobs: 40, checkUrl: 'https://hiredoor.in/jobs' }
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripHtml(html) {
  return decodeEntities(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

export function unique(arr) {
  return [...new Set(arr)];
}

// India location matching
export function isIndiaLocation(locationStr) {
  if (!locationStr) return true; // many remote/unspecified postings are open to India
  const loc = locationStr.toLowerCase();
  const indiaKeywords = [
    'india', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'gurgaon', 'gurugram',
    'noida', 'delhi', 'mumbai', 'chennai', 'kolkata', 'kochi', 'remote', 'ahmedabad'
  ];
  return indiaKeywords.some((k) => loc.includes(k));
}

// Fresher role title heuristics (pre-filter; the content engine classifies
// with evidence as the authority)
export function isFresherEligible(title) {
  const t = (title || '').toLowerCase();
  const excludeWords = [
    'vice president', 'director', 'manager', 'head', 'lead', 'staff',
    'senior', 'sr.', 'principal', 'architect', 'specialist iii', ' ii ', ' iii ', ' iv '
  ];
  if (excludeWords.some((w) => t.includes(w))) return false;
  const fresherWords = [
    'fresher', 'graduate', 'intern', 'trainee', 'analyst', 'associate',
    'junior', 'entry', 'sde 1', 'sde-1', 'sde i', 'engineer 1', 'engineer i',
    'qa engineer', 'software engineer', 'developer', 'operations', 'support',
    'specialist', 'apprentice', 'fellow', 'consultant', '0-1', '0 - 1', '0–1'
  ];
  return fresherWords.some((w) => t.includes(w));
}

/** Parse an experience string like "4 to 5 years" / "0-1 years" -> max years, or null. */
export function parseMaxYears(expStr) {
  if (!expStr) return null;
  const nums = String(expStr).match(/\d+/g);
  if (!nums) return null;
  return Math.max(...nums.map(Number));
}

async function fetchJson(url, timeoutMs = 12000) {
  return fetchJsonCapped(url, { timeoutMs });
}

async function fetchText(url, timeoutMs = 15000) {
  return fetchTextCapped(url, { timeoutMs });
}

// ---------------------------------------------------------------------------
// Lever adapter
// ---------------------------------------------------------------------------
async function fetchLever(src) {
  const apiUrl = `https://api.lever.co/v0/postings/${src.slug}?mode=json`;
  let items;
  try {
    items = await fetchJson(apiUrl, 10000);
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const jobs = [];
  for (const j of items) {
    const locName = (j.categories?.location || '').trim();
    if (!locName || !isIndiaLocation(locName) || !isFresherEligible(j.text)) continue;
    jobs.push({
      title: (j.text || '').trim(),
      company: src.name,
      location: locName,
      applyUrl: j.hostedUrl || '',
      description: stripHtml(j.descriptionPlain || '') || j.text,
      sector: 'private',
      sourceUrl: apiUrl,
      sourceName: 'Lever ATS',
      companyUrl: src.homepage,
      fromAtsLive: true,
      publishedDate: j.createdAt ? new Date(j.createdAt).toISOString().split('T')[0] : ''
    });
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Greenhouse adapter
// ---------------------------------------------------------------------------
async function fetchGreenhouse(src) {
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${src.slug}/jobs?content=true`;
  let data;
  try {
    data = await fetchJson(apiUrl, 10000);
  } catch {
    return [];
  }
  const items = data.jobs || [];
  const jobs = [];
  for (const j of items) {
    const locName = (j.location?.name || '').trim();
    if (!locName || !isIndiaLocation(locName) || !isFresherEligible(j.title)) continue;
    jobs.push({
      title: (j.title || '').trim(),
      company: src.name,
      location: locName,
      applyUrl: j.absolute_url || '',
      description: stripHtml(j.content || '') || j.title,
      sector: 'private',
      sourceUrl: apiUrl,
      sourceName: 'Greenhouse ATS',
      companyUrl: src.homepage,
      fromAtsLive: true,
      publishedDate: j.updated_at ? String(j.updated_at).split('T')[0] : ''
    });
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Keka adapter — public career-portal JSON endpoints
// ---------------------------------------------------------------------------
function kekaLocation(jobLocations) {
  if (!Array.isArray(jobLocations) || jobLocations.length === 0) return '';
  const parts = jobLocations.map((l) => {
    const name = (l.name || '').trim();
    if (/remote/i.test(name)) return 'Remote';
    const city = (l.city || '').trim();
    if (city && city !== '.') return city;
    return name;
  });
  return unique(parts.filter(Boolean)).join(', ');
}

/** Keka gives an explicit `experience` field — use it as the pre-filter. */
export function kekaFresherEligible(job) {
  const maxYears = parseMaxYears(job.experience);
  if (maxYears !== null) return maxYears <= 2;
  // No explicit experience: fall back to title heuristics + internship signal
  const text = `${job.title || ''} ${job.excerpt || ''}`.toLowerCase();
  if (/\bintern(ship)?\b|\btrainee\b|\bapprentice\b/.test(text)) return true;
  return isFresherEligible(job.title);
}

/** Normalize one Keka API job record into a RawJob. Exported for tests. */
export function normalizeKekaJob(j, src, usedEndpoint) {
  const base = `https://${src.tenant}.keka.com`;
  const location = kekaLocation(j.jobLocations);
  const descParts = [stripHtml(j.description || ''), stripHtml(j.excerpt || '')].filter(Boolean);
  if (j.experience) descParts.push(`Experience required: ${j.experience}.`);
  if (j.jobType === 2) descParts.push('Employment type: Full-time.');
  return {
    title: String(j.title).trim(),
    company: src.name,
    location,
    applyUrl: `${base}/careers/jobdetails/${j.id}`,
    description: unique(descParts).join('\n'),
    sector: 'private',
    sourceUrl: usedEndpoint,
    sourceName: 'Keka ATS',
    companyUrl: `${base}/careers`,
    fromAtsLive: true,
    publishedDate: j.publishedOn ? String(j.publishedOn).split('T')[0] : ''
  };
}

export function normalizeAshbyJob(j, src) {
  const locName = (typeof j.location === 'string' && j.location.trim()) || '';
  return {
    title: (j.title || '').trim(),
    company: src.name,
    location: locName.trim(),
    applyUrl: j.jobUrl || '',
    description: stripHtml(j.descriptionHtml || '') || j.title,
    sector: 'private',
    sourceUrl: `https://api.ashbyhq.com/posting-api/job-board/${src.slug}`,
    sourceName: 'Ashby ATS',
    companyUrl: src.homepage,
    fromAtsLive: true,
    publishedDate: j.publishedAt ? String(j.publishedAt).split('T')[0] : ''
  };
}

async function fetchAshby(src) {
  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${src.slug}`;
  let data;
  try {
    data = await fetchJson(apiUrl, 10000);
  } catch {
    return [];
  }
  const items = data.jobs || [];
  const jobs = [];
  for (const j of items) {
    const rawLoc = (typeof j.location === 'string' && j.location.trim()) || '';
    if (!isIndiaLocation(rawLoc) || !isFresherEligible(j.title)) continue;
    jobs.push(normalizeAshbyJob(j, src));
  }
  return jobs;
}

async function fetchKeka(src) {
  const base = `https://${src.tenant}.keka.com`;
  const endpoints = [
    `${base}/careers/api/jobs/default/active`,
    `${base}/careers/api/embedjobs/default/active/`
  ];
  let items = null;
  let usedEndpoint = '';
  for (const ep of endpoints) {
    try {
      const data = await fetchJson(ep, 12000);
      if (Array.isArray(data) && data.length > 0) {
        items = data;
        usedEndpoint = ep;
        break;
      }
    } catch {
      /* try next endpoint */
    }
  }
  if (!items) return [];

  const jobs = [];
  for (const j of items) {
    if (!j || !j.title) continue;
    if (!kekaFresherEligible(j)) continue;
    const job = normalizeKekaJob(j, src, usedEndpoint);
    if (!isIndiaLocation(job.location)) continue;
    jobs.push(job);
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// HireDoor adapter — server-rendered public listing pages only
// (robots.txt allows /jobs; /api/* is disallowed and never touched)
// ---------------------------------------------------------------------------
// Job detail hrefs look like /jobs/sde-intern-47f90d or /jobs/ai-engineering-intern-ppo--caf8a5
// (one or two dashes before the trailing id). Location hubs (/jobs/bangalore)
// never have that trailing -id segment, so they are excluded naturally.
const HIREDOOR_JOB_HREF_RE = /\/jobs\/[A-Za-z0-9][A-Za-z0-9_-]*-{1,2}[A-Za-z0-9]{4,10}/g;

/** Exported for tests. */
export function extractHiredoorHrefs(listHtml) {
  const hrefs = new Set();
  let m;
  HIREDOOR_JOB_HREF_RE.lastIndex = 0;
  while ((m = HIREDOOR_JOB_HREF_RE.exec(listHtml)) !== null) {
    hrefs.add(m[0]);
  }
  return [...hrefs];
}

/** Pull the schema.org JobPosting block out of a detail page. Exported for tests. */
export function extractJobPostingJsonLd(detailHtml) {
  const blocks = detailHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const b of blocks) {
    const inner = b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    try {
      const parsed = JSON.parse(inner);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        if (c && c['@type'] === 'JobPosting') return c;
      }
      // @graph wrapper
      if (parsed && Array.isArray(parsed['@graph'])) {
        for (const c of parsed['@graph']) {
          if (c && c['@type'] === 'JobPosting') return c;
        }
      }
    } catch {
      /* not parseable — keep looking */
    }
  }
  return null;
}

/** Official outbound application link embedded in the page's flight data. Exported for tests. */
export function extractHiredoorApplyLink(detailHtml) {
  const m = detailHtml.match(/applicationLink\\?":\\?"(https?:\/\/[^"\\]+)/);
  if (m) return m[1];
  const m2 = detailHtml.match(/applicationLink":"(https?:[^"]+)"/);
  return m2 ? m2[1] : '';
}

function hiredoorLocations(jobPosting) {
  const locs = jobPosting.jobLocation;
  if (!Array.isArray(locs) || locs.length === 0) return '';
  const all = locs
    .map((l) => (l.address && (l.address.addressLocality || l.address.addressRegion)) || '')
    .map((s) => String(s).trim())
    .filter(Boolean);
  // Prefer specific cities; fall back to whatever the posting lists.
  // Never fall back to "India" — an unstated location stays unstated.
  const specific = all.filter((s) => !/^india$/i.test(s) && !/multiple locations/i.test(s));
  const use = specific.length ? specific : all;
  return unique(use).join(', ');
}

/** Normalize a parsed JobPosting (+ apply link) into a RawJob. Exported for tests. */
export function normalizeHiredoorJob(jp, applyLink, pageUrl) {
  const company = (jp.hiringOrganization && jp.hiringOrganization.name) || '';
  const descParts = [stripHtml(jp.description || '')];
  if (jp.experienceRequirements) descParts.push(`Experience: ${stripHtml(String(jp.experienceRequirements))}.`);
  if (jp.employmentType) descParts.push(`Employment type: ${stripHtml(String(jp.employmentType))}.`);
  if (jp.skills) descParts.push(`Skills: ${stripHtml(String(jp.skills))}.`);
  return {
    title: String(jp.title).trim(),
    company: company.trim(),
    location: hiredoorLocations(jp),
    applyUrl: applyLink || '',
    description: unique(descParts.filter(Boolean)).join('\n'),
    sector: 'private',
    sourceUrl: pageUrl,
    sourceName: 'HireDoor',
    companyUrl: '',
    fromAtsLive: false,
    applyUrlLive: false, // set by the liveness probe in fetchHiredoorDetail —
    // HireDoor's own "Verified" label is a discovery signal, never proof
    // that the posting is currently open.
    publishedDate: jp.datePosted ? String(jp.datePosted).split('T')[0] : '',
    validThrough: jp.validThrough ? String(jp.validThrough) : ''
    // NOTE: baseSalary is intentionally NOT consumed — HireDoor labels it
    // "(Estimated)", and estimates are never presented as facts.
  };
}

/**
 * Liveness probe for a HireDoor-extracted external application link.
 * A single cheap request (robots-checked first, body discarded): a reachable
 * application page is genuine evidence the posting is still live, which is
 * more than the source's own "Verified" label can tell us.
 */
async function probeUrlLive(url) {
  try {
    const robots = await checkUrl(url);
    if (!robots.allowed) return false;
    const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
    try { if (res.body) await res.body.cancel(); } catch { /* ignore */ }
    return res.status < 400;
  } catch {
    return false;
  }
}

async function fetchHiredoorDetail(pageUrl) {
  let html;
  try {
    html = await fetchText(pageUrl, 15000);
  } catch {
    return null;
  }
  const jp = extractJobPostingJsonLd(html);
  if (!jp || !jp.title) return null;
  const company = (jp.hiringOrganization && jp.hiringOrganization.name) || '';
  if (!company) return null;
  const applyLink = extractHiredoorApplyLink(html);
  const job = normalizeHiredoorJob(jp, applyLink, pageUrl);
  job.applyUrlLive = applyLink ? await probeUrlLive(applyLink) : false;
  return job;
}

async function fetchHiredoor(src) {
  const hrefs = [];
  const seen = new Set();
  const pages = Math.max(1, Math.min(src.pages || 3, 8));
  for (let page = 1; page <= pages; page++) {
    const url = `https://hiredoor.in/jobs${page > 1 ? `?page=${page}` : ''}`;
    let html;
    try {
      html = await fetchText(url, 15000);
    } catch (e) {
      console.warn(`[HireDoor] listing page ${page} failed: ${e.message}`);
      break;
    }
    let added = 0;
    for (const h of extractHiredoorHrefs(html)) {
      if (!seen.has(h)) {
        seen.add(h);
        hrefs.push(h);
        added++;
      }
    }
    if (added === 0) break; // no new jobs -> stop paginating
    await sleep(700);
  }

  const jobs = [];
  const maxJobs = Math.min(src.maxJobs || 24, hrefs.length);
  for (let i = 0; i < maxJobs; i++) {
    const pageUrl = `https://hiredoor.in${hrefs[i]}`;
    try {
      const job = await fetchHiredoorDetail(pageUrl);
      if (job) jobs.push(job);
    } catch (e) {
      console.warn(`[HireDoor] detail failed ${hrefs[i]}: ${e.message}`);
    }
    await sleep(700); // polite pacing between detail pages
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Govt notice boards (official .gov.in / PSU recruitment pages).
// Conservative by design: only anchors that look like recruitment notices
// become candidates; everything else (results, admit cards, tenders, fraud
// alerts) is dropped. Thin evidence -> the content engine quarantines.
// ---------------------------------------------------------------------------
const GOVT_KEEP_RE = /(recruit|vacanc|advertisement|advt\.?\s*no|engagement|apprentice|trainee|walk-?in|invit\w*\s+applications?|job-?openings?|current-?openings?)/i;
const GOVT_NOISE_RE = /(admit card|answer key|\bresults?\b.*declared|fraud alert|tender|auction|e-?procurement|syllabus|cut[ -]?off|interview schedule|document verification|selected candidates|provisionally selected|pipeline crossing|independent director)/i;
const GOVT_WAF_RE = /(sucuri|cloudproxy|incapsula|_Incapsula_|just a moment|attention required|verify you are (a )?human)/i;
const GOVT_NAV_RE = /^(home|contact us|sitemap|login|register|skip to main content|tenders?|about us)$/i;
const GOVT_GENERIC_ANCHOR_RE = /^(download|click here|view|details?|more|read more|advertisement|apply now|apply online)\b/i;

function govtMineDate(text) {
  const t = String(text || '');
  let m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  if (m) {
    const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
    return `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  }
  return '';
}

function govtRowContext(raw, idx) {
  // Nearest enclosing <tr> or <li>, windowed to ~450 chars BEFORE the anchor:
  // the subject cell precedes the "Download Advertisement" cell, and the
  // full row can merge several notices on wide tables.
  for (const tag of ['tr', 'li']) {
    const start = raw.lastIndexOf(`<${tag}`, idx);
    if (start === -1) continue;
    const end = raw.indexOf(`</${tag}>`, idx);
    if (end === -1 || end - start > 6000) continue;
    const slice = raw.slice(start, Math.min(end, idx));
    const windowed = slice.slice(Math.max(0, slice.length - 2000));
    const text = stripHtml(windowed).replace(/\s+/g, ' ').trim();
    if (text.length > 20) return text.slice(-450);
  }
  return '';
}

function govtPickTitle(anchorText, rowText) {
  const a = anchorText.trim();
  const r = rowText.trim();
  const aGeneric = a.length < 25 || GOVT_GENERIC_ANCHOR_RE.test(a);
  if (aGeneric && !r) return ''; // "Download Advertisement" with no context is useless
  for (const cand of aGeneric ? [r, a] : [a, r]) {
    if (!cand || cand.length < 18 || cand.length > 400) continue;
    if (GOVT_NAV_RE.test(cand)) continue;
    if (GOVT_NOISE_RE.test(cand)) continue;
    if (!GOVT_KEEP_RE.test(cand)) continue;
    return cand;
  }
  return '';
}

/**
 * Pure extractor: official notice-board HTML -> [{ title, url, dateText }].
 * Same-origin is NOT required: PSU apply links legitimately point at
 * ibpsreg / jobs portals, but the notice URL itself stays on the official
 * domain whenever the anchor resolves there.
 */
export function extractGovtNotices(html, baseUrl) {
  const raw = String(html || '');
  if (GOVT_WAF_RE.test(raw.slice(0, 20000))) return []; // WAF challenge page, not a listing
  const notices = [];
  const seen = new Set();
  const anchorRe = /<a\s[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = anchorRe.exec(raw)) !== null) {
    const href = (m[2] || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(url)) continue;
    const anchorText = stripHtml(m[3] || '').replace(/\s+/g, ' ').trim();
    const title = govtPickTitle(anchorText, govtRowContext(raw, m.index));
    if (!title) continue;
    const key = url.split('#')[0];
    const titleKey = title.toLowerCase().slice(0, 60);
    if (seen.has(key) || seen.has(`t:${titleKey}`)) continue;
    seen.add(key);
    seen.add(`t:${titleKey}`);
    notices.push({ title, url: key, dateText: govtMineDate(`${title} ${anchorText}`) });
  }
  return notices;
}

async function fetchGovt(src) {
  let html;
  try {
    html = await fetchTextCapped(src.noticePage, { timeoutMs: 20000, maxBytes: 4_000_000 });
  } catch {
    return [];
  }
  const notices = extractGovtNotices(html, src.noticePage).slice(0, src.maxNotices || 25);
  return notices.map((n) => ({
    title: n.title,
    company: src.name,
    location: 'India',
    applyUrl: n.url,
    description: n.dateText ? `${n.title} (Notice dated ${n.dateText}.)` : n.title,
    sector: 'govt',
    sourceUrl: src.noticePage,
    sourceName: 'Govt notice board',
    companyUrl: src.homepage,
    fromAtsLive: false,
    publishedDate: n.dateText
  }));
}

const ADAPTERS = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
  keka: fetchKeka,
  govt: fetchGovt,
  hiredoor: fetchHiredoor
};

/**
 * Fetch raw jobs for one source (robots.txt already checked by the caller).
 * Never throws — returns [] on failure so one bad source can't kill the run.
 */
export async function fetchSourceJobs(source) {
  const adapter = ADAPTERS[source.kind];
  if (!adapter) {
    console.warn(`[Sources] unknown kind "${source.kind}" for ${source.id} — skipping`);
    return [];
  }
  try {
    const jobs = await adapter(source);
    console.log(`[Sources] ${source.name} (${source.kind}): ${jobs.length} fresher-candidate jobs`);
    return jobs;
  } catch (err) {
    console.warn(`[Sources] ${source.name} failed: ${err.message}`);
    return [];
  }
}

export { checkUrl };
