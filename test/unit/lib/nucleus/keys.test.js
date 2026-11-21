import b4a from 'b4a';
import DHT from 'hyperdht';
import {
    contextLabel,
    deriveKey,
    deriveKeyPair,
    openSeal,
    parseSeed,
    seal,
    signDetached,
    verifyDetached
} from '../../../../src/lib/nucleus/keys.js';

const seed = b4a.alloc(32, 7);
const hex = (buffer) => b4a.toString(buffer, 'hex');

describe('keys', () => {
    describe('parseSeed', () => {
        it('accepts 32 bytes and 64 hex characters', () => {
            expect(hex(parseSeed(seed))).toBe('07'.repeat(32));
            expect(hex(parseSeed('07'.repeat(32)))).toBe('07'.repeat(32));
        });

        it.each([['short hex', 'abcd'], ['non-hex', 'z'.repeat(64)], ['short bytes', b4a.alloc(31)], ['number', 7]])(
            'rejects %s',
            (_name, value) => {
                expect(() => parseSeed(value)).toThrow('Invalid root seed');
            }
        );
    });

    describe('derivation', () => {
        it('uses the spec labels', () => {
            for (const purpose of ['sign', 'box', 'swarm', 'store', 'salt']) {
                expect(contextLabel(purpose)).toBe(`celluler/${purpose}/v1`);
            }
            expect(contextLabel('sign', 2)).toBe('celluler/sign/v2');
        });

        it('rejects unknown purposes and bad versions', () => {
            expect(() => contextLabel('nope')).toThrow('Unknown key purpose');
            expect(() => contextLabel('sign', 0)).toThrow('Invalid key context version');
            expect(() => deriveKeyPair(seed, 'store')).toThrow('Purpose has no key pair');
        });

        it('pins the derivation with known-answer vectors', () => {
            expect(hex(deriveKey(seed, 'sign'))).toMatchSnapshot();
            expect(hex(deriveKey(seed, 'box'))).toMatchSnapshot();
            expect(hex(deriveKey(seed, 'swarm'))).toMatchSnapshot();
            expect(hex(deriveKey(seed, 'store'))).toMatchSnapshot();
            expect(hex(deriveKey(seed, 'salt'))).toMatchSnapshot();
        });

        it('gives every purpose and version a distinct key', () => {
            const keys = ['sign', 'box', 'swarm', 'store', 'salt'].map((p) => hex(deriveKey(seed, p)));
            keys.push(hex(deriveKey(seed, 'sign', 2)));
            expect(new Set(keys).size).toBe(keys.length);
        });

        it('derives the swarm key pair the way DHT.keyPair does', () => {
            const expected = DHT.keyPair(deriveKey(seed, 'swarm'));
            expect(hex(deriveKeyPair(seed, 'swarm').publicKey)).toBe(hex(expected.publicKey));
        });
    });

    describe('signatures', () => {
        const { publicKey, secretKey } = deriveKeyPair(seed, 'sign');
        const message = b4a.from('hello');

        it('verifies a valid signature', () => {
            expect(verifyDetached(message, signDetached(message, secretKey), publicKey)).toBe(true);
        });

        it('rejects a different message or key', () => {
            const signature = signDetached(message, secretKey);
            expect(verifyDetached(b4a.from('other'), signature, publicKey)).toBe(false);
            expect(verifyDetached(message, signature, deriveKeyPair(seed, 'sign', 2).publicKey)).toBe(false);
        });

        it('returns false for malformed input', () => {
            expect(verifyDetached(message, b4a.alloc(3), publicKey)).toBe(false);
            expect(verifyDetached(message, 'nope', publicKey)).toBe(false);
            expect(verifyDetached(message, b4a.alloc(64), b4a.alloc(3))).toBe(false);
        });
    });

    describe('sealed boxes', () => {
        const keyPair = deriveKeyPair(seed, 'box');
        const message = b4a.from('secret');

        it('round-trips', () => {
            expect(b4a.toString(openSeal(seal(message, keyPair.publicKey), keyPair))).toBe('secret');
        });

        it('returns null for the wrong key, tampering, or short input', () => {
            const box = seal(message, keyPair.publicKey);
            expect(openSeal(box, deriveKeyPair(seed, 'box', 2))).toBeNull();
            const tampered = b4a.from(box);
            tampered[0] ^= 1;
            expect(openSeal(tampered, keyPair)).toBeNull();
            expect(openSeal(b4a.alloc(3), keyPair)).toBeNull();
        });

        it('rejects an invalid recipient key', () => {
            expect(() => seal(message, b4a.alloc(3))).toThrow('Invalid encryption public key');
        });
    });
});
