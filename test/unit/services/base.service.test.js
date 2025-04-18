import { ServiceBroker, Service } from "moleculer";
import BaseService from "../../../src/services/base.service.js";

describe("Test 'base' service", () => {
    let broker = new ServiceBroker({ logger: false });
    let service;

    beforeAll(async () => {
        console.log('Test: beforeAll starting');
        service = new BaseService(broker);
        await broker.start();
        console.log('Test: beforeAll complete');
    });

    afterAll(async () => {
        console.log('Test: afterAll starting');
        if (broker) {
            console.log('Test: stopping broker');
            await broker.stop();
            console.log('Test: broker stopped');
        }
        console.log('Test: afterAll complete');
    });

    describe("Test constructor", () => {
        it("should initialize with default configuration", () => {
            expect(service.cellConfig).toBeDefined();
            expect(service.cellConfig.storage).toBe('file');
            expect(service.cellConfig.path).toBe('./data');
            expect(service.cellConfig.encryption).toBe(true);
            expect(service.cellConfig.persistence).toBe(true);
            expect(service.cellConfig.replication).toBe(true);
        });

        it("should accept custom configuration", () => {
            const customConfig = {
                storage: 'memory',
                path: './custom',
                encryption: false,
                persistence: false,
                replication: false
            };
            const customService = new BaseService(broker, customConfig);
            expect(customService.cellConfig).toEqual(customConfig);
        });
    });

    describe("Test service inheritance", () => {
        it("should be an instance of Moleculer Service", () => {
            expect(service).toBeInstanceOf(Service);
        });

        it("should have access to broker instance", () => {
            expect(service.broker).toBeDefined();
            expect(service.broker).toBe(broker);
        });
    });
}); 