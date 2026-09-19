# LiftCoach — Design & Pitch Plan

Kamloops 2026 Hackathon (Sep 18–20, TRU OLARA building). Name is a placeholder.

**Judged on:** market research, prototype, presentation.
**Deadlines:** mentor demo Saturday (required to present); 5–10 min presentation Sunday 10 AM (arrive 9:30).
**Rule:** everything presented must be built during the event. No copied code.

## One-liner

LiftCoach is an AI lifting-safety trainer for small businesses: five lifts in front of any camera, instant coaching, and a training record for the employer, renewed every 3 months. No consultants, no wearables, no video stored.

"Like a CBL, except you can't click through it — you have to actually lift correctly."

## 1. Problem

Lifting injuries are the most common workplace injury in BC, and small businesses have no affordable way to train workers to lift safely.

- Musculoskeletal injuries (MSIs): 30% of WorkSafeBC time-loss claims, 26% of claim costs.
- ~88,000 claims and $2.35 billion over 2020–2024. Majority from overexertion: lifting, carrying, pushing, pulling.
- Average BC time-loss claim: approximately $43,000 direct (secondary source — say "approximately"). Indirect costs add ~$2.12 per $1 direct (Liberty Mutual study).
- WorkSafeBC pays the claim; the employer pays through higher premiums and lost productivity.
- BC OHS Regulation 4.46–4.53: employers must identify and assess MSI risk, educate and train exposed workers (4.51), review the program at least annually.
- Small businesses cover this with a poster or a video and have no evidence anyone learned anything.

## 2. Solution

Worker stands in front of a laptop/tablet camera and does five practice lifts. The app tracks their body in real time, flags unsafe technique (rounded back, straight knees, load far from body), coaches a correction, and gives a Lift Safety Score. The employer gets a dated training record per worker with a next-check-due date (default 90 days, configurable). Runs entirely in the browser; no video is stored or uploaded.

## 3. Target audience

**Buyer:** owner or operations manager of a BC business with 5–50 employees who lift daily — small warehouses, moving companies, grocery/retail backrooms, building supply, breweries, courier depots. Typically 35–55, no safety officer, cost-sensitive, worried about premiums and inspections. BC has 170,512 small businesses (~98% of all businesses). TODO Saturday: pull lifting-heavy industry counts from the BC Small Business Profile.

**User:** new hires and seasonal staff, mostly 18–35, male-skewed workforce, often first physical job, sometimes English as a second language. Feedback must be visual, not text-heavy.

## 4. Reaching them

- Direct local outreach in Kamloops with a tablet and a 2-minute demo.
- Industry safety associations (Manufacturing Safety Alliance of BC, retail and trucking safety councils).
- Kamloops Chamber of Commerce; Central Interior Business Accelerator (event sponsor).
- LinkedIn and Facebook ads by job title and industry.
- Insurance brokers and WorkSafeBC consultants as referral partners (Kamloops Insurance is a sponsor).
- Free tier hook: "Score your own lift in 60 seconds."

## 5. Demo for judges

Bring a box. Invite a judge to lift it. Skeleton appears, turns red when the back rounds, score drops, correction pops up. Then show the supervisor dashboard with the judge's result already in it, next to sample workers showing Current / Due soon / Overdue and a score trend.

Record a backup video Saturday in case the webcam or lighting fails.

## 6. Future development

- Near: more tasks (push/pull, overhead, team lifts), multi-language coaching, phone app, PDF certificates, email/SMS recert reminders, short knowledge quiz for a full CBL feel.
- Medium: REBA/RULA scoring, team trends, annual compliance report export.
- Long: insurer and safety-association partnerships; adjacent markets on the same engine — physio clinics, home and long-term care (2026 WorkSafeBC MSI inspection initiative), gyms.
- Vision: "Every worker in BC gets lifting training that actually watches them lift."

## 7. Branding

- "Coach" signals help, not surveillance. Check the name is free.
- Hi-vis safety colours (green/amber/red on dark), bold, readable from 2 metres.
- Taglines: "Lift right. Every time." / "Safety training that watches you lift."
- Plain, blue-collar tone. No jargon.

## 8. Pitch flow

1. "Who here has ever hurt their back lifting something?"
2. "$2.35 billion in BC in five years."
3. Judge on camera within the first 2 minutes.
4. Dashboard: pixels became a business record in 30 seconds.
5. Market, pricing, recurring revenue via quarterly recert.
6. Close on ROI.

## 9. Pricing

- Cost per customer is near zero: the AI runs in the customer's browser. Basic web hosting only.
- Free: single-user self-check. $49/month per location (up to 25 workers, records, recert tracking). $99/month unlimited.
- Competitors (TuMeke, Soter, Kinetica) publish no prices and sell through enterprise sales calls.
- ROI: one year is $588; one avoided claim is about $43,000.

**Claims discipline:** say "helps document training." Never "WorkSafeBC approved" or "guarantees compliance." The 3-month interval is our recommended default, not a legal requirement (the regulation requires annual program review).

## 10. Privacy answer

Processed on-device in the browser. Only scores and fault counts are saved, never video or images. Positioned as coaching, not monitoring.

## Features

**Must build (Friday night + Saturday morning)**
1. Live camera with skeleton overlay, red/green by joint.
2. Lift fault detection: back angle, knee bend, load distance from body.
3. Camera positioning check before scoring starts.
4. 5-lift session → Lift Safety Score, top faults, tips.
5. Worker name → dated training record with next-check-due date (default 90 days).
6. Supervisor dashboard: workers, latest score, score history, status (Current / Due soon / Overdue), most common fault.
7. Visible privacy badge: "Video never leaves this device."
8. Sample workers with past dates, labelled as sample data, so the dashboard is populated for the demo.

**Stretch (Saturday afternoon)**
Voice cues, printable certificate, QR code to open on a phone, squat "gym mode" to show the engine is generic.

**Pitch only**
Everything in section 6.

## Technical approach

- Plain browser web app, no backend. MediaPipe Pose Landmarker (JS/WASM build) on the webcam feed.
- One generic engine: joint angles from landmarks → per-task config of thresholds → state machine over the lift phases (standing → descending → at load → ascending → standing) to segment and score each lift.
- Records in browser localStorage.
- Demo setup: side-on camera, clear space, good lighting. Pitched as a training station and spot-check tool, not continuous floor monitoring (single-camera occlusion limits).

## Sources

- https://www.worksafebc.com/en/about-us/news-events/news-releases/2026/February/musculoskeletal-injuries-remain-the-most-common-workplace-injury-in-bc-worksafebc
- https://www.worksafebc.com/en/about-us/news-events/news-releases/2024/July/musculoskeletal-injuries-driving-time-loss-claims-with-worksafebc
- https://www.thesafetymag.com/ca/topics/safety-and-ppe/musculoskeletal-injuries-time-loss-claims-costs-bc-over-2-billion-in-five-years/496995
- https://www.worksafebc.com/en/law-policy/occupational-health-safety/searchable-ohs-regulation/ohs-regulation/part-04-general-conditions
- https://makesafetyeasy.com/blog/cost-of-workplace-injury-canada
- https://pmcinsurance.com/blog/evaluating-the-true-cost-of-a-workers-compensation-claim/
- https://worklink.bc.ca/in-the-news/what-the-numbers-say-about-b-c-s-economic-backbone/
- https://www.tumeke.io/product/packages
- https://arctechnologies.ca/hackathon.php
