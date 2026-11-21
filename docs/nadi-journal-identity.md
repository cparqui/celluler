# NADI Journal, Identity & Messaging — Design Spec

**Status:** Draft v0.3.1 (2026-11-21) · **Layer:** NADI (L1) · **Supersedes:** the Nucleus/Message sections of `architecture.md` and `services.md` where they conflict. · **Companion:** [NADI Consensus](nadi-consensus.md)

This spec defines the foundation every other Celluler service builds on: how a cell holds keys, what its journal is, how private data is stored and proven, how identity is verified, and how messages move reliably between cells. It defines **syntax, not semantics**: the Nucleus and Message services define formats and guarantees; higher services (Auth, Identity, Consensus, and later PRANA and BUDDHI services) define what their records and messages mean.

### Changes in v0.3.1
Corrections from implementing the Nucleus identity root:
- Events carry an explicit **`prev`** hash, so an event hash commits to the event's whole history (§5.2).
- The **cell ID is the journal's Hypercore key**, which is a hash of a manifest naming the Ed25519 signer, not the signer's raw public key (§3.2).
- The event **encoding and hash are now defined** (§5.2).
- Seed injection and `memory` storage are specified (§3.1). Writes and secret-key operations are local to the cell (§5.5).
- Queued public records can be lost in a crash until the private store exists (§5.3, §13).

### Changes in v0.3
- **One record primitive.** The Nucleus has a single type registry and a single `record` call; visibility (`private` or `public`) is chosen per record, not per type.
- **A transaction is a public message.** Messages are addressed to a cell, a topic, or `public`; public messages are written inline into the journal and ordered by consensus. There is no separate transaction type or `tx` event kind.
- **Only the Nucleus creates events.** Services no longer call `emit`; events are created on consensus syncs, revealed receipts and rate-limited urgent public records. The event `kind` field is removed.
- Root seed size and post-quantum notes added (§3.1).

### Changes in v0.2
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

A service may depend only on services in its own layer or below. The **Nucleus depends on nothing; the Message service depends only on the Nucleus.** Every other service plugs in by registering record types (with the Nucleus) and message protocols (with the Message service).

## 2. Design principles

1. **The journal is the cell's life.** Every block of a cell's journal is an event: its creation, every sync, every key change, every public act. The ordered, signed, hash-linked chain of events *is* the cell's identity.
2. **The journal holds commitments, not private data.** Anything in a Hypercore is permanent and readable by anyone with its key. Private data is committed by salted hash and kept in the private store.
3. **Owners never delete.** A cell keeps its own journal and private records forever, so it can always prove any statement about any of its commitments. Redaction is an explicit exception that is itself recorded (§4.4).
4. **The Nucleus is the cell's memory manager.** It owns keys, the journal, the private store and backups. Services ask the Nucleus to record; they never write cores directly.
5. **No message is lost.** Messages are written to durable, replicated cores and acknowledged with receipts.
6. **Base layers define syntax; upper layers define semantics.**

## 3. Keys

### 3.1 Root seed

Each cell has one 32-byte (256-bit) **root seed**, persisted by Corestore as its primary key under file storage. In `memory` storage it is lost on restart, so memory mode is for tests only. Corestore 7 has no in-memory backend, so `memory` storage is a temporary directory deleted when the cell stops, and the cell logs a warning that its identity will not persist.

A seed may be injected through the `seed` setting (64 hex characters) for reproducible cells. It must match any seed already in that storage, or startup fails. The Nucleus removes it from its service settings, because Moleculer publishes settings to other nodes.

**Why 256 bits is enough.** The seed is never the weakest point:

- Guessing the seed takes ~2²⁵⁶ tries. The cheaper attack is to derive the journal private key directly from the cell ID, a discrete logarithm on Curve25519, which takes ~2¹²⁶ operations. That ~128-bit level is set by the curve, so a 1,024- or 2,048-bit seed would add nothing: every key is still a 256-bit Curve25519 key. Those larger sizes come from RSA, which needs far more bits for the same security.
- Knowing the cell ID or any public key does not help find the seed: keys are derived with a one-way keyed hash (§3.2), so recovering the seed from a derived key means inverting BLAKE2b.
- **Quantum:** Shor's algorithm would break Ed25519 and X25519 whatever the seed length. Grover's algorithm only reduces a 256-bit seed search to ~2¹²⁸, still out of reach. Post-quantum protection therefore means new key types (e.g. hybrid ML-DSA and ML-KEM keys attested with `nucleus/key.add`), not a longer seed; the journal key itself cannot change (open question §13).

