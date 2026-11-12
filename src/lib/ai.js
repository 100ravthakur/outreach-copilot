// AI drafting. The only file that talks to an AI provider.
// Built-in templates work with no key; Gemini / Groq / Claude are optional.

import { fullName, followUpSubject, DEFAULT_PITCH } from './logic.js';

export const PROVIDERS = {
  templates: { label: 'Built-in templates (free, no key)', defaultModel: '', needsKey: false, paceMs: 0 },
  gemini: { label: 'Google Gemini (free tier)', defaultModel: 'gemini-2.5-flash', needsKey: true, paceMs: 6500, keyUrl: 'https://aistudio.google.com/apikey' },
  groq: { label: 'Groq (free tier)', defaultModel: 'llama-3.3-70b-versatile', needsKey: true, paceMs: 2500, keyUrl: 'https://console.groq.com/keys' },
  anthropic: { label: 'Anthropic Claude (paid)', defaultModel: 'claude-sonnet-5-5', needsKey: true, paceMs: 1200, keyUrl: 'https://console.anthropic.com/settings/keys' },
};

export const FOLLOW_UP_ANGLES = {
  1: 'Cost of open roles',
  2: 'Niche and leadership talent quality',
  3: 'Contract staffing / who owns hiring partners',
  4: 'Polite close-the-loop',
};

export function providerOf(settings) {
  return PROVIDERS[settings?.aiProvider] ? settings.aiProvider : 'templates';
}
export function modelOf(settings) {
  return (settings?.aiModel || '').trim() || PROVIDERS[providerOf(settings)].defaultModel;
}
/** Wait between calls in "Draft all" so free tiers don't rate-limit. */
export function paceMs(settings) {
  return PROVIDERS[providerOf(settings)].paceMs;
}

export function signatureOf(settings) {
  const sig = (settings?.signature || '').trim();
  if (sig) return sig;
  return [settings?.senderName, settings?.senderTitle, settings?.senderCompany].map((s) => (s || '').trim()).filter(Boolean).join('\n');
}

export function appendSignature(body, settings) {
  const text = String(body || '').trim();
  const sig = signatureOf(settings);
  if (!sig || text.endsWith(sig)) return text;
  return `${text}\n\n${sig}`;
}

/* ---------- prompts ---------- */

export function buildSystemPrompt(settings) {
  const sender = [settings?.senderName, settings?.senderTitle, settings?.senderCompany].filter(Boolean).join(', ');
  return [
    `You write outbound sales emails for ${sender || 'a business development manager at TalentiFi-X'}.`,
    `About the company (the only claims you may make about us): ${(settings?.pitch || '').trim() || DEFAULT_PITCH}`,
    'Rules:',
    '- NEVER invent facts about the prospect\'s company, their hiring needs, their vendors or their problems.',
    '- Use ONLY the contact\'s research notes as evidence. Quote nothing that is not in the notes.',
    '- If the notes are empty or thin, write a role-based angle instead (what someone in that role typically cares about, phrased as a question, not a claim) and set "low_evidence": true.',
    '- Match the seniority of the reader: executives get brevity and business outcomes; managers get practical detail.',
    '- No generic agency introduction ("We are a leading recruitment firm..."). No flattery. No buzzwords.',
    '- Concise, confident, plain text. No markdown, no bullet points, no emojis, no placeholders like [Name].',
    '- Exactly one call to action: a 15-20 minute meeting.',
    '- Do not add a signature; it is appended automatically.',
    '- Reply with a single JSON object and nothing else.',
  ].join('\n');
}

function contactBlock(contact) {
  return [
    `Name: ${fullName(contact)}`,
    `Title: ${contact.title || 'unknown'}`,
    `Company: ${contact.company || 'unknown'}`,
    `Industry: ${contact.industry || 'unknown'}`,
    `City: ${contact.city || 'unknown'}`,
    `Research notes: ${(contact.notes || '').trim() || '(none)'}`,
  ].join('\n');
}

function threadBlock(thread = []) {
  if (!thread.length) return '';
  return '\n\nEarlier emails in this thread (oldest first):\n' + thread
    .map((t, i) => `--- Email ${i + 1} (${t.kind === 'reply' ? 'our reply' : t.kind}, angle: ${t.angle || 'n/a'}) ---\nSubject: ${t.subject}\n${t.body}`)
    .join('\n\n');
}

