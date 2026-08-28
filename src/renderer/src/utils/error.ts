/**
 * Map an IPC error to a clean, user-displayable message. `ipcRenderer.invoke`
 * wraps handler errors as "Error invoking remote method 'x': Error: <msg>".
 */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = /^Error invoking remote method '[^']+': Error: ([\s\S]*)$/.exec(
    raw,
  );
  return (match ? match[1] : raw).trim();
}
