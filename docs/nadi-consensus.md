# NADI Consensus — Hierarchical Hashgraph over Cell Journals

**Status:** Proposal v0.2 (2026-11-18) · **Layer:** NADI (L1) · **Builds on:** [NADI Journal, Identity & Messaging](nadi-journal-identity.md)

This proposal describes how Celluler orders every cell's events across the whole network, and how faithful participation in that process becomes evidence of identity. It is a **proposal**: the hierarchical construction in §5–§6 is new, not part of the published Hashgraph algorithm, and needs a correctness argument and simulation before it is relied on (§14).

### Changes from v0.1
- Consensus runs on **topological clusters** assigned by the protocol, not on commons. Commons (co-ops, decision circles, markets) are PRANA-layer organizations that *use* the global order.
- **Events are journal blocks**; there are no separate event cores.
- v1 drives consensus with **ping syncs** to verifiably random partners; syncing on real traffic is a later upgrade (§12).
- Cross-cluster order uses **causally adjusted consensus timestamps with watermarks** (§6), replacing ordering by checkpoint position, which can produce cycles.
- All parameters are expressed symbolically (§3) with starting values.

## 1. Hashgraph in brief

Hashgraph (Baird, Swirlds 2016) reaches asynchronous Byzantine fault-tolerant consensus among a **fixed, known set of members**, safe while honest members hold more than 2/3 of the weight.

- **Events.** Each member creates signed events. An event contains a hash of the member's previous event (*self-parent*), a hash of the last event received from the peer it just synced with (*other-parent*), a timestamp, and optional transactions.
- **Gossip about gossip.** Members sync with each other; each sync produces a new event that records it. The resulting DAG is a record of who heard what, from whom, and when.
- **Virtual voting.** Every member holds the same DAG, so each computes how every other member *would* vote without any vote messages. This yields rounds, famous witnesses, and a **consensus order** of all events.
- **Consensus timestamp.** Each event's timestamp is the median of the times members first received it, which is fair as long as honest members' clocks are roughly right.

In Celluler, **a Hashgraph event is a journal event** (spec §5.2): the self-parent is the previous journal block, committed to by the event's `prev` hash, the other-parent is the event's `otherParent`, and the signature is the journal's Hypercore signature. A fork in a journal is exactly Hashgraph's equivocation.

## 2. Prior art: what Hashgraph and Hedera do not provide

- The Hashgraph algorithm defines consensus for **one flat membership**. It has no notion of nested groups.
- Hedera runs **one flat network**. Its mainnet consensus nodes are permissioned and operated by the Hedera Governing Council; mirror nodes store history but do not participate in consensus.
- Hedera's node count is in the tens, not thousands. Its plan has been to expand to hundreds of permissioned nodes and eventually permissionless ones.
- Sharding Hedera is a research topic, not a production feature. A September 2025 paper proposes a hybrid model with local committees and a global coordinator, using random node assignment to keep any single entity from dominating a shard, and periodic reconfiguration.

Related work in sharded BFT (for example Elastico, OmniLedger and RapidChain) uses the same ingredients: random assignment to committees, periodic reshuffling, and cross-shard coordination. What is specific to Celluler is ordering *every cell's own signed journal* globally, with cross-cluster messages as causal links, which is why §5–§6 need their own correctness work.

## 3. Parameters

| Symbol | Meaning | Starting value |
|---|---|---|
| *N* | target cells per level-0 cluster | 100 (split above 2*N*, merge below *N*/2) |
| *M* | child units per hyper-cluster at each level ≥ 1 | 100 |
| *k* | representatives per child in its parent instance | 3 |
| *L* | number of levels | ⌈log(cells / *N*) / log *M*⌉ + 1 |
| *f*₀, *f*ℓ | sync (ping) rate per participant at level 0, level ℓ | 1/60 s |
| *C*ℓ | checkpoint interval at level ℓ | 1 h (to be tuned; §9) |
| *R* | rounds after checkpoint that others' events are kept | to be tuned |
| *s* | event size | ~170 B (+ ~80 B Hypercore tree per block) |

