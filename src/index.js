#!/usr/bin/env node

import _ from 'lodash';
import { ServiceBroker } from 'moleculer';
import NucleusService from './services/nucleus.service.js';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_LOG_LEVELS = {
    METRICS: 'warn',
    TRACING: 'warn',
    REGISTRY: 'warn',
    DISCOVERER: 'warn',
    TRANSIT: 'warn',
};

export const DEFAULT_CONFIG = {
    version: 1,
    cell: {
        name: 'cell',
        id: `cell-${process.pid}`,
        namespace: 'celluler',
        transporter: {
            type: 'TCP',
            options: {
                port: 0,
                udpDiscovery: true,
                udpReusePort: true,
                udpPeriod: 30
            }
        },
        services: {
            enabled: ['nucleus'],
            config: {
                nucleus: {
                    storage: 'memory',
                    encryption: true
                }
            }
        },
        logging: {
            level: DEFAULT_LOG_LEVELS,
            output: [
                {
                    type: 'Console',
                    options: {
                        formatter: 'full',
                        colors: true,
                        moduleColors: false,
                        autoPadding: false
                    }
                }
            ]
        }
    }
};

export async function loadConfig(configPath) {
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(configContent);
        
        // Merge with defaults, ensuring log levels are properly set
        const mergedConfig = _.defaultsDeep(config, DEFAULT_CONFIG);
        
        // Ensure logging.level is properly set
        if (typeof mergedConfig.cell.logging.level === 'string') {
            mergedConfig.cell.logging.level = DEFAULT_LOG_LEVELS;
        }
        
        return mergedConfig;
    } catch (err) {
        throw new Error(`Error loading configuration: ${err.message}`);
    }
}

export function createMoleculerConfig(cellConfig, debug = false) {
    // Create base Moleculer config
    const moleculerConfig = {
        nodeID: cellConfig.id,
        namespace: cellConfig.namespace,
        transporter: cellConfig.transporter.type,
        transporterOptions: cellConfig.transporter.options,
        logger: cellConfig.logging.output.map(logger => ({
            type: logger.type,
            options: {
                level: _.defaultsDeep(DEFAULT_LOG_LEVELS, logger.options.level || cellConfig.logging.level),
                ...logger.options
            }
        })),
        requestTimeout: cellConfig.performance?.requestTimeout || 5000,
        maxCallLevel: cellConfig.performance?.maxCallLevel || 100,
        heartbeatInterval: cellConfig.performance?.heartbeatInterval || 5,
        heartbeatTimeout: cellConfig.performance?.heartbeatTimeout || 15,
        registry: {
            strategy: cellConfig.registry?.strategy || 'RoundRobin',
            preferLocal: cellConfig.registry?.preferLocal ?? true
        },
        circuitBreaker: {
            enabled: cellConfig.circuitBreaker?.enabled ?? true,
            threshold: cellConfig.circuitBreaker?.threshold || 0.5,
            windowTime: cellConfig.circuitBreaker?.windowTime || 60,
            minRequestCount: cellConfig.circuitBreaker?.minRequestCount || 20,
            halfOpenTime: cellConfig.circuitBreaker?.halfOpenTime || 10000
        },
        bulkhead: {
            enabled: cellConfig.bulkhead?.enabled ?? true,
            concurrency: cellConfig.bulkhead?.concurrency || 10,
            maxQueueSize: cellConfig.bulkhead?.maxQueueSize || 100
        },
        metrics: {
            enabled: cellConfig.metrics?.enabled ?? true,
            reporter: cellConfig.metrics?.reporter || ['Console']
        },
        tracing: {
            enabled: cellConfig.tracing?.enabled ?? true,
            exporter: cellConfig.tracing?.exporter || ['Console']
        },
        cacher: {
            type: cellConfig.cacher?.type || 'Memory',
            options: cellConfig.cacher?.options || { max: 1000 }
        },
        serializer: {
            type: cellConfig.serializer?.type || 'JSON',
            options: cellConfig.serializer?.options || {}
        }
    };

    if (debug) {
        console.log('Moleculer Configuration:');
        console.log(JSON.stringify(moleculerConfig, null, 2));
    }

    return moleculerConfig;
}

export async function startCell(config, debug = false) {
    const moleculerConfig = createMoleculerConfig(config.cell, debug);
    const broker = new ServiceBroker(moleculerConfig);

    // Create and add nucleus service
    new NucleusService(broker);

    // Start the broker
    await broker.start();
    console.log(`Cell ${config.cell.id} started successfully!`);

    return broker;
}
