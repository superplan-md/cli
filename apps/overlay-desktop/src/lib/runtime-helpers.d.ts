import type { PrototypeSnapshot } from './prototype-state.js';

export function getEmptyRuntimeSnapshot(workspacePath?: string): PrototypeSnapshot;
export function getBrowserFallbackSnapshot(workspacePath?: string): PrototypeSnapshot;
export function getSnapshotTaskProgress(snapshot: PrototypeSnapshot): { done: number; total: number; ratio: number };
export function hasRenderableSnapshotContent(snapshot: PrototypeSnapshot | null, nowMs?: number): boolean;
export function isTauriWindowAvailable(getWindow: () => unknown): boolean;
