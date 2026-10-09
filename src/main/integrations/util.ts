/** Small shared helpers for the integration adapters. */

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalize an unknown thrown value into a readable message. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Extract a filename (with extension) from an absolute path. */
export function fileNameFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || "file";
}
