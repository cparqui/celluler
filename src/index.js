#!/usr/bin/env node

import _ from 'lodash';
import { ServiceBroker } from 'moleculer';
import NucleusService from './services/nucleus.service.js';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_LOG_LEVELS = {
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
        logger: {
            type: 'Console',
            options: {
                level: DEFAULT_LOG_LEVELS,
                colors: true,
                moduleColors: true,
                formatter: 'full',
                autoPadding: true
            }
        }
    }
};

function resolveEnvVars(obj) {
    if (typeof obj === 'string') {
        // Replace ${VAR} with environment variable
        return obj.replace(/\${([^}]+)}/g, (match, envVar) => {
            return process.env[envVar] || match;
        });
    }
    if (Array.isArray(obj)) {
        return obj.map(item => resolveEnvVars(item));
    }
    if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = resolveEnvVars(value);
        }
        return result;
    }
    return obj;
}

export async function loadConfig(configPath) {
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(configContent);
        
        // Handle configuration inheritance
        let baseConfig = DEFAULT_CONFIG;
        if (config.extends) {
            const basePath = path.resolve(path.dirname(configPath), config.extends);
            baseConfig = await loadConfig(basePath);
            delete config.extends; // Remove the extends property
        }
        
        // Merge with base configuration
        const mergedConfig = _.defaultsDeep(config, baseConfig);
        
        // Resolve environment variables
        const resolvedConfig = resolveEnvVars(mergedConfig);
        
        // Ensure logging configuration is properly set
        if (resolvedConfig.cell.logging) {
            // If logging.level is a string, convert it to an object with that level for all modules
            if (typeof resolvedConfig.cell.logging.level === 'string') {
                resolvedConfig.cell.logging.level = {
                    "**": resolvedConfig.cell.logging.level
                };
            }
            
            // Merge with default log levels using defaultsDeep to handle nested levels
            resolvedConfig.cell.logging.level = _.defaultsDeep({}, resolvedConfig.cell.logging.level, DEFAULT_LOG_LEVELS);
            
            // Ensure output array exists
            if (!resolvedConfig.cell.logging.output) {
                resolvedConfig.cell.logging.output = [{
                    type: 'Console',
                    options: {
                        formatter: 'full',
                        colors: true,
                        moduleColors: false,
                        autoPadding: false
                    }
                }];
            }
        }
        
        return resolvedConfig;
    } catch (err) {
        throw new Error(`Error loading configuration: ${err.message}`);
    }
}

export function createMoleculerConfig(cellConfig, debug = false) {
    if (debug) {
        console.log('Creating Moleculer config from cell config:', JSON.stringify(cellConfig, null, 2));
    }

    const moleculerConfig = {
        nodeID: cellConfig.id,
        namespace: cellConfig.namespace,
        transporter: cellConfig.transporter,
        logger: cellConfig.logger,
        metrics: cellConfig.metrics,
        tracing: cellConfig.tracing,
        hotReload: cellConfig.hotReload,
        cacher: cellConfig.cacher,
        serializer: cellConfig.serializer,
        validator: cellConfig.validator,
        errorHandler: cellConfig.errorHandler,
        middlewares: cellConfig.middlewares,
        replCommands: cellConfig.replCommands,
        metadata: cellConfig.metadata,
        maxCallLevel: cellConfig.performance?.maxCallLevel,
        heartbeatInterval: cellConfig.performance?.heartbeatInterval,
        heartbeatTimeout: cellConfig.performance?.heartbeatTimeout,
        contextParamsCloning: cellConfig.contextParamsCloning,
        tracking: cellConfig.tracking,
        disableBalancer: cellConfig.disableBalancer,
        registry: cellConfig.registry,
        circuitBreaker: cellConfig.circuitBreaker,
        bulkhead: cellConfig.bulkhead,
        transit: cellConfig.transit,
        apiGateway: cellConfig.apiGateway,
        $schema: cellConfig.$schema
    };

    if (debug) {
        console.log('Final Moleculer configuration:');
        console.log(JSON.stringify(moleculerConfig, null, 2));
    }

    return moleculerConfig;
}

// Service map for dynamic loading
const SERVICE_MAP = {
    nucleus: NucleusService,
    // Add other services here as they are implemented
    // message: MessageService,
    // identity: IdentityService,
    // state: StateService,
    // consensus: ConsensusService
};

export async function startCell(config, debug = false) {
    if (debug) {
        console.log('Creating Moleculer configuration...');
    }
    const moleculerConfig = createMoleculerConfig(config.cell, debug);
    
    if (debug) {
        console.log('Moleculer configuration:', JSON.stringify(moleculerConfig, null, 2));
    }

    if (debug) {
        console.log('Creating ServiceBroker...');
    }
    const broker = new ServiceBroker(moleculerConfig);

    // Get list of services to start
    const services = _.isArray(config.cell.services) 
        ? config.cell.services 
        : [config.cell.services];

    if (debug) {
        console.log('Initializing services:', services);
    }

    // Initialize each requested service
    for (const serviceName of services) {
        const ServiceClass = SERVICE_MAP[serviceName];
        if (!ServiceClass) {
            throw new Error(`Unknown service: ${serviceName}`);
        }

        if (debug) {
            console.log(`Creating ${serviceName} service...`);
        }
        new ServiceClass(broker, config.cell);
    }

    console.log('Starting broker...');
    await broker.start();
    console.log(`Cell ${config.cell.id} started successfully!`);

    return broker;
}
