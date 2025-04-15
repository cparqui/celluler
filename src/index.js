#!/usr/bin/env node

import { program } from 'commander';
import { ServiceBroker } from 'moleculer';
import NucleusService from './services/nucleus_service.js';

async function startCell(id) {
    const broker = new ServiceBroker({
        nodeID: id,
        transporter: 'TCP',
        logLevel: 'info'
    });

    // Create and add nucleus service
    new NucleusService(broker);

    // Start the broker
    await broker.start();
    console.log(`Cell ${id} started successfully!`);

    return broker;
}

program
    .name('cell')
    .description('CLI for interacting with the Celluler network')
    .version('0.1.0');

program
    .command('start')
    .description('Start a new cell with a NucleusService')
    .option('-i, --id <id>', 'Cell ID', 'cell-' + Math.random().toString(36).substr(2, 9))
    .action(async (options) => {
        try {
            const broker = await startCell(options.id);
            
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