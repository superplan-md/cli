export type CompactCopyTask = {
  description?: string;
  status?: string;
} | null;

export type CompactFallbackDescriptionOptions = {
  reviewReady?: boolean;
  secondaryLabel?: string;
};

export declare function getCompactFallbackDescription(
  task: CompactCopyTask,
  options?: CompactFallbackDescriptionOptions,
): string;
