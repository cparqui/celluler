// Key derivation and cell-to-cell crypto (spec §3). Pure: no I/O, no service state.
import b4a from 'b4a';
import sodium from 'sodium-universal';

export const SEED_BYTES = 32;

/** Purposes whose public keys are attested in the journal. */
export const ATTESTED_PURPOSES = Object.freeze(['sign', 'box', 'swarm']);

const DERIVABLE_PURPOSES = new Set([...ATTESTED_PURPOSES, 'store', 'salt']);

/** Normalizes a seed given as 32 bytes or 64 hex characters. */
export function parseSeed(seed) {
    if (typeof seed === 'string') {
        if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
            throw new Error('Invalid root seed: expected 64 hex characters');
        }
        return b4a.from(seed, 'hex');
    }
    if (b4a.isBuffer(seed) && seed.byteLength === SEED_BYTES) {
        return b4a.from(seed);
    }
    throw new Error(`Invalid root seed: expected ${SEED_BYTES} bytes`);
}

/** The context label for a purpose and version, e.g. `celluler/sign/v1`. */
export function contextLabel(purpose, version = 1) {
    if (!DERIVABLE_PURPOSES.has(purpose)) {
        throw new Error(`Unknown key purpose: ${purpose}`);
    }
    if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error(`Invalid key context version: ${version}`);
    }
    return `celluler/${purpose}/v${version}`;
}

/** H(seed, label): BLAKE2b-256 of the label, keyed by the seed. */
export function deriveKey(seed, purpose, version = 1) {
    const out = b4a.alloc(sodium.crypto_generichash_BYTES);
    sodium.crypto_generichash(out, b4a.from(contextLabel(purpose, version)), seed);
    return out;
}

function ed25519KeyPair(keySeed) {
    const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
    const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.crypto_sign_seed_keypair(publicKey, secretKey, keySeed);
    return { publicKey, secretKey };
}

function x25519KeyPair(keySeed) {
    const publicKey = b4a.alloc(sodium.crypto_box_PUBLICKEYBYTES);
    const secretKey = b4a.alloc(sodium.crypto_box_SECRETKEYBYTES);
    sodium.crypto_box_seed_keypair(publicKey, secretKey, keySeed);
    return { publicKey, secretKey };
}

/** Derives the key pair for an attested purpose. The swarm pair equals `DHT.keyPair(H(seed, label))`. */
export function deriveKeyPair(seed, purpose, version = 1) {
    if (!ATTESTED_PURPOSES.includes(purpose)) {
        throw new Error(`Purpose has no key pair: ${purpose}`);
    }
    const keySeed = deriveKey(seed, purpose, version);
    return purpose === 'box' ? x25519KeyPair(keySeed) : ed25519KeyPair(keySeed);
}

export function signDetached(message, secretKey) {
    const signature = b4a.alloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(signature, message, secretKey);
    return signature;
}

/** Returns false, never throws, for malformed signatures or keys. */
export function verifyDetached(message, signature, publicKey) {
    if (!b4a.isBuffer(signature) || signature.byteLength !== sodium.crypto_sign_BYTES) return false;
    if (!b4a.isBuffer(publicKey) || publicKey.byteLength !== sodium.crypto_sign_PUBLICKEYBYTES) return false;
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
}

/** Encrypts to an X25519 public key; the sender stays anonymous. */
export function seal(message, publicKey) {
    if (!b4a.isBuffer(publicKey) || publicKey.byteLength !== sodium.crypto_box_PUBLICKEYBYTES) {
        throw new Error('Invalid encryption public key');
    }
    const ciphertext = b4a.alloc(message.byteLength + sodium.crypto_box_SEALBYTES);
    sodium.crypto_box_seal(ciphertext, message, publicKey);
    return ciphertext;
}

/** Returns the plaintext, or null if the box cannot be opened with this key pair. */
export function openSeal(ciphertext, keyPair) {
    if (!b4a.isBuffer(ciphertext) || ciphertext.byteLength < sodium.crypto_box_SEALBYTES) return null;
    const message = b4a.alloc(ciphertext.byteLength - sodium.crypto_box_SEALBYTES);
    return sodium.crypto_box_seal_open(message, ciphertext, keyPair.publicKey, keyPair.secretKey) ? message : null;
}
