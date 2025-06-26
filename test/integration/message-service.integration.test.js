import fs from 'fs';
import _ from "lodash";
import { ServiceBroker } from "moleculer";
import path from 'path';
import { promisify } from 'util';
import MessageService from "../../src/services/message.service.js";
import NucleusService from "../../src/services/nucleus.service.js";

const rmrf = promisify(fs.rm);
const mkdir = promisify(fs.mkdir);

describe("MessageService Integration Tests", () => {
    let broker1, broker2, broker3;
    let cell1, cell2, cell3;
    const testDataDir = path.join(process.cwd(), 'tmp', 'test', 'integration-data');

    beforeAll(async () => {
        // Clean up any existing test data
        try {
            await rmrf(testDataDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore errors if directories don't exist
        }

        // Create fresh test directories
        await mkdir(testDataDir, { recursive: true });

        // Create three separate brokers for different cells
        broker1 = new ServiceBroker({
            logger: false,
            metrics: false,
            nodeID: 'cell-1'
        });

        broker2 = new ServiceBroker({
            logger: false,
            metrics: false,
            nodeID: 'cell-2'
        });

        broker3 = new ServiceBroker({
            logger: false,
            metrics: false,
            nodeID: 'cell-3'
        });

        // Create services for each cell
        cell1 = new NucleusService(broker1, {
            name: 'cell-1',
            config: {
                storage: 'file',
                path: path.join(testDataDir, 'cell-1')
            }
        });

        cell2 = new NucleusService(broker2, {
            name: 'cell-2',
            config: {
                storage: 'file',
                path: path.join(testDataDir, 'cell-2')
            }
        });

        cell3 = new NucleusService(broker3, {
            name: 'cell-3',
            config: {
                storage: 'file',
                path: path.join(testDataDir, 'cell-3')
            }
        });

        // Create MessageServices for each cell
        new MessageService(broker1, {
            name: 'cell-1',
            config: {
                maxCoresPerType: 100,
                coreExpirationTime: 60000,
                enableSpamPrevention: true,
                enableRateLimiting: true
            }
        });

        new MessageService(broker2, {
            name: 'cell-2',
            config: {
                maxCoresPerType: 100,
                coreExpirationTime: 60000,
                enableSpamPrevention: true,
                enableRateLimiting: true
            }
        });

        new MessageService(broker3, {
            name: 'cell-3',
            config: {
                maxCoresPerType: 100,
                coreExpirationTime: 60000,
                enableSpamPrevention: true,
                enableRateLimiting: true
            }
        });

        // Start all brokers
        await Promise.all([
            broker1.start(),
            broker2.start(),
            broker3.start()
        ]);

        // Wait for services to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    afterAll(async () => {
        // Stop all brokers
        await Promise.all([
            broker1?.stop(),
            broker2?.stop(),
            broker3?.stop()
        ]);

        // Clean up test data
        try {
            await rmrf(testDataDir, { recursive: true, force: true });
        } catch (err) {
            console.error('Error cleaning up test data:', err);
        }
    });

    describe("Multi-Cell Communication", () => {
        it("should enable secure communication between multiple cells", async () => {
            // Get public keys from each cell
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const publicKey3 = await broker3.call("nucleus.getPublicKey");

            expect(publicKey1).toBeDefined();
            expect(publicKey2).toBeDefined();
            expect(publicKey3).toBeDefined();

            // Get cell UUIDs
            const cell1UUID = await broker1.call("nucleus.getCellUUID");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");
            const cell3UUID = await broker3.call("nucleus.getCellUUID");

            expect(cell1UUID).toBeDefined();
            expect(cell2UUID).toBeDefined();
            expect(cell3UUID).toBeDefined();

            // Cell 1 sends message to Cell 2
            const message1to2 = await broker1.call("message.sendMessage", {
                targetUUID: cell2UUID,
                message: "Hello from Cell 1 to Cell 2!",
                recipientPublicKey: publicKey2
            });

            expect(message1to2.success).toBe(true);
            expect(message1to2.messageId).toBeDefined();

            // Cell 2 sends message to Cell 3
            const message2to3 = await broker2.call("message.sendMessage", {
                targetUUID: cell3UUID,
                message: "Hello from Cell 2 to Cell 3!",
                recipientPublicKey: publicKey3
            });

            expect(message2to3.success).toBe(true);
            expect(message2to3.messageId).toBeDefined();

            // Cell 3 sends message to Cell 1
            const message3to1 = await broker3.call("message.sendMessage", {
                targetUUID: cell1UUID,
                message: "Hello from Cell 3 to Cell 1!",
                recipientPublicKey: publicKey1
            });

            expect(message3to1.success).toBe(true);
            expect(message3to1.messageId).toBeDefined();
        });

        it("should handle message retrieval across cells", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell1UUID = await broker1.call("nucleus.getCellUUID");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Send a test message
            const sendResult = await broker1.call("message.sendMessage", {
                targetUUID: cell2UUID,
                message: "Integration test message",
                recipientPublicKey: publicKey2
            });

            expect(sendResult.success).toBe(true);

            // Get the topic name
            const topic = `direct:${cell1UUID}:${cell2UUID}`;

            // Cell 2 should be able to retrieve the message
            const messages = await broker2.call("message.getMessages", {
                topic,
                limit: 10
            });

            expect(messages.messages).toBeDefined();
            expect(messages.messages.length).toBeGreaterThan(0);

            // Find the specific message
            const testMessage = messages.messages.find(msg => 
                msg.content === "Integration test message"
            );

            expect(testMessage).toBeDefined();
            expect(testMessage.from).toBe(cell1UUID);
            expect(testMessage.to).toBe(cell2UUID);
        });
    });

    describe("Security Integration", () => {
        it("should enforce rate limiting across cells", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Send multiple messages quickly to trigger rate limiting
            const promises = [];
            for (let i = 0; i < 15; i++) {
                promises.push(
                    broker1.call("message.sendMessage", {
                        targetUUID: cell2UUID,
                        message: `Rate limit test message ${i}`,
                        recipientPublicKey: publicKey2
                    }).catch(err => err) // Catch errors to continue testing
                );
            }

            const results = await Promise.all(promises);
            
            // Some messages should succeed, some should be rate limited
            const successes = results.filter(r => r.success);
            const rateLimited = results.filter(r => r.message && r.message.includes("Rate limit exceeded"));

            expect(successes.length).toBeGreaterThan(0);
            expect(rateLimited.length).toBeGreaterThan(0);
        });

        it("should detect and block spam across cells", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Try to send spam message
            try {
                await broker1.call("message.sendMessage", {
                    targetUUID: cell2UUID,
                    message: "This is a spam message with scam content and phishing links",
                    recipientPublicKey: publicKey2
                });
                expect(true).toBe(false); // Should not reach here
            } catch (err) {
                expect(err.message).toContain("Message blocked as potential spam");
            }

            // Send legitimate message should work
            const legitimateResult = await broker1.call("message.sendMessage", {
                targetUUID: cell2UUID,
                message: "This is a legitimate message",
                recipientPublicKey: publicKey2
            });

            expect(legitimateResult.success).toBe(true);
        });

        it("should handle peer blocking across cells", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell1UUID = await broker1.call("nucleus.getCellUUID");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Cell 2 blocks Cell 1
            const blockResult = await broker2.call("message.blockPeer", {
                peerUUID: cell1UUID,
                reason: "Integration test blocking"
            });

            expect(blockResult.success).toBe(true);

            // Cell 1 should not be able to send messages to Cell 2
            try {
                await broker1.call("message.sendMessage", {
                    targetUUID: cell2UUID,
                    message: "This should be blocked",
                    recipientPublicKey: publicKey2
                });
                expect(true).toBe(false); // Should not reach here
            } catch (err) {
                expect(err.message).toContain("Cannot send message to blocked peer");
            }

            // Cell 2 unblocks Cell 1
            const unblockResult = await broker2.call("message.unblockPeer", {
                peerUUID: cell1UUID
            });

            expect(unblockResult.success).toBe(true);

            // Cell 1 should now be able to send messages to Cell 2
            const messageResult = await broker1.call("message.sendMessage", {
                targetUUID: cell2UUID,
                message: "This should work after unblocking",
                recipientPublicKey: publicKey2
            });

            expect(messageResult.success).toBe(true);
        });
    });

    describe("Enhanced Message Features", () => {
        it("should handle enhanced message delivery with confirmations", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Send enhanced message with delivery confirmation
            const enhancedResult = await broker1.call("message.sendEnhancedMessage", {
                targetUUID: cell2UUID,
                message: "Enhanced message with delivery tracking",
                recipientPublicKey: publicKey2,
                options: {
                    requireDeliveryConfirmation: true,
                    priority: "urgent",
                    expiresIn: 3600 // 1 hour
                }
            });

            expect(enhancedResult.success).toBe(true);
            expect(enhancedResult.messageId).toBeDefined();
            expect(enhancedResult.status).toBe("pending");

            // Get message status
            const statusResult = await broker1.call("message.getMessageStatus", {
                messageId: enhancedResult.messageId
            });

            expect(statusResult.messageId).toBe(enhancedResult.messageId);
            expect(statusResult.status).toBeDefined();
            expect(statusResult.timeline).toBeDefined();
        });

        it("should handle message confirmation across cells", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell1UUID = await broker1.call("nucleus.getCellUUID");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Send message from Cell 1 to Cell 2
            const sendResult = await broker1.call("message.sendMessage", {
                targetUUID: cell2UUID,
                message: "Message to be confirmed",
                recipientPublicKey: publicKey2
            });

            expect(sendResult.success).toBe(true);

            // Cell 2 confirms receipt
            const confirmResult = await broker2.call("message.confirmMessage", {
                messageId: sendResult.messageId,
                received: true,
                processed: true
            });

            expect(confirmResult.success).toBe(true);
            expect(confirmResult.status).toBe("confirmed");
        });
    });

    describe("Security Metrics and Monitoring", () => {
        it("should provide security metrics across cells", async () => {
            // Get security metrics from each cell
            const metrics1 = await broker1.call("message.getSecurityMetrics");
            const metrics2 = await broker2.call("message.getSecurityMetrics");
            const metrics3 = await broker3.call("message.getSecurityMetrics");

            // Verify metrics structure
            [metrics1, metrics2, metrics3].forEach(metrics => {
                expect(metrics).toHaveProperty("overview");
                expect(metrics).toHaveProperty("recentActivity");
                expect(metrics).toHaveProperty("trustDistribution");
                expect(metrics).toHaveProperty("spamScoreDistribution");
                expect(metrics).toHaveProperty("settings");
                expect(metrics).toHaveProperty("cacheStats");
            });

            // Verify security settings are consistent
            expect(metrics1.settings.securityFeatures.enableSpamPrevention).toBe(true);
            expect(metrics2.settings.securityFeatures.enableRateLimiting).toBe(true);
            expect(metrics3.settings.securityFeatures.requireSignature).toBe(true);
        });

        it("should track security events across cells", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell1UUID = await broker1.call("nucleus.getCellUUID");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Trigger some security events
            await broker2.call("message.blockPeer", {
                peerUUID: cell1UUID,
                reason: "Security event test"
            });

            // Check spam detection
            await broker1.call("message.checkSpam", {
                message: "Test spam message with scam content",
                senderUUID: cell2UUID
            });

            // Get security status
            const status1 = await broker1.call("message.getSecurityStatus", {
                peerUUID: cell2UUID
            });

            const status2 = await broker2.call("message.getSecurityStatus", {
                peerUUID: cell1UUID
            });

            expect(status1.peerUUID).toBe(cell2UUID);
            expect(status2.peerUUID).toBe(cell1UUID);
            expect(status2.isBlocked).toBe(true);
        });
    });

    describe("Load Testing", () => {
        it("should handle concurrent message sending", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const publicKey3 = await broker3.call("nucleus.getPublicKey");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");
            const cell3UUID = await broker3.call("nucleus.getCellUUID");

            // Send multiple messages concurrently
            const concurrentMessages = 10;
            const promises = [];

            for (let i = 0; i < concurrentMessages; i++) {
                // Send to Cell 2
                promises.push(
                    broker1.call("message.sendMessage", {
                        targetUUID: cell2UUID,
                        message: `Concurrent message ${i} to Cell 2`,
                        recipientPublicKey: publicKey2
                    })
                );

                // Send to Cell 3
                promises.push(
                    broker1.call("message.sendMessage", {
                        targetUUID: cell3UUID,
                        message: `Concurrent message ${i} to Cell 3`,
                        recipientPublicKey: publicKey3
                    })
                );
            }

            const results = await Promise.all(promises);

            // All messages should succeed
            results.forEach(result => {
                expect(result.success).toBe(true);
                expect(result.messageId).toBeDefined();
            });

            expect(results.length).toBe(concurrentMessages * 2);
        });

        it("should handle high-volume message processing", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Send a large number of messages
            const messageCount = 50;
            const startTime = Date.now();

            for (let i = 0; i < messageCount; i++) {
                await broker1.call("message.sendMessage", {
                    targetUUID: cell2UUID,
                    message: `High volume message ${i}`,
                    recipientPublicKey: publicKey2
                });
            }

            const endTime = Date.now();
            const totalTime = endTime - startTime;

            // Verify performance (should complete within reasonable time)
            expect(totalTime).toBeLessThan(30000); // 30 seconds

            // Get delivery stats
            const stats = await broker1.call("message.getDeliveryStats");
            expect(stats.totalSent).toBeGreaterThanOrEqual(messageCount);
        });
    });

    describe("Error Handling and Recovery", () => {
        it("should handle network failures gracefully", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Try to send message to non-existent peer
            try {
                await broker1.call("message.sendMessage", {
                    targetUUID: "non-existent-peer",
                    message: "This should fail",
                    recipientPublicKey: publicKey2
                });
                expect(true).toBe(false); // Should not reach here
            } catch (err) {
                expect(err.message).toBeDefined();
            }

            // Service should still be functional
            const health = await broker1.call("message.health");
            expect(health.status).toBe("healthy");
        });

        it("should handle invalid message formats", async () => {
            const publicKey1 = await broker1.call("nucleus.getPublicKey");
            const publicKey2 = await broker2.call("nucleus.getPublicKey");
            const cell2UUID = await broker2.call("nucleus.getCellUUID");

            // Try to send message with invalid parameters
            try {
                await broker1.call("message.sendMessage", {
                    targetUUID: cell2UUID,
                    message: "", // Empty message
                    recipientPublicKey: publicKey2
                });
                expect(true).toBe(false); // Should not reach here
            } catch (err) {
                expect(err.name).toBe("ValidationError");
            }

            // Try with invalid public key
            try {
                await broker1.call("message.sendMessage", {
                    targetUUID: cell2UUID,
                    message: "Test message",
                    recipientPublicKey: "invalid-key"
                });
                expect(true).toBe(false); // Should not reach here
            } catch (err) {
                expect(err.name).toBe("ValidationError");
            }
        });
    });
}); 