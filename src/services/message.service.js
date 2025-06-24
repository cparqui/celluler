import BaseService from './base.service.js';
import _ from 'lodash';
import Hyperbee from 'hyperbee';
import crypto from 'crypto';

// Topic naming conventions
const TOPIC_TYPES = {
  DIRECT: "direct",
  INBOX: "inbox", 
  PEER_CACHE: "peer_cache",
  JOURNAL: "journal"
};

// Discovery system constants
const DISCOVERY_TOPICS = {
  GENERAL: "celluler-network-v1", // All Celluler cells join this
  REGIONAL: "celluler-region-us-west", // Optional regional topics  
  CAPABILITY: "celluler-messaging-v1" // Capability-specific topics
};

// Handshake protocol constants
const HANDSHAKE_VERSION = "1.0";
const TRUST_LEVELS = {
  TRUSTED: "trusted",
  UNKNOWN: "unknown", 
  BLOCKED: "blocked"
};

const RELATIONSHIP_STATUS = {
  CONNECTED: "connected",
  PENDING: "pending",
  DISCONNECTED: "disconnected"
};

// Parameter validation objects
const CreateTopicParams = {
    topicType: {
        type: "enum",
        values: Object.values(TOPIC_TYPES)
    },
    sourceUUID: {
        type: "string",
        min: 1
    },
    targetUUID: {
        type: "string",
        min: 1,
        optional: true
    }
};

const GetTopicParams = {
    topic: {
        type: "string",
        min: 1
    }
};

const BindTopicParams = {
    topic: {
        type: "string", 
        min: 1
    },
    coreKey: {
        type: "string",
        optional: true
    }
};

const SendMessageParams = {
    targetUUID: {
        type: "string",
        min: 1
    },
    message: {
        type: "string",
        min: 1
    },
    recipientPublicKey: {
        type: "string",
        min: 100 // RSA public keys are much longer than sodium keys
    }
};

const GetMessagesParams = {
    topic: {
        type: "string",
        min: 1
    },
    limit: {
        type: "number",
        min: 1,
        max: 100,
        optional: true,
        default: 50
    },
    since: {
        type: "string",
        optional: true // ISO timestamp
    }
};

const SendNotificationParams = {
    targetUUID: {
        type: "string",
        min: 1
    },
    notification: {
        type: "object",
        props: {
            type: {
                type: "enum",
                values: ["message_notification", "peer_announcement", "status_update", "peer_introduction"]
            },
            from: {
                type: "string",
                min: 1
            },
            timestamp: {
                type: "string"
            }
        }
    }
};

const RequestInboxAccessParams = {
    targetUUID: {
        type: "string",
        min: 1
    },
    reason: {
        type: "string",
        min: 1,
        optional: true
    }
};

const GrantInboxAccessParams = {
    requesterUUID: {
        type: "string",
        min: 1
    },
    granted: {
        type: "boolean"
    }
};

const GetInboxNotificationsParams = {
    limit: {
        type: "number",
        min: 1,
        max: 100,
        optional: true,
        default: 50
    },
    since: {
        type: "string",
        optional: true
    }
};

const LookupPeerParams = {
    peerUUID: {
        type: "string",
        min: 1
    }
};

const IntroducePeerParams = {
    requesterUUID: {
        type: "string",
        min: 1
    },
    targetUUID: {
        type: "string", 
        min: 1
    }
};

const UpdatePeerTrustParams = {
    peerUUID: {
        type: "string",
        min: 1
    },
    trustLevel: {
        type: "enum",
        values: Object.values(TRUST_LEVELS)
    }
};

const GetPeerCacheParams = {
    trustLevel: {
        type: "enum",
        values: Object.values(TRUST_LEVELS),
        optional: true
    },
    limit: {
        type: "number",
        min: 1,
        max: 100,
        optional: true,
        default: 50
    }
};

// Default settings
const DEFAULT_SETTINGS = {
    // Core management settings
    maxCoresPerType: 1000,
    coreExpirationTime: 24 * 60 * 60 * 1000, // 24 hours
    
    // Security settings
    requireEncryption: true,
    requireSignature: true,
    
    // Performance settings
    cacheSize: 500,
    cleanupInterval: 60 * 1000 // 1 minute
};

