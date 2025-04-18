import b4a from 'b4a'

export function getCoreInfo(core, name = null) {
    return {
        id: core.id,
        key: b4a.toString(core.discoveryKey, 'hex'),
        length: core.length,
    }
} 