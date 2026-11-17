import { Home, CalendarDays, MessagesSquare, Sparkles, User, Activity, MessageCircle, ClipboardList } from 'lucide-react';
import { TABS } from '../../lib/permissions.js';

// Icon and illustration of each tab. Which tabs a role has, and their order, is in lib/permissions.js (spec Appendix A).
// `art` picks the illustration on the TEMP screens.
const TAB_LOOK = {
  home: { icon: Home, art: 'heart' },
  schedule: { icon: CalendarDays, art: 'calendar' },
  consult: { icon: MessagesSquare, art: 'chat' },
  hele: { icon: Sparkles, art: 'hele' },
  profile: { icon: User, art: 'shield' },
  monitor: { icon: Activity, art: 'band' },
  chat: { icon: MessageCircle, art: 'chat' },
  calendar: { icon: CalendarDays, art: 'calendar' },
  tracker: { icon: ClipboardList, art: 'belt' },
};

export const NAV = Object.fromEntries(
  Object.entries(TABS).map(([role, paths]) => [role, paths.map((path) => ({ path, key: path, ...TAB_LOOK[path] }))]),
);
