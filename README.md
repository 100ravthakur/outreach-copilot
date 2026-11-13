# Outreach Copilot

A personal outbound-sales tool for a business development manager at TalentiFi-X. It cuts the manual work of prospecting (sorting a list, deciding who to write to, drafting, remembering follow-ups, logging replies) so more time goes into conversations that lead to meetings.

It is **not** a bulk mailer. It never sends anything. It drafts each email for you to review, opens it in Outlook with everything filled in, and you press Send yourself.

## What it does

- **Import** a CSV or Excel list (Apollo exports map automatically), with duplicate detection by email, LinkedIn profile, or name + company.
- **Score** every contact 0-100 with reasons (seniority, function, industry fit, evidence in your notes). Hot 70+, Warm 45-69, Cold below.
- **Today** screen: first emails (best score first, inside your daily cap), follow-ups that are due, LinkedIn requests, and open replies.
- **Draft** emails with built-in templates (free, no key) or with Gemini / Groq (free tiers) or Claude (paid).
- **Open in Outlook** with To, CC, Subject and Body pre-filled. Your manager is CC'd on first emails only.
- **Follow-ups** stay in the same thread ("Re: ..."), use a new angle each time, and stop the moment someone replies, bounces or opts out.
- **Dashboard**: meetings, replies, rates, funnel, emails per day, results by industry, and which angles get replies.

Everything is stored in your browser on your PC (IndexedDB). There is no server and no account.

## Run it on your PC

```bash
npm install
npm run dev
```

Then open the address it prints (http://localhost:5183).

```bash
npm test        # checks every business rule
npm run build   # creates the dist/ folder for deployment
```

## Deploy for free

**Netlify Drop (no account setup, 1 minute)**

1. Run `npm run build`.
2. Open https://app.netlify.com/drop and drag the `dist` folder onto the page.
3. Bookmark the address it gives you.

**Vercel from GitHub**

1. Push this folder to a GitHub repository.
2. On https://vercel.com choose "Add New Project", pick the repository, keep the detected Vite settings, and deploy.

**Render from GitHub**

1. On https://dashboard.render.com choose "New" then "Static Site" and pick the repository.
2. Build command `npm install && npm run build`, publish directory `dist`. (`render.yaml` is included, so "New" then "Blueprint" fills these in for you.)

`netlify.toml` is included, so connecting the repository to Netlify also works with no settings.

Note: your data is tied to the browser *and* the web address. If you move from localhost to the deployed address, download a backup in Settings first and restore it at the new address.

## First-time setup

1. **Settings**: enter your name, title, your manager's email (for CC), and choose your mail app (Outlook on the web for a work account is the default).
2. Check the follow-up gaps (default 3, 5, 7 days), the daily cap (default 40) and the company pitch.
3. Optional: pick an AI provider and paste a free key, then press **Test**. Without a key the built-in templates are used.
4. **Import**: press "Load example contacts" to try it with 10 made-up people, or upload your own list.

## Daily routine

1. Open **Today**. Log any replies or bounces from Outlook using the search box at the top.
2. **Follow-ups due**: press "Draft all", review each one, "Open in Outlook", send, then "I sent it".
3. **First emails**: same again. Add research notes to hot contacts first for better emails.
4. **LinkedIn**: copy the note, open the profile, send the request, press "Request sent".
5. **Replies**: answer, and press "Meeting booked" when one lands.
6. Once a week: Settings -> Download backup.

## Free-tier limits

| Provider | Cost | Typical free limit | Pacing used by "Draft all" |
| --- | --- | --- | --- |
| Built-in templates | Free, no key | None | Instant |
| Google Gemini (`gemini-2.5-flash`) | Free tier | Roughly 10 requests a minute and a few hundred a day | 6.5 seconds between drafts |
| Groq (`llama-3.3-70b-versatile`) | Free tier | Roughly 30 requests a minute and about 1,000 a day | 2.5 seconds between drafts |
| Anthropic Claude | Paid per use | Depends on your plan | 1.2 seconds between drafts |

Limits change; check the provider's page. If you hit one, the app tells you in plain words and stops the batch. Model names are editable in Settings.

Other limits to know:

- Data lives in one browser on one PC. Clearing browser data deletes it. Take backups.
- API keys are stored in your browser and sent straight to the provider. Do not use this on a shared PC with a paid key.
- The app cannot see your mailbox. You tell it what you sent and who replied.
- Very long emails can exceed the length Outlook accepts in a link. Use "Copy body" if the body arrives cut off.

## Upgrade path

When the free version is paying for itself:

1. **Supabase** (free tier to start): move storage from the browser to a hosted database so data survives a PC change and can be shared with a team. Only `src/lib/db.js` changes.
2. **Microsoft Graph** with `Mail.Send` and `Mail.ReadWrite`: create real drafts in Outlook, and detect replies and bounces automatically instead of logging them by hand. These permissions need approval from your IT admin (Entra ID app registration and admin consent).
3. **Claude API** for higher-quality drafts, called from a small server so the key is not in the browser.
4. **Research automation**: fill research notes from company career pages, news and funding announcements, so the evidence check is done before you open the card.

The business rules are all in `src/lib/logic.js` as plain functions with no browser dependencies, so they can move to a server unchanged.
