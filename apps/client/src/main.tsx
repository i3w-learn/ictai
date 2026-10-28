import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppProvider } from './app/app-context';
import { TauriPlatform } from './platform/tauri-platform';
import './ui/styles.css';

const platform = new TauriPlatform(__APP_VERSION__);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider platform={platform}>
      <App />
    </AppProvider>
  </StrictMode>,
);
