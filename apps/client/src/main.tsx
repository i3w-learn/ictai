import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppProvider } from './app/app-context';
import { BoardScreen } from './features/present/BoardScreen';
import { boardPlatform } from './features/present/board-platform';
import { LanguageProvider } from './i18n/i18n';
import { TauriPlatform } from './platform/tauri-platform';
import './ui/styles.css';

// The app opens its second window, the board window, on this same page with `#present` at the end.
const isBoard = location.hash === '#present';
const platform = new TauriPlatform(__APP_VERSION__, isBoard);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isBoard ? (
      <AppProvider platform={boardPlatform(platform)}>
        <LanguageProvider><BoardScreen /></LanguageProvider>
      </AppProvider>
    ) : (
      <AppProvider platform={platform}>
        <App />
      </AppProvider>
    )}
  </StrictMode>,
);
