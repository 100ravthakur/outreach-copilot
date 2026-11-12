import { useState } from 'react';
import Papa from 'papaparse';
import * as L from '../lib/logic.js';
import * as actions from '../actions.js';
import { Field } from '../components/ui.jsx';

const EMPTY = { firstName: '', lastName: '', title: '', company: '', email: '', linkedin: '', industry: '', city: '', notes: '', campaign: '' };

async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    const text = await file.text();
    const out = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
    return { headers: (out.meta.fields || []).filter(Boolean), rows: out.data };
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

function Report({ report }) {
  const lines = [
    ['Added', report.added], ['Already in your contacts', report.dupDb], ['Repeated in the file', report.dupFile],
    ['Invalid email', report.invalidEmail], ['LinkedIn only (no email)', report.linkedinOnly], ['Skipped (nothing to contact them on)', report.skipped],
  ];
  return (
    <div className="notice good" role="status">
      <strong>Import finished: {report.added} of {report.total} rows added.</strong>
      <dl className="report">
        {lines.map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{n}</dd></div>)}
      </dl>
      <p><a href="#today">Go to Today</a> to start drafting.</p>
    </div>
  );
}

export default function ImportScreen({ store }) {
  const { contacts, reload } = store;
  const [file, setFile] = useState(null); // { name, headers, rows }
  const [mapping, setMapping] = useState({});
  const [campaign, setCampaign] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [one, setOne] = useState(EMPTY);
  const [oneMsg, setOneMsg] = useState(null);

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(''); setReport(null);
    try {
      const { headers, rows } = await readFile(f);
      if (!rows.length) { setFile(null); setError('That file has no rows.'); return; }
      setFile({ name: f.name, headers, rows });
      setMapping(L.autoMapColumns(headers));
      setCampaign(f.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setFile(null);
      setError(`Could not read that file. ${err?.message || ''}`);
    }
  };

  const doImport = async () => {
    setBusy(true); setError('');
    try {
      setReport(await actions.importFile(file.rows, mapping, campaign.trim()));
      setFile(null);
    } catch (err) {
      setError(err?.message || 'Import failed.');
    } finally {
      setBusy(false);
      reload();
    }
  };

  const loadExamples = async () => {
    setBusy(true); setError('');
    try { setReport(await actions.loadExamples()); } catch (err) { setError(err?.message || 'Could not load examples.'); }
    setBusy(false);
    reload();
  };

  const addOne = async (e) => {
    e.preventDefault();
    const r = await actions.addOne(one, contacts);
    if (r.ok) { setOneMsg({ ok: true, text: `${one.firstName} ${one.lastName}`.trim() + ' added.' }); setOne({ ...EMPTY, campaign: one.campaign }); }
    else setOneMsg({ ok: false, text: r.reason });
    reload();
  };

  const canImport = file && (mapping.email || mapping.linkedin);
  const preview = file ? file.rows.slice(0, 3).map((r) => L.rowToFields(r, mapping)) : [];

  return (
    <div className="screen">
      <header className="screen-head"><div><h1>Import</h1><p className="muted">Bring in a prospect list from Apollo, LinkedIn Sales Navigator exports or your own spreadsheet.</p></div></header>

      {report && <Report report={report} />}
      {error && <p className="notice bad" role="alert">{error}</p>}

      <section className="card">
        <h2>Upload a CSV or Excel file</h2>
        <div className="actions">
          <label className="btn primary filebtn">
            Choose file
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={onPick} />
          </label>
          <button type="button" className="btn" onClick={loadExamples} disabled={busy}>Load example contacts</button>
          <span className="muted">The examples are 10 made-up people at made-up companies, so you can try everything safely.</span>
        </div>

        {file && (
          <>
            <p><strong>{file.name}</strong>: {file.rows.length} rows. Check that each field points at the right column.</p>
            <div className="grid3">
              {L.IMPORT_FIELDS.map(([field, label]) => (
                <Field key={field} label={label}>
                  <select value={mapping[field] || ''} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}>
                    <option value="">(not in file)</option>
                    {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Field>
              ))}
              <Field label="Campaign name" hint="Lets you filter contacts and results later.">
                <input type="text" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
              </Field>
            </div>
            <div className="table-wrap">
              <table className="table">
                <caption>First {preview.length} rows as they will be imported</caption>
                <thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>LinkedIn</th><th>Industry</th></tr></thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i}><td>{p.firstName} {p.lastName}</td><td>{p.title}</td><td>{p.company}</td><td>{p.email}</td><td>{L.linkedinSlug(p.linkedin)}</td><td>{p.industry}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!canImport && <p className="notice warn">Pick the Email column or the LinkedIn URL column first.</p>}
            <div className="actions">
              <button type="button" className="btn primary" disabled={!canImport || busy} onClick={doImport}>{busy ? 'Importing…' : `Import ${file.rows.length} rows`}</button>
              <button type="button" className="btn" onClick={() => setFile(null)}>Cancel</button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Add one contact</h2>
        <form onSubmit={addOne}>
          <div className="grid3">
            {[['firstName', 'First name'], ['lastName', 'Last name'], ['title', 'Job title'], ['company', 'Company'], ['email', 'Email'], ['linkedin', 'LinkedIn URL'], ['industry', 'Industry'], ['city', 'City'], ['campaign', 'Campaign']].map(([k, label]) => (
              <Field key={k} label={label}>
                <input type="text" value={one[k]} onChange={(e) => setOne({ ...one, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Field label="Research notes" hint="Optional. Facts only: open roles, funding, expansion, something they posted.">
            <textarea rows={3} value={one.notes} onChange={(e) => setOne({ ...one, notes: e.target.value })} />
          </Field>
          <div className="actions">
            <button type="submit" className="btn primary">Add contact</button>
            {oneMsg && <span className={oneMsg.ok ? 'notice good inline-note' : 'notice bad inline-note'} role="status">{oneMsg.text}</span>}
          </div>
        </form>
      </section>
    </div>
  );
}
