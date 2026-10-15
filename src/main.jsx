import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './avatar.css';
import './pwa.css';
import './backend-chip.css';
import './startup-player.css';
import './settings-redesign.css';
import { registerPwa } from './pwa.js';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Production only: never cache Vite/HMR or register from the file:// download.
if (typeof __NOVA_ENABLE_PWA__ !== 'undefined' && __NOVA_ENABLE_PWA__) {
  void registerPwa();
}