The practical risks are generating the seed with weak randomness (it must come from the OS CSPRNG, e.g. sodium `randombytes_buf`) and seed theft at rest (the seed file should be protected by the OS keystore or a passphrase).

### 3.2 Derived keys

All keys are derived deterministically from the seed with distinct context labels (BLAKE2b keyed hash via sodium `crypto_generichash`). The seed is the only secret that must be backed up.

| Key | Algorithm | Derivation | Purpose |
|---|---|---|---|
| **Journal key** | Ed25519 | Corestore `name: 'journal'` | Signs the journal. **The journal's Hypercore key is the cell ID.** |
| Signing key | Ed25519 | `H(seed, "celluler/sign/v1")` | Signs messages, receipts and disclosures |
| Encryption key | X25519 | `H(seed, "celluler/box/v1")` | Sealed boxes; pairwise link secrets (§9.2) |
| Swarm key | Ed25519 (Noise) | `H(seed, "celluler/swarm/v1")` → `DHT.keyPair` | Hyperswarm transport authentication |
| Storage key | XChaCha20 | `H(seed, "celluler/store/v1")` | Encrypts the private store and key index at rest |
| Salt key | keyed hash | `H(seed, "celluler/salt/v1")` | Per-record commitment salts (§5.4) |
| Link core keys | Ed25519 | `H(seed, "celluler/link/v1" ‖ peerId)` | Sender-owned core per link (§9.3) |
| Topic core keys | Ed25519 | `H(seed, "celluler/topic/v1" ‖ topicId)` | Sender-owned core per topic (§9.8) |
| Shard core keys | Ed25519 | `H(seed, "celluler/shard/v1" ‖ j)` | Backup shards for custodian slot *j* (§10) |

Every non-journal public key that others must trust (signing, encryption, swarm) is attested by a public `nucleus/key.add` record before use. Keys are separated by purpose to avoid cross-protocol attacks.

**Cell ID.** A Hypercore's key is the hash of its manifest, and the manifest names the Ed25519 signer. The cell ID is that key (`core.key`), because it is what peers need to find, replicate and verify the journal. To check a raw journal signature, read the signer's public key from the manifest, which the cell ID commits to.

### 3.3 Why not RSA

