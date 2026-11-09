import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MoveRecord } from '../../../shared/contracts/index.ts';
import { useGame } from '../game/store.ts';
import { movablePieces, nextTargets } from '../game/selection.ts';
import type { PieceView } from '../game/display.ts';
import { makeBoardTexture } from './boardTexture.ts';
import { pointToSquare, squareToXZ } from './coords.ts';
import { PieceModel } from './PieceModel.tsx';

const EMPTY: readonly PieceView[] = [];

function Environment() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    invalidate();
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

function CameraRig() {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const k = aspect < 1.2 ? Math.min(1.9, 1.2 / aspect) : 1;
    camera.position.set(0, 10.6 * k, 7.4 * k);
    camera.lookAt(0, 0, 0.45);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);
  return null;
}

/** Exposes square -> screen coordinates for end-to-end tests. */
function TestHooks() {
  const { camera, gl } = useThree();
  useEffect(() => {
    (window as unknown as { __cvj?: object }).__cvj = {
      squareToScreen(sq: number) {
        const [x, z] = squareToXZ(sq);
        const v = new THREE.Vector3(x, 0.08, z).project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
      },
    };
  }, [camera, gl]);
  return null;
}

function BoardSurface() {
  const texture = useMemo(() => makeBoardTexture(), []);
  const click = useGame((s) => s.clickSquare);
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const sq = pointToSquare(e.point.x, e.point.z);
    if (sq) click(sq);
  };
  return (
    <group>
      <mesh position={[0, -0.4, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#1f2023" roughness={0.95} />
      </mesh>
      {/* Frame top sits just below the surface plane (y = 0) to avoid z-fighting at long camera distances. */}
      <mesh position={[0, -0.225, 0]} castShadow receiveShadow>
        <boxGeometry args={[9.1, 0.42, 9.1]} />
        <meshStandardMaterial color="#3a2315" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow onPointerDown={onDown}>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial map={texture} roughness={0.55} />
      </mesh>
    </group>
  );
}

const markerMaterials = {
  movable: new THREE.MeshBasicMaterial({ color: '#e7b85a', transparent: true, opacity: 0.75, depthWrite: false }),
  selected: new THREE.MeshBasicMaterial({ color: '#ffd77a', transparent: true, opacity: 0.95, depthWrite: false }),
  move: new THREE.MeshBasicMaterial({ color: '#86d6ae', transparent: true, opacity: 0.9, depthWrite: false }),
  capture: new THREE.MeshBasicMaterial({ color: '#ff9f43', transparent: true, opacity: 0.95, depthWrite: false }),
  path: new THREE.MeshBasicMaterial({ color: '#ff9f43', transparent: true, opacity: 0.55, depthWrite: false }),
  last: new THREE.MeshBasicMaterial({ color: '#f2d08a', transparent: true, opacity: 0.2, depthWrite: false }),
};
const ringGeo = new THREE.RingGeometry(0.43, 0.5, 48);
const dotGeo = new THREE.CircleGeometry(0.15, 32);
const diamondGeo = new THREE.RingGeometry(0.2, 0.31, 4); // a distinct shape for captures, not only a colour
const squareGeo = new THREE.PlaneGeometry(1, 1);

function Marker({ sq, geometry, material, y = 0.012, spin = 0 }: { sq: number; geometry: THREE.BufferGeometry; material: THREE.Material; y?: number; spin?: number }) {
  const [x, z] = squareToXZ(sq);
  return <mesh geometry={geometry} material={material} position={[x, y, z]} rotation={[-Math.PI / 2, 0, spin]} renderOrder={2} />;
}

function Highlights() {
  const snapshot = useGame((s) => s.snapshot);
  const selection = useGame((s) => s.selection);
  const animating = useGame((s) => (s.display?.queue.length ?? 0) > 0);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate()); // on-demand rendering: draw a frame whenever markers change
  if (!snapshot) return null;
  const canInput = snapshot.lifecycle === 'playing' && snapshot.phase === 'human-input' && !animating;
  const last = !animating ? snapshot.moves[snapshot.moves.length - 1] : undefined;
  const turns = snapshot.legalTurns;
  const markers: ReactElement[] = [];
  if (last) {
    const dest = last.turn.landings[last.turn.landings.length - 1]!;
    markers.push(<Marker key="last-from" sq={last.turn.from} geometry={squareGeo} material={markerMaterials.last} y={0.004} />);
    markers.push(<Marker key="last-to" sq={dest} geometry={squareGeo} material={markerMaterials.last} y={0.004} />);
  }
  if (canInput && !selection) {
    for (const sq of movablePieces(turns)) markers.push(<Marker key={`m${sq}`} sq={sq} geometry={ringGeo} material={markerMaterials.movable} />);
  }
  if (canInput && selection) {
    markers.push(<Marker key="sel" sq={selection.from} geometry={ringGeo} material={markerMaterials.selected} />);
    selection.landings.forEach((sq, i) => markers.push(<Marker key={`p${i}`} sq={sq} geometry={dotGeo} material={markerMaterials.path} />));
    for (const [sq, kind] of nextTargets(turns, selection)) {
      markers.push(
        kind === 'capture' ? (
          <Marker key={`t${sq}`} sq={sq} geometry={diamondGeo} material={markerMaterials.capture} />
        ) : (
          <Marker key={`t${sq}`} sq={sq} geometry={dotGeo} material={markerMaterials.move} />
        ),
      );
    }
  }
  return <group>{markers}</group>;
}

