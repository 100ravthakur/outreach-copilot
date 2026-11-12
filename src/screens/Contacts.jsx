import { useEffect, useMemo, useState } from 'react';
import * as L from '../lib/logic.js';
import * as db from '../lib/db.js';
import * as actions from '../actions.js';
import ContactDrawer from '../components/ContactDrawer.jsx';
import { ScorePill, StatusPill, ConfirmButton, fmtDate } from '../components/ui.jsx';

const PAGE = 100;
const SORTS = {
  score: ['Best score first', (a, b) => b._score.score - a._score.score],
  name: ['Name A-Z', (a, b) => L.fullName(a).localeCompare(L.fullName(b))],
  company: ['Company A-Z', (a, b) => (a.company || '').localeCompare(b.company || '')],
  newest: ['Newest first', (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))],
  followup: ['Next follow-up', (a, b) => (a.nextFollowUpAt || '9999').localeCompare(b.nextFollowUpAt || '9999')],
};
const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));

export default function Contacts({ store }) {
  const { contacts, reload } = store;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [industry, setIndustry] = useState('');
  const [campaign, setCampaign] = useState('');
  const [sort, setSort] = useState('score');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);

  const scored = useMemo(() => contacts.map((c) => ({ ...c, _score: L.scoreContact(c) })), [contacts]);
  const industries = useMemo(() => uniq(contacts.map((c) => c.industry)), [contacts]);
  const campaigns = useMemo(() => uniq(contacts.map((c) => c.campaign)), [contacts]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return scored
      .filter((c) => (!status || c.status === status) && (!tier || c._score.tier === tier) && (!industry || c.industry === industry) && (!campaign || c.campaign === campaign))
      .filter((c) => !s || `${L.fullName(c)} ${c.title} ${c.company} ${c.email} ${c.city} ${c.notes}`.toLowerCase().includes(s))
      .sort(SORTS[sort][1]);
  }, [scored, q, status, tier, industry, campaign, sort]);

  useEffect(() => { setPage(0); }, [q, status, tier, industry, campaign, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * PAGE, current * PAGE + PAGE);
  const open = openId != null ? contacts.find((c) => c.id === openId) : null;

  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((c) => selected.has(c.id));
  const togglePage = () => setSelected((prev) => {
    const n = new Set(prev);
    rows.forEach((c) => (allOnPage ? n.delete(c.id) : n.add(c.id)));
    return n;
  });
  const ids = [...selected].filter((id) => contacts.some((c) => c.id === id));

  const bulkNever = async () => { for (const id of ids) await actions.neverEmail(id); setSelected(new Set()); reload(); };
  const bulkDelete = async () => { await db.deleteContacts(ids); setSelected(new Set()); reload(); };
  const exportCsv = () => actions.download(`contacts-${L.dayKey(new Date())}.csv`, '﻿' + L.contactsToCsv(filtered), 'text/csv;charset=utf-8');

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>Contacts</h1>
          <p className="muted">{filtered.length} of {contacts.length} shown</p>
        </div>
        <button type="button" className="btn" onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</button>
      </header>

      <div className="filters">
        <input type="search" aria-label="Search contacts" placeholder="Search name, company, email, notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {L.STATUSES.map((s) => <option key={s} value={s}>{L.STATUS_LABELS[s]}</option>)}
        </select>
        <select aria-label="Score" value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="">Any score</option>
          <option value="hot">Hot (70+)</option>
          <option value="warm">Warm (45-69)</option>
          <option value="cold">Cold (under 45)</option>
        </select>
        <select aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
          <option value="">Any industry</option>
          {industries.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">Any campaign</option>
          {campaigns.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>

      {ids.length > 0 && (
        <div className="toolbar bulk" role="region" aria-label="Selected contacts">
          <strong>{ids.length} selected</strong>
          <ConfirmButton label="Never email" className="btn" question={`Mark ${ids.length} contact${ids.length === 1 ? '' : 's'} as never email?`} confirmLabel="Yes, never email" onConfirm={bulkNever} />
          <ConfirmButton label="Delete" question={`Delete ${ids.length} contact${ids.length === 1 ? '' : 's'} and their history?`} confirmLabel="Yes, delete" onConfirm={bulkDelete} />
          <button type="button" className="btn quiet" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="empty"><p>No contacts yet. <a href="#import">Import a list or load the example contacts</a>.</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty"><p>No contacts match these filters.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="table rows-click">
            <thead>
              <tr>
                <th className="check"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={togglePage} /></th>
                <th>Name</th><th>Company</th><th>Score</th><th>Status</th><th>Emails</th><th>Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={selected.has(c.id) ? 'sel' : ''} onClick={() => setOpenId(c.id)}>
                  <td className="check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${L.fullName(c)}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td>
                    <button type="button" className="linklike" onClick={(e) => { e.stopPropagation(); setOpenId(c.id); }}>{L.fullName(c)}</button>
                    <div className="muted">{c.title}</div>
                  </td>
                  <td>{c.company}<div className="muted">{c.industry}</div></td>
                  <td><ScorePill score={c._score} /></td>
                  <td><StatusPill status={c.status} />{!L.isValidEmail(c.email) && <div className="muted">LinkedIn only</div>}</td>
                  <td>{c.step || 0}</td>
                  <td>{fmtDate(c.nextFollowUpAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="pager">
          <button type="button" className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <span>Page {current + 1} of {pages}</span>
          <button type="button" className="btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      )}

      {open && <ContactDrawer contact={open} store={store} onClose={() => setOpenId(null)} />}
    </div>
  );
}
