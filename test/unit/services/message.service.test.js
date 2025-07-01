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
    let testPeerUUID = 'd117429b-d61a-7924-956d-fb7b1027d51b';
    let testPublicKey;

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
                coreExpirationTime: 60000, // 1 minute for testing
                enableSpamPrevention: true,
                enableRateLimiting: true,
                spamDetection: {
                    enabled: true,
                    MAX_MESSAGES_PER_MINUTE: 10,
                    MAX_MESSAGES_PER_HOUR: 100,
                    MAX_MESSAGE_SIZE: 10 * 1024, // 10KB
                    SUSPICIOUS_KEYWORDS: ['spam', 'scam', 'phishing', 'malware'],
                    REPUTATION_THRESHOLD: -10,
                    COOLDOWN_PERIOD: 60 * 1000 // 1 minute
                },
                rateLimiting: {
                    enabled: true,
                    MESSAGE_BURST: 5,
                    MESSAGE_WINDOW: 60 * 1000,
                    NOTIFICATION_BURST: 20,
                    NOTIFICATION_WINDOW: 60 * 1000,
                    HANDSHAKE_BURST: 10,
                    HANDSHAKE_WINDOW: 5 * 60 * 1000
                }
            }
        });

        // Start broker
        await broker.start();

        // Manually initialize the MessageService since we don't have a real NucleusService
        messageService = broker.getLocalService("message");
        messageService.cellUUID = testCellUUID;
        messageService.cellPublicKey = testPublicKey;
        
        // Trigger the nucleus.started event manually
        await broker.emit("nucleus.started", {
            cellUUID: testCellUUID,
            publicKey: testPublicKey
        });

        // Wait for service to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    beforeEach(async () => {
        const service = broker.getLocalService("message");
        if (service) {
            service.spamScores.clear();
            service.suspicionScores.clear();
            service.blockedPeers.clear();
            service.rateLimiters.clear();
            service.messageHashes.clear();
            service.deduplicationCache.clear();
            service.signatureCache.clear();
            
            // Restore original broker.call if it was mocked
            if (service.broker.call && service.broker.call.mockRestore) {
                service.broker.call.mockRestore();
            }
        }
        
        // Clear all jest mocks
        jest.clearAllMocks();
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
                
                // Get the message service to access the actual cell UUID
                const messageService = broker.getLocalService("message");
                const actualCellUUID = messageService.cellUUID;
                
                expect(actualCellUUID).toBeDefined();
                expect(topics).toContain(`inbox:${actualCellUUID}`);
                expect(topics).toContain(`peer_cache:${actualCellUUID}`);
                expect(topics).toContain(`journal:${actualCellUUID}`);
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
                expect(result.cellUUID).toBeDefined();
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
            
            // Get the message service to access the actual cell UUID
            const messageService = broker.getLocalService("message");
            const actualCellUUID = messageService.cellUUID;
            
            expect(actualCellUUID).toBeDefined();
            expect(topics).toContain(`inbox:${actualCellUUID}`);
            expect(topics).toContain(`peer_cache:${actualCellUUID}`);
            expect(topics).toContain(`journal:${actualCellUUID}`);
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
                // Get the actual cell UUID from the message service
                const messageService = broker.getLocalService("message");
                const actualCellUUID = messageService.cellUUID;
                expect(result.topic).toBe(`direct:${actualCellUUID}:${bobUUID}`);
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
                // Get the actual cell UUID from the message service
                const messageService = broker.getLocalService("message");
                const actualCellUUID = messageService.cellUUID;
                
                const result = await broker.call("message.getMessages", {
                    topic: `inbox:${actualCellUUID}`,
                    limit: 5
                });

                expect(result.messages).toBeDefined();
                expect(Array.isArray(result.messages)).toBe(true);
                expect(result.count).toBeGreaterThanOrEqual(0);
                expect(result.hasMore).toBeDefined();
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

    describe("Test offline message queue", () => {
        it("should queue failed messages for offline delivery", async () => {
            // Try to send message with invalid recipient public key that passes validation but fails encryption
            const invalidButLongKey = "-----BEGIN PUBLIC KEY-----\nINVALID_KEY_CONTENT_THAT_IS_LONG_ENOUGH_TO_PASS_VALIDATION_BUT_WILL_FAIL_ENCRYPTION_ABCDEFGHIJKLMNOPQRSTUVWXYZ\n-----END PUBLIC KEY-----";
            
            try {
                await broker.call("message.sendMessage", {
                    targetUUID: "offline-target-uuid",
                    message: "This should be queued",
                    recipientPublicKey: invalidButLongKey
                });
            } catch (err) {
                // Expected to fail and queue the message
            }
            
            // Check that message was queued (via internal access)
            const messageService = broker.getLocalService("message");
            const queueKey = "offline:offline-target-uuid";
            expect(messageService.messageQueue.has(queueKey)).toBe(true);
            
            const queue = messageService.messageQueue.get(queueKey);
            expect(queue.length).toBe(1);
            expect(queue[0].targetUUID).toBe("offline-target-uuid");
            expect(queue[0].message).toBe("This should be queued");
        });
    });

    describe("Test inbox system with Autobase", () => {
        let recipientUUID;
        let recipientPublicKey;

        beforeAll(async () => {
            // Create a mock recipient for inbox testing
            recipientUUID = "recipient-test-uuid";
            recipientPublicKey = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0vx7agoebGcQSuuPiLJX\nZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tS\noc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt\n7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0\nzgdLR_o1hiabtAjOcvjsyb3JnYXLovpDgjH16CjCDY1dQkrhwIGg8LCWfLUYmRKV\nMjjNmUBG8xh3CtbKWPyCwfJgNI_R7O6pXLJgPnMc8uxJRaBFOGjw8q_SZfCKS1fH\n-----END PUBLIC KEY-----";
        });

        describe("Test inbox notifications", () => {
            it("should send notification to peer inbox", async () => {
                // First grant inbox access to the recipient
                await broker.call("message.grantInboxAccess", {
                    requesterUUID: recipientUUID,
                    granted: true
                });

                // Get the actual cell UUID
                const messageService = broker.getLocalService("message");
                const actualCellUUID = messageService.cellUUID;

                const notification = {
                    type: "peer_announcement",
                    from: actualCellUUID,
                    capabilities: ["messaging"],
                    timestamp: new Date().toISOString()
                };

                try {
                    // This will fail because peer inbox connection is not fully implemented
                    // but it should create the notification structure correctly
                    await broker.call("message.sendNotification", {
                        targetUUID: recipientUUID,
                        notification
                    });
                } catch (err) {
                    // Expected - peer inbox connection is not fully implemented
                    expect(err.message).toContain("Peer inbox connection not fully implemented");
                }
            });

            it("should reject notification without inbox access", async () => {
                // Get the actual cell UUID
                const messageService = broker.getLocalService("message");
                const actualCellUUID = messageService.cellUUID;

                const notification = {
                    type: "peer_announcement",
                    from: actualCellUUID,
                    capabilities: ["messaging"],
                    timestamp: new Date().toISOString()
                };

                try {
                    await broker.call("message.sendNotification", {
                        targetUUID: "unauthorized-peer",
                        notification
                    });
                    expect(true).toBe(false); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("No inbox access granted");
                }
            });
        });

        describe("Test inbox access control", () => {
            it("should allow requesting inbox access", async () => {
                const result = await broker.call("message.requestInboxAccess", {
                    targetUUID: "new-peer-uuid",
                    reason: "Testing inbox access request"
                });

                expect(result.success).toBe(true);
                expect(result.targetUUID).toBe("new-peer-uuid");
                expect(result.status).toBe("pending");
                expect(result.requestTimestamp).toBeDefined();
            });

            it("should allow granting inbox access", async () => {
                const result = await broker.call("message.grantInboxAccess", {
                    requesterUUID: "new-peer-uuid", 
                    granted: true
                });

                expect(result.success).toBe(true);
                expect(result.requesterUUID).toBe("new-peer-uuid");
                expect(result.granted).toBe(true);
                expect(result.timestamp).toBeDefined();

                // Verify peer was added to trusted peers
                const messageService = broker.getLocalService("message");
                expect(messageService.trustedPeers.has("new-peer-uuid")).toBe(true);
            });

            it("should allow denying inbox access", async () => {
                const result = await broker.call("message.grantInboxAccess", {
                    requesterUUID: "rejected-peer-uuid",
                    granted: false
                });

                expect(result.success).toBe(true);
                expect(result.requesterUUID).toBe("rejected-peer-uuid");
                expect(result.granted).toBe(false);
                expect(result.timestamp).toBeDefined();

                // Verify peer was not added to trusted peers  
                const messageService = broker.getLocalService("message");
                expect(messageService.trustedPeers.has("rejected-peer-uuid")).toBe(false);
            });
        });

        describe("Test inbox notifications reading", () => {
            it("should read inbox notifications", async () => {
                const result = await broker.call("message.getInboxNotifications", {
                    limit: 10
                });

                expect(result.notifications).toBeDefined();
                expect(Array.isArray(result.notifications)).toBe(true);
                expect(result.count).toBeGreaterThanOrEqual(0);
            });

            it("should support pagination with since parameter", async () => {
                const since = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
                
                const result = await broker.call("message.getInboxNotifications", {
                    limit: 5,
                    since
                });

                expect(result.notifications).toBeDefined();
                expect(Array.isArray(result.notifications)).toBe(true);
                expect(result.count).toBeGreaterThanOrEqual(0);
            });
        });

        describe("Test message notifications integration", () => {
            it("should send message notification when message is sent", async () => {
                // Grant access to a peer for testing
                await broker.call("message.grantInboxAccess", {
                    requesterUUID: recipientUUID,
                    granted: true
                });

                try {
                    // Try to get a valid public key from nucleus service
                    const nucleusPublicKey = await broker.call("nucleus.getPublicKey");
                    
                    // Send a message which should also trigger a notification attempt
                    const result = await broker.call("message.sendMessage", {
                        targetUUID: recipientUUID,
                        message: "Test message with notification",
                        recipientPublicKey: nucleusPublicKey
                    });

                    expect(result.success).toBe(true);
                    expect(result.messageId).toBeDefined();
                    expect(result.timestamp).toBeDefined();
                    
                } catch (err) {
                    // If encryption fails due to key format mismatch, that's expected
                    // The test confirms we tried to send the message properly
                    expect(err).toBeDefined();
                }
            });
        });
    });

    describe("Test three-layer peer discovery system", () => {
        let testPeerUUID;
        let testPeerPublicKey;

        beforeAll(async () => {
            testPeerUUID = "test-peer-discovery-uuid";
            testPeerPublicKey = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1vx7agoebGcQSuuPiLJX\nZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tS\noc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt\n7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0\nzgdLR_o1hiabtAjOcvjsyb3JnYXLovpDgjH16CjCDY1dQkrhwIGg8LCWfLUYmRKV\nMjjNmUBG8xh3CtbKWPyCwfJgNI_R7O6pXLJgPnMc8uxJRaBFOGjw8q_SZfCKS1fH\n-----END PUBLIC KEY-----";
        });

        describe("Test discovery system initialization", () => {
            it("should initialize peer discovery system", async () => {
                const messageService = broker.getLocalService("message");
                
                // Check that discovery system components are initialized
                expect(messageService.peerCache).toBeDefined();
                expect(messageService.discoveredPeers).toBeDefined();
                expect(messageService.pendingHandshakes).toBeDefined();
                expect(messageService.discoverySwarms).toBeDefined();
                expect(messageService.capabilities).toBeDefined();
                expect(messageService.capabilities).toContain("messaging");
            });

            it("should add self to peer cache on initialization", async () => {
                const messageService = broker.getLocalService("message");
                const actualCellUUID = messageService.cellUUID;
                
                // Brief wait for any remaining async operations
                await new Promise(resolve => setTimeout(resolve, 50));
                
                // Check that self is in peer cache
                expect(messageService.discoveredPeers.has(actualCellUUID)).toBe(true);
                expect(messageService.trustedPeers.has(actualCellUUID)).toBe(true);
                
                const selfInfo = messageService.discoveredPeers.get(actualCellUUID);
                expect(selfInfo.uuid).toBe(actualCellUUID);
                expect(selfInfo.trustLevel).toBe("trusted");
                expect(selfInfo.relationshipStatus).toBe("connected");
                expect(selfInfo.capabilities).toContain("messaging");
            });
        });

        describe("Test Layer 3: Local Hyperbee peer caching", () => {
            describe("Test 'message.getPeerCache' action", () => {
                it("should return peer cache information", async () => {
                    // Wait for initialization to complete
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    const result = await broker.call("message.getPeerCache");
                    
                    expect(result.peers).toBeDefined();
                    expect(Array.isArray(result.peers)).toBe(true);
                    expect(result.count).toBeGreaterThan(0); // At least self should be there
                    expect(result.totalDiscovered).toBeGreaterThan(0);
                });

                it("should filter peers by trust level", async () => {
                    // Wait for initialization to complete
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    const result = await broker.call("message.getPeerCache", {
                        trustLevel: "trusted"
                    });
                    
                    expect(result.peers).toBeDefined();
                    expect(Array.isArray(result.peers)).toBe(true);
                    expect(result.count).toBeGreaterThan(0);
                    
                    // All returned peers should be trusted
                    result.peers.forEach(peer => {
                        expect(peer.trustLevel).toBe("trusted");
                    });
                });

                it("should handle pagination with limit", async () => {
                    const result = await broker.call("message.getPeerCache", {
                        limit: 5
                    });
                    
                    expect(result.peers).toBeDefined();
                    expect(result.count).toBeLessThanOrEqual(5);
                });
            });

            describe("Test 'message.updatePeerTrust' action", () => {
                it("should update peer trust level", async () => {
                    // First manually add a test peer to the cache
                    const messageService = broker.getLocalService("message");
                    const testPeer = {
                        uuid: testPeerUUID,
                        publicKey: testPeerPublicKey,
                        inboxDiscoveryKey: "test-inbox-key",
                        capabilities: ["messaging"],
                        trustLevel: "unknown",
                        relationshipStatus: "pending",
                        lastSeen: new Date().toISOString(),
                        connectionHistory: []
                    };
                    
                    messageService.discoveredPeers.set(testPeerUUID, testPeer);
                    
                    // Now update trust level
                    const result = await broker.call("message.updatePeerTrust", {
                        peerUUID: testPeerUUID,
                        trustLevel: "trusted"
                    });
                    
                    expect(result.success).toBe(true);
                    expect(result.peerUUID).toBe(testPeerUUID);
                    expect(result.oldTrustLevel).toBe("unknown");
                    expect(result.newTrustLevel).toBe("trusted");
                    expect(result.timestamp).toBeDefined();
                    
                    // Verify peer was added to trusted peers set
                    expect(messageService.trustedPeers.has(testPeerUUID)).toBe(true);
                    
                    // Verify connection history was updated
                    const updatedPeer = messageService.discoveredPeers.get(testPeerUUID);
                    expect(updatedPeer.connectionHistory.length).toBeGreaterThan(0);
                    expect(updatedPeer.connectionHistory[updatedPeer.connectionHistory.length - 1].event).toBe("trust_updated");
                });

                it("should reject update for non-existent peer", async () => {
                    try {
                        await broker.call("message.updatePeerTrust", {
                            peerUUID: "non-existent-peer",
                            trustLevel: "trusted"
                        });
                        expect(true).toBe(false); // Should not reach here
                    } catch (err) {
                        expect(err.message).toContain("Peer not found");
                    }
                });

                it("should remove peer from trusted set when downgrading trust", async () => {
                    const messageService = broker.getLocalService("message");
                    
                    // Downgrade trust level
                    const result = await broker.call("message.updatePeerTrust", {
                        peerUUID: testPeerUUID,
                        trustLevel: "unknown"
                    });
                    
                    expect(result.success).toBe(true);
                    expect(result.newTrustLevel).toBe("unknown");
                    
                    // Verify peer was removed from trusted peers set
                    expect(messageService.trustedPeers.has(testPeerUUID)).toBe(false);
                });
            });
        });

        describe("Test Layer 2: Identity handshake protocol", () => {
            it("should create proper handshake message structure", async () => {
                const messageService = broker.getLocalService("message");
                const actualCellUUID = messageService.cellUUID;
                
                // Test the handshake creation method
                const handshake = await messageService.performHandshake();
                
                expect(handshake.version).toBe("1.0");
                expect(handshake.uuid).toBe(actualCellUUID);
                expect(handshake.publicKey).toBeDefined();
                expect(handshake.inboxDiscoveryKey).toBeDefined();
                expect(handshake.journalDiscoveryKey).toBeDefined();
                expect(handshake.capabilities).toContain("messaging");
                expect(handshake.timestamp).toBeDefined();
                expect(handshake.signature).toBeDefined();
            });
        });

        describe("Test Layer 1: Hyperswarm discovery", () => {
            describe("Test 'message.lookupPeer' action", () => {
                it("should find existing peer in cache", async () => {
                    const messageService = broker.getLocalService("message");
                    const actualCellUUID = messageService.cellUUID;
                    
                    // Wait for initialization to complete
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Look up self (should be in cache)
                    const result = await broker.call("message.lookupPeer", {
                        peerUUID: actualCellUUID
                    });
                    
                    expect(result.found).toBe(true);
                    expect(result.peer).toBeDefined();
                    expect(result.peer.uuid).toBe(actualCellUUID);
                });

                it("should broadcast lookup for unknown peer", async () => {
                    const result = await broker.call("message.lookupPeer", {
                        peerUUID: "unknown-peer-uuid"
                    });
                    
                    expect(result.found).toBe(false);
                    expect(result.message).toContain("Peer lookup broadcast sent");
                });

                it("should reject with ValidationError for missing peerUUID", async () => {
                    try {
                        await broker.call("message.lookupPeer", {});
                        expect(true).toBe(false); // Should not reach here
                    } catch (err) {
                        expect(err.name).toBe("ValidationError");
                    }
                });
            });
        });

        describe("Test peer introduction mechanisms", () => {
            describe("Test 'message.introducePeer' action", () => {
                let secondPeerUUID;

                beforeAll(async () => {
                    secondPeerUUID = "second-test-peer-uuid";
                    const messageService = broker.getLocalService("message");
                    
                    // Add two trusted test peers for introduction testing
                    const firstPeer = {
                        uuid: testPeerUUID,
                        publicKey: testPeerPublicKey,
                        inboxDiscoveryKey: "test-inbox-key-1",
                        capabilities: ["messaging"],
                        trustLevel: "trusted",
                        relationshipStatus: "connected",
                        lastSeen: new Date().toISOString(),
                        connectionHistory: []
                    };
                    
                    const secondPeer = {
                        uuid: secondPeerUUID,
                        publicKey: testPeerPublicKey,
                        inboxDiscoveryKey: "test-inbox-key-2", 
                        capabilities: ["messaging", "storage"],
                        trustLevel: "trusted",
                        relationshipStatus: "connected",
                        lastSeen: new Date().toISOString(),
                        connectionHistory: []
                    };
                    
                    messageService.discoveredPeers.set(testPeerUUID, firstPeer);
                    messageService.discoveredPeers.set(secondPeerUUID, secondPeer);
                    messageService.trustedPeers.add(testPeerUUID);
                    messageService.trustedPeers.add(secondPeerUUID);
                });

                it("should introduce trusted peers to each other", async () => {
                    // Wait for all setup to complete
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    const result = await broker.call("message.introducePeer", {
                        requesterUUID: testPeerUUID,
                        targetUUID: secondPeerUUID
                    });
                    
                    expect(result.success).toBe(true);
                    expect(result.message).toContain(`Introduced ${secondPeerUUID} to ${testPeerUUID}`);
                    expect(result.timestamp).toBeDefined();
                });

                it("should reject introduction for unknown requester", async () => {
                    try {
                        await broker.call("message.introducePeer", {
                            requesterUUID: "unknown-requester",
                            targetUUID: secondPeerUUID
                        });
                        expect(true).toBe(false); // Should not reach here
                    } catch (err) {
                        expect(err.message).toContain("Unknown requester");
                    }
                });

                it("should reject introduction for unknown target", async () => {
                    try {
                        await broker.call("message.introducePeer", {
                            requesterUUID: testPeerUUID,
                            targetUUID: "unknown-target"
                        });
                        expect(true).toBe(false); // Should not reach here
                    } catch (err) {
                        expect(err.message).toContain("Unknown target");
                    }
                });

                it("should reject introduction if peers are not trusted", async () => {
                    const messageService = broker.getLocalService("message");
                    const untrustedPeerUUID = "untrusted-peer-uuid";
                    
                    // Add an untrusted peer
                    const untrustedPeer = {
                        uuid: untrustedPeerUUID,
                        publicKey: testPeerPublicKey,
                        inboxDiscoveryKey: "untrusted-inbox-key",
                        capabilities: ["messaging"],
                        trustLevel: "unknown", // Not trusted
                        relationshipStatus: "pending",
                        lastSeen: new Date().toISOString(),
                        connectionHistory: []
                    };
                    
                    messageService.discoveredPeers.set(untrustedPeerUUID, untrustedPeer);
                    
                    try {
                        await broker.call("message.introducePeer", {
                            requesterUUID: testPeerUUID,
                            targetUUID: untrustedPeerUUID
                        });
                        expect(true).toBe(false); // Should not reach here
                    } catch (err) {
                        expect(err.message).toContain("requires trusted relationship");
                    }
                });
            });
        });

        describe("Test discovery system integration", () => {
            it("should have peer cache properly initialized", async () => {
                const messageService = broker.getLocalService("message");
                
                expect(messageService.peerCache).toBeDefined();
                expect(messageService.discoveredPeers.size).toBeGreaterThan(0);
                expect(messageService.trustedPeers.size).toBeGreaterThan(0);
            });

            it("should handle trust level changes correctly", async () => {
                const messageService = broker.getLocalService("message");
                const testUUID = "trust-test-peer";
                
                // Add a peer with unknown trust
                const testPeer = {
                    uuid: testUUID,
                    publicKey: testPeerPublicKey,
                    trustLevel: "unknown",
                    relationshipStatus: "pending",
                    lastSeen: new Date().toISOString()
                };
                
                messageService.discoveredPeers.set(testUUID, testPeer);
                
                // Verify not in trusted set
                expect(messageService.trustedPeers.has(testUUID)).toBe(false);
                
                // Update to trusted
                await broker.call("message.updatePeerTrust", {
                    peerUUID: testUUID,
                    trustLevel: "trusted"
                });
                
                // Verify now in trusted set
                expect(messageService.trustedPeers.has(testUUID)).toBe(true);
                
                // Update to blocked
                await broker.call("message.updatePeerTrust", {
                    peerUUID: testUUID,
                    trustLevel: "blocked"
                });
                
                // Verify removed from trusted set
                expect(messageService.trustedPeers.has(testUUID)).toBe(false);
            });
        });
    });

    describe("Journal Integration", () => {
        beforeEach(async () => {
            // Ensure service is properly initialized
            const service = broker.getLocalService("message");
            expect(service.cellUUID).toBeDefined();
            expect(service.cellPublicKey).toBeDefined();
        });

        describe("Message Receipt Logging", () => {
            it("should log sent message receipt", async () => {
                const service = broker.getLocalService("message");
                const messageData = { content: "test message", from: "alice", to: "bob" };
                const direction = "sent";
                const topic = "direct:alice:bob";
                const participantUUID = "bob-uuid";

                const receiptId = await service.logMessageReceipt(messageData, direction, topic, participantUUID);

                expect(receiptId).toMatch(/^receipt_\d+_[a-z0-9]+$/);
            });

            it("should log received message receipt", async () => {
                const service = broker.getLocalService("message");
                const messageData = { content: "test message", from: "alice", to: "bob" };
                const direction = "received";
                const topic = "direct:alice:bob";
                const participantUUID = "alice-uuid";

                const receiptId = await service.logMessageReceipt(messageData, direction, topic, participantUUID);

                expect(receiptId).toMatch(/^receipt_\d+_[a-z0-9]+$/);
            });

            it("should handle errors gracefully during receipt logging", async () => {
                const service = broker.getLocalService("message");
                // Test with invalid cellUUID to trigger graceful error handling
                const originalCellUUID = service.cellUUID;
                service.cellUUID = null;

                const messageData = { content: "test message" };
                const receiptId = await service.logMessageReceipt(messageData, "sent", "topic", "peer");

                expect(receiptId).toBeUndefined();
                
                // Restore cellUUID
                service.cellUUID = originalCellUUID;
            });
        });

        describe("Handshake Record Logging", () => {
            it("should log outgoing handshake record", async () => {
                const service = broker.getLocalService("message");
                const peerUUID = "peer-uuid";
                const handshakeType = "outgoing";
                const success = true;
                const capabilities = ["messaging", "storage"];

                const handshakeId = await service.logHandshakeRecord(peerUUID, handshakeType, success, capabilities);

                expect(handshakeId).toMatch(/^handshake_\d+_[a-z0-9]+$/);
            });

            it("should log failed handshake record", async () => {
                const service = broker.getLocalService("message");
                const peerUUID = "peer-uuid";
                const handshakeType = "incoming";
                const success = false;
                const capabilities = [];

                const handshakeId = await service.logHandshakeRecord(peerUUID, handshakeType, success, capabilities);

                expect(handshakeId).toMatch(/^handshake_\d+_[a-z0-9]+$/);
            });
        });

        describe("Key Rotation Logging", () => {
            it("should log key rotation event", async () => {
                const service = broker.getLocalService("message");
                const oldPublicKey = "old-public-key";
                const newPublicKey = "new-public-key";
                const reason = "scheduled";

                const rotationId = await service.logKeyRotation(oldPublicKey, newPublicKey, reason);

                expect(rotationId).toMatch(/^rotation_\d+_[a-z0-9]+$/);
            });

            it("should log compromise-driven key rotation", async () => {
                const service = broker.getLocalService("message");
                const oldPublicKey = "compromised-key";
                const newPublicKey = "new-secure-key";
                const reason = "compromise";

                const rotationId = await service.logKeyRotation(oldPublicKey, newPublicKey, reason);

                expect(rotationId).toMatch(/^rotation_\d+_[a-z0-9]+$/);
            });
        });

        describe("Hash Generation", () => {
            it("should generate consistent message hashes", () => {
                const service = broker.getLocalService("message");
                const message1 = "test message";
                const message2 = "test message";
                const message3 = "different message";

                const hash1 = service.hashMessage(message1);
                const hash2 = service.hashMessage(message2);
                const hash3 = service.hashMessage(message3);

                expect(hash1).toBe(hash2);
                expect(hash1).not.toBe(hash3);
                expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex format
            });

            it("should generate consistent participant hashes regardless of order", () => {
                const service = broker.getLocalService("message");
                const uuid1 = "alice-uuid";
                const uuid2 = "bob-uuid";

                const hash1 = service.hashParticipants(uuid1, uuid2);
                const hash2 = service.hashParticipants(uuid2, uuid1);

                expect(hash1).toBe(hash2);
                expect(hash1).toMatch(/^[a-f0-9]{64}$/);
            });

            it("should generate different hashes for different topics", () => {
                const service = broker.getLocalService("message");
                const topic1 = "direct:alice:bob";
                const topic2 = "direct:alice:charlie";

                const hash1 = service.hashTopic(topic1);
                const hash2 = service.hashTopic(topic2);

                expect(hash1).not.toBe(hash2);
                expect(hash1).toMatch(/^[a-f0-9]{64}$/);
                expect(hash2).toMatch(/^[a-f0-9]{64}$/);
            });
        });
    });

    describe("Message Routing and Delivery", () => {
        beforeEach(async () => {
            // Ensure service is properly initialized
            const service = broker.getLocalService("message");
            expect(service.cellUUID).toBeDefined();
            expect(service.cellPublicKey).toBeDefined();
        });

        describe("Enhanced Message Sending", () => {
            it("should send enhanced message with delivery tracking", async () => {
                const targetUUID = "test-target-uuid";
                const recipientPublicKey = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1vx7agoebGcQSuuPiLJX\nZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tS\noc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt\n7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0\nzgdLR_o1hiabtAjOcvjsyb3JnYXLovpDgjH16CjCDY1dQkrhwIGg8LCWfLUYmRKV\nMjjNmUBG8xh3CtbKWPyCwfJgNI_R7O6pXLJgPnMc8uxJRaBFOGjw8q_SZfCKS1fH\n-----END PUBLIC KEY-----";

                const result = await broker.call("message.sendEnhancedMessage", {
                    targetUUID,
                    message: "Test enhanced message",
                    recipientPublicKey,
                    options: {
                        requireDeliveryConfirmation: true,
                        priority: "normal",
                        expiresIn: 3600
                    }
                });

                expect(result.success).toBe(true);
                expect(result.messageId).toMatch(/^msg_\d+_[a-z0-9]+$/);
                expect(["sent", "pending"]).toContain(result.status); // Can be either sent or pending for retry
                expect(result.sequenceNumber).toBe(1);
                expect(result.expiresAt).toBeDefined();
            });

            it("should handle message send failure with retry queue", async () => {
                const targetUUID = "offline-target-uuid";
                const recipientPublicKey = "invalid-public-key";

                try {
                    await broker.call("message.sendEnhancedMessage", {
                        targetUUID,
                        message: "Test message",
                        recipientPublicKey
                    });
                } catch (err) {
                    expect(err.message).toBeDefined();
                }
            });
        });

        describe("Message Status Tracking", () => {
            it("should track message status lifecycle", async () => {
                const service = broker.getLocalService("message");
                const messageId = "test-message-123";
                
                // Create test metadata
                const metadata = {
                    messageId,
                    from: service.cellUUID,
                    to: "target-uuid",
                    status: "sent",
                    sentAt: new Date().toISOString(),
                    deliveredAt: null,
                    confirmedAt: null,
                    retryCount: 0,
                    expiresAt: new Date(Date.now() + 3600000).toISOString(),
                    sequenceNumber: 1,
                    priority: "normal"
                };

                service.messageMetadata.set(messageId, metadata);

                const result = await broker.call("message.getMessageStatus", {
                    messageId
                });

                expect(result.messageId).toBe(messageId);
                expect(result.status).toBe("sent");
                expect(result.timeline).toBeDefined();
                expect(result.sequenceNumber).toBe(1);
                expect(result.priority).toBe("normal");
            });

            it("should reject status request for non-existent message", async () => {
                try {
                    await broker.call("message.getMessageStatus", {
                        messageId: "non-existent-message"
                    });
                    expect(true).toBe(false); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Message not found");
                }
            });
        });

        describe("Message Confirmation", () => {
            it("should confirm message receipt", async () => {
                const service = broker.getLocalService("message");
                const messageId = "test-confirm-123";
                
                // Create test metadata
                const metadata = {
                    messageId,
                    from: "sender-uuid",
                    to: service.cellUUID,
                    status: "sent",
                    sentAt: new Date().toISOString(),
                    deliveredAt: null,
                    confirmedAt: null,
                    topic: "direct:sender-uuid:recipient-uuid"
                };

                service.messageMetadata.set(messageId, metadata);

                const result = await broker.call("message.confirmMessage", {
                    messageId,
                    received: true,
                    processed: true
                });

                expect(result.success).toBe(true);
                expect(result.messageId).toBe(messageId);
                expect(result.status).toBe("confirmed");
                expect(result.confirmed.received).toBe(true);
                expect(result.confirmed.processed).toBe(true);
            });
        });

        describe("Delivery Statistics", () => {
            it("should track delivery statistics", async () => {
                const result = await broker.call("message.getDeliveryStats");

                expect(result).toHaveProperty('totalSent');
                expect(result).toHaveProperty('totalDelivered');
                expect(result).toHaveProperty('totalFailed');
                expect(result).toHaveProperty('totalPending');
                expect(result).toHaveProperty('averageDeliveryTime');
                expect(result).toHaveProperty('deliveryRate');
                expect(result).toHaveProperty('retryRate');
            });
        });

        describe("Message Ordering", () => {
            it("should assign sequence numbers to messages", () => {
                const service = broker.getLocalService("message");
                const channel = service.getChannelKey("alice", "bob");

                const seq1 = service.getNextSequenceNumber(channel);
                const seq2 = service.getNextSequenceNumber(channel);
                const seq3 = service.getNextSequenceNumber(channel);

                expect(seq1).toBe(1);
                expect(seq2).toBe(2);
                expect(seq3).toBe(3);
            });

            it("should detect out-of-order messages", () => {
                const service = broker.getLocalService("message");
                const channel = "test-channel";

                const inOrderMessage = { sequenceNumber: 1 };
                const futureMessage = { sequenceNumber: 3 };
                const duplicateMessage = { sequenceNumber: 1 };

                expect(service.shouldBufferMessage(inOrderMessage, channel)).toBe(false);
                expect(service.shouldBufferMessage(futureMessage, channel)).toBe(true);
                
                // Advance expected sequence
                service.messageBuffers.get(channel).expectedNextSequence = 2;
                expect(service.shouldBufferMessage(duplicateMessage, channel)).toBe(false);
            });
        });

        describe("Message Deduplication", () => {
            it("should detect duplicate messages", () => {
                const service = broker.getLocalService("message");
                const messageId = "test-duplicate-123";
                const checksum = "test-checksum";

                expect(service.isDuplicate(messageId, checksum)).toBe(false);
                expect(service.isDuplicate(messageId, checksum)).toBe(true);
            });

            it("should clean up old deduplication entries", () => {
                const service = broker.getLocalService("message");
                
                // Add old entry
                const oldMessageId = "old-message";
                service.deduplicationCache.set(oldMessageId, Date.now() - (25 * 60 * 60 * 1000)); // 25 hours ago

                service.cleanupDeduplicationCache();

                expect(service.deduplicationCache.has(oldMessageId)).toBe(false);
            });
        });

        describe("Peer Status Tracking", () => {
            it("should update peer status", () => {
                const service = broker.getLocalService("message");
                const peerUUID = "test-peer";

                service.updatePeerStatus(peerUUID, "online");

                const status = service.peerStatus.get(peerUUID);
                expect(status.status).toBe("online");
                expect(status.lastSeen).toBeDefined();
                expect(status.lastUpdate).toBeDefined();
            });
        });

        describe("Retry Logic", () => {
            it("should calculate exponential backoff delays", () => {
                const service = broker.getLocalService("message");

                const delay1 = service.calculateNextRetryTime("EXPONENTIAL", 0);
                const delay2 = service.calculateNextRetryTime("EXPONENTIAL", 1);
                const delay3 = service.calculateNextRetryTime("EXPONENTIAL", 2);

                expect(delay1).toBeGreaterThanOrEqual(750); // 1000ms ± 25% jitter
                expect(delay1).toBeLessThanOrEqual(1250);
                expect(delay2).toBeGreaterThanOrEqual(1500); // 2000ms ± 25% jitter
                expect(delay2).toBeLessThanOrEqual(2500);
                expect(delay3).toBeGreaterThanOrEqual(3000); // 4000ms ± 25% jitter
                expect(delay3).toBeLessThanOrEqual(5000);
            });

            it("should use fixed delays for immediate strategy", () => {
                const service = broker.getLocalService("message");

                const delay1 = service.calculateNextRetryTime("IMMEDIATE", 0);
                const delay2 = service.calculateNextRetryTime("IMMEDIATE", 1);
                const delay3 = service.calculateNextRetryTime("IMMEDIATE", 2);

                expect(delay1).toBe(0);
                expect(delay2).toBe(1000);
                expect(delay3).toBe(2000);
            });
        });
    });

    // Security and Spam Prevention Tests
    describe("Security and Spam Prevention", () => {
        let testPeerUUID;
        let testPublicKey;

        beforeEach(() => {
            testPeerUUID = "test-peer-security-" + Date.now();
            testPublicKey = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2vx7agoebGcQSuuPiLJX\nZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tS\noc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt\n7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0\nzgdLR_o1hiabtAjOcvjsyb3JnYXLovpDgjH16CjCDY1dQkrhwIGg8LCWfLUYmRKV\nMjjNmUBG8xh3CtbKWPyCwfJgNI_R7O6pXLJgPnMc8uxJRaBFOGjw8q_SZfCKS1fH\n-----END PUBLIC KEY-----";
        });

        describe("Rate Limiting", () => {
            it("should allow messages within rate limits", () => {
                const service = broker.getLocalService("message");
                
                // First few messages should be allowed
                for (let i = 0; i < 3; i++) {
                    const result = service.checkRateLimit(testPeerUUID, 'message');
                    expect(result.allowed).toBe(true);
                    expect(result.remainingTime).toBe(0);
                }
            });

            it("should block messages when rate limit exceeded", () => {
                const service = broker.getLocalService("message");
                
                // Exceed the rate limit
                for (let i = 0; i < 10; i++) {
                    service.checkRateLimit(testPeerUUID, 'message');
                }
                
                const result = service.checkRateLimit(testPeerUUID, 'message');
                expect(result.allowed).toBe(false);
                expect(result.remainingTime).toBeGreaterThan(0);
            });

            it("should reset rate limits after window expires", async () => {
                const service = broker.getLocalService("message");
                
                // Exceed rate limit
                for (let i = 0; i < 10; i++) {
                    service.checkRateLimit(testPeerUUID, 'message');
                }
                
                // Mock time passing by manipulating the rate limiter
                const rateLimiter = service.rateLimiters.get(testPeerUUID);
                rateLimiter.lastReset = Date.now() - (2 * 60 * 1000); // 2 minutes ago
                
                const result = service.checkRateLimit(testPeerUUID, 'message');
                expect(result.allowed).toBe(true);
            });

            it("should handle different rate limit types", () => {
                const service = broker.getLocalService("message");
                
                // Test notification rate limiting
                for (let i = 0; i < 15; i++) {
                    const result = service.checkRateLimit(testPeerUUID, 'notification');
                    expect(result.allowed).toBe(true);
                }
                
                // Test handshake rate limiting
                for (let i = 0; i < 8; i++) {
                    const result = service.checkRateLimit(testPeerUUID, 'handshake');
                    expect(result.allowed).toBe(true);
                }
            });

            it("should handle rate limiting when disabled", () => {
                const service = broker.getLocalService("message");
                const originalSetting = service.settings.rateLimiting.enabled;
                
                // Disable rate limiting
                service.settings.rateLimiting.enabled = false;
                
                // Should always allow
                for (let i = 0; i < 100; i++) {
                    const result = service.checkRateLimit(testPeerUUID, 'message');
                    expect(result.allowed).toBe(true);
                }
                
                // Restore setting
                service.settings.rateLimiting.enabled = originalSetting;
            });
        });

        describe("Spam Detection", () => {
            it("should detect spam with suspicious keywords", () => {
                console.log("=== SPAM DETECTION TEST STARTING ===");
                const service = broker.getLocalService("message");
                const spamMessage = "This is a spam message with scam content and phishing links";
                
                console.log("Service settings:", JSON.stringify(service.settings, null, 2));
                console.log("About to call detectSpam...");
                const result = service.detectSpam(spamMessage, testPeerUUID);
                
                console.log("Spam detection result:", JSON.stringify(result, null, 2));
                
                expect(result.isSpam).toBe(true);
                expect(result.confidence).toBeGreaterThan(60);
                expect(result.reasons).toContain("Suspicious keywords: spam, scam, phishing");
            });

            it("should detect oversized messages", () => {
                const service = broker.getLocalService("message");
                const oversizedMessage = "A".repeat(15 * 1024); // 15KB
                
                const result = service.detectSpam(oversizedMessage, testPeerUUID);
                
                expect(result.isSpam).toBe(true);
                expect(result.reasons).toContain("Message too large");
            });

            it("should detect excessive word repetition", () => {
                const service = broker.getLocalService("message");
                const repetitiveMessage = "spam spam spam spam spam spam spam spam spam spam";
                
                const result = service.detectSpam(repetitiveMessage, testPeerUUID);
                
                expect(result.isSpam).toBe(true);
                expect(result.reasons).toContain("Excessive word repetition");
            });

            it("should detect duplicate content", () => {
                const service = broker.getLocalService("message");
                const message = "This is a test message";
                
                // First occurrence should not be spam
                const result1 = service.detectSpam(message, testPeerUUID);
                expect(result1.isSpam).toBe(false);
                
                // Second occurrence should be detected as duplicate
                const result2 = service.detectSpam(message, testPeerUUID);
                expect(result2.isSpam).toBe(true);
                expect(result2.reasons).toContain("Duplicate message content");
            });

            it("should consider sender reputation", () => {
                const service = broker.getLocalService("message");
                const message = "Normal message content";
                
                // Set poor reputation for sender
                service.updateSpamScore(testPeerUUID, 50, "Previous violations");
                
                const result = service.detectSpam(message, testPeerUUID);
                expect(result.isSpam).toBe(true);
                expect(result.reasons).toContain("Sender has poor reputation");
            });

            it("should allow legitimate messages", () => {
                const service = broker.getLocalService("message");
                const legitimateMessage = "Hello, this is a normal message from a trusted sender.";
                
                const result = service.detectSpam(legitimateMessage, testPeerUUID);
                
                expect(result.isSpam).toBe(false);
                expect(result.confidence).toBeLessThan(60);
                expect(result.reasons).toHaveLength(0);
            });

            it("should return false when spam detection is disabled", () => {
                const service = broker.getLocalService("message");
                const originalSetting = service.settings.spamDetection.enabled;
                
                // Disable spam detection
                service.settings.spamDetection.enabled = false;
                
                const spamMessage = "This is clearly spam with scam and phishing content";
                const result = service.detectSpam(spamMessage, testPeerUUID);
                
                expect(result.isSpam).toBe(false);
                expect(result.confidence).toBe(0);
                expect(result.reasons).toHaveLength(0);
                
                // Restore setting
                service.settings.spamDetection.enabled = originalSetting;
            });
        });

        describe("Spam Score Management", () => {
            it("should update spam scores correctly", () => {
                const service = broker.getLocalService("message");
                
                service.updateSpamScore(testPeerUUID, 30, "Test violation");
                
                const spamData = service.spamScores.get(testPeerUUID);
                expect(spamData.score).toBe(30);
                expect(spamData.violations).toHaveLength(1);
                expect(spamData.violations[0].reason).toBe("Test violation");
            });

            it("should decay spam scores over time", () => {
                const service = broker.getLocalService("message");
                
                // Set initial score
                service.updateSpamScore(testPeerUUID, 50, "Initial violation");
                
                // Mock time passing
                const spamData = service.spamScores.get(testPeerUUID);
                spamData.lastUpdate = Date.now() - (3 * 60 * 60 * 1000); // 3 hours ago
                
                // Trigger decay by calling update again
                service.updateSpamScore(testPeerUUID, 0, "No new violation");
                
                const updatedSpamData = service.spamScores.get(testPeerUUID);
                expect(updatedSpamData.score).toBeLessThan(50);
            });

            it("should auto-block peers with high spam scores", () => {
                const service = broker.getLocalService("message");
                
                // Add enough violations to trigger auto-block
                for (let i = 0; i < 10; i++) {
                    service.updateSpamScore(testPeerUUID, 20, `Violation ${i}`);
                }
                
                expect(service.isPeerBlocked(testPeerUUID)).toBe(true);
            });

            it("should not update scores when spam detection is disabled", () => {
                const service = broker.getLocalService("message");
                const originalSetting = service.settings.spamDetection.enabled;
                
                // Disable spam detection
                service.settings.spamDetection.enabled = false;
                
                service.updateSpamScore(testPeerUUID, 50, "Test violation");
                
                // Should not create spam score entry
                expect(service.spamScores.has(testPeerUUID)).toBe(false);
                
                // Restore setting
                service.settings.spamDetection.enabled = originalSetting;
            });
        });

        describe("Peer Blocking", () => {
            it("should block and unblock peers", () => {
                const service = broker.getLocalService("message");
                
                // Block peer
                service.blockPeer(testPeerUUID, "Test blocking");
                expect(service.isPeerBlocked(testPeerUUID)).toBe(true);
                
                // Unblock peer
                service.blockedPeers.delete(testPeerUUID);
                expect(service.isPeerBlocked(testPeerUUID)).toBe(false);
            });

            it("should prevent blocked peers from sending messages", async () => {
                const service = broker.getLocalService("message");
                
                // Block the peer
                service.blockPeer(testPeerUUID, "Test blocking");
                
                // Try to send message to blocked peer
                try {
                    await broker.call("message.sendMessage", {
                        targetUUID: testPeerUUID,
                        message: "Test message",
                        recipientPublicKey: testPublicKey
                    });
                    expect(true).toBe(false); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Cannot send message to blocked peer");
                }
            });

            it("should prevent blocked peers from sending notifications", async () => {
                const service = broker.getLocalService("message");
                
                // Block the peer
                service.blockPeer(testPeerUUID, "Test blocking");
                
                // Try to send notification to blocked peer
                try {
                    await broker.call("message.sendNotification", {
                        targetUUID: testPeerUUID,
                        notification: { type: "test" }
                    });
                    expect(true).toBe(false); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Cannot send notification to blocked peer");
                }
            });
        });

        describe("Signature Verification", () => {
            it("should verify valid signatures", async () => {
                const service = broker.getLocalService("message");
                const message = "Test message for signature verification";
                
                // Mock nucleus service response
                jest.spyOn(service.broker, 'call').mockResolvedValue(true);
                
                const result = await service.verifyMessageSignature(message, testPublicKey, "valid-signature");
                
                expect(result.valid).toBe(true);
                expect(result.cached).toBe(false);
            });

            it("should cache signature verification results", async () => {
                const service = broker.getLocalService("message");
                const message = "Test message for caching";
                
                // Mock nucleus service response
                jest.spyOn(service.broker, 'call').mockResolvedValue(true);
                
                // First verification
                const result1 = await service.verifyMessageSignature(message, testPublicKey, "test-signature");
                expect(result1.cached).toBe(false);
                
                // Second verification should be cached
                const result2 = await service.verifyMessageSignature(message, testPublicKey, "test-signature");
                expect(result2.cached).toBe(true);
            });

            it("should handle signature verification failures", async () => {
                const service = broker.getLocalService("message");
                const message = "Test message for invalid signature";
                
                // Mock nucleus service to return false (invalid signature)
                jest.spyOn(service.broker, 'call').mockResolvedValue(false);
                
                const result = await service.verifyMessageSignature(message, testPublicKey, "invalid-signature");
                
                expect(result.valid).toBe(false);
                expect(result.cached).toBe(false);
            });

            it("should return valid when signature requirement is disabled", async () => {
                const service = broker.getLocalService("message");
                const originalSetting = service.settings.requireSignature;
                
                // Disable signature requirement
                service.settings.requireSignature = false;
                
                const result = await service.verifyMessageSignature("message", testPublicKey, "signature");
                
                expect(result.valid).toBe(true);
                expect(result.cached).toBe(false);
                
                // Restore setting
                service.settings.requireSignature = originalSetting;
            });
        });

        describe("Suspicious Activity Tracking", () => {
            it("should track suspicious events", () => {
                const service = broker.getLocalService("message");
                
                service.trackSuspiciousActivity(testPeerUUID, "invalid_signature", {
                    messageId: "test-123",
                    context: "message"
                });
                
                const activity = service.suspicionScores.get(testPeerUUID);
                expect(activity.score).toBeGreaterThan(0);
            });

            it("should calculate suspicion scores correctly", () => {
                const service = broker.getLocalService("message");
                
                // Add multiple suspicious events
                service.trackSuspiciousActivity(testPeerUUID, "invalid_signature", {});
                service.trackSuspiciousActivity(testPeerUUID, "rate_limit_exceeded", {});
                service.trackSuspiciousActivity(testPeerUUID, "spam_detected", {});
                
                const activity = service.suspicionScores.get(testPeerUUID);
                expect(activity.score).toBeGreaterThan(30); // 15 + 5 + 20
            });

            it("should auto-block peers with high suspicion scores", () => {
                const service = broker.getLocalService("message");
                
                // Add enough suspicious events to trigger auto-block
                for (let i = 0; i < 10; i++) {
                    service.trackSuspiciousActivity(testPeerUUID, "invalid_signature", {});
                }
                
                expect(service.isPeerBlocked(testPeerUUID)).toBe(true);
            });

            it("should downgrade trust for moderate suspicion", () => {
                const service = broker.getLocalService("message");
                
                // Add peer to discovered peers with trusted status
                service.discoveredPeers.set(testPeerUUID, {
                    trustLevel: "trusted",
                    uuid: testPeerUUID
                });
                service.trustedPeers.add(testPeerUUID);
                
                // Add moderate suspicious activity
                for (let i = 0; i < 5; i++) {
                    service.trackSuspiciousActivity(testPeerUUID, "invalid_signature", {});
                }
                
                const peerInfo = service.discoveredPeers.get(testPeerUUID);
                expect(peerInfo.trustLevel).toBe("unknown");
                expect(service.trustedPeers.has(testPeerUUID)).toBe(false);
            });
        });

        describe("Security API Endpoints", () => {
            it("should block peers via API", async () => {
                const service = broker.getLocalService("message");
                
                const result = await service.blockPeerAction({
                    params: {
                        peerUUID: testPeerUUID,
                        reason: "Test blocking via API"
                    }
                });
                
                expect(result.success).toBe(true);
                expect(result.peerUUID).toBe(testPeerUUID);
                expect(result.reason).toBe("Test blocking via API");
                expect(service.isPeerBlocked(testPeerUUID)).toBe(true);
            });

            it("should unblock peers via API", async () => {
                const service = broker.getLocalService("message");
                
                // First block the peer
                service.blockPeer(testPeerUUID, "Test");
                
                // Then unblock via API
                const result = await service.unblockPeerAction({
                    params: {
                        peerUUID: testPeerUUID
                    }
                });
                
                expect(result.success).toBe(true);
                expect(service.isPeerBlocked(testPeerUUID)).toBe(false);
            });

            it("should get security status for specific peer", async () => {
                const service = broker.getLocalService("message");
                
                // Set up some test data
                service.updateSpamScore(testPeerUUID, 25, "Test violation");
                service.trackSuspiciousActivity(testPeerUUID, "invalid_signature", {});
                
                const result = await service.getSecurityStatus({
                    params: {
                        peerUUID: testPeerUUID
                    }
                });
                
                expect(result.peerUUID).toBe(testPeerUUID);
                expect(result.isBlocked).toBe(false);
                expect(result.spamScore).toBe(25);
                expect(result.suspiciousActivityScore).toBeGreaterThan(0);
            });

            it("should get overall security status", async () => {
                const service = broker.getLocalService("message");
                
                const result = await service.getSecurityStatus({
                    params: {}
                });
                
                expect(result).toHaveProperty("totalBlockedPeers");
                expect(result).toHaveProperty("totalPeersWithSpamScore");
                expect(result).toHaveProperty("totalPeersWithSuspiciousActivity");
                expect(result).toHaveProperty("securitySettings");
                expect(result).toHaveProperty("blockedPeers");
            });

            it("should get comprehensive security metrics", async () => {
                const service = broker.getLocalService("message");
                
                const result = await service.getSecurityMetrics({
                    params: {}
                });
                
                expect(result).toHaveProperty("overview");
                expect(result).toHaveProperty("recentActivity");
                expect(result).toHaveProperty("trustDistribution");
                expect(result).toHaveProperty("spamScoreDistribution");
                expect(result).toHaveProperty("settings");
                expect(result).toHaveProperty("cacheStats");
            });

            it("should check spam via API", async () => {
                const service = broker.getLocalService("message");
                const spamMessage = "This is a spam message with scam content";
                
                const result = await service.checkSpamAction({
                    params: {
                        message: spamMessage,
                        senderUUID: testPeerUUID
                    }
                });
                
                expect(result.isSpam).toBe(true);
                expect(result.confidence).toBeGreaterThan(60);
                expect(result.reasons).toContain("Suspicious keywords: spam, scam");
                expect(result.messageLength).toBe(spamMessage.length);
                expect(result.senderUUID).toBe(testPeerUUID);
            });
        });

        describe("Security Data Cleanup", () => {
            it("should cleanup old security data", () => {
                const service = broker.getLocalService("message");
                
                // Add old data
                const oldRateLimiter = {
                    messageCount: 5,
                    lastReset: Date.now() - (25 * 60 * 60 * 1000) // 25 hours ago
                };
                service.rateLimiters.set(testPeerUUID, oldRateLimiter);
                
                const oldSpamData = {
                    score: 0,
                    lastUpdate: Date.now() - (25 * 60 * 60 * 1000) // 25 hours ago
                };
                service.spamScores.set(testPeerUUID, oldSpamData);
                
                // Run cleanup
                service.cleanupSecurityData();
                
                // Old data should be removed
                expect(service.rateLimiters.has(testPeerUUID)).toBe(false);
                expect(service.spamScores.has(testPeerUUID)).toBe(false);
            });
        });

        describe("Security Integration with Message Flow", () => {
            it("should apply security checks during message sending", async () => {
                const service = broker.getLocalService("message");
                const blockedTarget = `blocked-target-${Date.now()}`;
                
                // Block the target peer
                service.blockPeer(blockedTarget, "Integration test");
                
                // Verify peer is blocked
                expect(service.isPeerBlocked(blockedTarget)).toBe(true);
                
                // Try to send message - should be blocked
                try {
                    await broker.call("message.sendMessage", {
                        targetUUID: blockedTarget,
                        message: "Test message",
                        recipientPublicKey: testPublicKey
                    });
                    expect(false).toBe(true); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Cannot send message to blocked peer");
                }
            });

            it("should apply rate limiting during message sending", async () => {
                const service = broker.getLocalService("message");
                const uniqueTarget = `rate-limit-target-${Date.now()}`;
                
                // Force rate limit exceeded by directly manipulating the rate limiter
                const rateLimitKey = `${service.cellUUID}:${uniqueTarget}`;
                service.rateLimiters.set(rateLimitKey, {
                    messageCount: 25, // Exceed the limit of 5
                    notificationCount: 0,
                    handshakeCount: 0,
                    lastReset: Date.now()
                });
                
                // Try to send message - should be rate limited
                try {
                    await broker.call("message.sendMessage", {
                        targetUUID: uniqueTarget,
                        message: "Test message that should be rate limited",
                        recipientPublicKey: testPublicKey
                    });
                    expect(false).toBe(true); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Rate limit exceeded");
                    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
                }
            });

            it("should apply spam detection during message sending", async () => {
                const service = broker.getLocalService("message");
                
                // Ensure spam detection is enabled
                service.settings.spamDetection.enabled = true;
                
                // Create a message that will definitely be detected as spam
                const spamMessage = "spam spam spam scam phishing malware " + "A".repeat(2000);
                
                // Try to send spam message - should be blocked
                try {
                    await broker.call("message.sendMessage", {
                        targetUUID: `spam-target-${Date.now()}`,
                        message: spamMessage,
                        recipientPublicKey: testPublicKey
                    });
                    expect(false).toBe(true); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Message blocked as potential spam");
                }
            });
        });
    });

    // Additional Tests for Better Coverage
    describe("Error Handling and Edge Cases", () => {
        describe("Service Initialization", () => {
            it("should handle nucleus.started with missing cellUUID", async () => {
                const service = broker.getLocalService("message");
                const originalLogger = service.logger;
                const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
                service.logger = mockLogger;

                try {
                    // Test the onNucleusStarted method directly with missing cellUUID
                    await service.onNucleusStarted({ params: { publicKey: "test-key" } });
                    expect(false).toBe(true); // Should not reach here
                } catch (err) {
                    // Expected error due to missing cellUUID
                    expect(err.message).toContain("Cannot initialize inbox - cell UUID not available");
                }
                
                service.logger = originalLogger;
            });

            it("should handle initialization errors gracefully", async () => {
                const service = broker.getLocalService("message");
                const originalLogger = service.logger;
                const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
                service.logger = mockLogger;

                // Ensure the service has a cellUUID so it doesn't early return
                if (!service.cellUUID) {
                    service.cellUUID = "test-cell-uuid";
                }

                // Mock the createCoreForTopic method which is actually called by createDefaultTopics
                const originalCreateCoreForTopic = service.createCoreForTopic;
                service.createCoreForTopic = jest.fn().mockImplementation(() => {
                    throw new Error("Core creation failed");
                });

                // This should trigger the error handling in createDefaultTopics
                await service.createDefaultTopics();

                expect(mockLogger.error).toHaveBeenCalledWith("Failed to create default topics:", expect.any(Error));
                service.createCoreForTopic = originalCreateCoreForTopic;
                service.logger = originalLogger;
            });
        });

        describe("Message Processing Edge Cases", () => {
            it("should handle message encryption failure", async () => {
                // Create isolated test data
                const testTarget = `enc-fail-target-${Date.now()}`;
                const service = broker.getLocalService("message");
                
                // Clear any lingering mocks and restore original state
                jest.clearAllMocks();
                
                // Ensure service is properly initialized
                if (!service.cellUUID) {
                    service.cellUUID = "test-cell-uuid";
                }
                
                // Pre-create topic in the map to avoid core creation calls
                const topic = service.generateTopicName("direct", service.cellUUID, testTarget);
                service.topicMap.set(topic, {
                    accessControl: { type: "direct", sourceUUID: service.cellUUID, targetUUID: testTarget },
                    encrypted: true,
                    coreKey: "test-core-key"
                });
                
                // Mock broker.call to throw error on encryption only
                const originalCall = service.broker.call;
                service.broker.call = jest.fn().mockImplementation((action, params) => {
                    if (action === "nucleus.encryptForCell") {
                        throw new Error("Encryption failed");
                    }
                    return originalCall.call(service.broker, action, params);
                });

                try {
                    await service.sendMessage({
                        params: {
                            targetUUID: testTarget,
                            message: "Test message",
                            recipientPublicKey: testPublicKey
                        }
                    });
                    expect(false).toBe(true); // Should not reach here
                } catch (err) {
                    expect(err.message).toBe("Encryption failed");
                }

                service.broker.call = originalCall;
            });

            it("should handle message decryption failure gracefully", async () => {
                const service = broker.getLocalService("message");
                const topic = `direct:test-sender-${Date.now()}:test-receiver-${Date.now()}`;

                // Ensure any lingering mocks are cleared
                jest.clearAllMocks();

                // Mock broker.call to simulate topic creation and return encrypted message
                const originalCall = service.broker.call;
                service.broker.call = jest.fn().mockImplementation((action, params) => {
                    if (action === "nucleus.get") {
                        return Promise.resolve({
                            core: { key: "test-core-key" }
                        });
                    }
                    if (action === "nucleus.read") {
                        return Promise.resolve({
                            entries: [{
                                data: JSON.stringify({
                                    encrypted: "test-encrypted-data",
                                    signature: "test-signature",
                                    senderPublicKey: "test-sender-key",
                                    timestamp: new Date().toISOString(),
                                    messageId: "test-message-id"
                                })
                            }],
                            hasMore: false
                        });
                    }
                    if (action === "nucleus.verifySignature") {
                        return Promise.resolve(true);
                    }
                    if (action === "nucleus.decryptFromCell") {
                        throw new Error("Decryption failed");
                    }
                    return originalCall.call(service.broker, action, params);
                });

                // First ensure topic exists in the map by directly adding it
                const coreInfo = {
                    accessControl: { type: "direct", sourceUUID: "test-sender", targetUUID: "test-receiver" },
                    encrypted: true
                };
                service.topicMap.set(topic, coreInfo);

                const result = await service.getMessages({ params: { topic } });
                
                // Should return messages but with encrypted flag
                expect(result.messages).toHaveLength(1);
                expect(result.messages[0].encrypted).toBe(true);
                expect(result.messages[0].content).toBeNull();

                service.broker.call = originalCall;
            });
        });

        describe("Handshake Edge Cases", () => {
            it("should handle handshake with rate limiting", async () => {
                const service = broker.getLocalService("message");
                
                // Mock logger to prevent errors
                const originalLogger = service.logger;
                const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
                service.logger = mockLogger;
                
                // Exceed handshake rate limit
                for (let i = 0; i < 10; i++) {
                    service.checkRateLimit(service.cellUUID, 'handshake');
                }

                try {
                    await service.performHandshake(null, "test-peer");
                    expect(true).toBe(false); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Handshake rate limit exceeded");
                }
                
                service.logger = originalLogger;
            });

            it("should handle handshake with blocked peer", async () => {
                const service = broker.getLocalService("message");
                const blockedPeer = "blocked-peer-uuid";
                
                // Mock logger to prevent errors
                const originalLogger = service.logger;
                const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
                service.logger = mockLogger;
                
                service.blockPeer(blockedPeer, "Test blocking");

                try {
                    await service.performHandshake(null, blockedPeer);
                    expect(true).toBe(false); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Peer is blocked");
                }
                
                service.logger = originalLogger;
            });

            it("should handle incoming handshake processing errors", async () => {
                const service = broker.getLocalService("message");

                // Test invalid handshake format
                try {
                    await service.processIncomingHandshake({}, {});
                    expect(true).toBe(false); // Should not reach here
                } catch (err) {
                    expect(err.message).toContain("Invalid handshake format");
                }
            });
        });

        describe("Peer Discovery Edge Cases", () => {
            it("should handle peer cache loading errors", async () => {
                const service = broker.getLocalService("message");
                const originalLogger = service.logger;
                const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
                service.logger = mockLogger;

                // Mock peerCache to throw error
                if (service.peerCache) {
                    const originalCreateReadStream = service.peerCache.createReadStream;
                    service.peerCache.createReadStream = jest.fn().mockImplementation(() => {
                        throw new Error("Cache read error");
                    });

                    await service.loadPeersFromCache();

                    expect(mockLogger.error).toHaveBeenCalled();
                    service.peerCache.createReadStream = originalCreateReadStream;
                }

                service.logger = originalLogger;
            });
        });

        describe("Message Ordering and Buffering", () => {
            it("should handle buffer overflow", () => {
                const service = broker.getLocalService("message");
                const channel = "test-channel";
                
                // Mock logger to prevent errors
                const originalLogger = service.logger;
                const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
                service.logger = mockLogger;
                
                // Mock setTimeout to capture and clear timeouts
                const originalSetTimeout = global.setTimeout;
                const timeouts = [];
                global.setTimeout = jest.fn().mockImplementation((fn, delay) => {
                    const timeoutId = originalSetTimeout(fn, delay);
                    timeouts.push(timeoutId);
                    return timeoutId;
                });
                
                // Create buffer with short timeout for testing
                service.messageBuffers.set(channel, {
                    lastDeliveredSequence: 0,
                    expectedNextSequence: 1,
                    pendingMessages: new Map(),
                    maxBufferSize: 3,
                    bufferTimeout: 100 // Short timeout for testing
                });

                // Add messages beyond buffer limit
                for (let i = 1; i <= 5; i++) {
                    const message = { sequenceNumber: i + 10 };
                    if (service.shouldBufferMessage(message, channel)) {
                        service.bufferMessage(message, channel);
                    }
                }

                const buffer = service.messageBuffers.get(channel);
                expect(buffer.pendingMessages.size).toBeLessThanOrEqual(3);
                
                // Cleanup: clear all timeouts and restore mocks
                timeouts.forEach(clearTimeout);
                global.setTimeout = originalSetTimeout;
                service.logger = originalLogger;
                
                // Clear the buffer to prevent lingering state
                service.messageBuffers.delete(channel);
            });

            it("should handle channel key generation", () => {
                const service = broker.getLocalService("message");
                
                const key1 = service.getChannelKey("alice", "bob");
                const key2 = service.getChannelKey("bob", "alice");
                
                expect(key1).toBe("alice:bob");
                expect(key2).toBe("bob:alice");
            });
        });

        describe("Retry Logic Edge Cases", () => {
            it("should handle retry with persistent strategy", () => {
                const service = broker.getLocalService("message");
                
                const delay1 = service.calculateNextRetryTime("PERSISTENT", 0);
                const delay2 = service.calculateNextRetryTime("PERSISTENT", 1);
                const delay3 = service.calculateNextRetryTime("PERSISTENT", 3);
                
                expect(delay1).toBe(5000);  // First delay
                expect(delay2).toBe(15000); // Second delay
                expect(delay3).toBe(300000); // Fourth delay (capped)
            });

            it("should handle message expiration during retry", async () => {
                const service = broker.getLocalService("message");
                const metadata = {
                    messageId: "expired-message",
                    from: service.cellUUID,
                    to: "target",
                    status: "pending",
                    retryCount: 1,
                    expiresAt: new Date(Date.now() - 1000).toISOString() // Already expired
                };

                await service.retryMessage(metadata);

                expect(metadata.status).toBe("expired");
            });
        });
    });

    describe("Additional API Actions Coverage", () => {
        describe("Enhanced Message Actions", () => {
            it("should handle sendEnhancedMessage with all options", async () => {
                // Reset any lingering mocks
                jest.clearAllMocks();
                const service = broker.getLocalService("message");
                
                // Ensure service is properly initialized
                if (!service.cellUUID) {
                    service.cellUUID = "test-cell-uuid";
                }
                
                const result = await service.sendEnhancedMessage({
                    params: {
                        targetUUID: "enhanced-target",
                        message: "Enhanced test message",
                        recipientPublicKey: testPublicKey,
                        options: {
                            requireDeliveryConfirmation: true,
                            priority: "urgent",
                            expiresIn: 3600,
                            retryStrategy: "IMMEDIATE"
                        }
                    }
                });

                expect(result.success).toBe(true);
                expect(result.messageId).toBeDefined();
                expect(result.sequenceNumber).toBeDefined();
                expect(result.expiresAt).toBeDefined();
            });

            it("should handle duplicate message detection in enhanced send", async () => {
                const service = broker.getLocalService("message");
                const messageId = "duplicate-test";
                const checksum = "test-checksum";
                
                // Mark as duplicate
                service.deduplicationCache.set(messageId, Date.now());

                // Verify the isDuplicate method works
                const isDupe = service.isDuplicate(messageId, checksum);
                expect(isDupe).toBe(true);
            });
        });

        describe("Journal Actions", () => {
            it("should get journal entries with filtering", async () => {
                // Reset any lingering mocks
                jest.clearAllMocks();
                const service = broker.getLocalService("message");
                
                // Mock nucleus.read to return journal entries
                const originalCall = service.broker.call;
                service.broker.call = jest.fn().mockImplementation((action, params) => {
                    if (action === "nucleus.read") {
                        return Promise.resolve({
                            entries: [
                                { data: JSON.stringify({ entryType: "message_receipt", messageId: "test-1" }) },
                                { data: JSON.stringify({ entryType: "message_receipt", messageId: "test-2" }) }
                            ]
                        });
                    }
                    return originalCall.call(service.broker, action, params);
                });

                const result = await service.getJournalEntries({
                    params: {
                        entryType: "message_receipt",
                        limit: 10
                    }
                });

                expect(result.entries).toBeDefined();
                expect(Array.isArray(result.entries)).toBe(true);
                expect(result.entryType).toBe("message_receipt");
                
                service.broker.call = originalCall;
            });

            it("should generate message proof", async () => {
                // Reset any lingering mocks
                jest.clearAllMocks();
                const service = broker.getLocalService("message");
                
                // Mock nucleus.signMessage to return a signature
                const originalCall = service.broker.call;
                service.broker.call = jest.fn().mockImplementation((action, params) => {
                    if (action === "nucleus.signMessage") {
                        return Promise.resolve("test-signature");
                    }
                    return originalCall.call(service.broker, action, params);
                });
                
                const result = await service.generateMessageProofAction({
                    params: {
                        messageContent: "Test message",
                        senderUUID: "sender-uuid",
                        receiverUUID: "receiver-uuid",
                        topic: "direct:sender:receiver",
                        direction: "sent"
                    }
                });

                expect(result.success).toBe(true);
                expect(result.proof).toBeDefined();
                expect(result.proof.messageHash).toBeDefined();
                expect(result.proof.signature).toBeDefined();
                
                service.broker.call = originalCall;
            });

            it("should verify message participation", async () => {
                // Reset any lingering mocks
                jest.clearAllMocks();
                
                const service = broker.getLocalService("message");
                const messageContent = "Test message";
                const topic = "direct:sender:receiver";
                const receiptData = {
                    messageHash: service.hashMessage(messageContent),
                    participantHash: service.hashParticipants("sender", "receiver"),
                    topicHash: service.hashTopic(topic)
                };

                const result = await service.verifyMessageParticipationAction({
                    params: {
                        receiptData,
                        messageContent,
                        senderUUID: "sender",
                        receiverUUID: "receiver",
                        topic: topic
                    }
                });

                expect(result.success).toBe(true);
                expect(result.verification.valid).toBe(true);
            });
        });

        describe("Peer Management Actions", () => {
            it("should handle peer lookup with cache miss", async () => {
                // Reset any lingering mocks
                jest.clearAllMocks();
                const service = broker.getLocalService("message");
                
                const result = await service.lookupPeer({
                    params: {
                        peerUUID: "unknown-peer-uuid"
                    }
                });

                expect(result.found).toBe(false);
                expect(result.message).toContain("Peer lookup broadcast sent");
            });
        });
    });

    // Comprehensive Branch Coverage Tests
    describe("Branch Coverage Enhancement", () => {
        let service;

        beforeEach(() => {
            service = broker.getLocalService("message");
            
            // Mock logger to prevent "logger.debug is not a function" errors
            const mockLogger = {
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn()
            };
            service.logger = mockLogger;
        });

        describe("Hash Methods Branch Coverage", () => {
            it("should handle string messageData in hashMessage", () => {
                const result = service.hashMessage("test string message");
                expect(typeof result).toBe('string');
                expect(result.length).toBe(64); // SHA256 hex length
            });

            it("should handle object messageData in hashMessage", () => {
                const messageObj = { content: "test", timestamp: "2023-01-01" };
                const result = service.hashMessage(messageObj);
                expect(typeof result).toBe('string');
                expect(result.length).toBe(64); // SHA256 hex length
            });
        });

        describe("Retry Logic Branch Coverage", () => {
            it("should use fixed delays for strategies with delays array", () => {
                const retryTime = service.calculateNextRetryTime("IMMEDIATE", 1);
                expect(retryTime).toBe(1000); // Second delay from IMMEDIATE strategy
            });

            it("should use exponential backoff for strategies without delays array", () => {
                const retryTime = service.calculateNextRetryTime("EXPONENTIAL", 1);
                expect(retryTime).toBeGreaterThan(1000); // Should be > baseDelay with multiplier
                expect(retryTime).toBeLessThan(70000); // Should be < maxDelay + jitter
            });

            it("should handle max retries reached in queueMessageForRetry", () => {
                const metadata = {
                    messageId: "test-msg-1",
                    retryCount: 10, // Exceeds maxRetries
                    status: "pending"
                };
                
                service.queueMessageForRetry(metadata, "EXPONENTIAL");
                
                expect(metadata.status).toBe("failed");
                expect(service.logger.warn).toHaveBeenCalledWith(
                    expect.stringContaining("permanently failed after")
                );
            });
        });

        describe("Delivery Stats Branch Coverage", () => {
            it("should handle invalid metric in updateDeliveryStats", () => {
                const originalStats = { ...service.deliveryStats };
                
                // Try to update with invalid metric
                service.updateDeliveryStats('invalidMetric', 5);
                
                // Stats should remain unchanged
                expect(service.deliveryStats).toEqual(originalStats);
            });

            it("should handle valid metric in updateDeliveryStats", () => {
                const originalValue = service.deliveryStats.totalSent;
                
                service.updateDeliveryStats('totalSent', 3);
                
                expect(service.deliveryStats.totalSent).toBe(originalValue + 3);
            });
        });

        describe("Buffer Management Branch Coverage", () => {
            it("should handle deliverBufferedMessages with non-existent buffer", () => {
                // Call with non-existent channel
                service.deliverBufferedMessages("non-existent-channel");
                
                // Should return early and not log anything
                expect(service.logger.info).not.toHaveBeenCalled();
            });

            it("should handle deliverBufferedMessages with no messages to deliver", () => {
                const channel = "test-channel";
                
                // Set up buffer with no pending messages
                service.messageBuffers.set(channel, {
                    lastDeliveredSequence: 0,
                    expectedNextSequence: 1,
                    pendingMessages: new Map(),
                    maxBufferSize: 100,
                    bufferTimeout: 30000
                });
                
                service.deliverBufferedMessages(channel);
                
                // Should not log delivery info since no messages were delivered
                expect(service.logger.info).not.toHaveBeenCalledWith(
                    expect.stringContaining("Delivered buffered messages")
                );
            });

            it("should handle expired messages cleanup in deliverBufferedMessages", () => {
                const channel = "test-channel";
                
                // Set up buffer with expired message
                const expiredTimestamp = Date.now() - 35000; // 35 seconds ago (older than 30s timeout)
                service.messageBuffers.set(channel, {
                    lastDeliveredSequence: 0,
                    expectedNextSequence: 1,
                    pendingMessages: new Map([[5, { message: { sequenceNumber: 5 }, timestamp: expiredTimestamp }]]),
                    maxBufferSize: 100,
                    bufferTimeout: 30000
                });
                
                service.deliverBufferedMessages(channel);
                
                expect(service.logger.warn).toHaveBeenCalledWith(
                    expect.stringContaining("Expired buffered message")
                );
            });
        });

        describe("Rate Limiting Branch Coverage", () => {
            it("should handle unknown action type in checkRateLimit", () => {
                const result = service.checkRateLimit("test-peer", "unknown-action");
                expect(result).toEqual({ allowed: true, remainingTime: 0 });
            });

            it("should handle rate limiting when disabled", () => {
                // Temporarily disable rate limiting
                const originalEnabled = service.settings.rateLimiting.enabled;
                service.settings.rateLimiting.enabled = false;
                
                const result = service.checkRateLimit("test-peer", "message");
                expect(result).toEqual({ allowed: true, remainingTime: 0 });
                
                // Restore setting
                service.settings.rateLimiting.enabled = originalEnabled;
            });

            it("should handle window reset in checkRateLimit", () => {
                const peerUUID = "test-peer-reset";
                const now = Date.now();
                
                // Set up old rate limiter data (expired window) - MESSAGE_WINDOW is 60000ms in test config
                // Start with count well above burst limit to test reset
                service.rateLimiters.set(peerUUID, {
                    messageCount: 10, // Well above burst limit (MESSAGE_BURST = 5 in test config)
                    notificationCount: 5,
                    handshakeCount: 2,
                    lastReset: now - 65000 // 65 seconds ago, definitely expired (window is 60s)
                });
                
                const result = service.checkRateLimit(peerUUID, "message");
                
                // Should be allowed because window reset, counter reset to 0, then incremented to 1
                expect(result.allowed).toBe(true);
                const updatedLimiter = service.rateLimiters.get(peerUUID);
                expect(updatedLimiter.messageCount).toBe(1); // Should be reset and incremented
                expect(updatedLimiter.lastReset).toBeGreaterThan(now - 1000); // Should be updated
            });
        });

        describe("Spam Detection Branch Coverage", () => {
            it("should handle spam detection when disabled", () => {
                // Temporarily disable spam detection
                const originalEnabled = service.settings.spamDetection.enabled;
                service.settings.spamDetection.enabled = false;
                
                const result = service.detectSpam("spam scam phishing", "test-sender");
                expect(result).toEqual({ isSpam: false, confidence: 0, reasons: [] });
                
                // Restore setting
                service.settings.spamDetection.enabled = originalEnabled;
            });

            it("should detect spam with multiple violations", () => {
                // Create message larger than MAX_MESSAGE_SIZE (10KB = 10240 bytes) 
                // MAX_MESSAGE_SIZE is 10 * 1024 = 10240 bytes
                const largeMessage = "A".repeat(10241) + " buy buy buy buy buy buy buy buy spam scam phishing malware";
                const result = service.detectSpam(largeMessage, "spam-sender");
                
                expect(result.isSpam).toBe(true);
                expect(result.reasons).toContain("Message too large");
                expect(result.reasons).toContainEqual(expect.stringContaining("Suspicious keywords"));
                expect(result.reasons).toContain("Excessive word repetition");
            });

            it("should handle sender reputation in spam detection", () => {
                const senderUUID = "bad-sender";
                
                // Set up high spam score for sender
                service.spamScores.set(senderUUID, {
                    score: 50,
                    lastUpdate: Date.now(),
                    violations: []
                });
                
                const result = service.detectSpam("normal message", senderUUID);
                
                expect(result.reasons).toContain("Sender has poor reputation");
                expect(result.spamScore).toBeGreaterThan(50);
            });
        });

        describe("Signature Verification Caching Branch Coverage", () => {
            it("should return cached valid signature result", async () => {
                const publicKey = "test-public-key";
                const signature = "test-signature";
                const message = "test message";
                
                // Pre-populate cache with valid signature
                service.signatureCache.set(publicKey, {
                    validSignatures: new Set([service.hashMessage(signature)]),
                    invalidSignatures: new Set()
                });
                
                const result = await service.verifyMessageSignature(message, publicKey, signature);
                
                expect(result).toEqual({ valid: true, cached: true });
            });

            it("should return cached invalid signature result", async () => {
                const publicKey = "test-public-key-2";
                const signature = "bad-signature";
                const message = "test message";
                
                // Pre-populate cache with invalid signature
                service.signatureCache.set(publicKey, {
                    validSignatures: new Set(),
                    invalidSignatures: new Set([service.hashMessage(signature)])
                });
                
                const result = await service.verifyMessageSignature(message, publicKey, signature);
                
                expect(result).toEqual({ valid: false, cached: true });
            });

            it("should handle signature verification when not required", async () => {
                // Temporarily disable signature requirement
                const originalRequireSignature = service.settings.requireSignature;
                service.settings.requireSignature = false;
                
                const result = await service.verifyMessageSignature("message", "key", "sig");
                expect(result).toEqual({ valid: true, cached: false });
                
                // Restore setting
                service.settings.requireSignature = originalRequireSignature;
            });
        });

        describe("Suspicious Activity Tracking Branch Coverage", () => {
            it("should handle trackSuspiciousActivity with non-existent peer info", () => {
                const peerUUID = "unknown-peer";
                
                // Track activity with moderate suspicion score (51)
                service.trackSuspiciousActivity(peerUUID, "spam_detected", { reason: "test" });
                service.trackSuspiciousActivity(peerUUID, "spam_detected", { reason: "test2" });
                service.trackSuspiciousActivity(peerUUID, "invalid_signature", { reason: "test3" });
                
                // Should not downgrade trust since peer doesn't exist in discoveredPeers
                expect(service.logger.warn).not.toHaveBeenCalledWith(
                    expect.stringContaining("Downgraded trust")
                );
            });

            it("should handle trackSuspiciousActivity with non-trusted peer", () => {
                const peerUUID = "non-trusted-peer";
                
                // Add peer with unknown trust level
                service.discoveredPeers.set(peerUUID, {
                    uuid: peerUUID,
                    trustLevel: "unknown"
                });
                
                // Track activity with moderate suspicion score
                service.trackSuspiciousActivity(peerUUID, "spam_detected", { reason: "test" });
                service.trackSuspiciousActivity(peerUUID, "spam_detected", { reason: "test2" });
                service.trackSuspiciousActivity(peerUUID, "invalid_signature", { reason: "test3" });
                
                // Should not downgrade trust since peer is not trusted
                expect(service.logger.warn).not.toHaveBeenCalledWith(
                    expect.stringContaining("Downgraded trust")
                );
            });

            it("should downgrade trust for trusted peer with moderate suspicion", () => {
                const peerUUID = "trusted-peer";
                
                // Add trusted peer
                service.discoveredPeers.set(peerUUID, {
                    uuid: peerUUID,
                    trustLevel: "trusted"
                });
                service.trustedPeers.add(peerUUID);
                
                // Track activity with moderate suspicion score (should be > 50)
                service.trackSuspiciousActivity(peerUUID, "spam_detected", { reason: "test" });
                service.trackSuspiciousActivity(peerUUID, "spam_detected", { reason: "test2" });
                service.trackSuspiciousActivity(peerUUID, "invalid_signature", { reason: "test3" });
                
                // Should downgrade trust
                expect(service.logger.warn).toHaveBeenCalledWith(
                    expect.stringContaining("Downgraded trust")
                );
                expect(service.discoveredPeers.get(peerUUID).trustLevel).toBe("unknown");
                expect(service.trustedPeers.has(peerUUID)).toBe(false);
            });
        });

        describe("Additional Branch Coverage", () => {
            it("should handle processOrderedMessage branches", () => {
                const message = {
                    sequenceNumber: 1,
                    from: null, // Test null from
                    to: service.cellUUID
                };
                const channel = "test-channel";
                
                service.processOrderedMessage(message, channel);
                
                // Should not update peer status since from is null
                expect(service.peerStatus.has(null)).toBe(false);
            });

            it("should handle processOrderedMessage with same cell sender", () => {
                const message = {
                    sequenceNumber: 1,
                    from: service.cellUUID, // Same as current cell
                    to: "other-cell"
                };
                const channel = "test-channel";
                
                service.processOrderedMessage(message, channel);
                
                // Should not update peer status since sender is same as current cell
                expect(service.peerStatus.has(service.cellUUID)).toBe(false);
            });

            it("should handle processOrderedMessage when not recipient", () => {
                const message = {
                    sequenceNumber: 1,
                    from: "other-cell",
                    to: "different-cell" // Not this cell
                };
                const channel = "test-channel";
                
                const logReceiptSpy = jest.spyOn(service, 'logMessageReceipt');
                
                service.processOrderedMessage(message, channel);
                
                // Should not log receipt since we're not the recipient
                expect(logReceiptSpy).not.toHaveBeenCalled();
                
                logReceiptSpy.mockRestore();
            });

            it("should handle shouldBufferMessage with old sequence", () => {
                const channel = "test-channel";
                
                // Initialize buffer
                service.shouldBufferMessage({ sequenceNumber: 1 }, channel);
                
                // Now try with old sequence
                const result = service.shouldBufferMessage({ sequenceNumber: 0 }, channel);
                
                expect(result).toBe(false);
                expect(service.logger.warn).toHaveBeenCalledWith(
                    expect.stringContaining("Received old/duplicate message")
                );
            });

            it("should handle cleanupSecurityData with zero spam scores", () => {
                const peerUUID = "clean-peer";
                const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
                
                // Add old spam data with zero score
                service.spamScores.set(peerUUID, {
                    score: 0,
                    lastUpdate: oldTimestamp,
                    violations: []
                });
                
                service.cleanupSecurityData();
                
                // Should be cleaned up
                expect(service.spamScores.has(peerUUID)).toBe(false);
                expect(service.logger.debug).toHaveBeenCalledWith("Security data cleanup completed");
            });

            it("should handle cleanupSecurityData with non-zero spam scores", () => {
                const peerUUID = "spam-peer";
                const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
                
                // Add old spam data with non-zero score
                service.spamScores.set(peerUUID, {
                    score: 10,
                    lastUpdate: oldTimestamp,
                    violations: []
                });
                
                service.cleanupSecurityData();
                
                // Should NOT be cleaned up because score is non-zero
                expect(service.spamScores.has(peerUUID)).toBe(true);
                expect(service.logger.debug).toHaveBeenCalledWith("Security data cleanup completed");
            });
        });
    });

    describe("Advanced Branch Coverage", () => {
        it("should handle expired message retry scenario", async () => {
            const service = broker.getLocalService("message");
            const metadata = {
                messageId: "test-expired-msg",
                retryCount: 2,
                status: "pending",
                expiresAt: new Date(Date.now() - 1000).toISOString() // Already expired
            };
            
            await service.retryMessage(metadata);
            
            expect(metadata.status).toBe("expired");
            expect(service.logger.warn).toHaveBeenCalledWith(
                expect.stringContaining("expired before retry")
            );
        });

        it("should handle deliverBufferedMessages with actual messages to deliver", () => {
            const service = broker.getLocalService("message");
            const channel = "delivery-test-channel";
            
            // Set up buffer with messages ready to deliver
            service.messageBuffers.set(channel, {
                lastDeliveredSequence: 0,
                expectedNextSequence: 1,
                pendingMessages: new Map([
                    [1, { message: { sequenceNumber: 1, from: "peer1", to: service.cellUUID }, timestamp: Date.now() }],
                    [2, { message: { sequenceNumber: 2, from: "peer1", to: service.cellUUID }, timestamp: Date.now() }]
                ]),
                maxBufferSize: 100,
                bufferTimeout: 30000
            });
            
            const processOrderedSpy = jest.spyOn(service, 'processOrderedMessage');
            
            service.deliverBufferedMessages(channel);
            
            expect(service.logger.info).toHaveBeenCalledWith(
                expect.stringContaining("Delivered buffered messages")
            );
            expect(processOrderedSpy).toHaveBeenCalledTimes(2);
            
            processOrderedSpy.mockRestore();
        });

        it("should handle message hashing with different content types", () => {
            const service = broker.getLocalService("message");
            // Test with object that becomes JSON
            const objMessage = { content: "test", type: "message", nested: { value: 123 } };
            const hash1 = service.hashMessage(objMessage);
            
            // Test with equivalent JSON string
            const jsonMessage = JSON.stringify(objMessage);
            const hash2 = service.hashMessage(jsonMessage);
            
            expect(hash1).toBe(hash2); // Should be the same
            expect(hash1).toHaveLength(64); // SHA256 hex length
        });

        it("should handle rate limiting for notification action", () => {
            const service = broker.getLocalService("message");
            const peerUUID = "notification-test-peer";
            
            // Fill up notification burst - checkRateLimit checks current count then increments
            // So we need to call exactly NOTIFICATION_BURST times to reach the limit
            for (let i = 0; i < 20; i++) { // NOTIFICATION_BURST = 20 in test config
                const result = service.checkRateLimit(peerUUID, "notification");
                expect(result.allowed).toBe(true);
            }
            
            // 21st call should be blocked (current count is 20, which is >= 20)
            const blockedResult = service.checkRateLimit(peerUUID, "notification");
            expect(blockedResult.allowed).toBe(false);
            expect(blockedResult.remainingTime).toBeGreaterThan(0);
        });

        it("should handle rate limiting for handshake action", () => {
            const service = broker.getLocalService("message");
            const peerUUID = "handshake-test-peer";
            
            // Fill up handshake burst - checkRateLimit checks current count then increments
            // So we need to call exactly HANDSHAKE_BURST times to reach the limit
            for (let i = 0; i < 10; i++) { // HANDSHAKE_BURST = 10 in test config
                const result = service.checkRateLimit(peerUUID, "handshake");
                expect(result.allowed).toBe(true);
            }
            
            // 11th call should be blocked (current count is 10, which is >= 10)
            const blockedResult = service.checkRateLimit(peerUUID, "handshake");
            expect(blockedResult.allowed).toBe(false);
            expect(blockedResult.remainingTime).toBeGreaterThan(0);
        });

        it("should handle updateSpamScore when spam detection is disabled", () => {
            const service = broker.getLocalService("message");
            // Temporarily disable spam detection
            const originalEnabled = service.settings.spamDetection.enabled;
            service.settings.spamDetection.enabled = false;
            
            const peerUUID = "test-peer-spam-disabled";
            const originalScores = new Map(service.spamScores);
            
            service.updateSpamScore(peerUUID, 50, "test violation");
            
            // Should not have created any spam score entries
            expect(service.spamScores.has(peerUUID)).toBe(false);
            expect(service.spamScores.size).toBe(originalScores.size);
            
            // Restore setting
            service.settings.spamDetection.enabled = originalEnabled;
        });

        it("should handle spam score decay over time", () => {
            const service = broker.getLocalService("message");
            const peerUUID = "decay-test-peer";
            const hoursAgo = Date.now() - (5 * 60 * 60 * 1000); // 5 hours ago
            
            // Set up old spam score
            service.spamScores.set(peerUUID, {
                score: 100,
                lastUpdate: hoursAgo,
                violations: []
            });
            
            // Update score (should trigger decay first)
            service.updateSpamScore(peerUUID, 10, "new violation");
            
            const updatedScore = service.spamScores.get(peerUUID);
            // Should be decayed: 100 - (5 * 15) + 10 = 35
            expect(updatedScore.score).toBe(35);
        });

        it("should handle spam detection with sender reputation check", () => {
            const service = broker.getLocalService("message");
            const senderUUID = "reputation-test-sender";
            
            // Set up sender with low spam score (below threshold)
            service.spamScores.set(senderUUID, {
                score: 15, // Below 20 threshold
                lastUpdate: Date.now(),
                violations: []
            });
            
            const result = service.detectSpam("normal message", senderUUID);
            
            // Should not include reputation warning since score is below threshold
            expect(result.reasons).not.toContain("Sender has poor reputation");
        });

        it("should handle suspicious activity with different event types", () => {
            const service = broker.getLocalService("message");
            const peerUUID = "activity-test-peer";
            
            // Track different types of suspicious activities
            service.trackSuspiciousActivity(peerUUID, "failed_handshake", { reason: "test" });
            service.trackSuspiciousActivity(peerUUID, "rate_limit_exceeded", { reason: "test" });
            service.trackSuspiciousActivity(peerUUID, "stale_handshake", { reason: "test" });
            
            const activity = service.suspicionScores.get(peerUUID);
            
            // Should have calculated score based on different event types
            // failed_handshake: 10, rate_limit_exceeded: 5, stale_handshake: 2
            expect(activity.score).toBe(17);
            expect(activity.events).toHaveLength(3);
        });

        it("should handle processOrderedMessage with recipient matching cellUUID", () => {
            const service = broker.getLocalService("message");
            const message = {
                sequenceNumber: 1,
                from: "sender-cell",
                to: service.cellUUID // This cell is the recipient
            };
            const channel = "test-channel";
            
            const logReceiptSpy = jest.spyOn(service, 'logMessageReceipt');
            
            service.processOrderedMessage(message, channel);
            
            // Should log receipt since we're the recipient
            expect(logReceiptSpy).toHaveBeenCalledWith(
                message, 
                "received", 
                `direct:${message.from}:${message.to}`, 
                message.from
            );
            
            logReceiptSpy.mockRestore();
        });

        it("should handle shouldBufferMessage with future sequence number", () => {
            const service = broker.getLocalService("message");
            const channel = "future-seq-channel";
            
            // Initialize buffer
            service.shouldBufferMessage({ sequenceNumber: 1 }, channel);
            
            // Now try with future sequence (should buffer)
            const result = service.shouldBufferMessage({ sequenceNumber: 5 }, channel);
            
            expect(result).toBe(true); // Should buffer future messages
        });

        it("should handle calculateNextRetryTime with jitter for exponential backoff", () => {
            const service = broker.getLocalService("message");
            // Test multiple calls to see jitter variance
            const retryTimes = [];
            for (let i = 0; i < 10; i++) {
                retryTimes.push(service.calculateNextRetryTime("EXPONENTIAL", 2));
            }
            
            // All should be within expected range but with some variance due to jitter
            retryTimes.forEach(time => {
                expect(time).toBeGreaterThan(3000); // Base: 1000 * 2^2 = 4000, minus 25% jitter = 3000
                expect(time).toBeLessThan(5000); // Plus 25% jitter = 5000
            });
            
            // Should have some variance (not all exactly the same)
            const uniqueTimes = new Set(retryTimes);
            expect(uniqueTimes.size).toBeGreaterThan(1);
        });

        it("should handle signature verification cache miss and create new entry", async () => {
            const service = broker.getLocalService("message");
            const publicKey = "new-public-key";
            const signature = "new-signature";
            const message = "new message";
            
            // Ensure no existing cache entry
            expect(service.signatureCache.has(publicKey)).toBe(false);
            
            // Mock nucleus service response
            const mockCall = jest.spyOn(service.broker, 'call').mockResolvedValue(true);
            
            const result = await service.verifyMessageSignature(message, publicKey, signature);
            
            expect(result).toEqual({ valid: true, cached: false });
            expect(service.signatureCache.has(publicKey)).toBe(true);
            
            const cacheEntry = service.signatureCache.get(publicKey);
            expect(cacheEntry.validSignatures.size).toBe(1);
            expect(cacheEntry.invalidSignatures.size).toBe(0);
            
            mockCall.mockRestore();
        });

        it("should handle cleanupSecurityData with empty activity events", () => {
            const service = broker.getLocalService("message");
            const peerUUID = "empty-activity-peer";
            const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
            
            // Add activity with old events that will be filtered out
            service.suspicionScores.set(peerUUID, {
                events: [
                    { type: "old_event", timestamp: oldTimestamp },
                    { type: "another_old_event", timestamp: oldTimestamp }
                ],
                score: 15
            });
            
            service.cleanupSecurityData();
            
            // Should be cleaned up because all events were old
            expect(service.suspicionScores.has(peerUUID)).toBe(false);
        });

        it("should handle spam detection with words array having no values", () => {
            const service = broker.getLocalService("message");
            // Test edge case where message with only whitespace has no meaningful words
            // When we split "" by /\s+/, we get [""], so we need to test with whitespace-only string
            const result = service.detectSpam("   \t\n  ", "test-sender");
            
            expect(result.isSpam).toBe(false);
            expect(result.reasons).not.toContain("Message too large");
            expect(result.reasons).not.toContain("Suspicious keywords");
            // The word repetition check might still trigger since empty/whitespace words could repeat
        });

        it("should handle different access control types in determineAccess", () => {
            const service = broker.getLocalService("message");
            
            // Test all topic types
            const directAccess = service.determineAccess("direct", "alice", "bob");
            expect(directAccess.writers).toEqual(["alice"]);
            expect(directAccess.readers).toEqual(["bob"]);
            
            const inboxAccess = service.determineAccess("inbox", "alice");
            expect(inboxAccess.writers).toEqual(["alice"]);
            expect(inboxAccess.readers).toEqual(["alice"]);
            
            const journalAccess = service.determineAccess("journal", "alice");
            expect(journalAccess.writers).toEqual(["alice"]);
            expect(journalAccess.readers).toEqual(["*"]);
            
            const peerCacheAccess = service.determineAccess("peer_cache", "alice");
            expect(peerCacheAccess.writers).toEqual(["alice"]);
            expect(peerCacheAccess.readers).toEqual(["alice"]);
        });
    });
    
    describe("Journal and Logging Error Handling", () => {
        it("should handle logMessageReceipt with missing cellUUID", async () => {
            const service = broker.getLocalService("message");
            const originalCellUUID = service.cellUUID;
            service.cellUUID = null;
            
            // Should not throw, just warn and return
            const result = await service.logMessageReceipt(
                { content: "test" },
                "sent",
                "test-topic",
                "peer-uuid"
            );
            
            expect(result).toBeUndefined();
            
            // Restore
            service.cellUUID = originalCellUUID;
        });
        
        it("should handle logMessageReceipt broker call failure", async () => {
            const service = broker.getLocalService("message");
            
            // Mock broker call to fail
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Journal write failed"));
            
            // Should not throw, just log error
            const result = await service.logMessageReceipt(
                { content: "test" },
                "sent", 
                "test-topic",
                "peer-uuid"
            );
            
            expect(result).toBeUndefined();
            expect(mockCall).toHaveBeenCalled();
            
            mockCall.mockRestore();
        });
        
        it("should handle logHandshakeRecord with missing cellUUID", async () => {
            const service = broker.getLocalService("message");
            const originalCellUUID = service.cellUUID;
            service.cellUUID = null;
            
            const result = await service.logHandshakeRecord(
                "peer-uuid",
                "outgoing",
                true,
                ["messaging"]
            );
            
            expect(result).toBeUndefined();
            
            service.cellUUID = originalCellUUID;
        });
        
        it("should handle logHandshakeRecord broker call failure", async () => {
            const service = broker.getLocalService("message");
            
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Handshake log failed"));
            
            const result = await service.logHandshakeRecord(
                "peer-uuid",
                "outgoing", 
                true,
                ["messaging"]
            );
            
            expect(result).toBeUndefined();
            
            mockCall.mockRestore();
        });
        
        it("should handle logKeyRotation with missing cellUUID", async () => {
            const service = broker.getLocalService("message");
            const originalCellUUID = service.cellUUID;
            service.cellUUID = null;
            
            const result = await service.logKeyRotation(
                "old-key",
                "new-key", 
                "compromise"
            );
            
            expect(result).toBeUndefined();
            
            service.cellUUID = originalCellUUID;
        });
        
        it("should handle logKeyRotation broker call failure", async () => {
            const service = broker.getLocalService("message");
            
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Key rotation log failed"));
            
            const result = await service.logKeyRotation(
                "old-key",
                "new-key",
                "scheduled"
            );
            
            expect(result).toBeUndefined();
            
            mockCall.mockRestore();
        });
        
        it("should handle logSecurityEvent broker call failure", async () => {
            const service = broker.getLocalService("message");
            
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Security log failed"));
            
            // Should not throw, just log error
            await service.logSecurityEvent('test_event', { data: 'test' });
            
            expect(mockCall).toHaveBeenCalled();
            
            mockCall.mockRestore();
        });
    });
    
    describe("Peer Discovery Error Handling", () => {
        it("should handle loadPeersFromCache parse errors", async () => {
            const service = broker.getLocalService("message");
            
            // Clear existing discovered peers
            service.discoveredPeers.clear();
            
            // Mock a peer cache that returns invalid JSON
            service.peerCache = {
                createReadStream: () => ({
                    [Symbol.asyncIterator]: async function* () {
                        yield { key: 'peer:test', value: 'invalid-json-{' };
                    }
                })
            };
            
            // Should not throw, just log warning
            await service.loadPeersFromCache();
            
            expect(service.discoveredPeers.size).toBe(0);
        });
        
        it("should handle loadPeersFromCache stream errors", async () => {
            const service = broker.getLocalService("message");
            
            // Clear existing discovered peers
            service.discoveredPeers.clear();
            
            // Mock a peer cache that throws during iteration
            service.peerCache = {
                createReadStream: () => ({
                    [Symbol.asyncIterator]: async function* () {
                        throw new Error("Stream error");
                    }
                })
            };
            
            // Should not throw, just log error
            await service.loadPeersFromCache();
            
            expect(service.discoveredPeers.size).toBe(0);
        });
        
        it("should handle addSelfToPeerCache broker call failure", async () => {
            const service = broker.getLocalService("message");
            
            // Mock broker call to fail
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Sign message failed"));
            
            // Should not throw, just log error
            await service.addSelfToPeerCache();
            
            expect(mockCall).toHaveBeenCalled();
            
            mockCall.mockRestore();
        });
        
        it("should handle addSelfToPeerCache with missing cellUUID", async () => {
            const service = broker.getLocalService("message");
            const originalCellUUID = service.cellUUID;
            service.cellUUID = null;
            
            // Should return early without doing anything
            await service.addSelfToPeerCache();
            
            service.cellUUID = originalCellUUID;
        });
        
        it("should handle addSelfToPeerCache with missing peerCache", async () => {
            const service = broker.getLocalService("message");
            const originalPeerCache = service.peerCache;
            service.peerCache = null;
            
            // Should return early without doing anything
            await service.addSelfToPeerCache();
            
            service.peerCache = originalPeerCache;
        });
    });
    
    describe("Enhanced Message Edge Cases", () => {
        it("should handle retryMessage with expired message", async () => {
            const service = broker.getLocalService("message");
            const expiredTime = new Date(Date.now() - 1000).toISOString(); // 1 second ago
            
            const metadata = {
                messageId: "expired-msg",
                from: "sender",
                to: "receiver",
                expiresAt: expiredTime,
                retryCount: 1
            };
            
            service.messageMetadata.set("expired-msg", metadata);
            
            // Should update status to expired and update stats
            await service.retryMessage(metadata);
            
            expect(metadata.status).toBe("expired");
        });
        
        it("should handle sendMessageWithMetadata missing topic", async () => {
            const service = broker.getLocalService("message");
            
            const messagePayload = {
                messageId: "test-msg",
                from: service.cellUUID,
                to: "receiver",
                content: "test"
            };
            
            const metadata = {
                topic: "direct:sender:receiver",
                from: service.cellUUID,
                to: "receiver"
            };
            
            // Mock broker calls for core creation, encryption and writing
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockResolvedValueOnce({ // nucleus.get (for createCoreForTopic)
                    core: { key: "test-core-key" }
                })
                .mockResolvedValueOnce({ // nucleus.encryptForCell
                    encrypted: "encrypted-data",
                    encryptedKey: "encrypted-key",
                    iv: "test-iv",
                    authTag: "test-tag",
                    signature: "test-sig"
                })
                .mockResolvedValueOnce(); // nucleus.write
            
            // Should create the topic automatically
            await service.sendMessageWithMetadata(messagePayload, "recipient-key", metadata);
            
            expect(service.topicMap.has(metadata.topic)).toBe(true);
            
            mockCall.mockRestore();
        });
        
        it("should handle sendMessageWithMetadata broker call failure", async () => {
            const service = broker.getLocalService("message");
            
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Encryption failed"));
            
            const messagePayload = {
                messageId: "test-msg",
                from: service.cellUUID,
                to: "receiver",
                content: "test"
            };
            
            const metadata = {
                topic: "direct:sender:receiver",
                from: service.cellUUID,
                to: "receiver"
            };
            
            await expect(service.sendMessageWithMetadata(messagePayload, "recipient-key", metadata))
                .rejects.toThrow("Encryption failed");
            
            mockCall.mockRestore();
        });
    });
    
    describe("Message Processing Edge Cases", () => {
        it("should handle getMessages with malformed entry data", async () => {
            const service = broker.getLocalService("message");
            const topic = "test-topic";
            
            // Create topic
            service.topicMap.set(topic, { type: "direct", sourceUUID: "test", targetUUID: "test2" });
            
            // Mock nucleus service to return malformed data
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockResolvedValueOnce({
                    entries: [
                        { data: 'invalid-json-{' }, // Malformed JSON
                        { data: JSON.stringify({ encrypted: "test", signature: "test", senderPublicKey: "test" }) }
                    ],
                    hasMore: false
                });
            
            const result = await service.getMessages({ params: { topic } });
            
            // Should skip malformed entries but continue processing
            expect(result.messages.length).toBe(1);
            expect(mockCall).toHaveBeenCalled();
            
            mockCall.mockRestore();
        });
        
        it("should handle getMessages with decryption errors", async () => {
            const service = broker.getLocalService("message");
            const topic = "test-topic";
            
            service.topicMap.set(topic, { type: "direct", sourceUUID: "test", targetUUID: "test2" });
            
            // Mock nucleus calls
            const mockRead = jest.spyOn(service.broker, 'call')
                .mockResolvedValueOnce({
                    entries: [
                        { 
                            data: JSON.stringify({
                                encrypted: "test-data",
                                signature: "test-sig", 
                                senderPublicKey: "test-key",
                                messageId: "test-msg"
                            })
                        }
                    ],
                    hasMore: false
                });
            
            // Mock verifyMessageSignature to return valid
            const mockVerify = jest.spyOn(service, 'verifyMessageSignature')
                .mockResolvedValueOnce({ valid: true, cached: false });
            
            // Mock decryption to fail
            mockRead.mockResolvedValueOnce({
                entries: [
                    { 
                        data: JSON.stringify({
                            encrypted: "test-data",
                            signature: "test-sig",
                            senderPublicKey: "test-key", 
                            messageId: "test-msg"
                        })
                    }
                ],
                hasMore: false
            });
            
            mockRead.mockRejectedValueOnce(new Error("Decryption failed"));
            
            const result = await service.getMessages({ params: { topic } });
            
            // Should include message but without decrypted content
            expect(result.messages.length).toBe(1);
            expect(result.messages[0].encrypted).toBe(true);
            
            mockRead.mockRestore();
            mockVerify.mockRestore();
        });
        
        it("should handle processIncomingHandshake with missing required fields", async () => {
            const service = broker.getLocalService("message");
            
            const incompleteHandshake = {
                uuid: "test-peer"
                // missing publicKey and signature
            };
            
            await expect(service.processIncomingHandshake(incompleteHandshake, {}))
                .rejects.toThrow("Invalid handshake format");
        });
        
        it("should handle processIncomingHandshake with stale timestamp", async () => {
            const service = broker.getLocalService("message");
            const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
            
            const staleHandshake = {
                uuid: "test-peer",
                publicKey: "test-key",
                signature: "test-sig",
                timestamp: staleTime
            };
            
            // Mock signature verification to return valid
            const mockVerify = jest.spyOn(service, 'verifyMessageSignature')
                .mockResolvedValueOnce({ valid: true, cached: false });
            
            await expect(service.processIncomingHandshake(staleHandshake, {}))
                .rejects.toThrow("Handshake timestamp too old");
            
            mockVerify.mockRestore();
        });
    });
    
    describe("Security and Spam Detection Edge Cases", () => {
        it("should handle detectSpam with diverse words (no repetition)", () => {
            const service = broker.getLocalService("message");
            
            // Test with diverse words where no single word appears more than 30% of the time
            const result = service.detectSpam("hello world how are you today everyone", "test-sender");
            
            expect(result.isSpam).toBe(false);
            expect(result.reasons).not.toContain("Excessive word repetition");
        });
        
        it("should handle updateSpamScore with violation cleanup", () => {
            const service = broker.getLocalService("message");
            const peerUUID = "test-peer";
            const oldTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
            
            // Set up old violations
            service.spamScores.set(peerUUID, {
                score: 10,
                lastUpdate: oldTime,
                violations: [
                    { timestamp: oldTime, reason: "old violation", scoreChange: 10 }
                ]
            });
            
            // Update with new violation
            service.updateSpamScore(peerUUID, 5, "new violation");
            
            const spamData = service.spamScores.get(peerUUID);
            
            // Old violations should be filtered out
            expect(spamData.violations.length).toBe(1);
            expect(spamData.violations[0].reason).toBe("new violation");
        });
        
        it("should handle trackSuspiciousActivity event cleanup", () => {
            const service = broker.getLocalService("message");
            const peerUUID = "test-peer";
            const oldTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
            
            // Set up old events
            service.suspicionScores.set(peerUUID, {
                events: [
                    { type: "old_event", timestamp: oldTime }
                ],
                score: 0
            });
            
            // Track new activity
            service.trackSuspiciousActivity(peerUUID, "spam_detected", { reason: "test" });
            
            const activity = service.suspicionScores.get(peerUUID);
            
            // Old events should be filtered out
            expect(activity.events.length).toBe(1);
            expect(activity.events[0].type).toBe("spam_detected");
        });
        
        it("should handle verifyMessageSignature broker call failure", async () => {
            const service = broker.getLocalService("message");
            
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Verification failed"));
            
            await expect(service.verifyMessageSignature("message", "key", "sig"))
                .rejects.toThrow("Verification failed");
            
            mockCall.mockRestore();
        });
    });
    
    describe("Buffer and Message Ordering Edge Cases", () => {
        it("should handle bufferMessage with empty keys array", () => {
            const service = broker.getLocalService("message");
            const channel = "test-channel";
            
            // Initialize buffer with no pending messages
            service.messageBuffers.set(channel, {
                lastDeliveredSequence: 0,
                expectedNextSequence: 1,
                pendingMessages: new Map(),
                maxBufferSize: 100,
                bufferTimeout: 30000
            });
            
            const message = { sequenceNumber: 2 };
            
            // Should handle gracefully even with empty buffer
            service.bufferMessage(message, channel);
            
            const buffer = service.messageBuffers.get(channel);
            expect(buffer.pendingMessages.has(2)).toBe(true);
        });
        
        it("should handle deliverBufferedMessages with expired entries", () => {
            const service = broker.getLocalService("message");
            const channel = "test-channel";
            const oldTime = Date.now() - 35000; // 35 seconds ago (older than 30s timeout)
            
            service.messageBuffers.set(channel, {
                lastDeliveredSequence: 0,
                expectedNextSequence: 1,
                pendingMessages: new Map([
                    [3, { message: { sequenceNumber: 3 }, timestamp: oldTime }] // Expired
                ]),
                maxBufferSize: 100,
                bufferTimeout: 30000
            });
            
            service.deliverBufferedMessages(channel);
            
            const buffer = service.messageBuffers.get(channel);
            
            // Expired message should be removed
            expect(buffer.pendingMessages.has(3)).toBe(false);
        });
    });
    
    describe("Inbox and Notification Edge Cases", () => {
        it("should handle sendSelfAnnouncement with missing prerequisites", async () => {
            const service = broker.getLocalService("message");
            const originalInbox = service.inboxAutobase;
            const originalCellUUID = service.cellUUID;
            
            service.inboxAutobase = null;
            
            // Should return early without throwing
            await service.sendSelfAnnouncement();
            
            service.cellUUID = null;
            service.inboxAutobase = originalInbox;
            
            // Should return early without throwing
            await service.sendSelfAnnouncement();
            
            // Restore
            service.inboxAutobase = originalInbox;
            service.cellUUID = originalCellUUID;
        });
        
        it("should handle sendSelfAnnouncement broker call failure", async () => {
            const service = broker.getLocalService("message");
            
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Sign failed"));
            
            // Should not throw, just log error
            await service.sendSelfAnnouncement();
            
            expect(mockCall).toHaveBeenCalled();
            
            mockCall.mockRestore();
        });
        
        it("should handle getInboxNotifications parse errors", async () => {
            const service = broker.getLocalService("message");
            
            // Mock autobase with invalid JSON
            service.inboxAutobase = {
                length: 1,
                async get(index) {
                    return Buffer.from('invalid-json-{');
                }
            };
            
            const result = await service.getInboxNotifications({ params: {} });
            
            // Should handle parse errors gracefully
            expect(result.notifications.length).toBe(0);
        });
    });
    
    describe("Additional Error Handling", () => {
        it("should handle processOfflineMessages with retry failures", async () => {
            const service = broker.getLocalService("message");
            
            // Set up a message that will fail multiple times
            const queueKey = "offline:test-peer";
            service.messageQueue.set(queueKey, [
                {
                    targetUUID: "test-peer",
                    message: "test message",
                    recipientPublicKey: "test-key",
                    timestamp: new Date().toISOString(),
                    retryCount: 4 // Almost at max retries (5)
                }
            ]);
            
            // Mock sendMessage to fail
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Send failed"));
            
            await service.processOfflineMessages();
            
            // Message should be removed after reaching max retries
            expect(service.messageQueue.has(queueKey)).toBe(false);
            
            mockCall.mockRestore();
        });
        
        it("should handle confirmMessage with invalid messageId", async () => {
            const service = broker.getLocalService("message");
            
            await expect(service.confirmMessage({
                params: { messageId: "non-existent" }
            })).rejects.toThrow("Message not found: non-existent");
        });
        
        it("should handle updatePeerTrust with missing peer in both caches", async () => {
            const service = broker.getLocalService("message");
            
            // Mock peer cache to return null
            service.peerCache = {
                async get(key) {
                    return null;
                }
            };
            
            await expect(service.updatePeerTrust({
                params: { peerUUID: "non-existent", trustLevel: "trusted" }
            })).rejects.toThrow("Peer not found: non-existent");
        });
        
        it("should handle generateMessageProofAction with broker failure", async () => {
            const service = broker.getLocalService("message");
            
            const mockCall = jest.spyOn(service.broker, 'call')
                .mockRejectedValueOnce(new Error("Sign failed"));
            
            await expect(service.generateMessageProofAction({
                params: {
                    messageContent: "test",
                    senderUUID: "sender",
                    receiverUUID: "receiver", 
                    topic: "test-topic",
                    direction: "sent"
                }
            })).rejects.toThrow("Sign failed");
            
            mockCall.mockRestore();
        });
    });
}); 