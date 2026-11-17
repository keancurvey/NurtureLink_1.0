import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import ProviderSession from '../../features/auth/ProviderSession.jsx';
import { isProviderRole } from '../../lib/permissions.js';
import { useGearOffset } from '../presenter/useGearOffset.js';
import TopBar from './TopBar.jsx';
import BottomTabs from './BottomTabs.jsx';
import SideNav from './SideNav.jsx';
import { NAV } from './navItems.js';

/**
 * Three layouts (COM-06): patient and barangay are a phone-width column with bottom tabs, centred on wide
 * screens; the super account has bottom tabs under 1024 px and a side navigation from 1024 px.
 */
export default function AppShell({ role }) {
  const items = NAV[role];
  const isSuper = role === 'super';
  const tabsRef = useRef(null);

  // The shell tells the gear what is anchored to the bottom (the tab bar) and which layout is showing, so the gear
  // sits above the tabs on phones and at the foot of the side navigation on the super account's desktop layout.
  useGearOffset(tabsRef);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.shell = isSuper ? 'super' : 'phone';
    return () => {
      delete root.dataset.shell;
    };
  }, [isSuper]);

  return (
    <div className={`shell ${isSuper ? 'shell--super' : 'shell--phone'}`}>
      {isSuper ? <SideNav role={role} items={items} /> : null}
      <div className="shell__column">
        <TopBar unreadCount={0 /* TEMP: real unread count in Prompt 5 */} />
        <main className="shell__main">
          <Outlet />
        </main>
        <BottomTabs ref={tabsRef} role={role} items={items} />
        {isProviderRole(role) ? <ProviderSession role={role} /> : null}
      </div>
    </div>
  );
}
