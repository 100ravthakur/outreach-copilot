import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from '../lib/logic.js';
import * as db from '../lib/db.js';
import * as ai from '../lib/ai.js';
import * as actions from '../actions.js';
import EmailCard from '../components/EmailCard.jsx';
import LinkedInCard from '../components/LinkedInCard.jsx';
import { OUTCOMES, StatusPill, useFlash } from '../components/ui.jsx';

const TABS = [
  ['first', 'First emails', 'first'],
  ['followups', 'Follow-ups due', 'followup'],
  ['linkedin', 'LinkedIn', 'linkedin'],
  ['replies', 'Replies', 'reply'],
];

function ReplyLogger({ store }) {
  const { contacts, reload } = store;
  const [q, setQ] = useState('');
  const [flash, setFlash] = useFlash(4000);
  const [error, setError] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return contacts
      .filter((c) => `${L.fullName(c)} ${c.company} ${c.email}`.toLowerCase().includes(s))
      .slice(0, 6);
  }, [q, contacts]);

  const log = async (c, outcome, label) => {
    setError('');
    const r = await actions.logOutcome(c.id, outcome);
    if (r.ok) { setFlash(`Logged for ${L.fullName(c)}: ${label}. Follow-ups stopped.`); setQ(''); }
    else setError(r.reason);
    reload();
  };

  return (
    <section className="card logger" aria-label="Log a reply or bounce">
      <label className="field-label" htmlFor="reply-search">Got a reply or bounce in Outlook?</label>
      <input id="reply-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name, company or email to find the contact" autoComplete="off" />
      {flash && <p className="notice good" role="status">{flash}</p>}
      {error && <p className="notice bad" role="alert">{error}</p>}
      {q.trim().length >= 2 && matches.length === 0 && <p className="muted">No contact matches "{q}".</p>}
      {matches.length > 0 && (
        <ul className="logger-list">
          {matches.map((c) => (
            <li key={c.id}>
              <div className="logger-who">
                <strong>{L.fullName(c)}</strong> <StatusPill status={c.status} />
                <div className="muted">{[c.company, c.email].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="actions tight" role="group" aria-label={`Outcome for ${L.fullName(c)}`}>
                {OUTCOMES.map(([key, label]) => (
                  <button key={key} type="button" className="btn small" onClick={() => log(c, key, label)}>{label}</button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Today({ store }) {
  const { settings, contacts, activities, drafts, queues, reload } = store;
  const [tab, setTab] = useState('first');
  const [batch, setBatch] = useState(null);
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);

  const lists = { first: queues.first, followups: queues.followups, linkedin: queues.linkedin, replies: queues.replies };
  const items = lists[tab];
  const kind = TABS.find(([k]) => k === tab)[2];
  const hasDraft = (c) => {
    if (kind === 'linkedin') return !!drafts.get(db.draftKey(c.id, 'li'))?.note;
    const d = drafts.get(db.draftKey(c.id));
    return !!(d && d.kind === kind && d.body);
  };
  const todo = items.filter((c) => !hasDraft(c));
  const pace = ai.paceMs(settings);

  const draftAll = async () => {
    stop.current = false;
    const list = todo;
    setBatch({ running: true, done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      if (stop.current) break;
      const c = list[i];
      try {
        if (kind === 'linkedin') await actions.draftLinkedInNote(c, { settings });
        else await actions.draftEmail(c, kind, { settings, activities, existing: drafts.get(db.draftKey(c.id)) });
      } catch (e) {
        setBatch((b) => ({ ...b, running: false, error: e?.message || 'Drafting failed.' }));
        await reload();
        return;
      }
      setBatch((b) => ({ ...b, done: i + 1 }));
      await reload();
      // Pace the calls so free tiers don't rate-limit; stay responsive to Stop.
      for (let waited = 0; pace && i < list.length - 1 && waited < pace && !stop.current; waited += 200) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    setBatch((b) => ({ ...b, running: false, stopped: stop.current }));
  };

  const capLeft = queues.remaining;
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>Today</h1>
          <p className="muted">{dateLabel} · {queues.sentToday} of {queues.cap} emails sent today</p>
        </div>
      </header>

      <ReplyLogger store={store} />

      <div className="tabs" role="tablist" aria-label="Today's work">
        {TABS.map(([key, label, tabKind]) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} data-kind={tabKind} aria-selected={tab === key} className={tab === key ? 'tab active' : 'tab'}
            disabled={batch?.running} onClick={() => { setTab(key); setBatch(null); }}>
            {label} <span className="count">{lists[key].length}</span>
          </button>
        ))}
      </div>

      <section role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {items.length > 0 && (
          <div className="toolbar">
            {batch?.running ? (
              <>
                <progress value={batch.done} max={batch.total} aria-label="Drafting progress" />
                <span>Drafting {Math.min(batch.done + 1, batch.total)} of {batch.total}…</span>
                <button type="button" className="btn" onClick={() => { stop.current = true; }}>Stop</button>
              </>
            ) : (
              <>
                <button type="button" className="btn primary" onClick={draftAll} disabled={todo.length === 0}>
                  {todo.length ? `Draft all (${todo.length})` : 'All drafted'}
                </button>
                <span className="muted">
                  {batch?.error ? '' : batch?.stopped ? `Stopped after ${batch.done} of ${batch.total}.` : batch ? `Drafted ${batch.done}. Review each one before sending.` : (
                    pace ? `Using ${ai.PROVIDERS[ai.providerOf(settings)].label}; waits ${Math.round(pace / 100) / 10}s between drafts to stay inside the free limit.` : 'Drafts are for review. Nothing is sent automatically.'
                  )}
                </span>
              </>
            )}
          </div>
        )}
        {batch?.error && <p className="notice bad" role="alert">{batch.error} Drafted {batch.done} of {batch.total} before stopping.</p>}

        {tab === 'first' && capLeft === 0 && (
          <p className="notice warn">Daily cap of {queues.cap} reached. {queues.firstEligible} more first emails are waiting for tomorrow.</p>
        )}
        {tab === 'first' && capLeft > 0 && queues.firstEligible > items.length && (
          <p className="muted">Showing the best {items.length} of {queues.firstEligible} (daily cap {queues.cap}, {queues.sentToday} sent today).</p>
        )}
        {tab === 'followups' && capLeft === 0 && items.length > 0 && (
          <p className="notice warn">Daily cap of {queues.cap} reached. These follow-ups can go tomorrow.</p>
        )}

        {items.length === 0 && (
          <div className="empty">
            {tab === 'first' && (contacts.length === 0
              ? <p>No contacts yet. <a href="#import">Import a list or load the example contacts</a> to get started.</p>
              : capLeft === 0 ? <p>You are done with first emails for today.</p> : <p>No new contacts with an email address are waiting. <a href="#import">Import more</a>.</p>)}
            {tab === 'followups' && <p>No follow-ups are due today.</p>}
            {tab === 'linkedin' && <p>Nobody needs a LinkedIn request right now. Contacts land here when they have no email, a bounced email, or two unanswered emails.</p>}
            {tab === 'replies' && <p>No open replies. Log one with the search box above when someone answers.</p>}
          </div>
        )}

        <div className="cards">
          {items.map((c) => (kind === 'linkedin'
            ? <LinkedInCard key={c.id} contact={c} store={store} />
            : <EmailCard key={`${c.id}-${kind}`} contact={c} kind={kind} store={store} />))}
        </div>
      </section>
    </div>
  );
}
