import type { MoveRecord, Snapshot } from '../../../shared/contracts/index.ts';

export type Tone = 'you' | 'ai' | 'neutral' | 'error';

export function statusLine(s: Snapshot | null, animating: MoveRecord | null): { text: string; tone: Tone; busy: boolean } {
  if (!s) return { text: 'Connecting…', tone: 'neutral', busy: true };
  if (s.lifecycle === 'ready') return { text: 'Press Start to begin', tone: 'neutral', busy: false };
  if (s.lifecycle === 'paused') return { text: 'Game paused', tone: 'neutral', busy: false };
  if (animating?.side === 'ivory') return { text: 'Jev moving', tone: 'ai', busy: true };
  if (s.lifecycle === 'finished' && s.result) return { text: resultTitle(s), tone: 'neutral', busy: false };
  if (s.phase === 'human-input') {
    const capture = s.legalTurns.some((t) => t.captures.length > 0);
    return { text: capture ? 'Your turn — capture required' : 'Your turn', tone: 'you', busy: false };
  }
  if (s.phase === 'ai-error') return { text: 'Jev unavailable', tone: 'error', busy: false };
  if (s.aiStatus === 'analyzing') return { text: 'Jev analyzing…', tone: 'ai', busy: true };
  if (s.aiStatus === 'choosing') return { text: 'Jev choosing a move…', tone: 'ai', busy: true };
  return { text: 'Jev thinking…', tone: 'ai', busy: true };
}

export function resultTitle(s: Snapshot): string {
  if (!s.result) return '';
  if (s.result.winner === 'red') return 'You win';
  if (s.result.winner === 'ivory') return 'Jev wins';
  return 'Draw';
}

export function resultReason(s: Snapshot): string {
  if (!s.result) return '';
  switch (s.result.reason) {
    case 'no-moves':
      return s.result.winner === 'red' ? 'Jev has no legal moves left.' : 'You have no legal moves left.';
    case 'repetition':
      return 'The same position occurred for the third time.';
    case 'forty-move':
      return 'Each side made 40 moves without a capture or a man moving.';
  }
}

/** Short provenance label for an AI move in the history. */
export function aiTag(m: MoveRecord): string | null {
  if (!m.ai) return null;
  if (m.ai.source === 'forced') return 'forced';
  if (m.ai.provenance === 'unanalyzed') return 'unanalyzed';
  return m.ai.matchedEngineBest ? 'engine best' : 'lower-rated';
}
