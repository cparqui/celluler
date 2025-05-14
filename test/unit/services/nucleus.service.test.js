import fs from 'fs';
import _ from "lodash";
import { ServiceBroker } from "moleculer";
import path from 'path';
import { promisify } from 'util';
import NucleusService from "../../../src/services/nucleus.service.js";

const rmrf = promisify(fs.rm);
const mkdir = promisify(fs.mkdir);

describe("Test 'nucleus' service", () => {
    let broker;
    let service;
    const testDataDir = path.join(process.cwd(), 'tmp', 'test', 'data');
    const testDataDir2 = path.join(process.cwd(), 'tmp', 'test', 'data2');

    beforeAll(async () => {
        // Clean up any existing test data
        try {
            await rmrf(testDataDir, { recursive: true, force: true });
            await rmrf(testDataDir2, { recursive: true, force: true });
        } catch (err) {
            // Ignore errors if directories don't exist
        }

        // Create fresh test directories
        await mkdir(testDataDir, { recursive: true });
        await mkdir(testDataDir2, { recursive: true });

        broker = new ServiceBroker({
            logger: false,
            metrics: false
        });

        service = new NucleusService(broker, {
            name: 'test-cell',
            config: {
                storage: 'file',
                path: testDataDir
            }
        });

        await broker.start();
    });

    afterAll(async () => {
        if (broker) {
            await broker.stop();
        }

        // Clean up test data
        try {
            // Wait a bit to ensure all file handles are closed
            await rmrf(testDataDir, { recursive: true, force: true });
            await rmrf(testDataDir2, { recursive: true, force: true });
        } catch (err) {
            console.error('Error cleaning up test data:', err);
        }
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
                fail("Expected an error to be thrown");
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
                fail("Expected an error to be thrown");
            } catch (err) {
                expect(err).toBeDefined();
            }
        });
    });

    describe("Test service lifecycle", () => {
        it("should handle file storage initialization", async () => {
            expect(service.store).toBeDefined();

        });

        it("should handle invalid storage type", async () => {
            const invalidService = new NucleusService(broker, {
                config: {
                    storage: 'invalid'
                }
            });
            expect(invalidService.store).toBeUndefined();
        });

        it("should handle initialization errors gracefully", async () => {
            const errorService = new NucleusService(broker, {
                config: {
                    storage: 'file' // Missing path should cause error
                }
            });
            expect(errorService.store).toBeUndefined();
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

    describe("Test cell UUID", () => {
        it("should generate and return a valid UUID", async () => {
            // Ensure journal is initialized
            await broker.call("nucleus.write", { data: { test: "data" } });
            const result = await broker.call("nucleus.getUUID");
            expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });

        it("should return the same UUID on subsequent calls", async () => {
            // Ensure journal is initialized
            await broker.call("nucleus.write", { data: { test: "data" } });
            const uuid1 = await broker.call("nucleus.getUUID");
            await broker.call("nucleus.write", { data: { test: "more data" } });
            const uuid2 = await broker.call("nucleus.getUUID");
            expect(uuid1).toBe(uuid2);
        });

        it("should generate different UUIDs for different cells", async () => {
            // Ensure journal is initialized for first cell
            await broker.call("nucleus.write", { data: { test: "data" } });
            const uuid1 = await broker.call("nucleus.getUUID");

            // Create a second service with different config
            const broker2 = new ServiceBroker({ logger: false });
            const service2 = new NucleusService(broker2, {
                name: 'different-cell',
                config: {
                    storage: 'file',
                    path: './tmp/test/data2',
                }
            });

            // Initialize the second service
            await broker2.start();

            // Initialize journal for second cell
            await broker2.call("nucleus.write", { data: { test: "data" } });
            const uuid2 = await broker2.call("nucleus.getUUID");
            
            expect(uuid1).not.toBe(uuid2);
            
            // Clean up second service
            await service2.schema.stopped.call(service2);
            await broker2.stop();
        });
    });

    describe("Test cell key pair", () => {
        it("should generate and return a valid public key", async () => {
            const publicKey = await broker.call("nucleus.getPublicKey");
            expect(publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
        }, 10000);

        it("should be able to encrypt and decrypt messages between cells", async () => {
            // Create a second service with different config
            const broker2 = new ServiceBroker({ logger: false });
            const service2 = new NucleusService(broker2, {
                name: 'different-cell',
                config: {
                    storage: 'file',
                    path: './tmp/test/data2',
                }
            });

            await broker2.start();

            // Get public keys
            const publicKey1 = await broker.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");

            // Test message exchange
            const message = "Hello from cell 1";
            const encrypted = await service.encryptForCell(publicKey2, message);
            const decrypted = await service2.decryptFromCell(publicKey1, encrypted);

            expect(decrypted).toBe(message);
            await broker2.stop();
        }, 15000);

        it("should reject messages with invalid signatures", async () => {
            // Create a second service
            const broker2 = new ServiceBroker({ logger: false });
            const service2 = new NucleusService(broker2, {
                name: 'different-cell',
                config: {
                    storage: 'file',
                    path: './tmp/test/data2',
                }
            });

            await broker2.start();

            // Get public keys
            const publicKey1 = await broker.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");

            // Create a tampered message
            const message = "Hello from cell 1";
            const encrypted = await service.encryptForCell(publicKey2, message);
            encrypted.signature = 'invalid-signature';

            await expect(service2.decryptFromCell(publicKey1, encrypted))
                .rejects.toThrow('Invalid signature');

            await broker2.stop();
        }, 15000);
    });

    describe("Test cleanup", () => {
        it("should clean up resources on stop", async () => {
            // Create a second broker and service
            const broker2 = new ServiceBroker({ logger: false });
            const cleanupService = new NucleusService(broker2, {
                config: {
                    storage: 'file',
                    path: './tmp/test/data2'
                }
            });
            
            await broker2.start();
            
            // Create some cores
            await broker2.call("nucleus.bind", { topic: "cleanup-test" });
            await broker2.call("nucleus.write", { data: { test: "data" } });
            
            // Stop the service
            await broker2.stop();
            
            // Verify cleanup
            expect(cleanupService.cores).toEqual({});
            expect(cleanupService.swarm).toBeNull();
            expect(cleanupService.store).toBeNull();
        });
    });
}); 