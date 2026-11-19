# NADI Journal, Identity & Messaging — Design Spec

**Status:** Draft v0.2 (2026-11-18) · **Layer:** NADI (L1) · **Supersedes:** the Nucleus/Message sections of `architecture.md` and `services.md` where they conflict. · **Companion:** [NADI Consensus](nadi-consensus.md)

This spec defines the foundation every other Celluler service builds on: how a cell holds keys, what its journal is, how private data is stored and proven, how identity is verified, and how messages move reliably between cells. It defines **syntax, not semantics**: the Nucleus and Message services define formats and guarantees; higher services (Auth, Identity, Consensus, and later PRANA and BUDDHI services) define what their records, transactions and messages mean.

### Changes from v0.1
- The journal **is the cell's event chain** (one Hypercore per cell); there is no separate event core, and separate epoch records are replaced by a commitment root in every event.
- **Owners never delete.** Retention classes and routine pruning are removed. The private store is a mutable local database; redaction is a rare, explicit, recorded exception.
- Messaging is **reliable**: pairwise links with sender-owned link cores, an inbox, delivery receipts, offline delivery through blind replicas, and per-sender topic cores for multicast.
- Consensus runs on **topological clusters**, not commons (see the companion doc).

## 1. Layer context

| Layer | Name | Services that live here |
|---|---|---|
| L1 | **NADI** — Network of Agents with Decentralized Identity | Nucleus, Message, Auth, Identity, Consensus |
| L2 | **PRANA** — Public Resource Alliance Network Architecture | Token, quadratic funding/voting, co-op and private commons, decision circles |
| L3 | **BUDDHI** — Builder-owned, Universally Distributed, Democratically Hosted Intelligence | Compute, data, model and agent commons |

A service may depend only on services in its own layer or below. The **Nucleus depends on nothing; the Message service depends only on the Nucleus.** Every other service plugs in by registering record and transaction types (with the Nucleus) and message protocols (with the Message service).

## 2. Design principles

1. **The journal is the cell's life.** Every block of a cell's journal is an event: its creation, every sync, every key change, every public act. The ordered, signed, hash-linked chain of events *is* the cell's identity.
2. **The journal holds commitments, not private data.** Anything in a Hypercore is permanent and readable by anyone with its key. Private data is committed by salted hash and kept in the private store.
3. **Owners never delete.** A cell keeps its own journal and private records forever, so it can always prove any statement about any of its commitments. Redaction is an explicit exception that is itself recorded (§4.4).
4. **The Nucleus is the cell's memory manager.** It owns keys, the journal, the private store and backups. Services ask the Nucleus to record; they never write cores directly.
5. **No message is lost.** Messages are written to durable, replicated cores and acknowledged with receipts.
6. **Base layers define syntax; upper layers define semantics.**

## 3. Keys

### 3.1 Root seed

Each cell has one 32-byte **root seed**, persisted by Corestore as its primary key under file storage. In `memory` storage it is lost on restart, so memory mode is for tests only.

### 3.2 Derived keys

All keys are derived deterministically from the seed with distinct context labels (BLAKE2b keyed hash via sodium `crypto_generichash`). The seed is the only secret that must be backed up.

| Key | Algorithm | Derivation | Purpose |
|---|---|---|---|
| **Journal key** | Ed25519 | Corestore `name: 'journal'` | Signs the journal. **Its public key is the cell ID.** |
| Signing key | Ed25519 | `H(seed, "celluler/sign/v1")` | Signs messages, receipts and disclosures |
| Encryption key | X25519 | `H(seed, "celluler/box/v1")` | Sealed boxes; pairwise link secrets (§9.2) |
| Swarm key | Ed25519 (Noise) | `H(seed, "celluler/swarm/v1")` → `DHT.keyPair` | Hyperswarm transport authentication |
| Storage key | XChaCha20 | `H(seed, "celluler/store/v1")` | Encrypts the private store and key index at rest |
| Salt key | keyed hash | `H(seed, "celluler/salt/v1")` | Per-record commitment salts (§5.3) |
| Link core keys | Ed25519 | `H(seed, "celluler/link/v1" ‖ peerId)` | Sender-owned core per link (§9.3) |
| Topic core keys | Ed25519 | `H(seed, "celluler/topic/v1" ‖ topicId)` | Sender-owned core per topic (§9.8) |
| Shard core keys | Ed25519 | `H(seed, "celluler/shard/v1" ‖ j)` | Backup shards for custodian slot *j* (§10) |

