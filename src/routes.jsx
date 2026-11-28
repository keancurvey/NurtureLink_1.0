import { Navigate, Route, Routes } from 'react-router-dom';
import Splash from './components/layout/Splash.jsx';
import TempPage from './components/layout/TempPage.jsx';
import { NAV } from './components/layout/navItems.js';
import ChangePassword from './features/auth/ChangePassword.jsx';
import Consent from './features/auth/Consent.jsx';
import ForgotPassword from './features/auth/ForgotPassword.jsx';
import GuardianConsent from './features/auth/GuardianConsent.jsx';
import { RoleRoute, SignedInRoute, SignedOutOnly, StepRoute } from './features/auth/Guards.jsx';
import SignIn from './features/auth/SignIn.jsx';
import SignUp from './features/auth/SignUp.jsx';
import AlertDetail from './features/alerts/AlertDetail.jsx';
import PairingWizard from './features/devices/PairingWizard.jsx';
import CheckScreen from './features/home/CheckScreen.jsx';
import Home from './features/home/Home.jsx';
import NotificationCenter from './features/notifications/NotificationCenter.jsx';
import PushPermission from './features/notifications/PushPermission.jsx';
import BookingForm from './features/consult/BookingForm.jsx';
import CallScreen from './features/consult/CallScreen.jsx';
import ChatScreen from './features/consult/ChatScreen.jsx';
import Consult from './features/consult/Consult.jsx';
import BarangayCalendar from './features/calendar/BarangayCalendar.jsx';
import EventForm from './features/calendar/EventForm.jsx';
import BarangayChat from './features/chat/BarangayChat.jsx';
import BarangayChatList from './features/chat/BarangayChatList.jsx';
import Monitor from './features/monitor/Monitor.jsx';
import PatientDetail from './features/monitor/PatientDetail.jsx';
import VisitNoteForm from './features/monitor/VisitNoteForm.jsx';
import BarangayProfile from './features/profile/BarangayProfile.jsx';
import Profile from './features/profile/Profile.jsx';
import Schedule from './features/schedule/Schedule.jsx';
import OfficeConsult from './features/consult/OfficeConsult.jsx';
import OfficeChat from './features/consult/OfficeChat.jsx';
import OfficeSchedule from './features/schedule/OfficeSchedule.jsx';
import OfficeEventForm from './features/schedule/OfficeEventForm.jsx';
import PatientProfile from './features/patient/PatientProfile.jsx';
import Tracker from './features/tracker/Tracker.jsx';
import AccountForm from './features/admin/AccountForm.jsx';
import Accounts from './features/admin/Accounts.jsx';
import ActivityLogs from './features/admin/ActivityLogs.jsx';
import OfficeProfile from './features/admin/OfficeProfile.jsx';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Splash />} />
      <Route element={<SignedOutOnly />}>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route element={<StepRoute step="change-password" />}>
        <Route path="/change-password" element={<ChangePassword />} />
      </Route>
      <Route element={<StepRoute step="consent" />}>
        <Route path="/consent" element={<Consent />} />
      </Route>
      <Route element={<StepRoute step="guardian-consent" />}>
        <Route path="/guardian-consent" element={<GuardianConsent />} />
      </Route>
      <Route element={<StepRoute step="push" />}>
        <Route path="/push-permission" element={<PushPermission />} />
      </Route>
      <Route element={<SignedInRoute />}>
        <Route path="/alerts/:id" element={<AlertDetail />} />
        <Route path="/notifications" element={<NotificationCenter />} />
      </Route>
      {Object.entries(NAV).map(([role, items]) => (
        <Route key={role} path={`/${role}`} element={<RoleRoute role={role} />}>
          <Route index element={<Navigate to={items[0].path} replace />} />
          {items.map((item) => {
            if (role === 'patient' && item.path === 'home') return <Route key={item.path} path={item.path} element={<Home />} />;
            if (role === 'patient' && item.path === 'schedule') return <Route key={item.path} path={item.path} element={<Schedule />} />;
            if (role === 'patient' && item.path === 'profile') return <Route key={item.path} path={item.path} element={<Profile />} />;
            if (role === 'patient' && item.path === 'consult') return <Route key={item.path} path={item.path} element={<Consult />} />;
            if (role === 'barangay' && item.path === 'monitor') return <Route key={item.path} path={item.path} element={<Monitor />} />;
            if (role === 'barangay' && item.path === 'chat') return <Route key={item.path} path={item.path} element={<BarangayChatList />} />;
            if (role === 'barangay' && item.path === 'calendar') return <Route key={item.path} path={item.path} element={<BarangayCalendar />} />;
            if (role === 'barangay' && item.path === 'profile') return <Route key={item.path} path={item.path} element={<BarangayProfile />} />;
            if (role === 'super' && item.path === 'tracker') return <Route key={item.path} path={item.path} element={<Tracker />} />;
            if (role === 'super' && item.path === 'consult') return <Route key={item.path} path={item.path} element={<OfficeConsult />} />;
            if (role === 'super' && item.path === 'schedule') return <Route key={item.path} path={item.path} element={<OfficeSchedule />} />;
            if (role === 'super' && item.path === 'profile') return <Route key={item.path} path={item.path} element={<OfficeProfile />} />;
            return <Route key={item.path} path={item.path} element={<TempPage titleKey={`nav.${item.key}`} art={item.art} />} />;
          })}
          {role === 'patient' ? (
            <>
              <Route path="home/check" element={<CheckScreen />} />
              <Route path="pair" element={<PairingWizard />} />
              <Route path="consult/chat/:conversationId" element={<ChatScreen />} />
              <Route path="consult/book" element={<BookingForm />} />
              <Route path="consult/call/:appointmentId" element={<CallScreen />} />
            </>
          ) : null}
          {role === 'super' ? (
            <>
              <Route path="patient/:patientId" element={<PatientProfile />} />
              <Route path="consult/chat/:conversationId" element={<OfficeChat />} />
              <Route path="consult/call/:appointmentId" element={<CallScreen />} />
              <Route path="schedule/new" element={<OfficeEventForm />} />
              <Route path="profile/accounts" element={<Accounts />} />
              <Route path="profile/accounts/new" element={<AccountForm />} />
              <Route path="profile/logs" element={<ActivityLogs />} />
            </>
          ) : null}
          {role === 'barangay' ? (
            <>
              <Route path="monitor/:patientId" element={<PatientDetail />} />
              <Route path="monitor/:patientId/note" element={<VisitNoteForm />} />
              <Route path="chat/:patientId" element={<BarangayChat />} />
              <Route path="calendar/new" element={<EventForm />} />
            </>
          ) : null}
        </Route>
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
