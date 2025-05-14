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

    // Routes configuration
    routes: [
        {
            path: "/api",
            whitelist: [
                "nucleus.*",
                "$node.*"
            ],
            mappingPolicy: "restrict",
            bodyParsers: {
                json: true,
                urlencoded: { extended: true }
            }
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
            events: {
                "nucleus.started": this.onNucleusStarted,
                "nucleus.stopped": this.onNucleusStopped
            }
        });
    }

    async onNucleusStarted(ctx) {
        this.logger.info("Nucleus service started, API Gateway is ready");
    }

    async onNucleusStopped(ctx) {
        this.logger.info("Nucleus service stopped, API Gateway is shutting down");
    }
} 