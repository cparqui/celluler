# Getting Started with Celluler

This guide will help you get started with Celluler, from installation to running your first cell.

## Prerequisites

Before you begin, ensure you have the following installed:

- Node.js 16+
- npm or yarn
- Git
- Basic understanding of distributed systems
- Familiarity with TypeScript

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/celluler.git
cd celluler
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

Create a configuration file at `config/default.json`:

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

## Running Your First Cell

1. Start a cell:
```bash
npm run start
```

2. Verify the cell is running:
```bash
npm run status
```

## Basic Usage

### 1. Connecting to the Network

```typescript
import { Cell } from 'celluler';

const cell = new Cell({
    id: 'your-cell-id',
    config: 'config/default.json'
});

await cell.connect();
```

### 2. Running AI Models

```typescript
// Load a model
const model = await cell.models.load('model-id');

// Run inference
const result = await model.predict(input);
```

### 3. Sharing Data

```typescript
// Store data
await cell.data.store('key', data);

// Retrieve data
const data = await cell.data.retrieve('key');
```

## Next Steps

1. **Explore the Architecture**
   - Read the [Architecture Overview](architecture.md)
   - Understand the [Service Architecture](services.md)

2. **Develop Your First Service**
   - Follow the [Service Development Guide](services.md)
   - Create a custom service

3. **Join the Network**
   - Learn about [P2P Networking](networking.md)
   - Connect to other cells

4. **Work with AI Models**
   - Read the [AI Integration Guide](ai.md)
   - Deploy your first model

## Troubleshooting

### Common Issues

1. **Connection Problems**
   - Check network configuration
   - Verify firewall settings
   - Ensure ports are open

2. **Service Errors**
   - Check service logs
   - Verify service configuration
   - Ensure dependencies are installed

3. **Performance Issues**
   - Monitor resource usage
   - Check network latency
   - Optimize service configuration

### Getting Help

- Check the [API Reference](api.md)
- Open an [issue](https://github.com/yourusername/celluler/issues)
- Join our [discussions](https://github.com/yourusername/celluler/discussions)

## Contributing

We welcome contributions! See our [Contributing Guide](contributing.md) for details. 