Coverage is *N* · *M*^(*L*−1): with *N* = *M* = 100, three levels cover 10⁶ cells. With *N* = 12, covering 10⁶ cells needs six levels.

## 4. Level-0 clusters

### 4.1 What a cluster is

A cluster is a set of about *N* cells that run one Hashgraph instance together. Clusters are **topology, not social organization**: a cell's cluster says nothing about who it may talk to. Cells message any cell in the network (spec §9); messages that cross clusters create causal links that the hierarchy resolves (§6).

### 4.2 Assignment

- On joining the network, a cell is assigned to a cluster by **verifiable randomness** from the current top-level checkpoint, so an attacker cannot choose its cluster and its share in any cluster tracks its share of the network.
- Assignment may be weighted by measured network latency, but not by social trust: letting cells pick clusters by trust would let an attacker concentrate in one.
- Clusters split above 2*N* and merge below *N*/2; a fraction of cells is **reshuffled** each period to resist adaptive corruption (an attacker targeting the members of one cluster over time).

### 4.3 v1 syncs: verifiable random pings

- Each cell syncs at rate *f*₀. Its partner for the next sync is `members[H(lastEventHash) mod |members|]`, so anyone can check that it synced with whom it was supposed to.
- Syncs are **two-way**: both cells exchange missing journal blocks (Hypercore replication) and each asks its Nucleus to append a sync event (spec §5.3) whose `otherParent` is the other's latest event.
- Cluster members replicate all members' journals for the duty window (spec §4.3).

### 4.4 Roster, liveness and offline cells

Hashgraph needs more than 2/3 of the weight **online** to make progress. Cells that go offline (phones asleep, laptops closed) would stall a cluster, so:

- The cluster's **active roster** is itself consensus state; a cell missing *T*off of syncs is suspended (weight 0) by a deterministic rule, and resumes by syncing again.
- Weight is equal among active members.
- Safety requires more than 2/3 of active weight to be honest; liveness requires more than 2/3 of active weight to be online.

### 4.5 Members' events from outside the cluster

An event in a cluster's DAG may have an `otherParent` in another cluster (a cross-cluster sync or revealed message). **Projection rule:** for virtual voting, such a parent is treated as absent, since its creator is not a member; it is kept as a causal reference for global ordering (§6). Whether Hashgraph's safety and liveness proofs hold unchanged for events whose other-parent is outside the membership is the first correctness question to settle (§14).

### 4.6 Local order and checkpoints

The cluster's Hashgraph produces a **local consensus order** with consensus timestamps. Timestamps are made monotone along that order (*t*′ᵢ = max(*t*ᵢ, *t*′ᵢ₋₁ + 1 ns)) so that "all of this cluster's events before time *T*" is well defined once its order passes *T*.

Every *C*₀, the cluster finalizes a checkpoint:

```
Checkpoint {
  level: 0, cluster, seq, prev
  window: { fromTime, toTime }
  orderRoot:      bytes32   // Merkle root of (cell, index, hash, t', g) in local order (§6.2)
  pending:        [event]   // events whose g awaits a foreign parent; finalized in a later checkpoint
  crossLinks:     [{ event, foreignParent }]   // events with parents outside the cluster
  rosterRoot, statsRoot, evidenceRoot
  reps:           [cellId]  // representatives for the next period (§5.2)
}
```

It is final when members holding more than 2/3 of active weight have signed it (signatures travel as public `consensus/checkpoint.sig` messages, spec §9.12). With *N* = 100 that is 67 signatures, ~6.6 KB per checkpoint without aggregation.

## 5. Higher levels

### 5.1 Hyper-clusters

At level ℓ ≥ 1, a hyper-cluster groups *M* child units (clusters at level 0, hyper-clusters above). It runs a parent Hashgraph instance whose purpose is to **agree on the children's finalized checkpoints** and on everything that spans children: roster changes, assignment randomness, watermarks (§6.2), cross-child state, and misbehavior.

### 5.2 Representatives, not all cells