export function buildUserPrompt({ contact, kind, step = 1, thread = [] }) {
  const who = contactBlock(contact);
  if (kind === 'first') {
    return `${who}\n\nWrite the FIRST email to this person.\n` +
      'Structure: Curiosity -> Problem -> Value -> Offer -> Reason to act -> CTA.\n' +
      'Length: 90-140 words in the body. Subject: specific, under 8 words.\n' +
      'Return JSON: {"subject": string, "body": string, "angle": string (3-6 words naming the angle), "evidence_used": string[] (phrases taken from the research notes, empty if none), "low_evidence": boolean}';
  }
  if (kind === 'followup') {
    const n = Math.min(Math.max(step, 1), 4);
    return `${who}${threadBlock(thread)}\n\nWrite follow-up number ${step} in the same thread. They have not replied.\n` +
      `Use a NEW angle, different from every earlier email. Angle for this step: ${FOLLOW_UP_ANGLES[n]}.\n` +
      'Length: 45-90 words. Do not repeat earlier sentences. Do not apologise for following up.\n' +
      'Return JSON: {"subject": string, "body": string, "angle": string, "evidence_used": string[], "low_evidence": boolean}';
  }
  if (kind === 'reply') {
    return `${who}${threadBlock(thread)}\n\nThey replied and are open to talking. Write a short answer (40-80 words) that thanks them and proposes a 15-20 minute call, asking for a time that suits them. Do not invent what they said.\n` +
      'Return JSON: {"subject": string, "body": string, "angle": "Reply", "evidence_used": string[], "low_evidence": boolean}';
  }
  return `${who}\n\nWrite a LinkedIn connection note. Maximum 280 characters. Friendly, specific to their role, no hard pitch, no meeting request, no signature.\n` +
    'Return JSON: {"note": string}';
}

/* ---------- parsing & errors ---------- */

/** Pull a JSON object out of whatever the model returned (fences, prose around it, etc.). */
export function parseAiJson(text) {
  let t = String(text ?? '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const attempts = [t];
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a !== -1 && b > a) {
    const slice = t.slice(a, b + 1);
    attempts.push(slice);
    // Raw line breaks inside strings are the most common model mistake.
    attempts.push(slice.replace(/"(?:[^"\\]|\\.)*"/gs, (s) => s.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t')));
    attempts.push(attempts[2].replace(/,\s*([}\]])/g, '$1'));
  }
  for (const candidate of attempts) {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch { /* try the next one */ }
  }
  throw new Error('The AI answer was not in the expected format. Please try again.');
}

export function normaliseDraft(obj) {
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\\n/g, '\n').trim();
  const evidence = Array.isArray(obj.evidence_used) ? obj.evidence_used.map(str).filter(Boolean) : str(obj.evidence_used) ? [str(obj.evidence_used)] : [];
  return {
    subject: str(obj.subject).replace(/\s+/g, ' '),
    body: str(obj.body),
    angle: str(obj.angle),
    evidenceUsed: evidence,
    lowEvidence: obj.low_evidence === true || obj.low_evidence === 'true',
  };
}

export function friendlyError(status, provider, detail = '') {
  const name = PROVIDERS[provider]?.label?.split(' (')[0] || 'The AI provider';
  if (status === 401 || status === 403) return `${name} rejected the API key. Check the key in Settings.`;
  if (status === 429) return `${name} rate limit reached. Wait a minute and try again, or switch to the built-in templates.`;
  if (status === 404) return `${name} does not know that model name. Check the model in Settings.`;
  if (status === 400 && /api.?key/i.test(detail)) return `${name} rejected the API key. Check the key in Settings.`;
  if (status >= 500) return `${name} is having trouble right now (error ${status}). Try again shortly.`;
  return `${name} returned an error (${status}). ${String(detail).slice(0, 160)}`.trim();
}

/* ---------- providers ---------- */

async function callProvider(settings, system, user) {
  const provider = providerOf(settings);
  const model = modelOf(settings);
  const key = (settings.aiKey || '').trim();
  if (!key) throw new Error('Add an API key in Settings first, or switch to the built-in templates.');

  let url, headers, body, pick;
  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    };
    pick = (d) => (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  } else if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    body = {
      model, temperature: 0.7, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    };
    pick = (d) => d.choices?.[0]?.message?.content || '';
  } else {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    body = { model, max_tokens: 1024, system, messages: [{ role: 'user', content: user }] };
    pick = (d) => (d.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
  }

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the AI provider. Check your internet connection.');
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || JSON.stringify(j).slice(0, 200); } catch { /* ignore */ }
    const err = new Error(friendlyError(res.status, provider, detail));
    err.status = res.status;
    throw err;
  }
  const text = pick(await res.json());
  if (!text) throw new Error('The AI returned an empty answer. Please try again.');
  return text;
}

