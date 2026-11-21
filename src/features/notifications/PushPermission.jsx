import { useTranslation } from 'react-i18next';
import PushExplain from '../../components/alerts/PushExplain.jsx';
import { useActions } from '../../store/hooks.js';
import AuthLayout from '../auth/AuthLayout.jsx';

/**
 * COM-04: the screen a new account sees once, after the terms (and the guardian's consent), before the app opens. Either
 * answer carries on: the route guard sends her on as soon as the choice is saved.
 */
export default function PushPermission() {
  const { t } = useTranslation('alerts');
  const actions = useActions();
  return (
    <AuthLayout title={t('push.title')}>
      <PushExplain onAllow={() => actions.allow_push()} onLater={() => actions.decline_push()} />
    </AuthLayout>
  );
}
