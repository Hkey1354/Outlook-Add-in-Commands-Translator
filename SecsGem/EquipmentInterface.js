/**
 * Equipment Communication Interface
 * Equipment-side implementation for SECS/GEM communication with MES
 *
 * This module acts as the EQUIPMENT in SECS/GEM communication:
 * - Sends S6F11 event reports to MES
 * - Responds to host requests for EC, SV, and reports
 * - Manages equipment state per GEM standard
 *
 * @module SecsGem/EquipmentInterface
 */

(function (global) {
    'use strict';

    /**
     * Equipment Process States
     */
    var ProcessState = {
        INIT: 0,
        IDLE: 1,
        SETUP: 2,
        READY: 3,
        EXECUTING: 4,
        PAUSED: 5,
        COMPLETE: 6,
        ABORTING: 7,
        ABORTED: 8
    };

    /**
     * Equipment Interface for SECS/GEM communication
     * @class
     * @param {Object} config - Configuration options
     */
    function EquipmentInterface(config) {
        config = config || {};

        this.modelName = config.modelName || 'Equipment';
        this.softwareRevision = config.softwareRevision || '1.0.0';
        this.equipmentId = config.equipmentId || 'EQ001';

        // Create SECS/GEM handler in EQUIPMENT mode (isActive = false, waits for connection)
        this.secsHandler = new SecsGemHandler({
            deviceId: config.deviceId || 0,
            host: config.host || 'localhost',
            port: config.port || 5000,
            isActive: false, // Equipment waits for host connection
            t3Timeout: config.t3Timeout || 45000,
            t5Timeout: config.t5Timeout || 10000,
            t6Timeout: config.t6Timeout || 5000,
            t7Timeout: config.t7Timeout || 10000
        });

        // Create EC System
        this.ecSystem = new ECSystem(this.secsHandler);

        // Create S6F11 Handler
        this.s6f11Handler = new S6F11Handler(this.secsHandler, this.ecSystem);

        // Current states
        this.controlState = ControlState.OFFLINE;
        this.processState = ProcessState.INIT;

        // Event callbacks
        this.eventCallbacks = {};

        // Alarm tracking
        this.activeAlarms = {};

        this._registerHandlers();
        this._initializeDefaultReports();
    }

    /**
     * Register SECS message handlers
     */
    EquipmentInterface.prototype._registerHandlers = function () {
        var self = this;

        // S1F1 - Are You There (Host asks if equipment is alive)
        this.secsHandler.registerHandler(1, 1, function (message) {
            self._handleS1F1(message);
        });

        // S1F13 - Establish Communications Request
        this.secsHandler.registerHandler(1, 13, function (message) {
            self._handleS1F13(message);
        });

        // S1F15 - Request Offline
        this.secsHandler.registerHandler(1, 15, function (message) {
            self._handleS1F15(message);
        });

        // S1F17 - Request Online
        this.secsHandler.registerHandler(1, 17, function (message) {
            self._handleS1F17(message);
        });

        // S2F41 - Host Command Send
        this.secsHandler.registerHandler(2, 41, function (message) {
            self._handleS2F41(message);
        });

        // S5F3 - Enable/Disable Alarm Send
        this.secsHandler.registerHandler(5, 3, function (message) {
            self._handleS5F3(message);
        });

        // S7F1 - Process Program Load Inquire
        this.secsHandler.registerHandler(7, 1, function (message) {
            self._handleS7F1(message);
        });

        // S7F5 - Process Program Request
        this.secsHandler.registerHandler(7, 5, function (message) {
            self._handleS7F5(message);
        });

        // Forward events from sub-handlers
        this.s6f11Handler.on('eventReportAcknowledged', function (data) {
            self.emit('eventReportAcknowledged', data);
        });

        this.ecSystem.on('ecChanged', function (data) {
            self.emit('ecChanged', data);
        });
    };

    /**
     * Initialize default reports for common events
     */
    EquipmentInterface.prototype._initializeDefaultReports = function () {
        // Define standard report structures
        // Report 1: Process Status Report
        this.s6f11Handler.defineReport(1, ['ProcessState', 'PPExecName', 'Clock']);

        // Report 2: Process Results Report
        this.s6f11Handler.defineReport(2, ['ProcessState', 'ProcessResult', 'ProcessTime']);

        // Report 3: Alarm Report
        this.s6f11Handler.defineReport(3, ['AlarmId', 'AlarmText', 'AlarmSeverity']);

        // Report 4: Material Report
        this.s6f11Handler.defineReport(4, ['MaterialId', 'LotId', 'CarrierId', 'SlotNo']);

        // Report 5: Equipment Status Report
        this.s6f11Handler.defineReport(5, ['ControlState', 'ProcessState', 'AlarmsEnabled']);

        // Define data variables for reports
        this.ecSystem.defineDV({ dvid: 'ProcessState', dvname: 'ProcessState', dataType: ECDataType.UINT });
        this.ecSystem.defineDV({ dvid: 'PPExecName', dvname: 'PPExecName', dataType: ECDataType.ASCII });
        this.ecSystem.defineDV({ dvid: 'ProcessResult', dvname: 'ProcessResult', dataType: ECDataType.UINT });
        this.ecSystem.defineDV({ dvid: 'ProcessTime', dvname: 'ProcessTime', dataType: ECDataType.FLOAT });
        this.ecSystem.defineDV({ dvid: 'AlarmId', dvname: 'AlarmId', dataType: ECDataType.UINT });
        this.ecSystem.defineDV({ dvid: 'AlarmText', dvname: 'AlarmText', dataType: ECDataType.ASCII });
        this.ecSystem.defineDV({ dvid: 'AlarmSeverity', dvname: 'AlarmSeverity', dataType: ECDataType.UINT });
        this.ecSystem.defineDV({ dvid: 'MaterialId', dvname: 'MaterialId', dataType: ECDataType.ASCII });
        this.ecSystem.defineDV({ dvid: 'LotId', dvname: 'LotId', dataType: ECDataType.ASCII });
        this.ecSystem.defineDV({ dvid: 'CarrierId', dvname: 'CarrierId', dataType: ECDataType.ASCII });
        this.ecSystem.defineDV({ dvid: 'SlotNo', dvname: 'SlotNo', dataType: ECDataType.UINT });
    };

    /**
     * Register event callback
     */
    EquipmentInterface.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit event
     */
    EquipmentInterface.prototype.emit = function (event, data) {
        var callbacks = this.eventCallbacks[event];
        if (callbacks) {
            for (var i = 0; i < callbacks.length; i++) {
                try {
                    callbacks[i](data);
                } catch (e) {
                    console.error('Equipment event callback error:', e);
                }
            }
        }
    };

    /**
     * Start equipment (connect and wait for host)
     */
    EquipmentInterface.prototype.start = function (callback) {
        var self = this;

        this.secsHandler.connect(function (err, result) {
            if (err) {
                if (callback) callback(err);
                return;
            }

            self.controlState = ControlState.OFFLINE;
            self.processState = ProcessState.IDLE;

            self.emit('started', {
                equipmentId: self.equipmentId,
                modelName: self.modelName
            });

            if (callback) callback(null, result);
        });
    };

    /**
     * Stop equipment
     */
    EquipmentInterface.prototype.stop = function (callback) {
        var self = this;

        this.secsHandler.disconnect(function (err) {
            self.controlState = ControlState.OFFLINE;
            self.emit('stopped', { equipmentId: self.equipmentId });
            if (callback) callback(err);
        });
    };

    /**
     * Go online (Local or Remote)
     * @param {boolean} remote - True for remote control, false for local
     */
    EquipmentInterface.prototype.goOnline = function (remote, callback) {
        var self = this;
        var newState = remote ? ControlState.ONLINE_REMOTE : ControlState.ONLINE_LOCAL;
        var oldState = this.controlState;

        this.controlState = newState;

        // Send appropriate collection event
        var ceid = remote ? CollectionEvents.CONTROL_STATE_REMOTE : CollectionEvents.CONTROL_STATE_LOCAL;

        this.s6f11Handler.sendEventReport(ceid, {}, function (err, ackCode) {
            if (err) {
                self.controlState = oldState; // Revert on failure
                if (callback) callback(err);
                return;
            }

            self.emit('controlStateChanged', {
                oldState: oldState,
                newState: newState
            });

            if (callback) callback(null, ackCode);
        });
    };

    /**
     * Go offline
     */
    EquipmentInterface.prototype.goOffline = function (callback) {
        var self = this;
        var oldState = this.controlState;

        this.controlState = ControlState.OFFLINE;

        this.s6f11Handler.sendEventReport(CollectionEvents.EQUIPMENT_OFFLINE, {}, function (err, ackCode) {
            self.emit('controlStateChanged', {
                oldState: oldState,
                newState: ControlState.OFFLINE
            });

            if (callback) callback(err, ackCode);
        });
    };

    /**
     * Send S6F11 event report with parameters
     * @param {number} ceid - Collection Event ID
     * @param {Object} params - Parameters object with variable values
     * @param {Function} callback - Callback function
     */
    EquipmentInterface.prototype.sendEventReport = function (ceid, params, callback) {
        // Set variable values from params
        if (params) {
            for (var vid in params) {
                this.s6f11Handler.setVariable(vid, params[vid]);
            }
        }

        return this.s6f11Handler.sendEventReport(ceid, {}, callback);
    };

    /**
     * Send S6F11 with custom report data
     * @param {number} ceid - Collection Event ID
     * @param {Array} reportData - Array of report objects
     * @param {Function} callback - Callback function
     */
    EquipmentInterface.prototype.sendEventReportWithData = function (ceid, reportData, callback) {
        return this.s6f11Handler.sendEventReportWithData(ceid, reportData, callback);
    };

    /**
     * Report process started event
     * @param {Object} data - Process data {ppExecName, materialId, lotId}
     */
    EquipmentInterface.prototype.reportProcessStarted = function (data, callback) {
        data = data || {};

        this.processState = ProcessState.EXECUTING;
        this.ecSystem.setSVValue('ProcessState', ProcessState.EXECUTING);
        this.ecSystem.setSVValue('PPExecName', data.ppExecName || '');

        this.s6f11Handler.setVariable('ProcessState', ProcessState.EXECUTING);
        this.s6f11Handler.setVariable('PPExecName', data.ppExecName || '');
        this.s6f11Handler.setVariable('MaterialId', data.materialId || '');
        this.s6f11Handler.setVariable('LotId', data.lotId || '');

        return this.s6f11Handler.sendEventReport(CollectionEvents.PROCESSING_STARTED, {}, callback);
    };

    /**
     * Report process completed event
     * @param {Object} data - Process result data {result, processTime}
     */
    EquipmentInterface.prototype.reportProcessCompleted = function (data, callback) {
        data = data || {};

        this.processState = ProcessState.COMPLETE;
        this.ecSystem.setSVValue('ProcessState', ProcessState.COMPLETE);

        this.s6f11Handler.setVariable('ProcessState', ProcessState.COMPLETE);
        this.s6f11Handler.setVariable('ProcessResult', data.result || 0);
        this.s6f11Handler.setVariable('ProcessTime', data.processTime || 0);

        return this.s6f11Handler.sendEventReport(CollectionEvents.PROCESSING_COMPLETED, {}, callback);
    };

    /**
     * Report lot started event
     * @param {Object} data - Lot data {lotId, carrierId}
     */
    EquipmentInterface.prototype.reportLotStarted = function (data, callback) {
        data = data || {};

        this.s6f11Handler.setVariable('LotId', data.lotId || '');
        this.s6f11Handler.setVariable('CarrierId', data.carrierId || '');

        return this.s6f11Handler.sendEventReport(CollectionEvents.LOT_STARTED, {}, callback);
    };

    /**
     * Report lot completed event
     * @param {Object} data - Lot result data
     */
    EquipmentInterface.prototype.reportLotCompleted = function (data, callback) {
        data = data || {};

        this.s6f11Handler.setVariable('LotId', data.lotId || '');
        this.s6f11Handler.setVariable('ProcessResult', data.result || 0);

        return this.s6f11Handler.sendEventReport(CollectionEvents.LOT_COMPLETED, {}, callback);
    };

    /**
     * Set alarm
     * @param {number} alarmId - Alarm ID
     * @param {string} alarmText - Alarm description
     * @param {number} severity - Alarm severity (1=warning, 2=error, 3=critical)
     */
    EquipmentInterface.prototype.setAlarm = function (alarmId, alarmText, severity, callback) {
        var self = this;
        severity = severity || 1;

        this.activeAlarms[alarmId] = {
            id: alarmId,
            text: alarmText,
            severity: severity,
            timestamp: new Date()
        };

        this.s6f11Handler.setVariable('AlarmId', alarmId);
        this.s6f11Handler.setVariable('AlarmText', alarmText);
        this.s6f11Handler.setVariable('AlarmSeverity', severity);

        // Send S5F1 Alarm Report
        var alarmMessage = new SecsMessage(5, 1, true, {
            type: SecsDataType.LIST,
            length: 3,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.BINARY, 0x80 | (severity & 0x7F)), // Alarm Set + severity
                SecsGemHandler.createDataItem(SecsDataType.UINT4, alarmId),
                SecsGemHandler.createDataItem(SecsDataType.ASCII, alarmText)
            ]
        });

        this.secsHandler.send(alarmMessage, function (err, reply) {
            // Also send collection event
            self.s6f11Handler.sendEventReport(CollectionEvents.ALARM_SET, {}, function (eventErr, ackCode) {
                self.emit('alarmSet', { alarmId: alarmId, text: alarmText, severity: severity });
                if (callback) callback(err || eventErr, ackCode);
            });
        });
    };

    /**
     * Clear alarm
     * @param {number} alarmId - Alarm ID
     */
    EquipmentInterface.prototype.clearAlarm = function (alarmId, callback) {
        var self = this;
        var alarm = this.activeAlarms[alarmId];

        if (!alarm) {
            if (callback) callback(new Error('Alarm not active: ' + alarmId));
            return;
        }

        delete this.activeAlarms[alarmId];

        this.s6f11Handler.setVariable('AlarmId', alarmId);
        this.s6f11Handler.setVariable('AlarmText', alarm.text);
        this.s6f11Handler.setVariable('AlarmSeverity', 0);

        // Send S5F1 Alarm Clear
        var alarmMessage = new SecsMessage(5, 1, true, {
            type: SecsDataType.LIST,
            length: 3,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.BINARY, 0x00), // Alarm Clear
                SecsGemHandler.createDataItem(SecsDataType.UINT4, alarmId),
                SecsGemHandler.createDataItem(SecsDataType.ASCII, alarm.text)
            ]
        });

        this.secsHandler.send(alarmMessage, function (err, reply) {
            self.s6f11Handler.sendEventReport(CollectionEvents.ALARM_CLEARED, {}, function (eventErr, ackCode) {
                self.emit('alarmCleared', { alarmId: alarmId });
                if (callback) callback(err || eventErr, ackCode);
            });
        });
    };

    /**
     * Handle S1F1 - Are You There
     */
    EquipmentInterface.prototype._handleS1F1 = function (message) {
        var response = new SecsMessage(1, 2, false, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.ASCII, this.modelName),
                SecsGemHandler.createDataItem(SecsDataType.ASCII, this.softwareRevision)
            ]
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S1F13 - Establish Communications Request
     */
    EquipmentInterface.prototype._handleS1F13 = function (message) {
        var commAck = 0; // Accept

        // Send S1F14 response
        var response = new SecsMessage(1, 14, false, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.BINARY, commAck),
                {
                    type: SecsDataType.LIST,
                    length: 2,
                    value: [
                        SecsGemHandler.createDataItem(SecsDataType.ASCII, this.modelName),
                        SecsGemHandler.createDataItem(SecsDataType.ASCII, this.softwareRevision)
                    ]
                }
            ]
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);

        this.emit('communicationsEstablished', { message: message });
    };

    /**
     * Handle S1F15 - Request Offline
     */
    EquipmentInterface.prototype._handleS1F15 = function (message) {
        var oflack = 0; // Accept offline request

        if (this.processState === ProcessState.EXECUTING) {
            oflack = 1; // Reject - equipment is processing
        } else {
            this.controlState = ControlState.HOST_OFFLINE;
        }

        var response = new SecsMessage(1, 16, false, {
            type: SecsDataType.BINARY,
            value: oflack
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);

        if (oflack === 0) {
            this.emit('controlStateChanged', {
                oldState: this.controlState,
                newState: ControlState.HOST_OFFLINE,
                trigger: 'hostRequest'
            });
        }
    };

    /**
     * Handle S1F17 - Request Online
     */
    EquipmentInterface.prototype._handleS1F17 = function (message) {
        var onlack = 0; // Accept

        var oldState = this.controlState;
        this.controlState = ControlState.ONLINE_REMOTE;

        var response = new SecsMessage(1, 18, false, {
            type: SecsDataType.BINARY,
            value: onlack
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);

        this.emit('controlStateChanged', {
            oldState: oldState,
            newState: ControlState.ONLINE_REMOTE,
            trigger: 'hostRequest'
        });
    };

    /**
     * Handle S2F41 - Host Command Send
     */
    EquipmentInterface.prototype._handleS2F41 = function (message) {
        var hcack = 0; // Accept
        var cpacks = [];

        try {
            var data = message.data;
            if (data && data.value) {
                var rcmd = data.value[0].value;
                var params = data.value[1].value || [];

                var commandParams = {};
                for (var i = 0; i < params.length; i++) {
                    var paramData = params[i].value;
                    var cpname = paramData[0].value;
                    var cpval = paramData[1].value;
                    commandParams[cpname] = cpval;
                    cpacks.push({
                        type: SecsDataType.LIST,
                        length: 2,
                        value: [
                            SecsGemHandler.createDataItem(SecsDataType.ASCII, cpname),
                            SecsGemHandler.createDataItem(SecsDataType.BINARY, 0) // CPACK = accepted
                        ]
                    });
                }

                this.emit('remoteCommand', {
                    command: rcmd,
                    params: commandParams
                });
            }
        } catch (e) {
            console.error('Error handling S2F41:', e);
            hcack = 1; // Command does not exist
        }

        // Send S2F42 response
        var response = new SecsMessage(2, 42, false, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.BINARY, hcack),
                { type: SecsDataType.LIST, length: cpacks.length, value: cpacks }
            ]
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S5F3 - Enable/Disable Alarm Send
     */
    EquipmentInterface.prototype._handleS5F3 = function (message) {
        var ackc5 = 0; // Accept

        try {
            var data = message.data;
            if (data && data.value) {
                var aled = data.value[0].value; // Enable/disable flag
                var alids = data.value[1].value || [];

                var enabled = !!aled;

                this.emit('alarmEnableChanged', {
                    enabled: enabled,
                    alarmIds: alids.map(function (a) { return a.value; })
                });
            }
        } catch (e) {
            console.error('Error handling S5F3:', e);
            ackc5 = 1;
        }

        var response = new SecsMessage(5, 4, false, {
            type: SecsDataType.BINARY,
            value: ackc5
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S7F1 - Process Program Load Inquire
     */
    EquipmentInterface.prototype._handleS7F1 = function (message) {
        // Accept process program load
        var response = new SecsMessage(7, 2, false, {
            type: SecsDataType.BINARY,
            value: 0 // PPGNT = 0 (OK)
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S7F5 - Process Program Request
     */
    EquipmentInterface.prototype._handleS7F5 = function (message) {
        var ppid = '';
        try {
            ppid = message.data.value;
        } catch (e) {}

        // Return empty process program (should be implemented based on actual PP storage)
        var response = new SecsMessage(7, 6, false, {
            type: SecsDataType.LIST,
            length: 2,
            value: [
                SecsGemHandler.createDataItem(SecsDataType.ASCII, ppid),
                SecsGemHandler.createDataItem(SecsDataType.BINARY, []) // Empty PP body
            ]
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Define custom collection event
     */
    EquipmentInterface.prototype.defineCollectionEvent = function (ceid, name, linkedReports) {
        return this.s6f11Handler.defineCollectionEvent(ceid, name, linkedReports);
    };

    /**
     * Define custom report
     */
    EquipmentInterface.prototype.defineReport = function (rptId, variables) {
        return this.s6f11Handler.defineReport(rptId, variables);
    };

    /**
     * Define equipment constant
     */
    EquipmentInterface.prototype.defineEC = function (config) {
        return this.ecSystem.defineEC(config);
    };

    /**
     * Define status variable
     */
    EquipmentInterface.prototype.defineSV = function (config) {
        return this.ecSystem.defineSV(config);
    };

    /**
     * Get current equipment status
     */
    EquipmentInterface.prototype.getStatus = function () {
        return {
            equipmentId: this.equipmentId,
            modelName: this.modelName,
            softwareRevision: this.softwareRevision,
            controlState: this.controlState,
            processState: this.processState,
            connected: this.secsHandler.connected,
            activeAlarms: Object.keys(this.activeAlarms).length,
            ecValues: this.ecSystem.getAllECs(),
            svValues: this.ecSystem.getAllSVs()
        };
    };

    // Export to global
    global.ProcessState = ProcessState;
    global.EquipmentInterface = EquipmentInterface;

})(typeof window !== 'undefined' ? window : global);
