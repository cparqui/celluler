// Opens the Corestore that holds the cell's root seed (spec §3.1).
//
// The root seed IS Corestore's primary key: Corestore generates it from the OS
// CSPRNG on first use and persists it, so there is no second secret file.
// Corestore 7 is RocksDB-only, so `memory` storage is a temp directory that is
// deleted on close.
import Corestore from "corestore";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSeed } from "./keys.js";

async function resolveDirectory({ storage, path: storagePath }) {
  if (storage === "file") {
    if (!storagePath)
      throw new Error("Path must be specified when using file storage");
    return { directory: storagePath, ephemeral: false };
  }
  if (storage === "memory") {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "celluler-"));
    return { directory, ephemeral: true };
  }
  throw new Error(`Invalid storage type: ${storage}`);
}

/**
 * @returns {{ store, seed: Buffer, ephemeralDirectory: string | null }}
 * @throws if an injected seed differs from the one already in this storage.
 */
export async function openCellStore({ storage, path: storagePath, seed }) {
  const primaryKey =
    seed === undefined || seed === null ? null : parseSeed(seed);
  const { directory, ephemeral } = await resolveDirectory({
    storage,
    path: storagePath,
  });
  const ephemeralDirectory = ephemeral ? directory : null;

  let store = null;
  try {
    store = new Corestore(
      directory,
      primaryKey ? { primaryKey, unsafe: true } : {},
    );
    await store.ready();
    return { store, seed: store.primaryKey, ephemeralDirectory };
  } catch (err) {
    if (store) await store.close().catch(() => {});
    await removeEphemeral(ephemeralDirectory);
    if (/Another corestore/.test(err.message)) {
      throw new Error(
        `The configured root seed does not match the identity stored at ${directory}`,
        { cause: err },
      );
    }
    throw err;
  }
}

export async function removeEphemeral(directory) {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
}