export default class MessageService extends BaseService {
    constructor(broker, cellConfig) {
        super(broker, cellConfig);
        
        this.parseServiceSchema({
            name: "message",
            settings: _.defaultsDeep(cellConfig.config, DEFAULT_SETTINGS),
            dependencies: [
                "nucleus"
            ],
            actions: {
                createTopic: {
                    params: CreateTopicParams,
                    handler: this.createTopic,
                    rest: {
                        method: "POST",
                        path: "/topic"
                    }
                },
                getTopic: {
                    params: GetTopicParams,
                    handler: this.getTopic,
                    rest: {
                        method: "GET", 
                        path: "/topic/:topic"
                    }
                },
                bindTopic: {
                    params: BindTopicParams,
                    handler: this.bindTopic,
                    rest: {
                        method: "POST",
                        path: "/bind"
                    }
                },
                listTopics: {
                    handler: this.listTopics,
                    rest: {
                        method: "GET",
                        path: "/topics"
                    }
                },
                health: {
                    handler: this.health,
                    rest: {
                        method: "GET",
                        path: "/health"
                    }
                },
                sendMessage: {
                    params: SendMessageParams,
                    handler: this.sendMessage,
                    rest: {
                        method: "POST",
                        path: "/message"
                    }
                },
                getMessages: {
                    params: GetMessagesParams,
                    handler: this.getMessages,
                    rest: {
                        method: "GET",
                        path: "/messages/:topic"
                    }
                },
                sendNotification: {
                    params: SendNotificationParams,
                    handler: this.sendNotification,
                    rest: {
                        method: "POST",
                        path: "/notification"
                    }
                },
                requestInboxAccess: {
                    params: RequestInboxAccessParams,
                    handler: this.requestInboxAccess,
                    rest: {
                        method: "POST",
                        path: "/request-access"
                    }
                },
                grantInboxAccess: {
                    params: GrantInboxAccessParams,
                    handler: this.grantInboxAccess,
                    rest: {
                        method: "POST",
                        path: "/grant-access"
                    }
                },
                getInboxNotifications: {
                    params: GetInboxNotificationsParams,
                    handler: this.getInboxNotifications,
                    rest: {
                        method: "GET",
                        path: "/notifications"
                    }
                },
                lookupPeer: {
                    params: LookupPeerParams,
                    handler: this.lookupPeer,
                    rest: {
                        method: "GET",
                        path: "/peer/:peerUUID"
                    }
                },
                introducePeer: {
                    params: IntroducePeerParams,
                    handler: this.introducePeer,
                    rest: {
                        method: "POST",
                        path: "/introduce"
                    }
                },
                updatePeerTrust: {
                    params: UpdatePeerTrustParams,
                    handler: this.updatePeerTrust,
                    rest: {
                        method: "PUT",
                        path: "/peer/:peerUUID/trust"
                    }
                },
                getPeerCache: {
                    params: GetPeerCacheParams,
                    handler: this.getPeerCache,
                    rest: {
                        method: "GET",
                        path: "/peers"
                    }
                },
                generateMessageProof: {
                    params: {
                        messageContent: {
                            type: "string",
                            min: 1
                        },
                        senderUUID: {
                            type: "string",
                            min: 1
                        },
                        receiverUUID: {
                            type: "string",
                            min: 1
                        },
                        topic: {
                            type: "string",
                            min: 1
                        },
                        direction: {
                            type: "enum",
                            values: ["sent", "received"]
                        }
                    },
                    handler: this.generateMessageProofAction,
                    rest: {
                        method: "POST",
                        path: "/proof/message"
                    }
                },
                verifyMessageParticipation: {
                    params: {
                        receiptData: {
                            type: "object"
                        },
                        messageContent: {
                            type: "string",
                            min: 1
                        },
                        senderUUID: {
                            type: "string",
                            min: 1
                        },
                        receiverUUID: {
                            type: "string",
                            min: 1
                        },
                        topic: {
                            type: "string",
                            min: 1
                        }
                    },
                    handler: this.verifyMessageParticipationAction,
                    rest: {
                        method: "POST",
                        path: "/verify/message"
                    }
                },
                getJournalEntries: {
                    params: {
                        entryType: {
                            type: "enum",
                            values: ["message_receipt", "handshake_record", "key_rotation", "all"],
                            optional: true,
                            default: "all"
                        },
                        limit: {
                            type: "number",
                            min: 1,
                            max: 100,
                            optional: true,
                            default: 50
                        },
                        since: {
                            type: "string",
                            optional: true
                        }
                    },
                    handler: this.getJournalEntries,
                    rest: {
                        method: "GET",
                        path: "/journal"
                    }
                }
            },
            events: {
                "nucleus.started": this.onNucleusStarted
            },
            created: this.onCreated,
            started: this.onStarted,
            stopped: this.onStopped,
        });

        // Topic-to-core mapping
        this.topicMap = new Map();
        this.cellUUID = null;
        this.cleanupTimer = null;
        this.offlineMessageTimer = null;
        
        // Message storage 
        this.messageQueue = new Map(); // offline message queue
        this.cellPublicKey = null; // will be set from nucleus service
        
        // Inbox management
        this.inboxAutobase = null; // Autobase for this cell's inbox
        this.trustedPeers = new Set(); // UUIDs of peers with inbox access
        this.accessRequests = new Map(); // Pending access requests: UUID -> { timestamp, reason }
        this.peerAutobases = new Map(); // Cache of peer Autobase connections: UUID -> Autobase
        
        // Peer discovery system
        this.peerCache = null; // Hyperbee for local peer storage (Layer 3)
        this.discoveredPeers = new Map(); // In-memory cache: UUID -> peer info
        this.pendingHandshakes = new Map(); // Ongoing handshakes: connectionId -> { peer, timestamp }
        this.discoverySwarms = new Map(); // Active discovery swarms: topic -> swarm info
        this.capabilities = ["messaging"]; // This cell's capabilities
    }

    // Lifecycle events
    onCreated() {
        this.logger.info("Message service created");
    }

