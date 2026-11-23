import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Select from '../../components/ui/Select.jsx';
import Toggle from '../../components/ui/Toggle.jsx';
import { KIND_ICONS } from '../../components/ui/kindIcons.js';
import { setLanguage } from '../../i18n/index.js';
import { manilaDate } from '../../lib/dates.js';
import { formatDateShort, formatDaysAway } from '../../lib/format.js';
import { PAIRING_PATH } from '../../lib/permissions.js';
import { countdown, gestationalAge, trimester } from '../../lib/pregnancy.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { appointmentsOf, barangayChoices, consentRecordsOf, devicesOf, heleLoggingOf, patientRecord, personalInfoOf, providerOf, pendingRequestOf, pushStateOf, thresholdsOf, visitNotesOf } from '../../store/selectors.js';
import { useNow } from '../home/useNow.js';
import { placeText } from '../schedule/scheduleText.js';
import LinkedDevices from './LinkedDevices.jsx';
import { BarangayChangeSheet, ConsentSheet, PasswordSheet, PersonalSheet, PhotoSheet } from './ProfileSheets.jsx';

const HISTORY_STEP = 5;
const HISTORY_STATUS = { attended: ['normal', 'history.attended'], missed: ['attention', 'history.missed'], rescheduled: ['info', 'history.rescheduled'] };

function Row({ label, children, locked = false }) {
  const { t } = useTranslation('profile');
  return (
    <div className="detail">
      <dt className="detail__label">
        {label}
        {locked ? (
          <span className="detail__lock">
            <Lock size={14} aria-hidden="true" />
            <span className="visually-hidden">{t('pregnancy.readOnly')}</span>
          </span>
        ) : null}
      </dt>
      <dd className="detail__value">{children}</dd>
    </div>
  );
}

