import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/home.css';
import './styles/alerts.css';
import './styles/schedule.css';
import './styles/consult.css';
import './styles/monitor.css';
import './styles/presenter.css';
import './i18n/index.js';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
