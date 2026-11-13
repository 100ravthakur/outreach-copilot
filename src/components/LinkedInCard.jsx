import { useEffect, useRef, useState } from 'react';
import * as L from '../lib/logic.js';
import * as db from '../lib/db.js';
import * as actions from '../actions.js';
import { ContactHeader } from './EmailCard.jsx';
import { useFlash } from './ui.jsx';

const MAX = 300;

function reasonFor(c) {
  if (!L.isValidEmail(c.email)) return 'No email address';
  if (c.status === 'bounced') return 'Email bounced';
  return `${c.step} emails, no answer`;
}

export default function LinkedInCard({ contact, store }) {
  const { settings, contacts, drafts, reload } = store;
  const key = db.draftKey(contact.id, 'li');
  const draft = drafts.get(key);
  const [note, setNote] = useState(draft?.note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useFlash();
  const ownSave = useRef(0);

  useEffect(() => {
    if (draft?.updatedAt && draft.updatedAt !== ownSave.current) setNote(draft.note || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.updatedAt]);

  const save = async () => {
    if (!draft && !note.trim()) return;
    const ts = Date.now();
    ownSave.current = ts;
    await db.putDraft({ key, contactId: contact.id, kind: 'linkedin', note, updatedAt: ts });
    reload();
  };

  const act = async (fn) => {
    setError('');
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.ok === false) setError(r.reason);
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const id = `li${contact.id}`;
  return (
    <article className="card" data-kind="linkedin" aria-label={`LinkedIn note for ${L.fullName(contact)}`}>
      <ContactHeader contact={contact} contacts={contacts} extra={<span className="pill">{reasonFor(contact)}</span>} />
      <label className="field-label" htmlFor={id}>Connection note</label>
      <textarea id={id} rows={4} maxLength={MAX} value={note} placeholder={'Press "Write note" for a draft, or type your own.'}
        onChange={(e) => setNote(e.target.value.slice(0, MAX))} onBlur={save} />
      <p className={`muted counter${note.length >= MAX ? ' over' : ''}`}>{note.length} / {MAX} characters</p>
      {error && <p className="notice bad" role="alert">{error}</p>}
      {flash && <p className="notice good" role="status">{flash}</p>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => act(() => actions.draftLinkedInNote(contact, { settings }))}>{busy ? 'Working…' : note ? 'Rewrite note' : 'Write note'}</button>
        <button type="button" className="btn" disabled={!note} onClick={async () => setFlash((await actions.copyText(note)) ? 'Note copied.' : 'Could not copy.')}>Copy</button>
        <a className="btn primary" href={contact.linkedin} target="_blank" rel="noopener noreferrer">Open profile</a>
        <button type="button" className="btn good" disabled={busy} onClick={() => act(() => actions.linkedInRequested(contact.id, note))}>Request sent</button>
        <button type="button" className="btn quiet" disabled={busy} onClick={() => act(() => actions.skipToday(contact.id))}>Skip</button>
      </div>
    </article>
  );
}
