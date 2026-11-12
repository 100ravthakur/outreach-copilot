import { useEffect, useRef, useState } from 'react';
import * as L from '../lib/logic.js';
import * as db from '../lib/db.js';
import * as actions from '../actions.js';
import { ScorePill, ConfirmButton, useFlash, fmtDate, fmtDateTime } from './ui.jsx';

export function ContactHeader({ contact, contacts, extra }) {
  const score = contact._score || L.scoreContact(contact);
  const talking = L.companyConversations(contact, contacts);
  return (
    <header className="card-head">
      <div className="card-title">
        <h3>{L.fullName(contact)}</h3>
        <ScorePill score={score} />
        {extra}
      </div>
      <p className="muted">{[contact.title, contact.company, contact.industry].filter(Boolean).join(' · ') || 'No title or company'}</p>
      {contact.notes
        ? <p className="notes"><strong>Research notes:</strong> {contact.notes}</p>
        : <p className="notes muted">No research notes yet. Add some in Contacts to get a more specific email.</p>}
      {talking.length > 0 && (
        <p className="notice warn">
          Heads up: {talking.map((o) => L.fullName(o)).join(', ')} at the same company {talking.length === 1 ? 'is' : 'are'} already in conversation with you.
        </p>
      )}
    </header>
  );
}

