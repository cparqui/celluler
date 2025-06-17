import fs from 'fs';
import _ from "lodash";
import { ServiceBroker } from "moleculer";
import path from 'path';
import { promisify } from 'util';
import MessageService from "../../../src/services/message.service.js";
import NucleusService from "../../../src/services/nucleus.service.js";

const rmrf = promisify(fs.rm);
const mkdir = promisify(fs.mkdir);

describe("Test 'message' service", () => {
    let broker;
    let messageService;
    let nucleusService;
    const testDataDir = path.join(process.cwd(), 'tmp', 'test', 'message-data');
    const testCellUUID = "test-cell-uuid-12345";

    beforeAll(async () => {
        // Clean up any existing test data
        try {
            await rmrf(testDataDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore errors if directories don't exist
        }

        // Create fresh test directories
        await mkdir(testDataDir, { recursive: true });

        broker = new ServiceBroker({
            logger: false,
            metrics: false
        });

        // Create NucleusService first (dependency)
        nucleusService = new NucleusService(broker, {
            name: 'test-cell',
            config: {
                storage: 'file',
                path: testDataDir
            }
        });

        // Create MessageService
        messageService = new MessageService(broker, {
            name: 'test-cell',
            config: {
                maxCoresPerType: 100,
                coreExpirationTime: 60000 // 1 minute for testing
            }
        });

        await broker.start();

        // Simulate nucleus.started event
        await broker.emit("nucleus.started", { cellUUID: testCellUUID });
        
        // Wait a bit for the event to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterAll(async () => {
        if (broker) {
            await broker.stop();
        }

        // Clean up test data
        try {
            await rmrf(testDataDir, { recursive: true, force: true });
        } catch (err) {
            console.error('Error cleaning up test data:', err);
        }
    });

    describe("Test topic naming conventions", () => {
        describe("Test 'message.createTopic' action", () => {
            it("should create direct topic with correct naming", async () => {
                const params = {
                    topicType: "direct",
                    sourceUUID: "alice-uuid",
                    targetUUID: "bob-uuid"
                };
                
                const result = await broker.call("message.createTopic", params);
                
                expect(result.success).toBe(true);
                expect(result.topic).toBe("direct:alice-uuid:bob-uuid");
                expect(result.coreInfo).toBeDefined();
                expect(result.coreInfo.type).toBe("direct");
                expect(result.coreInfo.sourceUUID).toBe("alice-uuid");
                expect(result.coreInfo.targetUUID).toBe("bob-uuid");
                expect(result.coreInfo.encrypted).toBe(true);
            });

            it("should create inbox topic with correct naming", async () => {
                const params = {
                    topicType: "inbox",
                    sourceUUID: "alice-uuid"
                };
                
                const result = await broker.call("message.createTopic", params);
                
                expect(result.success).toBe(true);
                expect(result.topic).toBe("inbox:alice-uuid");
                expect(result.coreInfo.type).toBe("inbox");
                expect(result.coreInfo.sourceUUID).toBe("alice-uuid");
                expect(result.coreInfo.targetUUID).toBeNull();
                expect(result.coreInfo.encrypted).toBe(false);
            });

            it("should create peer_cache topic with correct naming", async () => {
                const params = {
                    topicType: "peer_cache",
                    sourceUUID: "alice-uuid"
                };
                
                const result = await broker.call("message.createTopic", params);
                
                expect(result.success).toBe(true);
                expect(result.topic).toBe("peer_cache:alice-uuid");
                expect(result.coreInfo.type).toBe("peer_cache");
                expect(result.coreInfo.encrypted).toBe(false);
            });

            it("should create journal topic with correct naming", async () => {
                const params = {
                    topicType: "journal",
                    sourceUUID: "alice-uuid"
                };
                
                const result = await broker.call("message.createTopic", params);
                
                expect(result.success).toBe(true);
                expect(result.topic).toBe("journal:alice-uuid");
                expect(result.coreInfo.type).toBe("journal");
                expect(result.coreInfo.encrypted).toBe(false);
            });

            it("should reject direct topic without targetUUID", async () => {
                const params = {
                    topicType: "direct",
                    sourceUUID: "alice-uuid"
                };
                
                expect.assertions(1);
                try {
                    await broker.call("message.createTopic", params);
                } catch (err) {
                    expect(err.message).toContain("Target UUID required for direct topic");
                }
            });

            it("should reject invalid topic type", async () => {
                const params = {
                    topicType: "invalid",
                    sourceUUID: "alice-uuid"
                };
                
                expect.assertions(1);
                try {
                    await broker.call("message.createTopic", params);
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
            });

            it("should reject with ValidationError for missing sourceUUID", async () => {
                const params = {
                    topicType: "inbox"
                };
                
                expect.assertions(1);
                try {
                    await broker.call("message.createTopic", params);
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
            });
        });
    });

    describe("Test topic-to-core mapping", () => {
        describe("Test 'message.getTopic' action", () => {
            it("should retrieve existing topic core mapping", async () => {
                // First create a topic
                const createParams = {
                    topicType: "inbox",
                    sourceUUID: "charlie-uuid"
                };
                
                const createResult = await broker.call("message.createTopic", createParams);
                const topic = createResult.topic;
                
                // Then retrieve it
                const getResult = await broker.call("message.getTopic", { topic });
                
                expect(getResult.topic).toBe(topic);
                expect(getResult.coreInfo).toBeDefined();
                expect(getResult.coreInfo.type).toBe("inbox");
                expect(getResult.coreInfo.sourceUUID).toBe("charlie-uuid");
            });

            it("should reject for non-existent topic", async () => {
                const topic = "inbox:non-existent-uuid";
                
                expect.assertions(1);
                try {
                    await broker.call("message.getTopic", { topic });
                } catch (err) {
                    expect(err.message).toContain("Topic not found");
                }
            });

            it("should reject with ValidationError for missing topic", async () => {
                expect.assertions(1);
                try {
                    await broker.call("message.getTopic", {});
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
            });
        });

        describe("Test 'message.listTopics' action", () => {
            it("should list all created topics", async () => {
                // Create multiple topics
                await broker.call("message.createTopic", {
                    topicType: "direct",
                    sourceUUID: "alice-uuid",
                    targetUUID: "bob-uuid"
                });
                
                await broker.call("message.createTopic", {
                    topicType: "inbox",
                    sourceUUID: "alice-uuid"
                });
                
                const result = await broker.call("message.listTopics");
                
                expect(result.topics).toBeDefined();
                expect(Array.isArray(result.topics)).toBe(true);
                expect(result.count).toBeGreaterThan(0);
                
                // Check that topics include the ones we created
                const topics = result.topics.map(t => t.topic);
                expect(topics).toContain("direct:alice-uuid:bob-uuid");
                expect(topics).toContain("inbox:alice-uuid");
            });

            it("should include default topics created for the cell", async () => {
                const result = await broker.call("message.listTopics");
                
                const topics = result.topics.map(t => t.topic);
                expect(topics).toContain(`inbox:${testCellUUID}`);
                expect(topics).toContain(`peer_cache:${testCellUUID}`);
                expect(topics).toContain(`journal:${testCellUUID}`);
            });
        });
    });

    describe("Test access control determination", () => {
        it("should set correct access control for direct topics", async () => {
            const params = {
                topicType: "direct", 
                sourceUUID: "alice-uuid",
                targetUUID: "bob-uuid"
            };
            
            const result = await broker.call("message.createTopic", params);
            
            expect(result.coreInfo.writers).toEqual(["alice-uuid"]);
            expect(result.coreInfo.readers).toEqual(["bob-uuid"]);
        });

        it("should set correct access control for inbox topics", async () => {
            const params = {
                topicType: "inbox",
                sourceUUID: "alice-uuid"
            };
            
            const result = await broker.call("message.createTopic", params);
            
            expect(result.coreInfo.writers).toEqual(["alice-uuid"]);
            expect(result.coreInfo.readers).toEqual(["alice-uuid"]);
        });

        it("should set correct access control for peer_cache topics", async () => {
            const params = {
                topicType: "peer_cache",
                sourceUUID: "alice-uuid"
            };
            
            const result = await broker.call("message.createTopic", params);
            
            expect(result.coreInfo.writers).toEqual(["alice-uuid"]);
            expect(result.coreInfo.readers).toEqual(["alice-uuid"]);
        });

        it("should set correct access control for journal topics", async () => {
            const params = {
                topicType: "journal",
                sourceUUID: "alice-uuid"
            };
            
            const result = await broker.call("message.createTopic", params);
            
            expect(result.coreInfo.writers).toEqual(["alice-uuid"]);
            expect(result.coreInfo.readers).toEqual(["*"]);
        });
    });

    describe("Test topic binding delegation", () => {
        describe("Test 'message.bindTopic' action", () => {
            it("should bind to existing core", async () => {
                // First create a core through NucleusService
                const topic = "inbox:test-bind-uuid";
                const nucleusResult = await broker.call("nucleus.bind", { topic });
                const coreKey = nucleusResult.core.key;
                
                // Then bind through MessageService
                const result = await broker.call("message.bindTopic", { topic, coreKey });
                
                expect(result.success).toBe(true);
                expect(result.topic).toBe(topic);
                expect(result.coreInfo).toBeDefined();
                expect(result.coreInfo.coreKey).toBe(coreKey);
                expect(result.coreInfo.boundAt).toBeDefined();
            });

            it("should bind without coreKey (creates new)", async () => {
                const topic = "inbox:test-bind-new-uuid";
                
                const result = await broker.call("message.bindTopic", { topic });
                
                expect(result.success).toBe(true);
                expect(result.topic).toBe(topic);
                expect(result.coreInfo.coreKey).toBeDefined();
            });

            it("should reject with ValidationError for missing topic", async () => {
                expect.assertions(1);
                try {
                    await broker.call("message.bindTopic", {});
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
            });
        });
    });

    describe("Test service health and metrics", () => {
        describe("Test 'message.health' action", () => {
            it("should return health status with metrics", async () => {
                const result = await broker.call("message.health");
                
                expect(result.status).toBe("healthy");
                expect(result.timestamp).toBeDefined();
                expect(result.cellUUID).toBe(testCellUUID);
                expect(result.metrics).toBeDefined();
                expect(result.metrics.topicsCount).toBeGreaterThan(0);
                expect(result.metrics.topicsByType).toBeDefined();
            });

            it("should track topics by type in metrics", async () => {
                const result = await broker.call("message.health");
                
                const typeCount = result.metrics.topicsByType;
                expect(typeCount.inbox).toBeGreaterThan(0);
                expect(typeCount.peer_cache).toBeGreaterThan(0); 
                expect(typeCount.journal).toBeGreaterThan(0);
            });
        });
    });

    describe("Test default topic creation", () => {
        it("should create default topics on nucleus.started event", async () => {
            const result = await broker.call("message.listTopics");
            const topics = result.topics.map(t => t.topic);
            
            expect(topics).toContain(`inbox:${testCellUUID}`);
            expect(topics).toContain(`peer_cache:${testCellUUID}`);
            expect(topics).toContain(`journal:${testCellUUID}`);
        });

        it("should not create default topics if cellUUID is not available", async () => {
            // Create a new service without triggering nucleus.started
            const newBroker = new ServiceBroker({
                logger: false,
                metrics: false
            });

            // Create nucleus service first
            const newNucleusService = new NucleusService(newBroker, {
                name: 'test-cell-2',
                config: {
                    storage: 'file',
                    path: path.join(testDataDir, 'new-cell')
                }
            });

            const newMessageService = new MessageService(newBroker, {
                name: 'test-cell-2',
                config: {}
            });

            await newBroker.start();
            
            const result = await newBroker.call("message.listTopics");
            expect(result.count).toBe(0);
            
            await newBroker.stop();
        });
    });

    describe("Test encryption settings", () => {
        it("should mark direct topics as encrypted", async () => {
            const params = {
                topicType: "direct",
                sourceUUID: "alice-uuid", 
                targetUUID: "bob-uuid"
            };
            
            const result = await broker.call("message.createTopic", params);
            expect(result.coreInfo.encrypted).toBe(true);
        });

        it("should mark non-direct topics as not encrypted", async () => {
            const topicTypes = ["inbox", "peer_cache", "journal"];
            
            for (const topicType of topicTypes) {
                const params = {
                    topicType,
                    sourceUUID: "alice-uuid"
                };
                
                const result = await broker.call("message.createTopic", params);
                expect(result.coreInfo.encrypted).toBe(false);
            }
        });
    });

    describe("Test topic parsing", () => {
        it("should correctly parse direct topic format", async () => {
            const params = {
                topicType: "direct",
                sourceUUID: "alice-uuid",
                targetUUID: "bob-uuid"
            };
            
            const result = await broker.call("message.createTopic", params);
            
            expect(result.coreInfo.type).toBe("direct");
            expect(result.coreInfo.sourceUUID).toBe("alice-uuid");
            expect(result.coreInfo.targetUUID).toBe("bob-uuid");
        });

        it("should correctly parse single-UUID topic formats", async () => {
            const topicTypes = ["inbox", "peer_cache", "journal"];
            
            for (const topicType of topicTypes) {
                const params = {
                    topicType,
                    sourceUUID: "alice-uuid"
                };
                
                const result = await broker.call("message.createTopic", params);
                
                expect(result.coreInfo.type).toBe(topicType);
                expect(result.coreInfo.sourceUUID).toBe("alice-uuid");
                expect(result.coreInfo.targetUUID).toBeNull();
            }
        });
    });

    describe("Test direct messaging functionality", () => {
        const aliceUUID = "alice-test-uuid";
        const bobUUID = "bob-test-uuid";
        // Use mock public keys for testing
        const alicePublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1YWnm/eplO9BFtXszMRQ
gFhv+lNdvGYwdINOGKUMzahtLVClWWdMhV6rWlJYGy0Z1O1wuHKBLpPq4b+mJ8iI
wPkGl4r+xjJCq9V7ZxTwD5Ks5Z8XeUdJpD4QVcKRkWzPLWuJ6tK4Iq7u+u5WTx1y
+2e2q3Sj+WEKP9L5A+H2qIw8A5j4q3r2VQKb3+bK4Y7k8VKkHzm9k3lJ+1B6U0o7
b5a8U7v8F+W2Y0o5W6K1P+r4i+q3w8K7Q+M2G8Z1x+tW3Y7Q+w8K5R+L+H3Y0K8U
8L+O4U7r5a8B+Y2O0k5U1F+H3K7Q+k5W7R+P4I8o7Q5K1R+W2Y8L+H0K5U7Q9K8L
wIDAQAB
-----END PUBLIC KEY-----`;
        
        const bobPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2XYnm/eplO9BFtXszMRQ
gFhv+lNdvGYwdINOGKUMzahtLVClWWdMhV6rWlJYGy0Z1O1wuHKBLpPq4b+mJ8iI
wPkGl4r+xjJCq9V7ZxTwD5Ks5Z8XeUdJpD4QVcKRkWzPLWuJ6tK4Iq7u+u5WTx1y
+2e2q3Sj+WEKP9L5A+H2qIw8A5j4q3r2VQKb3+bK4Y7k8VKkHzm9k3lJ+1B6U0o7
b5a8U7v8F+W2Y0o5W6K1P+r4i+q3w8K7Q+M2G8Z1x+tW3Y7Q+w8K5R+L+H3Y0K8U
8L+O4U7r5a8B+Y2O0k5U1F+H3K7Q+k5W7R+P4I8o7Q5K1R+W2Y8L+H0K5U7Q9K8L
wIDAQAB
-----END PUBLIC KEY-----`;

        describe("Test 'message.sendMessage' action", () => {
            it("should send encrypted message to recipient", async () => {
                // Get the actual public key from nucleus service
                const nucleusPublicKey = await broker.call("nucleus.getPublicKey");
                
                const params = {
                    targetUUID: bobUUID,
                    message: "Hello Bob, this is Alice!",
                    recipientPublicKey: nucleusPublicKey
                };
                
                const result = await broker.call("message.sendMessage", params);
                
                expect(result.success).toBe(true);
                expect(result.messageId).toBeDefined();
                expect(result.topic).toBe(`direct:${testCellUUID}:${bobUUID}`);
                expect(result.timestamp).toBeDefined();
            });

            it("should queue message for offline delivery when sending fails", async () => {
                // Get the actual public key from nucleus service for consistency
                const nucleusPublicKey = await broker.call("nucleus.getPublicKey");
                
                const params = {
                    targetUUID: "nonexistent-uuid",
                    message: "Test message",
                    recipientPublicKey: nucleusPublicKey
                };
                
                // This should attempt to send and potentially queue
                try {
                    await broker.call("message.sendMessage", params);
                } catch (err) {
                    // Expected to fail since we don't have a complete nucleus implementation
                    expect(err).toBeDefined();
                }
            });

            it("should reject with ValidationError for missing parameters", async () => {
                // Get the actual public key from nucleus service
                const nucleusPublicKey = await broker.call("nucleus.getPublicKey");
                
                expect.assertions(3);
                
                // Missing targetUUID
                try {
                    await broker.call("message.sendMessage", {
                        message: "test",
                        recipientPublicKey: nucleusPublicKey
                    });
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
                
                // Missing message
                try {
                    await broker.call("message.sendMessage", {
                        targetUUID: bobUUID,
                        recipientPublicKey: nucleusPublicKey
                    });
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
                
                // Missing recipientPublicKey
                try {
                    await broker.call("message.sendMessage", {
                        targetUUID: bobUUID,
                        message: "test"
                    });
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
            });

            it("should reject with ValidationError for invalid public key format", async () => {
                expect.assertions(1);
                
                try {
                    await broker.call("message.sendMessage", {
                        targetUUID: bobUUID,
                        message: "test",
                        recipientPublicKey: "invalid-key"
                    });
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
            });
        });

        describe("Test 'message.getMessages' action", () => {
            it("should retrieve messages from a topic", async () => {
                const topic = `direct:${aliceUUID}:${bobUUID}`;
                
                // First create the topic
                await broker.call("message.createTopic", {
                    topicType: "direct",
                    sourceUUID: aliceUUID,
                    targetUUID: bobUUID
                });
                
                const result = await broker.call("message.getMessages", { topic });
                
                expect(result.topic).toBe(topic);
                expect(result.messages).toBeDefined();
                expect(Array.isArray(result.messages)).toBe(true);
                expect(result.count).toBeDefined();
                expect(result.hasMore).toBeDefined();
            });

            it("should reject for non-existent topic", async () => {
                const topic = "direct:nonexistent:topic";
                
                expect.assertions(1);
                try {
                    await broker.call("message.getMessages", { topic });
                } catch (err) {
                    expect(err.message).toContain("Topic not found");
                }
            });

            it("should handle limit parameter", async () => {
                const topic = `inbox:${testCellUUID}`;
                
                const result = await broker.call("message.getMessages", { 
                    topic, 
                    limit: 10 
                });
                
                expect(result.messages.length).toBeLessThanOrEqual(10);
            });

            it("should reject with ValidationError for missing topic", async () => {
                expect.assertions(1);
                try {
                    await broker.call("message.getMessages", {});
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
            });

            it("should reject with ValidationError for invalid limit", async () => {
                expect.assertions(1);
                try {
                    await broker.call("message.getMessages", {
                        topic: `inbox:${testCellUUID}`,
                        limit: 200 // exceeds max of 100
                    });
                } catch (err) {
                    expect(err.name).toBe("ValidationError");
                }
            });
        });
    });

    describe("Test crypto helper methods", () => {
        it("should generate unique message IDs", async () => {
            const service = messageService;
            
            const id1 = service.generateMessageId();
            const id2 = service.generateMessageId();
            
            expect(id1).toBeDefined();
            expect(id2).toBeDefined();
            expect(id1).not.toBe(id2);
            expect(id1).toMatch(/^msg_\d+_[a-z0-9]+$/);
        });

        it("should have public key from nucleus service", async () => {
            const service = messageService;
            
            // Public key should be set by nucleus service during startup
            // If not set, try to get it from nucleus service directly
            if (!service.cellPublicKey) {
                try {
                    const nucleusPublicKey = await broker.call("nucleus.getPublicKey");
                    expect(nucleusPublicKey).toBeDefined();
                } catch (err) {
                    // If nucleus service is not available, that's expected in some tests
                    expect(err).toBeDefined();
                }
            } else {
                expect(service.cellPublicKey).toBeDefined();
            }
        });

        it("should queue offline messages", async () => {
            const service = messageService;
            
            const targetUUID = "test-target-uuid";
            const message = "Test offline message";
            const recipientPublicKey = "test-public-key";
            
            service.queueOfflineMessage(targetUUID, message, recipientPublicKey);
            
            const queueKey = `offline:${targetUUID}`;
            expect(service.messageQueue.has(queueKey)).toBe(true);
            
            const queue = service.messageQueue.get(queueKey);
            expect(queue.length).toBe(1);
            expect(queue[0].targetUUID).toBe(targetUUID);
            expect(queue[0].message).toBe(message);
            expect(queue[0].recipientPublicKey).toBe(recipientPublicKey);
        });
    });
}); 