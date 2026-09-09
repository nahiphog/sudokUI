// Background puzzle generation. Every rated candidate is reported so the
// main thread can pool it for later (per level and per technique).
import { generatePuzzle, cleanTechniques } from './generator';
import { gridToString } from './board';
import { ratePuzzle } from './humanSolver';
import { Level, Tech } from './ratings';
import { SudokuVariant } from './board';

export interface PoolEntry {
  puzzle: string;
  score: number;
  level: Level;
  techs: Tech[];
  variant: SudokuVariant;
}

export type WorkerRequest =
  | { id: number; kind: 'level'; level: Level; variant?: SudokuVariant; maxAttempts?: number }
  | { id: number; kind: 'tech'; tech: Tech; variant?: SudokuVariant; maxAttempts?: number }
  | { id: number; kind: 'cancel' };

export type WorkerResponse =
  | { id: number; type: 'candidate'; entry: PoolEntry }
  | { id: number; type: 'progress'; attempts: number }
  | { id: number; type: 'done'; entry: PoolEntry }
  | { id: number; type: 'failed'; attempts: number };

const cancelled = new Set<number>();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === 'cancel') {
    cancelled.add(req.id);
    return;
  }
  const maxAttempts = req.maxAttempts ?? (req.kind === 'tech' ? 3000 : 400);
  const variant = req.variant ?? 'classic';
  let attempts = 0;

  const attempt = () => {
    if (cancelled.has(req.id)) {
      cancelled.delete(req.id);
      return;
    }
    // a small batch per macrotask so cancel messages get through
    for (let i = 0; i < 3 && attempts < maxAttempts; i++) {
      attempts++;
      const minClues =
        variant === 'diagonal' && req.kind === 'level'
          ? req.level === 'Beginner'
            ? 38
            : req.level === 'Nightmare'
              ? 0
              : 20 + Math.floor(Math.random() * 10)
          : 0;
      const puzzle = generatePuzzle(
        Math.random() < 0.7 ? 'rotational' : 'none',
        variant,
        minClues
      );
      const rating = ratePuzzle(puzzle);
      if (!rating || !rating.solvable) continue;
      // pool under *clean* techniques only, so practice puzzles never need
      // something harder than the target before it appears
      const entry: PoolEntry = {
        puzzle: gridToString(puzzle),
        score: rating.score,
        level: rating.level,
        techs: cleanTechniques(rating),
        variant
      };
      postMessage({ id: req.id, type: 'candidate', entry } satisfies WorkerResponse);
      const hit =
        req.kind === 'level'
          ? entry.level === req.level
          : entry.techs.includes(req.tech);
      if (hit) {
        postMessage({ id: req.id, type: 'done', entry } satisfies WorkerResponse);
        return;
      }
    }
    if (attempts >= maxAttempts) {
      postMessage({ id: req.id, type: 'failed', attempts } satisfies WorkerResponse);
      return;
    }
    if (attempts % 15 === 0) {
      postMessage({ id: req.id, type: 'progress', attempts } satisfies WorkerResponse);
    }
    setTimeout(attempt, 0);
  };
  attempt();
};