/* ---------- built-in templates (role-based, no key) ---------- */

export function roleBucket(contact) {
  const t = (contact.title || '').toLowerCase();
  if (/\b(talent|recruit\w*|hr|human resources?|people|chro|staffing|vendor\w*|procurement|hiring)\b/.test(t)) return 'hiring';
  if (/\b(engineering|technology|technical|cto|cio|ciso|data|product|qa|quality|cloud|security|cybersecurity|it|devops|ai|ml|software|platform|analytics)\b/.test(t)) return 'tech';
  return 'business';
}

function industryPhrase(contact) {
  const i = `${contact.industry || ''}`.toLowerCase();
  if (/fintech|bfsi|bank|financ|insur|nbfc|lending|payment/.test(i)) return 'fintech and BFSI';
  if (/tech|software|saas|internet|computer|cloud/.test(i)) return 'technology';
  return 'growing';
}

const hi = (c) => `Hi ${(c.firstName || '').trim() || 'there'},`;
/** "Acme Fintech Pvt. Ltd." -> "Acme Fintech": how you would say the name in an email. */
export function spokenCompany(name) {
  let s = (name || '').trim();
  const suffix = /[\s,]+(pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|llp|plc|corp\.?|corporation)$/i;
  while (suffix.test(s)) s = s.replace(suffix, '').trim();
  return s;
}
const at = (c) => (spokenCompany(c.company) ? ` at ${spokenCompany(c.company)}` : '');

const FIRST_TEMPLATES = {
  hiring: (c) => ({
    subject: `${c.firstName ? c.firstName + ', a' : 'A'} question on niche hiring`,
    angle: 'Hard-to-fill roles (hiring owner)',
    body: `${hi(c)}

Quick question: which roles${at(c)} have stayed open the longest this quarter?

For many ${industryPhrase(c)} teams it is not the volume hiring that hurts. It is the niche and leadership roles, where the right people are not applying and every extra week adds pressure on the business.

TalentiFi-X is a human-led, AI-assisted recruitment firm. Our recruiters use AI to map and screen the market quickly, then personally vet every profile, so you see a short list worth interviewing, not a pile of CVs.

I would like to take one hard-to-fill role and work it alongside your current partners, so you can compare results directly.

Would a 15-20 minute call next week be worth it, before this quarter's hiring plan gets locked?`,
  }),
  tech: (c) => ({
    subject: `${c.firstName ? c.firstName + ', a' : 'A'} question on your open roles`,
    angle: 'Team capacity (tech leader)',
    body: `${hi(c)}

Quick question: how much of your own week goes into interviewing people who turn out not to be the right fit?

For many ${industryPhrase(c)} leaders, open seats in engineering, QA, data, cloud or security quietly slow the roadmap, and screening weak profiles takes time away from the team.

TalentiFi-X is a human-led, AI-assisted recruitment firm. Our recruiters use AI to search and screen widely, then personally vet each candidate, so you only meet people who match the role.

I would like to take your single hardest open role and send a short, vetted list you can judge for yourself.

Would a 15-20 minute call next week be worth it, before the next sprint of interviews fills your calendar?`,
  }),
  business: (c) => ({
    subject: `${c.firstName ? c.firstName + ', a' : 'A'} question on key hires`,
    angle: 'Cost of unfilled key roles (business leader)',
    body: `${hi(c)}

Quick question: is there a role${at(c)} that, if it were filled tomorrow, would noticeably move your numbers?

For many ${industryPhrase(c)} businesses, the cost of a key seat staying empty rarely shows up in a budget, yet the team feels it every week in slower delivery and stretched managers.

TalentiFi-X is a human-led, AI-assisted recruitment firm. We cover permanent, leadership and contract hiring across tech, sales, operations and collections, and our recruiters personally vet every profile before you see it.

I would like to take one priority role and show you a short, vetted list you can judge for yourself.

Would a 15-20 minute call next week be worth it, while plans for the coming quarter are still open?`,
  }),
};

