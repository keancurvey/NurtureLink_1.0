import { useState } from 'react';
import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Avatar from '../../components/ui/Avatar.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Select from '../../components/ui/Select.jsx';
import Toggle from '../../components/ui/Toggle.jsx';
import { setLanguage } from '../../i18n/index.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { officeContactsOf, pushStateOf } from '../../store/selectors.js';
import { telHref } from '../alerts/text.js';
import { PasswordSheet } from './ProfileSheets.jsx';

function Row({ label, children }) {
  return (
    <div className="detail">
      <dt className="detail__label">{label}</dt>
      <dd className="detail__value">{children}</dd>
    </div>
  );
}

/** The barangay account's Profile (BRG-P-01): account details, language, notification settings, password, sign out, and how to reach the Municipal Health Office. */
export default function BarangayProfile() {
  const { t, i18n } = useTranslation('monitor');
  const { t: ts } = useTranslation('schedule');
  const state = useStoreState();
  const viewer = useViewer();
  const actions = useActions();
  const [password, setPassword] = useState(false);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const barangay = state.db.barangays.find((b) => b.id === viewer.barangay_id);
  const office = officeContactsOf(state, viewer);
  const pushOn = pushStateOf(state, viewer.id) === 'allowed';

  return (
    <section className="page">
      <h1 className="page__title">{t('profile.title')}</h1>

      <Card className="profile__head">
        <Avatar name={viewer.full_name} size="lg" photo={viewer.photo_url} illustration={viewer.avatar_art ?? undefined} />
        <div className="profile__who">
          <h2 className="profile__name">{viewer.full_name}</h2>
          <p className="card__meta">{ts('provider.role.barangay')}</p>
        </div>
      </Card>

      <Card className="stack">
        <h2 className="card__title">{t('profile.account')}</h2>
        <dl className="details">
          <Row label={t('profile.barangay')}>{barangay?.name ?? ''}</Row>
          <Row label={t('profile.contact')}>{viewer.contact_no}</Row>
          <Row label={t('profile.email')}>{viewer.email}</Row>
        </dl>
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

      <Card className="stack">
        <h2 className="card__title">{t('profile.office')}</h2>
        <p className="card__meta">{t('profile.officeBody')}</p>
        <ul className="office">
          {office.map((person) => (
            <li key={person.id} className="office__row">
              <span className="office__who">
                <span className="office__name">{person.name}</span>
                <span className="card__meta">{person.contact_no}</span>
              </span>
              {person.contact_no ? (
                <a className="btn btn--ghost" href={telHref(person.contact_no)} aria-label={t('profile.callPerson', { name: person.name })}>
                  <Phone size={20} aria-hidden="true" />
                  {t('profile.call')}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Button block variant="ghost" onClick={() => actions.sign_out()}>
        {t('profile.signOut')}
      </Button>
      {password ? <PasswordSheet onClose={() => setPassword(false)} /> : null}
    </section>
  );
}
