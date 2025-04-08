# API Reference

## Overview

This document provides a comprehensive reference for Celluler's API, including service actions, events, and types.

## Core Services

### DataService

#### Actions

##### `data.store`
Store data in the distributed network.

```typescript
interface StoreParams {
    key: string;
    data: any;
    options?: {
        version?: string;
        metadata?: any;
    };
}

interface StoreResponse {
    success: boolean;
    version: string;
    timestamp: number;
}
```

##### `data.retrieve`
Retrieve data from the distributed network.

```typescript
interface RetrieveParams {
    key: string;
    version?: string;
}

interface RetrieveResponse {
    data: any;
    version: string;
    metadata?: any;
}
```

##### `data.list`
List available data keys.

```typescript
interface ListParams {
    prefix?: string;
    limit?: number;
    offset?: number;
}

interface ListResponse {
    keys: string[];
    total: number;
}
```

#### Events

##### `data.updated`
Emitted when data is updated.

```typescript
interface DataUpdatedEvent {
    key: string;
    version: string;
    timestamp: number;
}
```

### ConsensusService

#### Actions

##### `consensus.submitEvent`
Submit an event for consensus.

```typescript
interface SubmitEventParams {
    event: {
        type: string;
        payload: any;
    };
}

interface SubmitEventResponse {
    eventId: string;
    timestamp: number;
}
```

##### `consensus.getState`
Get current consensus state.

```typescript
interface GetStateParams {
    key?: string;
}

interface GetStateResponse {
    state: any;
    timestamp: number;
}
```

#### Events

##### `consensus.stateUpdated`
Emitted when consensus state is updated.

```typescript
interface StateUpdatedEvent {
    key: string;
    state: any;
    timestamp: number;
}
```

### NetworkService

#### Actions

##### `network.connect`
Connect to a peer.

```typescript
interface ConnectParams {
    peerId: string;
    options?: {
        timeout?: number;
        retry?: number;
    };
}

interface ConnectResponse {
    success: boolean;
    peerInfo: PeerInfo;
}
```

##### `network.send`
Send a message to a peer.

```typescript
interface SendParams {
    peerId: string;
    message: {
        type: string;
        payload: any;
    };
}

interface SendResponse {
    success: boolean;
    messageId: string;
}
```

#### Events

##### `network.message`
Emitted when a message is received.

```typescript
interface NetworkMessageEvent {
    peerId: string;
    message: {
        type: string;
        payload: any;
    };
    timestamp: number;
}
```

### ModelService

#### Actions

##### `model.predict`
Execute model inference.

```typescript
interface PredictParams {
    modelId: string;
    input: any;
    options?: {
        batchSize?: number;
        timeout?: number;
    };
}

interface PredictResponse {
    output: any;
    metadata?: any;
}
```

##### `model.train`
Start model training.

```typescript
interface TrainParams {
    modelId: string;
    config: {
        epochs: number;
        batchSize: number;
        learningRate: number;
    };
}

interface TrainResponse {
    trainingId: string;
    status: string;
}
```

#### Events

##### `model.trainingUpdate`
Emitted during model training.

```typescript
interface TrainingUpdateEvent {
    trainingId: string;
    epoch: number;
    metrics: {
        loss: number;
        accuracy?: number;
    };
}
```

## Common Types

### PeerInfo

```typescript
interface PeerInfo {
    id: string;
    address: string;
    capabilities: string[];
    version: string;
    status: string;
}
```

### ModelInfo

```typescript
interface ModelInfo {
    id: string;
    name: string;
    version: string;
    framework: string;
    status: string;
    metadata?: any;
}
```

### TrainingConfig

```typescript
interface TrainingConfig {
    epochs: number;
    batchSize: number;
    learningRate: number;
    optimizer: string;
    lossFunction: string;
    metrics: string[];
}
```

## Error Handling

All services use a consistent error format:

```typescript
interface ServiceError {
    code: string;
    message: string;
    details?: any;
}
```

Common error codes:
- `INVALID_PARAMS` - Invalid parameters provided
- `NOT_FOUND` - Resource not found
- `UNAUTHORIZED` - Authentication required
- `FORBIDDEN` - Insufficient permissions
- `TIMEOUT` - Operation timed out
- `INTERNAL_ERROR` - Internal server error

## Rate Limiting

API calls are subject to rate limiting. The current limits are:
- 100 requests per minute per service
- 1000 requests per hour per cell

Rate limit headers are included in responses:
```typescript
interface RateLimitHeaders {
    'X-RateLimit-Limit': number;
    'X-RateLimit-Remaining': number;
    'X-RateLimit-Reset': number;
}
```

## Authentication

API calls require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <token>
```

## Versioning

API versioning is handled through the service version in the Moleculer configuration. The current API version is v1.

## Pagination

List operations support pagination:

```typescript
interface PaginationParams {
    limit?: number;
    offset?: number;
}

interface PaginatedResponse<T> {
    items: T[];
    total: number;
    limit: number;
    offset: number;
}
``` 