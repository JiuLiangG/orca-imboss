/**
 * Result of a capability delete/uninstall that cascades into employee
 * references.
 *
 * MCP servers (`mcp.json`) and skills (`skills/<name>/`) live outside SQLite,
 * so removing one can only be made consistent by cleaning the references the
 * app has stored on employees (`employees.mcp` / `employees.skills`). The
 * cleanup happens in the main process, and this result carries the affected
 * employee ids back so the UI can say "unlinked from N employees" instead of
 * silently changing data the boss cannot see.
 */
export interface CapabilityUnlinkResult {
  /** True when the capability existed and was actually removed. */
  removed: boolean;
  /** Employees whose reference to the removed capability was cleaned up. */
  unlinkedEmployeeIds: number[];
}
