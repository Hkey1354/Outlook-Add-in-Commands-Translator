/**
 * MES (Manufacturing Execution System) Communication Interface
 * Host-side implementation for receiving and processing S6F11 event reports from equipment
 *
 * This module acts as the HOST in SECS/GEM communication:
 * - Receives S6F11 event reports from equipment
 * - Sends S6F12 acknowledgments
 * - Defines reports and links events (S2F33, S2F35, S2F37)
 * - Queries equipment constants and status variables
 *
 * @module SecsGem/MESInterface
 */

(function (global) {
    'use strict';

    /**
     * MES Interface for SECS/GEM communication
     * @class
     * @param {Object} config - Configuration options
     */
    function MESInterface(config) {
        config = config || {};

        // Create SECS/GEM handler in HOST mode (isActive = true)
        this.secsHandler = new SecsGemHandler({
            deviceId: config.deviceId || 0,
            host: config.host || 'localhost',
            port: config.port || 5000,
            isActive: true, // Host initiates communication
            t3Timeout: config.t3Timeout || 45000,
            t5Timeout: config.t5Timeout || 10000,
            t6Timeout: config.t6Timeout || 5000,
            t7Timeout: config.t7Timeout || 10000
        });

        // Equipment registry
        this.equipmentRegistry = {};

        // Event report handlers by CEID
        this.eventHandlers = {};

        // Event callbacks
        this.eventCallbacks = {};

        // Configuration
        this.autoAcknowledge = config.autoAcknowledge !== false;

        this._registerHandlers();
    }

    /**
     * Register SECS message handlers for host operation
     */
    MESInterface.prototype._registerHandlers = function () {
        var self = this;

        // S6F11 - Event Report Send (from equipment)
        this.secsHandler.registerHandler(6, 11, function (message) {
            self._handleS6F11(message);
        });

        // S1F1 - Are You There Request
        this.secsHandler.registerHandler(1, 1, function (message) {
            self._handleS1F1(message);
        });

        // S1F13 - Establish Communications Request
        this.secsHandler.registerHandler(1, 13, function (message) {
            self._handleS1F13(message);
        });

        // S5F1 - Alarm Report Send
        this.secsHandler.registerHandler(5, 1, function (message) {
            self._handleS5F1(message);
        });

        // S6F1 - Trace Data Send
        this.secsHandler.registerHandler(6, 1, function (message) {
            self._handleS6F1(message);
        });
    };

    /**
     * Register event callback
     */
    MESInterface.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit event
     */
    MESInterface.prototype.emit = function (event, data) {
        var callbacks = this.eventCallbacks[event];
        if (callbacks) {
            for (var i = 0; i < callbacks.length; i++) {
                try {
                    callbacks[i](data);
                } catch (e) {
                    console.error('MES event callback error:', e);
                }
            }
        }
    };

    /**
     * Connect to equipment
     * @param {string} equipmentId - Equipment identifier
     * @param {Object} options - Connection options (host, port)
     * @param {Function} callback - Callback (err, result)
     */
    MESInterface.prototype.connect = function (equipmentId, options, callback) {
        var self = this;
        options = options || {};

        this.secsHandler.host = options.host || this.secsHandler.host;
        this.secsHandler.port = options.port || this.secsHandler.port;

        this.secsHandler.connect(function (err, result) {
            if (err) {
                if (callback) callback(err);
                return;
            }

            // Register equipment
            self.equipmentRegistry[equipmentId] = {
                id: equipmentId,
                host: self.secsHandler.host,
                port: self.secsHandler.port,
                connected: true,
                lastCommunication: new Date()
            };

            self.emit('equipmentConnected', {
                equipmentId: equipmentId,
                host: self.secsHandler.host,
                port: self.secsHandler.port
            });

            // Send S1F13 to establish communications
            self.establishCommunications(function (commErr, commResult) {
                if (callback) callback(commErr, commResult);
            });
        });
    };

    /**
     * Disconnect from equipment
     */
    MESInterface.prototype.disconnect = function (equipmentId, callback) {
        var self = this;

        this.secsHandler.disconnect(function (err) {
            if (self.equipmentRegistry[equipmentId]) {
                self.equipmentRegistry[equipmentId].connected = false;
            }

            self.emit('equipmentDisconnected', { equipmentId: equipmentId });

            if (callback) callback(err);
        });
    };

    /**
     * Establish communications (S1F13/S1F14)
     */
    MESInterface.prototype.establishCommunications = function (callback) {
        var message = new SecsMessage(1, 13, true, {
            type: SecsDataType.LIST,
            length: 0,
            value: []
        });

        this.secsHandler.send(message, function (err, reply) {
            if (callback) callback(err, reply);
        });
    };

    /**
     * Register handler for specific collection event
     * @param {number} ceid - Collection Event ID
     * @param {Function} handler - Handler function (eventData)
     */
    MESInterface.prototype.registerEventHandler = function (ceid, handler) {
        this.eventHandlers[ceid] = handler;
        return this;
    };

    /**
     * Handle S6F11 - Event Report Send
     */
    MESInterface.prototype._handleS6F11 = function (message) {
        var self = this;

        // Parse the event report
        var eventReport = this._parseS6F11(message);

        // Update last communication time
        for (var eqId in this.equipmentRegistry) {
            if (this.equipmentRegistry[eqId].connected) {
                this.equipmentRegistry[eqId].lastCommunication = new Date();
            }
        }

        // Emit general event
        this.emit('eventReport', eventReport);

        // Call specific handler if registered
        var handler = this.eventHandlers[eventReport.ceid];
        if (handler) {
            try {
                handler(eventReport);
            } catch (e) {
                console.error('Event handler error for CEID ' + eventReport.ceid + ':', e);
            }
        }

        // Send S6F12 acknowledge if auto-acknowledge is enabled
        if (this.autoAcknowledge) {
            this.sendS6F12(AckCode.ACCEPTED, message.systemBytes);
        }
    };

    /**
     * Parse S6F11 message
     */
    MESInterface.prototype._parseS6F11 = function (message) {
        var result = {
            dataId: null,
            ceid: null,
            reports: [],
            timestamp: new Date(),
            rawMessage: message
        };

        try {
            var data = message.data;
            if (data && data.value) {
                result.dataId = data.value[0].value;
                result.ceid = data.value[1].value;

                var reports = data.value[2].value || [];
                for (var i = 0; i < reports.length; i++) {
                    var rptData = reports[i].value;
                    var report = {
                        rptId: rptData[0].value,
                        variables: []
                    };

                    var vars = rptData[1].value || [];
                    for (var j = 0; j < vars.length; j++) {
                        report.variables.push({
                            type: vars[j].type,
                            value: vars[j].value
                        });
                    }

                    result.reports.push(report);
                }
            }
        } catch (e) {
            console.error('Error parsing S6F11:', e);
            result.parseError = e.message;
        }

        return result;
    };

    /**
     * Send S6F12 - Event Report Acknowledge
     * @param {number} ackCode - Acknowledge code
     * @param {number} systemBytes - System bytes from original message
     */
    MESInterface.prototype.sendS6F12 = function (ackCode, systemBytes) {
        var message = new SecsMessage(6, 12, false, {
            type: SecsDataType.BINARY,
            value: ackCode
        });
        message.systemBytes = systemBytes;

        return this.secsHandler.send(message);
    };

    /**
     * Handle S1F1 - Are You There
     */
    MESInterface.prototype._handleS1F1 = function (message) {
        // Send S1F2 response
        var response = new SecsMessage(1, 2, false, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.ASCII, 'MES'),
                SecsGemHandler.createDataItem(SecsDataType.ASCII, '1.0.0')
            ]
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S1F13 - Establish Communications Request
     */
    MESInterface.prototype._handleS1F13 = function (message) {
        // Send S1F14 response (accept)
        var response = new SecsMessage(1, 14, false, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.BINARY, 0), // COMMACK = 0 (accepted)
                {
                    type: SecsDataType.LIST,
                    length: 2,
                    value: [
                        SecsGemHandler.createDataItem(SecsDataType.ASCII, 'MES'),
                        SecsGemHandler.createDataItem(SecsDataType.ASCII, '1.0.0')
                    ]
                }
            ]
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);

        this.emit('communicationsEstablished', { message: message });
    };

    /**
     * Handle S5F1 - Alarm Report Send
     */
    MESInterface.prototype._handleS5F1 = function (message) {
        var alarmData = {
            timestamp: new Date(),
            rawMessage: message
        };

        try {
            if (message.data && message.data.value) {
                alarmData.alarmSet = message.data.value[0].value; // ALCD
                alarmData.alarmId = message.data.value[1].value;  // ALID
                alarmData.alarmText = message.data.value[2].value; // ALTX
            }
        } catch (e) {
            console.error('Error parsing S5F1:', e);
        }

        this.emit('alarm', alarmData);

        // Send S5F2 acknowledge
        var response = new SecsMessage(5, 2, false, {
            type: SecsDataType.BINARY,
            value: 0 // ACKC5 = 0 (accepted)
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S6F1 - Trace Data Send
     */
    MESInterface.prototype._handleS6F1 = function (message) {
        this.emit('traceData', {
            timestamp: new Date(),
            rawMessage: message
        });

        // Send S6F2 acknowledge
        var response = new SecsMessage(6, 2, false, {
            type: SecsDataType.BINARY,
            value: 0
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Define reports on equipment (S2F33)
     * @param {Array} reports - Array of report definitions [{rptId, vids}]
     * @param {Function} callback - Callback function
     */
    MESInterface.prototype.defineReports = function (reports, callback) {
        var reportList = [];

        for (var i = 0; i < reports.length; i++) {
            var rpt = reports[i];
            var vidList = [];

            for (var j = 0; j < rpt.vids.length; j++) {
                vidList.push(SecsGemHandler.createDataItem(SecsDataType.UINT4, rpt.vids[j]));
            }

            reportList.push({
                type: SecsDataType.LIST,
                length: 2,
                value: [
                    SecsGemHandler.createDataItem(SecsDataType.UINT4, rpt.rptId),
                    { type: SecsDataType.LIST, length: vidList.length, value: vidList }
                ]
            });
        }

        var message = new SecsMessage(2, 33, true, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.UINT4, 0), // DATAID
                { type: SecsDataType.LIST, length: reportList.length, value: reportList }
            ]
        });

        this.secsHandler.send(message, function (err, reply) {
            if (callback) callback(err, reply);
        });
    };

    /**
     * Link reports to collection events (S2F35)
     * @param {Array} links - Array of event-report links [{ceid, rptIds}]
     * @param {Function} callback - Callback function
     */
    MESInterface.prototype.linkReports = function (links, callback) {
        var linkList = [];

        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            var rptIdList = [];

            for (var j = 0; j < link.rptIds.length; j++) {
                rptIdList.push(SecsGemHandler.createDataItem(SecsDataType.UINT4, link.rptIds[j]));
            }

            linkList.push({
                type: SecsDataType.LIST,
                length: 2,
                value: [
                    SecsGemHandler.createDataItem(SecsDataType.UINT4, link.ceid),
                    { type: SecsDataType.LIST, length: rptIdList.length, value: rptIdList }
                ]
            });
        }

        var message = new SecsMessage(2, 35, true, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.UINT4, 0), // DATAID
                { type: SecsDataType.LIST, length: linkList.length, value: linkList }
            ]
        });

        this.secsHandler.send(message, function (err, reply) {
            if (callback) callback(err, reply);
        });
    };

    /**
     * Enable/Disable collection events (S2F37)
     * @param {boolean} enable - Enable or disable
     * @param {Array} ceids - Array of CEIDs (empty for all)
     * @param {Function} callback - Callback function
     */
    MESInterface.prototype.setEventsEnabled = function (enable, ceids, callback) {
        var ceidList = [];

        for (var i = 0; i < ceids.length; i++) {
            ceidList.push(SecsGemHandler.createDataItem(SecsDataType.UINT4, ceids[i]));
        }

        var message = new SecsMessage(2, 37, true, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.BOOLEAN, enable),
                { type: SecsDataType.LIST, length: ceidList.length, value: ceidList }
            ]
        });

        this.secsHandler.send(message, function (err, reply) {
            if (callback) callback(err, reply);
        });
    };

    /**
     * Request equipment constants (S2F13)
     * @param {Array} ecids - Array of EC IDs (empty for all)
     * @param {Function} callback - Callback function
     */
    MESInterface.prototype.requestEquipmentConstants = function (ecids, callback) {
        var ecidList = [];

        for (var i = 0; i < ecids.length; i++) {
            ecidList.push(SecsGemHandler.createDataItem(SecsDataType.UINT4, ecids[i]));
        }

        var message = new SecsMessage(2, 13, true, {
            type: SecsDataType.LIST,
            length: ecidList.length,
            value: ecidList
        });

        this.secsHandler.send(message, function (err, reply) {
            if (callback) callback(err, reply);
        });
    };

    /**
     * Set equipment constants (S2F15)
     * @param {Array} ecValues - Array of EC values [{ecid, value}]
     * @param {Function} callback - Callback function
     */
    MESInterface.prototype.setEquipmentConstants = function (ecValues, callback) {
        var self = this;
        var ecList = [];

        for (var i = 0; i < ecValues.length; i++) {
            var ec = ecValues[i];
            ecList.push({
                type: SecsDataType.LIST,
                length: 2,
                value: [
                    SecsGemHandler.createDataItem(SecsDataType.UINT4, ec.ecid),
                    self.secsHandler.serializeData(ec.value)
                ]
            });
        }

        var message = new SecsMessage(2, 15, true, {
            type: SecsDataType.LIST,
            length: ecList.length,
            value: ecList
        });

        this.secsHandler.send(message, function (err, reply) {
            if (callback) callback(err, reply);
        });
    };

    /**
     * Request status variables (S1F3)
     * @param {Array} svids - Array of SV IDs (empty for all)
     * @param {Function} callback - Callback function
     */
    MESInterface.prototype.requestStatusVariables = function (svids, callback) {
        var svidList = [];

        for (var i = 0; i < svids.length; i++) {
            svidList.push(SecsGemHandler.createDataItem(SecsDataType.UINT4, svids[i]));
        }

        var message = new SecsMessage(1, 3, true, {
            type: SecsDataType.LIST,
            length: svidList.length,
            value: svidList
        });

        this.secsHandler.send(message, function (err, reply) {
            if (callback) callback(err, reply);
        });
    };

    /**
     * Request event report (S6F15)
     * @param {number} ceid - Collection Event ID
     * @param {Function} callback - Callback function
     */
    MESInterface.prototype.requestEventReport = function (ceid, callback) {
        var message = new SecsMessage(6, 15, true, {
            type: SecsDataType.UINT4,
            value: ceid
        });

        this.secsHandler.send(message, callback);
    };

    /**
     * Send remote command (S2F41)
     * @param {string} rcmd - Remote command name
     * @param {Array} params - Command parameters [{cpname, cpval}]
     * @param {Function} callback - Callback function
     */
    MESInterface.prototype.sendRemoteCommand = function (rcmd, params, callback) {
        var self = this;
        var paramList = [];

        for (var i = 0; i < params.length; i++) {
            var param = params[i];
            paramList.push({
                type: SecsDataType.LIST,
                length: 2,
                value: [
                    SecsGemHandler.createDataItem(SecsDataType.ASCII, param.cpname),
                    self.secsHandler.serializeData(param.cpval)
                ]
            });
        }

        var message = new SecsMessage(2, 41, true, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.ASCII, rcmd),
                { type: SecsDataType.LIST, length: paramList.length, value: paramList }
            ]
        });

        this.secsHandler.send(message, function (err, reply) {
            if (callback) callback(err, reply);
        });
    };

    /**
     * Get connected equipment list
     */
    MESInterface.prototype.getConnectedEquipment = function () {
        var connected = [];
        for (var eqId in this.equipmentRegistry) {
            if (this.equipmentRegistry[eqId].connected) {
                connected.push(this.equipmentRegistry[eqId]);
            }
        }
        return connected;
    };

    // Export to global
    global.MESInterface = MESInterface;

})(typeof window !== 'undefined' ? window : global);
