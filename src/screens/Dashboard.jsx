import { useMemo, useState } from 'react';
import * as L from '../lib/logic.js';
import { fmtDate } from '../components/ui.jsx';

const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`tile${tone ? ` tone-${tone}` : ''}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export default function Dashboard({ store }) {
  const { contacts, activities } = store;
  const [days, setDays] = useState(30);
  const [campaign, setCampaign] = useState('');
  const [industry, setIndustry] = useState('');
  const campaigns = useMemo(() => uniq(contacts.map((c) => c.campaign)), [contacts]);
  const industries = useMemo(() => uniq(contacts.map((c) => c.industry)), [contacts]);
  const stats = useMemo(() => L.computeStats(contacts, activities, { days, campaign, industry }, new Date()), [contacts, activities, days, campaign, industry]);
  const t = stats.tiles;
  const funnelMax = Math.max(1, ...stats.funnel.map((f) => f.value));
  const dayMax = Math.max(1, ...stats.perDay.map((d) => d.count));
  const totalSent = stats.perDay.reduce((n, d) => n + d.count, 0);

  return (
    <div className="screen">
      <header className="screen-head"><div><h1>Dashboard</h1><p className="muted">Counted from what you logged: sends, replies, meetings, bounces.</p></div></header>

      <div className="filters">
        <div className="seg" role="group" aria-label="Period">
          {[[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']].map(([d, label]) => (
            <button key={d} type="button" className={days === d ? 'active' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>{label}</button>
          ))}
        </div>
        <select aria-label="Campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
          <option value="">All industries</option>
          {industries.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="tiles">
        <Tile tone="green" label="Meetings booked" value={t.meetings} sub={`${t.meetingRate}% of first emails`} />
        <Tile tone="amber" label="Replies" value={t.replies} sub={`${t.replyRate}% reply rate`} />
        <Tile label="Interested replies" value={t.interested} />
        <Tile label="Active opportunities" value={t.activeOpportunities} sub="in conversation now" />
        <Tile tone="blue" label="First emails sent" value={t.firstEmails} />
        <Tile tone="purple" label="Follow-ups sent" value={t.followUps} />
        <Tile label="Follow-ups due today" value={t.followUpsDue} />
        <Tile label="LinkedIn requests" value={t.linkedinRequests} />
        <Tile label="Contacts added" value={t.added} />
        <Tile label="Researched" value={t.researched} sub="have research notes" />
        <Tile label="Bounces" value={t.bounces} />
        <Tile label="Opt-outs" value={t.optouts} />
      </div>

      <section className="card">
        <h2>Funnel</h2>
        <ul className="funnel">
          {stats.funnel.map((f) => (
            <li key={f.label}>
              <span className="funnel-label">{f.label}</span>
              <span className="bar-track"><span className="bar" style={{ width: `${(f.value / funnelMax) * 100}%` }} /></span>
              <span className="funnel-value">{f.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Emails per day</h2>
        <p className="muted">{totalSent} first emails and follow-ups in the last {stats.perDay.length} days. Busiest day: {dayMax === 1 && totalSent === 0 ? 0 : dayMax}.</p>
        <div className="daybars" role="img" aria-label={`Emails per day over the last ${stats.perDay.length} days, ${totalSent} in total`}>
          {stats.perDay.map((d) => (
            <div key={d.date} className="daybar" title={`${fmtDate(d.date)}: ${d.count}`}>
              <span style={{ height: `${(d.count / dayMax) * 100}%` }} className={d.count ? '' : 'zero'} />
            </div>
          ))}
        </div>
        <div className="daybars-axis muted"><span>{fmtDate(stats.perDay[0].date)}</span><span>{fmtDate(stats.perDay[stats.perDay.length - 1].date)}</span></div>
      </section>

      <section className="card">
        <h2>By industry</h2>
        {stats.byIndustry.length === 0 ? <p className="muted">Nothing sent in this period yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Industry</th><th className="num">Emailed</th><th className="num">Replies</th><th className="num">Reply rate</th><th className="num">Meetings</th></tr></thead>
              <tbody>
                {stats.byIndustry.map((r) => (
                  <tr key={r.industry}><td>{r.industry}</td><td className="num">{r.emailed}</td><td className="num">{r.replies}</td><td className="num">{r.replyRate}%</td><td className="num">{r.meetings}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Which angles get replies</h2>
        <p className="muted">Each reply is credited to the last email you sent before it arrived.</p>
        {stats.angles.length === 0 ? <p className="muted">Nothing sent in this period yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Angle</th><th className="num">Sent</th><th className="num">Replies</th><th className="num">Interested</th><th className="num">Reply rate</th></tr></thead>
              <tbody>
                {stats.angles.map((r) => (
                  <tr key={r.angle}><td>{r.angle}</td><td className="num">{r.sent}</td><td className="num">{r.replies}</td><td className="num">{r.interested}</td><td className="num">{r.sent ? `${r.replyRate}%` : 'n/a'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
