/**
 * Shortlisted projects (Settings › Common projects): a name plus an optional
 * folder and/or an optional tag set, applied to a conversation in one click
 * from the composer's attach menu.
 */

/** Folder part of a common project (attached as a folder attachment). */
export interface CommonProjectFolder {
  /** Display name (the folder's basename or a user-facing label). */
  name: string;
  /** Absolute on-disk path, minted by main's native folder picker. */
  path: string;
}

export interface CommonProject {
  /** Stable identifier (React key / drag-and-drop key). */
  id: string;
  /** Required display name, unique across projects. */
  name: string;
  /** Optional folder attached when the project is selected. */
  folder: CommonProjectFolder | null;
  /** Optional tags written to the conversation when the project is selected. */
  tags: string[];
}
