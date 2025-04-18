# Service Development Guide

## Overview

Services in Celluler are built using the Moleculer framework and follow a specific architecture pattern to ensure consistency and interoperability. This guide covers how to develop, test, and deploy services within the Celluler ecosystem.

## Service Structure

Each service follows these style guidelines:

1. **File Organization**
   - One service per file
   - File name uses dot notation with .service.js suffix
   - Located in `src/services` directory
   - Test files use .service.test.js suffix
   - Example: `nucleus.service.js` for `NucleusService` and `nucleus.service.test.js` for its tests

2. **Service Definition**
   - Extends BaseService class
   - Service constructor accepts broker and cellConfig
   - Service name is camelCase without "Service" suffix
   - Service schema is parsed separately from super() call

3. **Parameter Validation**
   - Validation objects defined as global constants
   - Named with PascalCase and "Params" suffix
   - Located at top of file

4. **Action Handlers**
   - Defined as class methods
   - Named with camelCase
   - Referenced in action definitions
   - Use try-catch blocks for error handling

5. **Event Handlers**
   - Defined as class methods
   - Named with "on" prefix and PascalCase
   - Referenced in event definitions

6. **Settings**
   - Settings are read from cellConfig.config
   - Document all available settings in service schema

Example service structure:

```javascript
// src/services/example.service.js

import BaseService from './base.service.js';
import _ from "lodash";

// Parameter validation objects
const ExampleActionParams = {
    input: {
        type: "string",
        min: 1,
        max: 100
    },
    options: {
        type: "object",
        optional: true,
        props: {
            flag: { type: "boolean", optional: true },
            count: { type: "number", optional: true }
        }
    }
};

export default class ExampleService extends BaseService {
    constructor(broker, cellConfig) {
        super(broker, cellConfig);
        
        this.parseServiceSchema({
            name: "example",
            settings: cellConfig.config,
            dependencies: [
                "other"
            ],
            actions: {
                exampleAction: {
                    params: ExampleActionParams,
                    handler: this.exampleAction
                }
            },
            events: {
                "example.event": this.onExampleEvent
            },
            created: this.onCreated,
            started: this.onStarted,
            stopped: this.onStopped
        });
    }

    // Lifecycle events
    onCreated() {
        this.logger.info("Example service created");
    }

    async onStarted() {
        this.logger.info("Example service started");
    }

    async onStopped() {
        this.logger.info("Example service stopped");
    }

    // Action handlers
    async exampleAction(ctx) {
        try {
            const { input, options } = ctx.params;
            // Process input with options
            return { result: "success" };
        } catch (err) {
            this.logger.error("Action failed:", err);
            throw err;
        }
    }

    // Event handlers
    async onExampleEvent(ctx) {
        // Handle example event
    }
}
```

## Core Service Types

### 1. NucleusService

Manages cell configuration and coordinates service interactions:

