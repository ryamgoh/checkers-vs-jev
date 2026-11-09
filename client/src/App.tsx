import { useEffect } from 'react';
import { Board3D } from './scene/Board3D.tsx';
import { Overlays } from './ui/Overlays.tsx';
import { Panel } from './ui/Panel.tsx';
import { useGame } from './game/store.ts';

export function App() {
  useEffect(() => {
    void useGame.getState().init();
  }, []);
  return (
    <div className="app">
      <main className="stage">
        <Board3D />
        <Overlays />
      </main>
      <Panel />
    </div>
  );
}
