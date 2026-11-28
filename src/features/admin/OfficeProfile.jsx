import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Avatar from '../../components/ui/Avatar.jsx';
import Banner from '../../components/ui/Banner.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Select from '../../components/ui/Select.jsx';
import Toggle from '../../components/ui/Toggle.jsx';
import { setLanguage } from '../../i18n/index.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { coverageGapsOf, pushStateOf } from '../../store/selectors.js';
import { PasswordSheet } from '../profile/ProfileSheets.jsx';

function Row({ label, children }) {
  return (
    <div className="detail">
      <dt className="detail__label">{label}</dt>
      <dd className="detail__value">{children}</dd>
    </div>
  );
}

/**
 * The Profile of a super account (SUP-P-01, ACC-09): account details, language, notification settings, password and sign out, the way to
 * manage accounts and read the activity logs, and a warning when a barangay has no active account.
 */
export default function OfficeProfile() {
  const { t, i18n } = useTranslation('tracker');
  const { t: ts } = useTranslation('schedule');
  const state = useStoreState();
  const viewer = useViewer();
  const actions = useActions();
  const [password, setPassword] = useState(false);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const pushOn = pushStateOf(state, viewer.id) === 'allowed';
  const gaps = coverageGapsOf(state, viewer);

  return (
    <section className="page page--wide">
      <h1 className="page__title">{t('profile.title')}</h1>

      {gaps.length > 0 ? (
        <Banner
          status="attention"
          title={t('profile.warnTitle', { count: gaps.length })}
          action={
            <Link className="btn btn--ghost" to="/super/profile/accounts/new">
              {t('profile.warnCreate')}
            </Link>
          }
        >
          {`${t('profile.warnBody')} ${gaps.map(({ barangay, patients }) => t('profile.warnItem', { name: barangay.name, count: patients })).join('; ')}`}
        </Banner>
      ) : null}

      <div className="office-grid">
        <Card className="profile__head">
          <Avatar name={viewer.full_name} size="lg" photo={viewer.photo_url} illustration={viewer.avatar_art ?? undefined} />
          <div className="profile__who">
            <h2 className="profile__name">{[viewer.full_name, viewer.name_suffix].filter(Boolean).join(', ')}</h2>
            <p className="card__meta">{ts('provider.role.super')}</p>
          </div>
        </Card>

        <Card className="stack">
          <h2 className="card__title">{t('profile.account')}</h2>
          <dl className="details">
            <Row label={t('profile.contact')}>{viewer.contact_no}</Row>
            <Row label={t('profile.email')}>{viewer.email}</Row>
          </dl>
        </Card>

        <Card className="stack">
          <h2 className="card__title">{t('profile.manageTitle')}</h2>
          <p className="card__meta">{t('profile.manageBody')}</p>
          <Link className="btn btn--primary" to="/super/profile/accounts">
            {t('profile.manage')}
          </Link>
        </Card>

        <Card className="stack">
          <h2 className="card__title">{t('profile.logsTitle')}</h2>
          <p className="card__meta">{t('profile.logsBody')}</p>
          <Link className="btn btn--ghost" to="/super/profile/logs">
            {t('profile.logs')}
          </Link>
        </Card>

        <Card className="stack">
          <h2 className="card__title">{t('profile.settings')}</h2>
          <Select
            label={t('profile.language')}
            value={lang}
            options={[
              { value: 'en', label: t('profile.english') },
              { value: 'fil', label: t('profile.filipino') },
            ]}
            onChange={(event) => {
              setLanguage(event.target.value);
              actions.save_language(event.target.value);
            }}
          />
          <div className="setting">
            <Toggle label={t('profile.push')} checked={pushOn} onChange={(next) => (next ? actions.allow_push() : actions.disable_push())} />
            <p className="card__meta">{t(pushOn ? 'profile.pushOn' : 'profile.pushOff')}</p>
          </div>
          <Button block variant="ghost" onClick={() => setPassword(true)}>
            {t('profile.password')}
          </Button>
        </Card>
      </div>

      <Button block variant="ghost" onClick={() => actions.sign_out()}>
        {t('profile.signOut')}
      </Button>
      {password ? <PasswordSheet onClose={() => setPassword(false)} /> : null}
    </section>
  );
}
