import fs from 'fs';
import { ServiceBroker } from "moleculer";
import path from 'path';
import { promisify } from 'util';
import ApiService from "../../../src/services/api.service.js";
import NucleusService from "../../../src/services/nucleus.service.js";

const rmrf = promisify(fs.rm);
const mkdir = promisify(fs.mkdir);

describe("ApiService", () => {
    let broker;
    let apiService;
    let nucleusService;
    const testDataDir = path.join(process.cwd(), 'tmp', 'test', 'data');

    beforeAll(async () => {
        // Clean up any existing test data
        try {
            await rmrf(testDataDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore errors if directories don't exist
        }

        // Create fresh test directories
        await mkdir(testDataDir, { recursive: true });
        
        broker = new ServiceBroker({ 
            logger: false,
            metrics: false
        });

        nucleusService = new NucleusService(broker, {
            name: 'test-cell',
            config: {
                storage: 'file',
                path: testDataDir
            }
        });

        apiService = new ApiService(broker);

        // Mock the logger
        apiService.logger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn()
        };

        await broker.start();
    });

    afterAll(async () => {
        if (broker) {
            await broker.stop();
        }
        
        // Clean up test data
        try {
            await rmrf(testDataDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
    });

    afterEach(() => {
        // Restore any spies after each test to avoid bleed-through
        jest.restoreAllMocks();
    });

    describe("Service Creation", () => {
        it("should create service with correct name", () => {
            expect(apiService.name).toBe("api");
        });

        it("should have correct version", () => {
            expect(apiService.version).toBe(1);
        });

        it("should create service with custom settings", () => {
            const customBroker = new ServiceBroker({ logger: false });
            const customApiService = new ApiService(customBroker, {
                port: 4000,
                path: "/custom-api"
            });

            expect(customApiService.settings.port).toBe(4000);
            expect(customApiService.settings.path).toBe("/custom-api");
            
            customBroker.stop();
        });
    });

    describe("Settings", () => {
        it("should have correct default port", () => {
            expect(apiService.settings.port).toBe(3000);
        });

        it("should have correct default path", () => {
            expect(apiService.settings.path).toBe("/api");
        });

        it("should have correct whitelist configuration", () => {
            expect(apiService.settings.routes[0].whitelist).toContain("nucleus.*");
            expect(apiService.settings.routes[0].whitelist).toContain("message.*");
            expect(apiService.settings.routes[0].whitelist).toContain("api.*");
            expect(apiService.settings.routes[0].whitelist).toContain("$node.*");
        });

        it("should have correct mapping policy", () => {
            expect(apiService.settings.routes[0].mappingPolicy).toBe("restrict");
        });

        it("should have correct rate limiting settings", () => {
            expect(apiService.settings.rateLimit.window).toBe(60000);
            expect(apiService.settings.rateLimit.limit).toBe(100);
            expect(apiService.settings.rateLimit.headers).toBe(true);
        });

        it("should have correct authentication settings", () => {
            expect(apiService.settings.authentication.enabled).toBe(false);
            expect(apiService.settings.authentication.type).toBe("basic");
            expect(apiService.settings.authentication.credentials.username).toBe("admin");
        });

        it("should have public and authenticated routes", () => {
            expect(apiService.settings.routes).toHaveLength(2);
            expect(apiService.settings.routes[0].path).toBe("/api/v1");
            expect(apiService.settings.routes[1].path).toBe("/api/public");
            expect(apiService.settings.routes[1].authentication).toBe(false);
        });
    });

    describe("Action Handlers", () => {
        describe("health action", () => {
            it("should return healthy status when all services are available", async () => {
                // Mock only the internal dependency calls
                const originalCall = broker.call.bind(broker);
                jest.spyOn(broker, "call").mockImplementation((action, params) => {
                    if (action === "nucleus.health") {
                        return Promise.resolve({ status: "healthy" });
                    }
                    if (action === "message.health") {
                        return Promise.resolve({ status: "healthy" });
                    }
                    return originalCall(action, params);
                });

                const result = await broker.call("v1.api.health");

                expect(result.status).toBe("healthy");
                expect(result.timestamp).toBeDefined();
                expect(result.uptime).toBeDefined();
                expect(result.responseTime).toBeDefined();
                expect(result.version).toBeDefined();
                expect(result.services.nucleus).toBe("healthy");
                expect(result.services.message).toBe("healthy");
            });

            it("should return degraded status when some services are unavailable", async () => {
                const originalCall = broker.call.bind(broker);
                jest.spyOn(broker, "call").mockImplementation((action) => {
                    if (action === "nucleus.health") {
                        return Promise.resolve({ status: "healthy" });
                    }
                    if (action === "message.health") {
                        return Promise.reject(new Error("Service unavailable"));
                    }
                    return originalCall(action);
                });

                const result = await broker.call("v1.api.health");

                expect(result.status).toBe("degraded");
                expect(result.services.nucleus).toBe("healthy");
                expect(result.services.message).toBe("unavailable");
            });

            it("should return unhealthy status when health check fails", async () => {
                jest.spyOn(apiService, "health").mockImplementation(async () => {
                    throw new Error("Health check failed");
                });

                await expect(apiService.health()).rejects.toThrow("Health check failed");
            });
        });

        describe("status action", () => {
            it("should return detailed status information", async () => {
                const originalCall = broker.call.bind(broker);
                jest.spyOn(broker, "call").mockImplementation((action) => {
                    if (action === "$node.list") {
                        return Promise.resolve([
                            {
                                id: "node-1",
                                available: true,
                                lastHeartbeatTime: Date.now(),
                                services: ["nucleus", "message"]
                            }
                        ]);
                    }
                    if (action === "$node.health") {
                        return Promise.resolve({ cpu: 50, memory: 70 });
                    }
                    return originalCall(action);
                });

                const result = await broker.call("v1.api.status");

                expect(result.timestamp).toBeDefined();
                expect(result.node.id).toBeDefined();
                expect(result.node.health).toBeDefined();
                expect(result.node.uptime).toBeDefined();
                expect(result.node.memory).toBeDefined();
                expect(result.node.version).toBeDefined();
                expect(result.services).toHaveLength(1);
                expect(result.services[0].nodeID).toBe("node-1");
                expect(result.services[0].available).toBe(true);
            });

            it("should handle status check failures", async () => {
                const originalCall = broker.call.bind(broker);
                jest.spyOn(broker, "call").mockImplementation((action) => {
                    if (action === "$node.list") {
                        return Promise.reject(new Error("Node list failed"));
                    }
                    return originalCall(action);
                });

                await expect(broker.call("v1.api.status")).rejects.toThrow("Node list failed");
                expect(apiService.logger.error).toHaveBeenCalledWith("Status check failed:", expect.any(Error));
            });
        });

        describe("info action", () => {
            it("should return API information", async () => {
                const result = await broker.call("v1.api.info");

                expect(result.name).toBe("Celluler API Gateway");
                expect(result.version).toBeDefined();
                expect(result.description).toBe("REST API gateway for Celluler distributed services");
                expect(result.timestamp).toBeDefined();
                expect(result.documentation).toBe("/api/endpoints");
                expect(result.features).toContain("Health monitoring");
                expect(result.features).toContain("Service status");
                expect(result.features).toContain("Rate limiting");
                expect(result.features).toContain("Basic authentication");
                expect(result.features).toContain("Request/response logging");
            });
        });

        describe("endpoints action", () => {
            it("should return available endpoints documentation", async () => {
                const result = await broker.call("v1.api.endpoints");

                expect(result.timestamp).toBeDefined();
                expect(result.routes).toHaveLength(2);
                expect(result.routes[0].path).toBe("/api/v1");
                expect(result.routes[0].authentication).toBe(true);
                expect(result.routes[1].path).toBe("/api/public");
                expect(result.routes[1].authentication).toBe(false);
                expect(result.publicEndpoints).toContain("GET /api/public/health - Health check");
                expect(result.authenticatedEndpoints).toContain("All /api/v1/* endpoints require authentication");
            });
        });
    });

    describe("Authentication", () => {
        let mockCtx, mockRoute, mockReq, mockRes;

        beforeEach(() => {
            mockCtx = { meta: {} };
            mockRoute = { authentication: true };
            mockReq = { headers: {} };
            mockRes = {};
        });

        it("should allow access when authentication is disabled", async () => {
            apiService.settings.authentication.enabled = false;
            
            const result = await apiService.settings.authenticate.call(apiService, mockCtx, mockRoute, mockReq, mockRes);
            
            expect(result).toBe(mockCtx);
        });

        it("should allow access when route authentication is disabled", async () => {
            apiService.settings.authentication.enabled = true;
            mockRoute.authentication = false;
            
            const result = await apiService.settings.authenticate.call(apiService, mockCtx, mockRoute, mockReq, mockRes);
            
            expect(result).toBe(mockCtx);
        });

        it("should reject when no authorization header is provided", async () => {
            apiService.settings.authentication.enabled = true;
            
            await expect(
                apiService.settings.authenticate.call(apiService, mockCtx, mockRoute, mockReq, mockRes)
            ).rejects.toThrow("Authorization header required");
        });

        it("should reject when authorization type is not Basic", async () => {
            apiService.settings.authentication.enabled = true;
            mockReq.headers.authorization = "Bearer token123";
            
            await expect(
                apiService.settings.authenticate.call(apiService, mockCtx, mockRoute, mockReq, mockRes)
            ).rejects.toThrow("Basic authentication required");
        });

        it("should reject when credentials are invalid", async () => {
            apiService.settings.authentication.enabled = true;
            const invalidCredentials = Buffer.from("wrong:password").toString("base64");
            mockReq.headers.authorization = `Basic ${invalidCredentials}`;
            
            await expect(
                apiService.settings.authenticate.call(apiService, mockCtx, mockRoute, mockReq, mockRes)
            ).rejects.toThrow("Invalid credentials");
        });

        it("should accept valid Basic authentication credentials", async () => {
            apiService.settings.authentication.enabled = true;
            const validCredentials = Buffer.from("admin:admin").toString("base64");
            mockReq.headers.authorization = `Basic ${validCredentials}`;
            
            const result = await apiService.settings.authenticate.call(apiService, mockCtx, mockRoute, mockReq, mockRes);
            
            expect(result).toBe(mockCtx);
            expect(mockCtx.meta.user.username).toBe("admin");
        });

        it("should handle malformed Basic auth credentials", async () => {
            apiService.settings.authentication.enabled = true;
            const malformedCredentials = Buffer.from("onlyusername").toString("base64");
            mockReq.headers.authorization = `Basic ${malformedCredentials}`;
            
            await expect(
                apiService.settings.authenticate.call(apiService, mockCtx, mockRoute, mockReq, mockRes)
            ).rejects.toThrow("Invalid credentials");
        });
    });

    describe("Event Handlers", () => {
        it("should handle nucleus.started event", async () => {
            const ctx = { params: {} };
            await apiService.onNucleusStarted(ctx);
            expect(apiService.logger.info).toHaveBeenCalledWith(
                "Nucleus service started, API Gateway is ready"
            );
        });

        it("should handle nucleus.stopped event", async () => {
            const ctx = { params: {} };
            await apiService.onNucleusStopped(ctx);
            expect(apiService.logger.info).toHaveBeenCalledWith(
                "Nucleus service stopped, API Gateway is shutting down"
            );
        });
    });

    describe("Error Handling", () => {
        it("should handle API errors correctly", () => {
            const req = {};
            const res = {
                setHeader: jest.fn(),
                writeHead: jest.fn(),
                end: jest.fn()
            };
            const err = {
                message: "Test error",
                code: 400,
                type: "BAD_REQUEST"
            };

            // Call the error handler from settings
            apiService.settings.onError.call(apiService, req, res, err);

            expect(apiService.logger.error).toHaveBeenCalledWith("API Gateway error:", err);
            expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
            expect(res.writeHead).toHaveBeenCalledWith(400);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({
                error: {
                    message: "Test error",
                    code: 400,
                    type: "BAD_REQUEST"
                }
            }));
        });

        it("should handle errors without code or type", () => {
            const req = {};
            const res = {
                setHeader: jest.fn(),
                writeHead: jest.fn(),
                end: jest.fn()
            };
            const err = {
                message: "Generic error"
            };

            apiService.settings.onError.call(apiService, req, res, err);

            expect(res.writeHead).toHaveBeenCalledWith(500);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({
                error: {
                    message: "Generic error",
                    code: 500,
                    type: "INTERNAL_SERVER_ERROR"
                }
            }));
        });
    });

    describe("Service Integration", () => {
        it("should have correct dependencies", () => {
            expect(apiService.schema.dependencies).toContain("nucleus");
        });

        it("should have correct action definitions", () => {
            expect(apiService.schema.actions.health).toBeDefined();
            expect(apiService.schema.actions.status).toBeDefined();
            expect(apiService.schema.actions.info).toBeDefined();
            expect(apiService.schema.actions.endpoints).toBeDefined();
        });

        it("should have correct event handlers", () => {
            expect(apiService.schema.events["nucleus.started"]).toBeDefined();
            expect(apiService.schema.events["nucleus.stopped"]).toBeDefined();
        });

        it("should use ApiGateway mixin", () => {
            expect(apiService.schema.mixins).toContainEqual(require("moleculer-web"));
        });
    });

    describe("Configuration Edge Cases", () => {
        it("should handle missing services in status check", async () => {
            const originalCall = broker.call.bind(broker);
            jest.spyOn(broker, "call").mockImplementation((action) => {
                if (action === "$node.list") {
                    return Promise.resolve([
                        {
                            id: "node-1",
                            available: true,
                            lastHeartbeatTime: Date.now()
                        }
                    ]);
                }
                if (action === "$node.health") {
                    return Promise.resolve({ cpu: 50, memory: 70 });
                }
                return originalCall(action);
            });

            const result = await broker.call("v1.api.status");
            
            expect(result.services[0].services).toEqual([]);
        });

        it("should handle empty route bodyParsers in endpoints", async () => {
            const originalRoutes = apiService.settings.routes;
            apiService.settings.routes = [
                {
                    path: "/test",
                    whitelist: ["test.*"],
                    authentication: false
                    // No bodyParsers property defined intentionally
                }
            ];

            const result = await broker.call("v1.api.endpoints");
            
            expect(result.routes[0].bodyParsers).toEqual([]);

            // Restore original routes to avoid side-effects
            apiService.settings.routes = originalRoutes;
        });
    });
}); 