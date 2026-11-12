// All business rules live here as pure functions.
// No React, no storage, no network: this file can move to a server unchanged.

export const STATUS_LABELS = {
  new: 'New',
  in_sequence: 'In sequence',
  replied: 'Replied',
  meeting: 'Meeting booked',
  no_response: 'No response',
  bounced: 'Bounced',
  optout: 'Opted out',
  suppressed: 'Never email',
};
export const STATUSES = Object.keys(STATUS_LABELS);

// Statuses that must never receive a follow-up.
export const NO_FOLLOWUP_STATUSES = ['replied', 'meeting', 'bounced', 'optout', 'suppressed'];

export const SENTIMENT_LABELS = { positive: 'Interested', neutral: 'Neutral', negative: 'Not interested' };

export const DEFAULT_PITCH =
  'TalentiFi-X is a human-led, AI-assisted recruitment firm. Experienced recruiters use AI to map and screen the market quickly, then personally vet every candidate. ' +
  'We do permanent hiring, niche and leadership hiring, and contract staffing. ' +
  'Tech roles: engineering, QA, data, AI/ML, cloud, cybersecurity, product. ' +
  'Non-tech roles: sales, business development, operations, collections. ' +
  'We work mainly with technology, fintech and BFSI companies.';

export const DEFAULT_SETTINGS = {
  key: 'main',
  senderName: '',
  senderTitle: 'Business Development Manager',
  senderCompany: 'TalentiFi-X',
  managerEmail: '',
  followUpGaps: '3, 5, 7',
  skipWeekends: true,
  dailyCap: 40,
  mailClient: 'outlook_work',
  signature: '',
  pitch: DEFAULT_PITCH,
  aiProvider: 'templates',
  aiKey: '',
  aiModel: '',
};

/* ---------- small helpers ---------- */

const pad = (n) => String(n).padStart(2, '0');
const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function addDays(date, n) {
  const x = new Date(date);
  x.setDate(x.getDate() + n);
  return x;
}

