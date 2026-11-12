// Run with: npm test   (plain Node, no test framework)
import assert from 'node:assert/strict';
import * as L from '../src/lib/logic.js';
import * as AI from '../src/lib/ai.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const settings = { ...L.DEFAULT_SETTINGS, senderName: 'Sam Rao', managerEmail: 'Boss@TalentiFi.example.com' };
// Thursday 12 Nov 2026, 10:00 local time.
const THU = new Date(2026, 10, 12, 10, 0, 0);
let nextId = 1;
const mk = (over = {}) => ({ id: nextId++, ...L.newContact({ firstName: 'Asha', lastName: 'Rao', title: 'Head of Talent Acquisition', company: 'Acme Fintech Pvt Ltd', email: `asha${nextId}@acme.example.com`, industry: 'Fintech', ...over }, THU), ...(over._state || {}) });
const draft = (over = {}) => ({ subject: 'A question on niche hiring', body: 'Hello there', angle: 'Hard-to-fill roles', cc: '', ...over });

console.log('\nCC rules');
test('manager is CC\'d on first-touch only', () => {
  assert.equal(L.defaultCc('first', settings), 'boss@talentifi.example.com');
  assert.equal(L.defaultCc('followup', settings), '');
  assert.equal(L.defaultCc('reply', settings), '');
});
test('no manager email means no CC', () => {
  assert.equal(L.defaultCc('first', { ...settings, managerEmail: '' }), '');
});
test('CC is editable: the sent activity stores whatever CC the user left', () => {
  const r = L.applySent(mk(), draft({ kind: 'first', cc: 'someone.else@example.com' }), settings, THU, 0);
  assert.equal(r.activities[0].cc, 'someone.else@example.com');
  const r2 = L.applySent(mk(), draft({ kind: 'first', cc: '' }), settings, THU, 0);
  assert.equal(r2.activities[0].cc, '');
});

console.log('\nFirst-touch guard');
test('first send: step 1, in sequence, activity stored', () => {
  const r = L.applySent(mk(), draft({ kind: 'first' }), settings, THU, 0);
  assert.equal(r.ok, true);
  assert.equal(r.contact.step, 1);
  assert.equal(r.contact.status, 'in_sequence');
  assert.equal(r.contact.firstSubject, 'A question on niche hiring');
  assert.equal(r.activities.length, 1);
  assert.equal(r.activities[0].type, 'email_sent');
  assert.equal(r.activities[0].kind, 'first');
});
test('a contact can never get a second first-touch email', () => {
  const first = L.applySent(mk(), draft({ kind: 'first' }), settings, THU, 0);
  const again = L.applySent(first.contact, draft({ kind: 'first' }), settings, THU, 1);
  assert.equal(again.ok, false);
  assert.match(again.reason, /already got a first email/);
  assert.equal(L.nextEmailKind(first.contact), 'followup');
  // Without an explicit kind, the next send is recorded as a follow-up, never a first.
  const next = L.applySent(first.contact, draft(), settings, THU, 1);
  assert.equal(next.activities[0].kind, 'followup');
});
test('no first-touch for any status other than new', () => {
  for (const status of ['in_sequence', 'replied', 'meeting', 'no_response', 'bounced', 'optout', 'suppressed']) {
    const c = mk({ _state: { status, step: 1 } });
    assert.equal(L.applySent(c, draft({ kind: 'first' }), settings, THU, 0).ok, false, status);
    assert.notEqual(L.nextEmailKind(c), 'first', status);
  }
});
test('re-opening an emailed contact gives a follow-up, not a new first email', () => {
  const sent = L.applySent(mk(), draft({ kind: 'first' }), settings, THU, 0).contact;
  const bounced = L.applyBounce(sent, THU).contact;
  const reopened = L.applyReopen(bounced, THU).contact;
  assert.equal(L.nextEmailKind(reopened), 'followup');
  assert.equal(L.applyReopen(mk(), THU).contact.status, 'new');
});
test('first-touch needs a valid email', () => {
  const c = mk({ email: '' });
  assert.equal(L.nextEmailKind(c), null);
  assert.equal(L.applySent(c, draft({ kind: 'first' }), settings, THU, 0).ok, false);
});

