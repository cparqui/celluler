# Celluler MVP Roadmap

Phases 1–4 build **NADI** (L1: network, identity, messaging, commons engine), Phase 5 starts **PRANA** (L2: economy and governance), and **BUDDHI** (L3: AI commons) follows. See the [NADI Journal, Identity & Messaging spec](nadi-journal-identity.md) for the design behind Phase 1.5.

## Phase 1: Core Infrastructure (Done, Jun 2025)

### 1. Core Services
- [x] NucleusService
  - [x] Basic service structure
  - [x] Hypercore journal management
  - [x] Core binding and discovery
  - [x] Service lifecycle management
  - [x] Unit tests
  - [x] Logging and error handling

### 2. Basic CLI Tool
- [x] Create basic CLI tool structure
- [x] Create basic cell startup script
- [x] Configuration System
  - [x] Define YAML configuration schema
  - [x] Implement YAML parser and validator
  - [x] Create configuration templates
  - [x] Add environment variable support
  - [x] Add configuration inheritance
  - [x] Add configuration validation
- [x] Deployment Configuration
  - [x] Local service deployment
  - [x] Docker Compose deployment
- [x] Logging Configuration
  - [x] Structured logging setup
  - [x] Log level configuration
  - [x] Log output configuration

### 3. Testing Framework
- [x] Set up Jest testing framework
- [x] Add unit tests for NucleusService
- [x] Add test coverage reporting

### 4. Basic API Gateway
- [x] Set up basic API server
- [x] Add health check endpoints
- [x] Add service status endpoints
- [x] Add basic authentication
- [x] Add API documentation
- [x] Add rate limiting
- [ ] Register ApiService in the cell's service map (currently not started by the CLI)

### 5. Documentation
- [x] Add service development guidelines
- [x] Document NucleusService architecture
- [ ] Add getting started guide
- [ ] Add configuration guide
- [ ] Add deployment guides for different environments

## Phase 1.5: NADI Foundation — Journal, Identity & Messaging (Next)

Prerequisite for any other service registering journal records or message protocols.

### 1. Keys and identity root
- [ ] Persist the root seed (file storage); derive signing, encryption, swarm, storage and salt keys
- [ ] Cell ID = public journal key; replace generated UUID with `nucleus/genesis`
- [ ] Remove the per-start RSA keypair; use Ed25519 signatures and X25519 sealed boxes
- [ ] `nucleus/key.add` / `nucleus/key.revoke` attestations

### 2. Nucleus as memory manager
- [ ] Deterministic record envelope (decide compact-encoding vs canonical JSON)
- [ ] Record-type registration with retention classes (`permanent`, `window`, `ephemeral`)
- [ ] Encrypted private store (Hyperbee) and type index
- [ ] Salted leaf commitments and Merkle epochs (`nucleus/epoch`, `nucleus/commit`)
- [ ] `record`, `query` and `prove` actions; proof verification
- [ ] Replace raw `write` with `record`; fix double-encoded JSON

### 3. Base MessageService
- [ ] Depend only on the Nucleus (drop identity/consensus dependencies and the fixed message-type enum)
- [ ] Generic signed envelope; protocol handler registration
- [ ] Unicast over Hyperswarm with swarm-key attestation check
- [ ] Topic multicast/broadcast with dedupe and TTL
- [ ] Optional sealed bodies for relayed messages
- [ ] Receipts recorded through the Nucleus (`none` / `hash` / `full` per protocol)

### 4. Edges and proofs
- [ ] Private per-epoch edge attestations (`identity/edge`)
- [ ] Co-signed public edge reveals (`nucleus/edge.reveal`)
- [ ] T1 possession and T4 selective-claim proofs

### 5. Multi-cell testing
- [ ] In-process DHT (`hyperdht/testnet`) for all tests
- [ ] Two-cell and N-cell (3, 10, 50) scenarios
- [ ] Fault cases: revoked key, tampered record, unattested swarm key
- [ ] Benchmark private-store layouts (single, per-service, per-day)

## Phase 2: Network Foundation (NADI)

### 1. Core Services (Continued)
- [ ] AuthService
  - [ ] Registers the `auth/1` message protocol with the MessageService
  - [ ] Challenge–response (T1) and proof exchange (T4)
  - [ ] Unit and multi-cell tests

