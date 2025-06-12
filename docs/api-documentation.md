# Celluler API Gateway Documentation

## Overview

The Celluler API Gateway provides REST endpoints for interacting with the distributed cell-based microservices architecture. The API supports health monitoring, service status checking, authentication, and rate limiting.

## Base URL

```
http://localhost:3000/api
```

## Authentication

The API supports basic HTTP authentication for protected endpoints. 

### Protected Routes
- All endpoints under `/api/v1/*` require authentication
- Default credentials: `admin:admin` (configurable)

### Public Routes
- All endpoints under `/api/public/*` are publicly accessible

### Authentication Header
```
Authorization: Basic <base64-encoded-credentials>
```

Example:
```bash
curl -H "Authorization: Basic YWRtaW46YWRtaW4=" http://localhost:3000/api/v1/nucleus/health
```

## Rate Limiting

- Default limit: 100 requests per minute per IP
- Rate limit headers are included in responses
- Configurable via service settings

## Endpoints

### Public Endpoints

#### GET /api/public/health
Returns the overall health status of the API gateway and its dependencies.

**Response:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "responseTime": 50,
  "version": "0.1.0",
  "services": {
    "nucleus": "healthy|unavailable",
    "message": "healthy|unavailable"
  }
}
```

#### GET /api/public/status
Returns detailed status information about all services and nodes.

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "node": {
    "id": "node-id",
    "health": { ... },
    "uptime": 3600,
    "memory": { ... },
    "version": "v18.0.0"
  },
  "services": [
    {
      "nodeID": "node-id",
      "available": true,
      "lastHeartbeatTime": 1704067200000,
      "services": [...]
    }
  ]
}
```

#### GET /api/public/info
Returns information about the API gateway.

**Response:**
```json
{
  "name": "Celluler API Gateway",
  "version": "0.1.0",
  "description": "REST API gateway for Celluler distributed services",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "documentation": "/api/endpoints",
  "features": [
    "Health monitoring",
    "Service status",
    "Rate limiting",
    "Basic authentication",
    "Request/response logging"
  ]
}
```

#### GET /api/public/endpoints
Returns documentation of available API endpoints.

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "routes": [...],
  "publicEndpoints": [
    "GET /api/public/health - Health check",
    "GET /api/public/status - Service status",
    "GET /api/public/info - API information",
    "GET /api/public/endpoints - This documentation"
  ],
  "authenticatedEndpoints": [
    "All /api/v1/* endpoints require authentication"
  ]
}
```

### Protected Endpoints (Require Authentication)

#### Nucleus Service Endpoints

##### GET /api/v1/nucleus/health
Returns health status of the nucleus service.

**Response:**
```json
{
  "status": "healthy|degraded",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "cellUUID": "cell-uuid",
  "services": {
    "store": "healthy|unavailable",
    "swarm": "healthy|unavailable", 
    "journal": "healthy|unavailable"
  },
  "metrics": {
    "coresCount": 2,
    "journalLength": 100
  }
}
```

##### POST /api/v1/nucleus/bind
Bind to a swarm topic.

**Request Body:**
```json
{
  "topic": "topic-name",
  "key": "optional-discovery-key"
}
```

**Response:**
```json
{
  "success": true,
  "topic": "topic-name",
  "core": {
    "discoveryKey": "...",
    "length": 0,
    "byteLength": 0
  }
}
```

##### GET /api/v1/nucleus/get
Get information about a core.

**Query Parameters:**
- `name` (optional): Core name
- `key` (optional): Core key

**Response:**
```json
{
  "name": "core-name",
  "core": {
    "discoveryKey": "...",
    "length": 100,
    "byteLength": 1024
  }
}
```

##### POST /api/v1/nucleus/write
Write data to a core.

**Request Body:**
```json
{
  "data": { "any": "data" },
  "name": "optional-core-name"
}
```

**Response:**
```json
{
  "success": true,
  "name": "core-name",
  "core": {
    "discoveryKey": "...",
    "length": 101,
    "byteLength": 2048
  }
}
```

##### GET /api/v1/nucleus/uuid
Get the cell UUID.

**Response:**
```json
"cell-uuid-string"
```

##### GET /api/v1/nucleus/public-key
Get the cell's public key.

**Response:**
```json
"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

#### Message Service Endpoints

##### GET /api/v1/message/health
Returns health status of the message service.

**Response:**
```json
{
  "status": "healthy|degraded",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "journal": "healthy|unavailable"
  },
  "metrics": {
    "journalLength": 50,
    "settings": {
      "requireSignature": true,
      "requireProof": true,
      "timeout": 10000,
      "retryCount": 5
    }
  }
}
```

##### POST /api/v1/message/send
Send a message.

**Request Body:**
```json
{
  "message": {
    "timestamp": 1704067200000,
    "sender": "sender-cell-id",
    "receiver": "receiver-cell-id",
    "type": "CHAT|AUTH|TX|POST|QUERY|EXEC",
    "body": { "any": "data" },
    "signature": "message-signature",
    "proof": "identity-proof"
  }
}
```

**Response:**
```json
{
  "success": true,
  "messageId": 123
}
```

##### POST /api/v1/message/receive
Receive a message.

**Request Body:**
```json
{
  "message": {
    "timestamp": 1704067200000,
    "sender": "sender-cell-id",
    "receiver": "receiver-cell-id",
    "type": "CHAT|AUTH|TX|POST|QUERY|EXEC",
    "body": { "any": "data" },
    "signature": "message-signature",
    "proof": "identity-proof"
  }
}
```

**Response:**
```json
{
  "success": true,
  "messageId": 124
}
```

##### GET /api/v1/message/getMessages
Get messages from the journal.

**Query Parameters:**
- `limit` (optional): Maximum number of messages (1-1000, default: 100)
- `offset` (optional): Starting offset (default: 0)

**Response:**
```json
{
  "messages": [
    {
      "timestamp": 1704067200000,
      "sender": "sender-cell-id",
      "receiver": "receiver-cell-id",
      "type": "CHAT",
      "body": { "text": "Hello" },
      "signature": "...",
      "proof": "..."
    }
  ],
  "total": 150,
  "offset": 0,
  "limit": 100
}
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": {
    "message": "Error description",
    "code": 400,
    "type": "BAD_REQUEST"
  }
}
```

Common HTTP status codes:
- `200`: Success
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `429`: Too Many Requests
- `500`: Internal Server Error

## Configuration

The API Gateway can be configured through the service settings:

```yaml
api:
  port: 3000
  authentication:
    enabled: true
    type: "basic"
    credentials:
      username: "admin"
      password: "secure-password"
  rateLimit:
    window: 60000  # 1 minute
    limit: 100     # requests per window
    headers: true
```

## Examples

### Get API Information
```bash
curl http://localhost:3000/api/public/info
```

### Check Health Status
```bash
curl http://localhost:3000/api/public/health
```

### Get Nucleus Service Health (Authenticated)
```bash
curl -u admin:admin http://localhost:3000/api/v1/nucleus/health
```

### Send a Message (Authenticated)
```bash
curl -X POST \
  -u admin:admin \
  -H "Content-Type: application/json" \
  -d '{"message": {"timestamp": 1704067200000, "sender": "cell1", "receiver": "cell2", "type": "CHAT", "body": {"text": "Hello"}, "signature": "sig", "proof": "proof"}}' \
  http://localhost:3000/api/v1/message/send
``` 