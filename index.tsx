import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// ADAPTER: Bridge Vite environment variables to process.env
// This allows the Google GenAI SDK to find the key as expected in browser environments like Amplify/Vite.
try {
  if (typeof window !== 'undefined') {
    // Ensure process object exists
    if (!window.process) {
      // @ts-ignore
      window.process = { env: {} };
    }
    // Copy VITE_API_KEY to process.env.API_KEY
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_KEY) {
       // @ts-ignore
       window.process.env.API_KEY = import.meta.env.VITE_API_KEY;
    }
  }
} catch (e) {
  console.warn("Environment adapter failed:", e);
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}