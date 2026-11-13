# Outreach Copilot

Personal outbound-sales tool for a business development manager at TalentiFi-X (human-led, AI-assisted recruitment: permanent, niche/leadership, contract staffing; targets tech, fintech, BFSI). Goal: less manual prospecting, more qualified meetings. It is NOT a bulk mailer: nothing is ever sent by the app.

## Stack

- Vite + React 18 (JavaScript/JSX), plain CSS with design tokens (light + dark via `prefers-color-scheme`).
- Dexie (IndexedDB) for storage. PapaParse (CSV) and SheetJS `xlsx` (Excel, loaded on demand) for import.
- Hash routing: `#today`, `#contacts`, `#import`, `#dashboard`, `#settings`.
- Static site, free to run, works with zero API keys. `netlify.toml` included.

## Commands

- `npm run dev` : dev server on http://localhost:5183
- `npm test` : `node tests/logic.test.mjs` (Node assert, no framework). Run after every change to `logic.js` or `ai.js`.
- `npm run build` : production build into `dist/`

## Code map

- `src/lib/logic.js` : ALL business rules as pure functions (no React, no storage, no network). Scoring, dedupe, import, send rules, schedules, Today queues, Outlook link, dashboard stats, CSV export, example contacts.
- `src/lib/db.js` : the ONLY file that touches storage. Dexie tables: `contacts`, `activities`, `drafts`, `settings`. Backup, restore, delete-all.
- `src/lib/ai.js` : the ONLY file that calls an AI provider. Providers (templates, Gemini, Groq, Anthropic), prompts, JSON parsing, friendly errors, templates.
- `src/actions.js` : glue. Re-reads the contact from storage, runs a `logic.js` rule, commits contact + activities.
- `src/App.jsx` : shell, nav, hash routing, loads all data and passes `store` down.
- `src/screens/` : `Today`, `Contacts`, `Import`, `Dashboard`, `Settings`.
- `src/components/` : `EmailCard`, `LinkedInCard`, `ContactDrawer`, `ui` (pills, in-page confirm, fields).
- `tests/logic.test.mjs` : one test per rule below, plus import/dedupe, column mapping, Outlook link, stats and angle attribution.

## Data model

- contact: name, title, company, email, linkedin, industry, city, notes, campaign, `status`, `step` (emails sent), `nextFollowUpAt` (YYYY-MM-DD), `firstSubject`, `replySentiment`, `linkedinStatus`, `skipUntil`.
- status: `new`, `in_sequence`, `replied`, `meeting`, `no_response`, `bounced`, `optout`, `suppressed`.
- activity: `{ contactId, type, at, ... }` with types `added`, `researched`, `email_sent` (kind `first` | `followup` | `reply`, step, subject, body, angle, cc), `reply` (sentiment), `meeting`, `bounce`, `optout`, `suppressed`, `linkedin_request`, `linkedin_connected`, `reopened`.

## Rules that must never break (each has a test)

1. Manager auto-CC on FIRST-TOUCH emails only. Follow-ups and replies: no CC by default. CC is always editable.
2. A contact can never get a second first-touch email.
3. `replied` / `meeting` / `bounced` / `optout` / `suppressed` never get follow-ups.
4. Marking sent: `step += 1`; next follow-up scheduled from the gaps (weekend dates move to Monday); after the last gap, status becomes `no_response`.
5. Follow-ups keep the thread: subject `Re: <original subject>`, a NEW angle each step, generated for review, never auto-sent.
6. Daily cap enforced (first emails + follow-ups per local day).
7. Every send / reply / meeting / bounce / opt-out / LinkedIn action is stored as an activity; the dashboard is computed from activities.

AI rules: never invent facts about the prospect; use only the contact's research notes; thin notes mean a role-based angle and `low_evidence: true`; one 15-20 minute meeting CTA.

## Conventions

- New business rule: add a pure function to `logic.js` and a test first. UI calls it through `actions.js`.
- No `window.alert` / `confirm` / `prompt`. Use `ConfirmButton` or an in-page notice.
- Plain wording in the UI ("I sent it", not "Submit"). Must work at 400px wide with visible focus states.
- Colours only through the CSS tokens at the top of `src/styles.css`.
- Section colours via `data-kind`: `first` blue, `followup` purple, `linkedin` green, `reply` amber (cards, Today tabs). Dashboard tiles use `tone-*` classes.
- Example data must stay fictional (`example.com` addresses, invented companies).

## Roadmap

1. Supabase storage behind `db.js` (sync across devices, team use).
2. Microsoft Graph (`Mail.Send`, `Mail.ReadWrite`; needs IT admin consent): real Outlook drafts, automatic reply and bounce detection.
3. Claude API through a small server, so no key sits in the browser.
4. Research automation to fill research notes (career pages, news, funding).
5. Smaller items: per-campaign follow-up gaps, undo for the last action, reminder for meetings booked.