RSA-2048 signatures are 256 B vs 64 B for Ed25519, key generation takes ~40 ms vs ~0.05 ms (measured in Node on this codebase's runtime), and nothing in the Holepunch stack uses it. PGP-style operation (sign, then encrypt to the recipient) is Ed25519 signatures plus X25519 sealed boxes (`crypto_box_seal`).

### 3.4 Rotation and compromise

- Derived keys rotate via public `nucleus/key.revoke` + `nucleus/key.add` records with a new context version (e.g. `sign/v2`), in one event so a purpose is never left without a key. Versions strictly increase and a public key is never attested twice.
- Rotation limits the damage of a leaked **derived** key. Every version comes from the same seed, so it does not help if the seed itself is compromised.
- A revoked signing key no longer verifies. A cell can still decrypt messages encrypted to its retired encryption keys.
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

### 5.1 Records

Everything a cell writes is a **record**. Whether it is public or private is chosen each time it is written, not fixed by its type.

```
Record { type: "<service>/<name>", ts, refs: [Ref], body: bytes }
Ref    { cell: bytes32, index: uint, hash: bytes32 }
```

| Visibility | Stored | Reaches the journal as |
|---|---|---|
| `private` | full record in the private store | a salted leaf hash inside the next event's `commits` root (§5.4) |
| `public` | full record in the private store index **and** inline in the journal | the record itself, inside the next event's `public` list |

Public records are permanent and replicated with the journal, so they cannot be redacted. Inline bodies are capped at **1 KB**; larger public content is stored as a content-addressed blob owned by the cell and referenced by hash.

### 5.2 Event (one journal block)

```
Event {
  v:           uint            // format version, = 1
  ts:          uint            // creator's claimed time, ms (consensus assigns the real time)
  prev:        bytes32 | null  // hash of event i - 1; null only at genesis
  otherParent: Ref | null      // the peer event this event records hearing from
  commits:     bytes32 | null  // Merkle root of private leaves since the previous event (§5.4)
  public:      [Record]        // public records since the previous event (≤ 8 KB in total)
}
```

- **Self-parent is explicit:** `prev` is the hash of block *i − 1*, so a `Ref` to an event commits to its entire history, as Hashgraph requires. It costs 32 B per event.
- **Signature is Hypercore's:** each append is signed by the journal key, which also signs every public record in the event.
- **No `kind` field:** what an event means comes from its `otherParent` and the types of its public records.
- **Encoding:** `compact-encoding`, in the order below. Decoders must reject any block that does not re-encode to identical bytes (non-minimal integers, trailing bytes, unknown flags, invalid UTF-8).

```
Event:  uint v · uint ts · uint flags · [fixed32 prev] · [Ref otherParent] · [fixed32 commits] · array<Record> public
        flags: bit 0 = prev, bit 1 = otherParent, bit 2 = commits
Ref:    fixed32 cell · uint index · fixed32 hash
Record: string type · uint ts · array<Ref> refs · buffer body

nucleus/genesis body:    string protocol · uint created
nucleus/key.add body:    string purpose · fixed32 publicKey · uint contextVersion
nucleus/key.revoke body: fixed32 publicKey · bool hasReason · [string reason]
```

Other record types have opaque bodies, encoded by the service that owns the type.

- **Event hash** (the value of `Ref.hash`): `BLAKE2b-256("celluler/event/v1" ‖ cell ‖ index as uint64 LE ‖ block)`, over the exact block bytes. Binding the cell and index means one cell's event can never be presented as another's.
- **Validity:** block 0 holds exactly one `nucleus/genesis` record with no parents or commits. `nucleus/genesis` appears nowhere else, `prev` must match, and an `otherParent` must name another cell.

### 5.3 Who creates events, and when

**Only the Nucleus appends events.** Services write records; they never create events, which keeps journal growth under the Nucleus's control and keeps services independent of consensus mechanics. An event is created when:

| Trigger | otherParent | Notes |
|---|---|---|
| Genesis | — | block 0; `public: [nucleus/genesis]` |
| Consensus sync | partner's head event | requested by the ConsensusService through a reserved interface (`nucleus.sync`); carries any pending public records and the `commits` root |
| Revealed receipt (§8.3) | sender's event that carried or committed the message | needs its own event, because an event has only one other-parent |
| Urgent public record | — | the writer asked for immediate publication; rate-limited (6 per minute proposed) |
| Size limit reached | — | pending public records exceed 8 KB |

Otherwise records wait for the next event; with v1 pings at one per minute, that is at most about a minute. Until the private store exists, waiting records are held in memory: they are flushed on a clean stop but **lost in a crash** (§13). A rate-limited urgent record is queued, not rejected.

**Nucleus public record types:**

| Type | Body |
|---|---|
| `nucleus/genesis` | `{ protocol: "celluler/1", created }` |
| `nucleus/key.add` / `nucleus/key.revoke` | `{ purpose, publicKey, contextVersion }` / `{ publicKey, reason? }` |
| `nucleus/edge.reveal` | co-signed public relationship (§8.4) |
| `nucleus/profile` | optional public profile or a commitment to one |
| `nucleus/terminal` | `{ successor? }` — the cell's end, or move to a successor journal |

Other services register their own public types, e.g. `msg/receipt` (§8.3) and `consensus/checkpoint.sig`; public messages use their protocol as their type (§9.3).

### 5.4 Private commitments

```
salt  = H(saltKey, recordSeq)                 // derived, never stored
leaf  = H(salt ‖ encode(Record))              // BLAKE2b-256
event.commits = MerkleRoot(private leaves recorded since the previous event)
```

Private activity (sends, receipts, inbox entries, edges, service state) therefore reaches the journal at the rate events are created, not at the rate messages flow. Inclusion proof size is ⌈log₂ *n*⌉ × 32 B for *n* leaves in one event's batch (1,024 leaves → 320 B). A public record needs no salt or leaf: it is proven by the Hypercore proof of the block that contains it.

### 5.5 Nucleus API

```js
// One registry: owner and schema; visibility is not part of the type
nucleus.registerType({ type: "msg/received", owner: "message", schema })

// One write primitive
nucleus.record({ type, body, refs,
                 visibility: "private" | "public",
                 urgent?,          // public only: publish in an event now (rate-limited)
                 parent? })        // public only, for registered receipt types: own event with this otherParent
  → { seq, leaf? , event? }

nucleus.query({ type, from?, to?, limit? })
nucleus.prove({ seq, disclose: "full" | "leaf" }) → Proof
nucleus.redact({ seq, reason })   // private records only
nucleus.getCellId()

// Reserved for the ConsensusService
nucleus.sync({ peerHead }) → { index, hash, verified }

// Implemented additions
nucleus.getEvent({ index, cell? })
nucleus.query({ cell?, type?, hasOtherParent?, from?, to?, limit? }) → { events, nextIndex }
nucleus.getHead({ cell? }) → Ref
nucleus.getAttestedKeys({ cell? }) → { sign, box, swarm }
nucleus.rotateKey({ purpose, reason? })
nucleus.replicate({ cell, minLength?, timeout? })
nucleus.verifyJournal({ cell? })
nucleus.sign({ message }) · nucleus.verify({ message, signature, cell? })
nucleus.encrypt({ message, cell }) · nucleus.decrypt({ ciphertext })
```

`registerType` takes `receipt: true` for types that may set `parent`. `query` scans journal events; a query over the private store will arrive with it. `verified` says whether a `Ref` could be checked against a local copy of the peer's journal; a `Ref` that contradicts the local copy is rejected.

**Access.** `registerType`, `record`, `sync`, `rotateKey`, `replicate`, `sign`, `verify`, `encrypt` and `decrypt` are Moleculer `protected` actions: callable only within the cell's own node, not through the API gateway or from other nodes on the transporter.

`encrypt` uses a libsodium sealed box to the recipient's attested X25519 key. The sender is anonymous, so a message whose sender matters must also be signed.

## 6. What is public, what is private

| Public (journal) | Private (store) |
|---|---|
| genesis, keys, profile (optional) | message bodies, inbox, receipts |
| sync events (who synced with whom, when) | private relationship edges |
| revealed message receipts and edges | service state |
| public messages (votes, checkpoint signatures, other "transactions") | key material, link secrets, key index |
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

Each sync event commits to the peer's latest event hash, which did not exist before that moment. Every sync event therefore proves its creator held the journal key at that time; T1 needs no separate challenge inside a cluster.

### 7.3 Clone and fork detection

If the journal key is copied, both holders append to the same journal and sign different blocks at the same index. That fork is a self-contained proof of compromise, typically detected within one sync interval because cluster peers replicate the journal continuously. Responses: the consensus layer stops counting the cell (consensus doc §8.5); the owner recovers through a successor journal (§3.4).

## 8. Edges and messages — hybrid privacy

**Decision:** relationships are private by default. A cell may reveal any edge, and a protocol may require specific edges to be revealed as a condition of participation.

### 8.1 Private edges

For each period in which A and B exchanged messages (real traffic only; consensus pings never create edges), each side records a private `identity/edge` record: `{ peer, count, sharedRoot, peerHead }`, where `sharedRoot` is the Merkle root over the hashes of messages exchanged and `peerHead` is the latest peer event seen (a time anchor).

### 8.2 Committed messages (default)

A message's send and receipt are private records, reaching the journal only inside `commits`. The message is still placed in the global order (through the event that commits it) but nothing public links A to B.

### 8.3 Revealed messages

For relationships the parties have made public, the receiver records a public `msg/receipt { from, link, index, bodyHash }` with `parent` set to the sender's event that carried or committed the message. The Nucleus gives it its own event with that `otherParent`, so the receipt is publicly and causally linked to the send.

### 8.4 Co-signed edge reveal

An edge reveals the counterparty's relationship too, so publishing one needs both cells:

```
nucleus/edge.reveal body: { peer, kind, since: Ref, sigs: [selfSig, peerSig] }
```

`kind` is protocol-defined (e.g. `prana/coop.member`, `nadi/vouch`). A protocol may list required kinds; a cell that declines simply cannot participate in it.

## 9. Message service

### 9.1 Scope

The Message service moves messages between cells **reliably**, records sends, receipts and inbox entries through the Nucleus, and dispatches to handlers registered by other services. It defines no message types and depends only on the Nucleus.

A message is addressed to one of three destinations, which decides its transport and visibility:

| Destination | Transport | What the journal holds | Delivery evidence |
|---|---|---|---|
| a cell | sender's link core (§9.3) | private leaf hashes of the send and receipt | signed receipts (§9.5) |
| a topic | sender's topic core (§9.8) | private leaf hashes | optional, per protocol |
| `public` | **the journal itself** (§9.12) | the full message | consensus finality |

A "transaction" is simply a public message: a vote, a checkpoint signature or a ledger entry, defined by the protocol of the service that owns it.

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

A also records a private `msg/sent` record, committed by its next event. The `sig` field lets B, and anyone B shows the message to, verify it apart from A's link core.

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
message.register({ protocol: "prana-vote/1", handler: "governance.onVote" })  // also registers the type with the Nucleus
message.link({ to })                                         → { status }     // handshake
message.send({ to: cellId | { topic } | "public", protocol, body, urgent? }) → { id }
message.status({ id })   // "sent" | "delivered" | "processed"   (cells)
                         // "pending" | "in-event" | "final"      (public)
```

### 9.12 Public messages

- `message.send({ to: "public", … })` calls `nucleus.record({ type: protocol, body, visibility: "public", urgent })`; the message appears inline in the sender's next event (§5.3). The journal's Hypercore signature covers it, so no separate `sig` is needed.
- Public messages are not pushed to anyone. Any cell that replicates the sender's journal (cluster peers, followers, anyone computing shared state) sees them in the global order and dispatches them to the handler registered for their protocol.
- A public message's time is the consensus time of the event that contains it, so public messages from anywhere in the network are totally ordered.

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
- `hyperdht/testnet` for an in-process DHT. Jest maps `hyperdht` to a guard that throws unless every bootstrap node is loopback, so no test can reach the public DHT.
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
| `generateCellUUID` in block 0 | Cell ID = journal Hypercore key; block 0 = `genesis` event |
| `write` stringifies JSON into a `valueEncoding: 'json'` core (double-encoded) | Only the Nucleus appends events; services call `record` |
| Any caller may write arbitrary data to any core | Writes only through the Nucleus with registered types |
| `memory` storage default | Keep for tests; warn that identity is not persistent |
| `MessageService` depends on `identity` and `consensus`, hard-codes CHAT/AUTH/TX/POST/QUERY/EXEC | Depends on `nucleus` only; link-based delivery; types become registered protocols |
| `MessageService` is CommonJS in an ESM package | Rewrite as ESM `BaseService` |
| No Hyperbee/RocksDB private store | Add a mutable encrypted private store; `sodium-universal`, `protomux`, `compact-encoding` become direct dependencies |

## 13. Open questions

1. ~~**Encoding**~~ Resolved: compact-encoding (§5.2).
2. ~~**Public name at genesis**~~ Resolved: no name at genesis; use `nucleus/profile`.
3. **Sync rate vs journal growth:** 1/min costs ~131 MB/year per cell; is 1/5 min (~26 MB) enough for consensus latency?
4. **Phones:** should mobile cells delegate journal and storage duties to a home node?
5. **Root key recovery:** multi-signer manifest vs successor journal.
6. **Threat model:** adversaries each identity tier must resist; thresholds for T3a/T3b.
7. **Edge kinds registry:** where protocol-defined edge kinds are named and versioned.
8. **ZK proofs:** which T4 claims merit circuits first.
9. **Backup parameters:** default k/n, chunk interval, AONT-RS default.
10. **First contact defaults:** introduction only, or a public request topic by default?
11. **Blind replica selection:** custodians, cluster peers, or both.
12. **Public record limits:** 1 KB inline per record and 8 KB per event proposed; larger bodies referenced by hash.
13. **Urgent events:** default rate limit (6 per minute proposed) and who may use the flag.
14. **Post-quantum migration:** when to add hybrid PQ keys, and how a journal whose own key is Ed25519 survives a break of Ed25519.
15. **Durable pending records:** queued public records should be persisted (likely in the private store) so a crash cannot lose them.
16. **Timestamp rule:** the Nucleus writes strictly increasing `ts`, but verifiers do not yet enforce it. Should Hashgraph require it?
17. **Type ownership:** `owner` is recorded but not checked against the calling service; all callers are currently local.
