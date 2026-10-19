import { Page } from '../components/ui';
import { PRESET_AI_HOSTS, aiHostFor } from '../domain/aiProviders';
import { t } from '../i18n';
import { useStore } from '../store';
import { Illustration } from '../ui/Illustration';
import '../styles/settings.css';

const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) || '1.0.0';

/** About screen (AD-14): version, license with the ML Kit additional permission, attribution, network use, privacy. */
export default function About() {
  const aiOn = useStore((s) => s.settings.ai.enabled);
  const aiHost = useStore((s) => aiHostFor(s.settings.ai));
  return (
    <Page title={t('about.title')} back>
      <div className="fw-screen">
        <div className="fw-about-hero">
          <Illustration scene="welcome" size={140} />
          <p className="fw-about-name">Satiago</p>
          <span className="fw-about-version">{t('about.version', { version: APP_VERSION })}</span>
          <p className="fw-about-mission">{t('about.mission')}</p>
        </div>

        <h2>{t('about.privacy')}</h2>
        <div className="card">
          <p className="fw-body-text">{t('about.privacyBody')}</p>
          <div className="fw-link-row">
            <a className="fw-link" href="./privacypolicy.html">
              {t('about.privacyLink')}
            </a>
          </div>
        </div>

        <h2>{t('about.network')}</h2>
        <div className="card">
          <p className="fw-body-text">{t('about.networkIntro')}</p>
          <ul className="fw-hosts">
            <li>
              <code>world.openfoodfacts.org · search.openfoodfacts.org</code>
              <span>{t('about.net.off')}</span>
            </li>
            <li>
              <code>{PRESET_AI_HOSTS.join(' · ')}</code>
              <span>{t('about.net.ai')}</span>
              <span>{aiOn && aiHost ? t('about.net.aiNow', { host: aiHost }) : t('about.net.aiOff')}</span>
            </li>
          </ul>
          <p className="fw-note">{t('about.net.none')}</p>
        </div>

        <h2>{t('about.data')}</h2>
        <div className="card">
          <p className="fw-body-text">{t('about.offBody')}</p>
          <div className="fw-link-row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <a className="fw-link" href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">
              {t('about.offLink')}
            </a>
            <a className="fw-link" href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">
              {t('about.odblLink')}
            </a>
          </div>
        </div>

        <h2>{t('about.license')}</h2>
        <div className="card">
          <p className="fw-body-text">{t('about.licenseBody')}</p>
          <p className="fw-body-text">{t('about.licenseException')}</p>
          <a className="btn block" href="./third-party-licenses.txt" target="_blank" rel="noreferrer">
            {t('about.thirdParty')}
          </a>
          <a className="btn ghost block" style={{ marginTop: 6 }} href="https://github.com/VladDerK1ng/satiago" target="_blank" rel="noreferrer">
            {t('about.source')}
          </a>
        </div>

        <h2>{t('about.medicalTitle')}</h2>
        <div className="card">
          <p className="fw-body-text">{t('about.medical')}</p>
        </div>

        <h2>{t('about.trademarkTitle')}</h2>
        <div className="card">
          <p className="fw-body-text">{t('about.trademark')}</p>
        </div>
      </div>
    </Page>
  );
}