```javascript
// src/services/nucleus.service.js

import { Service } from "moleculer";
import _ from "lodash";

const JournalUpdateParams = {
    service: "string",
    operation: {
        type: "enum",
        values: ["append", "truncate", "sync"]
    },
    data: "any",
    proof: "string"
};

const ServiceRegisterParams = {
    service: {
        type: "object",
        props: {
            name: "string",
            version: "string",
            dependencies: "array"
        }
    }
};

const DEFAULT_SETTINGS = {
    // Storage settings
    journalPath: "./data/nucleus",  // Path for nucleus journal
    maxJournalSize: 1024 * 1024 * 1000,  // Maximum journal size in bytes
    
    // Network settings
    timeout: 5000,  // Default timeout in milliseconds
    retryCount: 3,  // Number of retry attempts
    
    // Security settings
    requireAuth: true,  // Require authentication
    requireProof: true,  // Require operation proofs
    
    // Performance settings
    batchSize: 100,  // Size of processing batches
    cacheSize: 1000, // Size of in-memory cache
    
    // Cell configuration
    cellId: null,    // Unique identifier for the cell
    cellName: null,  // Human-readable cell name
    cellVersion: "1.0.0",  // Cell version
    cellConfig: {    // Cell-specific configuration
        features: [],
        capabilities: [],
        limits: {}
    }
};

export default class NucleusService extends Service {
    constructor(broker, settings = {}) {
        super(broker, {
            name: "nucleus",
            version: 1,
            settings: {
                ...DEFAULT_SETTINGS,
                ...settings
            },
            dependencies: [],
            actions: {
                updateJournal: {
                    params: JournalUpdateParams,
                    handler: this.updateJournal
                },
                registerService: {
                    params: ServiceRegisterParams,
                    handler: this.registerService
                },
                getCellConfig: {
                    handler: this.getCellConfig
                }
            },
            events: {
                "service.registered": this.onServiceRegistered,
                "journal.updated": this.onJournalUpdated
            }
        });
    }

    async updateJournal(ctx) {
        const { service, operation, data, proof } = ctx.params;
        // Validate operation proof
        // Update Hypercore journal
        // Notify affected services
        return { success: true };
    }

    async registerService(ctx) {
        const { service } = ctx.params;
        // Register new service
        // Update service registry
        // Initialize service dependencies
        return { success: true };
    }

    async getCellConfig(ctx) {
        // Return cell configuration
        return {
            cellId: this.settings.cellId,
            cellName: this.settings.cellName,
            cellVersion: this.settings.cellVersion,
            cellConfig: this.settings.cellConfig
        };
    }

    async onServiceRegistered(ctx) {
        // Handle service registration events
    }

    async onJournalUpdated(ctx) {
        // Handle journal update events
    }
}

### 2. MessageService

Handles message routing, delivery, and verification:

```javascript
// src/services/message.service.js

import { Service } from "moleculer";
import _ from "lodash";

const MessageSendParams = {
    message: {
        type: "object",
        props: {
            timestamp: "number",
            sender: "string",
            receiver: "string",
            type: "string",
            body: "any",
            signature: "string",
            proof: "string"
        }
    }
};

const MessageReceiveParams = {
    message: "object"
};

const DEFAULT_SETTINGS = {
    // Storage settings
    journalPath: "./data/message",  // Path for message journal
    maxJournalSize: 1024 * 1024 * 1000,  // Maximum journal size in bytes
    
    // Network settings
    timeout: 10000,  // Message timeout in milliseconds
    retryCount: 5,   // Number of delivery retries
    
    // Security settings
    requireSignature: true,  // Require message signatures
    requireProof: true,      // Require identity proofs
    
    // Performance settings
    batchSize: 50,   // Message batch size
    cacheSize: 1000, // Message cache size
    
    // Nested settings
    storage: {
        type: "hypercore",
        options: {
            maxSize: 1024 * 1024 * 1000,
            compression: true
        }
    },
    network: {
        protocol: "tcp",
        options: {
            keepAlive: true,
            timeout: 10000
        }
    }
};

export default class MessageService extends Service {
    constructor(broker, settings = {}) {
        super(broker, {
            name: "message",
            version: 1,
            settings: _.defaultsDeep(settings, DEFAULT_SETTINGS),
            dependencies: [
                "identity",
                "consensus"
            ],
            actions: {
                send: {
                    params: MessageSendParams,
                    handler: this.sendMessage
                },
                receive: {
                    params: MessageReceiveParams,
                    handler: this.receiveMessage
                }
            },
            events: {
                "message.received": this.onMessageReceived
            }
        });
    }

    async sendMessage(ctx) {
        const { message } = ctx.params;
        // Validate message signature and proof
        // Route message to target cell
        // Store in Hypercore journal
        return { success: true };
    }

    async receiveMessage(ctx) {
        const { message } = ctx.params;
        // Process incoming message
        // Update message journal
        // Trigger appropriate events
        return { success: true };
    }

    async onMessageReceived(ctx) {
        // Handle message reception events
    }
}
```

### 3. StateService

Manages local and global state synchronization:

```javascript
// src/services/state.service.js

import { Service } from "moleculer";
import _ from "lodash";

const StateUpdateParams = {
    key: "string",
    value: "any",
    proof: "string"
};

const StateQueryParams = {
    key: "string"
};