/** The patient's Profile (PAT-P-01 to PAT-P-05, PAT-A-06): personal information, pregnancy information, check-up history, linked devices and settings. */
export default function Profile() {
  const { t, i18n } = useTranslation('profile');
  const { t: ts } = useTranslation('schedule');
  const state = useStoreState();
  const viewer = useViewer();
  const actions = useActions();
  const navigate = useNavigate();
  const now = useNow(60000);
  const lang = i18n.language === 'fil' ? 'fil' : 'en';
  const today = manilaDate(now);
  const [sheet, setSheet] = useState(null);
  const [shown, setShown] = useState(HISTORY_STEP);

  const info = personalInfoOf(state, viewer);
  const record = useMemo(() => patientRecord(state, viewer, viewer.id), [state, viewer]);
  const thresholds = thresholdsOf(state);
  const devices = devicesOf(state, viewer, viewer.id);
  const barangays = barangayChoices(state);
  const barangayName = (id) => barangays.find((b) => b.id === id)?.name ?? '';
  const pendingChange = pendingRequestOf(state, viewer, 'barangay_change');
  const notes = visitNotesOf(state, viewer, viewer.id);
  const history = appointmentsOf(state, viewer, { patientId: viewer.id })
    .filter((a) => HISTORY_STATUS[a.status] && a.scheduled_at != null)
    .sort((a, b) => b.scheduled_at - a.scheduled_at);
  const records = consentRecordsOf(state, viewer);
  const heleOn = heleLoggingOf(state, viewer);
  const pushOn = pushStateOf(state, viewer.id) === 'allowed';
  const pregnancy = record?.pregnancy ?? null;
  const age = pregnancy ? gestationalAge(pregnancy.lmp, today) : null;
  const left = pregnancy ? countdown(pregnancy.edd, today) : null;
  const close = () => setSheet(null);

  return (
    <section className="page">
      <h1 className="page__title">{t('title')}</h1>

      <Card className="profile__head">
        <Avatar name={info.profile.full_name} size="lg" photo={info.profile.photo_url} illustration={info.profile.avatar_art ?? undefined} />
        <div className="profile__who">
          <h2 className="profile__name">{info.profile.full_name}</h2>
          <p className="card__meta">{barangayName(info.profile.barangay_id)}</p>
          <Button variant="ghost" onClick={() => setSheet('photo')}>
            {t('photo.change')}
          </Button>
        </div>
      </Card>

      <Card className="stack">
        <div className="card__head">
          <h2 className="card__title">{t('personal.title')}</h2>
          <Button variant="ghost" onClick={() => setSheet('personal')}>
            {t('personal.edit')}
          </Button>
        </div>
        {info.queued ? <Badge status="info">{t('personal.waiting')}</Badge> : null}
        <dl className="details">
          <Row label={t('personal.name')}>{info.profile.full_name}</Row>
          <Row label={t('personal.birthdate')}>{formatDateShort(info.patient.birthdate, lang)}</Row>
          <Row label={t('personal.contact')}>{info.profile.contact_no}</Row>
          <Row label={t('personal.address')}>{info.patient.address}</Row>
          <Row label={t('personal.emergency')}>
            {info.patient.emergency_name}
            <span className="detail__sub">
              {t(`relationship.${info.patient.emergency_relationship}`)} · {info.patient.emergency_no}
            </span>
          </Row>
          <Row label={t('personal.barangay')}>
            {barangayName(info.profile.barangay_id)}
            {pendingChange ? (
              <span className="detail__sub">
                <Badge status="info">{t('barangay.pending')}</Badge>
                <span>{t('barangay.requested', { name: barangayName(pendingChange.to_barangay_id) })}</span>
              </span>
            ) : null}
          </Row>
        </dl>
        {!pendingChange ? (
          <Button variant="ghost" onClick={() => setSheet('barangay')}>
            {t('barangay.request')}
          </Button>
        ) : null}
      </Card>

      {pregnancy ? (
        <Card className="stack">
          <h2 className="card__title">{t('pregnancy.title')}</h2>
          <p className="card__meta">{t('pregnancy.managed')}</p>
          <dl className="details">
            <Row label={t('pregnancy.lmp')} locked>
              {formatDateShort(pregnancy.lmp, lang)}
            </Row>
            <Row label={t('pregnancy.edd')} locked>
              {formatDateShort(pregnancy.edd, lang)}
              <span className="detail__sub">{t(pregnancy.edd_source === 'naegele' ? 'pregnancy.eddCalculated' : 'pregnancy.eddProvider')}</span>
            </Row>
            <Row label={t('pregnancy.age')}>
              <span className="detail__strong">{t('pregnancy.ageValue', { weeks: age.weeks, days: age.days })}</span>
            </Row>
            <Row label={t('pregnancy.trimester')}>{t(`pregnancy.trimesterValue.${trimester(age.totalDays)}`)}</Row>
            <Row label={t('pregnancy.countdown')}>
              {left.overdue ? t('pregnancy.passed', { when: formatDaysAway(left.days, lang) }) : t('pregnancy.toGo', { when: formatDaysAway(left.days, lang) })}
              <span className="detail__sub">{t('pregnancy.countdownDetail', { weeks: left.weeks, days: left.remainderDays })}</span>
            </Row>
            <Row label={t('pregnancy.risk')} locked>
              {pregnancy.risk_notes ?? t('pregnancy.noRisk')}
            </Row>
          </dl>
          <h3 className="card__title">{t('pregnancy.visitNotes')}</h3>
          {notes.length === 0 ? (
            <p className="card__meta">{t('pregnancy.noVisitNotes')}</p>
          ) : (
            <ul className="notes">
              {notes.map((note) => (
                <li key={note.id} className="notes__item">
                  <p className="notes__head">
                    {formatDateShort(manilaDate(note.taken_at), lang)} · {providerOf(state, viewer, note.author_id)?.full_name ?? ''}
                  </p>
                  <p className="card__meta">{t('pregnancy.vitals', { bp: `${note.bp_systolic}/${note.bp_diastolic}`, weight: note.weight_kg })}</p>
                  <p>{note.note}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card className="stack">
        <h2 className="card__title">{t('history.title')}</h2>
        {history.length === 0 ? (
          <p className="card__meta">{t('history.empty')}</p>
        ) : (
          <ol className="history">
            {history.slice(0, shown).map((appointment) => {
              const Icon = KIND_ICONS[appointment.type];
              const [status, key] = HISTORY_STATUS[appointment.status];
              const item = { kind: appointment.type, row: appointment };
              return (
                <li key={appointment.id} className="history__item">
                  <Icon size={20} aria-hidden="true" />
                  <div className="history__body">
                    <p className="history__title">{ts(`kind.${appointment.type}`)}</p>
                    <p className="card__meta">
                      {formatDateShort(manilaDate(appointment.scheduled_at), lang)} · {placeText(ts, item)}
                    </p>
                  </div>
                  <Badge status={status}>{t(key)}</Badge>
                </li>
              );
            })}
          </ol>
        )}
        {history.length > shown ? (
          <Button variant="ghost" onClick={() => setShown((count) => count + HISTORY_STEP)}>
            {t('history.more')}
          </Button>
        ) : null}
      </Card>

      <LinkedDevices belt={devices.find((d) => d.type === 'belt') ?? null} band={devices.find((d) => d.type === 'band') ?? null} thresholds={thresholds} onPair={() => navigate(PAIRING_PATH)} />

      <Card className="stack">
        <h2 className="card__title">{t('settings.title')}</h2>
        <Select
          label={t('settings.language')}
          value={lang}
          options={[
            { value: 'en', label: t('settings.english') },
            { value: 'fil', label: t('settings.filipino') },
          ]}
          onChange={(event) => {
            setLanguage(event.target.value);
            actions.save_language(event.target.value);
          }}
        />
        <div className="setting">
          <Toggle
            label={t('settings.push')}
            checked={pushOn}
            onChange={(next) => (next ? actions.allow_push() : actions.disable_push())}
          />
          <p className="card__meta">{t(pushOn ? 'settings.pushOn' : 'settings.pushOff')}</p>
        </div>
        <div className="setting">
          <Toggle label={t('settings.hele')} checked={heleOn} onChange={(next) => actions.set_hele_logging(next)} />
          <p className="card__meta">{t('settings.heleHint')}</p>
        </div>
        <Button block variant="ghost" onClick={() => setSheet('password')}>
          {t('settings.password')}
        </Button>
        <Button block variant="ghost" onClick={() => setSheet('consent')}>
          {t('settings.consent')}
        </Button>
        <Button block variant="ghost" onClick={() => actions.sign_out()}>
          {t('settings.signOut')}
        </Button>
      </Card>

      {sheet === 'photo' ? <PhotoSheet name={info.profile.full_name} current={info.profile} onClose={close} /> : null}
      {sheet === 'personal' ? <PersonalSheet values={{ contact_no: info.profile.contact_no, emergency_name: info.patient.emergency_name, emergency_relationship: info.patient.emergency_relationship, emergency_no: info.patient.emergency_no }} onClose={close} /> : null}
      {sheet === 'barangay' ? <BarangayChangeSheet choices={barangays.filter((b) => b.id !== info.profile.barangay_id)} onClose={close} /> : null}
      {sheet === 'password' ? <PasswordSheet onClose={close} /> : null}
      {sheet === 'consent' ? <ConsentSheet records={records} onClose={close} /> : null}
    </section>
  );
}
