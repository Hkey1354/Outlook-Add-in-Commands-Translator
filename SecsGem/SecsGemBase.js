/**
 * SECS/GEM Base Communication Module
 * Implements SEMI E5 (SECS-II) and E30 (GEM) standards for equipment communication
 *
 * @module SecsGem/SecsGemBase
 */

(function (global) {
    'use strict';

    /**
     * SECS-II Data Types as per SEMI E5
     */
    var SecsDataType = {
        LIST: 0x00,      // List
        BINARY: 0x08,    // Binary
        BOOLEAN: 0x09,   // Boolean
        ASCII: 0x10,     // ASCII String
        JIS8: 0x11,      // JIS-8 String
        INT8: 0x18,      // 8-bit signed integer
        INT1: 0x19,      // 1-byte signed integer
        INT2: 0x1A,      // 2-byte signed integer
        INT4: 0x1C,      // 4-byte signed integer
        INT8_LONG: 0x20, // 8-byte signed integer
        FLOAT4: 0x24,    // 4-byte floating point
        FLOAT8: 0x28,    // 8-byte floating point
        UINT1: 0x29,     // 1-byte unsigned integer
        UINT2: 0x2A,     // 2-byte unsigned integer
        UINT4: 0x2C,     // 4-byte unsigned integer
        UINT8: 0x30      // 8-byte unsigned integer
    };

    /**
     * Communication State Machine States
     */
    var CommState = {
        NOT_COMMUNICATING: 'NOT_COMMUNICATING',
        WAIT_CR: 'WAIT_CR',
        WAIT_DELAY: 'WAIT_DELAY',
        COMMUNICATING: 'COMMUNICATING'
    };

    /**
     * Control State Machine States (GEM)
     */
    var ControlState = {
        OFFLINE: 'OFFLINE',
        ATTEMPT_ONLINE: 'ATTEMPT_ONLINE',
        HOST_OFFLINE: 'HOST_OFFLINE',
        ONLINE_LOCAL: 'ONLINE_LOCAL',
        ONLINE_REMOTE: 'ONLINE_REMOTE'
    };

    /**
     * SECS Message Structure
     * @class
     * @param {number} stream - Stream number
     * @param {number} func - Function number
     * @param {boolean} wbit - Wait bit (expects reply)
     * @param {*} data - Message data
     */
    function SecsMessage(stream, func, wbit, data) {
        this.stream = stream;
        this.func = func;
        this.wbit = wbit || false;
        this.data = data;
        this.systemBytes = SecsMessage.generateSystemBytes();
        this.timestamp = new Date();
    }

    SecsMessage.systemBytesCounter = 0;

    SecsMessage.generateSystemBytes = function () {
        SecsMessage.systemBytesCounter = (SecsMessage.systemBytesCounter + 1) & 0xFFFFFFFF;
        return SecsMessage.systemBytesCounter;
    };

    SecsMessage.prototype.getName = function () {
        return 'S' + this.stream + 'F' + this.func;
    };

    SecsMessage.prototype.toObject = function () {
        return {
            stream: this.stream,
            func: this.func,
            wbit: this.wbit,
            data: this.data,
            systemBytes: this.systemBytes,
            timestamp: this.timestamp.toISOString()
        };
    };

    /**
     * SECS/GEM Communication Handler
     * @class
     * @param {Object} config - Configuration options
     */
    function SecsGemHandler(config) {
        this.config = config || {};
        this.deviceId = config.deviceId || 0;
        this.host = config.host || 'localhost';
        this.port = config.port || 5000;
        this.isActive = config.isActive || false;
        this.t3Timeout = config.t3Timeout || 45000; // Reply timeout
        this.t5Timeout = config.t5Timeout || 10000; // Connect separation timeout
        this.t6Timeout = config.t6Timeout || 5000;  // Control transaction timeout
        this.t7Timeout = config.t7Timeout || 10000; // Not selected timeout

        this.commState = CommState.NOT_COMMUNICATING;
        this.controlState = ControlState.OFFLINE;
        this.connected = false;
        this.socket = null;

        this.pendingReplies = {};
        this.messageHandlers = {};
        this.eventCallbacks = {};
    }

    /**
     * Register a callback for events
     */
    SecsGemHandler.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit an event
     */
    SecsGemHandler.prototype.emit = function (event, data) {
        var callbacks = this.eventCallbacks[event];
        if (callbacks) {
            for (var i = 0; i < callbacks.length; i++) {
                try {
                    callbacks[i](data);
                } catch (e) {
                    console.error('Event callback error:', e);
                }
            }
        }
    };

    /**
     * Register a message handler for specific stream/function
     */
    SecsGemHandler.prototype.registerHandler = function (stream, func, handler) {
        var key = 'S' + stream + 'F' + func;
        this.messageHandlers[key] = handler;
    };

    /**
     * Connect to equipment or host
     */
    SecsGemHandler.prototype.connect = function (callback) {
        var self = this;
        this.commState = CommState.WAIT_CR;

        // Simulate connection (in real implementation, use WebSocket or TCP)
        setTimeout(function () {
            self.connected = true;
            self.commState = CommState.COMMUNICATING;
            self.emit('connected', { host: self.host, port: self.port });
            if (callback) callback(null, true);
        }, 100);
    };

    /**
     * Disconnect from equipment or host
     */
    SecsGemHandler.prototype.disconnect = function (callback) {
        var self = this;
        this.connected = false;
        this.commState = CommState.NOT_COMMUNICATING;
        this.controlState = ControlState.OFFLINE;
        this.emit('disconnected', {});
        if (callback) callback(null, true);
    };

    /**
     * Send a SECS message
     */
    SecsGemHandler.prototype.send = function (message, callback) {
        var self = this;

        if (!this.connected) {
            var error = new Error('Not connected');
            if (callback) callback(error);
            return;
        }

        this.emit('messageSent', message);

        // If expecting reply, store pending
        if (message.wbit) {
            this.pendingReplies[message.systemBytes] = {
                message: message,
                callback: callback,
                timeout: setTimeout(function () {
                    delete self.pendingReplies[message.systemBytes];
                    if (callback) callback(new Error('T3 timeout'));
                }, this.t3Timeout)
            };
        } else {
            if (callback) callback(null, message);
        }

        return message;
    };

    /**
     * Process received message
     */
    SecsGemHandler.prototype.processMessage = function (message) {
        var key = message.getName();

        // Check if it's a reply to a pending message
        if (message.func % 2 === 0) {
            var pending = this.pendingReplies[message.systemBytes];
            if (pending) {
                clearTimeout(pending.timeout);
                delete this.pendingReplies[message.systemBytes];
                if (pending.callback) pending.callback(null, message);
                return;
            }
        }

        // Find and call registered handler
        var handler = this.messageHandlers[key];
        if (handler) {
            handler.call(this, message);
        } else {
            this.emit('unhandledMessage', message);
        }
    };

    /**
     * Serialize SECS data item
     */
    SecsGemHandler.prototype.serializeData = function (item) {
        if (item === null || item === undefined) {
            return { type: SecsDataType.LIST, length: 0, value: [] };
        }

        if (Array.isArray(item)) {
            var serialized = [];
            for (var i = 0; i < item.length; i++) {
                serialized.push(this.serializeData(item[i]));
            }
            return { type: SecsDataType.LIST, length: item.length, value: serialized };
        }

        if (typeof item === 'object' && item.type !== undefined) {
            return item;
        }

        if (typeof item === 'string') {
            return { type: SecsDataType.ASCII, length: item.length, value: item };
        }

        if (typeof item === 'number') {
            if (Number.isInteger(item)) {
                if (item >= 0) {
                    return { type: SecsDataType.UINT4, length: 4, value: item };
                }
                return { type: SecsDataType.INT4, length: 4, value: item };
            }
            return { type: SecsDataType.FLOAT8, length: 8, value: item };
        }

        if (typeof item === 'boolean') {
            return { type: SecsDataType.BOOLEAN, length: 1, value: item };
        }

        return { type: SecsDataType.ASCII, length: 0, value: '' };
    };

    /**
     * Create SECS data item with specific type
     */
    SecsGemHandler.createDataItem = function (type, value) {
        return {
            type: type,
            value: value,
            length: Array.isArray(value) ? value.length : (typeof value === 'string' ? value.length : 1)
        };
    };

    // Export to global
    global.SecsDataType = SecsDataType;
    global.CommState = CommState;
    global.ControlState = ControlState;
    global.SecsMessage = SecsMessage;
    global.SecsGemHandler = SecsGemHandler;

})(typeof window !== 'undefined' ? window : global);
