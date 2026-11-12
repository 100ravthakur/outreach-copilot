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