Every non-journal public key that others must trust (signing, encryption, swarm) is attested by a `key.add` event before use. Keys are separated by purpose to avoid cross-protocol attacks.

### 3.3 Why not RSA

RSA-2048 signatures are 256 B vs 64 B for Ed25519, key generation takes ~40 ms vs ~0.05 ms (measured in Node on this codebase's runtime), and nothing in the Holepunch stack uses it. PGP-style operation (sign, then encrypt to the recipient) is Ed25519 signatures plus X25519 sealed boxes (`crypto_box_seal`).

### 3.4 Rotation and compromise

- Derived keys rotate via `key.revoke` + `key.add` events with a new context version (e.g. `sign/v2`).
- The journal key cannot rotate within one Hypercore. Root recovery options (open question §13): a Hypercore multi-signer manifest, or a successor journal whose genesis is co-attested by the old key and/or guardians (§10.5).
- Concurrent use of a stolen journal key forks the journal, which is detected and provable (§7.3).

## 4. Storage model

```
                 ┌────────────────────── Nucleus ──────────────────────┐
service ──► record(type, body) ─► private store (mutable, encrypted, local)
                 │                        │ leaf hashes                  │
                 │                        ▼                              │
                 │   next event ─► journal (Hypercore, public, permanent)│
                 │                  { kind, otherParent?, commits, … }   │
                 │   private store changes ─► encrypted chunks ─► RS shards ─► custodians
                 └──────────────────────────────────────────────────────┘
```

### 4.1 The four kinds of storage

| Storage | Owner | Visibility | Lifetime |
|---|---|---|---|
| **Journal** (event chain) | the cell | public: anyone with the cell ID | forever |
| **Private store** | the cell | the cell only (encrypted at rest; backed up as shards) | forever, except explicit redaction |
| **Link and topic cores** (§9) | the sender | the counterparties (encrypted) and blind replicas | forever by the sender; transport copies are caches |
| **Data held for others** | other cells | — | per storage duty (§4.3) |

### 4.2 Why Hypercore data cannot really be deleted

A Hypercore is an append-only log whose Merkle tree is signed by its owner. Two operations look like deletion but are not:

- `clear(start, end)` frees local block storage but keeps the Merkle tree, and every peer that replicated those blocks still has them.
- `truncate` lets the owner rewrite history from some index, but to peers it is indistinguishable from signing two different histories — in this protocol that is a **fork**, i.e. provable misbehavior (§7.3).

So "pruning" a replicated core only ever means *this copy forgets*. The protocol therefore never relies on deletion, and owners never truncate.

### 4.3 Owners never delete; storage duties for others

Every cell keeps forever: its journal, its private store, and the link and topic cores it owns. This makes every commitment the cell has ever made provable and removes all retention logic.

What a cell holds **for others** is a cache governed by explicit duties, not deletion of anyone's records (the owner still has them):

| Held for others | Duty |
|---|---|
| Cluster members' journal events | until covered by a finalized checkpoint plus *R* rounds (consensus doc §10) |
| Counterparties' link cores | messages copied into own inbox and acknowledged (§9.4) |
| Blind replicas of others' link/topic cores | while the replica agreement is active (§9.6) |
| Backup shards as custodian | while the custodian agreement is active (§10) |

### 4.4 Redaction (exception, not routine)

A cell may need to make private content unrecoverable (a counterparty's request, a legal obligation, a mistake). Redaction:

1. destroys the record's content key (§10.2) and the local plaintext,
2. records a private `nucleus/redaction` record committing to the redacted leaf, and
3. thereafter answers proof requests for that leaf with a verifiable "redacted at event *e*" rather than a missing-data error.

The commitment stays in the journal forever; only the ability to open it is lost. Residual risk: anyone holding the seed *and* an old copy of the key index could still decrypt backed-up content (§10.4).

### 4.5 Growth per cell

Assumptions: 1 sync event per minute, ~170 B per event plus ~80 B of Hypercore tree overhead, a 100-cell cluster with hourly checkpoints, and 200 private messages a day of ~1 KB.

| Item | Rate | Per year |
|---|---|---|
| Own journal | 1,440 events/day × ~250 B | ~131 MB (~26 MB at one sync per 5 min) |
| Cluster checkpoints kept | 8,760 × ~6.6 KB | ~58 MB (~3 MB with aggregate signatures) |
| Private records (messages) | 200/day × ~1 KB | ~73 MB |
| Custodian duty for others (reciprocal, RS 4-of-7) | ≈ 1.75 × own private data | ~128 MB |
| **Total** | | **~390 MB/year** (~4 GB per decade) |

This is comfortable for desktops and servers and the main constraint for phones; the sync rate and checkpoint signature format are the main levers (§13).

## 5. Events and records

### 5.1 Event (one journal block)

```
Event {
  v:           uint            // format version, = 1
  kind:        string          // §5.2
  ts:          uint            // creator's claimed time, ms (consensus assigns the real time)
  otherParent: Ref | null      // the peer event this event records hearing from
  commits:     bytes32 | null  // Merkle root of private-record leaves since the previous event (§5.3)
  payload:     bytes           // kind-specific; for `tx`, service-defined
}
Ref { cell: bytes32, index: uint, hash: bytes32 }
```

- **Self-parent is implicit:** event *i*'s self-parent is block *i − 1* of the same journal.
- **Signature is Hypercore's:** each append is signed by the journal key.
- **Encoding:** deterministic (recommended `compact-encoding`; alternative canonical JSON, RFC 8785). Plain `JSON.stringify` is not acceptable.

### 5.2 Event kinds

| Kind | otherParent | Payload |
|---|---|---|
| `genesis` | — | `{ protocol: "celluler/1", created }` — block 0, nothing else |
| `sync` | peer's head event | none (a ping in consensus v1) |
| `message` | sender's event that committed the message | `{ link, index, bodyHash }` — a **revealed** message receipt (§8.3) |
| `tx` | any | `{ type, body }` — public transaction; `type` owned by a registered service |
| `key.add` / `key.revoke` | — | `{ purpose, publicKey, contextVersion }` / `{ publicKey, reason? }` |
| `edge.reveal` | — | co-signed public relationship (§8.4) |
| `profile` | — | optional public profile or a commitment to one |
| `terminal` | — | `{ successor? }` — the cell's end, or move to a successor journal |

Any event may carry `commits`. Private activity (sends, receipts, inbox entries, edges, service records) therefore reaches the journal at the rate events are created, not at the rate messages flow.

### 5.3 Private records and commitments

```
Record { type: "<service>/<record>", ts, refs: [Ref], body: bytes }

salt  = H(saltKey, recordSeq)                 // derived, never stored
leaf  = H(salt ‖ encode(Record))              // BLAKE2b-256
event.commits = MerkleRoot(leaves recorded since the previous event)
```

Inclusion proof size is ⌈log₂ *n*⌉ × 32 B for *n* leaves in one event's batch (typically small; 1,024 leaves → 320 B).

### 5.4 Nucleus API

```js
nucleus.registerRecordType({ type: "msg/received", owner: "message" })   // private
nucleus.registerTxType({ type: "prana/vote", owner: "prana-governance" })  // public tx
nucleus.record({ type, body, refs })  → { seq, leaf }      // committed in the next event
nucleus.emit({ kind: "tx", payload, otherParent? }) → { index }
nucleus.query({ type, from?, to?, limit? })
nucleus.prove({ seq, disclose: "full" | "leaf" }) → Proof
nucleus.redact({ seq, reason })
nucleus.getCellId()
```

## 6. What is public, what is private

| Public (journal) | Private (store) |
|---|---|
| genesis, keys, profile (optional) | message bodies, inbox, receipts |
| sync events (who synced with whom, when) | private relationship edges |
| revealed message receipts and edges | service records |
| public transactions | key material, link secrets, key index |
| commitment roots | everything needed to open commitments |

Sync partners in consensus v1 are chosen by verifiable randomness (consensus doc §4.3), so public sync events reveal participation but not relationships.

## 7. Identity verification

| Tier | Claim | Evidence | Cost |
|---|---|---|---|
| T1 Possession | "I control cell X now" | Sign a verifier nonce, **or** show a fresh event whose otherParent is the verifier's latest event | ~100 B |
| T2 Continuity | "X has existed and acted since *t*" | Consensus timestamps on X's events (consensus doc §8.2) | checkpoint + Merkle path |
| T3a Social proof | "X has real relationships" | Private edges disclosed, or co-signed public edges (§8) | ~100 B per edge |
| T3b Participation | "X has participated faithfully in its cluster since checkpoint *k*" | Finalized checkpoint + stats path (consensus doc §8.4) | ~6.6 KB (N = 100) |
| T4 Selective claim | "X interacted with Y ≥ *n* times since *t*" | Disclosed leaves + Merkle paths, co-signed by Y | *n* × (record + path) |

### 7.1 Proof object

```
Proof {
  cell, journal: { length, signature }     // signed Hypercore length
  event: uint                              // event whose `commits` covers the leaf
  root: bytes32                            // = event.commits
  leaf, path: [bytes32]
  record?, salt?                           // for full disclosure
  redacted?: { atEvent }                   // when the record was redacted (§4.4)
}
```

Verification: check the signed journal length, read event `event`, check `root`, verify `path` from `leaf`, and for full disclosure recompute `leaf` from `salt` and `record`.

### 7.2 Continuous possession

Each `sync` event commits to the peer's latest event hash, which did not exist before that moment. Every sync event therefore proves its creator held the journal key at that time; T1 needs no separate challenge inside a cluster.

### 7.3 Clone and fork detection

If the journal key is copied, both holders append to the same journal and sign different blocks at the same index. That fork is a self-contained proof of compromise, typically detected within one sync interval because cluster peers replicate the journal continuously. Responses: the consensus layer stops counting the cell (consensus doc §8.5); the owner recovers through a successor journal (§3.4).

## 8. Edges and messages — hybrid privacy

**Decision:** relationships are private by default. A cell may reveal any edge, and a protocol may require specific edges to be revealed as a condition of participation.

### 8.1 Private edges

For each period in which A and B exchanged messages (real traffic only; consensus pings never create edges), each side records a private `identity/edge` record: `{ peer, count, sharedRoot, peerHead }`, where `sharedRoot` is the Merkle root over the hashes of messages exchanged and `peerHead` is the latest peer event seen (a time anchor).

### 8.2 Committed messages (default)

A message's send and receipt are private records, reaching the journal only inside `commits`. The message is still placed in the global order (through the event that commits it) but nothing public links A to B.

### 8.3 Revealed messages

For relationships the parties have made public, the receiver may emit a `message` event whose `otherParent` is the sender's event that committed the message. The receipt is then publicly and causally linked to the send.

### 8.4 Co-signed edge reveal

An edge reveals the counterparty's relationship too, so publishing one needs both cells:

```
edge.reveal payload: { peer, kind, since: Ref, sigs: [selfSig, peerSig] }
```

`kind` is protocol-defined (e.g. `prana/coop.member`, `nadi/vouch`). A protocol may list required kinds; a cell that declines simply cannot participate in it.

## 9. Message service

### 9.1 Scope

The Message service moves messages between cells **reliably**, records sends, receipts and inbox entries through the Nucleus, and dispatches to handlers registered by other services. It defines no message types and depends only on the Nucleus.

### 9.2 Links (handshake)

Two cells must agree to communicate before exchanging messages:

1. A sends a `link.request` (via first contact, §9.7) carrying its link core key for B.
2. B accepts with a `link.accept` carrying its link core key for A.
3. Both derive a shared **link secret** from their X25519 keys (`crypto_scalarmult` + KDF); both link cores are encrypted with it, so only A and B can read them.
4. Each side records a private `msg/link` record (`{ peer, myCore, peerCore, since }`).

### 9.3 Sending

A appends the message to **its own** A→B link core. The block index is the per-link sequence number, giving deduplication and FIFO order per sender for free.

```
Message {
  v: 1, id,                 // id = H(from ‖ link ‖ index)
  from, to,                 // cell IDs
  protocol: "<service>/<version>",
  ts, body,                 // body opaque to the Message service
  sig                       // sender's signing key over all fields
}
```

A also records a private `msg/sent` record, committed by its next event.

### 9.4 Receiving and the inbox

- **Online:** Hypercore live replication delivers each append to B as it happens.
- **At startup:** B calls `update()` on every inbound link core and pulls anything new.
- B verifies `sig`, **copies the body** into its private store, and appends an inbox entry `msg/received { from, link, index, bodyHash, receivedAt }`. B keeps its own copy because the body is B's to prove things about.
- B processes its inbox in arrival order, dispatching each message to the handler registered for its `protocol`; unknown protocols are recorded and not dispatched.

### 9.5 Receipts

B appends acknowledgements to its B→A link core:

- `ack.delivered { upTo: index }` — cumulative, sent as soon as messages reach the inbox.
- `ack.processed { index, status }` — optional, for protocols that need handler completion.

Receipts are signed and stored in a core A can show to others: they are evidence of delivery.

### 9.6 Offline delivery: blind replicas

If A is offline when B comes up, B cannot pull from A directly. So a cell's link and topic cores are also replicated by **blind replicas**: its backup custodians or cluster peers, who hold the encrypted cores without being able to read them or learn who the counterparty is. B fetches from whichever replica is reachable. Replica agreements and checks reuse the custodian machinery (§10.6).

### 9.7 First contact

Requiring a link blocks spam but also blocks strangers. A cell may accept `link.request`s through:

- **introduction** by a mutual contact, who forwards the request over its own links;
- a **public request topic** with rate limits and a small proof of work; or
- protocol-specific rules (e.g. a co-op admitting applicants).

### 9.8 Topics and multicast

A sender that publishes to a topic owns one **topic core** per topic. Subscribers replicate the topic cores of the senders they follow. Encryption uses a topic key distributed to subscribers (or none for public topics). Receipts are optional per topic protocol.

### 9.9 Closing a link

Either side appends `link.close` to its link core and records it privately; the link secret is retired and no further messages are accepted on that link.

### 9.10 Guarantees

| Property | Guarantee |
|---|---|
| Loss | None, while at least one copy of the sender's core (sender or replica) survives |
| Inbox delivery | Exactly once (dedupe by link index) |
| Handler execution | At least once; handlers must be idempotent by message `id` |
| Order | FIFO per sender per link; inbox in arrival order; global order from consensus |
| Evidence | Signed delivery receipts in the receiver's link core |

### 9.11 Handler registration

```js
message.register({ protocol: "auth/1", handler: "auth.onMessage" })
message.link({ to })                       → { status }     // handshake
message.send({ to, protocol, body })       → { id, index }
message.publish({ topic, protocol, body }) → { id, index }
message.status({ id })                     → "sent" | "delivered" | "processed"
```

## 10. Private store backup and recovery

### 10.1 Goals

1. Restore a cell from its **root seed alone** (or from guardians if the seed is lost, §10.5).
2. **No custodian holds a complete copy** of any data, and none can read what it holds.
3. Custodians can be checked and replaced automatically.

### 10.2 Chunks and content keys

Private store changes are written to **append-only backup chunks** (default: one per hour). Each record's content is encrypted with its own random **content key**, and content keys are kept in a small **key index** encrypted with the storage key. Redaction (§4.4) destroys one content key.

### 10.3 Striping across custodians

Each closed chunk is erasure-coded with Reed-Solomon into *n* shards, any *k* of which reconstruct it; shard *j* of every chunk goes to custodian *j*.

```
chunk (already encrypted) ─► RS(k, n) ─► shard_1 … shard_n ─► custodian 1 … custodian n
```

- Each custodian holds ~1/*k* of every chunk; no group smaller than *k* can reconstruct anything.
- Default **k = 4, n = 7**: overhead 1.75×, survives the loss of any 3 custodians.
- Optional **AONT-RS** (all-or-nothing transform before encoding) makes fewer than *k* shards useless even with the keys.
- Custodian slot *j* is a Hypercore keyed `H(seed, "celluler/shard/v1" ‖ j)`; each block is one shard. Shard cores are not linkable to the cell ID by outsiders.
- Chunks are padded to size buckets to limit what custodians learn from sizes.
- The key index is small (~80 B per content key) and replicated in full, encrypted, to all custodians.

### 10.4 Residual risk

Anyone who obtains the seed *and* an old copy of the key index can decrypt redacted content that custodians still hold. Custodians overwrite key-index versions rather than keep history, but this cannot be enforced.

### 10.5 Seed recovery (guardians)

The seed is split with **Shamir secret sharing** (default 3-of-5) among guardians, each share sealed to the guardian's encryption key and delivered over a link. Guardians release shares only after verifying the requester out of band. A restored seed yields the same journal key, so device loss needs no rotation; compromise needs a successor journal (§3.4).

Custodians and guardians are normally chosen from trusted edges; reciprocal storage among co-op members is the v1 arrangement, with a PRANA storage market later.

### 10.6 Checks and repair

- **Proof of storage:** request a random block with its Merkle proof against the signed tree.
- **Repair:** reconstruct from *k* other custodians, regenerate missing shards, reassign the slot.
- **Accounting:** bytes stored for and by each peer, for reciprocity or payment.

### 10.7 Protocol surface

| Item | Kind | Notes |
|---|---|---|
| `backup/1` | message protocol | custodian and replica offers, storage challenges, guardian shares |
| `backup/custodian`, `backup/replica`, `backup/guardian` | private records | agreements |

## 11. Testing plan

### 11.1 Infrastructure
- `hyperdht/testnet` for an in-process DHT; no test touches the public DHT (the current suite takes ~3 min, likely from public DHT bootstrap).
- Injected seeds for reproducible cell IDs.

### 11.2 Scenarios
1. **Single cell:** genesis, key events, record → commit → prove, redaction, restart with persisted seed yields the same cell ID.
2. **Two cells:** link handshake, send/receive, inbox, delivered/processed receipts, committed vs revealed messages, T1 and T4 proofs.
3. **Offline:** B offline during sends then catches up; A offline when B starts, delivered via blind replica.
4. **Topics:** N = 3, 10, 50 subscribers.
5. **Faults:** revoked key, tampered record, mismatched salt, unattested swarm key, cloned journal key (fork detected).
6. **Backup:** stripe to 7 custodians, destroy the cell, restore from seed using any 4; custodian failure and repair; seed recovery from 3 of 5 guardians.

### 11.3 Benchmarks
Journal growth vs sync rate; private store write throughput; backup encode/upload cost per chunk; restore time; proof generation and verification time.

## 12. Changes to current code

| Current (`main`, Jun 2025) | Change |
|---|---|
| RSA-2048 keypair generated in memory on each start | Remove; derive keys from root seed (§3) |
| `generateCellUUID` in block 0 | Cell ID = journal public key; block 0 = `genesis` event |
| `write` stringifies JSON into a `valueEncoding: 'json'` core (double-encoded) | Journal accepts only encoded events via `emit`; services `record` |
| Any caller may write arbitrary data to any core | Writes only through the Nucleus with registered types |
| `memory` storage default | Keep for tests; warn that identity is not persistent |
| `MessageService` depends on `identity` and `consensus`, hard-codes CHAT/AUTH/TX/POST/QUERY/EXEC | Depends on `nucleus` only; link-based delivery; types become registered protocols |
| `MessageService` is CommonJS in an ESM package | Rewrite as ESM `BaseService` |
| No Hyperbee/RocksDB private store | Add a mutable encrypted private store; `sodium-universal`, `protomux`, `compact-encoding` become direct dependencies |

## 13. Open questions

1. **Encoding:** compact-encoding (recommended) vs canonical JSON.
2. **Public name at genesis:** allowed, or only via `profile` later?
3. **Sync rate vs journal growth:** 1/min costs ~131 MB/year per cell; is 1/5 min (~26 MB) enough for consensus latency?
4. **Phones:** should mobile cells delegate journal and storage duties to a home node?
5. **Root key recovery:** multi-signer manifest vs successor journal.
6. **Threat model:** adversaries each identity tier must resist; thresholds for T3a/T3b.
7. **Edge kinds registry:** where protocol-defined edge kinds are named and versioned.
8. **ZK proofs:** which T4 claims merit circuits first.
9. **Backup parameters:** default k/n, chunk interval, AONT-RS default.
10. **First contact defaults:** introduction only, or a public request topic by default?
11. **Blind replica selection:** custodians, cluster peers, or both.
