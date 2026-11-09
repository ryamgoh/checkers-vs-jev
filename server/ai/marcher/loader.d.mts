import type { MarcherPosition } from './coords.ts';

export interface MarcherEngine {
  readonly __brand: 'MarcherEngine';
}

export function createEngine(): Promise<MarcherEngine>;
export function search(engine: MarcherEngine, pos: MarcherPosition, seconds: number): { eval: number; depth: number; nodes: number };
export function perft(engine: MarcherEngine, pos: MarcherPosition, depth: number): bigint | number;