console.log('\nStopping follow-ups');
test('replied / meeting / bounced / optout / suppressed never get follow-ups', () => {
  for (const status of L.NO_FOLLOWUP_STATUSES) {
    const c = mk({ _state: { status, step: 1, nextFollowUpAt: '2026-11-01' } });
    assert.equal(L.canFollowUp(c), false, status);
    assert.equal(L.applySent(c, draft(), settings, THU, 0).ok, false, status);
    const q = L.buildQueues([c], [], settings, THU);
    assert.equal(q.followups.length, 0, status);
  }
  assert.deepEqual([...L.NO_FOLLOWUP_STATUSES].sort(), ['bounced', 'meeting', 'optout', 'replied', 'suppressed']);
});
test('each outcome clears the scheduled follow-up and logs an activity', () => {
  const sent = L.applySent(mk(), draft({ kind: 'first' }), settings, THU, 0).contact;
  const cases = [
    [L.applyReply(sent, 'positive', THU), 'replied', 'reply'],
    [L.applyMeeting(sent, THU), 'meeting', 'meeting'],
    [L.applyBounce(sent, THU), 'bounced', 'bounce'],
    [L.applyOptOut(sent, THU), 'optout', 'optout'],
    [L.applySuppress(sent, THU), 'suppressed', 'suppressed'],
  ];
  for (const [r, status, type] of cases) {
    assert.equal(r.contact.status, status);
    assert.equal(r.contact.nextFollowUpAt, null);
    assert.equal(r.activities[0].type, type);
    assert.equal(r.activities[0].contactId, sent.id);
    assert.equal(L.canFollowUp(r.contact), false);
  }
  assert.equal(L.applyReply(sent, 'negative', THU).activities[0].sentiment, 'negative');
});
test('LinkedIn request is stored as an activity', () => {
  const r = L.applyLinkedInRequest(mk(), 'Hi Asha', THU);
  assert.equal(r.contact.linkedinStatus, 'requested');
  assert.equal(r.activities[0].type, 'linkedin_request');
  assert.equal(r.activities[0].note, 'Hi Asha');
});

console.log('\nSchedule');
test('gaps parse from text', () => {
  assert.deepEqual(L.parseGaps('3, 5, 7'), [3, 5, 7]);
  assert.deepEqual(L.parseGaps(' 2;4  x, 0, 6 '), [2, 4, 6]);
  assert.deepEqual(L.parseGaps(''), []);
});
test('weekends move to Monday', () => {
  // Thu 12 Nov + 3 = Sun 15 Nov -> Mon 16 Nov
  assert.equal(L.nextFollowUpDate(THU, 3, true), '2026-11-16');
  // Thu + 2 = Sat 14 Nov -> Mon 16 Nov
  assert.equal(L.nextFollowUpDate(THU, 2, true), '2026-11-16');
  // Thu + 5 = Tue 17 Nov (unchanged)
  assert.equal(L.nextFollowUpDate(THU, 5, true), '2026-11-17');
  // Weekend skipping off
  assert.equal(L.nextFollowUpDate(THU, 3, false), '2026-11-15');
});
test('full sequence: step += 1 each send, then no_response after the last gap', () => {
  let c = mk();
  let r = L.applySent(c, draft({ kind: 'first' }), settings, THU, 0);
  assert.equal(r.contact.step, 1);
  assert.equal(r.contact.nextFollowUpAt, '2026-11-16'); // +3 -> Sunday -> Monday
  const MON = new Date(2026, 10, 16, 9);
  r = L.applySent(r.contact, draft({ subject: '' }), settings, MON, 0);
  assert.equal(r.contact.step, 2);
  assert.equal(r.contact.status, 'in_sequence');
  assert.equal(r.contact.nextFollowUpAt, '2026-11-23'); // Mon + 5 = Sat -> Mon
  assert.equal(r.activities[0].kind, 'followup');
  assert.equal(r.activities[0].subject, 'Re: A question on niche hiring');
  r = L.applySent(r.contact, draft({ subject: '' }), settings, new Date(2026, 10, 23, 9), 0);
  assert.equal(r.contact.step, 3);
  assert.equal(r.contact.nextFollowUpAt, '2026-11-30'); // Mon + 7
  r = L.applySent(r.contact, draft({ subject: '' }), settings, new Date(2026, 10, 30, 9), 0);
  assert.equal(r.contact.step, 4);
  assert.equal(r.contact.status, 'no_response');
  assert.equal(r.contact.nextFollowUpAt, null);
  // Nothing more can be sent.
  assert.equal(L.applySent(r.contact, draft(), settings, new Date(2026, 11, 7, 9), 0).ok, false);
});

