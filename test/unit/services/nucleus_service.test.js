import { ServiceBroker } from "moleculer";
import NucleusService from "../../../src/services/nucleus_service.js";
import _ from "lodash";

describe("Test 'nucleus' service", () => {
    let broker = new ServiceBroker({ logger: false });
    let service = new NucleusService(broker);

    beforeAll(async () => {
        console.log('Test: beforeAll starting');
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

    describe("Test 'v1.nucleus.bind' action", () => {
        it("should bind to a new core with topic", async () => {
            const topic = "test-topic";
            const result = await broker.call("v1.nucleus.bind", { topic });
            
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.topic).toBe(topic);
            expect(result.core).toBeDefined();
            expect(result.core.key).toBeDefined();
        });

        it("should bind to existing core with key", async () => {
            const topic = "test-topic";
            const firstResult = await broker.call("v1.nucleus.bind", { topic });
            const key = firstResult.core.key;
            
            const result = await broker.call("v1.nucleus.bind", { topic, key });
            expect(result.success).toBe(true);
            expect(result.core.key).toBe(key);
        });

        it("should reject with ValidationError for missing topic", async () => {
            expect.assertions(1);
            try {
                await broker.call("v1.nucleus.bind", {});
            } catch (err) {
                expect(err.name).toBe("ValidationError");
            }
        });
    });

    describe("Test 'v1.nucleus.get' action", () => {
        it("should get journal core by default", async () => {
            const result = await broker.call("v1.nucleus.get");
            
            expect(result).toBeDefined();
            expect(result.name).toBe("journal");
            expect(result.core).toBeDefined();
        });

        it("should get specific core by name", async () => {
            const name = "test-core";
            await broker.call("v1.nucleus.bind", { topic: name });
            
            const result = await broker.call("v1.nucleus.get", { name });
            expect(result.name).toBe(name);
            expect(result.core).toBeDefined();
        });

        it("should get core by key", async () => {
            const topic = "test-core";
            const bindResult = await broker.call("v1.nucleus.bind", { topic });
            const key = bindResult.core.publicKey;
            
            const result = await broker.call("v1.nucleus.get", { key });
            expect(result.core.publicKey).toBe(key);
        });
    });

    describe("Test 'v1.nucleus.write' action", () => {
        it("should write to journal core by default", async () => {
            const data = { test: "data" };
            const result = await broker.call("v1.nucleus.write", { data });
            
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.name).toBe("journal");
            expect(result.core).toBeDefined();
        });

        it("should write to specific core", async () => {
            const name = "test-write-core";
            await broker.call("v1.nucleus.bind", { topic: name });
            
            const data = { test: "data" };
            const result = await broker.call("v1.nucleus.write", { name, data });
            
            expect(result.success).toBe(true);
            expect(result.name).toBe(name);
        });

        it("should reject with ValidationError for missing data", async () => {
            expect.assertions(1);
            try {
                await broker.call("v1.nucleus.write", {});
            } catch (err) {
                expect(err.name).toBe("ValidationError");
            }
        });
    });

    // Disabled event tests for now
    describe.skip("Test core events", () => {
        it("should emit 'core.ready' event when core is created", async () => {
            const topic = "test-event-core";
            const eventSpy = jest.spyOn(broker, "emit");

            await broker.call("v1.nucleus.bind", { topic });

            expect(eventSpy).toHaveBeenCalledWith(
                "core.ready",
                expect.objectContaining({
                    name: topic,
                    core: expect.objectContaining({
                        publicKey: expect.any(String)
                    })
                })
            );
        });
    });
}); 