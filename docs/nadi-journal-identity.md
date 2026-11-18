# NADI Journal, Identity & Messaging — Design Spec

**Status:** Draft v0.1 (2026-11-17) · **Layer:** NADI (L1) · **Supersedes:** the Nucleus/Message sections of `architecture.md` and `services.md` where they conflict.

This spec defines the foundation every other Celluler service builds on: how a cell holds keys, what goes into its public journal, how private data is stored and proven, how identity is verified, and how generic messages move between cells. It deliberately defines **syntax, not semantics**: the Nucleus and Message services define envelopes and guarantees; higher services (Auth, Identity, Consensus, and later PRANA and BUDDHI services) define what their records and messages mean.

## 1. Layer context

| Layer | Name | Services that live here |
|---|---|---|
| L1 | **NADI** — Network of Agents with Decentralized Identity | Nucleus, Message, Auth, Identity, Consensus (commons engine) |
| L2 | **PRANA** — Public Resource Alliance Network Architecture | Token, quadratic funding/voting, co-op and private commons |
| L3 | **BUDDHI** — Builder-owned, Universally Distributed, Democratically Hosted Intelligence | Compute, data, model and agent commons |

Rule: a service may depend only on services in its own layer or below. The **Nucleus depends on nothing; the Message service depends only on the Nucleus.** Everything else plugs in by registering record types (with the Nucleus) and message protocols (with the Message service).

## 2. Design principles

1. **The public journal holds commitments, not data.** Anything appended to a Hypercore is permanent and readable by anyone who has its key. Private data never goes in it in plaintext.
2. **The Nucleus is the cell's memory manager.** It owns the private store, the public journal, keys, and retention. Services ask the Nucleus to record; they never write cores directly.
3. **A cell can prove any statement about any committed record it still retains.** Retention policy therefore equals "which claims remain provable."
4. **Identity cost scales with relationships, not traffic.** Batching commitments into epochs keeps the public journal tiny regardless of message volume.
5. **Base layers define syntax; upper layers define semantics.** No message types or record types beyond the minimum the base layer needs to function.

## 3. Keys

### 3.1 Root seed

Each cell has one 32-byte **root seed**. Corestore already generates and persists this as its primary key when using file storage. In `memory` storage it is lost on restart, so memory mode is for tests only; a cell with persistent identity must use file storage (or an injected seed).

### 3.2 Derived keys

All keys are derived deterministically from the root seed with distinct context labels (BLAKE2b keyed hash via sodium `crypto_generichash`), so the seed is the only secret that must be backed up.

| Key | Algorithm | Derivation | Purpose |
|---|---|---|---|
| **Root / journal key** | Ed25519 | Corestore `name: 'journal'` | Signs the public journal. **Its public key is the cell ID.** |
| Signing key | Ed25519 | `H(seed, "celluler/sign/v1")` | Signs messages and disclosures |
| Encryption key | X25519 | `H(seed, "celluler/box/v1")` | Sealed boxes for message bodies and private disclosures |
| Swarm key | Ed25519 (Noise) | `H(seed, "celluler/swarm/v1")` → `DHT.keyPair` | Hyperswarm transport authentication |
| Storage key | symmetric (XChaCha20) | `H(seed, "celluler/store/v1")` | Encrypts the private store at rest |
| Salt key | keyed hash | `H(seed, "celluler/salt/v1")` | Derives per-record commitment salts (§5.2) |

Every non-root public key is attested in the journal with a `nucleus/key.add` record before use, so a verifier who trusts the cell ID can check any key it presents. Keys are separated by purpose (no reuse of the journal key for Noise or encryption) to avoid cross-protocol attacks.

### 3.3 Why not RSA

