// Storage. The only file that touches IndexedDB (via Dexie).
// Everything stays in this browser on this PC.

import Dexie from 'dexie';
import { DEFAULT_SETTINGS, addedActivities } from './logic.js';

export const db = new Dexie('outreach-copilot');
db.version(1).stores({
  contacts: '++id, email, status, campaign',
  activities: '++id, contactId, type, at',
  drafts: 'key',
  settings: 'key',
});

export async function loadAll() {
  const [settingsRow, contacts, activities, draftRows] = await Promise.all([
    db.settings.get('main'), db.contacts.toArray(), db.activities.toArray(), db.drafts.toArray(),
  ]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(settingsRow || {}) },
    contacts,
    activities,
    drafts: new Map(draftRows.map((d) => [d.key, d])),
  };
}

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await db.settings.get('main')) || {}) };
}
export function saveSettings(settings) {
  return db.settings.put({ ...settings, key: 'main' });
}

export const getContact = (id) => db.contacts.get(id);
export const allContacts = () => db.contacts.toArray();
export const allActivities = () => db.activities.toArray();

/** Add new contacts and log their "added" (and "researched") activities. */
export function addContacts(list, now = new Date()) {
  return db.transaction('rw', db.contacts, db.activities, async () => {
    const ids = await db.contacts.bulkAdd(list, { allKeys: true });
    const acts = list.flatMap((c, i) => addedActivities({ ...c, id: ids[i] }, now));
    await db.activities.bulkAdd(acts);
    return ids;
  });
}

/** Save the result of a logic.js apply* function: updated contact + new activities. */
export function commit(contact, activities = []) {
  return db.transaction('rw', db.contacts, db.activities, async () => {
    await db.contacts.put(contact);
    if (activities.length) await db.activities.bulkAdd(activities);
  });
}

export function deleteContacts(ids) {
  return db.transaction('rw', db.contacts, db.activities, db.drafts, async () => {
    await db.contacts.bulkDelete(ids);
    await db.activities.where('contactId').anyOf(ids).delete();
    await db.drafts.bulkDelete(ids.flatMap((id) => [`${id}:email`, `${id}:li`]));
  });
}

export const draftKey = (contactId, type = 'email') => `${contactId}:${type}`;
export const putDraft = (draft) => db.drafts.put({ ...draft, updatedAt: draft.updatedAt || Date.now() });
export const deleteDraft = (key) => db.drafts.delete(key);

/** Backup as a plain object. The AI key is left out on purpose. */
export async function exportBackup() {
  const { settings, contacts, activities, drafts } = await loadAll();
  return {
    app: 'outreach-copilot', version: 1, exportedAt: new Date().toISOString(),
    settings: { ...settings, aiKey: '' }, contacts, activities, drafts: [...drafts.values()],
  };
}

/** Replace everything with the backup. Throws if the file is not one of ours. */
export async function restoreBackup(data) {
  if (!data || data.app !== 'outreach-copilot' || !Array.isArray(data.contacts) || !Array.isArray(data.activities)) {
    throw new Error('That file is not an Outreach Copilot backup.');
  }
  const current = await getSettings();
  await db.transaction('rw', db.contacts, db.activities, db.drafts, db.settings, async () => {
    await Promise.all([db.contacts.clear(), db.activities.clear(), db.drafts.clear()]);
    await db.contacts.bulkPut(data.contacts);
    await db.activities.bulkPut(data.activities);
    if (Array.isArray(data.drafts)) await db.drafts.bulkPut(data.drafts);
    await db.settings.put({ ...DEFAULT_SETTINGS, ...(data.settings || {}), aiKey: current.aiKey, key: 'main' });
  });
  return { contacts: data.contacts.length, activities: data.activities.length };
}

export function deleteAll() {
  return db.transaction('rw', db.contacts, db.activities, db.drafts, db.settings, async () => {
    await Promise.all([db.contacts.clear(), db.activities.clear(), db.drafts.clear(), db.settings.clear()]);
  });
}
