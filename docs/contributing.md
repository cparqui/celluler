# Contributing to Celluler

Thank you for your interest in contributing to Celluler! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn
- Git
- Basic understanding of distributed systems
- Familiarity with TypeScript

### Development Setup

1. Fork the repository
2. Clone your fork
3. Install dependencies
4. Create a new branch for your feature

```bash
git clone https://github.com/yourusername/celluler.git
cd celluler
npm install
git checkout -b feature/your-feature-name
```

## Development Workflow

### 1. Branch Naming

- `feature/` - New features
- `bugfix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions or improvements

### 2. Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add appropriate comments and documentation
- Follow the existing code style: 4-space indent, single quotes, semicolons, no trailing commas, and lines up to 120 columns

`npm run lint` checks these conventions with ESLint. The rules describe how the code is already written, so if a rule and the codebase disagree, raise it rather than reformatting around it. Style-only changes belong in their own PR.

### 3. Testing

- Write unit tests for new features
- Ensure all tests pass
- Add integration tests where appropriate
- Update existing tests if needed

### 4. Documentation

- Update relevant documentation
- Add comments for complex logic
- Document new features
- Update API documentation if needed

## Pull Request Process

1. Ensure your code follows the project's style guide
2. Update documentation if needed
3. Add tests for new features
4. Ensure all tests pass
5. Submit a pull request

### Pull Request Template

```markdown
## Description
[Description of the changes]

## Related Issues
[Link to related issues]

## Type of Change
- [ ] New feature
- [ ] Bug fix
- [ ] Documentation update
- [ ] Test addition
- [ ] Refactoring

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] All tests pass

## Documentation
- [ ] Documentation updated
- [ ] Code comments added/updated

## Checklist
- [ ] Code follows style guide
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Changes documented in CHANGELOG.md
```

## Code Review Process

1. Pull requests are reviewed by maintainers
2. Feedback is provided within 48 hours
3. Changes may be requested
4. Once approved, the PR is merged

## Development Guidelines

### 1. Service Development

- Follow Moleculer service patterns
- Implement proper error handling
- Add appropriate logging
- Follow security best practices

### 2. Testing

- Write comprehensive tests
- Use appropriate test frameworks
- Include edge cases
- Document test coverage

### 3. Documentation

- Keep documentation up to date
- Use clear and concise language
- Include code examples
- Document edge cases

### 4. Logging

Use Pino's call style: an optional context object first, then the message. Keep the message a fixed phrase with no values in it, so lines are easy to search, and put errors under `err`:

```js
this.logger.info({ cellId, journalLength }, 'Nucleus started');
this.logger.error({ err }, 'Failed to flush journal');
this.logger.debug('Corestore closed');
```

With the Pino logger, each line is one JSON object: the context becomes top-level fields, the message goes in `msg`, and `err` is serialized with its type, message and stack. Arguments after the message only fill `%s`-style placeholders in it (otherwise Pino drops them), so put values in the context object instead.

Choose the level by how often it happens and who needs it:

| Level | Use for | Nucleus examples |
|---|---|---|
| `error` | Faults that need someone to look: unexpected exceptions, local corruption, failed cleanup | `Action failed`, `Failed to start Nucleus`, own journal failed verification |
| `warn` | Something wrong that the cell survived, often caused by a peer | Rejected peer journal, replication timed out, peer reference mismatch, memory storage |
| `info` | Startup, shutdown and rare state changes: a production log should read as a short story | Nucleus started/stopped, new cell journal, keys attested or rotated, record type registered, topic bound, new peer journal tracked |
| `debug` | Per-operation detail for watching the system work: every journal append and read, peer connections, rejected input | `Appended journal event`, `Read journal event`, `Peer connected`, `Action rejected` |

Never log the root seed, secret keys, record bodies, messages or ciphertext. Cell IDs, public keys, hashes and record types are fine.

## Project Structure

```
celluler/
├── src/
│   ├── core/           # Core services
│   ├── services/       # Additional services
│   ├── types/          # TypeScript types
│   └── utils/          # Utility functions
├── tests/              # Test files
├── docs/               # Documentation
└── config/             # Configuration files
```

## Building and Testing

### Building

```bash
npm run build
```

### Testing

```bash
npm test              # Run all tests
npm run test:unit     # Run unit tests
npm run test:integration  # Run integration tests
```

### Linting

```bash
npm run lint          # Check code style
npm run lint:fix      # Fix code style issues
```

## Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create release tag
4. Build and test
5. Publish to npm

## Getting Help

- Open an issue for bugs
- Use discussions for questions
- Join our community chat
- Check the documentation

## License

By contributing, you agree that your contributions will be licensed under the project's [LICENSE](LICENSE) file. 