#!/usr/bin/env node

import { program } from 'commander';
import { startCell, loadConfig, DEFAULT_CONFIG } from './index.js';

program
    .name('cell')
    .description('CLI for interacting with the Celluler network')
    .version('0.1.0');

program
    .command('start')
    .description('Start a new cell')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-i, --id <id>', 'Cell ID (overrides config)')
    .option('-D, --debug [module]', 'Enable debug logging, optionally for a specific module')
    .action(async (options) => {
        try {
            let config;
            if (options.config) {
                config = await loadConfig(options.config);
            } else {
                // Use default config
                config = {
                    ...DEFAULT_CONFIG,
                    cell: {
                        ...DEFAULT_CONFIG.cell,
                        id: options.id || `cell-${process.pid}`
                    }
                };
            }

            // Override ID if specified via command line
            if (options.id) {
                config.cell.id = options.id;
            }

            // Handle debug logging
            if (options.debug) {
                if (typeof options.debug === 'string') {
                    // Module-specific debugging
                    config.cell.logging.level = {
                        [options.debug.toUpperCase()]: "debug",
                        "**": "info"  // Default level for other modules
                    };
                } else {
                    // Global debug logging
                    config.cell.logging.level = "debug";
                }
            }

            const broker = await startCell(config, options.debug);
            
            // Handle process termination
            process.on('SIGINT', async () => {
                console.log('Shutting down cell...');
                await broker.stop();
                process.exit(0);
            });
        } catch (err) {
            console.error('Error starting cell:', err);
            process.exit(1);
        }
    });

program.parse(); 