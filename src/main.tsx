import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import { attachBookkeepingApi } from './mobile/bridge/bookkeeping-api';
import './renderer/styles/globals.css';

async function bootstrap() {
  await attachBookkeepingApi();
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
