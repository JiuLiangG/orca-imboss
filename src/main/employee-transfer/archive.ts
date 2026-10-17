import { createWriteStream, mkdirSync, readFileSync, statSync } from "fs";
import { writeFileSync } from "fs";
import { dirname } from "path";
import { Zip, ZipDeflate, unzipSync, type UnzipFileInfo } from "fflate";
import { t } from "@shared/l10n";
import { isPackageMember, isSafeEntryPath, resolveInside } from "./paths";

/**
 * Zip read/write for employee export packages, plus every size/entry limit.
 *
 * Writing streams through `fflate`'s `Zip` into a file stream, one member at a
 * time, so a package with a large skill folder never has to be materialised as
 * one buffer in memory.
 *
 * Reading is deliberately paranoid: a first metadata-only pass validates every
 * member name and enforces the limits *before* anything is decompressed, and
 * only the members of our layout are ever extracted.
 */

export interface ZipLimits {
  /** Biggest archive file we are willing to read (bytes). */
  maxArchiveBytes: number;
  /** Biggest member count. */
  maxEntries: number;
  /** Biggest total uncompressed size of the package (bytes). */
  maxTotalBytes: number;
  /** Biggest single member (bytes). */
  maxMemberBytes: number;
  /**
   * Reject members whose uncompressed/compressed ratio exceeds this (zip bomb)
   * once they are large enough to be meaningful.
   */
  maxCompressionRatio: number;
  /** Ratio checks only apply above this uncompressed size (bytes). */
  ratioCheckThreshold: number;
}

export const IMPORT_LIMITS: ZipLimits = {
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 5000,
  maxTotalBytes: 128 * 1024 * 1024,
  maxMemberBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 300,
  ratioCheckThreshold: 8 * 1024 * 1024,
};

/** One member carried in a package (archive-relative, `/`-separated). */
export interface ZipMemberInfo {
  name: string;
  /** Uncompressed size in bytes. */
  size: number;
}

/** One file to store in a new archive. */
export interface ZipWriteEntry {
  name: string;
  data: Uint8Array;
}

/** Result of extracting a package into a staging folder. */
export interface StagedPackage {
  members: ZipMemberInfo[];
  /** Members skipped because they are not part of the layout (macOS junk, …). */
  ignored: number;
  /** Total uncompressed bytes written. */
  bytes: number;
}

/**
 * Write `entries` to a new zip at `destination` (created/overwritten). The
 * caller is responsible for writing under a `.partial` name and renaming it
 * once complete, so an interrupted export never leaves a half-written file
 * under the user's chosen name.
 */
export async function writeZipArchive(
  destination: string,
  entries: ZipWriteEntry[],
): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true });
  await new Promise<void>((resolvePromise, reject) => {
    const out = createWriteStream(destination);
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      out.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    out.on("error", fail);

    const zip = new Zip((error, chunk, final) => {
      if (error) {
        fail(error);
        return;
      }
      if (chunk)
        out.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
      if (final) {
        out.end(() => {
          if (settled) return;
          settled = true;
          resolvePromise();
        });
      }
    });

    try {
      for (const entry of entries) {
        const file = new ZipDeflate(entry.name, { level: 6 });
        file.mtime = Date.now();
        zip.add(file);
        file.push(entry.data, true);
      }
      zip.end();
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Read an archive file into memory, refusing anything bigger than the limit.
 * A package always travels as one file; the cap keeps a hostile or accidental
 * giant archive from being slurped in.
 */
export function readArchiveFile(path: string, limits: ZipLimits): Buffer {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new Error(t("The export file could not be read."));
  }
  if (size === 0) {
    throw new Error(t("This file is not an employee export."));
  }
  if (size > limits.maxArchiveBytes) {
    throw new Error(t("The file is too large to import."));
  }
  try {
    return readFileSync(path);
  } catch {
    throw new Error(t("The export file could not be read."));
  }
}

/**
 * Validate an archive and extract the members of our layout into `stagingRoot`.
 *
 * Pass 1 (`filter` always false) inspects the central directory only: no data
 * is decompressed, so a zip bomb is stopped before it can allocate anything.
 * Pass 2 decompresses just the allow-listed members.
 */
export function stageArchive(
  archive: Buffer,
  stagingRoot: string,
  limits: ZipLimits,
): StagedPackage {
  const members: ZipMemberInfo[] = [];
  const wanted = new Set<string>();
  const seen = new Set<string>();
  let ignored = 0;
  let totalBytes = 0;
  let violation: string | null = null;

  try {
    unzipSync(archive, {
      filter: (info: UnzipFileInfo): boolean => {
        const name = info.name;
        // Directory members carry no data; the folders are created on demand.
        if (name.endsWith("/")) return false;
        if (violation !== null) return false;
        if (!isSafeEntryPath(name)) {
          violation = t(
            "The file contains an unsafe path (${path}) and was not imported.",
            { path: name },
          );
          return false;
        }
        if (seen.has(name)) {
          violation = t(
            "The file contains the same entry twice (${path}) and was not imported.",
            { path: name },
          );
          return false;
        }
        seen.add(name);
        if (!isPackageMember(name)) {
          ignored += 1;
          return false;
        }
        if (members.length + 1 > limits.maxEntries) {
          violation = t("The file contains too many entries to import.");
          return false;
        }
        if (info.originalSize > limits.maxMemberBytes) {
          violation = t(
            "The file contains a file that is too large (${path}).",
            {
              path: name,
            },
          );
          return false;
        }
        totalBytes += info.originalSize;
        if (totalBytes > limits.maxTotalBytes) {
          violation = t("The file expands to too much data to import.");
          return false;
        }
        if (
          info.originalSize > limits.ratioCheckThreshold &&
          info.size > 0 &&
          info.originalSize / info.size > limits.maxCompressionRatio
        ) {
          violation = t(
            "The file looks like a compression bomb and was not imported.",
          );
          return false;
        }
        members.push({ name, size: info.originalSize });
        wanted.add(name);
        return false;
      },
    });
  } catch (error) {
    if (violation !== null) throw new Error(violation);
    throw archiveReadError(error);
  }
  if (violation !== null) throw new Error(violation);

  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(archive, {
      filter: (info: UnzipFileInfo): boolean => wanted.has(info.name),
    });
  } catch (error) {
    throw archiveReadError(error);
  }

  mkdirSync(stagingRoot, { recursive: true });
  let bytes = 0;
  for (const [name, data] of Object.entries(extracted)) {
    const abs = resolveInside(stagingRoot, name);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    bytes += data.byteLength;
  }
  return { members, ignored, bytes };
}

/** Map a zip parser failure to a message the user can act on. */
function archiveReadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[employee-transfer] archive read failed:", message);
  return new Error(t("This file is not a readable employee export."));
}
