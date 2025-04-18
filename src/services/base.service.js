import { Service } from 'moleculer';

// Default cell configuration
const DEFAULT_CELL_CONFIG = {
    storage: 'file',
    path: './data',
    encryption: true,
    persistence: true,
    replication: true
};

export default class BaseService extends Service {
    constructor(broker, cellConfig = DEFAULT_CELL_CONFIG) {
        super(broker);
        this.cellConfig = cellConfig;
    }
} 