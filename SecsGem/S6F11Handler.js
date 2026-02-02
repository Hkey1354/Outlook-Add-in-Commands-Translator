/**
 * S6F11 Event Report Handler
 * Implements SEMI E5 S6F11 (Event Report Send) and S6F12 (Event Report Acknowledge)
 *
 * S6F11 Message Structure:
 * <L
 *   <DATAID>     - Data ID (U4)
 *   <CEID>       - Collection Event ID (U4)
 *   <L n         - List of n reports
 *     <L 2
 *       <RPTID>  - Report ID (U4)
 *       <L m     - List of m variables
 *         <V>    - Variable value (various types)
 *         ...
 *       >
 *     >
 *     ...
 *   >
 * >
 *
 * @module SecsGem/S6F11Handler
 */

(function (global) {
    'use strict';

    /**
     * Collection Event definitions (CEID)
     */
    var CollectionEvents = {
        EQUIPMENT_OFFLINE: 1,
        CONTROL_STATE_LOCAL: 2,
        CONTROL_STATE_REMOTE: 3,
        OPERATOR_COMMAND_ISSUED: 4,
        PROCESSING_STARTED: 5,
        PROCESSING_COMPLETED: 6,
        PROCESSING_STATE_CHANGE: 7,
        ALARM_SET: 8,
        ALARM_CLEARED: 9,
        MATERIAL_RECEIVED: 10,
        SPOOLING_ACTIVATED: 11,
        SPOOLING_DEACTIVATED: 12,
        LOT_STARTED: 100,
        LOT_COMPLETED: 101,
        CARRIER_ARRIVED: 102,
        CARRIER_DEPARTED: 103,
        PROCESS_PROGRAM_SELECTED: 104,
        PROCESS_PROGRAM_STARTED: 105,
        PROCESS_PROGRAM_COMPLETED: 106,
        SLOT_MAP_VERIFIED: 107,
        WAFER_STARTED: 108,
        WAFER_COMPLETED: 109
    };

    /**
     * S6F12 Acknowledge Codes (ACKC6)
     */
    var AckCode = {
        ACCEPTED: 0,
        PERMISSION_NOT_GRANTED: 1,
        PPEXECNAME_NOT_FOUND: 2,
        DATA_OVERFLOW: 3,
        CEID_UNKNOWN: 4,
        RPTID_UNKNOWN: 5,
        DVNAME_UNKNOWN: 6,
        REPLY_TIMEOUT: 7,
        NO_REPLY: 8
    };

    /**
     * Report definition structure
     * @class
     * @param {number} rptId - Report ID
     * @param {Array} variables - Array of variable IDs in this report
     */
    function ReportDefinition(rptId, variables) {
        this.rptId = rptId;
        this.variables = variables || [];
    }

    /**
     * Collection Event definition
     * @class
     * @param {number} ceid - Collection Event ID
     * @param {string} name - Event name
     * @param {Array} linkedReports - Array of Report IDs linked to this event
     */
    function CollectionEventDefinition(ceid, name, linkedReports) {
        this.ceid = ceid;
        this.name = name;
        this.linkedReports = linkedReports || [];
        this.enabled = true;
    }

    /**
     * S6F11 Event Report Handler
     * @class
     * @param {SecsGemHandler} secsHandler - The SECS/GEM handler instance
     * @param {ECSystem} ecSystem - Equipment Constants system
     */
    function S6F11Handler(secsHandler, ecSystem) {
        this.secsHandler = secsHandler;
        this.ecSystem = ecSystem;
        this.dataIdCounter = 0;

        // Report definitions: RPTID -> ReportDefinition
        this.reportDefinitions = {};

        // Collection event definitions: CEID -> CollectionEventDefinition
        this.collectionEvents = {};

        // Variable values cache: VID -> value
        this.variableValues = {};

        // Event callbacks
        this.eventCallbacks = {};

        this._registerHandlers();
        this._initializeDefaultEvents();
    }

    /**
     * Register SECS message handlers
     */
    S6F11Handler.prototype._registerHandlers = function () {
        var self = this;

        // S6F12 - Event Report Acknowledge (received from host)
        this.secsHandler.registerHandler(6, 12, function (message) {
            self._handleS6F12(message);
        });

        // S6F15 - Event Report Request (host requests event report)
        this.secsHandler.registerHandler(6, 15, function (message) {
            self._handleS6F15(message);
        });

        // S6F17 - Annotated Event Report Request
        this.secsHandler.registerHandler(6, 17, function (message) {
            self._handleS6F17(message);
        });

        // S2F33 - Define Report
        this.secsHandler.registerHandler(2, 33, function (message) {
            self._handleS2F33(message);
        });

        // S2F35 - Link Event Report
        this.secsHandler.registerHandler(2, 35, function (message) {
            self._handleS2F35(message);
        });

        // S2F37 - Enable/Disable Event Report
        this.secsHandler.registerHandler(2, 37, function (message) {
            self._handleS2F37(message);
        });
    };

    /**
     * Initialize default collection events
     */
    S6F11Handler.prototype._initializeDefaultEvents = function () {
        // Define default events
        this.defineCollectionEvent(CollectionEvents.EQUIPMENT_OFFLINE, 'EquipmentOffline', []);
        this.defineCollectionEvent(CollectionEvents.CONTROL_STATE_LOCAL, 'ControlStateLocal', []);
        this.defineCollectionEvent(CollectionEvents.CONTROL_STATE_REMOTE, 'ControlStateRemote', []);
        this.defineCollectionEvent(CollectionEvents.PROCESSING_STARTED, 'ProcessingStarted', [1]);
        this.defineCollectionEvent(CollectionEvents.PROCESSING_COMPLETED, 'ProcessingCompleted', [1, 2]);
        this.defineCollectionEvent(CollectionEvents.ALARM_SET, 'AlarmSet', [3]);
        this.defineCollectionEvent(CollectionEvents.ALARM_CLEARED, 'AlarmCleared', [3]);
    };

    /**
     * Register callback for event
     */
    S6F11Handler.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit event
     */
    S6F11Handler.prototype.emit = function (event, data) {
        var callbacks = this.eventCallbacks[event];
        if (callbacks) {
            for (var i = 0; i < callbacks.length; i++) {
                try {
                    callbacks[i](data);
                } catch (e) {
                    console.error('S6F11 event callback error:', e);
                }
            }
        }
    };

    /**
     * Define a report
     * @param {number} rptId - Report ID
     * @param {Array} variables - Array of variable IDs
     */
    S6F11Handler.prototype.defineReport = function (rptId, variables) {
        this.reportDefinitions[rptId] = new ReportDefinition(rptId, variables);
        return this;
    };

    /**
     * Define a collection event
     * @param {number} ceid - Collection Event ID
     * @param {string} name - Event name
     * @param {Array} linkedReports - Array of Report IDs
     */
    S6F11Handler.prototype.defineCollectionEvent = function (ceid, name, linkedReports) {
        this.collectionEvents[ceid] = new CollectionEventDefinition(ceid, name, linkedReports);
        return this;
    };

    /**
     * Link reports to a collection event
     * @param {number} ceid - Collection Event ID
     * @param {Array} reportIds - Array of Report IDs to link
     */
    S6F11Handler.prototype.linkReportsToEvent = function (ceid, reportIds) {
        var event = this.collectionEvents[ceid];
        if (event) {
            event.linkedReports = reportIds;
        }
        return this;
    };

    /**
     * Enable or disable a collection event
     * @param {number} ceid - Collection Event ID
     * @param {boolean} enabled - Enable/disable state
     */
    S6F11Handler.prototype.setEventEnabled = function (ceid, enabled) {
        var event = this.collectionEvents[ceid];
        if (event) {
            event.enabled = enabled;
        }
        return this;
    };

    /**
     * Set variable value
     * @param {number|string} vid - Variable ID
     * @param {*} value - Variable value
     */
    S6F11Handler.prototype.setVariable = function (vid, value) {
        this.variableValues[vid] = value;
        return this;
    };

    /**
     * Get variable value
     * @param {number|string} vid - Variable ID
     * @returns {*} Variable value
     */
    S6F11Handler.prototype.getVariable = function (vid) {
        // First check local cache
        if (this.variableValues[vid] !== undefined) {
            return this.variableValues[vid];
        }
        // Then check EC system
        if (this.ecSystem) {
            return this.ecSystem.getValue(vid);
        }
        return null;
    };

    /**
     * Build report data for a given report ID
     */
    S6F11Handler.prototype._buildReportData = function (rptId) {
        var report = this.reportDefinitions[rptId];
        if (!report) {
            return null;
        }

        var variables = [];
        for (var i = 0; i < report.variables.length; i++) {
            var vid = report.variables[i];
            var value = this.getVariable(vid);
            variables.push(this.secsHandler.serializeData(value));
        }

        return [
            SecsGemHandler.createDataItem(SecsDataType.UINT4, rptId),
            { type: SecsDataType.LIST, length: variables.length, value: variables }
        ];
    };

    /**
     * Send S6F11 Event Report
     * @param {number} ceid - Collection Event ID
     * @param {Object} options - Additional options
     * @param {Function} callback - Callback function (err, ackCode)
     */
    S6F11Handler.prototype.sendEventReport = function (ceid, options, callback) {
        var self = this;
        options = options || {};

        // Check if event is defined and enabled
        var eventDef = this.collectionEvents[ceid];
        if (!eventDef) {
            if (callback) callback(new Error('Unknown CEID: ' + ceid));
            return;
        }

        if (!eventDef.enabled) {
            if (callback) callback(new Error('Event disabled: ' + ceid));
            return;
        }

        // Generate data ID
        var dataId = ++this.dataIdCounter;

        // Build report list
        var reports = [];
        for (var i = 0; i < eventDef.linkedReports.length; i++) {
            var rptId = eventDef.linkedReports[i];
            var reportData = this._buildReportData(rptId);
            if (reportData) {
                reports.push({ type: SecsDataType.LIST, length: 2, value: reportData });
            }
        }

        // Build S6F11 message data
        var messageData = [
            SecsGemHandler.createDataItem(SecsDataType.UINT4, dataId),
            SecsGemHandler.createDataItem(SecsDataType.UINT4, ceid),
            { type: SecsDataType.LIST, length: reports.length, value: reports }
        ];

        // Create and send message
        var message = new SecsMessage(6, 11, true, {
            type: SecsDataType.LIST,
            length: 3,
            value: messageData
        });

        this.emit('eventReportSending', {
            ceid: ceid,
            eventName: eventDef.name,
            dataId: dataId,
            reports: reports
        });

        this.secsHandler.send(message, function (err, reply) {
            if (err) {
                self.emit('eventReportError', { ceid: ceid, error: err });
                if (callback) callback(err);
                return;
            }

            var ackCode = AckCode.ACCEPTED;
            if (reply && reply.data && reply.data.value !== undefined) {
                ackCode = reply.data.value;
            }

            self.emit('eventReportAcknowledged', {
                ceid: ceid,
                eventName: eventDef.name,
                ackCode: ackCode
            });

            if (callback) callback(null, ackCode);
        });

        return message;
    };

    /**
     * Send S6F11 with custom data (for direct data specification)
     * @param {number} ceid - Collection Event ID
     * @param {Array} reportData - Array of report objects [{rptId, variables: []}]
     * @param {Function} callback - Callback function
     */
    S6F11Handler.prototype.sendEventReportWithData = function (ceid, reportData, callback) {
        var self = this;
        var dataId = ++this.dataIdCounter;

        // Build reports from provided data
        var reports = [];
        for (var i = 0; i < reportData.length; i++) {
            var rpt = reportData[i];
            var variables = [];

            for (var j = 0; j < rpt.variables.length; j++) {
                variables.push(this.secsHandler.serializeData(rpt.variables[j]));
            }

            reports.push({
                type: SecsDataType.LIST,
                length: 2,
                value: [
                    SecsGemHandler.createDataItem(SecsDataType.UINT4, rpt.rptId),
                    { type: SecsDataType.LIST, length: variables.length, value: variables }
                ]
            });
        }

        // Build S6F11 message
        var messageData = [
            SecsGemHandler.createDataItem(SecsDataType.UINT4, dataId),
            SecsGemHandler.createDataItem(SecsDataType.UINT4, ceid),
            { type: SecsDataType.LIST, length: reports.length, value: reports }
        ];

        var message = new SecsMessage(6, 11, true, {
            type: SecsDataType.LIST,
            length: 3,
            value: messageData
        });

        this.emit('eventReportSending', {
            ceid: ceid,
            dataId: dataId,
            customData: reportData
        });

        this.secsHandler.send(message, function (err, reply) {
            if (err) {
                self.emit('eventReportError', { ceid: ceid, error: err });
                if (callback) callback(err);
                return;
            }

            var ackCode = AckCode.ACCEPTED;
            if (reply && reply.data && reply.data.value !== undefined) {
                ackCode = reply.data.value;
            }

            self.emit('eventReportAcknowledged', { ceid: ceid, ackCode: ackCode });
            if (callback) callback(null, ackCode);
        });

        return message;
    };

    /**
     * Handle S6F12 - Event Report Acknowledge
     */
    S6F11Handler.prototype._handleS6F12 = function (message) {
        var ackCode = message.data ? message.data.value : AckCode.ACCEPTED;
        this.emit('s6f12Received', { ackCode: ackCode, message: message });
    };

    /**
     * Handle S6F15 - Event Report Request
     * Host requests equipment to send current data for specified CEID
     */
    S6F11Handler.prototype._handleS6F15 = function (message) {
        var self = this;
        var ceid = message.data ? message.data.value : 0;

        // Send S6F16 reply with event data
        this.sendEventReport(ceid, {}, function (err) {
            if (err) {
                console.error('Error responding to S6F15:', err);
            }
        });
    };

    /**
     * Handle S6F17 - Annotated Event Report Request
     */
    S6F11Handler.prototype._handleS6F17 = function (message) {
        // Similar to S6F15 but with annotations
        this._handleS6F15(message);
    };

    /**
     * Handle S2F33 - Define Report
     * Host defines which variables are in each report
     */
    S6F11Handler.prototype._handleS2F33 = function (message) {
        var self = this;
        var data = message.data;

        try {
            if (data && data.value) {
                var dataId = data.value[0].value;
                var reports = data.value[1].value;

                if (reports.length === 0) {
                    // Delete all reports
                    this.reportDefinitions = {};
                } else {
                    for (var i = 0; i < reports.length; i++) {
                        var rptData = reports[i].value;
                        var rptId = rptData[0].value;
                        var vids = [];

                        if (rptData[1].value) {
                            for (var j = 0; j < rptData[1].value.length; j++) {
                                vids.push(rptData[1].value[j].value);
                            }
                        }

                        if (vids.length === 0) {
                            delete this.reportDefinitions[rptId];
                        } else {
                            this.defineReport(rptId, vids);
                        }
                    }
                }
            }

            // Send S2F34 acknowledge
            var ackMessage = new SecsMessage(2, 34, false, {
                type: SecsDataType.BINARY,
                value: 0 // DRACK = 0 (OK)
            });
            this.secsHandler.send(ackMessage);

            this.emit('reportsDefined', { definitions: this.reportDefinitions });

        } catch (e) {
            console.error('Error handling S2F33:', e);
            var errorAck = new SecsMessage(2, 34, false, {
                type: SecsDataType.BINARY,
                value: 1 // Error
            });
            this.secsHandler.send(errorAck);
        }
    };

    /**
     * Handle S2F35 - Link Event Report
     * Host links reports to collection events
     */
    S6F11Handler.prototype._handleS2F35 = function (message) {
        var data = message.data;

        try {
            if (data && data.value) {
                var dataId = data.value[0].value;
                var events = data.value[1].value;

                for (var i = 0; i < events.length; i++) {
                    var eventData = events[i].value;
                    var ceid = eventData[0].value;
                    var rptIds = [];

                    if (eventData[1].value) {
                        for (var j = 0; j < eventData[1].value.length; j++) {
                            rptIds.push(eventData[1].value[j].value);
                        }
                    }

                    var eventDef = this.collectionEvents[ceid];
                    if (eventDef) {
                        eventDef.linkedReports = rptIds;
                    }
                }
            }

            // Send S2F36 acknowledge
            var ackMessage = new SecsMessage(2, 36, false, {
                type: SecsDataType.BINARY,
                value: 0 // LRACK = 0 (OK)
            });
            this.secsHandler.send(ackMessage);

            this.emit('eventsLinked', { events: this.collectionEvents });

        } catch (e) {
            console.error('Error handling S2F35:', e);
            var errorAck = new SecsMessage(2, 36, false, {
                type: SecsDataType.BINARY,
                value: 1 // Error
            });
            this.secsHandler.send(errorAck);
        }
    };

    /**
     * Handle S2F37 - Enable/Disable Event Report
     */
    S6F11Handler.prototype._handleS2F37 = function (message) {
        var data = message.data;

        try {
            if (data && data.value) {
                var ceed = data.value[0].value; // Enable/disable flag
                var ceids = data.value[1].value;

                if (ceids.length === 0) {
                    // Apply to all events
                    for (var ceid in this.collectionEvents) {
                        this.collectionEvents[ceid].enabled = !!ceed;
                    }
                } else {
                    for (var i = 0; i < ceids.length; i++) {
                        var eventCeid = ceids[i].value;
                        if (this.collectionEvents[eventCeid]) {
                            this.collectionEvents[eventCeid].enabled = !!ceed;
                        }
                    }
                }
            }

            // Send S2F38 acknowledge
            var ackMessage = new SecsMessage(2, 38, false, {
                type: SecsDataType.BINARY,
                value: 0 // ERACK = 0 (OK)
            });
            this.secsHandler.send(ackMessage);

            this.emit('eventsEnabled', { events: this.collectionEvents });

        } catch (e) {
            console.error('Error handling S2F37:', e);
            var errorAck = new SecsMessage(2, 38, false, {
                type: SecsDataType.BINARY,
                value: 1 // Error
            });
            this.secsHandler.send(errorAck);
        }
    };

    /**
     * Parse received S6F11 message (for host mode)
     * @param {SecsMessage} message - The received S6F11 message
     * @returns {Object} Parsed event report data
     */
    S6F11Handler.prototype.parseS6F11 = function (message) {
        var result = {
            dataId: null,
            ceid: null,
            reports: []
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
                        report.variables.push(vars[j].value);
                    }

                    result.reports.push(report);
                }
            }
        } catch (e) {
            console.error('Error parsing S6F11:', e);
        }

        return result;
    };

    /**
     * Send S6F12 acknowledge (host response to equipment S6F11)
     * @param {number} ackCode - Acknowledge code (see AckCode)
     * @param {number} systemBytes - System bytes from original message
     */
    S6F11Handler.prototype.sendS6F12 = function (ackCode, systemBytes) {
        var message = new SecsMessage(6, 12, false, {
            type: SecsDataType.BINARY,
            value: ackCode
        });
        message.systemBytes = systemBytes;

        return this.secsHandler.send(message);
    };

    // Export to global
    global.CollectionEvents = CollectionEvents;
    global.AckCode = AckCode;
    global.ReportDefinition = ReportDefinition;
    global.CollectionEventDefinition = CollectionEventDefinition;
    global.S6F11Handler = S6F11Handler;

})(typeof window !== 'undefined' ? window : global);