console.log('\nThread and angles');
test('follow-up subject keeps the thread', () => {
  assert.equal(L.followUpSubject('Niche hiring at Acme'), 'Re: Niche hiring at Acme');
  assert.equal(L.followUpSubject('Re: RE: Niche hiring at Acme'), 'Re: Niche hiring at Acme');
});
test('template follow-ups use a new angle at every step and stay in thread', () => {
  const c = mk({ _state: { firstSubject: 'Niche hiring at Acme', step: 1, status: 'in_sequence' } });
  const drafts = [1, 2, 3, 4].map((step) => AI.templateDraft({ contact: c, kind: 'followup', step }));
  assert.equal(new Set(drafts.map((d) => d.angle)).size, 4);
  assert.equal(new Set(drafts.map((d) => d.body)).size, 4);
  for (const d of drafts) {
    assert.equal(d.subject, 'Re: Niche hiring at Acme');
    const w = L.wordCount(d.body);
    assert.ok(w >= 45 && w <= 90, `follow-up is ${w} words`);
    assert.match(d.body, /15-20 minute/);
  }
});
test('template first emails: 90-140 words, short subject, one CTA, flagged low evidence', () => {
  const titles = ['Head of Talent Acquisition', 'VP Engineering', 'Co-Founder & CEO'];
  const buckets = new Set();
  for (const title of titles) {
    const c = mk({ title });
    buckets.add(AI.roleBucket(c));
    const d = AI.templateDraft({ contact: c, kind: 'first' });
    const w = L.wordCount(d.body);
    assert.ok(w >= 90 && w <= 140, `${title}: ${w} words`);
    assert.ok(L.wordCount(d.subject) < 8, d.subject);
    assert.equal(d.lowEvidence, true);
    assert.equal((d.body.match(/15-20 minute/g) || []).length, 1);
    assert.ok(d.angle);
  }
  assert.equal(buckets.size, 3);
});
test('signature is appended once', () => {
  const s = { ...settings, signature: 'Sam Rao\nTalentiFi-X' };
  const once = AI.appendSignature('Hello', s);
  assert.equal(once, 'Hello\n\nSam Rao\nTalentiFi-X');
  assert.equal(AI.appendSignature(once, s), once);
  assert.equal(AI.signatureOf({ senderName: 'Sam', senderTitle: 'BDM', senderCompany: 'TalentiFi-X', signature: '' }), 'Sam\nBDM\nTalentiFi-X');
});
test('LinkedIn template note fits in 280 characters', () => {
  const note = AI.templateLinkedInNote(mk({ company: 'A Very Long Company Name That Goes On And On And On Forever Pvt Ltd' }));
  assert.ok(note.length <= 280);
  assert.ok(AI.templateLinkedInNote(mk()).includes('at Acme Fintech.'));
  assert.equal(AI.spokenCompany('Acme Fintech Pvt. Ltd.'), 'Acme Fintech');
  assert.equal(AI.spokenCompany('Ironfern Cloud Inc'), 'Ironfern Cloud');
  assert.equal(AI.spokenCompany('Bluekite Bank'), 'Bluekite Bank');
});
test('prompts carry the rules, the pitch, the notes and the thread', () => {
  const sys = AI.buildSystemPrompt({ ...settings, pitch: 'PITCH-TEXT' });
  assert.match(sys, /PITCH-TEXT/);
  assert.match(sys, /NEVER invent/);
  assert.match(sys, /low_evidence/);
  const c = mk({ notes: 'Hiring 12 engineers' });
  assert.match(AI.buildUserPrompt({ contact: c, kind: 'first' }), /Hiring 12 engineers/);
  assert.match(AI.buildUserPrompt({ contact: c, kind: 'first' }), /90-140 words/);
  const fu = AI.buildUserPrompt({ contact: c, kind: 'followup', step: 2, thread: [{ kind: 'first', subject: 'S1', body: 'B1', angle: 'A1' }] });
  assert.match(fu, /45-90 words/);
  assert.match(fu, /B1/);
  assert.match(fu, /Niche and leadership talent quality/);
  assert.match(AI.buildUserPrompt({ contact: c, kind: 'linkedin' }), /280 characters/);
});

