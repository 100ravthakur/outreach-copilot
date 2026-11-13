import { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from './lib/db.js';
import * as L from './lib/logic.js';
import Today from './screens/Today.jsx';
import Contacts from './screens/Contacts.jsx';
import ImportScreen from './screens/Import.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Settings from './screens/Settings.jsx';

const ROUTES = [
  ['today', 'Today'],
  ['contacts', 'Contacts'],
  ['import', 'Import'],
  ['dashboard', 'Dashboard'],
  ['settings', 'Settings'],
];

const ICONS = {
  today: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4" /></>,
  contacts: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.500M16 4.800a3.5 3.5 0 0 1 0 6.400M18 14.800c1.9.700 3.1 2.4 3.5 5.2" /></>,
  import: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.500M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  dashboard: <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>,
  settings: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
};
const NavIcon = ({ name }) => (
  <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);

const routeFromHash = () => {
  const r = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES.some(([k]) => k === r) ? r : 'today';
};

export default function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');

  const reload = useCallback(async () => {
    try {
      setData(await db.loadAll());
    } catch (e) {
      setLoadError(e?.message || 'Could not open the browser database.');
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const queues = useMemo(
    () => (data ? L.buildQueues(data.contacts, data.activities, data.settings, new Date()) : null),
    [data],
  );

  if (loadError) return <div className="boot"><p className="notice bad">{loadError}</p></div>;
  if (!data) return <div className="boot">Opening your data…</div>;

  const store = { ...data, queues, reload };
  const todayCount = queues.first.length + queues.followups.length + queues.linkedin.length + queues.replies.length;

  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        <div className="brand">Outreach Copilot</div>
        <ul>
          {ROUTES.map(([key, label]) => (
            <li key={key}>
              <a href={`#${key}`} className={route === key ? 'active' : ''} aria-current={route === key ? 'page' : undefined}>
                <NavIcon name={key} />
                <span>{label}</span>
                {key === 'today' && todayCount > 0 && <span className="badge" aria-label={`${todayCount} to do`}>{todayCount}</span>}
              </a>
            </li>
          ))}
        </ul>
        <p className="nav-foot">Your data stays in this browser.</p>
      </nav>
      <main className="main">
        {route === 'today' && <Today store={store} />}
        {route === 'contacts' && <Contacts store={store} />}
        {route === 'import' && <ImportScreen store={store} />}
        {route === 'dashboard' && <Dashboard store={store} />}
        {route === 'settings' && <Settings store={store} />}
      </main>
    </div>
  );
}
