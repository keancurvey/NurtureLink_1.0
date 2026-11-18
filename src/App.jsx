import { HashRouter } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast.jsx';
import PresenterGear from './components/presenter/PresenterGear.jsx';
import { PresenterRegistryProvider } from './components/presenter/presenterRegistry.jsx';
import ScenarioToasts from './components/presenter/ScenarioToasts.jsx';
import { StoreProvider } from './store/StoreProvider.jsx';
import { AccountLanguage } from './features/auth/Guards.jsx';
import AppRoutes from './routes.jsx';

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <ToastProvider>
          <PresenterRegistryProvider>
            <AccountLanguage />
            <AppRoutes />
            <PresenterGear />
            <ScenarioToasts /> {/* TEMP: confirms each triggered scenario until the real screens show the effects (Prompt 5) */}
          </PresenterRegistryProvider>
        </ToastProvider>
      </HashRouter>
    </StoreProvider>
  );
}