console.log('\nAI parsing and errors');
test('robust JSON parsing', () => {
  assert.equal(AI.parseAiJson('{"subject":"Hi","body":"B"}').subject, 'Hi');
  assert.equal(AI.parseAiJson('```json\n{"subject":"Hi"}\n```').subject, 'Hi');
  assert.equal(AI.parseAiJson('Sure! Here it is:\n{"subject":"Hi","body":"x"}\nHope it helps').subject, 'Hi');
  assert.equal(AI.parseAiJson('{"subject":"Hi","body":"line one\nline two",}').body, 'line one\nline two');
  assert.throws(() => AI.parseAiJson('no json here'), /expected format/);
  const d = AI.normaliseDraft({ subject: ' Hi \n there ', body: 'a\\nb', evidence_used: 'one', low_evidence: 'true' });
  assert.deepEqual(d, { subject: 'Hi there', body: 'a\nb', angle: '', evidenceUsed: ['one'], lowEvidence: true });
});
test('friendly errors for 401 / 403 / 429 / 404', () => {
  assert.match(AI.friendlyError(401, 'groq'), /API key/);
  assert.match(AI.friendlyError(403, 'gemini'), /API key/);
  assert.match(AI.friendlyError(429, 'gemini'), /rate limit/i);
  assert.match(AI.friendlyError(404, 'anthropic'), /model/);
  assert.match(AI.friendlyError(400, 'gemini', 'API key not valid'), /API key/);
});
test('provider defaults and pacing', () => {
  assert.equal(AI.providerOf({}), 'templates');
  assert.equal(AI.modelOf({ aiProvider: 'gemini' }), 'gemini-2.5-flash');
  assert.equal(AI.modelOf({ aiProvider: 'groq' }), 'llama-3.3-70b-versatile');
  assert.equal(AI.modelOf({ aiProvider: 'groq', aiModel: 'custom' }), 'custom');
  assert.equal(AI.paceMs({ aiProvider: 'templates' }), 0);
  assert.ok(AI.paceMs({ aiProvider: 'gemini' }) >= 4000);
});

console.log('\nDaily cap');
test('sends today counts first emails and follow-ups on the local day only', () => {
  const acts = [
    { type: 'email_sent', kind: 'first', at: THU.toISOString() },
    { type: 'email_sent', kind: 'followup', at: THU.toISOString() },
    { type: 'email_sent', kind: 'reply', at: THU.toISOString() },
    { type: 'email_sent', kind: 'first', at: new Date(2026, 10, 11, 23).toISOString() },
    { type: 'reply', at: THU.toISOString() },
  ];
  assert.equal(L.sendsToday(acts, THU), 2);
});
test('cap blocks sending and limits the first-email queue', () => {
  const s = { ...settings, dailyCap: 2 };
  assert.equal(L.applySent(mk(), draft({ kind: 'first' }), s, THU, 2).ok, false);
  assert.match(L.applySent(mk(), draft({ kind: 'first' }), s, THU, 2).reason, /cap/i);
  assert.equal(L.applySent(mk(), draft({ kind: 'first' }), s, THU, 1).ok, true);
  const contacts = [mk(), mk(), mk(), mk()];
  const oneSent = [{ type: 'email_sent', kind: 'first', contactId: 999, at: THU.toISOString() }];
  const q = L.buildQueues(contacts, oneSent, s, THU);
  assert.equal(q.first.length, 1);
  assert.equal(q.firstEligible, 4);
  assert.equal(q.remaining, 1);
  assert.equal(L.buildQueues(contacts, [...oneSent, ...oneSent], s, THU).first.length, 0);
});

