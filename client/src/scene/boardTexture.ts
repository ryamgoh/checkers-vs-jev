import * as THREE from 'three';
import { squareAt } from '../../../shared/rules/geometry.ts';
import { canvasCellToRowCol } from './coords.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function grain(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, base: string, line: string, seed: number) {
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(x, y, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.strokeStyle = line;
  for (let k = 0; k < 26; k++) {
    ctx.globalAlpha = 0.05 + rand() * 0.09;
    ctx.lineWidth = 0.6 + rand() * 1.6;
    const y0 = y + rand() * size;
    ctx.beginPath();
    ctx.moveTo(x - 4, y0);
    for (let t = 0; t <= size + 8; t += 16) ctx.lineTo(x + t, y0 + Math.sin((t + seed) * 0.045) * 2.2 + (rand() - 0.5) * 1.4);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** 8x8 board surface: walnut playable squares, maple light squares, small square numbers. */
export function makeBoardTexture(): THREE.CanvasTexture {
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * 8;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const [row, col] = canvasCellToRowCol(i, j);
      const sq = squareAt(row, col);
      const x = j * cell;
      const y = i * cell;
      if (sq) grain(ctx, x, y, cell, '#5b3a25', '#2b170c', sq * 97);
      else grain(ctx, x, y, cell, '#d8b88a', '#a07a4c', (i * 8 + j) * 31 + 7);
      if (sq) {
        ctx.fillStyle = 'rgba(255, 236, 205, 0.42)';
        ctx.font = '600 22px ui-sans-serif, system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(String(sq), x + 9, y + 8);
      }
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
