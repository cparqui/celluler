// Replays journal blocks into verified state. Pure: no I/O, no service state.
//
// This file enforces the rules common to every block: canonical encoding, the
// `prev` chain, the shape of block 0, and otherParent never naming this cell.
// Rules for a specific record type live in its class under ./records.
import b4a from "b4a";
import { JournalError } from "./errors.js";
import { decodeEvent, hashEvent } from "./events.js";
import { ATTESTED_PURPOSES } from "./keys.js";
import { RECORD_TYPES, nucleusRecords } from "./records/index.js";

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

function applyRecord(state, record, index) {
  let instance;
  try {
    instance = nucleusRecords.create(record.type, record.body);
  } catch (err) {
    throw new JournalError(err.message, index);
  }
  if (!instance) return;
  const context = { index };
  instance.validate(state, context);
  instance.apply(state, context);
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