console.log('\nToday queues');
test('first emails: new + valid email, best score first', () => {
  const hot = mk({ title: 'Chief Human Resources Officer', notes: 'They are hiring 20 engineers this quarter across teams.' });
  const cold = mk({ title: 'Analyst', industry: 'Logistics', company: 'Boxes' });
  const noEmail = mk({ email: '', linkedin: 'https://linkedin.com/in/no-email' });
  const sent = mk({ _state: { status: 'in_sequence', step: 1, nextFollowUpAt: '2026-11-20' } });
  const q = L.buildQueues([cold, hot, noEmail, sent], [], settings, THU);
  assert.deepEqual(q.first.map((c) => c.id), [hot.id, cold.id]);
});
test('follow-ups due: today or overdue only', () => {
  const due = mk({ _state: { status: 'in_sequence', step: 1, nextFollowUpAt: '2026-11-12' } });
  const overdue = mk({ _state: { status: 'in_sequence', step: 2, nextFollowUpAt: '2026-11-09' } });
  const later = mk({ _state: { status: 'in_sequence', step: 1, nextFollowUpAt: '2026-11-13' } });
  const q = L.buildQueues([due, overdue, later], [], settings, THU);
  assert.deepEqual(q.followups.map((c) => c.id), [overdue.id, due.id]);
});
test('LinkedIn: no email, bounced, or 2+ unanswered emails, with a profile URL', () => {
  const li = 'https://www.linkedin.com/in/someone';
  const noEmail = mk({ email: '', linkedin: li + '1' });
  const bounced = mk({ linkedin: li + '2', _state: { status: 'bounced', step: 1 } });
  const twoSent = mk({ linkedin: li + '3', _state: { status: 'in_sequence', step: 2, nextFollowUpAt: '2026-11-20' } });
  const oneSent = mk({ linkedin: li + '4', _state: { status: 'in_sequence', step: 1 } });
  const noUrl = mk({ email: '' });
  const requested = mk({ email: '', linkedin: li + '5', _state: { linkedinStatus: 'requested' } });
  const replied = mk({ linkedin: li + '6', _state: { status: 'replied', step: 2, replySentiment: 'positive' } });
  const q = L.buildQueues([noEmail, bounced, twoSent, oneSent, noUrl, requested, replied], [], settings, THU);
  assert.deepEqual(q.linkedin.map((c) => c.id).sort(), [noEmail.id, bounced.id, twoSent.id].sort());
});
test('replies: replied and not negative', () => {
  const pos = mk({ _state: { status: 'replied', replySentiment: 'positive', step: 1 } });
  const neu = mk({ _state: { status: 'replied', replySentiment: 'neutral', step: 1 } });
  const neg = mk({ _state: { status: 'replied', replySentiment: 'negative', step: 1 } });
  const q = L.buildQueues([pos, neu, neg], [], settings, THU);
  assert.deepEqual(q.replies.map((c) => c.id).sort(), [pos.id, neu.id].sort());
});
test('skip today hides a contact until tomorrow', () => {
  const c = L.applySkip(mk(), THU).contact;
  assert.equal(L.buildQueues([c], [], settings, THU).first.length, 0);
  assert.equal(L.buildQueues([c], [], settings, new Date(2026, 10, 13, 9)).first.length, 1);
});
test('same-company conversation warning', () => {
  const talking = mk({ firstName: 'Ravi', company: 'Acme Fintech Limited', _state: { status: 'replied', replySentiment: 'positive' } });
  const said_no = mk({ firstName: 'Nina', company: 'Acme Fintech', _state: { status: 'replied', replySentiment: 'negative' } });
  const target = mk({ firstName: 'Zoya', company: 'ACME Fintech Pvt. Ltd.' });
  const other = mk({ company: 'Other Co' });
  assert.deepEqual(L.companyConversations(target, [talking, said_no, target, other]).map((c) => c.id), [talking.id]);
  assert.equal(L.companyConversations(other, [talking, target, other]).length, 0);
});

