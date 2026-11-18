import { useTranslation } from 'react-i18next';
import Button from '../ui/Button.jsx';
import { useActions } from '../../store/hooks.js';
import TempPage from './TempPage.jsx';

// TEMP: the Profile screens come in Prompts 6 (patient), 8 (barangay) and 9 (super). Until then this is the one place to sign out.
export default function TempProfile(props) {
  const { t } = useTranslation();
  const actions = useActions();
  return (
    <>
      <TempPage {...props} />
      <Button block variant="ghost" onClick={() => actions.sign_out()}>
        {t('signOut')}
      </Button>
    </>
  );
}
