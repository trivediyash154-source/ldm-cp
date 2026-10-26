import '@fontsource/instrument-serif/400.css';
import '@fontsource-variable/manrope/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './styles/tokens.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './app/context';
import { createServices } from './app/services';

// Created once, outside React, so StrictMode double-rendering cannot open a
// second serial session or a second simulation loop.
const services = createServices();
window.addEventListener('pagehide', () => services.dispose());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider services={services}>
      <App />
    </AppProvider>
  </StrictMode>,
);