If every cell of a hyper-cluster participated in the parent instance, each would process *N* · *M* members' events and the hierarchy would not scale. The parent instance therefore has **k representatives per child**, *M* · *k* members in total (300 at the starting values):

- Representatives are chosen by **sortition** each period: the *k* active members with the smallest `H(checkpointHash ‖ cellId)` in the child's latest checkpoint. Anyone can verify the choice.
- A representative cannot forge its child's checkpoint (it carries the child's > 2/3 signatures); it can only withhold it, so *k* ≥ 2 and any representative may submit any child's checkpoint.
- Weight is equal per child, split among its live representatives.
- A representative uses its **one journal** for both levels: its events count as members' events in both its cluster and the parent instance, with parents from the other level treated per the projection rule (§4.5).

### 5.3 Parent checkpoints

Each parent instance finalizes its own checkpoints (signed by > 2/3 of representative weight), committing to the set of child checkpoints accepted, the watermark (§6.2), roster and assignment changes, and evidence. It does not need to hold every event: the global order is implicit in each event's global time *g*, which its own cluster's checkpoint commits to. Its parent does the same, up to level *L* − 1.

## 6. Global order

The goal: for any two events anywhere, the system can assert which came first, e.g. that cell A's message to B preceded cell C's message to D. The order must respect causality (if one event is an ancestor of another, it comes first) and must be the same for everyone.

### 6.1 Why checkpoint position is not enough

A first idea is to order children's checkpoints in the parent's consensus order and concatenate their local orders. That fails: each cluster's local order is consistent only with the ancestry it can see. If an event in cluster C₁ descends from another C₁ event through a path that leaves and re-enters the cluster (C₁ → C₂ → C₁), C₁ can order the two the wrong way round, and concatenation then produces a cycle with C₂'s order.

### 6.2 Proposed rule: causally adjusted timestamps with watermarks

Each event *e* gets a **global time** *g*(*e*):

```
g(e) = max( t′(e),  g(selfParent(e)) + ε,  g(otherParent(e)) + ε )
```

- *t*′(*e*) is its monotone local consensus time (§4.6); ε is 1 ns.
- *g* strictly increases along every parent edge, so sorting by (*g*, cell ID, index) is always a valid causal order, with no cycles.
- Between causally unrelated events in different clusters, order follows consensus time, i.e. the median of honest clocks, so it is fair to clock precision rather than to checkpoint granularity.

**Watermarks.** A position in the global order is final only when no event with a smaller *g* can still appear. Because *g*(*e*) ≥ *t*′(*e*) and local times are monotone, once every cluster under a parent has finalized a checkpoint covering time *W*, every event with *g* < *W* is known. The parent records *W* (the minimum across children). Comparing any two events below *W* then needs only their *g* values, each proven by a Merkle path from its cluster's checkpoint.

