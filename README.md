# Celluler

A decentralized AI agent ecosystem built on peer-to-peer protocols, where nodes (called "cells") collaborate to run AI models, host datasets, and provide training feedback in a distributed manner.

## Overview

Celluler is a distributed system that combines:
- DAT Protocol for distributed data storage and versioning
- Hashgraph consensus algorithm for maintaining global state
- Moleculer microservices framework for internal cell architecture
- P2P networking for cell-to-cell communication

Each cell in the network is a self-contained unit that can:
- Run AI model inference
- Host and share datasets
- Participate in model training
- Maintain an immutable transaction log
- Participate in global state consensus

## Architecture

The system is built in layers:

1. **Cell Layer**: Individual nodes in the network, each running a Moleculer microservices cluster
2. **P2P Layer**: DAT protocol for data distribution and Hashgraph for consensus
3. **Service Layer**: Internal cell services for specific functionalities
4. **AI Layer**: Model execution and training capabilities

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/celluler.git
cd celluler

# Install dependencies
npm install

# Start a cell
npm run start
```

### Configuration

Create a `config/default.json` file with your cell configuration:

```json
{
  "namespace": "cell",
  "nodeID": "your-cell-id",
  "services": [
    "services/*.service.js"
  ],
  "transporter": "TCP",
  "logLevel": "info"
}
```

## Documentation

View full project documentation at: [https://cparqui.github.io/celluler](https://cparqui.github.io/celluler)

## Contributing

We welcome contributions! Please see our [Contributing Guide](docs/contributing.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details. 