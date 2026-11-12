import { useEffect, useRef, useState } from 'react';
import * as L from '../lib/logic.js';
import * as db from '../lib/db.js';
import * as ai from '../lib/ai.js';
import * as actions from '../actions.js';
import { ConfirmButton, Field } from '../components/ui.jsx';

export default function Settings({ store }) {
  const { reload, contacts } = store;
  const [form, setForm] = useState(store.settings);
  const [savedAt, setSavedAt] = useState(0);
  const [test, setTest] = useState(null); // { ok, text } | 'busy'
  const [backupMsg, setBackupMsg] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const timer = useRef(null);
  const latest = useRef(form);

  const flush = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    await db.saveSettings(latest.current);
    setSavedAt(Date.now());
    reload();
  };
  // Saves by itself a moment after you stop typing.
  const set = (patch) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setForm(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); db.saveSettings(latest.current).then(reload); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const provider = ai.providerOf(form);
  const info = ai.PROVIDERS[provider];
  const gaps = L.parseGaps(form.followUpGaps);
  const managerBad = form.managerEmail && !L.isValidEmail(form.managerEmail);

  const runTest = async () => {
    setTest('busy');
    try { setTest({ ok: true, text: await ai.testProvider(latest.current) }); }
    catch (e) { setTest({ ok: false, text: e?.message || 'Test failed.' }); }
  };

  const downloadBackup = async () => {
    const data = await db.exportBackup();
    actions.download(`outreach-copilot-backup-${L.dayKey(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
    setBackupMsg({ ok: true, text: `Backup downloaded: ${data.contacts.length} contacts, ${data.activities.length} activities. The AI key is not included.` });
  };

  const pickRestore = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.app !== 'outreach-copilot' || !Array.isArray(data.contacts)) throw new Error('That file is not an Outreach Copilot backup.');
      setPendingRestore({ name: f.name, data });
      setBackupMsg(null);
    } catch (err) {
      setBackupMsg({ ok: false, text: err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message });
    }
  };

  const doRestore = async () => {
    try {
      const r = await db.restoreBackup(pendingRestore.data);
      const fresh = await db.getSettings();
      latest.current = fresh;
      setForm(fresh);
      setBackupMsg({ ok: true, text: `Restored ${r.contacts} contacts and ${r.activities} activities.` });
    } catch (err) {
      setBackupMsg({ ok: false, text: err.message });
    }
    setPendingRestore(null);
    reload();
  };

  const wipe = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    await db.deleteAll();
    latest.current = { ...L.DEFAULT_SETTINGS };
    setForm(latest.current);
    setBackupMsg({ ok: true, text: 'Everything was deleted from this browser.' });
    reload();
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <div><h1>Settings</h1><p className="muted" role="status">{savedAt ? 'Saved.' : 'Changes save by themselves.'}</p></div>
      </header>

      <section className="card">
        <h2>About you</h2>
        <div className="grid3">
          <Field label="Your name"><input type="text" value={form.senderName} onChange={(e) => set({ senderName: e.target.value })} autoComplete="name" /></Field>
          <Field label="Your title"><input type="text" value={form.senderTitle} onChange={(e) => set({ senderTitle: e.target.value })} /></Field>
          <Field label="Company"><input type="text" value={form.senderCompany} onChange={(e) => set({ senderCompany: e.target.value })} /></Field>
        </div>
        <Field label="Manager's email (CC)" hint="Added as CC on first emails only. Follow-ups and replies get no CC unless you type one.">
          <input type="email" value={form.managerEmail} onChange={(e) => set({ managerEmail: e.target.value })} placeholder="manager@yourcompany.com" />
        </Field>
        {managerBad && <p className="notice warn">That does not look like an email address yet.</p>}
        <Field label="Signature" hint={form.signature.trim() ? 'Added to the end of every draft.' : 'Left empty: your name, title and company are used.'}>
          <textarea rows={4} value={form.signature} onChange={(e) => set({ signature: e.target.value })} placeholder={ai.signatureOf({ ...form, signature: '' }) || 'Your name\nYour title\nCompany'} />
        </Field>
      </section>

      <section className="card">
        <h2>Sending</h2>
        <div className="grid3">
          <Field label="Follow-up gaps (days)" hint={gaps.length ? `${gaps.length} follow-up${gaps.length === 1 ? '' : 's'}: ${gaps.map((g, i) => `#${i + 1} after ${g} days`).join(', ')}.` : 'No follow-ups will be scheduled.'}>
            <input type="text" value={form.followUpGaps} onChange={(e) => set({ followUpGaps: e.target.value })} placeholder="3, 5, 7" />
          </Field>
          <Field label="Daily send cap" hint="First emails plus follow-ups per day.">
            <input type="number" min="0" max="500" value={form.dailyCap} onChange={(e) => set({ dailyCap: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })} />
          </Field>
          <Field label="Mail app" hint={'Where "Open in Outlook" takes you.'}>
            <select value={form.mailClient} onChange={(e) => set({ mailClient: e.target.value })}>
              {Object.entries(L.MAIL_CLIENTS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={form.skipWeekends !== false} onChange={(e) => set({ skipWeekends: e.target.checked })} />
          <span>Skip weekends (a follow-up landing on Saturday or Sunday moves to Monday)</span>
        </label>
      </section>

      <section className="card">
        <h2>Company pitch</h2>
        <Field label="What the AI may say about your company" hint="The AI is told to make no other claims about you, and to invent nothing about the prospect.">
          <textarea rows={6} value={form.pitch} onChange={(e) => set({ pitch: e.target.value })} />
        </Field>
        <button type="button" className="btn quiet" onClick={() => set({ pitch: L.DEFAULT_PITCH })} disabled={form.pitch === L.DEFAULT_PITCH}>Reset to the default pitch</button>
      </section>

      <section className="card">
        <h2>AI drafting</h2>
        <div className="grid3">
          <Field label="Provider">
            <select value={provider} onChange={(e) => { setTest(null); set({ aiProvider: e.target.value, aiModel: '', aiKey: '' }); }}>
              {Object.entries(ai.PROVIDERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </Field>
          {info.needsKey && (
            <>
              <Field label="API key" hint={<>Stored only in this browser. <a href={info.keyUrl} target="_blank" rel="noopener noreferrer">Get a key</a></>}>
                <input type="password" value={form.aiKey} onChange={(e) => set({ aiKey: e.target.value.trim() })} autoComplete="off" spellCheck="false" />
              </Field>
              <Field label="Model" hint={`Leave empty for ${info.defaultModel}.`}>
                <input type="text" value={form.aiModel} onChange={(e) => set({ aiModel: e.target.value })} placeholder={info.defaultModel} spellCheck="false" />
              </Field>
            </>
          )}
        </div>
        {!info.needsKey && <p className="muted">Built-in templates pick an email by the contact's role. They are free and need no key, but they do not read your research notes. Add a free Gemini or Groq key for emails written around your notes.</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={runTest} disabled={test === 'busy'}>{test === 'busy' ? 'Testing…' : 'Test'}</button>
          {test && test !== 'busy' && <span className={`notice inline-note ${test.ok ? 'good' : 'bad'}`} role="status">{test.text}</span>}
        </div>
      </section>

      <section className="card">
        <h2>Backup</h2>
        <p className="muted">Your data lives only in this browser on this PC. Download a backup every week, and before clearing browser data.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={downloadBackup}>Download backup</button>
          <label className="btn filebtn">Restore from backup<input type="file" accept=".json,application/json" onChange={pickRestore} /></label>
        </div>
        {pendingRestore && (
          <div className="notice warn" role="alertdialog" aria-label="Confirm restore">
            <p>Replace the {contacts.length} contacts here with the {pendingRestore.data.contacts.length} in <strong>{pendingRestore.name}</strong>? What is here now will be lost.</p>
            <div className="actions">
              <button type="button" className="btn danger solid" onClick={doRestore}>Yes, replace everything</button>
              <button type="button" className="btn" onClick={() => setPendingRestore(null)}>Cancel</button>
            </div>
          </div>
        )}
        {backupMsg && <p className={`notice ${backupMsg.ok ? 'good' : 'bad'}`} role="status">{backupMsg.text}</p>}
      </section>

      <section className="card">
        <h2>Delete everything</h2>
        <p className="muted">Removes all contacts, history, drafts and settings from this browser. This cannot be undone.</p>
        <ConfirmButton label="Delete all data" question="Delete all contacts, history and settings?" confirmLabel="Yes, delete everything" onConfirm={wipe} />
      </section>
    </div>
  );
}
