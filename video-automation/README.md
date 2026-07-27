# Video Reels — What's Automated vs What Needs Your Own Setup

## What's fully automated (already wired into the daily pipeline)
- Scraping fresher postings ✅
- AI-written article for each posting, published to your site ✅
- AI-written reel script (hook / body / CTA) for each posting, saved to
  `data/reel-scripts.json` and shown on each job's page with a "Copy full
  script" button ✅

## What needs a one-time setup on your end (can't be skipped)
Turning a script into an actual talking video, and posting that video to
Instagram/YouTube, requires accounts on services that verify identity and
review use-cases. No automation can bypass that — it's by design, to
prevent abuse of face-cloning and auto-posting tools. Here's the real path:

### 1. Turn your face + script into a video
Pick one:
- **HeyGen** (heygen.com) — upload a video of yourself once to create your
  avatar, then their API takes any text script and generates a new video
  of "you" saying it.
- **D-ID** (d-id.com) — similar, often cheaper for short clips.

Both have a **free trial** so you can test with one job's script before
committing to a paid plan. `video-automation/avatar-video-stub.js` is a
working template for D-ID's API — fill in your API key and avatar image
URL and it'll generate one video per run.

### 2. Post the video to Instagram/YouTube automatically
- **Instagram**: needs a Business/Creator account linked to a Facebook
  Page, a Meta Developer App, and the `instagram_content_publish`
  permission. `video-automation/instagram-post-stub.js` has a working
  template once you have that access token.
- **YouTube Shorts**: needs a Google Cloud project with the YouTube Data
  API enabled and OAuth consent — structurally similar, ask me for a stub
  script for this if you want to go this route too.

### Why this isn't one script that "just does it"
Every platform above requires *you* to prove you're a real account holder
and, for posting APIs, often requires explaining your use-case to get
approved. That's Meta/Google's fraud and abuse prevention working as
intended — a script running on GitHub can't complete that verification for
you. Once you're approved, though, the actual posting *is* just an API
call, and that part I've already templated.

### Realistic middle ground if you want to start today
Generate the AI script + video for one job manually, post it manually
once or twice while you request the Instagram API access (which takes a
few days to get approved) — then plug in the stub scripts once approved
to make future posts automatic.
