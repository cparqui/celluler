import _ from "lodash";
import { Service } from "moleculer";
import ApiGateway from "moleculer-web";

const DEFAULT_SETTINGS = {
    // Server settings
    port: 3000,
    ip: "0.0.0.0",
    https: {
        enabled: false,
        key: null,
        cert: null
    },

    // Global path prefix
    path: "/api",

    // Global-level middlewares
    use: [],

    // Logging settings
    logRequestParams: "info",
    logResponseData: "debug",

    // Rate limiting settings
    rateLimit: {
        window: 60000, // 1 minute
        limit: 100, // 100 requests per minute
        headers: true
    },

    // Authentication settings
    authentication: {
        enabled: false,
        type: "basic", // or "bearer"
        credentials: {
            username: "admin",
            password: "admin"
        }
    },

    // Routes configuration
    routes: [
        {
            path: "/api/v1",
            whitelist: [
                "nucleus.*",
                "message.*",
                "api.*",
                "$node.*"
            ],
            mappingPolicy: "restrict",
            bodyParsers: {
                json: true,
                urlencoded: { extended: true }
            },
            // Route-level authentication
            authentication: true,
            // Route-level rate limiting
            rateLimit: {
                window: 60000,
                limit: 100,
                headers: true
            }
        },
        {
            // Public routes (no authentication required)
            path: "/api/public",
            whitelist: [
                "api.health",
                "api.status",
                "api.info"
            ],
            mappingPolicy: "restrict",
            bodyParsers: {
                json: true,
                urlencoded: { extended: true }
            },
            authentication: false
        }
    ],

    // Error handlers
    onError(req, res, err) {
        this.logger.error("API Gateway error:", err);
        res.setHeader("Content-Type", "application/json");
        res.writeHead(err.code || 500);
        res.end(JSON.stringify({
            error: {
                message: err.message,
                code: err.code || 500,
                type: err.type || "INTERNAL_SERVER_ERROR"
            }
        }));
    },

    // Custom authentication handler
    async authenticate(ctx, route, req, res) {
        const settings = this.settings.authentication;
        
        if (!settings.enabled || !route.authentication) {
            return Promise.resolve(ctx);
        }

        const auth = req.headers.authorization;
        if (!auth) {
            return Promise.reject(new Error("Authorization header required"));
        }

        if (settings.type === "basic") {
            const [type, credentials] = auth.split(" ");
            if (type !== "Basic") {
                return Promise.reject(new Error("Basic authentication required"));
            }

            const decoded = Buffer.from(credentials, "base64").toString();
            const [username, password] = decoded.split(":");
            
            if (username === settings.credentials.username && 
                password === settings.credentials.password) {
                ctx.meta.user = { username };
                return Promise.resolve(ctx);
            }
        }

        return Promise.reject(new Error("Invalid credentials"));
    }
};

export default class ApiService extends Service {
    constructor(broker, settings = {}) {
        super(broker);
        
        this.parseServiceSchema({
            name: "api",
            version: 1,
            mixins: [ApiGateway],
            settings: _.defaultsDeep(settings, DEFAULT_SETTINGS),
            dependencies: ["nucleus"],
            
            actions: {
                // Health check endpoint
                health: {
                    rest: "GET /health",
                    params: {},
                    handler: this.health
                },

                // Service status endpoint
                status: {
                    rest: "GET /status",
                    params: {},
                    handler: this.status
                },

                // API information endpoint
                info: {
                    rest: "GET /info",
                    params: {},
                    handler: this.info
                },

                // List available endpoints
                endpoints: {
                    rest: "GET /endpoints",
                    params: {},
                    handler: this.endpoints
                }
            },

            events: {
                "nucleus.started": this.onNucleusStarted,
                "nucleus.stopped": this.onNucleusStopped
            }
        });
    }

    /**
     * Health check endpoint
     * Returns the health status of the API gateway and its dependencies
     */
    async health(ctx) {
        try {
            const startTime = Date.now();
            
            // Check if nucleus service is available
            const nucleusHealth = await this.broker.call("nucleus.health").catch(() => null);
            
            // Check message service if available
            const messageHealth = await this.broker.call("message.health").catch(() => null);
            
            const responseTime = Date.now() - startTime;
            
            const health = {
                status: "healthy",
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                responseTime,
                version: process.env.npm_package_version || "0.1.0",
                services: {
                    nucleus: nucleusHealth ? "healthy" : "unavailable",
                    message: messageHealth ? "healthy" : "unavailable"
                }
            };

            // Determine overall health status
            const unhealthyServices = Object.values(health.services).filter(status => status !== "healthy");
            if (unhealthyServices.length > 0) {
                health.status = "degraded";
            }

            return health;
        } catch (error) {
            this.logger.error("Health check failed:", error);
            return {
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    /**
     * Service status endpoint
     * Returns detailed status information about all services
     */
    async status(ctx) {
        try {
            const nodeList = await this.broker.call("$node.list");
            const nodeHealth = await this.broker.call("$node.health");
            
            return {
                timestamp: new Date().toISOString(),
                node: {
                    id: this.broker.nodeID,
                    health: nodeHealth,
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    version: process.version
                },
                services: nodeList.map(node => ({
                    nodeID: node.id,
                    available: node.available,
                    lastHeartbeatTime: node.lastHeartbeatTime,
                    services: node.services || []
                }))
            };
        } catch (error) {
            this.logger.error("Status check failed:", error);
            throw error;
        }
    }

    /**
     * API information endpoint
     * Returns information about the API gateway
     */
    async info(ctx) {
        return {
            name: "Celluler API Gateway",
            version: process.env.npm_package_version || "0.1.0",
            description: "REST API gateway for Celluler distributed services",
            timestamp: new Date().toISOString(),
            documentation: "/api/endpoints",
            features: [
                "Health monitoring",
                "Service status",
                "Rate limiting",
                "Basic authentication",
                "Request/response logging"
            ]
        };
    }

    /**
     * List available endpoints
     * Returns documentation of available API endpoints
     */
    async endpoints(ctx) {
        const routes = this.settings.routes;
        const endpoints = [];

        for (const route of routes) {
            endpoints.push({
                path: route.path,
                whitelist: route.whitelist,
                authentication: route.authentication !== false,
                rateLimit: route.rateLimit ? true : false,
                bodyParsers: Object.keys(route.bodyParsers || {})
            });
        }

        return {
            timestamp: new Date().toISOString(),
            routes: endpoints,
            publicEndpoints: [
                "GET /api/public/health - Health check",
                "GET /api/public/status - Service status",
                "GET /api/public/info - API information",
                "GET /api/public/endpoints - This documentation"
            ],
            authenticatedEndpoints: [
                "All /api/v1/* endpoints require authentication"
            ]
        };
    }

    async onNucleusStarted(ctx) {
        this.logger.info("Nucleus service started, API Gateway is ready");
    }

    async onNucleusStopped(ctx) {
        this.logger.info("Nucleus service stopped, API Gateway is shutting down");
    }
} 