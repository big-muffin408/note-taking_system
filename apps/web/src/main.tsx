import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';
import { initElectronConfig } from './lib/electronConfig';
import 'katex/dist/katex.min.css';
import './styles.css';

initElectronConfig().then(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>
  );
});
