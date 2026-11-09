import { z } from 'zod';

export const SideSchema = z.enum(['red', 'ivory']);
export const PieceSchema = z.object({ side: SideSchema, king: z.boolean() }).nullable();

export const TurnSchema = z.object({
  id: z.string(),
  from: z.number().int(),
  landings: z.array(z.number().int()),
  captures: z.array(z.number().int()),
  promotes: z.boolean(),
});

export const AiMoveSchema = z.object({
  turnId: z.string(),
  source: z.enum(['jev', 'forced']),
  provenance: z.enum(['searched', 'unanalyzed', 'exact']),
  /** Whether Jev's choice scored equal to the engine's top move (null when unanalyzed or forced). */
  matchedEngineBest: z.boolean().nullable(),
  engineBest: z.string().nullable(),
  score: z.number().nullable(),
  depth: z.number().nullable(),
  confidence: z.number().nullable(),
  model: z.string().nullable(),
  ms: z.number(),
});

export const MoveRecordSchema = z.object({
  ply: z.number().int(),
  side: SideSchema,
  turn: TurnSchema,
  ai: AiMoveSchema.nullable(),
});

export const LifecycleSchema = z.enum(['ready', 'playing', 'paused', 'finished']);
export const PhaseSchema = z.enum(['human-input', 'ai-thinking', 'ai-error']);
export const AiStatusSchema = z.enum(['idle', 'analyzing', 'choosing']);

export const ResultSchema = z.object({
  winner: SideSchema.nullable(),
  reason: z.enum(['no-moves', 'repetition', 'forty-move']),
});

export const SnapshotSchema = z.object({
  gameId: z.string(),
  generation: z.number().int(),
  version: z.number().int(),
  lifecycle: LifecycleSchema,
  phase: PhaseSchema.nullable(),
  pausedPhase: PhaseSchema.nullable(),
  aiStatus: AiStatusSchema,
  aiError: z.string().nullable(),
  board: z.array(PieceSchema).length(32),
  sideToMove: SideSchema,
  /** The human's legal turns; empty unless it is the human's turn. */
  legalTurns: z.array(TurnSchema),
  moves: z.array(MoveRecordSchema),
  result: ResultSchema.nullable(),
  quietTurns: z.object({ red: z.number(), ivory: z.number() }),
  config: z.object({ model: z.string(), jevReady: z.boolean(), engine: z.string() }),
});

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('move'), turnId: z.string().min(3).max(64) }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('restart') }),
  z.object({ type: z.literal('retry-ai') }),
]);

export const CommandRequestSchema = z.object({
  commandId: z.string().min(8).max(64),
  expectedVersion: z.number().int().nonnegative(),
  command: CommandSchema,
});

export const CommandErrorSchema = z.enum([
  'stale',
  'not-ready',
  'not-playing',
  'not-paused',
  'not-your-turn',
  'illegal-move',
  'no-ai-error',
  'bad-request',
  'not-found',
  'forbidden',
]);

export const CommandResponseSchema = z.union([
  z.object({ ok: z.literal(true), snapshot: SnapshotSchema }),
  z.object({ ok: z.literal(false), error: CommandErrorSchema, message: z.string(), snapshot: SnapshotSchema.nullable() }),
]);

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type CommandError = z.infer<typeof CommandErrorSchema>;
export type CommandResponse = z.infer<typeof CommandResponseSchema>;
export type AiMove = z.infer<typeof AiMoveSchema>;
export type MoveRecord = z.infer<typeof MoveRecordSchema>;
export type Lifecycle = z.infer<typeof LifecycleSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type AiStatus = z.infer<typeof AiStatusSchema>;
