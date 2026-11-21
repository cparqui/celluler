// Replays journal blocks into verified state. Pure: no I/O, no service state.
//
// Rules enforced for every block:
//   - canonical encoding; `prev` equals the hash of the previous event
//   - block 0 is exactly one nucleus/genesis record, with no parents or commits
//   - nucleus/genesis appears nowhere else; an otherParent never names this cell
//   - key.add needs no active key for its purpose, a higher context version, and a
//     public key never attested before; key.revoke must name an active key
import b4a from "b4a";
import { ATTESTED_PURPOSES } from "./keys.js";
import {
  PROTOCOL,
  RECORD_TYPES,
  decodeBody,
  decodeEvent,
  hashEvent,
} from "./events.js";

export class JournalError extends Error {
  constructor(message, index = null) {
    super(index === null ? message : `Journal event ${index}: ${message}`);
    this.name = "JournalError";
    this.index = index;
  }
}

export function createJournalState(cell) {
  return {
    cell,
    length: 0,
    head: null,
    lastTs: 0,
    publicRecords: 0,
    keys: Object.fromEntries(
      ATTESTED_PURPOSES.map((purpose) => [purpose, null]),
    ),
    highestVersion: Object.fromEntries(
      ATTESTED_PURPOSES.map((purpose) => [purpose, 0]),
    ),
    usedKeys: new Set(),
  };
}

/** A copy that can be advanced without affecting the original. */
export function cloneJournalState(state) {
  return {
    ...state,
    keys: { ...state.keys },
    highestVersion: { ...state.highestVersion },
    usedKeys: new Set(state.usedKeys),
  };
}

function checkParents(state, event, index) {
  if (index === 0) {
    if (event.prev || event.otherParent || event.commits) {
      throw new JournalError("genesis must have no parents or commits", index);
    }
    if (
      event.public.length !== 1 ||
      event.public[0].type !== RECORD_TYPES.GENESIS
    ) {
      throw new JournalError(
        "block 0 must be exactly one nucleus/genesis record",
        index,
      );
    }
    return;
  }
  if (!event.prev || !b4a.equals(event.prev, state.head)) {
    throw new JournalError(
      "prev does not match the previous event hash",
      index,
    );
  }
  if (event.otherParent && b4a.equals(event.otherParent.cell, state.cell)) {
    throw new JournalError("otherParent must reference another cell", index);
  }
}

function applyKeyAdd(state, body, index) {
  const { purpose, publicKey, contextVersion } = body;
  if (!ATTESTED_PURPOSES.includes(purpose))
    throw new JournalError(`unknown key purpose: ${purpose}`, index);
  if (state.keys[purpose])
    throw new JournalError(`${purpose} already has an active key`, index);
  if (contextVersion <= state.highestVersion[purpose]) {
    throw new JournalError(`${purpose} context version must increase`, index);
  }
  const hex = b4a.toString(publicKey, "hex");
  if (state.usedKeys.has(hex))
    throw new JournalError("public key was already attested", index);
  state.usedKeys.add(hex);
  state.highestVersion[purpose] = contextVersion;
  state.keys[purpose] = {
    purpose,
    publicKey,
    contextVersion,
    attestedAt: index,
  };
}

function applyKeyRevoke(state, body, index) {
  const active = ATTESTED_PURPOSES.find(
    (p) => state.keys[p] && b4a.equals(state.keys[p].publicKey, body.publicKey),
  );
  if (!active)
    throw new JournalError("key.revoke names a key that is not active", index);
  state.keys[active] = null;
}

function applyRecord(state, record, index) {
  let body;
  try {
    body = decodeBody(record.type, record.body);
  } catch (err) {
    throw new JournalError(err.message, index);
  }
  if (record.type === RECORD_TYPES.GENESIS) {
    if (index !== 0)
      throw new JournalError("nucleus/genesis is only valid in block 0", index);
    if (body.protocol !== PROTOCOL)
      throw new JournalError(`unsupported protocol: ${body.protocol}`, index);
  } else if (record.type === RECORD_TYPES.KEY_ADD) {
    applyKeyAdd(state, body, index);
  } else if (record.type === RECORD_TYPES.KEY_REVOKE) {
    applyKeyRevoke(state, body, index);
  }
}

/** Applies the next block to `state`, or throws JournalError. Returns `{ event, hash }`. */
export function applyBlock(state, block) {
  const index = state.length;
  let event;
  try {
    event = decodeEvent(block);
  } catch (err) {
    throw new JournalError(err.message, index);
  }
  checkParents(state, event, index);
  for (const record of event.public) applyRecord(state, record, index);

  const hash = hashEvent(state.cell, index, block);
  state.length = index + 1;
  state.head = hash;
  state.lastTs = event.ts;
  state.publicRecords += event.public.length;
  return { event, hash };
}

export function replayJournal(cell, blocks) {
  const state = createJournalState(cell);
  for (const block of blocks) applyBlock(state, block);
  return state;
}