const DEFAULT_SETTINGS = {
    // Storage settings
    journalPath: "./data/state",  // Path for state journal
    maxJournalSize: 1024 * 1024 * 1000,  // Maximum journal size in bytes
    
    // Network settings
    timeout: 5000,  // Default timeout in milliseconds
    retryCount: 3,  // Number of retry attempts
    
    // Security settings
    requireAuth: true,  // Require authentication
    requireProof: true,  // Require state proofs
    
    // Performance settings
    batchSize: 100,  // Size of processing batches
    cacheSize: 1000  // Size of in-memory cache
};

export default class StateService extends Service {
    constructor(broker, settings = {}) {
        super(broker, {
            name: "state",
            version: 1,
            settings: {
                ...DEFAULT_SETTINGS,
                ...settings
            },
            dependencies: [
                "consensus"
            ],
            actions: {
                update: {
                    params: StateUpdateParams,
                    handler: this.updateState
                },
                query: {
                    params: StateQueryParams,
                    handler: this.queryState
                }
            },
            events: {
                "state.updated": this.onStateUpdated
            }
        });
    }

    async updateState(ctx) {
        const { key, value, proof } = ctx.params;
        // Validate state update proof
        // Apply state change
        // Store in Hypercore journal
        // Propagate through consensus
        return { success: true };
    }

    async queryState(ctx) {
        const { key } = ctx.params;
        // Retrieve state from Hypercore journal
        // Verify state integrity
        return { value: null };
    }

    async onStateUpdated(ctx) {
        // Handle state update events
    }
}
```

### 4. IdentityService

Manages cell identity and trust networks:

```javascript
// src/services/identity.service.js

import { Service } from "moleculer";
import _ from "lodash";

const IdentityVerifyParams = {
    identity: {
        type: "object",
        props: {
            cellId: "string",
            proof: "string",
            trustNetwork: "array"
        }
    }
};

const IdentityProofParams = {
    data: "any"
};

const DEFAULT_SETTINGS = {
    // Storage settings
    journalPath: "./data/identity",  // Path for identity journal
    maxJournalSize: 1024 * 1024 * 1000,  // Maximum journal size in bytes
    
    // Network settings
    timeout: 5000,  // Default timeout in milliseconds
    retryCount: 3,  // Number of retry attempts
    
    // Security settings
    requireAuth: true,  // Require authentication
    requireProof: true,  // Require identity proofs
    
    // Performance settings
    batchSize: 100,  // Size of processing batches
    cacheSize: 1000  // Size of in-memory cache
};

export default class IdentityService extends Service {
    constructor(broker, settings = {}) {
        super(broker, {
            name: "identity",
            version: 1,
            settings: {
                ...DEFAULT_SETTINGS,
                ...settings
            },
            dependencies: [],
            actions: {
                verify: {
                    params: IdentityVerifyParams,
                    handler: this.verifyIdentity
                },
                generateProof: {
                    params: IdentityProofParams,
                    handler: this.generateIdentityProof
                }
            },
            events: {
                "identity.verified": this.onIdentityVerified
            }
        });
    }

    async verifyIdentity(ctx) {
        const { identity } = ctx.params;
        // Verify identity proof
        // Update trust network
        // Store in Hypercore journal
        return { verified: true };
    }

    async generateIdentityProof(ctx) {
        const { data } = ctx.params;
        // Generate identity proof
        // Store in Hypercore journal
        return { proof: "" };
    }

    async onIdentityVerified(ctx) {
        // Handle identity verification events
    }
}
```

### 5. ConsensusService

Manages Hashgraph consensus and event propagation:

```javascript
// src/services/consensus.service.js

import { Service } from "moleculer";
import _ from "lodash";

const EventSubmitParams = {
    event: {
        type: "object",
        props: {
            type: "string",
            data: "any",
            timestamp: "number",
            signature: "string"
        }
    }
};

const ConsensusQueryParams = {
    eventId: "string"
};

const DEFAULT_SETTINGS = {
    // Storage settings
    journalPath: "./data/consensus",  // Path for consensus journal
    maxJournalSize: 1024 * 1024 * 1000,  // Maximum journal size in bytes
    
    // Network settings
    timeout: 5000,  // Default timeout in milliseconds
    retryCount: 3,  // Number of retry attempts
    
    // Security settings
    requireAuth: true,  // Require authentication
    requireProof: true,  // Require consensus proofs
    
    // Performance settings
    batchSize: 100,  // Size of processing batches
    cacheSize: 1000  // Size of in-memory cache
};

