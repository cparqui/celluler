#!/usr/bin/env node

import { program } from 'commander';
import { startCell, loadConfig, DEFAULT_CONFIG } from './index.js';
import _ from 'lodash';

program
    .name('cell')
    .description('CLI for interacting with the Celluler network')
    .version('0.1.0');

program
    .command('start')
    .description('Start a new cell')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-i, --id <id>', 'Cell ID (overrides config)')
    .option('-n, --name <name>', 'Cell name (overrides config)')
    .option('-s, --services <services>', 'Comma-separated list of services to start (overrides CELL_SERVICES env var)')
    .option('-D, --debug [module]', 'Enable debug logging, optionally for a specific module')
    .option('-l, --log-level <level>', 'Global log level (overrides config)')
    .option('-t, --transporter <type>', 'Transporter type (overrides config)')
    .option('-p, --port <port>', 'Transporter port (overrides config)')
    .action(async (options) => {
        try {
            console.log('Starting cell with options:', options);
            
            let config;
            if (options.config) {
                console.log('Loading config from:', options.config);
                config = await loadConfig(options.config);
            } else {
                console.log('Using default config');
                config = {
                    ...DEFAULT_CONFIG,
                    cell: {
                        ...DEFAULT_CONFIG.cell,
                        id: options.id || `cell-${process.pid}`
                    }
                };
            }

            // Get services from either CLI or environment variable
            const services = options.services 
                ? options.services.split(',').map(s => s.trim())
                : (process.env.CELL_SERVICES ? process.env.CELL_SERVICES.split(',').map(s => s.trim()) : ['nucleus']);
            
            console.log('Services to start:', services);

            // Apply command line overrides
            if (options.id) config.cell.id = options.id;
            if (options.name) config.cell.name = options.name;
            if (services) {
                config.cell.services = services;
            }
            if (options.logLevel) {
                if (typeof config.cell.logger.options.level === 'object') {
                    // Set all module levels to the specified level
                    Object.keys(config.cell.logger.options.level).forEach(key => {
                        config.cell.logger.options.level[key] = options.logLevel;
                    });
                } else {
                    config.cell.logger.options.level = options.logLevel;
                }
            }
            if (options.transporter) config.cell.transporter.type = options.transporter;
            if (options.port) config.cell.transporter.options.port = parseInt(options.port, 10);

            // Handle debug logging
            if (options.debug) {
                let logLevel = "debug";
                if (typeof options.debug === 'string') {
                    // Module-specific debugging
                    logLevel = {
                        [options.debug.toUpperCase()]: "debug",
                        "**": "info"  // Default level for other modules
                    };
                }
                
                // Global debug logging
                if (typeof config.cell.logger.options === 'array') {
                    Object.keys(config.cell.logger).forEach(logger => {
                        logger.options.level = logLevel;
                    });
                } else if (typeof config.cell.logger.options === 'object' ) {
                    config.cell.logger.options.level = logLevel;
                } else {
                    config.cell.logger.options = { level: logLevel };
                }
            }

            if (options.debug) {
                console.log('Final configuration:', JSON.stringify(config, null, 2));
            }
            console.log('Starting cell...');

            const broker = await startCell(config, options.debug);
            
            console.log('Cell started successfully');
            
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