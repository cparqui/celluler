# NADI Commons Engine — Consensus & Identity

**Status:** Proposal v0.1 (2026-11-17) · **Layer:** NADI (L1) · **Builds on:** [NADI Journal, Identity & Messaging](nadi-journal-identity.md)

This proposal describes how Celluler reaches consensus within a commons using the Hashgraph algorithm, and how faithful participation in that consensus becomes evidence for a cell's identity. The core idea: **the same gossip that orders a commons' transactions is a dense, signed record of who interacted with whom and when — and that record is exactly what identity verification needs.**

## 1. How Hashgraph gossip works (and what it costs)

"Gossip about gossip" does not mean a cell announces every message it receives to all of its peers; that would cost O(N²) messages per message. Instead:

1. A cell repeatedly picks a peer at random and **syncs**: it sends the events the peer has not seen.
2. After each sync the receiving cell creates **one new event** containing:
   - the hash of its own previous event (*self-parent*),
   - the hash of the last event it received from the peer (*other-parent*),
   - a timestamp,
   - any transactions it wants to submit (for example, hashes of messages it has received).
3. Those parent hashes form a DAG. Every cell eventually holds the same DAG, so each can compute, locally and without exchanging any votes, how every other cell *would* vote (**virtual voting**). This yields a total order of events and a **consensus timestamp** for each: the median of the times members first received it.

So the "I received message *z* from cell *x* at time *t*" announcements are carried as transactions inside events, batched into one event per sync. Who learned what, from whom, and when is encoded in the DAG itself.

### 1.1 Cost model

An event with no transactions is ~170 B (other-parent reference ~68 B, timestamp 8 B, Hypercore signature and tree hash ~96 B). With *N* members each syncing at rate *f* per second, *N·f* events are created per second and every member must receive all of them:

| Members N | Bandwidth per member at f = 1/s | at f = 1/60 s (idle heartbeat) |
|---|---|---|
| 10 | 1.7 KB/s | 28 B/s |
| 50 | 8.5 KB/s | 142 B/s |
| 200 | 34 KB/s | 567 B/s |
| 1,000 | 170 KB/s | 2.8 KB/s |

Per-member cost grows linearly with commons size (quadratically network-wide). Two consequences:

- **Consensus is scoped to a commons, not global** (§2).
- **Sync rate is adaptive**: high while transactions are pending, a slow heartbeat when idle. At N = 50, retaining every event would cost ~734 MB/day at f = 1/s but ~12 MB/day at idle rate; in practice the DAG is pruned after checkpoints (§5), so only checkpoints are kept long term.

## 2. Commons

A **commons** is a consensus group: a co-op, a PRANA market, a BUDDHI data or compute commons, a neighborhood. Each commons has:

| Parameter | Example default |
|---|---|
| `commonsId` | hash of the genesis transaction (founding members + parameters) |
| Membership and weights | founding members, equal weight |
| Admission rule | consensus vote, ≥ 2/3 weight; may require identity evidence (§6.4) |
| Weight policy | `equal` (one member, one vote) — see §6.5 |
| Sync rate | adaptive, 1/s active, 1/60 s idle |
| Checkpoint interval | every *C* rounds, targeting ~1 h |
| Privacy | `open` (anyone may replicate events) or `members` (events encrypted with a commons key) |

Practical size is tens to low hundreds of members. Larger communities federate (§7).

## 3. Events as Hypercores

Each member's chain of events in a commons is **its own Hypercore** (an *event core*), keyed by `H(seed, "celluler/commons/v1" ‖ commonsId)`:

- **Self-parent is implicit**: event *i* is block *i*; its self-parent is block *i − 1*.
- **Signatures are Hypercore's**: every append is signed by the event core's key, so events need no separate signature field.
- **Sync is Hypercore replication**: members replicate each other's event cores on a commons topic; Hypercore already sends exactly the blocks the peer is missing, which is the Hashgraph sync step.
- **Equivocation is a fork**: a cell that signs two different blocks at the same index has produced a self-contained cryptographic proof of misbehavior (§6.3).

Event block body:

