import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ROLES } from '../../lib/permissions.js';
import { useViewer } from '../../store/hooks.js';
import GearPanel from './GearPanel.jsx';

/**
 * The presenter gear (CLAUDE.md Section 5, point 3): a quiet button at the bottom of every screen that opens the panel
 * for the screen and the role. Its position comes from CSS variables the shell publishes (--gear-offset and the layout).
 */
export default function PresenterGear() {
  const { t } = useTranslation('presenter');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const wasOpen = useRef(false);
  const { pathname } = useLocation();
  const routeRole = ROLES.find((role) => pathname === `/${role}` || pathname.startsWith(`/${role}/`)) ?? null;
  const viewer = useViewer(routeRole);
  // The splash and the sign-in screen are signed out whatever was saved: the panel is chosen by screen and role.
  const role = routeRole ? (viewer?.role ?? null) : null;
  const close = useCallback(() => setOpen(false), []);

  // Focus returns to the gear when the panel closes (some browsers do not focus a button on click).
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="gear"
        aria-label={t('gear.label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Settings size={24} aria-hidden="true" />
      </button>
      <GearPanel open={open} onClose={close} viewer={viewer} role={role} />
    </>
  );
}