RSA-2048 signatures are 256 B vs 64 B for Ed25519, key generation takes ~40 ms vs ~0.05 ms (measured in Node on this codebase's runtime), and nothing in the Holepunch stack uses it. PGP-style operation (sign, then encrypt to the recipient) is done with Ed25519 signatures plus X25519 sealed boxes (`crypto_box_seal`). The current per-start RSA keypair in `nucleus.service.js` is removed (§11).

### 3.4 Rotation and compromise

- Derived keys rotate via `key.revoke` + `key.add` (with a new context version, e.g. `sign/v2`).
- The root key cannot rotate inside one Hypercore. Options for root recovery (open question §12): a Hypercore multi-signer manifest, or a successor journal whose genesis is co-attested by the old key and/or by trusted peers (social recovery).

## 4. Storage model

```
            ┌──────────────── Nucleus (memory manager) ────────────────┐
service ──► │ record(type, body, class) ─► private store (Hyperbee,    │
            │                               encrypted, never replicated)│
            │                       └──► leaf hash ─► epoch Merkle tree │
            │ epoch close ─────────────► public journal (Hypercore,     │
            │                               replicated, commitments)    │
            └──────────────────────────────────────────────────────────┘
```

- **Public journal**: one Hypercore per cell, replicated on its discovery key. Contains only Nucleus record types (§6): genesis, key changes, epoch roots, immediate commitments, and voluntarily revealed edges.
- **Private store**: a Hyperbee on a non-replicated core, encrypted at rest. Holds full records, message bodies, private key material, and the leaves of each epoch tree. It can be segmented (per service, per day) and pruned without affecting the public journal.

Whether the private store uses one Hyperbee, one per service, or one per day is an **implementation detail to benchmark** (§10.3), not a protocol decision, because only epoch roots are public.

## 5. Records and commitments

### 5.1 Record envelope

Every record — public or private — uses one envelope. The Nucleus validates the envelope; the service that owns `type` validates `body`.

```
Record {
  v:     uint            // envelope version, = 1
  type:  string          // "<service>/<record>", e.g. "nucleus/genesis", "msg/received"
  ts:    uint            // claimed time, ms since epoch (self-asserted; order = index)
  refs:  [Ref]           // optional links to other records
  body:  bytes           // service-defined, encoded by the owning service
}

Ref { cell: bytes32, epoch: uint, leaf: bytes32 }   // points at another cell's commitment
```

**Encoding:** must be deterministic, because records are hashed. Recommended: `compact-encoding` (Holepunch-native, binary, fixed field order). Alternative: canonical JSON (RFC 8785). Decision pending (§12). Plain `JSON.stringify` is not acceptable.

### 5.2 Leaf commitments

```
salt_i = H(saltKey, epoch ‖ index)            // derived, never stored
leaf_i = H(salt_i ‖ encode(Record_i))          // BLAKE2b-256
```

The salt prevents brute-forcing low-entropy bodies ("yes", a name, a vote). Because it is derived, the cell only needs the record itself to re-open the commitment.

### 5.3 Epochs

Leaves accumulate in a Merkle tree per epoch. At epoch close the Nucleus appends one `nucleus/epoch` record with the root.

| Quantity | Value |
|---|---|
| Public cost per epoch | ~100 B (one record) |
| Hourly epochs (default), 1 year | 8,760 records ≈ 0.9 MB of public journal |
| Daily epochs, 1 year | 365 records ≈ 36.5 KB of public journal |
| Inclusion proof for n leaves | ⌈log₂ n⌉ × 32 B (n = 10⁶ → 640 B) |

Default epoch length: 1 hour (configurable). Trade-off: a record is not provable until its epoch closes. Records that must be provable immediately (key changes, revealed edges) are appended individually as `nucleus/commit` or their own type.

### 5.4 Retention classes

Each record type declares a retention class when registered:

| Class | Kept | Examples |
|---|---|---|
| `permanent` | forever | key changes, edge attestations, membership |
| `window` | by count / bytes / age (per-protocol config) | message bodies |
| `ephemeral` | not stored; leaf only | high-volume telemetry |

Pruning a record makes its commitment permanently unprovable. The Nucleus keeps the Merkle path data for `window` records until the record itself is pruned.

## 6. Nucleus record types

| Type | Visibility | Body |
|---|---|---|
| `nucleus/genesis` | public, block 0 | `{ protocol: "celluler/1", created: ts }` — nothing else by default |
| `nucleus/key.add` | public | `{ purpose, publicKey, contextVersion }` |
| `nucleus/key.revoke` | public | `{ publicKey, reason? }` |
| `nucleus/epoch` | public | `{ epoch, root, leafCount, prevEpochRoot }` |
| `nucleus/commit` | public | `{ leaf }` — single immediate commitment |
| `nucleus/edge.reveal` | public | see §8.3 |
| `nucleus/profile` | public (optional) | `{ name?, ... }` or a commitment to one |

The cell ID replaces the current generated UUID. Whether a public name is allowed at genesis or only via a later `profile` record is open (§12); this draft keeps genesis minimal.

### 6.1 Service registration

```js
nucleus.registerRecordType({
  type: "msg/received",
  owner: "message",
  retention: { class: "window", maxAge: "30d", maxBytes: "1GB" },
  visibility: "private"        // "private" (epoch leaf) | "public" (journal)
})
nucleus.record({ type, body, refs })  →  { epoch, index, leaf }
nucleus.query({ type, from?, to?, limit? })      // via local Hyperbee index
nucleus.prove({ epoch, index, disclose: "full" | "leaf" }) → Proof
```

## 7. Identity verification

Identity is verified in tiers. Each tier needs strictly more data than the last; protocols state which tier they require.

| Tier | Claim | Evidence | Data needed |
|---|---|---|---|
| T1 Possession | "I control cell X" | Sign verifier nonce with root key (or attested signing key) | 0 history; ~100 B round trip |
| T2 Continuity | "Cell X has existed since t" | Other cells' records that reference X's epoch roots at t | Anchors held by third parties |
| T3 Social proof | "X has real, ongoing relationships" | Edge attestations (§8) — revealed or selectively disclosed | ~100 B per edge per epoch with interaction |
| T4 Selective claim | "X interacted with Y ≥ N times since t" | Disclosed leaves + Merkle paths, co-signed by Y | ~N × (record + 640 B) |

Self-asserted timestamps prove nothing; time is established only by **anchoring**: when cell B records a reference to A's epoch root, B's own journal now witnesses that A's root existed by B's epoch. Mutual references between interacting cells produce these anchors as a by-product.

### 7.1 Proof object

```
Proof {
  cell:      bytes32          // cell ID
  epoch:     uint
  root:      bytes32          // must match nucleus/epoch record in cell's journal
  journal:   { length, signature }   // signed Hypercore length covering that epoch record
  leaf:      bytes32
  path:      [bytes32]        // Merkle inclusion path
  record?:   Record           // present for full disclosure
  salt?:     bytes32          // present for full disclosure
}
```

Verification: fetch (or receive) the cell's journal up to `journal.length`, check the Hypercore signature, find the `nucleus/epoch` record with `root`, verify `path` from `leaf` to `root`, and — for full disclosure — recompute `leaf` from `salt` and `record`.

Future: replace T4 disclosure with zero-knowledge proofs over committed leaves.

## 8. Edges (relationships) — hybrid model

**Decision:** edges are private by default. A cell may reveal any edge voluntarily, and a protocol may require specific edges to be revealed as a condition of participation.

### 8.1 Private edge attestation

At each epoch in which A and B interacted, each side records a private leaf:

```
type: "identity/edge"
body: { peer: B, count, sharedRoot, peerEpochRoot }
```

- `sharedRoot`: Merkle root over the hashes of the messages exchanged in the epoch (both sides can compute it identically).
- `peerEpochRoot`: B's most recent epoch root as seen by A — this is the T2 anchor.

Private edges cost nothing publicly beyond the epoch root.

### 8.2 Why revealing an edge needs both parties

An edge reveals the counterparty's relationship too. A public edge is therefore **co-signed**: it is published only when both cells sign the same reveal. A cell can always reveal its *own* participation in a commitment to a single verifier (T4), but publishing an edge to the world requires consent from both ends.

### 8.3 `nucleus/edge.reveal`

```
body: {
  peer:      bytes32
  kind:      string        // protocol-defined, e.g. "prana/coop.member", "nadi/vouch"
  since:     { epoch, leaf }      // first committed edge being revealed
  sigs:      [selfSig, peerSig]   // both signing keys over (kind, since, peer pair)
}
```

### 8.4 Protocol-required reveals

A protocol (for example a co-op membership protocol in PRANA) declares the edge kinds it requires. A cell that wants to participate publishes the required co-signed reveals; one that declines simply cannot join that protocol. The base layer enforces nothing about which edges must be public.

## 9. Message service

### 9.1 Scope

The Message service defines **how a generic message moves from one cell to one or many cells**, and records receipts via the Nucleus. It defines no message types and depends on nothing but the Nucleus. Auth, Identity, Consensus and all upper-layer services register their own protocols.

### 9.2 Envelope

```
Message {
  v:        uint           // = 1
  id:       bytes32        // H(from ‖ seq ‖ ts), used for dedupe
  from:     bytes32        // sender cell ID
  to:       bytes32 | Topic
  protocol: string         // "<service>/<version>", e.g. "auth/1"
  ts:       uint
  ttl?:     uint           // hop limit for multicast / relay
  body:     bytes          // opaque; optionally a sealed box to the recipient
  sig:      bytes64        // sender's attested signing key over all fields above
}
```

Signatures are always required in v1 (64 B): receipts are only useful as evidence if the sender's signature is retained.

### 9.3 Handler registration

```js
message.register({
  protocol: "auth/1",
  handler: "auth.onMessage",              // Moleculer action to call
  journal: "hash"                         // "none" | "hash" | "full"
})
message.send({ to, protocol, body, encrypt? }) → { id }
message.publish({ topic, protocol, body, ttl? }) → { id }
```

Unknown protocols are dropped (and optionally counted); the Message service never interprets `body`.

### 9.4 Transport

- **Unicast:** Hyperswarm `joinPeer(swarmKey)`. After the Noise handshake, the receiver checks the remote swarm key is attested by `from` (via `key.add`). Transport is encrypted by Noise.
- **Multicast / broadcast:** `swarm.join(topic)`; flood to topic connections with dedupe on `id` and `ttl` decrement.
- **Encryption at message level:** required when the message may be relayed or stored by third parties; uses a sealed box to the recipient's attested X25519 key.
- **Framing:** one Protomux channel `celluler/msg/1` per connection; dispatch by `protocol`.
- **Delivery (v1):** at-most-once, no ordering guarantees. Acks, retries and ordering are for higher protocols to add.

### 9.5 Receipts

For each sent or received message the Message service calls `nucleus.record` with type `msg/sent` or `msg/received`, body `{ id, peer, protocol, bodyHash, sig }`, at the retention class and journal mode the protocol registered. These receipts feed `sharedRoot` in edge attestations (§8.1).

## 10. Testing plan

### 10.1 Infrastructure
- Use `hyperdht/testnet` for an in-process DHT; no test touches the public DHT. (The current suite takes ~3 min, likely from public DHT bootstrap.)
- Cells in tests use injected seeds for reproducible cell IDs.

### 10.2 Scenarios (in order)
1. Single cell: genesis, key attestations, record/query/prove round trip, epoch close, restart with persisted seed yields same cell ID.
2. Two cells: unicast send/receive, receipts on both sides, matching `sharedRoot`, edge leaves, T1 and T4 proofs verified by the other cell.
3. N cells (N = 3, 10, 50): topic multicast with dedupe and TTL, co-signed edge reveal, T2 anchoring across cells.
4. Fault cases: revoked key, tampered record, mismatched salt, message from unattested swarm key.

### 10.3 Benchmarks for the private-store layout
Compare one Hyperbee vs per-service vs per-day segments on: append throughput, storage overhead, prune cost, and time for a verifier to produce/verify a proof.

## 11. Changes to current code

| Current (`main`, Jun 2025) | Change |
|---|---|
| RSA-2048 keypair generated in memory on each start | Remove; derive keys from root seed (§3) |
| `generateCellUUID` (hash of name, time, config) in block 0 | Cell ID = journal public key; block 0 = `nucleus/genesis` |
| `write` stringifies JSON into a `valueEncoding: 'json'` core (double-encoded) | Nucleus appends encoded envelopes only; services call `record` |
| Any caller may `write` arbitrary data to any core | Writes only through `record` with a registered type |
| `memory` storage default | Keep for tests; warn that identity is not persistent |
| `MessageService` depends on `identity` and `consensus`, hard-codes CHAT/AUTH/TX/POST/QUERY/EXEC | Depends on `nucleus` only; types become protocols registered by their services |
| `MessageService` is CommonJS in an ESM package | Rewrite as ESM `BaseService` |
| No Hyperbee dependency | Add `hyperbee` (private store and type index); `sodium-universal`, `protomux`, `compact-encoding` are already transitive deps and become direct ones |

## 12. Open questions

1. **Encoding:** compact-encoding (recommended) vs canonical JSON.
2. **Public name at genesis:** allowed, or only via `nucleus/profile` later?
3. **Epoch length default:** 1 h proposed; per-cell configurable?
4. **Private-store segmentation:** single, per-service, or per-day — decide from §10.3 benchmarks.
5. **Root key recovery:** multi-signer manifest vs successor journal with social recovery.
6. **Threat model:** which adversaries (Sybil farms, key theft, colluding verifiers) each tier must resist — needed before fixing T3 thresholds.
7. **Edge kinds registry:** where protocol-defined edge kinds are named and versioned.
8. **ZK proofs:** which T4 claims are worth a ZK circuit first.
