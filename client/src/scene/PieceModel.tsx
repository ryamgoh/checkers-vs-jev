import * as THREE from 'three';
import { forwardRef } from 'react';
import type { Side } from '../../../shared/rules/types.ts';

export const PIECE_HEIGHT = 0.15;

// Profile of a turned checker: beveled rim with a shallow groove on top.
const PROFILE = [
  [0, 0], [0.37, 0], [0.4, 0.012], [0.415, 0.04], [0.415, 0.105], [0.405, 0.132], [0.385, 0.148],
  [0.33, 0.15], [0.31, 0.142], [0.29, 0.15], [0.12, 0.15], [0.105, 0.143], [0.09, 0.15], [0, 0.15],
].map(([x, y]) => new THREE.Vector2(x, y));

const pieceGeometry = new THREE.LatheGeometry(PROFILE, 56);
pieceGeometry.computeVertexNormals();

const crownRing = new THREE.TorusGeometry(0.17, 0.028, 12, 40);
const crownSpike = new THREE.ConeGeometry(0.034, 0.1, 10);

const materials: Record<Side, THREE.MeshPhysicalMaterial> = {
  red: new THREE.MeshPhysicalMaterial({ color: '#a3242b', roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.35 }),
  ivory: new THREE.MeshPhysicalMaterial({ color: '#eee3cb', roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
};
const gold = new THREE.MeshStandardMaterial({ color: '#d6a643', metalness: 0.85, roughness: 0.28 });

interface PieceProps {
  side: Side;
  king: boolean;
  onPointerDown?: (e: { stopPropagation: () => void }) => void;
}

/** A man, or a king (two stacked pieces with a raised gold crown). */
export const PieceModel = forwardRef<THREE.Group, PieceProps>(function PieceModel({ side, king, onPointerDown }, ref) {
  return (
    <group ref={ref} onPointerDown={onPointerDown}>
      <mesh geometry={pieceGeometry} material={materials[side]} castShadow receiveShadow />
      {king && (
        <group>
          <mesh geometry={pieceGeometry} material={materials[side]} position={[0, PIECE_HEIGHT, 0]} castShadow receiveShadow />
          <mesh geometry={crownRing} material={gold} position={[0, PIECE_HEIGHT * 2 + 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow />
          {[0, 1, 2, 3, 4].map((k) => {
            const a = (k / 5) * Math.PI * 2;
            return (
              <mesh
                key={k}
                geometry={crownSpike}
                material={gold}
                position={[Math.cos(a) * 0.17, PIECE_HEIGHT * 2 + 0.075, Math.sin(a) * 0.17]}
                castShadow
              />
            );
          })}
        </group>
      )}
    </group>
  );
});