**Late clusters.** A cluster that misses its checkpoint deadline would hold back everyone's watermark. The parent may declare it late by consensus; that cluster's late events then get *g* = max(*g*, time of the parent's decision), so lateness delays only the late cluster's events.

**Dependencies.** An event whose foreign parent is not yet final has a provisional *g*; clusters publish final values as dependencies resolve. Chains alternating between clusters resolve in order because ancestry is acyclic.

### 6.3 Local order vs global order

The local order of a cluster may differ from the global order in the rare cases where cross-cluster causality forces it. Services must use the **global order** for any state that spans clusters, and may use the faster local order for state confined to one cluster.

### 6.4 Where messages sit in the order

| Message kind (spec §8) | Position in the global order |
|---|---|
| Revealed (public `msg/receipt` in an event linked to the sender's event) | Exact: send < receipt by causality |
| Public (`to: "public"`) | Exact: the consensus time of the event that contains it |
| Committed (private) | The interval between the sender's event that commits the send and the receiver's event that commits the receipt; provable on disclosure |

### 6.5 Finality latency

Local finality takes several Hashgraph rounds, and each round needs information to spread through the cluster, roughly log₂ *N* sync intervals. At *N* = 100 and *f*₀ = 1/60 s that is likely **tens of minutes** per local finality, before adding *C*₀ and each parent level. Faster finality needs a higher sync rate, which grows every cell's journal proportionally (§9). This trade-off is the main thing the C1–C2 tests must measure.

## 7. Cross-cluster messages

A cross-cluster message costs the same transport as any message (spec §9). For ordering:

- The sender's and receiver's events are ordered in their own clusters.
- If the receipt is revealed, the receiver's event has a foreign `otherParent`; its cluster lists it in `crossLinks`; the parent's global order places it after the send.
- If the receipt is committed, ordering is the interval rule in §6.4.

The receiver's cluster needs only the sender's single event and its signed journal length to verify the link, not the sender's cluster DAG.

## 8. Consensus and identity

### 8.1 Participation stats

Per cell, per checkpoint window, computed identically by all cluster members:

| Stat | Measures |
|---|---|
| Syncs completed vs expected at *f*₀ | liveness |
| Syncs with the assigned random partner | protocol faithfulness (not choosing partners) |
| Rounds with a witness; famous witnesses | participation in ordering |
| Median delay before others' events are seen | timeliness |
| Checkpoints signed; representative terms served | responsibility |
| Equivocations (forks) | dishonesty: any > 0 is disqualifying |

Stats are cumulative, so the latest checkpoint summarizes a cell's whole history.

### 8.2 Time anchors (T2)

Every event a cell creates receives a consensus timestamp agreed by > 2/3 of its cluster. A cell's age and continuity are therefore attested by its cluster, not self-asserted.

### 8.3 Continuous possession (T1)

Every `sync` commits to the partner's latest event, so each proves the cell held its journal key at that moment (spec §7.2).

### 8.4 Participation attestation (T3b)

"Cell X has participated faithfully since checkpoint *k*, with stats S and no equivocation" is proven by a finalized checkpoint (> 2/3 signatures) plus the Merkle path of X's stats line, ~6.6 KB at *N* = 100 (~300 B with aggregate signatures). Faking it means sustaining verifiably random syncs observed by a supermajority over time.

### 8.5 Misbehavior

A fork in a journal is self-contained proof. Once in consensus order, the cell's weight drops to 0 and the proof enters `evidenceRoot`; it can be shown to anyone as a negative attestation. Random-partner violations are provable from the cell's own events.

### 8.6 Sybil resistance

Hashgraph assumes the membership is not Sybil-controlled; it provides no Sybil resistance itself. Random assignment ensures an attacker's share in a cluster tracks its share of the network, so the barrier must be at **network admission**. Options (open question §14): vouching through revealed edges (T3a), T3b attestations from existing cells, proof-of-personhood integrations, or a cost to join. Social trust shapes links, edges and commons, not cluster membership.

## 9. Costs

| Cost | Formula | *N* = *M* = 100, *k* = 3, *f* = 1/60 s |
|---|---|---|
| Bandwidth per cell (level 0) | *N* · *f*₀ · *s* | ~283 B/s |
| Extra bandwidth per representative | *M* · *k* · *f*₁ · *s* + *M* · (checkpoint)/*C*₀ | ~850 B/s + ~180 B/s |
| Own journal growth | *f*₀ · (*s* + 80 B) | ~131 MB/year |
| Cluster DAG held (duty window, 6 h) | *N* · *f*₀ · *s* · window | ~6 MB |
| Own cluster's checkpoints kept | (200 B + ⌈2*N*/3⌉ · 96 B) / *C*₀ | ~58 MB/year (~3 MB aggregated) |

Raising *f*₀ to 1/10 s cuts round time ~6× but raises journal growth to ~790 MB/year per cell. Lowering it to 1/300 s gives ~26 MB/year but slower finality.

## 10. What is recorded where

| Data | Where | Kept |
|---|---|---|
| Own events (syncs, txs, keys, revealed messages) | own journal | forever |
| Cluster members' events | replicated journals | duty window: until checkpoint + *R* rounds |
| Own cluster's finalized checkpoints | private store | forever |
| Own stats line + path | private store | forever |
| Parent-level events and checkpoints | representatives' storage | during term + duty window |
| Fork proofs involving this cell | private store | forever |

## 11. Security sketch

**Cluster size.** A cluster of *N* tolerates ⌊(*N* − 1)/3⌋ faulty members. If a fraction *p* of all cells is malicious and assignment is random, the chance that a given cluster exceeds its tolerance is:

| *N* | Tolerates | *p* = 10% | *p* = 20% | Expected failing clusters in 10⁶ cells (*p* = 20%) |
|---|---|---|---|---|
| 12 | 3 | 2.6 × 10⁻² | 2.1 × 10⁻¹ | ~17,000 |
| 25 | 8 | 4.6 × 10⁻⁴ | 4.7 × 10⁻² | ~1,900 |
| 50 | 16 | 3.8 × 10⁻⁶ | 1.4 × 10⁻² | ~290 |
| 100 | 33 | 7.0 × 10⁻¹¹ | 7.4 × 10⁻⁴ | ~7 |
| 200 | 66 | 1.5 × 10⁻¹⁹ | 5.3 × 10⁻⁶ | ~0 |

*N* = 100 is a sound start at 10% adversarial share but not at 20%, which argues for strong network admission (§8.6), reshuffling, and parent-level detection of failed clusters (conflicting checkpoints from one cluster are provable at the parent).

**Parents.** Representatives are a random sample of children's members, so a parent instance of *M* · *k* = 300 behaves like a large cluster. Withholding is mitigated by *k* ≥ 2 and any-representative submission.

**Decision circles of ~12 people** are PRANA-layer commons whose votes are ordered by this global order; they do not need to be consensus clusters.

## 12. Upgrade path: syncs on real traffic

Once the ping baseline is measured, messages between cluster members can double as syncs (the receipt event's `otherParent` is the sender's event), with pings only as a fallback when the DAG is not mixing (no round progress within a timeout, or too few distinct partners). Safety does not depend on how partners are chosen; mixing speed does. Revealed-message syncs fit directly; committed messages cannot serve as syncs without revealing the link, so pings remain for private traffic.

## 13. Implementation plan

1. **C1 — Journals as events, DAG sync:** *N* cells on `hyperdht/testnet`, two-way syncs, verifiable partners; measure bandwidth and journal growth against §9.
2. **C2 — Virtual voting:** rounds, witnesses, fame, local order and timestamps, with deterministic DAG test vectors (ideally cross-checked against the Hiero reference implementation); sweep *N* and *f*₀ for finality latency.
3. **C3 — Checkpoints, roster, liveness:** signing and finality, suspension of offline cells, fork proofs.
4. **C4 — Two-level hierarchy:** representatives, parent instance, cross-links, causally adjusted global order and watermarks; adversarial tests for cycles and late clusters.
5. **C5 — Identity integration:** participation stats, T3b proofs.
6. **C6 — Scale and reshuffling:** split/merge, reshuffles, three levels in simulation.

The reference implementation (Hiero, under Linux Foundation Decentralized Trust) is Java under Apache 2.0, which includes a patent licence; Celluler needs a JavaScript implementation on the Holepunch stack.

## 14. Open questions

1. **Projection rule (§4.5):** do Hashgraph's safety and liveness proofs hold when some events' other-parents are outside the membership?
2. **Global order (§6.2):** prove that causally adjusted timestamps with watermarks give a total order that is final, causal and fair; simulate adversarial clusters skewing their clocks.
3. **Sync rate vs finality vs journal growth:** choose *f*₀ from C2 measurements.
4. **Network admission:** which Sybil barrier(s) gate joining (§8.6).
5. **Randomness:** is a checkpoint hash an adequate beacon for assignment and sortition, or is a dedicated beacon needed?
6. **Reshuffle rate** vs the stability of clusters.
7. **Latency-weighted assignment:** does it create exploitable concentration?
8. **Aggregate signatures** (BLS or similar) for checkpoints.
9. **Clock skew:** how much can a minority skew consensus times within an honest cluster, and what does that do to cross-cluster fairness?