export function parseGaps(text) {
  const src = Array.isArray(text) ? text.join(',') : String(text ?? '');
  return src
    .split(/[,\s;]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Date (YYYY-MM-DD) of the next follow-up. Saturday/Sunday move to Monday. */
export function nextFollowUpDate(from, gapDays, skipWeekends = true) {
  let d = addDays(from, gapDays);
  if (skipWeekends) {
    const w = d.getDay();
    if (w === 6) d = addDays(d, 2);
    else if (w === 0) d = addDays(d, 1);
  }
  return dayKey(d);
}

export function wordCount(text) {
  const t = clean(text);
  return t ? t.split(/\s+/).length : 0;
}

export function fullName(c) {
  return [clean(c.firstName), clean(c.lastName)].filter(Boolean).join(' ') || clean(c.email) || 'Unnamed contact';
}

/* ---------- email / duplicates ---------- */

export function normaliseEmail(email) {
  return clean(email).toLowerCase();
}

export function isValidEmail(email) {
  const e = normaliseEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && !e.includes('..');
}

/** "https://www.linkedin.com/in/Asha-Rao-123/?x=1" -> "asha-rao-123" */
export function linkedinSlug(url) {
  const m = clean(url).match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i);
  if (!m) return '';
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
  return slug.toLowerCase();
}

const COMPANY_NOISE = new Set([
  'pvt', 'private', 'ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'plc', 'corp', 'corporation',
  'co', 'company', 'technologies', 'technology', 'tech', 'solutions', 'services', 'systems', 'software',
  'labs', 'india', 'global', 'group', 'holdings', 'international', 'the',
]);

export function normaliseCompany(name) {
  const words = clean(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !COMPANY_NOISE.has(w));
  return (kept.length ? kept : words).join(' ');
}

export function normaliseName(c) {
  return [clean(c.firstName), clean(c.lastName)].join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Keys used to spot the same person twice: email, LinkedIn slug, name + company. */
export function dedupeKeys(c) {
  const keys = [];
  const email = normaliseEmail(c.email);
  if (email) keys.push(`e:${email}`);
  const slug = linkedinSlug(c.linkedin);
  if (slug) keys.push(`l:${slug}`);
  const name = normaliseName(c);
  const company = normaliseCompany(c.company);
  if (name && company) keys.push(`n:${name}|${company}`);
  return keys;
}

export function buildDedupeIndex(contacts) {
  const idx = new Map();
  for (const c of contacts) for (const k of dedupeKeys(c)) if (!idx.has(k)) idx.set(k, c);
  return idx;
}

export function findDuplicate(contact, contactsOrIndex) {
  const idx = contactsOrIndex instanceof Map ? contactsOrIndex : buildDedupeIndex(contactsOrIndex);
  for (const k of dedupeKeys(contact)) if (idx.has(k)) return idx.get(k);
  return null;
}

/* ---------- import ---------- */

export const IMPORT_FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['fullName', 'Full name'], ['title', 'Job title'],
  ['company', 'Company'], ['email', 'Email'], ['linkedin', 'LinkedIn URL'], ['industry', 'Industry'],
  ['city', 'City'], ['notes', 'Research notes'],
];

const ALIASES = {
  firstName: ['firstname', 'first', 'givenname'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  fullName: ['name', 'fullname', 'contactname', 'contact'],
  title: ['title', 'jobtitle', 'designation', 'position', 'role'],
  company: ['company', 'companyname', 'organization', 'organisation', 'account', 'accountname', 'companynameforemails', 'employer'],
  email: ['email', 'emailaddress', 'workemail', 'businessemail', 'emailid'],
  linkedin: ['personlinkedinurl', 'linkedinurl', 'linkedin', 'linkedinprofile', 'linkedinprofileurl', 'profileurl'],
  industry: ['industry', 'sector', 'vertical'],
  city: ['city', 'location', 'personcity'],
  notes: ['notes', 'researchnotes', 'research', 'note', 'comments'],
};

const normHeader = (h) => clean(h).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Guess which file column feeds each field. Returns { field: header } (missing fields are ''). */
export function autoMapColumns(headers) {
  const mapping = {};
  const used = new Set();
  for (const [field] of IMPORT_FIELDS) {
    mapping[field] = '';
    for (const alias of ALIASES[field]) {
      const hit = headers.find((h) => !used.has(h) && normHeader(h) === alias);
      if (hit) { mapping[field] = hit; used.add(hit); break; }
    }
  }
  return mapping;
}

export function newContact(fields = {}, now = new Date()) {
  const email = normaliseEmail(fields.email);
  return {
    firstName: clean(fields.firstName),
    lastName: clean(fields.lastName),
    title: clean(fields.title),
    company: clean(fields.company),
    email,
    linkedin: clean(fields.linkedin),
    industry: clean(fields.industry),
    city: clean(fields.city),
    notes: clean(fields.notes),
    campaign: clean(fields.campaign),
    status: 'new',
    step: 0,
    nextFollowUpAt: null,
    lastSentAt: null,
    firstSubject: '',
    replySentiment: null,
    linkedinStatus: 'none',
    skipUntil: null,
    createdAt: new Date(now).toISOString(),
  };
}

export function rowToFields(row, mapping) {
  const get = (f) => (mapping[f] ? clean(row[mapping[f]]) : '');
  let firstName = get('firstName');
  let lastName = get('lastName');
  const full = get('fullName');
  if (!firstName && !lastName && full) {
    const parts = full.split(/\s+/);
    firstName = parts.shift() || '';
    lastName = parts.join(' ');
  }
  return {
    firstName, lastName, title: get('title'), company: get('company'), email: get('email'),
    linkedin: get('linkedin'), industry: get('industry'), city: get('city'), notes: get('notes'),
  };
}

/**
 * Turn file rows into contacts to add, plus a report.
 * - invalid email + LinkedIn URL  -> kept as LinkedIn-only
 * - invalid email, no LinkedIn    -> dropped (counted as invalid)
 * - nothing usable                -> skipped
 */
export function importRows(rows, mapping, existingContacts = [], campaign = '', now = new Date()) {
  const report = { total: rows.length, added: 0, dupDb: 0, dupFile: 0, invalidEmail: 0, linkedinOnly: 0, skipped: 0 };
  const dbIndex = buildDedupeIndex(existingContacts);
  const fileIndex = new Map();
  const toAdd = [];
  for (const row of rows) {
    const f = rowToFields(row, mapping);
    const hasEmailText = !!f.email;
    const emailOk = isValidEmail(f.email);
    const hasLinkedin = !!linkedinSlug(f.linkedin);
    const hasIdentity = !!(f.firstName || f.lastName || f.email || hasLinkedin);
    if (!hasIdentity) { report.skipped++; continue; }
    if (hasEmailText && !emailOk) {
      report.invalidEmail++;
      if (!hasLinkedin) continue;
      f.email = '';
    }
    if (!f.email && !hasLinkedin) { report.skipped++; continue; }
    const c = newContact({ ...f, campaign }, now);
    if (findDuplicate(c, dbIndex)) { report.dupDb++; continue; }
    if (findDuplicate(c, fileIndex)) { report.dupFile++; continue; }
    for (const k of dedupeKeys(c)) fileIndex.set(k, c);
    if (!c.email) report.linkedinOnly++;
    toAdd.push(c);
    report.added++;
  }
  return { toAdd, report };
}

/** Activities to store when a contact is first added (ids filled in by the caller). */
export function addedActivities(contact, now = new Date()) {
  const at = new Date(now).toISOString();
  const acts = [{ contactId: contact.id, type: 'added', at }];
  if (clean(contact.notes)) acts.push({ contactId: contact.id, type: 'researched', at });
  return acts;
}

/* ---------- scoring ---------- */

const has = (text, re) => re.test(text);
const HIRING_SIGNALS = /\b(hiring|open roles?|openings?|vacanc\w+|expan\w+|funding|funded|raised|series [a-e]|growth|growing|new office|headcount|scal\w+|job posts?|recruit\w+|launch\w*|attrition|backfill\w*)\b/i;

export function tierFor(score) {
  return score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cold';
}
export const TIER_LABELS = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };

/** Score 0-100 with plain-language reasons. */
export function scoreContact(c) {
  const title = clean(c.title).toLowerCase();
  const industry = `${clean(c.industry)} ${clean(c.company)}`.toLowerCase();
  const notes = clean(c.notes);
  const reasons = [];
  let score = 0;
  const add = (pts, text) => { score += pts; reasons.push({ points: pts, text }); };

  // Seniority (max 35)
  if (has(title, /\b(avp|assistant vice president|senior manager|sr\.? manager|general manager|gm|associate director)\b/)) add(20, 'Senior manager level');
  else if (has(title, /\b(chief|c[efotimhpr]o|chro|cxo|founder|co-?founder|owner|president|vp|svp|evp|vice president|managing director|partner)\b/)) add(35, 'C-level / VP');
  else if (has(title, /\b(head|director)\b/)) add(28, 'Head / Director');
  else if (has(title, /\b(manager|lead|principal)\b/)) add(12, 'Manager level');
  else add(4, title ? 'Junior or unclear seniority' : 'No job title');

  // Function (max 30)
  if (has(title, /\b(talent|recruit\w*|hr|human resources?|people|chro|staffing|vendor\w*|procurement|workforce|hiring)\b/)) add(30, 'Owns hiring or vendors');
  else if (has(title, /\b(engineering|technology|technical|cto|cio|ciso|data|product|qa|quality|cloud|security|cybersecurity|it|devops|ai|ml|software|platform|infrastructure|analytics)\b/)) add(22, 'Tech hiring manager');
  else if (has(title, /\b(ceo|coo|cfo|founder|co-?founder|owner|president|managing director|sales|operations|business|collections|finance|revenue|growth|strategy|risk|credit)\b/)) add(15, 'Business leader');
  else add(5, 'Function unclear');

  // Industry fit (max 20)
  if (has(industry, /\b(fintech|bfsi|bank\w*|financial|finance|insurance|insurtech|nbfc|lending|loans?|payments?|wealth|capital|broking|credit|mutual funds?)\b/)) add(20, 'Fintech / BFSI');
  else if (has(industry, /\b(technology|tech|software|saas|it services|information technology|internet|computer\w*|cloud|ai|analytics|cybersecurity)\b/)) add(14, 'Technology');
  else add(4, industry.trim() ? 'Outside core industries' : 'Industry unknown');

  // Evidence (max 15)
  if (notes.length >= 40) add(8, 'Has research notes');
  else if (notes.length > 0) add(4, 'Short research notes');
  if (notes && has(notes, HIRING_SIGNALS)) add(7, 'Hiring signal in notes');

  score = Math.max(0, Math.min(100, score));
  const tier = tierFor(score);
  return { score, tier, reasons };
}

/* ---------- sending rules ---------- */

/** Manager is CC'd on first-touch emails only. Always editable afterwards. */
export function defaultCc(kind, settings) {
  return kind === 'first' ? normaliseEmail(settings?.managerEmail) : '';
}

export function followUpSubject(originalSubject) {
  const s = clean(originalSubject).replace(/^(re:\s*)+/i, '');
  return `Re: ${s || 'my earlier note'}`;
}

/** Which email may go to this contact next: 'first', 'followup' or null. */
export function nextEmailKind(contact) {
  if (!isValidEmail(contact.email)) return null;
  if (contact.status === 'new' && !(contact.step > 0)) return 'first';
  if (contact.status === 'in_sequence') return 'followup';
  return null;
}

export function canFollowUp(contact) {
  return nextEmailKind(contact) === 'followup';
}

const isOutbound = (a) => a.type === 'email_sent' && (a.kind === 'first' || a.kind === 'followup');

/** First emails + follow-ups sent on the given local day. */
export function sendsToday(activities, now = new Date()) {
  const today = dayKey(now);
  return activities.filter((a) => isOutbound(a) && dayKey(a.at) === today).length;
}

export function capFor(settings) {
  const n = parseInt(settings?.dailyCap, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS.dailyCap;
}

const fail = (reason) => ({ ok: false, reason });
const ok = (contact, activities) => ({ ok: true, contact, activities });
const iso = (now) => new Date(now).toISOString();

/**
 * Record that the user sent the drafted email.
 * draft: { kind?, subject, body, angle, cc }
 */
export function applySent(contact, draft, settings, now = new Date(), sentToday = 0) {
  const kind = nextEmailKind(contact);
  if (draft?.kind === 'first' && (contact.step > 0 || contact.status !== 'new')) {
    return fail('This contact already got a first email. They can only get follow-ups now.');
  }
  if (!kind) {
    if (!isValidEmail(contact.email)) return fail('This contact has no valid email address.');
    return fail(`${STATUS_LABELS[contact.status] || contact.status}: no more emails for this contact.`);
  }
  if (draft?.kind && draft.kind !== kind) return fail('No first email has been sent to this contact yet.');
  const cap = capFor(settings);
  if (sentToday >= cap) return fail(`Daily cap of ${cap} emails reached. Carry on tomorrow.`);

  const gaps = parseGaps(settings?.followUpGaps);
  const step = (contact.step || 0) + 1;
  const gap = gaps[step - 1];
  const hasNext = gap !== undefined;
  const subject = kind === 'first' ? clean(draft?.subject) : clean(draft?.subject) || followUpSubject(contact.firstSubject);
  const updated = {
    ...contact,
    step,
    status: hasNext ? 'in_sequence' : 'no_response',
    nextFollowUpAt: hasNext ? nextFollowUpDate(now, gap, settings?.skipWeekends !== false) : null,
    lastSentAt: iso(now),
    firstSubject: kind === 'first' ? subject : contact.firstSubject,
    skipUntil: null,
  };
  const activity = {
    contactId: contact.id, type: 'email_sent', kind, step, subject,
    body: clean(draft?.body), angle: clean(draft?.angle), cc: clean(draft?.cc), at: iso(now),
  };
  return ok(updated, [activity]);
}

/** Our answer to their reply. Logged, but does not move the sequence. */
export function applyReplySent(contact, draft, now = new Date()) {
  return ok({ ...contact, lastSentAt: iso(now), skipUntil: null }, [{
    contactId: contact.id, type: 'email_sent', kind: 'reply', step: contact.step || 0,
    subject: clean(draft?.subject), body: clean(draft?.body), angle: clean(draft?.angle), cc: clean(draft?.cc), at: iso(now),
  }]);
}

export function applyReply(contact, sentiment = 'neutral', now = new Date()) {
  const keepMeeting = contact.status === 'meeting' && sentiment !== 'negative';
  return ok(
    { ...contact, status: keepMeeting ? 'meeting' : 'replied', replySentiment: sentiment, nextFollowUpAt: null, skipUntil: null },
    [{ contactId: contact.id, type: 'reply', sentiment, at: iso(now) }],
  );
}

export function applyMeeting(contact, now = new Date()) {
  return ok(
    { ...contact, status: 'meeting', replySentiment: contact.replySentiment || 'positive', nextFollowUpAt: null, skipUntil: null },
    [{ contactId: contact.id, type: 'meeting', at: iso(now) }],
  );
}

export function applyBounce(contact, now = new Date()) {
  return ok({ ...contact, status: 'bounced', nextFollowUpAt: null, skipUntil: null }, [{ contactId: contact.id, type: 'bounce', at: iso(now) }]);
}

export function applyOptOut(contact, now = new Date()) {
  return ok({ ...contact, status: 'optout', nextFollowUpAt: null }, [{ contactId: contact.id, type: 'optout', at: iso(now) }]);
}

export function applySuppress(contact, now = new Date()) {
  return ok({ ...contact, status: 'suppressed', nextFollowUpAt: null }, [{ contactId: contact.id, type: 'suppressed', at: iso(now) }]);
}

export function applyLinkedInRequest(contact, note = '', now = new Date()) {
  return ok({ ...contact, linkedinStatus: 'requested', skipUntil: null }, [{ contactId: contact.id, type: 'linkedin_request', note: clean(note), at: iso(now) }]);
}

export function applyLinkedInStatus(contact, status, now = new Date()) {
  const acts = status === 'connected' && contact.linkedinStatus !== 'connected'
    ? [{ contactId: contact.id, type: 'linkedin_connected', at: iso(now) }] : [];
  return ok({ ...contact, linkedinStatus: status }, acts);
}

/** Hide from Today until tomorrow. */
export function applySkip(contact, now = new Date()) {
  return ok({ ...contact, skipUntil: dayKey(addDays(now, 1)) }, []);
}

/**
 * Undo a wrong outcome. Never re-opens a first-touch for someone already emailed:
 * if any email went out, they come back as a follow-up due today.
 */
export function applyReopen(contact, now = new Date()) {
  const emailed = (contact.step || 0) > 0;
  return ok(
    { ...contact, status: emailed ? 'in_sequence' : 'new', nextFollowUpAt: emailed ? dayKey(now) : null, replySentiment: null, skipUntil: null },
    [{ contactId: contact.id, type: 'reopened', at: iso(now) }],
  );
}

/** Save edited details. Logs "researched" the first time notes are added. */
export function applyEdit(contact, patch, now = new Date()) {
  const next = { ...contact, ...patch };
  if ('email' in patch) next.email = normaliseEmail(patch.email);
  const acts = !clean(contact.notes) && clean(next.notes) ? [{ contactId: contact.id, type: 'researched', at: iso(now) }] : [];
  return ok(next, acts);
}

/* ---------- Today queues ---------- */

const isSkipped = (c, today) => !!c.skipUntil && c.skipUntil > today;

export function inConversation(c) {
  return c.status === 'meeting' || (c.status === 'replied' && c.replySentiment !== 'negative');
}

/** Other people at the same company who are already talking to us. */
export function companyConversations(contact, contacts) {
  const key = normaliseCompany(contact.company);
  if (!key) return [];
  return contacts.filter((o) => o.id !== contact.id && inConversation(o) && normaliseCompany(o.company) === key);
}

export function buildQueues(contacts, activities, settings, now = new Date()) {
  const today = dayKey(now);
  const cap = capFor(settings);
  const sentToday = sendsToday(activities, now);
  const remaining = Math.max(0, cap - sentToday);
  const withScore = (c) => ({ ...c, _score: scoreContact(c) });

  const eligible = contacts
    .filter((c) => nextEmailKind(c) === 'first' && !isSkipped(c, today))
    .map(withScore)
    .sort((a, b) => b._score.score - a._score.score || fullName(a).localeCompare(fullName(b)));

  const followups = contacts
    .filter((c) => canFollowUp(c) && c.nextFollowUpAt && c.nextFollowUpAt <= today && !isSkipped(c, today))
    .map(withScore)
    .sort((a, b) => a.nextFollowUpAt.localeCompare(b.nextFollowUpAt) || b._score.score - a._score.score);

  const linkedin = contacts
    .filter((c) => {
      if (!linkedinSlug(c.linkedin) || isSkipped(c, today)) return false;
      if (c.linkedinStatus && c.linkedinStatus !== 'none') return false;
      if (['replied', 'meeting', 'optout', 'suppressed'].includes(c.status)) return false;
      const noEmail = !isValidEmail(c.email);
      const bounced = c.status === 'bounced';
      const unanswered = (c.step || 0) >= 2 && (c.status === 'in_sequence' || c.status === 'no_response');
      return noEmail || bounced || unanswered;
    })
    .map(withScore)
    .sort((a, b) => b._score.score - a._score.score);

  const replies = contacts
    .filter((c) => c.status === 'replied' && c.replySentiment !== 'negative' && !isSkipped(c, today))
    .map(withScore)
    .sort((a, b) => b._score.score - a._score.score);

  return {
    cap, sentToday, remaining,
    first: eligible.slice(0, remaining),
    firstEligible: eligible.length,
    followups, linkedin, replies,
  };
}

/* ---------- mail client link ---------- */

export const MAIL_CLIENTS = {
  outlook_work: 'Outlook on the web (work account)',
  outlook_com: 'Outlook.com (personal)',
  mailto: 'Default mail app (mailto)',
};

/** Compose link with to, cc, subject and body pre-filled. Nothing is sent. */
export function outlookLink(client, { to = '', cc = '', subject = '', body = '' }) {
  const enc = encodeURIComponent;
  const parts = [];
  if (client === 'mailto') {
    if (clean(cc)) parts.push(`cc=${enc(clean(cc))}`);
    parts.push(`subject=${enc(subject)}`, `body=${enc(String(body).replace(/\r?\n/g, '\r\n'))}`);
    return `mailto:${enc(clean(to))}?${parts.join('&')}`;
  }
  const base = client === 'outlook_com'
    ? 'https://outlook.live.com/mail/0/deeplink/compose'
    : 'https://outlook.office.com/mail/deeplink/compose';
  parts.push(`to=${enc(clean(to))}`);
  if (clean(cc)) parts.push(`cc=${enc(clean(cc))}`);
  parts.push(`subject=${enc(subject)}`, `body=${enc(body)}`);
  return `${base}?${parts.join('&')}`;
}

/* ---------- dashboard ---------- */

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const distinct = (acts) => new Set(acts.map((a) => a.contactId)).size;

/**
 * Everything on the dashboard, computed from activities.
 * filters: { days: 7|30|90|0 (all), campaign, industry }
 */
export function computeStats(contacts, activities, filters = {}, now = new Date()) {
  const { days = 0, campaign = '', industry = '' } = filters;
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const inScope = (c) => !!c && (!campaign || c.campaign === campaign) && (!industry || c.industry === industry);
  let since = null;
  if (days > 0) { since = addDays(now, -(days - 1)); since.setHours(0, 0, 0, 0); }

  const scopedAll = activities.filter((a) => inScope(byId.get(a.contactId))).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const acts = scopedAll.filter((a) => !since || new Date(a.at) >= since);
  const of = (type) => acts.filter((a) => a.type === type);

  const firstEmails = acts.filter((a) => a.type === 'email_sent' && a.kind === 'first');
  const followUps = acts.filter((a) => a.type === 'email_sent' && a.kind === 'followup');
  const replies = of('reply');
  const interested = replies.filter((a) => a.sentiment === 'positive');
  const meetings = of('meeting');
  const scopedContacts = contacts.filter(inScope);
  const today = dayKey(now);

  const tiles = {
    meetings: distinct(meetings),
    meetingRate: pct(distinct(meetings), firstEmails.length),
    replies: distinct(replies),
    replyRate: pct(distinct(replies), firstEmails.length),
    interested: distinct(interested),
    activeOpportunities: scopedContacts.filter(inConversation).length,
    firstEmails: firstEmails.length,
    followUps: followUps.length,
    followUpsDue: scopedContacts.filter((c) => canFollowUp(c) && c.nextFollowUpAt && c.nextFollowUpAt <= today).length,
    linkedinRequests: of('linkedin_request').length,
    added: of('added').length,
    researched: distinct(of('researched')),
    bounces: distinct(of('bounce')),
    optouts: distinct(of('optout')),
  };

  const funnel = [
    { label: 'Contacts added', value: tiles.added },
    { label: 'First email sent', value: distinct(firstEmails) },
    { label: 'Replied', value: tiles.replies },
    { label: 'Interested', value: tiles.interested },
    { label: 'Meeting booked', value: tiles.meetings },
  ];

  const nDays = days > 0 ? days : 30;
  const perDayMap = new Map();
  for (let i = nDays - 1; i >= 0; i--) perDayMap.set(dayKey(addDays(now, -i)), 0);
  for (const a of scopedAll) {
    if (!isOutbound(a)) continue;
    const k = dayKey(a.at);
    if (perDayMap.has(k)) perDayMap.set(k, perDayMap.get(k) + 1);
  }
  const perDay = [...perDayMap].map(([date, count]) => ({ date, count }));

  const indMap = new Map();
  const indRow = (a) => {
    const name = clean(byId.get(a.contactId)?.industry) || 'Unknown';
    if (!indMap.has(name)) indMap.set(name, { industry: name, emailed: new Set(), replied: new Set(), meetings: new Set() });
    return indMap.get(name);
  };
  for (const a of firstEmails) indRow(a).emailed.add(a.contactId);
  for (const a of replies) indRow(a).replied.add(a.contactId);
  for (const a of meetings) indRow(a).meetings.add(a.contactId);
  const byIndustry = [...indMap.values()]
    .map((r) => ({ industry: r.industry, emailed: r.emailed.size, replies: r.replied.size, meetings: r.meetings.size, replyRate: pct(r.replied.size, r.emailed.size) }))
    .sort((a, b) => b.emailed - a.emailed || b.replies - a.replies);

  const angles = angleStats(scopedAll, since);
  return { tiles, funnel, perDay, byIndustry, angles };
}

/**
 * "Which angles get replies": each reply is credited to the LAST email sent
 * to that contact before the reply arrived.
 */
export function angleStats(activities, since = null) {
  const sorted = [...activities].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const inRange = (a) => !since || new Date(a.at) >= since;
  const rows = new Map();
  const row = (angle) => {
    const k = clean(angle) || 'No angle recorded';
    if (!rows.has(k)) rows.set(k, { angle: k, sent: 0, replies: 0, interested: 0 });
    return rows.get(k);
  };
  const lastEmail = new Map();
  const credited = new Set();
  for (const a of sorted) {
    if (isOutbound(a)) {
      lastEmail.set(a.contactId, a);
      credited.delete(a.contactId);
      if (inRange(a)) row(a.angle).sent++;
    } else if (a.type === 'reply' && inRange(a)) {
      const email = lastEmail.get(a.contactId);
      if (!email) continue;
      const r = row(email.angle);
      if (!credited.has(a.contactId)) { r.replies++; credited.add(a.contactId); }
      if (a.sentiment === 'positive') r.interested++;
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, replyRate: pct(r.replies, r.sent) }))
    .sort((a, b) => b.replies - a.replies || b.sent - a.sent);
}

/* ---------- export ---------- */

const csvCell = (v) => {
  const s = clean(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function contactsToCsv(contacts) {
  const cols = [
    ['First Name', (c) => c.firstName], ['Last Name', (c) => c.lastName], ['Title', (c) => c.title],
    ['Company', (c) => c.company], ['Email', (c) => c.email], ['Person Linkedin Url', (c) => c.linkedin],
    ['Industry', (c) => c.industry], ['City', (c) => c.city], ['Campaign', (c) => c.campaign],
    ['Status', (c) => STATUS_LABELS[c.status] || c.status], ['Score', (c) => scoreContact(c).score],
    ['Emails Sent', (c) => c.step || 0], ['Next Follow-up', (c) => c.nextFollowUpAt || ''],
    ['LinkedIn Status', (c) => c.linkedinStatus || 'none'], ['Research Notes', (c) => c.notes],
  ];
  const lines = [cols.map(([h]) => csvCell(h)).join(',')];
  for (const c of contacts) lines.push(cols.map(([, f]) => csvCell(f(c))).join(','));
  return lines.join('\r\n');
}

/* ---------- example data (all fictional) ---------- */

export const EXAMPLE_CAMPAIGN = 'Example contacts';
export const EXAMPLE_CONTACTS = [
  { firstName: 'Meera', lastName: 'Kulkarni', title: 'Chief Human Resources Officer', company: 'Paylattice Fintech Pvt Ltd', email: 'meera.kulkarni@paylattice.example.com', linkedin: 'https://www.linkedin.com/in/meera-kulkarni-example', industry: 'Fintech', city: 'Mumbai', notes: 'Careers page lists 14 open roles across engineering and risk. Announced expansion into SME lending last month.' },
  { firstName: 'Arjun', lastName: 'Sethi', title: 'VP Engineering', company: 'Northwind Ledger Technologies', email: 'arjun.sethi@northwindledger.example.com', linkedin: 'https://www.linkedin.com/in/arjun-sethi-example', industry: 'Fintech', city: 'Bengaluru', notes: 'Posted about scaling the platform team and hiring senior backend and SRE engineers.' },
  { firstName: 'Farah', lastName: 'Qureshi', title: 'Head of Talent Acquisition', company: 'Bluekite Bank', email: 'farah.qureshi@bluekitebank.example.com', linkedin: 'https://www.linkedin.com/in/farah-qureshi-example', industry: 'Banking', city: 'Mumbai', notes: '' },
  { firstName: 'Rohan', lastName: 'Deshpande', title: 'Director of Data & AI', company: 'Quanta Orchard Software', email: 'rohan.deshpande@quantaorchard.example.com', linkedin: 'https://www.linkedin.com/in/rohan-deshpande-example', industry: 'Technology', city: 'Pune', notes: 'Spoke at a meetup about building an ML platform team from scratch.' },
  { firstName: 'Lakshmi', lastName: 'Venkataraman', title: 'Chief Technology Officer', company: 'Saffron Mutual Insurance', email: 'lakshmi.v@saffronmutual.example.com', linkedin: 'https://www.linkedin.com/in/lakshmi-venkataraman-example', industry: 'Insurance', city: 'Chennai', notes: '' },
  { firstName: 'Kabir', lastName: 'Anand', title: 'Senior Manager, Collections', company: 'Tidewater NBFC', email: 'kabir.anand@tidewaternbfc.example.com', linkedin: 'https://www.linkedin.com/in/kabir-anand-example', industry: 'BFSI', city: 'Delhi', notes: 'Headcount for field collections growing ahead of festive season.' },
  { firstName: 'Sneha', lastName: 'Pillai', title: 'Engineering Manager, QA', company: 'Cobalt Harbor Systems', email: 'sneha.pillai@cobaltharbor.example.com', linkedin: 'https://www.linkedin.com/in/sneha-pillai-example', industry: 'Technology', city: 'Hyderabad', notes: '' },
  { firstName: 'Vikram', lastName: 'Bose', title: 'Co-Founder & CEO', company: 'Lumen Ridge Payments', email: 'vikram.bose@lumenridge.example.com', linkedin: 'https://www.linkedin.com/in/vikram-bose-example', industry: 'Fintech', city: 'Bengaluru', notes: 'Raised a Series A recently; said in an interview that hiring a product leader is the next priority.' },
  { firstName: 'Ananya', lastName: 'Ghosh', title: 'Head of Cybersecurity', company: 'Ironfern Cloud Inc', email: '', linkedin: 'https://www.linkedin.com/in/ananya-ghosh-example', industry: 'Technology', city: 'Gurugram', notes: 'No email found. Active on LinkedIn about cloud security hiring.' },
  { firstName: 'Dev', lastName: 'Malhotra', title: 'Sales Operations Analyst', company: 'Greenpost Logistics', email: 'dev.malhotra@greenpost.example.com', linkedin: 'https://www.linkedin.com/in/dev-malhotra-example', industry: 'Logistics', city: 'Jaipur', notes: '' },
];
