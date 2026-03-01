import React from 'react';
import ReactDOM from 'react-dom/client';
import { initI18n } from '@lib/i18n.js';
import '@shared/animations.css';
import PopupApp from './PopupApp';

initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PopupApp />
    </React.StrictMode>
  );
});