const FOLLOW_UP_TEMPLATES = {
  1: (c) => `${hi(c)}

Adding one thought to my earlier note. Every week a key role stays open, the work lands on the rest of the team and deadlines start to slip. That cost rarely appears in a hiring budget, but it is real.

Our recruiters focus on getting a short, vetted list in front of you quickly. Would a 15-20 minute call this week help you judge whether we can close one role faster?`,
  2: (c) => `${hi(c)}

A different angle, in case it is more relevant. For niche and leadership roles, the strongest people are usually not applying anywhere. Our recruiters approach them directly, and use AI only to widen the search, so each profile you see has been spoken to and vetted by a person.

If one such role is on your list, could we spend 15-20 minutes on it next week?`,
  3: (c) => `${hi(c)}

One more option that may fit better. If permanent headcount is hard to approve right now, we also provide contract staff across tech, sales, operations and collections, so work keeps moving while approvals catch up.

And if hiring partners are looked after by someone else${at(c)}, could you point me to the right person? Otherwise, happy to cover this in a 15-20 minute call.`,
  4: (c) => `${hi(c)}

I do not want to crowd your inbox, so this is my last note for now. If improving how niche, leadership or contract roles get filled becomes a priority, I would be glad to help.

If it is worth a conversation, a 15-20 minute call is all I need. If not, no reply needed, and thank you for your time.`,
};

export function templateDraft({ contact, kind, step = 1 }) {
  if (kind === 'first') {
    const t = FIRST_TEMPLATES[roleBucket(contact)](contact);
    return { subject: t.subject, body: t.body, angle: t.angle, evidenceUsed: [], lowEvidence: true };
  }
  if (kind === 'followup') {
    const n = Math.min(Math.max(step, 1), 4);
    return { subject: followUpSubject(contact.firstSubject), body: FOLLOW_UP_TEMPLATES[n](contact), angle: FOLLOW_UP_ANGLES[n], evidenceUsed: [], lowEvidence: true };
  }
  if (kind === 'reply') {
    return {
      subject: followUpSubject(contact.firstSubject), angle: 'Reply', evidenceUsed: [], lowEvidence: false,
      body: `${hi(c0(contact))}

Thank you for getting back to me. I will keep it short: a 15-20 minute call is enough for me to understand what you are hiring for and to share how we would approach it.

Please suggest a time that suits you this week or next, and I will send an invite.`,
    };
  }
  return { note: templateLinkedInNote(contact) };
}
const c0 = (c) => c;

export function templateLinkedInNote(contact) {
  const first = (contact.firstName || '').trim() || 'there';
  const co = spokenCompany(contact.company);
  const where = co && co.length <= 40 ? ` at ${co}` : '';
  const note = `Hi ${first}, I work with ${industryPhrase(contact)} teams on niche and leadership hiring at TalentiFi-X. Not pitching here. I would simply like to connect and follow what you are building${where}.`;
  return note.slice(0, 280);
}

/* ---------- public API ---------- */

/**
 * Draft an email. kind: 'first' | 'followup' | 'reply'.
 * Returns { subject, body, angle, evidenceUsed, lowEvidence }. Signature is appended.
 */
export async function generateDraft({ contact, kind, step = 1, thread = [], settings }) {
  const provider = providerOf(settings);
  let draft;
  if (provider === 'templates') {
    draft = templateDraft({ contact, kind, step });
  } else {
    const text = await callProvider(settings, buildSystemPrompt(settings), buildUserPrompt({ contact, kind, step, thread }));
    draft = normaliseDraft(parseAiJson(text));
    if (!draft.body) throw new Error('The AI answer had no email body. Please try again.');
    if (!(contact.notes || '').trim()) draft.lowEvidence = true;
  }
  // Follow-ups and replies always stay in the original thread.
  if (kind !== 'first') draft.subject = followUpSubject(contact.firstSubject);
  if (kind === 'followup' && !draft.angle) draft.angle = FOLLOW_UP_ANGLES[Math.min(Math.max(step, 1), 4)];
  draft.body = appendSignature(draft.body, settings);
  return draft;
}

/** LinkedIn connection note, at most 280 characters. */
export async function generateLinkedInNote({ contact, settings }) {
  if (providerOf(settings) === 'templates') return templateLinkedInNote(contact);
  const text = await callProvider(settings, buildSystemPrompt(settings), buildUserPrompt({ contact, kind: 'linkedin' }));
  const note = String(parseAiJson(text).note || '').replace(/\s+/g, ' ').trim();
  if (!note) throw new Error('The AI answer had no note. Please try again.');
  return note.length <= 280 ? note : note.slice(0, 277).replace(/\s+\S*$/, '') + '...';
}

/** Settings "Test" button. */
export async function testProvider(settings) {
  const provider = providerOf(settings);
  if (provider === 'templates') return 'Built-in templates need no key. You are ready to go.';
  const text = await callProvider(settings, 'Reply with a single JSON object and nothing else.', 'Return JSON: {"ok": true}');
  parseAiJson(text);
  return `Connected to ${PROVIDERS[provider].label.split(' (')[0]} using ${modelOf(settings)}.`;
}