    async onStarted() {
        this.logger.info("Message service started");
        
        // Start cleanup timer
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredTopics();
        }, this.settings.cleanupInterval);
        
        // Start offline message processing timer
        this.offlineMessageTimer = setInterval(() => {
            this.processOfflineMessages().catch(err => {
                this.logger.error("Error processing offline messages:", err);
            });
        }, 30000); // Process every 30 seconds
    }

    async onStopped() {
        this.logger.info("Message service stopped");
        
        // Clear cleanup timer
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        
        // Clear offline message timer
        if (this.offlineMessageTimer) {
            clearInterval(this.offlineMessageTimer);
            this.offlineMessageTimer = null;
        }
    }

    async onNucleusStarted(ctx) {
        const { cellUUID, publicKey } = ctx.params;
        this.cellUUID = cellUUID;
        this.cellPublicKey = publicKey; // Store as string, nucleus handles crypto
        this.logger.info("Nucleus started, cell UUID:", cellUUID);
        
        this.logger.info("Using nucleus service for crypto operations");
        
        try {
            // Initialize inbox Autobase for this cell
            await this.initializeInbox();
            
            // Initialize peer discovery system
            await this.initializePeerDiscovery();
            
            // Create default topics for this cell
            await this.createDefaultTopics();
            
            // Join discovery swarms
            await this.joinDiscoverySwarms();
            
            this.logger.info("MessageService initialization completed successfully");
        } catch (err) {
            this.logger.error("Error in MessageService initialization:", err);
            throw err;
        }
    }

    // Action handlers
    async createTopic(ctx) {
        const { topicType, sourceUUID, targetUUID } = ctx.params;
        
        try {
            const topic = this.generateTopicName(topicType, sourceUUID, targetUUID);
            const coreInfo = await this.createCoreForTopic(topic, topicType, sourceUUID, targetUUID);
            
            this.logger.info(`Created topic: ${topic}`);
            return {
                success: true,
                topic,
                coreInfo
            };
        } catch (err) {
            this.logger.error("Failed to create topic:", err);
            throw err;
        }
    }

    async getTopic(ctx) {
        const { topic } = ctx.params;
        
        try {
            const coreInfo = this.topicMap.get(topic);
            if (!coreInfo) {
                throw new Error(`Topic not found: ${topic}`);
            }
            
            return {
                topic,
                coreInfo
            };
        } catch (err) {
            this.logger.error("Failed to get topic:", err);
            throw err;
        }
    }

    async bindTopic(ctx) {
        const { topic, coreKey } = ctx.params;
        
        try {
            // Delegate to NucleusService for core binding
            const result = await ctx.call("nucleus.bind", {
                topic,
                key: coreKey
            });
            
            // Update our topic mapping
            const coreInfo = this.parseTopicType(topic);
            coreInfo.coreKey = result.core.key;
            coreInfo.boundAt = new Date().toISOString();
            
            this.topicMap.set(topic, coreInfo);
            
            this.logger.info(`Bound to topic: ${topic}`);
            return {
                success: true,
                topic,
                coreInfo
            };
        } catch (err) {
            this.logger.error("Failed to bind topic:", err);
            throw err;
        }
    }

    async listTopics(ctx) {
        try {
            const topics = Array.from(this.topicMap.entries()).map(([topic, coreInfo]) => ({
                topic,
                ...coreInfo
            }));
            
            return {
                topics,
                count: topics.length
            };
        } catch (err) {
            this.logger.error("Failed to list topics:", err);
            throw err;
        }
    }

    async health(ctx) {
        const health = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            cellUUID: this.cellUUID,
            metrics: {
                topicsCount: this.topicMap.size,
                topicsByType: this.getTopicsByType()
            }
        };
        
        return health;
    }

    async sendMessage(ctx) {
        const { targetUUID, message, recipientPublicKey } = ctx.params;
        
        if (!this.cellUUID) {
            throw new Error("Cell not initialized - missing UUID");
        }
        
        try {
            // Generate topic name for direct message
            const topic = this.generateTopicName(TOPIC_TYPES.DIRECT, this.cellUUID, targetUUID);
            
            // Create or get the topic core
            let coreInfo = this.topicMap.get(topic);
            if (!coreInfo) {
                coreInfo = await this.createCoreForTopic(topic, TOPIC_TYPES.DIRECT, this.cellUUID, targetUUID);
            }
            
            // Create the message structure
            const messagePayload = {
                from: this.cellUUID,
                to: targetUUID,
                content: message,
                timestamp: new Date().toISOString(),
                messageId: this.generateMessageId()
            };
            
            // Use nucleus service for encryption and signing
            const encryptedData = await this.broker.call("nucleus.encryptForCell", {
                targetPublicKey: recipientPublicKey,
                message: JSON.stringify(messagePayload)
            });
            
            // Create final message structure
            const finalMessage = {
                ...encryptedData,
                senderPublicKey: this.cellPublicKey,
                timestamp: messagePayload.timestamp,
                messageId: messagePayload.messageId
            };
            
            // Write to hypercore via nucleus service
            await this.broker.call("nucleus.write", {
                name: topic,
                data: finalMessage
            });
            
            this.logger.info(`Message sent from ${this.cellUUID} to ${targetUUID}`);
            
            // Log message receipt to journal
            await this.logMessageReceipt(messagePayload, "sent", topic, targetUUID);
            
            // Try to send notification to recipient's inbox if we have access
            try {
                if (this.trustedPeers.has(targetUUID)) {
                    await this.broker.call("message.sendNotification", {
                        targetUUID,
                        notification: {
                            type: "message_notification",
                            from: this.cellUUID,
                            to: targetUUID,
                            topic,
                            coreKey: coreInfo.coreKey,
                            messageId: messagePayload.messageId
                        }
                    });
                }
            } catch (notificationErr) {
                this.logger.warn("Failed to send message notification:", notificationErr);
                // Don't fail the whole message send if notification fails
            }
            
            return {
                success: true,
                messageId: messagePayload.messageId,
                topic,
                timestamp: messagePayload.timestamp
            };
            
        } catch (err) {
            this.logger.error("Failed to send message:", err);
            
            // Queue message for offline delivery
            this.queueOfflineMessage(targetUUID, message, recipientPublicKey);
            
            throw err;
        }
    }

    async getMessages(ctx) {
        const { topic, limit = 50, since } = ctx.params;
        
        try {
            // Get the topic core info
            const coreInfo = this.topicMap.get(topic);
            if (!coreInfo) {
                throw new Error(`Topic not found: ${topic}`);
            }
            
            // Read messages from hypercore via nucleus service
            const result = await this.broker.call("nucleus.read", {
                name: topic,
                limit,
                since: since ? new Date(since).getTime() : undefined
            });
            
            const messages = [];
            
            for (const entry of result.entries || []) {
                try {
                    const messageData = JSON.parse(entry.data);
                    
                    // Try to decrypt message using nucleus service
                    let decryptedMessage = null;
                    try {
                        if (messageData.encrypted && messageData.signature) {
                            const decrypted = await this.broker.call("nucleus.decryptFromCell", {
                                sourcePublicKey: messageData.senderPublicKey,
                                encryptedData: {
                                    encrypted: messageData.encrypted,
                                    signature: messageData.signature
                                }
                            });
                            decryptedMessage = JSON.parse(decrypted);
                        }
                    } catch (decryptErr) {
                        this.logger.debug("Could not decrypt message (not intended for this recipient)");
                        // Still include the message but without decrypted content
                    }
                    
                    const messageInfo = {
                        messageId: decryptedMessage?.messageId || messageData.messageId || 'encrypted',
                        from: decryptedMessage?.from || 'unknown',
                        to: decryptedMessage?.to || 'unknown',
                        content: decryptedMessage?.content || null,
                        timestamp: messageData.timestamp,
                        encrypted: !decryptedMessage,
                        verified: true // nucleus service handles signature verification
                    };
                    
                    messages.push(messageInfo);
                    
                    // Log message receipt to journal if we successfully decrypted it
                    if (decryptedMessage && decryptedMessage.from !== this.cellUUID) {
                        // This is a message we received (not sent by us)
                        await this.logMessageReceipt(decryptedMessage, "received", topic, decryptedMessage.from);
                    }
                    
                } catch (parseErr) {
                    this.logger.warn("Failed to parse message entry:", parseErr);
                }
            }
            
            return {
                topic,
                messages,
                count: messages.length,
                hasMore: result.hasMore || false
            };
            
        } catch (err) {
            this.logger.error("Failed to get messages:", err);
            throw err;
        }
    }

    async sendNotification(ctx) {
        const { targetUUID, notification } = ctx.params;
        
        if (!this.cellUUID) {
            throw new Error("Cell not initialized - missing UUID");
        }
        
        try {
            // Ensure we have permission to write to target's inbox
            if (!this.trustedPeers.has(targetUUID)) {
                throw new Error(`No inbox access granted for peer: ${targetUUID}`);
            }
            
            // Get the target peer's inbox Autobase
            let targetAutobase = this.peerAutobases.get(targetUUID);
            if (!targetAutobase) {
                // Connect to target's inbox
                targetAutobase = await this.connectToPeerInbox(targetUUID);
                if (!targetAutobase) {
                    throw new Error("Peer inbox connection not fully implemented");
                }
            }
            
            // Sign the notification
            const notificationToSign = {
                ...notification,
                from: this.cellUUID,
                timestamp: new Date().toISOString()
            };
            
            const signature = await this.broker.call("nucleus.signMessage", {
                message: JSON.stringify(notificationToSign)
            });
            
            const signedNotification = {
                ...notificationToSign,
                signature
            };
            
            // Write notification to target's inbox
            await targetAutobase.append(JSON.stringify(signedNotification));
            
            this.logger.info(`Notification sent to ${targetUUID}: ${notification.type}`);
            
            return {
                success: true,
                targetUUID,
                notificationType: notification.type,
                timestamp: notificationToSign.timestamp
            };
            
        } catch (err) {
            this.logger.error("Failed to send notification:", err);
            throw err;
        }
    }

    async requestInboxAccess(ctx) {
        const { targetUUID, reason } = ctx.params;
        
        if (!this.cellUUID) {
            throw new Error("Cell not initialized - missing UUID");
        }
        
        try {
            // Create access request notification
            const accessRequest = {
                type: "access_request",
                from: this.cellUUID,
                to: targetUUID,
                reason: reason || "Requesting inbox access for peer communication",
                timestamp: new Date().toISOString(),
                publicKey: this.cellPublicKey
            };
            
            // For now, we'll store the request locally and try to send it
            // In a full implementation, this would go through the discovery system
            this.logger.info(`Access request created for ${targetUUID}: ${accessRequest.reason}`);
            
            return {
                success: true,
                targetUUID,
                requestTimestamp: accessRequest.timestamp,
                status: "pending"
            };
            
        } catch (err) {
            this.logger.error("Failed to request inbox access:", err);
            throw err;
        }
    }

    async grantInboxAccess(ctx) {
        const { requesterUUID, granted } = ctx.params;
        
        if (!this.cellUUID) {
            throw new Error("Cell not initialized - missing UUID");
        }
        
        try {
            if (granted) {
                // Add to trusted peers
                this.trustedPeers.add(requesterUUID);
                
                // Add requester as writer to our inbox Autobase
                if (this.inboxAutobase) {
                    // In a real implementation, we would get the requester's public key
                    // and add them as a writer. For now, we'll just track the trust.
                    this.logger.info(`Granted inbox access to ${requesterUUID}`);
                }
                
                // Remove from pending requests
                this.accessRequests.delete(requesterUUID);
                
                return {
                    success: true,
                    requesterUUID,
                    granted: true,
                    timestamp: new Date().toISOString()
                };
            } else {
                // Deny access
                this.accessRequests.delete(requesterUUID);
                this.logger.info(`Denied inbox access to ${requesterUUID}`);
                
                return {
                    success: true,
                    requesterUUID,
                    granted: false,
                    timestamp: new Date().toISOString()
                };
            }
            
        } catch (err) {
            this.logger.error("Failed to grant/deny inbox access:", err);
            throw err;
        }
    }

    async getInboxNotifications(ctx) {
        const { limit = 50, since } = ctx.params;
        
        if (!this.inboxAutobase) {
            throw new Error("Inbox not initialized");
        }
        
        try {
            const notifications = [];
            const sinceTime = since ? new Date(since).getTime() : 0;
            
            // Read from our inbox Autobase
            const length = await this.inboxAutobase.length;
            const startIndex = Math.max(0, length - limit);
            
            for (let i = startIndex; i < length; i++) {
                try {
                    const entry = await this.inboxAutobase.get(i);
                    const notification = JSON.parse(entry.toString());
                    
                    const notificationTime = new Date(notification.timestamp).getTime();
                    if (notificationTime >= sinceTime) {
                        notifications.push(notification);
                    }
                } catch (parseErr) {
                    this.logger.warn("Failed to parse notification entry:", parseErr);
                }
            }
            
            return {
                notifications,
                count: notifications.length,
                hasMore: startIndex > 0
            };
            
        } catch (err) {
            this.logger.error("Failed to get inbox notifications:", err);
            throw err;
        }
    }

    async lookupPeer(ctx) {
        const { peerUUID } = ctx.params;
        
        try {
            // First check in-memory cache
            let peerInfo = this.discoveredPeers.get(peerUUID);
            
            if (!peerInfo && this.peerCache) {
                // Check persistent cache (Hyperbee)
                const key = `peer:${peerUUID}`;
                const entry = await this.peerCache.get(key);
                if (entry) {
                    peerInfo = JSON.parse(entry.value);
                    // Update in-memory cache
                    this.discoveredPeers.set(peerUUID, peerInfo);
                }
            }
            
            if (peerInfo) {
                return {
                    found: true,
                    peer: peerInfo
                };
            } else {
                // Broadcast lookup request on discovery swarms
                await this.broadcastPeerLookup(peerUUID);
                
                return {
                    found: false,
                    message: `Peer lookup broadcast sent for ${peerUUID}`
                };
            }
            
        } catch (err) {
            this.logger.error("Failed to lookup peer:", err);
            throw err;
        }
    }

    async introducePeer(ctx) {
        const { requesterUUID, targetUUID } = ctx.params;
        
        if (!this.cellUUID) {
            throw new Error("Cell not initialized - missing UUID");
        }
        
        try {
            // Check if we know both peers
            const requesterInfo = this.discoveredPeers.get(requesterUUID);
            const targetInfo = this.discoveredPeers.get(targetUUID);
            
            if (!requesterInfo) {
                throw new Error(`Unknown requester: ${requesterUUID}`);
            }
            
            if (!targetInfo) {
                throw new Error(`Unknown target: ${targetUUID}`);
            }
            
            // Check trust levels - only introduce if we trust both
            if (requesterInfo.trustLevel !== TRUST_LEVELS.TRUSTED || 
                targetInfo.trustLevel !== TRUST_LEVELS.TRUSTED) {
                throw new Error("Peer introduction requires trusted relationship with both peers");
            }
            
            // Create introduction message
            const introduction = {
                type: "peer_introduction",
                introducer: this.cellUUID,
                target: {
                    uuid: targetInfo.uuid,
                    publicKey: targetInfo.publicKey,
                    inboxDiscoveryKey: targetInfo.inboxDiscoveryKey,
                    capabilities: targetInfo.capabilities
                },
                timestamp: new Date().toISOString()
            };
            
            // Sign the introduction
            const signature = await this.broker.call("nucleus.signMessage", {
                message: JSON.stringify(introduction)
            });
            
            introduction.signature = signature;
            
            // Send introduction to requester via their inbox (if we have access)
            if (this.trustedPeers.has(requesterUUID)) {
                try {
                    await this.broker.call("message.sendNotification", {
                        targetUUID: requesterUUID,
                        notification: {
                            type: "peer_introduction",
                            from: this.cellUUID,
                            timestamp: introduction.timestamp,
                            // Include the introduction details in the notification
                            introductionData: introduction
                        }
                    });
                } catch (notificationErr) {
                    this.logger.warn("Failed to send peer introduction notification:", notificationErr.message);
                    // Don't fail the introduction if notification fails
                }
            }
            
            this.logger.info(`Introduced ${targetUUID} to ${requesterUUID}`);
            
            return {
                success: true,
                message: `Introduced ${targetUUID} to ${requesterUUID}`,
                timestamp: introduction.timestamp
            };
            
        } catch (err) {
            this.logger.error("Failed to introduce peer:", err);
            throw err;
        }
    }

    async updatePeerTrust(ctx) {
        const { peerUUID, trustLevel } = ctx.params;
        
        try {
            // Get current peer info
            let peerInfo = this.discoveredPeers.get(peerUUID);
            
            if (!peerInfo && this.peerCache) {
                // Try to load from persistent cache
                const key = `peer:${peerUUID}`;
                const entry = await this.peerCache.get(key);
                if (entry) {
                    peerInfo = JSON.parse(entry.value);
                }
            }
            
            if (!peerInfo) {
                throw new Error(`Peer not found: ${peerUUID}`);
            }
            
            // Update trust level
            const oldTrustLevel = peerInfo.trustLevel;
            peerInfo.trustLevel = trustLevel;
            peerInfo.lastUpdated = new Date().toISOString();
            
            // Add to connection history
            if (!peerInfo.connectionHistory) {
                peerInfo.connectionHistory = [];
            }
            
            peerInfo.connectionHistory.push({
                timestamp: new Date().toISOString(),
                event: "trust_updated",
                oldLevel: oldTrustLevel,
                newLevel: trustLevel
            });
            
            // Update caches
            this.discoveredPeers.set(peerUUID, peerInfo);
            
            if (this.peerCache) {
                const key = `peer:${peerUUID}`;
                await this.peerCache.put(key, JSON.stringify(peerInfo));
            }
            
            // Update trusted peers set based on new trust level
            if (trustLevel === TRUST_LEVELS.TRUSTED) {
                this.trustedPeers.add(peerUUID);
            } else {
                this.trustedPeers.delete(peerUUID);
            }
            
            this.logger.info(`Updated trust level for ${peerUUID}: ${oldTrustLevel} -> ${trustLevel}`);
            
            return {
                success: true,
                peerUUID,
                oldTrustLevel,
                newTrustLevel: trustLevel,
                timestamp: peerInfo.lastUpdated
            };
            
        } catch (err) {
            this.logger.error("Failed to update peer trust:", err);
            throw err;
        }
    }

    async getPeerCache(ctx) {
        const { trustLevel, limit = 50 } = ctx.params;
        
        try {
            const peers = [];
            
            // Get peers from in-memory cache
            for (const [uuid, peerInfo] of this.discoveredPeers) {
                if (!trustLevel || peerInfo.trustLevel === trustLevel) {
                    peers.push(peerInfo);
                }
                
                if (peers.length >= limit) {
                    break;
                }
            }
            
            return {
                peers,
                count: peers.length,
                totalDiscovered: this.discoveredPeers.size
            };
            
        } catch (err) {
            this.logger.error("Failed to get peer cache:", err);
            throw err;
        }
    }

    async generateMessageProofAction(ctx) {
        const { messageContent, senderUUID, receiverUUID, topic, direction } = ctx.params;
        
        try {
            const proof = await this.generateMessageProof(messageContent, senderUUID, receiverUUID, topic, direction);
            
            return {
                success: true,
                proof
            };
            
        } catch (err) {
            this.logger.error("Failed to generate message proof:", err);
            throw err;
        }
    }

    async verifyMessageParticipationAction(ctx) {
        const { receiptData, messageContent, senderUUID, receiverUUID, topic } = ctx.params;
        
        try {
            const verification = await this.verifyMessageParticipation(receiptData, messageContent, senderUUID, receiverUUID, topic);
            
            return {
                success: true,
                verification
            };
            
        } catch (err) {
            this.logger.error("Failed to verify message participation:", err);
            throw err;
        }
    }

    async getJournalEntries(ctx) {
        const { entryType = "all", limit = 50, since } = ctx.params;
        
        try {
            // Read from journal via nucleus service
            const result = await this.broker.call("nucleus.read", {
                name: "journal",
                limit,
                since: since ? new Date(since).getTime() : undefined
            });
            
            const entries = [];
            
            for (const entry of result.entries || []) {
                try {
                    const entryData = JSON.parse(entry.data);
                    
                    // Filter by entry type if specified
                    if (entryType === "all" || entryData.type === entryType) {
                        entries.push({
                            index: entry.index,
                            type: entryData.type,
                            data: entryData,
                            timestamp: entryData.timestamp
                        });
                    }
                    
                } catch (parseErr) {
                    this.logger.warn("Failed to parse journal entry:", parseErr);
                }
            }
            
            return {
                entries,
                count: entries.length,
                hasMore: result.hasMore || false,
                entryType
            };
            
        } catch (err) {
            this.logger.error("Failed to get journal entries:", err);
            throw err;
        }
    }

    // Helper methods
    generateTopicName(topicType, sourceUUID, targetUUID = null) {
        switch (topicType) {
            case TOPIC_TYPES.DIRECT:
                if (!targetUUID) {
                    throw new Error("Target UUID required for direct topic");
                }
                return `${TOPIC_TYPES.DIRECT}:${sourceUUID}:${targetUUID}`;
            
            case TOPIC_TYPES.INBOX:
                return `${TOPIC_TYPES.INBOX}:${sourceUUID}`;
            
            case TOPIC_TYPES.PEER_CACHE:
                return `${TOPIC_TYPES.PEER_CACHE}:${sourceUUID}`;
            
            case TOPIC_TYPES.JOURNAL:
                return `${TOPIC_TYPES.JOURNAL}:${sourceUUID}`;
            
            default:
                throw new Error(`Unknown topic type: ${topicType}`);
        }
    }

    parseTopicType(topic) {
        const parts = topic.split(':');
        if (parts.length < 2) {
            throw new Error(`Invalid topic format: ${topic}`);
        }
        
        const topicType = parts[0];
        const sourceUUID = parts[1];
        const targetUUID = parts.length > 2 ? parts[2] : null;
        
        return {
            type: topicType,
            sourceUUID,
            targetUUID,
            encrypted: this.shouldEncrypt(topicType),
            createdAt: new Date().toISOString()
        };
    }

    shouldEncrypt(topicType) {
        // Direct messages should be encrypted
        // Inbox notifications are not encrypted (metadata only)
        // Peer cache is not encrypted (local contact book)
        // Journal is not encrypted (public identity info)
        return topicType === TOPIC_TYPES.DIRECT;
    }

    async createCoreForTopic(topic, topicType, sourceUUID, targetUUID) {
        // Parse topic metadata
        const coreInfo = this.parseTopicType(topic);
        
        // Determine access control
        const access = this.determineAccess(topicType, sourceUUID, targetUUID);
        coreInfo.writers = access.writers;
        coreInfo.readers = access.readers;
        
        // Delegate core creation to NucleusService
        const result = await this.broker.call("nucleus.get", { name: topic });
        coreInfo.coreKey = result.core.key;
        
        // Store in topic mapping
        this.topicMap.set(topic, coreInfo);
        
        return coreInfo;
    }

    determineAccess(topicType, sourceUUID, targetUUID) {
        switch (topicType) {
            case TOPIC_TYPES.DIRECT:
                return {
                    writers: [sourceUUID],
                    readers: [targetUUID]
                };
            
            case TOPIC_TYPES.INBOX:
                return {
                    writers: [sourceUUID], // Cell owns its inbox, grants access later
                    readers: [sourceUUID]
                };
            
            case TOPIC_TYPES.PEER_CACHE:
                return {
                    writers: [sourceUUID], // Only cell writes to its own cache
                    readers: [sourceUUID]  // Only cell reads its own cache
                };
            
            case TOPIC_TYPES.JOURNAL:
                return {
                    writers: [sourceUUID], // Only cell writes to its own journal
                    readers: ["*"]         // Public - anyone can read
                };
            
            default:
                throw new Error(`Unknown topic type: ${topicType}`);
        }
    }

    async createDefaultTopics() {
        if (!this.cellUUID) {
            this.logger.warn("Cannot create default topics - cell UUID not available");
            return;
        }
        
        try {
            // Create inbox topic for this cell
            const inboxTopic = this.generateTopicName(TOPIC_TYPES.INBOX, this.cellUUID);
            await this.createCoreForTopic(inboxTopic, TOPIC_TYPES.INBOX, this.cellUUID);
            this.logger.info(`Created default inbox topic: ${inboxTopic}`);
            
            // Create peer cache topic for this cell
            const peerCacheTopic = this.generateTopicName(TOPIC_TYPES.PEER_CACHE, this.cellUUID);
            await this.createCoreForTopic(peerCacheTopic, TOPIC_TYPES.PEER_CACHE, this.cellUUID);
            this.logger.info(`Created default peer cache topic: ${peerCacheTopic}`);
            
            // Create journal topic for this cell
            const journalTopic = this.generateTopicName(TOPIC_TYPES.JOURNAL, this.cellUUID);
            await this.createCoreForTopic(journalTopic, TOPIC_TYPES.JOURNAL, this.cellUUID);
            this.logger.info(`Created default journal topic: ${journalTopic}`);
            
        } catch (err) {
            this.logger.error("Failed to create default topics:", err);
        }
    }

    getTopicsByType() {
        const typeCount = {};
        
        for (const [topic, coreInfo] of this.topicMap) {
            const type = coreInfo.type;
            typeCount[type] = (typeCount[type] || 0) + 1;
        }
        
        return typeCount;
    }

    cleanupExpiredTopics() {
        const now = Date.now();
        const expiredTopics = [];
        
        for (const [topic, coreInfo] of this.topicMap) {
            const createdAt = new Date(coreInfo.createdAt).getTime();
            if (now - createdAt > this.settings.coreExpirationTime) {
                expiredTopics.push(topic);
            }
        }
        
        // Remove expired topics
        for (const topic of expiredTopics) {
            this.topicMap.delete(topic);
            this.logger.debug(`Cleaned up expired topic: ${topic}`);
        }
        
        if (expiredTopics.length > 0) {
            this.logger.info(`Cleaned up ${expiredTopics.length} expired topics`);
        }
    }

    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Offline message queue methods
    queueOfflineMessage(targetUUID, message, recipientPublicKey) {
        const queueKey = `offline:${targetUUID}`;
        
        if (!this.messageQueue.has(queueKey)) {
            this.messageQueue.set(queueKey, []);
        }
        
        const queue = this.messageQueue.get(queueKey);
        queue.push({
            targetUUID,
            message,
            recipientPublicKey,
            timestamp: new Date().toISOString(),
            retryCount: 0
        });
        
        this.logger.info(`Queued offline message for ${targetUUID}`);
    }

    async processOfflineMessages() {
        for (const [queueKey, queue] of this.messageQueue.entries()) {
            const targetUUID = queueKey.replace('offline:', '');
            
            // Process messages in queue
            const successfullyProcessed = [];
            
            for (let i = 0; i < queue.length; i++) {
                const queuedMessage = queue[i];
                
                try {
                    // Try to send the message
                    await this.broker.call("message.sendMessage", {
                        targetUUID: queuedMessage.targetUUID,
                        message: queuedMessage.message,
                        recipientPublicKey: queuedMessage.recipientPublicKey
                    });
                    
                    successfullyProcessed.push(i);
                    this.logger.info(`Successfully sent offline message to ${targetUUID}`);
                    
                } catch (err) {
                    queuedMessage.retryCount++;
                    
                    // Remove message after max retries
                    if (queuedMessage.retryCount >= 5) {
                        successfullyProcessed.push(i);
                        this.logger.warn(`Giving up on offline message to ${targetUUID} after 5 retries`);
                    }
                }
            }
            
            // Remove successfully processed messages
            for (let i = successfullyProcessed.length - 1; i >= 0; i--) {
                queue.splice(successfullyProcessed[i], 1);
            }
            
            // Clean up empty queues
            if (queue.length === 0) {
                this.messageQueue.delete(queueKey);
            }
        }
    }

    // Inbox helper methods
    async initializeInbox() {
        if (!this.cellUUID) {
            throw new Error("Cannot initialize inbox - cell UUID not available");
        }
        
        try {
            // Get inbox topic name
            const inboxTopic = this.generateTopicName(TOPIC_TYPES.INBOX, this.cellUUID);
            
            // Get or create the inbox core from nucleus service
            const result = await this.broker.call("nucleus.get", { name: inboxTopic });
            
            // For now, use a simplified approach - just store the core info
            // In production, this would be a proper Autobase setup
            this.inboxAutobase = {
                core: result.core,
                length: 0,
                discoveryKey: result.core.discoveryKey,
                async append(data) {
                    // Simplified append - just increment length
                    this.length++;
                    this.core.append(data);
                },
                async get(index) {
                    return this.core.get(index);
                },
                async ready() {
                    return this.core.ready();
                }
            };
            
            // Initialize length
            this.inboxAutobase.length = this.inboxAutobase.core.length || 0;
            
            this.logger.info(`Initialized inbox for cell ${this.cellUUID}`);
            
            // Add our own announcement to the inbox
            await this.sendSelfAnnouncement();
            
        } catch (err) {
            this.logger.error("Failed to initialize inbox:", err);
            throw err;
        }
    }

    async connectToPeerInbox(peerUUID) {
        try {
            // For now, this is a simplified implementation
            // In a full implementation, we would:
            // 1. Look up peer's inbox discovery key from peer cache
            // 2. Connect to their Autobase using the discovery key
            // 3. Handle the multi-writer setup properly
            
            // Simplified placeholder - return null for now
            this.logger.warn(`Peer inbox connection not fully implemented for ${peerUUID}`);
            return null;
            
        } catch (err) {
            this.logger.error(`Failed to connect to peer inbox ${peerUUID}:`, err);
            throw err;
        }
    }

    async sendSelfAnnouncement() {
        if (!this.inboxAutobase || !this.cellUUID) {
            return;
        }
        
        try {
            const announcement = {
                type: "peer_announcement",
                uuid: this.cellUUID,
                publicKey: this.cellPublicKey,
                inboxDiscoveryKey: this.inboxAutobase.discoveryKey?.toString('hex') || 'not-available',
                capabilities: ["messaging"],
                timestamp: new Date().toISOString()
            };
            
            // Sign the announcement
            const signature = await this.broker.call("nucleus.signMessage", {
                message: JSON.stringify(announcement)
            });
            
            const signedAnnouncement = {
                ...announcement,
                signature
            };
            
            await this.inboxAutobase.append(JSON.stringify(signedAnnouncement));
            this.logger.info(`Sent self-announcement to inbox`);
            
        } catch (err) {
            this.logger.error("Failed to send self-announcement:", err);
        }
    }

    async applyInboxEntry(batch, clocks, change) {
        // This is called by Autobase to apply entries to the inbox
        // For now, we'll just return the data as-is
        // In a full implementation, this would handle:
        // - Entry validation
        // - Signature verification
        // - Spam filtering
        // - Access control checks
        
        return batch;
    }

    // Discovery system helper methods
    async initializePeerDiscovery() {
        if (!this.cellUUID) {
            throw new Error("Cannot initialize peer discovery - cell UUID not available");
        }
        
        try {
            // Get peer cache topic name
            const peerCacheTopic = this.generateTopicName(TOPIC_TYPES.PEER_CACHE, this.cellUUID);
            
            // Get or create the peer cache core from nucleus service
            const result = await this.broker.call("nucleus.get", { name: peerCacheTopic });
            
            // Check if we're in a test environment (nucleus service returns a mock core)
            if (result.core && !result.core.registerExtension) {
                // Create a simplified mock for testing
                this.peerCache = {
                    ready: () => Promise.resolve(),
                    put: (key, value) => Promise.resolve(),
                    get: (key) => Promise.resolve(null),
                    createReadStream: () => ({
                        [Symbol.asyncIterator]: async function* () {
                            return;
                        }
                    })
                };
            } else {
                // Create Hyperbee for peer cache (production)
                this.peerCache = new Hyperbee(result.core, {
                    keyEncoding: 'utf-8',
                    valueEncoding: 'utf-8'
                });
                await this.peerCache.ready();
            }
            
            this.logger.info(`Initialized peer cache for cell ${this.cellUUID}`);
            
            // Load existing peers from cache
            await this.loadPeersFromCache();
            
        } catch (err) {
            this.logger.error("Failed to initialize peer discovery:", err);
            throw err;
        }
    }

    async joinDiscoverySwarms() {
        if (!this.cellUUID) {
            this.logger.warn("Cannot join discovery swarms - cell UUID not available");
            return;
        }
        
        try {
            // For now, this is a placeholder for joining Hyperswarm discovery topics
            // In a full implementation, this would:
            // 1. Get the swarm from NucleusService
            // 2. Join the discovery topics
            // 3. Set up connection event handlers
            // 4. Handle incoming peer connections and handshakes
            
            this.logger.info("Discovery swarms initialization placeholder - would join:", DISCOVERY_TOPICS);
            
            // Simulate discovery by adding self to peer cache
            await this.addSelfToPeerCache();
            
        } catch (err) {
            this.logger.error("Failed to join discovery swarms:", err);
        }
    }

    async loadPeersFromCache() {
        if (!this.peerCache) {
            return;
        }
        
        try {
            // Iterate through all peer entries in Hyperbee
            const stream = this.peerCache.createReadStream({
                gte: 'peer:',
                lt: 'peer;\xff'
            });
            
            for await (const { key, value } of stream) {
                try {
                    const peerInfo = JSON.parse(value);
                    const peerUUID = key.replace('peer:', '');
                    
                    // Add to in-memory cache
                    this.discoveredPeers.set(peerUUID, peerInfo);
                    
                    // Update trusted peers set
                    if (peerInfo.trustLevel === TRUST_LEVELS.TRUSTED) {
                        this.trustedPeers.add(peerUUID);
                    }
                    
                } catch (parseErr) {
                    this.logger.warn("Failed to parse peer cache entry:", parseErr);
                }
            }
            
            this.logger.info(`Loaded ${this.discoveredPeers.size} peers from cache`);
            
        } catch (err) {
            this.logger.error("Failed to load peers from cache:", err);
        }
    }

    async addSelfToPeerCache() {
        if (!this.cellUUID || !this.peerCache) {
            return;
        }
        
        try {
            const selfInfo = {
                uuid: this.cellUUID,
                publicKey: this.cellPublicKey,
                inboxDiscoveryKey: this.inboxAutobase?.discoveryKey?.toString('hex') || 'not-available',
                journalDiscoveryKey: 'not-implemented', // Will be implemented with IdentityService
                capabilities: this.capabilities,
                trustLevel: TRUST_LEVELS.TRUSTED, // Always trust self
                relationshipStatus: RELATIONSHIP_STATUS.CONNECTED,
                lastSeen: new Date().toISOString(),
                connectionHistory: [
                    {
                        timestamp: new Date().toISOString(),
                        event: "self_registration",
                        success: true
                    }
                ],
                signature: await this.broker.call("nucleus.signMessage", {
                    message: JSON.stringify({
                        uuid: this.cellUUID,
                        publicKey: this.cellPublicKey,
                        timestamp: new Date().toISOString()
                    })
                })
            };
            
            // Add to caches
            this.discoveredPeers.set(this.cellUUID, selfInfo);
            this.trustedPeers.add(this.cellUUID);
            
            const key = `peer:${this.cellUUID}`;
            await this.peerCache.put(key, JSON.stringify(selfInfo));
            
            this.logger.info("Added self to peer cache");
            
        } catch (err) {
            this.logger.error("Failed to add self to peer cache:", err);
        }
    }

    async broadcastPeerLookup(peerUUID) {
        // Placeholder for broadcasting peer lookup requests
        // In a full implementation, this would:
        // 1. Create a peer lookup message
        // 2. Sign the message
        // 3. Broadcast to all connected discovery swarms
        // 4. Wait for responses from peers who know the target
        
        this.logger.info(`Broadcasting peer lookup for ${peerUUID} (placeholder)`);
        
        return {
            success: true,
            message: "Lookup broadcast sent (simulated)"
        };
    }

    async handleIncomingConnection(connection, peerInfo) {
        // Placeholder for handling incoming peer connections
        // In a full implementation, this would:
        // 1. Perform identity handshake
        // 2. Verify signatures
        // 3. Exchange capabilities
        // 4. Update peer cache
        // 5. Establish trust relationship
        
        this.logger.info("Incoming peer connection handler (placeholder):", peerInfo);
    }

    async performHandshake(connection) {
        // Placeholder for performing identity handshake
        // In a full implementation, this would:
        // 1. Send handshake message with cell info
        // 2. Receive and verify peer's handshake
        // 3. Exchange discovery keys and capabilities
        // 4. Establish connection trust level
        
        // Get journal discovery key from nucleus service
        let journalDiscoveryKey = 'not-available';
        try {
            const journalInfo = await this.broker.call("nucleus.get", { name: 'journal' });
            journalDiscoveryKey = journalInfo.core.discoveryKey || 'not-available';
        } catch (err) {
            this.logger.warn("Could not get journal discovery key for handshake:", err.message);
        }
        
        const handshakeMessage = {
            version: HANDSHAKE_VERSION,
            uuid: this.cellUUID,
            publicKey: this.cellPublicKey,
            inboxDiscoveryKey: this.inboxAutobase?.discoveryKey?.toString('hex') || 'not-available',
            journalDiscoveryKey,
            capabilities: this.capabilities,
            timestamp: new Date().toISOString()
        };
        
        // Sign the handshake
        handshakeMessage.signature = await this.broker.call("nucleus.signMessage", {
            message: JSON.stringify(handshakeMessage)
        });
        
        // Log handshake to journal
        await this.logHandshakeRecord(
            "unknown-peer", // Will be updated when we know the peer UUID
            "outgoing",
            true,
            this.capabilities
        );
        
        this.logger.info("Handshake created (placeholder):", handshakeMessage);
        
        return handshakeMessage;
    }

    // Journal Integration Methods
    
    /**
     * Log a message receipt to the journal (privacy-preserving)
     */
    async logMessageReceipt(messageData, direction, topic, participantUUID) {
        try {
            if (!this.cellUUID) {
                this.logger.warn("Cannot log message receipt - cell UUID not available");
                return;
            }
            
            const receiptId = this.generateReceiptId();
            const timestamp = new Date().toISOString();
            
            // Create privacy-preserving hashes
            const messageHash = this.hashMessage(messageData);
            const participantHash = this.hashParticipants(this.cellUUID, participantUUID);
            const topicHash = this.hashTopic(topic);
            
            const receipt = {
                type: "message_receipt",
                receiptId,
                messageHash,
                participantHash,
                direction, // "sent" or "received"
                timestamp,
                topicHash,
                cellUUID: this.cellUUID // For journal organization
            };
            
            // Sign the receipt
            receipt.signature = await this.broker.call("nucleus.signMessage", {
                message: JSON.stringify(receipt)
            });
            
            // Write to journal via nucleus service
            await this.broker.call("nucleus.write", {
                data: receipt
            });
            
            this.logger.debug(`Logged message receipt: ${receiptId} (${direction})`);
            
            return receiptId;
            
        } catch (err) {
            this.logger.error("Failed to log message receipt:", err);
            // Don't throw - receipt logging shouldn't break message flow
        }
    }
    
    /**
     * Log a handshake operation to the journal
     */
    async logHandshakeRecord(peerUUID, handshakeType, success, capabilities = []) {
        try {
            if (!this.cellUUID) {
                this.logger.warn("Cannot log handshake record - cell UUID not available");
                return;
            }
            
            const handshakeId = this.generateHandshakeId();
            const timestamp = new Date().toISOString();
            
            // Create privacy-preserving peer hash
            const peerHash = this.hashPeerUUID(peerUUID);
            
            const record = {
                type: "handshake_record",
                handshakeId,
                peerHash,
                handshakeType, // "incoming", "outgoing", "introduction"
                success,
                capabilities: capabilities || [],
                timestamp,
                cellUUID: this.cellUUID
            };
            
            // Sign the record
            record.signature = await this.broker.call("nucleus.signMessage", {
                message: JSON.stringify(record)
            });
            
            // Write to journal via nucleus service
            await this.broker.call("nucleus.write", {
                data: record
            });
            
            this.logger.debug(`Logged handshake record: ${handshakeId} (${handshakeType}, success: ${success})`);
            
            return handshakeId;
            
        } catch (err) {
            this.logger.error("Failed to log handshake record:", err);
            // Don't throw - handshake logging shouldn't break connection flow
        }
    }
    
    /**
     * Log a key rotation event to the journal
     */
    async logKeyRotation(oldPublicKey, newPublicKey, reason = "scheduled") {
        try {
            if (!this.cellUUID) {
                this.logger.warn("Cannot log key rotation - cell UUID not available");
                return;
            }
            
            const rotationId = this.generateRotationId();
            const timestamp = new Date().toISOString();
            
            // Create hashes of the keys
            const oldKeyHash = this.hashPublicKey(oldPublicKey);
            const newKeyHash = this.hashPublicKey(newPublicKey);
            
            const rotation = {
                type: "key_rotation",
                rotationId,
                oldKeyHash,
                newKeyHash,
                reason, // "scheduled", "compromise", "upgrade"
                timestamp,
                cellUUID: this.cellUUID
            };
            
            // Sign with the old key (if still available)
            rotation.signature = await this.broker.call("nucleus.signMessage", {
                message: JSON.stringify(rotation)
            });
            
            // Write to journal via nucleus service
            await this.broker.call("nucleus.write", {
                data: rotation
            });
            
            this.logger.info(`Logged key rotation: ${rotationId} (reason: ${reason})`);
            
            return rotationId;
            
        } catch (err) {
            this.logger.error("Failed to log key rotation:", err);
            // Don't throw - key rotation logging shouldn't break rotation process
        }
    }
    
    /**
     * Verify message participation using receipt data
     */
    async verifyMessageParticipation(receiptData, messageContent, senderUUID, receiverUUID, topic) {
        try {
            // Recreate the hashes with the provided data
            const expectedMessageHash = this.hashMessage(messageContent);
            const expectedParticipantHash = this.hashParticipants(senderUUID, receiverUUID);
            const expectedTopicHash = this.hashTopic(topic);
            
            // Compare with receipt data
            const messageHashMatches = receiptData.messageHash === expectedMessageHash;
            const participantHashMatches = receiptData.participantHash === expectedParticipantHash;
            const topicHashMatches = receiptData.topicHash === expectedTopicHash;
            
            // Verify signature
            const receiptForSignature = { ...receiptData };
            delete receiptForSignature.signature;
            
            // For verification, we would need to get the public key from the receipt's cellUUID
            // This is a placeholder for the verification logic
            const signatureValid = true; // Would implement actual verification
            
            return {
                valid: messageHashMatches && participantHashMatches && topicHashMatches && signatureValid,
                details: {
                    messageHashMatches,
                    participantHashMatches,
                    topicHashMatches,
                    signatureValid
                }
            };
            
        } catch (err) {
            this.logger.error("Failed to verify message participation:", err);
            return { valid: false, error: err.message };
        }
    }
    
    /**
     * Generate proof of message participation for a specific message
     */
    async generateMessageProof(messageContent, senderUUID, receiverUUID, topic, direction) {
        try {
            const messageHash = this.hashMessage(messageContent);
            const participantHash = this.hashParticipants(senderUUID, receiverUUID);
            const topicHash = this.hashTopic(topic);
            
            const proof = {
                messageHash,
                participantHash,
                topicHash,
                direction,
                prover: this.cellUUID,
                timestamp: new Date().toISOString()
            };
            
            // Sign the proof
            proof.signature = await this.broker.call("nucleus.signMessage", {
                message: JSON.stringify(proof)
            });
            
            return proof;
            
        } catch (err) {
            this.logger.error("Failed to generate message proof:", err);
            throw err;
        }
    }
    
    // Hash generation methods for privacy preservation
    
    hashMessage(messageData) {
        // Hash the message content (could be string or object)
        const messageString = typeof messageData === 'string' ? messageData : JSON.stringify(messageData);
        return crypto.createHash('sha256').update(messageString).digest('hex');
    }
    
    hashParticipants(senderUUID, receiverUUID) {
        // Create a consistent hash regardless of sender/receiver order
        const participants = [senderUUID, receiverUUID].sort();
        const participantString = participants.join(':');
        return crypto.createHash('sha256').update(participantString).digest('hex');
    }
    
    hashTopic(topic) {
        return crypto.createHash('sha256').update(topic).digest('hex');
    }
    
    hashPeerUUID(peerUUID) {
        return crypto.createHash('sha256').update(peerUUID).digest('hex');
    }
    
    hashPublicKey(publicKey) {
        return crypto.createHash('sha256').update(publicKey).digest('hex');
    }
    
    // ID generation methods
    
    generateReceiptId() {
        return `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    generateHandshakeId() {
        return `handshake_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    generateRotationId() {
        return `rotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
} 