console.log('\nImport, mapping and duplicates');
const APOLLO = ['First Name', 'Last Name', 'Title', 'Company', 'Company Name for Emails', 'Email', 'Person Linkedin Url', 'Company Linkedin Url', 'Industry', 'City'];
test('auto-maps Apollo headers', () => {
  assert.deepEqual(L.autoMapColumns(APOLLO), {
    firstName: 'First Name', lastName: 'Last Name', fullName: '', title: 'Title', company: 'Company',
    email: 'Email', linkedin: 'Person Linkedin Url', industry: 'Industry', city: 'City', notes: '',
  });
});
test('auto-maps other common headers', () => {
  const m = L.autoMapColumns(['Full Name', 'Designation', 'Organization', 'E-mail Address', 'LinkedIn', 'Sector', 'Location', 'Notes']);
  assert.equal(m.fullName, 'Full Name');
  assert.equal(m.title, 'Designation');
  assert.equal(m.company, 'Organization');
  assert.equal(m.email, 'E-mail Address');
  assert.equal(m.linkedin, 'LinkedIn');
  assert.equal(m.industry, 'Sector');
  assert.equal(m.city, 'Location');
  assert.equal(m.notes, 'Notes');
});
test('email validation', () => {
  for (const e of ['a@b.co', 'First.Last+tag@sub.example.com']) assert.equal(L.isValidEmail(e), true, e);
  for (const e of ['', 'a@b', 'a b@c.com', 'a@@b.com', 'a..b@c.com', 'nope']) assert.equal(L.isValidEmail(e), false, e);
});
test('normalisers', () => {
  assert.equal(L.linkedinSlug('https://www.linkedin.com/in/Asha-Rao-123/?utm=1'), 'asha-rao-123');
  assert.equal(L.linkedinSlug('linkedin.com/in/asha-rao-123'), 'asha-rao-123');
  assert.equal(L.linkedinSlug('https://www.linkedin.com/company/acme'), '');
  assert.equal(L.normaliseCompany('Acme Technologies Pvt. Ltd.'), 'acme');
  assert.equal(L.normaliseCompany('ACME, Inc'), 'acme');
  assert.equal(L.normaliseCompany('Tech Solutions'), 'tech solutions');
});
test('duplicates match by email, LinkedIn slug, or name + company', () => {
  const existing = [{ id: 1, ...L.newContact({ firstName: 'Asha', lastName: 'Rao', company: 'Acme Technologies Pvt Ltd', email: 'asha@acme.example.com', linkedin: 'https://linkedin.com/in/asha-rao' }) }];
  assert.ok(L.findDuplicate(L.newContact({ email: 'ASHA@acme.example.com ' }), existing));
  assert.ok(L.findDuplicate(L.newContact({ email: 'other@x.example.com', linkedin: 'https://www.linkedin.com/in/Asha-Rao/' }), existing));
  assert.ok(L.findDuplicate(L.newContact({ firstName: 'asha', lastName: 'RAO', company: 'Acme Inc', email: 'new@x.example.com' }), existing));
  assert.equal(L.findDuplicate(L.newContact({ firstName: 'Asha', lastName: 'Rao', company: 'Zenith', email: 'a@z.example.com' }), existing), null);
});
test('import report: added, duplicates, invalid, LinkedIn-only, skipped', () => {
  const existing = [{ id: 1, ...L.newContact({ firstName: 'Old', lastName: 'One', company: 'Acme', email: 'old@acme.example.com' }) }];
  const row = (fn, ln, co, em, li = '') => ({ 'First Name': fn, 'Last Name': ln, Title: 'Head of HR', Company: co, Email: em, 'Person Linkedin Url': li, Industry: 'Fintech', City: 'Pune' });
  const rows = [
    row('New', 'Person', 'Beta', 'new@beta.example.com'),            // added
    row('Old', 'One', 'Acme', 'OLD@acme.example.com'),               // dup in DB (email)
    row('Old', 'One', 'Acme Pvt Ltd', 'different@acme.example.com'), // dup in DB (name + company)
    row('New', 'Person', 'Beta Ltd', 'np@beta.example.com'),         // dup in file (name + company)
    row('Bad', 'Email', 'Gamma', 'not-an-email'),                    // invalid, dropped
    row('Bad', 'ButLinked', 'Delta', 'oops@', 'https://linkedin.com/in/bad-butlinked'), // invalid, kept LinkedIn-only
    row('Only', 'Linked', 'Eps', '', 'https://linkedin.com/in/only-linked'),            // LinkedIn-only
    row('No', 'Contact', 'Zeta', ''),                                // skipped: no email, no LinkedIn
    row('', '', '', ''),                                             // skipped: empty
  ];
  const { toAdd, report } = L.importRows(rows, L.autoMapColumns(Object.keys(rows[0])), existing, 'Nov list', THU);
  assert.deepEqual(report, { total: 9, added: 3, dupDb: 2, dupFile: 1, invalidEmail: 2, linkedinOnly: 2, skipped: 2 });
  assert.equal(toAdd.length, 3);
  assert.equal(toAdd[0].campaign, 'Nov list');
  assert.equal(toAdd[0].status, 'new');
  assert.equal(toAdd[1].email, '');
});
test('full name column is split', () => {
  const f = L.rowToFields({ Name: 'Asha Devi Rao' }, { fullName: 'Name' });
  assert.equal(f.firstName, 'Asha');
  assert.equal(f.lastName, 'Devi Rao');
});
test('example contacts: 10 fictional, example.com emails, one LinkedIn-only', () => {
  assert.equal(L.EXAMPLE_CONTACTS.length, 10);
  const withEmail = L.EXAMPLE_CONTACTS.filter((c) => c.email);
  assert.equal(withEmail.length, 9);
  for (const c of withEmail) assert.match(c.email, /example\.com$/);
  const { report } = L.importRows(L.EXAMPLE_CONTACTS.map((c) => ({ ...c })), Object.fromEntries(L.IMPORT_FIELDS.map(([f]) => [f, f === 'fullName' ? '' : f])), [], 'x', THU);
  assert.equal(report.added, 10);
  assert.equal(report.linkedinOnly, 1);
});
test('added activities include "researched" when notes exist', () => {
  assert.deepEqual(L.addedActivities({ id: 5, notes: '' }, THU).map((a) => a.type), ['added']);
  assert.deepEqual(L.addedActivities({ id: 5, notes: 'x' }, THU).map((a) => a.type), ['added', 'researched']);
  assert.equal(L.applyEdit(mk(), { notes: 'New note' }, THU).activities[0].type, 'researched');
  assert.equal(L.applyEdit(mk({ notes: 'had' }), { notes: 'changed' }, THU).activities.length, 0);
});

