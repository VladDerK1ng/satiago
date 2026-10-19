import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { aiHostFor } from './domain/aiProviders';
import { hideSplash, onBackButton, onDeepLink, syncStatusBar } from './platform/app';
import { setHapticsEnabled } from './platform/haptics';
import { setAiHost } from './platform/net';
import { onReminderTap, scheduleReminders } from './platform/notifications';
import { useActiveGoal, useStore } from './store';
import { closeTopOverlay } from './ui/backStack';
import { motionTokens } from './ui/motion';
import { SnackbarHost, toast } from './ui/snackbar';
import Dashboard from './pages/Dashboard';
import FoodLog from './pages/FoodLog';
import AddFood from './pages/AddFood';
import AiReview from './pages/AiReview';
import FoodEditor from './pages/FoodEditor';
import Library from './pages/Library';
import RecipeEditor from './pages/RecipeEditor';
import CheckIn from './pages/CheckIn';
import Strategy from './pages/Strategy';
import GoalWizard from './pages/GoalWizard';
import Nutrients from './pages/Nutrients';
import Body from './pages/Body';
import More from './pages/More';
import SettingsPage from './pages/Settings';
import DataPage from './pages/Data';
import About from './pages/About';
import Onboarding from './pages/Onboarding';
import Game from './pages/Game';

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  const accent = useStore((s) => s.settings.accent);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = t;
      // Only override the accent when the user picked a non-default one.
      if (accent && accent !== '#16a34a') document.documentElement.style.setProperty('--color-accent', accent);
      else document.documentElement.style.removeProperty('--color-accent');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#F5F6F4' : '#0B0D0C');
      syncStatusBar(t);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent]);
}

/** Keeps native side effects (haptics, reminders, back button, deep links) in sync with state. */
function useNativeBridges() {
  const nav = useNavigate();
  const loc = useLocation();
  const haptics = useStore((s) => s.settings.haptics);
  const reminders = useStore((s) => s.settings.reminders);
  const goal = useActiveGoal();

  useEffect(() => setHapticsEnabled(haptics), [haptics]);

  // AD-7: besides Open Food Facts and Anthropic, netFetch allows only the configured AI provider's host.
  const aiHost = useStore((s) => aiHostFor(s.settings.ai));
  useEffect(() => setAiHost(aiHost), [aiHost]);

  useEffect(() => {
    scheduleReminders({
      checkIn: reminders.checkIn && goal && goal.style !== 'manual' ? { weekday: goal.checkInDay, minute: reminders.checkInMinute } : undefined,
      weighIn: reminders.weighIn ? { minute: reminders.weighInMinute } : undefined,
      precise: reminders.precise,
    }).then((r) => {
      if (!r.ok) toast(r.reason);
    });
  }, [reminders, goal]);

  useEffect(() => onReminderTap((route) => nav(route)), [nav]);
  useEffect(() => onDeepLink((route) => nav(route)), [nav]);

  useEffect(() => {
    let lastBack = 0;
    return onBackButton(() => {
      if (closeTopOverlay()) return true;
      const root = ['/', '/log', '/strategy', '/nutrients', '/more'].includes(loc.pathname);
      if (!root) {
        nav(-1);
        return true;
      }
      if (loc.pathname !== '/') {
        nav('/');
        return true;
      }
      const now = Date.now();
      if (now - lastBack < 2000) return false;
      lastBack = now;
      toast('Press back again to exit');
      return true;
    });
  }, [loc.pathname, nav]);
}

const TABS = [
  { to: '/', label: 'Dashboard', icon: 'M4 13h6V4H4zm0 7h6v-5H4zm8 0h8v-9h-8zm0-16v5h8V4z' },
  { to: '/log', label: 'Food Log', icon: 'M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M16 21V3c2.2 1.4 3 4 3 7s-1 4-3 4' },
  { to: '/strategy', label: 'Plan', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' },
  { to: '/nutrients', label: 'Nutrients', icon: 'M9 3h6M10 3v6L5 18a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7 15h10' },
  { to: '/more', label: 'More', icon: 'M5 12h.01M12 12h.01M19 12h.01' },
];

/** Each new screen starts at the top (mounted after the previous screen's exit animation). */
function ScrollToTop() {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return null;
}

function Shell() {
  useTheme();
  useNativeBridges();
  const onboarded = useStore((s) => s.settings.onboarded);
  const loc = useLocation();
  if (!onboarded && loc.pathname !== '/welcome') return <Navigate to="/welcome" replace />;
  const hideTabs = loc.pathname === '/welcome' || loc.pathname.startsWith('/checkin') || loc.pathname.startsWith('/ai/') || loc.pathname === '/goal';
  return (
    <div className="app">
      <AnimatePresence mode="wait" initial={false}>
        <motion.main key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={motionTokens.base}>
          <ScrollToTop />
          <Routes location={loc}>
            <Route path="/welcome" element={<Onboarding />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/log" element={<FoodLog />} />
            <Route path="/log/:date" element={<FoodLog />} />
            <Route path="/add" element={<AddFood />} />
            <Route path="/ai/review" element={<AiReview />} />
            <Route path="/foods/new" element={<FoodEditor />} />
            <Route path="/foods/:id" element={<FoodEditor />} />
            <Route path="/library" element={<Library />} />
            <Route path="/recipes/:id" element={<RecipeEditor />} />
            <Route path="/checkin" element={<CheckIn />} />
            <Route path="/strategy" element={<Strategy />} />
            <Route path="/goal" element={<GoalWizard />} />
            <Route path="/nutrients" element={<Nutrients />} />
            <Route path="/more" element={<More />} />
            <Route path="/more/body" element={<Body />} />
            <Route path="/more/settings" element={<SettingsPage />} />
            <Route path="/more/data" element={<DataPage />} />
            <Route path="/more/about" element={<About />} />
            <Route path="/more/game" element={<Game />} />
            {/* Launcher shortcuts: satiago://scan, satiago://weigh */}
            <Route path="/scan" element={<Navigate to="/add?scan=1" replace />} />
            <Route path="/weigh" element={<Navigate to="/more/body?weigh=1" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.main>
      </AnimatePresence>
      {!hideTabs && (
        <nav className="tabs" aria-label="Main">
          <div className="inner">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'}>
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="tab-pill" className="tab-pill" transition={motionTokens.sheet} />}
                    <svg className="ico" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={t.label === 'More' ? 3.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d={t.icon} />
                    </svg>
                    <span>{t.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
      <SnackbarHost />
    </div>
  );
}

/** Waits for IndexedDB hydration so onboarding state is known before routing. */
function useHydrated() {
  const [done, setDone] = useState(() => useStore.persist.hasHydrated());
  useEffect(() => {
    if (done) return;
    const unsub = useStore.persist.onFinishHydration(() => setDone(true));
    if (useStore.persist.hasHydrated()) setDone(true);
    return unsub;
  }, [done]);
  useEffect(() => {
    if (done) hideSplash();
  }, [done]);
  return done;
}

export default function App() {
  const hydrated = useHydrated();
  if (!hydrated) return <div className="boot" aria-busy="true" />;
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
