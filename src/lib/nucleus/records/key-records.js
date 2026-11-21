import b4a from "b4a";
import { JournalError } from "../errors.js";
import { ATTESTED_PURPOSES } from "../keys.js";
import { resolveStruct } from "../schema/index.js";
import { RecordBase } from "./base.js";

export class KeyAddRecord extends RecordBase {
  static type = "nucleus/key.add";
  static encoding = resolveStruct("@celluler/key-add");

  validate(state, { index }) {
    const { purpose, publicKey, contextVersion } = this.body;
    if (!ATTESTED_PURPOSES.includes(purpose)) {
      throw new JournalError(`unknown key purpose: ${purpose}`, index);
    }
    if (state.keys[purpose]) {
      throw new JournalError(`${purpose} already has an active key`, index);
    }
    if (contextVersion <= state.highestVersion[purpose]) {
      throw new JournalError(`${purpose} context version must increase`, index);
    }
    if (state.usedKeys.has(b4a.toString(publicKey, "hex"))) {
      throw new JournalError("public key was already attested", index);
    }
  }

  apply(state, { index }) {
    const { purpose, publicKey, contextVersion } = this.body;
    state.usedKeys.add(b4a.toString(publicKey, "hex"));
    state.highestVersion[purpose] = contextVersion;
    state.keys[purpose] = {
      purpose,
      publicKey,
      contextVersion,
      attestedAt: index,
    };
  }
}

export class KeyRevokeRecord extends RecordBase {
  static type = "nucleus/key.revoke";
  static encoding = resolveStruct("@celluler/key-revoke");

  static normalize(body) {
    return { publicKey: body.publicKey, reason: body.reason ?? null };
  }

  #activePurpose(state) {
    return ATTESTED_PURPOSES.find(
      (purpose) =>
        state.keys[purpose] &&
        b4a.equals(state.keys[purpose].publicKey, this.body.publicKey),
    );
  }

  validate(state, { index }) {
    if (!this.#activePurpose(state)) {
      throw new JournalError(
        "key.revoke names a key that is not active",
        index,
      );
    }
  }

  apply(state) {
    state.keys[this.#activePurpose(state)] = null;
  }
}