console.log('\nScoring');
test('tiers: Hot >= 70, Warm 45-69, Cold below', () => {
  assert.equal(L.tierFor(70), 'hot');
  assert.equal(L.tierFor(69), 'warm');
  assert.equal(L.tierFor(45), 'warm');
  assert.equal(L.tierFor(44), 'cold');
});
test('seniority, function, industry and evidence all move the score', () => {
  const s = (o) => L.scoreContact(L.newContact(o)).score;
  const base = { company: 'Acme', industry: 'Fintech' };
  assert.ok(s({ ...base, title: 'VP Talent Acquisition' }) > s({ ...base, title: 'Director Talent Acquisition' }));
  assert.ok(s({ ...base, title: 'Director Talent Acquisition' }) > s({ ...base, title: 'Senior Manager Talent Acquisition' }));
  assert.ok(s({ ...base, title: 'Senior Manager Talent Acquisition' }) > s({ ...base, title: 'Manager Talent Acquisition' }));
  assert.ok(s({ ...base, title: 'Head of Talent Acquisition' }) > s({ ...base, title: 'Head of Engineering' }));
  assert.ok(s({ ...base, title: 'Head of Engineering' }) > s({ ...base, title: 'Head of Sales' }));
  assert.ok(s({ title: 'Head of HR', industry: 'Banking' }) > s({ title: 'Head of HR', industry: 'Software' }));
  assert.ok(s({ title: 'Head of HR', industry: 'Software' }) > s({ title: 'Head of HR', industry: 'Retail' }));
  assert.ok(s({ ...base, title: 'Head of HR', notes: 'Met at an event in Pune last month, friendly.' }) > s({ ...base, title: 'Head of HR' }));
  assert.ok(s({ ...base, title: 'Head of HR', notes: 'They are hiring 30 engineers after new funding.' }) > s({ ...base, title: 'Head of HR', notes: 'Met at an event in Pune last month, friendly.' }));
});
test('score stays within 0-100 and explains itself', () => {
  const top = L.scoreContact(L.newContact({ title: 'Chief Human Resources Officer', industry: 'Fintech', notes: 'Hiring 40 engineers this quarter after Series B funding.' }));
  assert.equal(top.score, 100);
  assert.equal(top.tier, 'hot');
  assert.ok(top.reasons.length >= 4);
  assert.equal(top.reasons.reduce((n, r) => n + r.points, 0), 100);
  const low = L.scoreContact(L.newContact({}));
  assert.ok(low.score >= 0 && low.score < 45);
  assert.equal(low.tier, 'cold');
});

console.log('\nOutlook link');
test('work Outlook deeplink carries to, cc, subject and body', () => {
  const link = L.outlookLink('outlook_work', { to: 'a@b.example.com', cc: 'boss@x.example.com', subject: 'Hi & hello', body: 'Line 1\nLine 2 100%' });
  const u = new URL(link);
  assert.equal(u.origin + u.pathname, 'https://outlook.office.com/mail/deeplink/compose');
  assert.equal(u.searchParams.get('to'), 'a@b.example.com');
  assert.equal(u.searchParams.get('cc'), 'boss@x.example.com');
  assert.equal(u.searchParams.get('subject'), 'Hi & hello');
  assert.equal(u.searchParams.get('body'), 'Line 1\nLine 2 100%');
  assert.ok(!link.includes('+'), 'spaces must be %20, not +');
});
test('no CC parameter when CC is empty; Outlook.com and mailto variants', () => {
  assert.ok(!L.outlookLink('outlook_work', { to: 'a@b.example.com', cc: '', subject: 's', body: 'b' }).includes('cc='));
  assert.ok(L.outlookLink('outlook_com', { to: 'a@b.example.com', subject: 's', body: 'b' }).startsWith('https://outlook.live.com/mail/0/deeplink/compose?'));
  const m = L.outlookLink('mailto', { to: 'a@b.example.com', cc: 'c@d.example.com', subject: 'Hi there', body: 'x\ny' });
  assert.ok(m.startsWith('mailto:a%40b.example.com?cc=c%40d.example.com&subject=Hi%20there&body=x%0D%0Ay'));
});

