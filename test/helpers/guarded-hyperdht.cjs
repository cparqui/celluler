// Jest maps every `require('hyperdht')` to this module (see jest.config.cjs), so
// Hyperswarm cannot build a DHT node that would contact the public network.
// hyperdht/testnet loads the real class through a relative path and is unaffected.
const path = require('path');

const RealDHT = require(path.join(__dirname, '../../node_modules/hyperdht/index.js'));

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function hostOf(node) {
    if (typeof node === 'string') return node.slice(0, node.lastIndexOf(':'));
    return node && node.host;
}

function assertOfflineBootstrap(bootstrap) {
    const nodes = Array.isArray(bootstrap) ? bootstrap : [];
    if (nodes.length === 0 || !nodes.every((node) => LOOPBACK_HOSTS.has(hostOf(node)))) {
        throw new Error(
            'Offline test guard: a DHT node was created without the test bootstrap ' +
                `(got ${JSON.stringify(bootstrap)}). Pass dht: { bootstrap: testnet.bootstrap }.`
        );
    }
}

class GuardedDHT extends RealDHT {
    constructor(opts = {}) {
        assertOfflineBootstrap(opts.bootstrap);
        super(opts);
    }
}

module.exports = GuardedDHT;
module.exports.assertOfflineBootstrap = assertOfflineBootstrap;
