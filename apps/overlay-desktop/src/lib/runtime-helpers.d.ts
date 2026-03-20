import type { PrototypeSnapshot } from './prototype-state.js';

export function getBrowserFallbackSnapshot(workspacePath?: string): PrototypeSnapshot;
export function isTauriWindowAvailable(getWindow: () => unknown): boolean;
