import type { PrototypeFocusedChange, PrototypeSnapshot, PrototypeTask } from './prototype-state.js';

export function isTaskReadyForReview(task: PrototypeTask | null | undefined): boolean;

export function shouldShowCompactDetail(
  snapshot: PrototypeSnapshot | null | undefined,
  detailExpanded: boolean,
): boolean;

export function shouldAutoExpandCompactDetail(
  previousSnapshot: PrototypeSnapshot | null | undefined,
  nextSnapshot: PrototypeSnapshot | null | undefined,
  mode: 'compact' | 'expanded',
): boolean;

export function createCompactPresentationModel(
  snapshot: PrototypeSnapshot,
  options?: { detailExpanded?: boolean },
): {
  primaryTask: PrototypeTask | null;
  focusedChange: PrototypeFocusedChange | null;
  focusKind: 'task' | 'change' | null;
  presentation: 'chip' | 'detail';
  showHideAction: boolean;
  showCollapseAction: boolean;
  showBoardAction: boolean;
  isReviewReadyTask: boolean;
};
