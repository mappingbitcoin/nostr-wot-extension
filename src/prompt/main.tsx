import React from 'react';
import ReactDOM from 'react-dom/client';
import { initI18n } from '@lib/i18n.js';
import PromptApp from './PromptApp';

initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PromptApp />
    </React.StrictMode>
  );
});
