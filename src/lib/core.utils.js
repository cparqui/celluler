import b4a from 'b4a'
import crypto from 'node:crypto'

export function getCoreInfo(core, name = null) {
    return {
        id: core.id,
        key: b4a.toString(core.discoveryKey, 'hex'),
        length: core.length,
    }
}

export function generateCellUUID(cellName, creationTime, config) {
    // Create a deterministic string from the input parameters
    const inputString = `${cellName}:${creationTime}:${JSON.stringify(config)}`;
    
    // Generate a SHA-256 hash of the input string
    const hash = crypto.createHash('sha256').update(inputString).digest('hex');
    
    // Format as UUID v4 (though not strictly RFC 4122 compliant)
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export function generateKeyPair() {
    // Generate RSA key pair with 2048 bits
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    return { publicKey, privateKey };
}

export function encryptMessage(message, publicKey) {
    const buffer = Buffer.from(message);
    const encrypted = crypto.publicEncrypt(publicKey, buffer);
    return encrypted.toString('base64');
}

export function decryptMessage(encryptedMessage, privateKey) {
    const buffer = Buffer.from(encryptedMessage, 'base64');
    const decrypted = crypto.privateDecrypt(privateKey, buffer);
    return decrypted.toString();
}

export function signMessage(message, privateKey) {
    const signer = crypto.createSign('SHA256');
    signer.update(message);
    return signer.sign(privateKey, 'base64');
}

export function verifySignature(message, signature, publicKey) {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(message);
    return verifier.verify(publicKey, signature, 'base64');
} 