# Configuration

Celluler uses a YAML-based configuration system that maps to Moleculer's configuration options while providing a more structured interface. The configuration is defined in a `celluler_config.yaml` file.

## Configuration Schema

The configuration schema is defined in [`schemas/celluler_config.schema.json`](../../schemas/celluler_config.schema.json). This schema is used for both documentation and validation.

### Basic Structure

```yaml
version: 1  # Schema version

cell:
  # Basic cell configuration
  name: string  # Human-readable cell name
  id: string    # Unique cell identifier (maps to nodeID)
  
  # Network configuration
  namespace: string  # Namespace for cell grouping
  transporter: 
    type: string    # e.g., "nats", "redis", "mqtt"
    options: object # Transporter-specific options
  
  # Service configuration
  services:
    enabled: string[]  # List of services to enable
    config: object     # Service-specific configurations
```

### Example Configuration

```yaml
version: 1

cell:
  name: "my-cell"
  id: "cell-1"
  
  namespace: "development"
  transporter:
    type: "nats"
    options:
      url: "nats://localhost:4222"
  
  services:
    enabled:
      - "nucleus"
      - "message"
    config:
      nucleus:
        storage: "memory"
        encryption: true
      message:
        protocol: "hyperswarm"
```

## Configuration Sections

### Basic Cell Configuration
- `name`: Human-readable cell name
- `id`: Unique cell identifier (maps to Moleculer's nodeID)

### Network Configuration
- `namespace`: Namespace for cell grouping
- `transporter`: Network transport configuration
  - `type`: Transporter type (nats, redis, mqtt)
  - `options`: Transporter-specific options

### Service Configuration
- `enabled`: List of services to enable
- `config`: Service-specific configurations

### Logging Configuration
- `level`: Log level (trace, debug, info, warn, error, fatal)
- `format`: Log format (json, simple, short)
- `output`: Log output destinations (console, file)
- `file`: File logging configuration
  - `path`: Log file path
  - `rotation`: Log rotation configuration
    - `size`: Rotation size (e.g., "100MB")
    - `count`: Number of log files to keep

### Performance Configuration
- `requestTimeout`: Request timeout in milliseconds
- `maxCallLevel`: Maximum call level for infinite loop protection
- `heartbeatInterval`: Heartbeat interval in seconds
- `heartbeatTimeout`: Heartbeat timeout in seconds

### Security Configuration
- `tls`: Enable TLS
- `auth`: Enable authentication
- `encryption`: Enable encryption

### Registry Configuration
- `strategy`: Registry strategy (RoundRobin, Random)
- `preferLocal`: Prefer local services

### Circuit Breaker Configuration
- `enabled`: Enable circuit breaker
- `threshold`: Failure threshold
- `windowTime`: Window time in seconds
- `minRequestCount`: Minimum request count
- `halfOpenTime`: Half-open time in milliseconds

### Bulkhead Configuration
- `enabled`: Enable bulkhead
- `concurrency`: Maximum concurrent requests
- `maxQueueSize`: Maximum queue size

### Metrics Configuration
- `enabled`: Enable metrics
- `reporter`: Metrics reporters (Console, Prometheus)

### Tracing Configuration
- `enabled`: Enable tracing
- `exporter`: Tracing exporters (Console, Jaeger)

### Caching Configuration
- `type`: Cacher type (Memory, Redis)
- `options`: Cacher-specific options

### Serialization Configuration
- `type`: Serializer type (JSON, MsgPack)
- `options`: Serializer-specific options

### Middleware Configuration
- `middlewares`: List of middleware names to enable

### Custom Metadata
- `metadata`: Custom key-value pairs

## Validation

The configuration is validated against the JSON Schema when loaded. This ensures that:
1. Required fields are present
2. Field types are correct
3. Enum values are valid
4. Numeric values are within valid ranges

## Environment Variables

Configuration values can be overridden using environment variables. The format is:
```
CELLULER_<SECTION>_<FIELD>=value
```

For example:
```
CELLULER_CELL_NAME=my-cell
CELLULER_CELL_NAMESPACE=development
CELLULER_LOGGING_LEVEL=debug
```

## Configuration Files

The configuration can be loaded from:
1. Default location: `./celluler_config.yaml`
2. Custom location: Specified via `--config` CLI option
3. Environment variable: `CELLULER_CONFIG_PATH`

## Configuration Inheritance

Configuration files can inherit from a base configuration using the `extends` field:

```yaml
version: 1
extends: base_config.yaml

cell:
  name: "my-cell"
  # Override specific fields from base config
```

## Configuration Templates

Templates are available for different deployment scenarios:
- Local development
- Docker
- Kubernetes

See the [deployment guide](../deployment/README.md) for details. 