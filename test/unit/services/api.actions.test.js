import { ServiceBroker } from 'moleculer';
import ApiService from '../../../src/services/api.service.js';
import NucleusService from '../../../src/services/nucleus.service.js';
import { testSeed } from '../../helpers/cell.js';
import { createTestDht } from '../../helpers/testnet.js';

describe('ApiService actions', () => {
    let testnet;
    let broker;
    let api;

    beforeAll(async () => {
        testnet = await createTestDht();
        broker = new ServiceBroker({ logger: false, metrics: false, nodeID: 'api-actions', registry: { stopDelay: 0 } });
        new NucleusService(broker, {
            config: { storage: 'memory', seed: testSeed(40), dht: { bootstrap: testnet.bootstrap } }
        });
        api = new ApiService(broker, { port: 0, ip: '127.0.0.1' });
        await broker.start();
    });

    afterAll(async () => {
        await broker.stop();
        await testnet.destroy();
    });

    afterEach(() => jest.restoreAllMocks());

    it('reports degraded health while the message service is absent', async () => {
        const health = await broker.call('v1.api.health');
        expect(health.status).toBe('degraded');
        expect(health.services).toEqual({ nucleus: 'healthy', message: 'unavailable' });
    });

    it('reports healthy when every dependency answers', async () => {
        jest.spyOn(api.broker, 'call').mockResolvedValue({ status: 'healthy' });
        expect((await api.health({})).status).toBe('healthy');
    });

    it('reports unhealthy when the health check itself fails', async () => {
        jest.spyOn(api.broker, 'call').mockImplementation(() => {
            throw new Error('broken');
        });
        expect(await api.health({})).toMatchObject({ status: 'unhealthy', error: 'broken' });
    });

    it('returns node status', async () => {
        const status = await broker.call('v1.api.status');
        expect(status.node.id).toBe('api-actions');
        expect(status.services.length).toBeGreaterThan(0);
    });

    it('propagates status failures', async () => {
        jest.spyOn(api.broker, 'call').mockRejectedValue(new Error('no registry'));
        await expect(api.status({})).rejects.toThrow('no registry');
    });

    it('includes the cell ID from nucleus.started in its info', async () => {
        const cellId = await broker.call('nucleus.getCellId');
        await api.onNucleusStarted({ params: { cellId } });
        expect((await broker.call('v1.api.info')).cellId).toBe(cellId);
        await api.onNucleusStopped({ params: { cellId } });
        expect((await broker.call('v1.api.info')).cellId).toBeNull();
        await api.onNucleusStarted({});
        expect(api.cellId).toBeNull();
    });

    it('lists endpoints', async () => {
        const { routes, publicEndpoints } = await broker.call('v1.api.endpoints');
        expect(routes.map((r) => r.path)).toEqual(['/api/v1', '/api/public']);
        expect(routes[0]).toMatchObject({ authentication: true, rateLimit: true });
        expect(routes[1]).toMatchObject({ authentication: false, rateLimit: false });
        expect(publicEndpoints.length).toBeGreaterThan(0);
    });

    it('handles routes without body parsers', async () => {
        const custom = Object.create(api);
        custom.settings = { routes: [{ path: '/x', whitelist: [] }] };
        const { routes } = await api.endpoints.call(custom, {});
        expect(routes[0].bodyParsers).toEqual([]);
    });

    describe('authenticate', () => {
        const route = { authentication: true };
        const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
        const authenticate = (authentication, headers, useRoute = route) =>
            api.settings.authenticate.call({ settings: { authentication } }, {}, useRoute, { headers }, {});
        const enabled = { enabled: true, type: 'basic', credentials: { username: 'u', password: 'p' } };

        it('passes when disabled or on a public route', async () => {
            await expect(authenticate({ enabled: false }, {})).resolves.toBeDefined();
            await expect(authenticate(enabled, {}, { authentication: false })).resolves.toBeDefined();
        });

        it('accepts valid credentials', async () => {
            const ctx = { meta: {} };
            await api.settings.authenticate.call(
                { settings: { authentication: enabled } },
                ctx,
                route,
                { headers: { authorization: basic('u', 'p') } },
                {}
            );
            expect(ctx.meta.user).toEqual({ username: 'u' });
        });

        it('rejects missing, wrong-scheme and invalid credentials', async () => {
            await expect(authenticate(enabled, {})).rejects.toThrow('Authorization header required');
            await expect(authenticate(enabled, { authorization: 'Bearer x' })).rejects.toThrow('Basic authentication required');
            await expect(authenticate(enabled, { authorization: basic('u', 'bad') })).rejects.toThrow('Invalid credentials');
            await expect(authenticate({ ...enabled, type: 'bearer' }, { authorization: 'Bearer x' }))
                .rejects.toThrow('Invalid credentials');
        });
    });
});
