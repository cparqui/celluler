# Contributing to Celluler

Thank you for your interest in contributing to Celluler! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## Getting Started

### Prerequisites

- Node.js 22.18+ (see `engines` in `package.json`)
- npm
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

### Dependencies

- Every version range in `package.json`, including `overrides`, must have a floor (the lowest version it allows) published at least 14 days ago. That way the project still installs from a registry or mirror that is two weeks behind. Ranges may allow newer versions, and npm installs the newest match as usual.
- No lockfile is committed (`package-lock.json` is ignored).
- When `npm audit` reports a vulnerable transitive dependency that its parent hasn't updated yet, add a scoped entry to `overrides` in `package.json` whose floor is a patched version, such as `"glob@>=9.0.0 <14.0.2": "^14.0.4"`. Scope the key to the vulnerable range so other major versions in the tree are left alone. Remove the entry once the parent packages depend on a fixed version.

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