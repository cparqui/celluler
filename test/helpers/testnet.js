import createTestnet from 'hyperdht/testnet';

/** Starts an in-process DHT. Callers must `await testnet.destroy()` when done. */
export async function createTestDht(size = 3) {
    return createTestnet(size);
}
