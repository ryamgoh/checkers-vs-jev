import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { useGame } from './game/store.ts';
import './styles.css';

(window as unknown as { __cvjStore?: typeof useGame }).__cvjStore = useGame;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
