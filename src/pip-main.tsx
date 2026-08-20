import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { PipWindow } from './pomodoro/PipWindow';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PipWindow />
  </StrictMode>,
);
