import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { NoteWindow } from './notes/NoteWindow';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NoteWindow />
  </StrictMode>,
);
