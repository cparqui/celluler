# Celluler

A decentralized peer-to-peer protocol for defining cooperative economic mechanisms, governing common resources, and creating publicly owned and operated AI systems. Participants (people or AI agents) run nodes called "cells".

## Overview

Celluler is a distributed system that combines:
- Hypercore Protocol (Holepunch / Pear stack: Hypercore, Corestore, Hyperswarm) for signed append-only journals and P2P replication
- Hashgraph consensus algorithm for maintaining shared commons state
- Moleculer microservices framework for internal cell architecture
- Ed25519 / X25519 cryptography for decentralized identity and private messaging

Each cell in the network is a self-contained unit that can:
- Run AI model inference
- Host and share datasets
- Participate in model training
- Maintain an immutable transaction log
- Participate in global state consensus

## Architecture

Each cell runs a Moleculer microservices cluster. The protocol is built in three layers:

| Layer | Name | What it is |
|---|---|---|
| L1 | **NADI** — Network of Agents with Decentralized Identity | P2P network: cells, signed Hypercore journals, decentralized identity and trust, messaging, commons engine (Hashgraph consensus) |
| L2 | **PRANA** — Public Resource Alliance Network Architecture | Economy and governance: PRANA token, quadratic funding and voting, co-op and private commons |
| L3 | **BUDDHI** — Builder-owned, Universally Distributed, Democratically Hosted Intelligence | AI commons: compute, data, model and agent commons |

The NADI foundation (journal, identity, messaging) is specified in [docs/nadi-journal-identity.md](docs/nadi-journal-identity.md).

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/cparqui/celluler.git
cd celluler

# Install dependencies
npm install

# Start a cell
npm run start
```

### Configuration

Cells are configured with YAML files in `config/` (validated against `schemas/celluler_config.schema.json`). Files can inherit with `extends` and reference environment variables as `${VAR}`:

```bash
# Start with the local development profile
npm run start:dev    # = node src/cli.js start -c config/local.config.yaml
```

Under the NADI spec, a cell's identity is derived from its persisted root seed, so use `file` storage for any cell that should keep the same identity across restarts; `memory` storage is for tests. See [docs/configuration.md](docs/configuration.md).

## Documentation

View full project documentation at: [https://cparqui.github.io/celluler](https://cparqui.github.io/celluler)

## Contributing

We welcome contributions! Please see our [Contributing Guide](docs/contributing.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 