```
Event {
  otherParent: { core: bytes32, index: uint, hash: bytes32 }
  ts:          uint            // creator's claimed time
  txs:         [Tx]            // may be empty
}

Tx = MessageRef { id, from, protocol, bodyHash }     // a message this cell received
   | Submit     { type, body }                        // a commons-level transaction
   | Sig        { checkpoint: bytes32 }               // checkpoint signature (§5)
   | Anchor     { epoch, root }                       // this cell's own journal epoch root (§6.2)
```

Event-core keys are **not** attested in the public journal (that would publish commons membership). A cell joins by sending a join request, signed with its root key and carrying its event-core key, to existing members over the message service; membership becomes known to the commons only.

For `members`-privacy commons, event cores are encrypted with the commons key. Because a Hypercore's encryption key is fixed, removing a member starts a new **era** with fresh event cores under a new key.

## 4. Messages and consensus

- Commons-wide messages are sent with `message.publish({ topic: commonsId, … })` as defined in the messaging spec.
- A member that receives one records the usual receipt and includes a `MessageRef` in its next event.
- The message's **consensus timestamp** is that of the first event in consensus order that references it. This replaces self-asserted timestamps for anything that happened inside a commons.
- Commons-level state changes (votes, membership, ledger entries) are `Submit` transactions whose `type` is owned by the service that registered it (PRANA, BUDDHI, Identity), following the same syntax/semantics split as the base layers.

## 5. Checkpoints

Every *C* rounds, each member computes deterministically from the consensus order:

```
Checkpoint {
  commonsId, round, era
  prev:           bytes32      // previous checkpoint hash
  stateRoot:      bytes32      // commons state after this round
  membershipRoot: bytes32      // members and weights
  statsRoot:      bytes32      // participation stats per member (§6.1)
  evidenceRoot:   bytes32      // misbehavior proofs accepted this window
}
```

Members sign the checkpoint hash with `Sig` transactions; it is **final** once signatures from > 2/3 of the weight appear in consensus order. A finalized checkpoint is a compact, portable statement that an outsider can verify by following the checkpoint chain from genesis (each checkpoint fixes the membership and weights that sign the next).

After finality, events older than the last *R* rounds can be pruned by everyone; the checkpoint carries everything needed going forward.

## 6. Consensus and identity together

### 6.1 Participation stats

Per member, per checkpoint window, computed identically by every member from the DAG:

| Stat | Measures |
|---|---|
| Events created vs expected for sync rate | liveness |
| Rounds with a witness; famous witnesses | substantive participation in ordering |
| Median delay before other members' events are seen by this member's events | gossip timeliness |
| Distinct sync partners (count only) | breadth of interaction |
| Messages first referenced (`MessageRef` earliest in order) | contribution / relaying |
| Checkpoints signed | responsibility |
| Equivocations | dishonesty (any > 0 is disqualifying) |

Stats are cumulative (lifetime totals plus the current window), so the latest checkpoint alone summarizes a member's history.

### 6.2 Better time anchors (T2)

A member includes `Anchor { epoch, root }` transactions for its own journal epochs. The commons then gives each of the cell's epoch roots a consensus timestamp agreed by > 2/3 of the weight — a much stronger continuity proof than pairwise anchors.

### 6.3 Misbehavior evidence

Two signed blocks at the same index of one event core are a fork proof. Any member that sees one submits it; once in consensus order, the commons' rules apply deterministically (default: weight set to 0, removal at next checkpoint) and the proof enters `evidenceRoot`. A fork proof is self-contained, so it can be shown to anyone outside the commons as a negative attestation.

### 6.4 New identity tier: commons attestation

The identity tiers in the messaging spec (§7) gain a communal tier between pairwise social proof and selective claims:

| Tier | Claim | Evidence |
|---|---|---|
| T3a Pairwise social proof | "X has real relationships" | Edge attestations (messaging spec §8) |
| **T3b Commons attestation** | "X has been a member of commons C since checkpoint *k*, with participation S, and no misbehavior" | Finalized checkpoint (> 2/3 weight signatures) + Merkle path of X's stats line in `statsRoot` |

