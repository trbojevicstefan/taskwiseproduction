// src/types/task-board.ts
import type { Task } from './project';

// We need to represent tasks hierarchically for the UI
export interface NestedTask extends Task {
  children: NestedTask[];
}
