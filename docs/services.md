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

The NADI base services define **syntax**; other services define **semantics** by registering with them. The NucleusService depends on nothing, the MessageService depends only on the Nucleus, and every other service registers record types with the Nucleus and message protocols with the MessageService. The authoritative design is the [NADI Journal, Identity & Messaging spec](nadi-journal-identity.md); the sketches below summarize its interfaces.

### 1. NucleusService

The cell's memory manager: owns the root seed and derived keys, the journal (the cell's event chain), the encrypted private store, backups and proofs.

```javascript
// Interface sketch (see spec §6.1)

// Called once by each service at startup; visibility is not part of the type
await ctx.call("nucleus.registerType", { type: "msg/received", owner: "message" });

// Private record: stored in the private store, salted hash committed in the next event
const { seq, leaf } = await ctx.call("nucleus.record", {
    type: "msg/received",
    body,                            // encoded by the owning service
    refs: [],                        // optional links to other cells' records
    visibility: "private"
});

// Public record: written inline into the next event (urgent = publish now, rate-limited)
await ctx.call("nucleus.record", { type: "nucleus/profile", body, visibility: "public" });

// Query the private store by type
await ctx.call("nucleus.query", { type: "msg/received", limit: 100 });

// Produce a proof about a retained record (leaf-only or full disclosure)
await ctx.call("nucleus.prove", { seq, disclose: "full" });

// Redaction is an explicit, recorded exception; owners never delete
await ctx.call("nucleus.redact", { seq, reason });

// Identity
await ctx.call("nucleus.getCellId");      // public journal key, hex
```

Services never write cores or create events directly: only the Nucleus appends events (on consensus syncs, revealed receipts and urgent public records). The journal is append-only, so there is no truncate operation.

### 2. MessageService

Moves messages reliably between cells over pairwise links and topics. It defines no message types and depends only on the Nucleus.

```javascript
// Interface sketch (see spec §9)

// A service registers the protocol it owns, e.g. in AuthService.started()
await ctx.call("message.register", { protocol: "auth/1", handler: "auth.onMessage" });

// Handshake: both cells agree to communicate and exchange link core keys
await ctx.call("message.link", { to: cellId });

// Send: appended to this cell's link core for the recipient
const { id, index } = await ctx.call("message.send", { to: cellId, protocol: "auth/1", body });

// Multicast: appended to this cell's topic core
await ctx.call("message.send", { to: { topic: "coop/la-paz" }, protocol: "coop-chat/1", body });

// Public message ("transaction"): inline in this cell's journal, ordered by consensus
await ctx.call("message.send", { to: "public", protocol: "prana-vote/1", body });

// Delivery state from the recipient's receipts
await ctx.call("message.status", { id });   // "sent" | "delivered" | "processed"
```

On receipt the MessageService verifies the sender's signature, copies the body into the private store, appends an inbox entry, acknowledges in its own link core, and dispatches inbox messages in arrival order to the registered handler. Unknown protocols are recorded but not dispatched. Inbox delivery is exactly-once; handlers must be idempotent by message `id`.

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

Manages cell identity and trust networks. Under the NADI spec it records private relationship edges from real traffic (`identity/edge`) through the Nucleus, handles co-signed public edge reveals, and verifies T2/T3 identity claims (spec §7–§8). The sketch below predates the spec and will be revised.


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