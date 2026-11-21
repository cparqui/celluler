import Hyperswarm from 'hyperswarm';
import { createTestDht } from '../../helpers/testnet.js';

describe('offline test guard', () => {
    it('refuses a swarm with no bootstrap (the public DHT default)', () => {
        expect(() => new Hyperswarm()).toThrow('Offline test guard');
    });

    it('refuses a non-loopback bootstrap', () => {
        expect(() => new Hyperswarm({ bootstrap: [{ host: '88.99.3.86', port: 49737 }] }))
            .toThrow('Offline test guard');
        expect(() => new Hyperswarm({ bootstrap: ['node1.hyperdht.org:49737'] }))
            .toThrow('Offline test guard');
    });

    it('allows a swarm on the in-process testnet', async () => {
        const testnet = await createTestDht();
        const swarm = new Hyperswarm({ bootstrap: testnet.bootstrap });
        await swarm.destroy();
        await testnet.destroy();
    });
});