- [ ] IdentityService
  - [ ] Cell identity verification
  - [ ] Trust network management
  - [ ] Social interaction proofs
  - [ ] Unit tests

### 2. Cell-to-Cell Communication
- [x] Choose transport: Hyperswarm (Noise-encrypted) with Protomux framing (decided in the NADI spec)
- [ ] Relay / store-and-forward for offline cells
- [ ] Connection management and peer health

### 3. Basic Security
- [x] Basic Hypercore encryption
- [ ] Implement cell authentication
- [ ] Add key management
- [ ] Implement access control
- [ ] Add audit logging

### 4. API Gateway (Continued)
- [ ] Add message endpoints
  - [ ] Send messages
  - [ ] Receive messages
  - [ ] Message status
- [ ] Add identity endpoints
  - [ ] Identity verification
  - [ ] Trust management
- [ ] Enhance authentication
- [ ] Add API versioning

### 5. Monitoring
- [x] Basic service logging
- [x] Structured logging
- [ ] Log rotation and retention
- [ ] Add service metrics
- [ ] Add network metrics
- [ ] Add log aggregation

## Phase 3: State and Consensus (NADI commons engine)

### 1. Core Services (Continued)
- [ ] StateService
  - [ ] Local state management
  - [ ] Hashgraph consensus integration
  - [ ] State verification
  - [ ] Hypercore journal
  - [ ] Unit tests

- [ ] ConsensusService
  - [ ] Hashgraph consensus algorithm
  - [ ] Event propagation
  - [ ] Event validation
  - [ ] Consensus state management
  - [ ] Unit tests

### 2. Integration Testing
- [ ] Add multi-cell test scenarios
- [ ] Add network simulation
- [ ] Add load testing
- [ ] Add stress testing
- [ ] Add service interaction tests
- [ ] Add deployment environment tests
- [ ] Add continuous integration

### 3. Advanced Security
- [ ] Implement end-to-end encryption
- [ ] Add data integrity verification
- [ ] Add secure key storage
- [ ] Add secure communication channels

### 4. API Gateway (Continued)
- [ ] Add state endpoints
  - [ ] State queries
  - [ ] State updates
  - [ ] State history
- [ ] Add consensus endpoints
  - [ ] Event submission
  - [ ] Consensus status
  - [ ] Event history
- [ ] Add advanced monitoring endpoints
- [ ] Add performance metrics endpoints

## Phase 4: Deployment and Scaling

### 1. Deployment Infrastructure
- [ ] Add Docker support
- [ ] Add Kubernetes support
- [ ] Add configuration management
- [ ] Add deployment automation
- [ ] Add cluster management
- [ ] Add load balancing
- [ ] Add service discovery
- [ ] Add health checks
- [ ] Add environment-specific configurations

### 2. Advanced Monitoring
- [ ] Add security metrics
- [ ] Add performance metrics
- [ ] Add log analysis
- [ ] Add alerting
- [ ] Add request tracing
- [ ] Add performance tracing
- [ ] Add error tracing

### 3. Scaling Features
- [ ] Add horizontal scaling support
- [ ] Add vertical scaling support
- [ ] Add resource optimization
- [ ] Add performance tuning

## Phase 5: Market Features (PRANA)

### 1. Basic Market
- [ ] Implement PRANA token
- [ ] Add basic trading
- [ ] Add resource allocation
- [ ] Add price discovery

### 2. Resource Markets
- [ ] Add compute resource trading
- [ ] Add storage trading
- [ ] Add network trading
- [ ] Add service trading

### 3. API Gateway (Final)
- [ ] Add market endpoints
  - [ ] Token management
  - [ ] Trading operations
  - [ ] Resource allocation
  - [ ] Market status
- [ ] Add advanced market features
- [ ] Add market monitoring

## Phase 6: AI Commons (BUDDHI)

- [ ] Compute commons: resource offers and scheduling as registered protocols
- [ ] Data commons: dataset hosting and access
- [ ] Model and agent commons: shared model hosting, training feedback

## Future Considerations

### 1. Scalability
- [ ] Research sharding
- [ ] Research cross-chain compatibility
- [ ] Research advanced AI model distribution
- [ ] Research enhanced security features

### 2. Performance
- [ ] Optimize consensus algorithm
- [ ] Optimize data distribution
- [ ] Optimize network communication
- [ ] Optimize resource utilization 