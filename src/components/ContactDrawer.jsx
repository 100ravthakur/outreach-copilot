import { useEffect, useState } from 'react';
import * as L from '../lib/logic.js';
import * as db from '../lib/db.js';
import * as actions from '../actions.js';
import { ScorePill, StatusPill, ConfirmButton, Field, fmtDate, fmtDateTime } from './ui.jsx';

const EDITABLE = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['title', 'Job title'], ['company', 'Company'],
  ['email', 'Email'], ['linkedin', 'LinkedIn URL'], ['industry', 'Industry'], ['city', 'City'], ['campaign', 'Campaign'],
];

function describe(a) {
  switch (a.type) {
    case 'added': return 'Added to contacts';
    case 'researched': return 'Research notes added';
    case 'email_sent':
      return `${a.kind === 'first' ? 'First email sent' : a.kind === 'reply' ? 'You replied' : `Follow-up ${a.step - 1} sent`}: "${a.subject}"${a.cc ? ` (CC ${a.cc})` : ''}${a.angle ? ` · ${a.angle}` : ''}`;
    case 'reply': return `They replied: ${L.SENTIMENT_LABELS[a.sentiment] || a.sentiment}`;
    case 'meeting': return 'Meeting booked';
    case 'bounce': return 'Email bounced';
    case 'optout': return 'Unsubscribed';
    case 'suppressed': return 'Marked never email';
    case 'linkedin_request': return 'LinkedIn request sent';
    case 'linkedin_connected': return 'Connected on LinkedIn';
    case 'reopened': return 'Put back in the queue';
    default: return a.type;
  }
}

export default function ContactDrawer({ contact, store, onClose }) {
  const { activities, reload } = store;
  const [form, setForm] = useState(contact);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(contact); setError(''); }, [contact.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const score = L.scoreContact(form);
  const timeline = activities.filter((a) => a.contactId === contact.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const dirty = [...EDITABLE.map(([k]) => k), 'notes'].some((k) => (form[k] || '') !== (contact[k] || ''));

  const saveEdits = async () => {
    setError('');
    if (form.email && !L.isValidEmail(form.email)) { setError('That email address does not look right.'); return; }
    const patch = Object.fromEntries([...EDITABLE.map(([k]) => k), 'notes'].map((k) => [k, (form[k] || '').trim()]));
    const r = await actions.editContact(contact.id, patch);
    if (!r.ok) setError(r.reason);
    else { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    reload();
  };

  const act = async (fn) => {
    setError('');
    const r = await fn();
    if (r && r.ok === false) setError(r.reason);
    await reload();
  };

  const closed = ['bounced', 'optout', 'suppressed', 'no_response'].includes(contact.status) || (contact.status === 'replied' && contact.replySentiment === 'negative');

  return (
    <div className="drawer-wrap">
      <div className="drawer-shade" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Details for ${L.fullName(contact)}`}>
        <header className="drawer-head">
          <div>
            <h2>{L.fullName(form)}</h2>
            <p className="pills"><StatusPill status={contact.status} /> <ScorePill score={score} />
              {contact.nextFollowUpAt && <span className="pill">Next follow-up {fmtDate(contact.nextFollowUpAt)}</span>}
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </header>

        <section>
          <h3>Details</h3>
          <div className="grid2">
            {EDITABLE.map(([k, label]) => (
              <Field key={k} label={label}>
                <input type="text" value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Field label="Research notes" hint="Facts you found: open roles, funding, expansion, something they posted. The AI uses only these.">
            <textarea rows={4} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <div className="actions">
            <button type="button" className="btn primary" disabled={!dirty} onClick={saveEdits}>Save changes</button>
            {saved && <span className="muted" role="status">Saved.</span>}
          </div>
          {error && <p className="notice bad" role="alert">{error}</p>}
        </section>

        <section>
          <h3>Score: {score.score} ({L.TIER_LABELS[score.tier]})</h3>
          <ul className="reasons">
            {score.reasons.map((r, i) => <li key={i}><span className="pts">+{r.points}</span> {r.text}</li>)}
          </ul>
        </section>

        <section>
          <h3>Log an outcome</h3>
          <div className="actions">
            <button type="button" className="btn" onClick={() => act(() => actions.logOutcome(contact.id, 'positive'))}>Interested</button>
            <button type="button" className="btn" onClick={() => act(() => actions.logOutcome(contact.id, 'neutral'))}>Neutral</button>
            <button type="button" className="btn" onClick={() => act(() => actions.logOutcome(contact.id, 'negative'))}>Not interested</button>
            <button type="button" className="btn good" onClick={() => act(() => actions.logOutcome(contact.id, 'meeting'))}>Meeting booked</button>
            <button type="button" className="btn" onClick={() => act(() => actions.logOutcome(contact.id, 'bounced'))}>Bounced</button>
            <button type="button" className="btn" onClick={() => act(() => actions.logOutcome(contact.id, 'optout'))}>Unsubscribe</button>
            <button type="button" className="btn" onClick={() => act(() => actions.logOutcome(contact.id, 'suppressed'))}>Never email</button>
            {closed && <button type="button" className="btn quiet" onClick={() => act(() => actions.reopen(contact.id))}>Logged by mistake? Put back in queue</button>}
          </div>
        </section>

        <section>
          <h3>LinkedIn</h3>
          <div className="actions">
            <label className="inline">Status{' '}
              <select value={contact.linkedinStatus || 'none'} onChange={(e) => act(() => actions.setLinkedInStatus(contact.id, e.target.value))}>
                <option value="none">Not contacted</option>
                <option value="requested">Request sent</option>
                <option value="connected">Connected</option>
              </select>
            </label>
            {L.linkedinSlug(contact.linkedin) && <a className="btn" href={contact.linkedin} target="_blank" rel="noopener noreferrer">Open profile</a>}
          </div>
        </section>

        <section>
          <h3>Activity</h3>
          {timeline.length === 0 ? <p className="muted">Nothing yet.</p> : (
            <ol className="timeline">
              {timeline.map((a) => (
                <li key={a.id}>
                  <span className="muted">{fmtDateTime(a.at)}</span>
                  <span>{describe(a)}</span>
                  {a.type === 'email_sent' && a.body && <details><summary>Show email</summary><pre>{a.body}</pre></details>}
                  {a.type === 'linkedin_request' && a.note && <details><summary>Show note</summary><pre>{a.note}</pre></details>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <ConfirmButton label="Delete contact" question={`Delete ${L.fullName(contact)} and their history?`} confirmLabel="Yes, delete"
            onConfirm={async () => { await db.deleteContacts([contact.id]); onClose(); reload(); }} />
        </section>
      </aside>
    </div>
  );
}