interface Timeline {
  segments: number[];
  total: number;
}
function timelineFor(record: MoveRecord, reduced: boolean): Timeline {
  if (reduced) return { segments: record.turn.landings.map(() => 0), total: 0 };
  const per = record.turn.captures.length > 0 ? 380 : 320;
  const segments = record.turn.landings.map(() => per);
  return { segments, total: segments.reduce((a, b) => a + b, 0) + 70 };
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function Pieces() {
  const pieces = useGame((s) => s.display?.pieces ?? EMPTY);
  const current = useGame((s) => s.display?.queue[0] ?? null);
  const paused = useGame((s) => s.snapshot?.lifecycle === 'paused');
  const reduced = useGame((s) => s.reducedMotion);
  const animationDone = useGame((s) => s.animationDone);
  const click = useGame((s) => s.clickSquare);
  const invalidate = useThree((s) => s.invalidate);
  const refs = useRef(new Map<string, THREE.Group>());
  const anim = useRef<{ record: MoveRecord | null; elapsed: number; done: boolean }>({ record: null, elapsed: 0, done: false });
  // Kick the render loop when pieces, the animation queue or pause state change.
  useEffect(() => invalidate(), [pieces, current, paused, invalidate]);

  useFrame((state, delta) => {
    const a = anim.current;
    if (a.record !== current) anim.current = { record: current, elapsed: 0, done: false };
    for (const p of pieces) {
      const g = refs.current.get(p.id);
      if (!g) continue;
      const [x, z] = squareToXZ(p.square);
      g.position.set(x, 0, z);
      g.scale.setScalar(1);
    }
    if (!current) return;
    if (!paused) {
      anim.current.elapsed += Math.min(delta, 0.25) * 1000; // paused animations freeze in place
      if (!anim.current.done) state.invalidate(); // keep drawing until the move completes
    }
    const { segments, total } = timelineFor(current, reduced);
    const path = [current.turn.from, ...current.turn.landings];
    const mover = pieces.find((p) => p.square === current.turn.from);
    let t = anim.current.elapsed;
    let seg = 0;
    while (seg < segments.length - 1 && t > segments[seg]!) t -= segments[seg++]!;
    const local = segments[seg] ? Math.min(1, t / segments[seg]!) : 1;
    if (mover) {
      const g = refs.current.get(mover.id);
      const [x0, z0] = squareToXZ(path[seg]!);
      const [x1, z1] = squareToXZ(path[seg + 1]!);
      const k = ease(local);
      const lift = current.turn.captures.length > 0 ? 0.55 : 0.12;
      g?.position.set(x0 + (x1 - x0) * k, Math.sin(Math.PI * local) * lift, z0 + (z1 - z0) * k);
    }
    current.turn.captures.forEach((sq, i) => {
      const victim = pieces.find((p) => p.square === sq);
      const g = victim && refs.current.get(victim.id);
      if (!g) return;
      const f = i < seg ? 1 : i === seg ? Math.max(0, (local - 0.5) / 0.5) : 0;
      g.scale.setScalar(Math.max(0.001, 1 - f));
      g.position.y = -0.12 * f;
    });
    if (anim.current.elapsed >= total && !anim.current.done) {
      anim.current.done = true;
      animationDone();
    }
  });

  return (
    <group>
      {pieces.map((p) => (
        <PieceModel
          key={p.id}
          side={p.side}
          king={p.king}
          ref={(g) => {
            if (g) refs.current.set(p.id, g);
            else refs.current.delete(p.id);
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            click(p.square);
          }}
        />
      ))}
    </group>
  );
}

export function Board3D() {
  return (
    <Canvas
      className="board-canvas"
      shadows
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 36, near: 0.1, far: 200, position: [0, 10.6, 7.4] }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      aria-label="Checkers board"
    >
      <color attach="background" args={['#17181b']} />
      <fog attach="fog" args={['#17181b', 22, 48]} />
      <Environment />
      <CameraRig />
      <TestHooks />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[4.5, 11, 6]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
      />
      <pointLight position={[-6, 5, -4]} intensity={18} color="#ffd9a8" distance={30} />
      <BoardSurface />
      <Highlights />
      <Pieces />
    </Canvas>
  );
}
