import { ServiceBroker } from "moleculer";
import NucleusService from "../../../src/services/nucleus.service.js";
import _ from "lodash";
import RAM from 'random-access-memory';

describe("Test 'nucleus' service", () => {
    let broker = new ServiceBroker({ logger: false });
    let service = new NucleusService(broker, {
        config: {
            storage: 'file',
            path: './tmp/test/data'
        }
    });

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

    describe("Test 'nucleus.bind' action", () => {
        it("should bind to a new core with topic", async () => {
            const topic = "test-topic";
            const result = await broker.call("nucleus.bind", { topic });
            
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.topic).toBe(topic);
            expect(result.core).toBeDefined();
            expect(result.core.key).toBeDefined();
        });

        it("should bind to existing core with key", async () => {
            const topic = "test-topic";
            const firstResult = await broker.call("nucleus.bind", { topic });
            const key = firstResult.core.key;
            
            const result = await broker.call("nucleus.bind", { topic, key });
            expect(result.success).toBe(true);
            expect(result.core.key).toBe(key);
        });

        it("should reject with ValidationError for missing topic", async () => {
            expect.assertions(1);
            try {
                await broker.call("nucleus.bind", {});
            } catch (err) {
                expect(err.name).toBe("ValidationError");
            }
        });

        it("should reject with error for discovery key mismatch", async () => {
            const topic = "test-topic";
            await broker.call("nucleus.bind", { topic });
            
            expect.assertions(1);
            try {
                await broker.call("nucleus.bind", { topic, key: "invalid-key" });
            } catch (err) {
                expect(err.message).toContain("Discovery key mismatch");
            }
        });
    });

    describe("Test 'nucleus.get' action", () => {
        it("should get journal core by default", async () => {
            const result = await broker.call("nucleus.get");
            
            expect(result).toBeDefined();
            expect(result.name).toBe("journal");
            expect(result.core).toBeDefined();
        });

        it("should get specific core by name", async () => {
            const name = "test-core";
            await broker.call("nucleus.bind", { topic: name });
            
            const result = await broker.call("nucleus.get", { name });
            expect(result.name).toBe(name);
            expect(result.core).toBeDefined();
        });

        it("should get core by key", async () => {
            const topic = "test-core";
            const bindResult = await broker.call("nucleus.bind", { topic });
            const key = bindResult.core.publicKey;
            
            const result = await broker.call("nucleus.get", { key });
            expect(result.core.publicKey).toBe(key);
        });

        it("should handle errors when getting non-existent core", async () => {
            expect.assertions(1);
            try {
                await broker.call("nucleus.get", { name: "non-existent" });
            } catch (err) {
                expect(err).toBeDefined();
            }
        });
    });

    describe("Test 'nucleus.write' action", () => {
        it("should write to journal core by default", async () => {
            const data = { test: "data" };
            const result = await broker.call("nucleus.write", { data });
            
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.name).toBe("journal");
            expect(result.core).toBeDefined();
        });

        it("should write to specific core", async () => {
            const name = "test-write-core";
            await broker.call("nucleus.bind", { topic: name });
            
            const data = { test: "data" };
            const result = await broker.call("nucleus.write", { name, data });
            
            expect(result.success).toBe(true);
            expect(result.name).toBe(name);
        });

        it("should reject with ValidationError for missing data", async () => {
            expect.assertions(1);
            try {
                await broker.call("nucleus.write", {});
            } catch (err) {
                expect(err.name).toBe("ValidationError");
            }
        });

        it("should handle errors when writing to non-existent core", async () => {
            expect.assertions(1);
            try {
                await broker.call("nucleus.write", { name: "non-existent", data: { test: "data" } });
            } catch (err) {
                expect(err).toBeDefined();
            }
        });
    });

    describe("Test service lifecycle", () => {
        it("should handle file storage initialization", async () => {
            const fileService = new NucleusService(broker, {
                config: {
                    storage: 'file',
                    path: './tmp/test/data'
                }
            });
            expect(fileService.store).toBeDefined();
        });

        it("should handle invalid storage type", async () => {
            const invalidService = new NucleusService(broker, {
                config: {
                    storage: 'invalid'
                }
            });
            expect(invalidService.store).toBeNull();
        });

        it("should handle initialization errors gracefully", async () => {
            const errorService = new NucleusService(broker, {
                config: {
                    storage: 'file' // Missing path should cause error
                }
            });
            expect(errorService.store).toBeNull();
        });
    });

    describe("Test cleanup", () => {
        it("should clean up resources on stop", async () => {
            const cleanupService = new NucleusService(broker, {
                config: {
                    storage: 'memory',
                    path: RAM
                }
            });
            
            // Create some cores
            await broker.call("nucleus.bind", { topic: "cleanup-test" });
            await broker.call("nucleus.write", { data: { test: "data" } });
            
            // Stop the service
            await cleanupService.onStopped();
            
            // Verify cleanup
            expect(cleanupService.cores).toEqual({});
            expect(cleanupService.swarm).toBeUndefined();
            expect(cleanupService.store).toBeNull();
        });
    });

    // Disabled event tests for now
    describe.skip("Test core events", () => {
        it("should emit 'core.ready' event when core is created", async () => {
            const topic = "test-event-core";
            const eventSpy = jest.spyOn(broker, "emit");

            await broker.call("nucleus.bind", { topic });

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