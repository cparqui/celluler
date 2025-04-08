# Service Development Guide

## Overview

Services in Celluler are built using the Moleculer framework and follow a specific architecture pattern to ensure consistency and interoperability. This guide covers how to develop, test, and deploy services within the Celluler ecosystem.

## Service Structure

Each service follows this basic structure:

```typescript
import { Service } from "moleculer";

export default class ExampleService extends Service {
    public constructor() {
        super({
            name: "example",
            version: 1,
            settings: {
                // Service-specific settings
            },
            dependencies: [
                // Other services this service depends on
            ],
            actions: {
                // Service actions
            },
            events: {
                // Service events
            },
            methods: {
                // Private methods
            }
        });
    }
}
```

## Core Service Types

### 1. DataService

Provides an abstraction layer for distributed data operations:

```typescript
export default class DataService extends Service {
    public constructor() {
        super({
            name: "data",
            actions: {
                store: {
                    params: {
                        key: "string",
                        data: "any"
                    },
                    async handler(ctx) {
                        // Store data in distributed storage
                        // Currently implemented using DAT protocol
                    }
                },
                retrieve: {
                    params: {
                        key: "string"
                    },
                    async handler(ctx) {
                        // Retrieve data from distributed storage
                        // Currently implemented using DAT protocol
                    }
                }
            }
        });
    }
}
```

### 2. ConsensusService

Manages distributed consensus and state agreement:

```typescript
export default class ConsensusService extends Service {
    public constructor() {
        super({
            name: "consensus",
            actions: {
                submitEvent: {
                    params: {
                        event: "object"
                    },
                    async handler(ctx) {
                        // Submit event for consensus
                        // Currently implemented using Hashgraph algorithm
                    }
                }
            }
        });
    }
}
```

## Service Development Best Practices

### 1. Action Design

- Keep actions focused and single-purpose
- Use proper parameter validation
- Handle errors gracefully
- Document action parameters and return values

```typescript
actions: {
    exampleAction: {
        params: {
            requiredField: { type: "string", min: 3 },
            optionalField: { type: "number", optional: true }
        },
        async handler(ctx) {
            try {
                // Action logic
                return result;
            } catch (err) {
                this.logger.error("Action failed:", err);
                throw err;
            }
        }
    }
}
```

### 2. Event Handling

- Use events for async operations
- Keep event handlers idempotent
- Document event payload structure

```typescript
events: {
    "example.event": {
        async handler(ctx) {
            // Event handling logic
        }
    }
}
```

### 3. Error Handling

- Use Moleculer's error types
- Provide meaningful error messages
- Log errors appropriately

```typescript
if (!data) {
    throw new MoleculerError("Data not found", 404, "DATA_NOT_FOUND");
}
```

## Service Testing

### 1. Unit Testing

```typescript
import { ServiceBroker } from "moleculer";
import ExampleService from "./example.service";

describe("Example Service", () => {
    let broker = new ServiceBroker();
    let service = broker.createService(ExampleService);

    beforeAll(() => broker.start());
    afterAll(() => broker.stop());

    it("should handle action correctly", async () => {
        const result = await broker.call("example.action", { param: "value" });
        expect(result).toBeDefined();
    });
});
```

### 2. Integration Testing

```typescript
describe("Service Integration", () => {
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

```typescript
this.broker.metrics.increment("action.called", { action: "example" });
```

### 2. Health Checks

```typescript
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

```typescript
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

```typescript
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

```typescript
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

```typescript
events: {
    "example.event": {
        description: "Event description",
        params: {
            data: "Event data description"
        }
    }
}
``` 