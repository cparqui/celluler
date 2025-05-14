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
    });

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
    });

    describe("Service Creation", () => {
        it("should create service with correct name", () => {
            expect(apiService.name).toBe("api");
        });

        it("should have correct version", () => {
            expect(apiService.version).toBe(1);
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
            expect(apiService.settings.routes[0].whitelist).toContain("$node.*");
        });

        it("should have correct mapping policy", () => {
            expect(apiService.settings.routes[0].mappingPolicy).toBe("restrict");
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
    });
}); 