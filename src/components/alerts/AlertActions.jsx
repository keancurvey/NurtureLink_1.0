import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { telHref } from '../../features/alerts/text.js';
import { OUTCOME_MAX, REASON_MAX } from '../../lib/alertView.js';
import { notificationPath } from '../../lib/notifications.js';
import { useActions, useStoreState, useViewer } from '../../store/hooks.js';
import { alertById, profileOf } from '../../store/selectors.js';
import Banner from '../ui/Banner.jsx';
import Button from '../ui/Button.jsx';
import Field from '../ui/Field.jsx';
import Sheet from '../ui/Sheet.jsx';

/**
 * The shared sheet for answering an alert (ALR-04): acknowledge (the first account claims it, the others see who),
 * call or chat, refer to the midwife, and resolve with an outcome note. Opened from the alert detail screen, and from the
 * emergency banner and the patient cards of the Monitor tab (Prompt 8). Providers only; the store enforces access.
 */
export default function AlertActions({ alertId, open, onClose }) {
  const { t } = useTranslation('alerts');
  const navigate = useNavigate();
  const actions = useActions();
  const state = useStoreState();
  const viewer = useViewer();
  const [view, setView] = useState('main'); // main | resolve | refer
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null); // { status, text }
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const close = useCallback(() => {
    setView('main');
    setFeedback(null);
    onClose();
  }, [onClose]);

  const alert = viewer ? alertById(state, viewer, alertId) : null;
  if (!open || !alert || !viewer) return null;
  const patient = profileOf(state, alert.patient_id);
  const claimer = alert.acknowledged_by ? profileOf(state, alert.acknowledged_by) : null;
  const mine = alert.acknowledged_by === viewer.id;
  const isResolved = alert.status === 'resolved';
  const canResolve = alert.status === 'acknowledged' && (mine || viewer.role === 'super');
  const canRefer = viewer.role === 'barangay' && mine && !isResolved && !alert.referred_at;
  const referrer = alert.referred_by ? profileOf(state, alert.referred_by) : null;
  const chatPath = notificationPath(viewer.role, { type: 'message', payload: {} });

  async function run(call, doneKey, after) {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await call();
      if (result.ok) {
        setFeedback({ status: 'normal', text: t(doneKey) });
        after?.();
      } else {
        setFeedback({ status: 'alert', text: t(`actions.error.${result.error}`, { name: result.byName ?? '', defaultValue: t('actions.error.generic') }) });
      }
    } finally {
      setBusy(false);
    }
  }

  const note = feedback ? (
    <Banner status={feedback.status}>{feedback.text}</Banner>
  ) : null;

  if (view === 'resolve') {
    return (
      <Sheet open onClose={close} title={t('actions.resolveTitle')}>
        <div className="stack">
          {note}
          <Field
            label={t('actions.outcomeLabel')}
            hint={t('actions.outcomeHint')}
            multiline
            rows={4}
            maxLength={OUTCOME_MAX}
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          />
          <Button
            block
            loading={busy}
            onClick={() => run(() => actions.resolve_alert(alert.id, { outcome }), 'actions.done.resolved', () => { setOutcome(''); setView('main'); })}
          >
            {t('actions.saveResolve')}
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => { setFeedback(null); setView('main'); }}>
            {t('actions.back')}
          </Button>
        </div>
      </Sheet>
    );
  }

  if (view === 'refer') {
    return (
      <Sheet open onClose={close} title={t('actions.referTitle')}>
        <div className="stack">
          {note}
          <Field
            label={t('actions.reasonLabel')}
            hint={t('actions.reasonHint')}
            multiline
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            block
            loading={busy}
            onClick={() => run(() => actions.refer_alert(alert.id, { reason }), 'actions.done.referred', () => { setReason(''); setView('main'); })}
          >
            {t('actions.send')}
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => { setFeedback(null); setView('main'); }}>
            {t('actions.back')}
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={close} title={t('actions.title')}>
      <div className="stack">
        {note}
        {isResolved ? <p>{t('actions.closed')}</p> : null}

        {alert.status === 'new' ? (
          <Button block loading={busy} onClick={() => run(() => actions.acknowledge_alert(alert.id), 'actions.done.acknowledged')}>
            {busy ? t('actions.acknowledging') : t('actions.acknowledge')}
          </Button>
        ) : null}

        {alert.status === 'acknowledged' && claimer ? <p className="alert-claim">{mine ? t('actions.claimedYou') : t('actions.claimed', { name: claimer.full_name })}</p> : null}
        {alert.status === 'acknowledged' && !canResolve ? <p className="card__meta">{t('actions.notYours', { name: claimer?.full_name ?? '' })}</p> : null}

        {!isResolved && alert.status === 'acknowledged' ? (
          <div className="alert-actions">
            {patient?.contact_no ? (
              <a className="btn btn--ghost" href={telHref(patient.contact_no)}>
                <Phone size={20} aria-hidden="true" />
                {t('actions.call', { name: patient.full_name })}
              </a>
            ) : null}
            <Button variant="ghost" onClick={() => { close(); navigate(chatPath); }}>
              <MessageCircle size={20} aria-hidden="true" />
              {t('actions.chat')}
            </Button>
            {viewer.role === 'barangay' ? (
              alert.referred_at ? (
                <p className="card__meta">{t('actions.referred', { name: referrer?.full_name ?? '' })}</p>
              ) : (
                <Button variant="ghost" disabled={!canRefer} onClick={() => { setFeedback(null); setView('refer'); }}>
                  {t('actions.refer')}
                </Button>
              )
            ) : null}
          </div>
        ) : null}

        {canResolve ? (
          <Button block onClick={() => { setFeedback(null); setView('resolve'); }}>
            {t('actions.resolve')}
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
