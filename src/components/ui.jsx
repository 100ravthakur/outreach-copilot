import { useEffect, useState } from 'react';
import * as L from '../lib/logic.js';

export function ScorePill({ score }) {
  return <span className={`pill score ${score.tier}`} title={score.reasons.map((r) => `+${r.points} ${r.text}`).join('\n')}>{score.score} {L.TIER_LABELS[score.tier]}</span>;
}

export function StatusPill({ status }) {
  return <span className={`pill status st-${status}`}>{L.STATUS_LABELS[status] || status}</span>;
}

/** Button that asks "are you sure?" in the page, never with a browser popup. */
export function ConfirmButton({ label, confirmLabel = 'Yes, do it', question, onConfirm, className = 'btn danger', disabled }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="confirm" role="alertdialog" aria-label={question}>
      <span className="confirm-q">{question}</span>
      <button type="button" className="btn danger solid" onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
      <button type="button" className="btn" autoFocus onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}

/** Short message that fades away on its own. */
export function useFlash(ms = 2500) {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(''), ms);
    return () => clearTimeout(t);
  }, [msg, ms]);
  return [msg, setMsg];
}

export const OUTCOMES = [
  ['positive', 'Interested'],
  ['neutral', 'Neutral'],
  ['negative', 'Not interested'],
  ['bounced', 'Bounced'],
  ['optout', 'Unsubscribe'],
];

export function fmtDate(isoOrDay) {
  if (!isoOrDay) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDay) ? new Date(`${isoOrDay}T12:00:00`) : new Date(isoOrDay);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function Field({ label, hint, children, wide }) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
