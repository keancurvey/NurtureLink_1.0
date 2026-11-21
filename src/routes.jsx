import { Navigate, Route, Routes } from 'react-router-dom';
import Splash from './components/layout/Splash.jsx';
import TempPage from './components/layout/TempPage.jsx';
import TempProfile from './components/layout/TempProfile.jsx';
import { NAV } from './components/layout/navItems.js';
import ChangePassword from './features/auth/ChangePassword.jsx';
import Consent from './features/auth/Consent.jsx';
import ForgotPassword from './features/auth/ForgotPassword.jsx';
import GuardianConsent from './features/auth/GuardianConsent.jsx';
import { RoleRoute, SignedInRoute, SignedOutOnly, StepRoute } from './features/auth/Guards.jsx';
import SignIn from './features/auth/SignIn.jsx';
import SignUp from './features/auth/SignUp.jsx';
import SosShortcut from './components/alerts/SosShortcut.jsx';
import AlertDetail from './features/alerts/AlertDetail.jsx';
import PairingWizard from './features/devices/PairingWizard.jsx';
import CheckScreen from './features/home/CheckScreen.jsx';
import Home from './features/home/Home.jsx';
import NotificationCenter from './features/notifications/NotificationCenter.jsx';
import PushPermission from './features/notifications/PushPermission.jsx';

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
            if (role === 'patient' && item.path === 'consult') {
              // TEMP (replaced in Prompt 7): the Consult tab's placeholder holds the SOS shortcut it will keep (PAT-C-06).
              return (
                <Route
                  key={item.path}
                  path={item.path}
                  element={
                    <>
                      <TempPage titleKey={`nav.${item.key}`} art={item.art} />
                      <SosShortcut />
                    </>
                  }
                />
              );
            }
            const Screen = item.path === 'profile' ? TempProfile : TempPage;
            return <Route key={item.path} path={item.path} element={<Screen titleKey={`nav.${item.key}`} art={item.art} />} />;
          })}
          {role === 'patient' ? (
            <>
              <Route path="home/check" element={<CheckScreen />} />
              <Route path="pair" element={<PairingWizard />} />
            </>
          ) : null}
        </Route>
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
