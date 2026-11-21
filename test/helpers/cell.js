import b4a from 'b4a';
import { ServiceBroker } from 'moleculer';
import NucleusService from '../../src/services/nucleus.service.js';

/** A reproducible 32-byte seed for cell number `n`. */
export function testSeed(n) {
    return b4a.alloc(32, n + 1);
}

/** A clock that advances by `step` ms per read, for reproducible events. */
export function fixedClock(start = 1_700_000_000_000, step = 1) {
    let now = start;
    return () => {
        now += step;
        return now;
    };
}

/** Starts one cell (a broker with a Nucleus) on the given testnet. */
export async function startCell(testnet, { seed = testSeed(0), storage = 'memory', name = 'test-cell', ...config } = {}) {
    const broker = new ServiceBroker({ logger: false, metrics: false, nodeID: `${name}-${process.hrtime.bigint()}` });
    const service = new NucleusService(broker, {
        name,
        config: { storage, seed, dht: { bootstrap: testnet.bootstrap }, ...config }
    });
    await broker.start();
    const cellId = await broker.call('nucleus.getCellId');
    return { broker, service, cellId, call: (action, params) => broker.call(`nucleus.${action}`, params), stop: () => broker.stop() };
}