export default class ConsensusService extends Service {
    constructor(broker, settings = {}) {
        super(broker, {
            name: "consensus",
            version: 1,
            settings: {
                ...DEFAULT_SETTINGS,
                ...settings
            },
            dependencies: [],
            actions: {
                submitEvent: {
                    params: EventSubmitParams,
                    handler: this.submitEvent
                },
                getConsensus: {
                    params: ConsensusQueryParams,
                    handler: this.getConsensus
                }
            },
            events: {
                "consensus.reached": this.onConsensusReached
            }
        });
    }

    async submitEvent(ctx) {
        const { event } = ctx.params;
        // Validate event
        // Add to Hashgraph
        // Propagate to network
        // Store in Hypercore journal
        return { success: true };
    }

    async getConsensus(ctx) {
        const { eventId } = ctx.params;
        // Retrieve consensus state
        // Verify consensus proof
        return { consensus: null };
    }

    async onConsensusReached(ctx) {
        // Handle consensus events
    }
}
```

## Service Development Best Practices

### 1. Action Design

- Keep actions focused and single-purpose
- Use proper parameter validation
- Handle errors gracefully with try-catch blocks
- Document action parameters and return values

### 2. Event Handling

- Use events for async operations
- Keep event handlers idempotent
- Document event payload structure

### 3. Error Handling

- Use try-catch blocks in all action handlers
- Log errors appropriately
- Throw errors to propagate them up the chain

### 4. Logging

- Use this.logger for all logging
- Include appropriate log levels (info, debug, error)
- Provide context in log messages

### 5. Configuration

- Read settings from cellConfig.config
- Document all settings in service schema
- Validate required settings in onCreated

## Service Testing

### 1. Unit Testing

```javascript
import { ServiceBroker } from "moleculer";
import ExampleService from "./example.service.js";

describe("Example Service", () => {
    let broker = new ServiceBroker();
    let service = new ExampleService(broker);

    beforeAll(() => broker.start());
    afterAll(() => broker.stop());

    it("should handle action correctly", async () => {
        const result = await broker.call("example.action", { param: "value" });
        expect(result).toBeDefined();
    });
});
```

### 2. Integration Testing

```javascript
describe("Service Integration", () => {
    let broker = new ServiceBroker();
    let service = new ExampleService(broker);

    beforeAll(() => broker.start());
    afterAll(() => broker.stop());

    it("should work with other services", async () => {
        const result = await broker.call("example.action", {
            dependency: "other-service"
        });
        expect(result).toBeDefined();
    });
});
```

## Service Deployment

### 1. Configuration

```json
{
    "services": [
        "services/*.service.js"
    ],
    "transporter": "TCP",
    "logLevel": "info"
}
```

### 2. Scaling

- Use Moleculer's built-in scaling features
- Configure appropriate load balancing
- Monitor service health

## Service Monitoring

### 1. Metrics

```javascript
this.broker.metrics.increment("action.called", { action: "example" });
```

### 2. Health Checks

```javascript
actions: {
    health: {
        async handler(ctx) {
            return {
                status: "healthy",
                timestamp: Date.now()
            };
        }
    }
}
```

## Service Security

### 1. Authentication

```javascript
actions: {
    secureAction: {
        auth: "required",
        async handler(ctx) {
            // Action logic
        }
    }
}
```

### 2. Authorization

```javascript
actions: {
    adminAction: {
        auth: {
            roles: ["admin"]
        },
        async handler(ctx) {
            // Action logic
        }
    }
}
```

## Service Documentation

### 1. Action Documentation

```javascript
actions: {
    exampleAction: {
        description: "Example action description",
        params: {
            field: "Field description"
        },
        returns: {
            type: "object",
            properties: {
                result: "Result description"
            }
        }
    }
}
```

### 2. Event Documentation

```javascript
events: {
    "example.event": {
        description: "Event description",
        params: {
            data: "Event data description"
        }
    }
}
``` 
``` 