T3b is stronger than T3a because faking it means sustaining faithful participation, observed by a supermajority of a commons, over time. Proof size: one checkpoint header (~200 B) + signatures (≈ 96 B × signers; ~3.3 KB for 34 of 50 members) + a stats path (~32 B × log₂ N). Aggregate signatures can shrink this later.

Commons membership is itself an edge kind. Under the hybrid edge model, a commons may require members to reveal it (messaging spec §8.4); otherwise membership stays private and the cell discloses T3b proofs only to verifiers it chooses.

Gossip also feeds pairwise edges automatically: each sync with a peer is an interaction, so the per-epoch `identity/edge` records (messaging spec §8.1) can be derived from sync history.

### 6.5 Weights and Sybil resistance

Hashgraph is safe while honest members hold more than 2/3 of the weight. It provides no Sybil resistance of its own, which is where identity comes in:

- **Admission** is the Sybil barrier: a commons decides who joins, and may require identity evidence (T3a vouches from existing members, T3b attestations from other commons).
- **Default weight policy is `equal`**, matching the co-op principle of one member, one vote.
- Optional policies: tenure- or participation-weighted with a cap, or delegated. Token-stake weighting is never a default; a PRANA commons may choose it explicitly.

The loop: identity gates and weights consensus membership; faithful consensus participation produces the strongest identity evidence.

## 7. Federation

A cell can belong to many commons. Commons can anchor each other by including other commons' finalized checkpoint hashes as transactions, producing a web of mutually anchored commons. A network-wide PRANA ledger could later be a commons whose members are delegates of other commons. This is out of scope for the first implementation.

## 8. Storage, retention and backup

| Data | Where | Retention class |
|---|---|---|
| Own event core | event core (shared with commons) | `window`: pruned after checkpoint + *R* rounds |
| Other members' event cores | replicated locally | `window`: same |
| Finalized checkpoints (latest + one per day) | private store, `consensus/checkpoint` | `permanent` (~4 KB each ≈ 1.5 MB/year per commons) |
| Own stats line + Merkle path | private store, `consensus/participation` | `permanent` |
| Misbehavior proofs involving this cell | private store, `consensus/evidence` | `permanent` |
| Commons message receipts | private store, `msg/received` (+ consensus timestamp) | per protocol |
| Public journal | nothing commons-specific by default | — |

Private records are committed to the public journal through ordinary epochs and backed up through the private-store backup protocol (messaging spec §10).

## 9. Implementation plan

The reference implementation (Hiero, under Linux Foundation Decentralized Trust) is Java and Apache 2.0, which includes a patent licence; Celluler needs a JavaScript implementation on the Holepunch stack.

1. **C1 — Event cores and DAG sync:** N cells on `hyperdht/testnet` replicate event cores; measure bandwidth against §1.1.
2. **C2 — Virtual voting:** rounds, witnesses, fame, consensus order and timestamps; validate with deterministic DAG test vectors (ideally cross-checked against Hiero on the same DAG).
3. **C3 — Checkpoints and membership:** checkpoint signing and finality, admission transactions, fork proofs.
4. **C4 — Identity integration:** participation stats, T3b proofs, epoch-root anchoring, edges from sync history.
5. **C5 — Private commons and federation:** encrypted event cores, eras, cross-commons anchoring.

Autobase (Holepunch's multi-writer causal DAG over Hypercores) is worth evaluating as plumbing for C1, though it is not designed for Byzantine members, so virtual voting would still sit on top.

## 10. Open questions

1. **Weight policy defaults** beyond `equal`, and how weights change with participation.
2. **Admission evidence:** which identity tiers a commons should require by default.
3. **Checkpoint interval and *R*:** proof freshness vs storage.
4. **Stats privacy:** are distinct-partner counts and timeliness too revealing even within a commons?
5. **Signature aggregation** (BLS or similar) to shrink T3b proofs.
6. **Era rotation cost** for `members` commons with frequent membership changes.
7. **Federation semantics:** what anchoring between commons should mean for trust.