/** kind: 'first' | 'followup' | 'reply' */
export default function EmailCard({ contact, kind, store }) {
  const { settings, contacts, activities, drafts, reload } = store;
  const key = db.draftKey(contact.id);
  const stored = drafts.get(key);
  const draft = stored && stored.kind === kind ? stored : null;
  const fromDraft = () => ({
    subject: draft?.subject ?? (kind === 'first' ? '' : L.followUpSubject(contact.firstSubject)),
    body: draft?.body ?? '',
    cc: draft?.cc ?? L.defaultCc(kind, settings),
    angle: draft?.angle ?? '',
    lowEvidence: !!draft?.lowEvidence,
  });
  const [form, setForm] = useState(fromDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askReply, setAskReply] = useState(false);
  const [flash, setFlash] = useFlash();
  const ownSave = useRef(0);

  // Pick up drafts written elsewhere (Draft all), but not our own saves.
  useEffect(() => {
    if (draft?.updatedAt && draft.updatedAt !== ownSave.current) setForm(fromDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.updatedAt]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    const worthSaving = draft || form.body.trim() || form.cc !== L.defaultCc(kind, settings);
    if (!worthSaving) return;
    const ts = Date.now();
    ownSave.current = ts;
    await db.putDraft({ ...(draft || {}), key, contactId: contact.id, kind, ...form, updatedAt: ts });
    reload();
  };

  const act = async (fn, okMsg) => {
    setError('');
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.ok === false) setError(r.reason);
      else if (okMsg) setFlash(okMsg);
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const write = () => act(() => actions.draftEmail(contact, kind, { settings, activities, existing: { kind, cc: form.cc } }));
  const sent = () => act(async () => {
    const payload = { kind, subject: form.subject, body: form.body, angle: form.angle, cc: form.cc };
    if (kind === 'reply') {
      const r = await actions.markReplySent(contact.id, payload);
      if (r.ok) await actions.skipToday(contact.id);
      return r;
    }
    return actions.markSent(contact.id, payload);
  });

  const ready = form.subject.trim() && form.body.trim();
  const link = L.outlookLink(settings.mailClient, { to: contact.email, cc: form.cc, subject: form.subject, body: form.body });
  const thread = kind === 'first' ? [] : actions.threadOf(contact.id, activities);
  const words = L.wordCount(form.body);
  const id = `c${contact.id}`;
  const mailName = settings.mailClient === 'mailto' ? 'mail app' : 'Outlook';

  const extra = kind === 'followup'
    ? <span className="pill">Follow-up {contact.step} · due {fmtDate(contact.nextFollowUpAt)}</span>
    : kind === 'reply'
      ? <span className={`pill ${contact.replySentiment === 'positive' ? 'good' : ''}`}>{L.SENTIMENT_LABELS[contact.replySentiment] || 'Replied'}</span>
      : null;

  return (
    <article className="card" aria-label={`Email to ${L.fullName(contact)}`}>
      <ContactHeader contact={contact} contacts={contacts} extra={extra} />

      <div className="mail">
        <div className="mail-row"><span className="mail-label">To</span><span className="mail-to">{contact.email}</span></div>
        <div className="mail-row">
          <label className="mail-label" htmlFor={`${id}-cc`}>CC</label>
          <input id={`${id}-cc`} type="text" value={form.cc} placeholder={kind === 'first' ? 'No CC' : 'No CC on follow-ups (add one if you need it)'}
            onChange={(e) => set({ cc: e.target.value })} onBlur={save} />
        </div>
        <div className="mail-row">
          <label className="mail-label" htmlFor={`${id}-subject`}>Subject</label>
          <input id={`${id}-subject`} type="text" value={form.subject} onChange={(e) => set({ subject: e.target.value })} onBlur={save} />
        </div>
        <label className="sr-only" htmlFor={`${id}-body`}>Body</label>
        <textarea id={`${id}-body`} rows={form.body ? 12 : 4} value={form.body}
          placeholder={'Press "Write with AI" for a draft, or type your own email here.'}
          onChange={(e) => set({ body: e.target.value })} onBlur={save} />
        <div className="mail-meta">
          {form.angle && <span className="pill">Angle: {form.angle}</span>}
          <span className="muted">{words} words (with signature)</span>
        </div>
        {form.lowEvidence && form.body && (
          <p className="notice warn">Low evidence: this is a role-based angle, not based on research. Read it before sending, or add research notes and rewrite.</p>
        )}
      </div>

      {thread.length > 0 && (
        <details className="thread">
          <summary>Earlier emails in this thread ({thread.length})</summary>
          {thread.map((t) => (
            <div key={t.id} className="thread-item">
              <p className="muted">{fmtDateTime(t.at)} · {t.kind === 'first' ? 'First email' : t.kind === 'reply' ? 'Your reply' : `Follow-up ${t.step - 1}`}{t.angle ? ` · ${t.angle}` : ''}</p>
              <p><strong>{t.subject}</strong></p>
              <pre>{t.body}</pre>
            </div>
          ))}
        </details>
      )}

      {error && <p className="notice bad" role="alert">{error}</p>}
      {flash && <p className="notice good" role="status">{flash}</p>}

      <div className="actions">
        <button type="button" className="btn" onClick={write} disabled={busy}>{busy ? 'Working…' : form.body ? 'Rewrite' : 'Write with AI'}</button>
        {ready
          ? <a className="btn primary" href={link} target={settings.mailClient === 'mailto' ? undefined : '_blank'} rel="noopener noreferrer">Open in {mailName}</a>
          : <button type="button" className="btn primary" disabled>Open in {mailName}</button>}
        <button type="button" className="btn" disabled={!form.body} onClick={async () => setFlash((await actions.copyText(form.body)) ? 'Body copied.' : 'Could not copy. Select the text and copy it yourself.')}>Copy body</button>
        <button type="button" className="btn good" disabled={busy || !ready} onClick={sent} title={ready ? '' : 'Write the email first'}>{kind === 'reply' ? 'I replied' : 'I sent it'}</button>
        {kind === 'reply' ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => act(() => actions.logMeeting(contact.id))}>Meeting booked</button>
            <button type="button" className="btn" disabled={busy} onClick={() => act(() => actions.logReply(contact.id, 'negative'))}>Not interested</button>
          </>
        ) : (
          <button type="button" className="btn" disabled={busy} aria-expanded={askReply} onClick={() => setAskReply((v) => !v)}>They replied</button>
        )}
        <button type="button" className="btn quiet" disabled={busy} onClick={() => act(() => actions.skipToday(contact.id))}>Skip today</button>
        {kind !== 'reply' && (
          <ConfirmButton label="Never email" className="btn quiet danger" question={`Never email ${contact.firstName || 'this contact'} again?`} confirmLabel="Yes, never email"
            onConfirm={() => act(() => actions.neverEmail(contact.id))} />
        )}
      </div>

      {askReply && (
        <div className="actions sub" role="group" aria-label="How did they reply?">
          <span className="muted">How did they reply?</span>
          {['positive', 'neutral', 'negative'].map((s) => (
            <button key={s} type="button" className="btn" disabled={busy} onClick={() => act(() => actions.logReply(contact.id, s))}>{L.SENTIMENT_LABELS[s]}</button>
          ))}
        </div>
      )}
    </article>
  );
}