console.log('\nDashboard stats');
test('stats are computed from activities, with angle attribution', () => {
  const c1 = { id: 1, ...L.newContact({ firstName: 'A', email: 'a@x.example.com', industry: 'Fintech', campaign: 'C1' }, THU) };
  const c2 = { id: 2, ...L.newContact({ firstName: 'B', email: 'b@x.example.com', industry: 'Fintech', campaign: 'C1' }, THU) };
  const c3 = { id: 3, ...L.newContact({ firstName: 'C', email: 'c@x.example.com', industry: 'Technology', campaign: 'C2' }, THU) };
  let contacts = [c1, c2, c3];
  const acts = [];
  const commit = (r) => { assert.equal(r.ok, true); contacts = contacts.map((c) => (c.id === r.contact.id ? r.contact : c)); acts.push(...r.activities); };
  const get = (id) => contacts.find((c) => c.id === id);
  for (const c of contacts) acts.push(...L.addedActivities(c, new Date(2026, 10, 2, 9)));

  const D = (d, h = 10) => new Date(2026, 10, d, h);
  commit(L.applySent(get(1), draft({ kind: 'first', angle: 'Angle A' }), settings, D(2), 0));
  commit(L.applySent(get(2), draft({ kind: 'first', angle: 'Angle A' }), settings, D(2), 1));
  commit(L.applySent(get(3), draft({ kind: 'first', angle: 'Angle B' }), settings, D(2), 2));
  commit(L.applySent(get(1), draft({ subject: '', angle: 'Cost of open roles' }), settings, D(5), 0)); // follow-up 1
  commit(L.applyReply(get(1), 'positive', D(6)));     // credited to the follow-up, not the first email
  commit(L.applyMeeting(get(1), D(9)));
  commit(L.applyReply(get(3), 'negative', D(4)));     // credited to Angle B
  commit(L.applyBounce(get(2), D(3)));
  commit(L.applyLinkedInRequest(get(2), 'hi', D(3)));

  const stats = L.computeStats(contacts, acts, { days: 0 }, THU);
  const t = stats.tiles;
  assert.equal(t.firstEmails, 3);
  assert.equal(t.followUps, 1);
  assert.equal(t.replies, 2);
  assert.equal(t.replyRate, 66.7);
  assert.equal(t.interested, 1);
  assert.equal(t.meetings, 1);
  assert.equal(t.meetingRate, 33.3);
  assert.equal(t.activeOpportunities, 1);
  assert.equal(t.bounces, 1);
  assert.equal(t.optouts, 0);
  assert.equal(t.linkedinRequests, 1);
  assert.equal(t.added, 3);
  assert.equal(t.researched, 0);
  assert.equal(t.followUpsDue, 0);
  assert.deepEqual(stats.funnel.map((f) => f.value), [3, 3, 2, 1, 1]);

  const angle = Object.fromEntries(stats.angles.map((a) => [a.angle, a]));
  assert.equal(angle['Cost of open roles'].replies, 1);
  assert.equal(angle['Cost of open roles'].sent, 1);
  assert.equal(angle['Cost of open roles'].interested, 1);
  assert.equal(angle['Angle A'].sent, 2);
  assert.equal(angle['Angle A'].replies, 0);
  assert.equal(angle['Angle B'].replies, 1);
  assert.equal(angle['Angle B'].replyRate, 100);

  const fin = stats.byIndustry.find((r) => r.industry === 'Fintech');
  assert.deepEqual([fin.emailed, fin.replies, fin.meetings, fin.replyRate], [2, 1, 1, 50]);

  // Emails per day: 3 on the 2nd, 1 on the 5th.
  const perDay = Object.fromEntries(stats.perDay.map((d) => [d.date, d.count]));
  assert.equal(perDay['2026-11-02'], 3);
  assert.equal(perDay['2026-11-05'], 1);
  assert.equal(stats.perDay.length, 30);

  // Filters: campaign and industry narrow everything; date range drops older activity.
  assert.equal(L.computeStats(contacts, acts, { campaign: 'C2' }, THU).tiles.firstEmails, 1);
  assert.equal(L.computeStats(contacts, acts, { industry: 'Fintech' }, THU).tiles.replies, 1);
  const week = L.computeStats(contacts, acts, { days: 7 }, THU); // 6-12 Nov
  assert.equal(week.tiles.firstEmails, 0);
  assert.equal(week.tiles.replies, 1);
  assert.equal(week.tiles.meetings, 1);
  assert.equal(week.perDay.length, 7);
  // The reply inside the range is still credited to the email sent before the range.
  assert.equal(week.angles.find((a) => a.angle === 'Cost of open roles').replies, 1);
});
test('follow-ups due today tile', () => {
  const due = mk({ _state: { status: 'in_sequence', step: 1, nextFollowUpAt: '2026-11-12' } });
  assert.equal(L.computeStats([due], [], {}, THU).tiles.followUpsDue, 1);
});

console.log('\nExport');
test('CSV export quotes commas, quotes and line breaks', () => {
  const csv = L.contactsToCsv([{ ...L.newContact({ firstName: 'A', company: 'Acme, Inc', notes: 'said "hi"\nthen left', email: 'a@x.example.com' }) }]);
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('First Name,Last Name,Title,Company,Email,Person Linkedin Url'));
  assert.ok(csv.includes('"Acme, Inc"'));
  assert.ok(csv.includes('"said ""hi""\nthen left"'));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failed:\n - ' + failures.join('\n - ')); process.exit(1); }
