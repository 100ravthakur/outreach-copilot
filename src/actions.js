// Glue between the rules (logic.js), storage (db.js) and AI (ai.js).
// Every action re-reads the contact from storage first, so a stale screen can't break a rule.

import * as L from './lib/logic.js';
import * as db from './lib/db.js';
import * as ai from './lib/ai.js';

async function run(contactId, fn) {
  const contact = await db.getContact(contactId);
  if (!contact) return { ok: false, reason: 'That contact no longer exists.' };
  const r = fn(contact);
  if (r.ok) await db.commit(r.contact, r.activities);
  return r;
}

export async function markSent(contactId, draft) {
  const [settings, activities] = await Promise.all([db.getSettings(), db.allActivities()]);
  const now = new Date();
  const r = await run(contactId, (c) => L.applySent(c, draft, settings, now, L.sendsToday(activities, now)));
  if (r.ok) await db.deleteDraft(db.draftKey(contactId));
  return r;
}

export async function markReplySent(contactId, draft) {
  const r = await run(contactId, (c) => L.applyReplySent(c, draft));
  if (r.ok) await db.deleteDraft(db.draftKey(contactId));
  return r;
}

export const logReply = (id, sentiment) => run(id, (c) => L.applyReply(c, sentiment));
export const logMeeting = (id) => run(id, (c) => L.applyMeeting(c));
export const logBounce = (id) => run(id, (c) => L.applyBounce(c));
export const logOptOut = (id) => run(id, (c) => L.applyOptOut(c));
export const neverEmail = (id) => run(id, (c) => L.applySuppress(c));
export const skipToday = (id) => run(id, (c) => L.applySkip(c));
export const reopen = (id) => run(id, (c) => L.applyReopen(c));
export const editContact = (id, patch) => run(id, (c) => L.applyEdit(c, patch));
export const setLinkedInStatus = (id, status) => run(id, (c) => L.applyLinkedInStatus(c, status));

export async function linkedInRequested(contactId, note) {
  const r = await run(contactId, (c) => L.applyLinkedInRequest(c, note));
  if (r.ok) await db.deleteDraft(db.draftKey(contactId, 'li'));
  return r;
}

/** One outcome name -> the right rule. Used by the reply box and the contact drawer. */
export function logOutcome(contactId, outcome) {
  switch (outcome) {
    case 'positive': case 'neutral': case 'negative': return logReply(contactId, outcome);
    case 'meeting': return logMeeting(contactId);
    case 'bounced': return logBounce(contactId);
    case 'optout': return logOptOut(contactId);
    case 'suppressed': return neverEmail(contactId);
    default: return Promise.resolve({ ok: false, reason: 'Unknown outcome.' });
  }
}

export function threadOf(contactId, activities) {
  return activities
    .filter((a) => a.contactId === contactId && a.type === 'email_sent')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Generate an email draft for review and save it. Never sends anything. */
export async function draftEmail(contact, kind, { settings, activities, existing }) {
  const d = await ai.generateDraft({ contact, kind, step: contact.step || 1, thread: threadOf(contact.id, activities), settings });
  const draft = {
    key: db.draftKey(contact.id), contactId: contact.id, kind,
    subject: d.subject, body: d.body, angle: d.angle, evidenceUsed: d.evidenceUsed, lowEvidence: d.lowEvidence,
    // Keep a CC the user already edited; otherwise manager on first-touch only.
    cc: existing && existing.kind === kind && existing.cc !== undefined ? existing.cc : L.defaultCc(kind, settings),
  };
  await db.putDraft(draft);
  return draft;
}

export async function draftLinkedInNote(contact, { settings }) {
  const note = await ai.generateLinkedInNote({ contact, settings });
  const draft = { key: db.draftKey(contact.id, 'li'), contactId: contact.id, kind: 'linkedin', note };
  await db.putDraft(draft);
  return draft;
}

export async function addOne(fields, existingContacts) {
  const c = L.newContact(fields);
  if (!c.firstName && !c.lastName) return { ok: false, reason: 'Add a name.' };
  if (c.email && !L.isValidEmail(c.email)) return { ok: false, reason: 'That email address does not look right.' };
  if (!c.email && !L.linkedinSlug(c.linkedin)) return { ok: false, reason: 'Add an email address or a LinkedIn profile URL.' };
  const dup = L.findDuplicate(c, existingContacts);
  if (dup) return { ok: false, reason: `Already in your contacts: ${L.fullName(dup)}${dup.company ? ' at ' + dup.company : ''}.` };
  await db.addContacts([c]);
  return { ok: true };
}

export async function importFile(rows, mapping, campaign) {
  const existing = await db.allContacts();
  const { toAdd, report } = L.importRows(rows, mapping, existing, campaign);
  if (toAdd.length) await db.addContacts(toAdd);
  return report;
}

export function loadExamples() {
  const mapping = Object.fromEntries(L.IMPORT_FIELDS.map(([f]) => [f, f === 'fullName' ? '' : f]));
  return importFile(L.EXAMPLE_CONTACTS.map((c) => ({ ...c })), mapping, L.EXAMPLE_CAMPAIGN);
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { done = false; }
    ta.remove();
    return done;
  }
}
