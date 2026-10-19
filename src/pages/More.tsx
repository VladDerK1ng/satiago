import { Link } from 'react-router-dom';
import { Page } from '../components/ui';
import { t } from '../i18n';
import { useStore } from '../store';
import '../styles/settings.css';

/** 24 px stroke icons (no emoji as UI chrome, DESIGN.md). */
const ICONS = {
  body: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 10a3.5 3.5 0 0 1 7 0M12 10l1.6-1.8',
  library: 'M4 11h16a8 8 0 0 1-16 0zM9 4c-.8 1-.8 2 0 3M13 4c-.8 1-.8 2 0 3',
  goal: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  checkin: 'M9 3h6v3H9zM7 4.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-1M9 13.5l2 2 4-4',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  data: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  about: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  game: 'M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-.6.8A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4zM8 10.5v3M6.5 12h3M15.5 11h.01M17.5 13h.01',
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function More() {
  const n = useStore((s) => s.log.length);
  const items = [
    { to: '/more/body', ico: ICONS.body, title: t('more.body'), desc: t('more.bodyDesc') },
    { to: '/library', ico: ICONS.library, title: t('more.library'), desc: t('more.libraryDesc') },
    { to: '/goal', ico: ICONS.goal, title: t('more.goal'), desc: t('more.goalDesc') },
    { to: '/checkin', ico: ICONS.checkin, title: t('more.checkin'), desc: t('more.checkinDesc') },
    { to: '/more/settings', ico: ICONS.settings, title: t('more.settings'), desc: t('more.settingsDesc') },
    { to: '/more/data', ico: ICONS.data, title: t('more.data'), desc: t('more.dataDesc', { count: n }) },
    { to: '/more/about', ico: ICONS.about, title: t('more.about'), desc: t('more.aboutDesc') },
    { to: '/more/game', ico: ICONS.game, title: t('more.game'), desc: t('more.gameDesc') },
  ];
  return (
    <Page title={t('more.title')}>
      <div className="fw-screen">
        <div className="card list tight">
          {items.map((i) => (
            <Link key={i.to} to={i.to} className="item">
              <span className="fw-more-ico">
                <Icon d={i.ico} />
              </span>
              <span className="grow">
                <span className="fw-more-title">{i.title}</span>
                <span className="fw-more-desc" style={{ display: 'block' }}>
                  {i.desc}
                </span>
              </span>
              <span className="fw-chevron" aria-hidden>
                ›
              </span>
            </Link>
          ))}
        </div>
        <p className="fw-note center">
          {t('more.footer')}
          <br />
          {t('more.medical')}
        </p>
      </div>
    </Page>
  );
}
