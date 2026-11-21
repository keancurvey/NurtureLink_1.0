import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { notificationText } from '../../features/alerts/text.js';
import { alertSignals } from '../../lib/alertSignals.js';
import { BANNER_MS, RESUME_MS, describeNotification, isAlertClass, signalKind, stackBanners } from '../../lib/notifications.js';
import { useActions, useRuntime, useStoreValue } from '../../store/hooks.js';
import { notificationContext, viewerOf } from '../../store/selectors.js';
import { STATUS_ICONS } from '../ui/statusIcons.js';

/**
 * Push-style banners (ALR-03): they slide in from the top when a notification reaches the signed-in account, stack,
 * fold into one group when there are many, dismiss themselves, and open the related screen when tapped. An alert also
 * makes a short sound and vibrates where the phone supports it. What arrived while nobody was signed in is not replayed:
 * the bell holds the count. While the connection is off, what the server sends waits and is shown on reconnection; a
 * notice the phone made itself (ALR-02) shows at once.
 */
export default function PushLayer() {
  const { t } = useTranslation('alerts');
  const navigate = useNavigate();
  const actions = useActions();
  const { store } = useRuntime();
  const viewerId = useStoreValue((state) => state.session?.profile_id ?? null);
  const notifications = useStoreValue((state) => state.db.notifications);
  const online = useStoreValue((state) => state.meta.connection === 'online');
  const [banners, setBanners] = useState([]);
  const [paused, setPaused] = useState(false);
  const known = useRef({ viewerId: null, ids: new Set() });

  useEffect(() => {
    const mine = notifications.filter((n) => n.profile_id === viewerId);
    if (known.current.viewerId !== viewerId) {
      known.current = { viewerId, ids: new Set(mine.map((n) => n.id)) };
      setBanners([]);
      return;
    }
    if (!viewerId) return;
    const arrived = mine.filter((n) => !known.current.ids.has(n.id) && !n.read_at && (online || n.payload?.local === true));
    if (arrived.length === 0) return;
    const state = store.getState();
    const viewer = viewerOf(state);
    const at = Date.now();
    const fresh = arrived.map((n) => {
      known.current.ids.add(n.id);
      const view = describeNotification(n, notificationContext(state, viewer, n));
      return { id: n.id, view, kind: signalKind(n), expiresAt: at + (isAlertClass(n) ? BANNER_MS.alert : BANNER_MS.other) };
    });
    const kinds = fresh.map((b) => b.kind).filter(Boolean);
    if (kinds.length) alertSignals.play(kinds.includes('sos') ? 'sos' : 'alert');
    setBanners((current) => stackBanners([...fresh.reverse(), ...current]));
  }, [notifications, viewerId, online, store]);

  // Banners dismiss themselves, except while the person is reading or pointing at them.
  useEffect(() => {
    if (banners.length === 0 || paused) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setBanners((current) => (current.some((b) => b.expiresAt <= now) ? current.filter((b) => b.expiresAt > now) : current));
    }, 500);
    return () => window.clearInterval(timer);
  }, [banners.length, paused]);

  const texts = useMemo(() => banners.map((b) => (b.group ? null : notificationText(t, b.view))), [banners, t]);

  if (banners.length === 0) return null;

  // After being read or pointed at, a banner stays a moment longer before it goes.
  function resume() {
    setPaused(false);
    const until = Date.now() + RESUME_MS;
    setBanners((current) => current.map((b) => ({ ...b, expiresAt: Math.max(b.expiresAt, until) })));
  }
  const dismiss = (id) => setBanners((current) => current.filter((b) => b.id !== id));
  function open(banner) {
    if (banner.group) navigate('/notifications');
    else {
      actions.mark_read(banner.id);
      navigate(banner.view.path);
    }
    dismiss(banner.id);
  }

  return (
    <div
      className="push-layer"
      role="region"
      aria-label={t('banner.region')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={resume}
      onFocus={() => setPaused(true)}
      onBlur={resume}
    >
      {banners.map((banner, index) => {
        const tone = banner.group ? 'info' : banner.view.tone;
        const Icon = tone === 'alert' ? STATUS_ICONS.alert : tone === 'attention' ? STATUS_ICONS.attention : Bell;
        const text = banner.group ? { title: t('banner.group', { count: banner.count }), body: t('banner.groupBody') } : texts[index];
        return (
          <div className={`push push--${tone}`} key={banner.id} role={tone === 'alert' ? 'alert' : 'status'}>
            <button type="button" className="push__open" onClick={() => open(banner)}>
              <Icon className="push__icon" size={24} aria-hidden="true" />
              <span className="push__text">
                <span className="push__title">{text.title}</span>
                {text.body ? <span className="push__body">{text.body}</span> : null}
              </span>
            </button>
            <button type="button" className="icon-btn push__close" onClick={() => dismiss(banner.id)} aria-label={t('banner.dismiss')}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
