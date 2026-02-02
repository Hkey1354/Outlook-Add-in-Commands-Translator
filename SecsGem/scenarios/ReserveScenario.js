/**
 * Reserve Scenario Implementation
 *
 * Communication flow for Sorter Lot Reservation:
 * 1. Equipment -> EC: Prepare Lot Request (S6F11, CEID:20000)
 * 2. EC -> MES: Sorter Prepare Lot Request
 * 3. MES -> EC: Sorter Prepare Lot Reply (with slot/wafer info)
 * 4. EC -> Equipment: Prepare Lot Command (S2F41)
 * 5. Equipment -> EC: Start Request (S6F11, CEID:20001)
 * 6. EC -> MES: Ready to Operation
 * 7. MES -> EC -> Equipment: Start Command (S2F41)
 *
 * @module SecsGem/scenarios/ReserveScenario
 */

(function (global) {
    'use strict';

    // ============================================================
    // COLLECTION EVENT IDs (CEID)
    // ============================================================
    var ReserveCEID = {
        PREPARE_LOT_REQUEST: 20000,    // Equipment requests lot preparation
        START_REQUEST: 20001,          // Equipment requests start
        PREPARE_LOT_COMPLETE: 20002,   // Lot preparation completed
        LOT_STARTED: 20003,            // Lot processing started
        LOT_COMPLETED: 20004           // Lot processing completed
    };

    // ============================================================
    // REPORT IDs (RPTID)
    // ============================================================
    var ReserveRPTID = {
        LOT_PORT_INFO: 100,            // LOT ID and PORT ID
        SLOT_WAFER_INFO: 101,          // Slot, Wafer, Model info
        START_INFO: 102                // Start request info
    };

    // ============================================================
    // DATA VARIABLE IDs (DVID)
    // ============================================================
    var ReserveDVID = {
        LOT_ID: 'LOTID',
        PORT_ID: 'PORTID',
        SLOT_ID: 'SLOTID',
        WAFER_ID: 'WAFERID',
        MODEL: 'MODEL',
        SLOT_COUNT: 'SLOTCOUNT',
        SLOT_LIST: 'SLOTLIST'
    };

    // ============================================================
    // SLOT INFO CLASS
    // ============================================================

    /**
     * Slot information for wafer tracking
     * @class
     */
    function SlotInfo(slotId, waferId, model) {
        this.slotId = slotId;
        this.waferId = waferId;
        this.model = model;
    }

    SlotInfo.prototype.toArray = function () {
        return [this.slotId, this.waferId, this.model];
    };

    // ============================================================
    // EC SYSTEM FOR RESERVE SCENARIO
    // ============================================================

    /**
     * EC System specialized for Reserve Scenario
     * Acts as intermediary between Equipment and MES
     * @class
     * @param {Object} config - Configuration options
     */
    function ReserveScenarioEC(config) {
        config = config || {};

        // Create base SECS/GEM handler
        this.secsHandler = new SecsGemHandler({
            deviceId: config.deviceId || 0,
            host: config.host || 'localhost',
            port: config.port || 5000,
            isActive: true
        });

        // Create EC System for parameter management
        this.ecSystem = new ECSystem(this.secsHandler);

        // Create S6F11 Handler
        this.s6f11Handler = new S6F11Handler(this.secsHandler, this.ecSystem);

        // MES connection (simulated or real)
        this.mesConnection = config.mesConnection || null;

        // Current lot information
        this.currentLot = null;
        this.slotMap = [];

        // Event callbacks
        this.eventCallbacks = {};

        // State tracking
        this.state = 'IDLE';

        this._initializeParameters();
        this._registerHandlers();
    }

    /**
     * Initialize EC parameters and reports for Reserve Scenario
     */
    ReserveScenarioEC.prototype._initializeParameters = function () {
        // Define Data Variables
        this.ecSystem.defineDV({ dvid: ReserveDVID.LOT_ID, dvname: 'LotID', dataType: ECDataType.ASCII });
        this.ecSystem.defineDV({ dvid: ReserveDVID.PORT_ID, dvname: 'PortID', dataType: ECDataType.UINT });
        this.ecSystem.defineDV({ dvid: ReserveDVID.SLOT_ID, dvname: 'SlotID', dataType: ECDataType.UINT });
        this.ecSystem.defineDV({ dvid: ReserveDVID.WAFER_ID, dvname: 'WaferID', dataType: ECDataType.ASCII });
        this.ecSystem.defineDV({ dvid: ReserveDVID.MODEL, dvname: 'Model', dataType: ECDataType.ASCII });
        this.ecSystem.defineDV({ dvid: ReserveDVID.SLOT_COUNT, dvname: 'SlotCount', dataType: ECDataType.UINT });
        this.ecSystem.defineDV({ dvid: ReserveDVID.SLOT_LIST, dvname: 'SlotList', dataType: ECDataType.LIST });

        // Define Equipment Constants
        this.ecSystem.defineEC({
            ecid: 200,
            ecname: 'MaxSlotCount',
            ecdef: 25,
            ecmin: 1,
            ecmax: 50,
            units: '',
            dataType: ECDataType.UINT,
            description: 'Maximum slots per carrier'
        });

        this.ecSystem.defineEC({
            ecid: 201,
            ecname: 'PortCount',
            ecdef: 2,
            ecmin: 1,
            ecmax: 4,
            units: '',
            dataType: ECDataType.UINT,
            description: 'Number of load ports'
        });

        // Define Reports
        // Report 100: LOT and PORT info
        this.s6f11Handler.defineReport(ReserveRPTID.LOT_PORT_INFO, [
            ReserveDVID.LOT_ID,
            ReserveDVID.PORT_ID
        ]);

        // Report 101: Slot/Wafer/Model info
        this.s6f11Handler.defineReport(ReserveRPTID.SLOT_WAFER_INFO, [
            ReserveDVID.LOT_ID,
            ReserveDVID.SLOT_COUNT,
            ReserveDVID.SLOT_LIST
        ]);

        // Report 102: Start request info
        this.s6f11Handler.defineReport(ReserveRPTID.START_INFO, [
            ReserveDVID.LOT_ID,
            ReserveDVID.PORT_ID
        ]);

        // Define Collection Events
        this.s6f11Handler.defineCollectionEvent(
            ReserveCEID.PREPARE_LOT_REQUEST,
            'PrepareLotRequest',
            [ReserveRPTID.LOT_PORT_INFO]
        );

        this.s6f11Handler.defineCollectionEvent(
            ReserveCEID.START_REQUEST,
            'StartRequest',
            [ReserveRPTID.START_INFO]
        );

        this.s6f11Handler.defineCollectionEvent(
            ReserveCEID.PREPARE_LOT_COMPLETE,
            'PrepareLotComplete',
            [ReserveRPTID.SLOT_WAFER_INFO]
        );

        this.s6f11Handler.defineCollectionEvent(
            ReserveCEID.LOT_STARTED,
            'LotStarted',
            [ReserveRPTID.LOT_PORT_INFO]
        );

        this.s6f11Handler.defineCollectionEvent(
            ReserveCEID.LOT_COMPLETED,
            'LotCompleted',
            [ReserveRPTID.LOT_PORT_INFO, ReserveRPTID.SLOT_WAFER_INFO]
        );
    };

    /**
     * Register SECS message handlers
     */
    ReserveScenarioEC.prototype._registerHandlers = function () {
        var self = this;

        // Handle S6F11 - Event Report from Equipment
        this.secsHandler.registerHandler(6, 11, function (message) {
            self._handleS6F11(message);
        });

        // Handle S2F42 - Host Command Acknowledge from Equipment
        this.secsHandler.registerHandler(2, 42, function (message) {
            self._handleS2F42(message);
        });
    };

    /**
     * Register event callback
     */
    ReserveScenarioEC.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit event
     */
    ReserveScenarioEC.prototype.emit = function (event, data) {
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
     * Connect to Equipment
     */
    ReserveScenarioEC.prototype.connect = function (callback) {
        var self = this;
        this.secsHandler.connect(function (err, result) {
            if (err) {
                if (callback) callback(err);
                return;
            }
            self.emit('connected', { host: self.secsHandler.host, port: self.secsHandler.port });
            if (callback) callback(null, result);
        });
    };

    /**
     * Handle S6F11 from Equipment
     */
    ReserveScenarioEC.prototype._handleS6F11 = function (message) {
        var self = this;

        // Parse the event report
        var eventData = this.s6f11Handler.parseS6F11(message);
        var ceid = eventData.ceid;

        console.log('[EC] Received S6F11, CEID:', ceid);

        // Send S6F12 Acknowledge
        this.s6f11Handler.sendS6F12(AckCode.ACCEPTED, message.systemBytes);

        // Handle based on CEID
        switch (ceid) {
            case ReserveCEID.PREPARE_LOT_REQUEST:
                this._handlePrepareLotRequest(eventData);
                break;

            case ReserveCEID.START_REQUEST:
                this._handleStartRequest(eventData);
                break;

            default:
                console.log('[EC] Unknown CEID:', ceid);
                this.emit('unknownEvent', eventData);
        }
    };

    /**
     * Handle Prepare Lot Request (CEID: 20000)
     * Step 1: Equipment -> EC
     */
    ReserveScenarioEC.prototype._handlePrepareLotRequest = function (eventData) {
        var self = this;

        // Extract LOT ID and PORT ID from report
        var lotId = '';
        var portId = 0;

        if (eventData.reports && eventData.reports.length > 0) {
            var report = eventData.reports[0];
            if (report.variables.length >= 2) {
                lotId = report.variables[0];
                portId = report.variables[1];
            }
        }

        console.log('[EC] Prepare Lot Request - LOT:', lotId, 'PORT:', portId);

        this.currentLot = {
            lotId: lotId,
            portId: portId,
            state: 'PREPARING'
        };

        this.state = 'PREPARING_LOT';

        // Emit event for logging/monitoring
        this.emit('prepareLotRequest', {
            lotId: lotId,
            portId: portId
        });

        // Step 2: Forward to MES - Sorter Prepare Lot
        this._sendToMES('SorterPrepareLot', {
            lotId: lotId,
            portId: portId
        }, function (err, mesResponse) {
            if (err) {
                console.error('[EC] MES communication error:', err);
                return;
            }

            // Step 3: Receive slot/wafer info from MES
            self._handleMESPrepareLotReply(mesResponse);
        });
    };

    /**
     * Handle MES Prepare Lot Reply
     * Step 3: MES -> EC
     */
    ReserveScenarioEC.prototype._handleMESPrepareLotReply = function (mesResponse) {
        var self = this;

        console.log('[EC] MES Prepare Lot Reply received');

        // mesResponse contains:
        // - lotId: LOT ID
        // - slots: Array of {slotId, waferId, model}
        var lotId = mesResponse.lotId;
        var slots = mesResponse.slots || [];

        // Store slot map (only slots with wafers)
        this.slotMap = slots.filter(function (slot) {
            return slot.waferId && slot.waferId !== '';
        });

        console.log('[EC] Slot map received:', this.slotMap.length, 'wafers');

        this.emit('mesPrepareLotReply', {
            lotId: lotId,
            slotCount: this.slotMap.length,
            slots: this.slotMap
        });

        // Step 4: Send Prepare Lot command to Equipment (S2F41)
        this._sendPrepareLotCommand(lotId, this.slotMap);
    };

    /**
     * Send Prepare Lot Command to Equipment (S2F41)
     * Step 4: EC -> Equipment
     */
    ReserveScenarioEC.prototype._sendPrepareLotCommand = function (lotId, slots) {
        var self = this;

        console.log('[EC] Sending Prepare Lot command to Equipment');

        // Build slot list for command parameters
        var slotParams = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            slotParams.push({
                cpname: 'SLOT_' + slot.slotId,
                cpval: slot.slotId + ',' + slot.waferId + ',' + slot.model
            });
        }

        // Build S2F41 message
        var params = [
            { cpname: 'LOTID', cpval: lotId },
            { cpname: 'SLOTCOUNT', cpval: slots.length }
        ].concat(slotParams);

        var message = this._buildS2F41('PREPARE_LOT', params);

        this.secsHandler.send(message, function (err, reply) {
            if (err) {
                console.error('[EC] Failed to send Prepare Lot command:', err);
                return;
            }

            console.log('[EC] Prepare Lot command sent successfully');

            self.state = 'WAITING_START_REQUEST';

            self.emit('prepareLotCommandSent', {
                lotId: lotId,
                slotCount: slots.length
            });
        });
    };

    /**
     * Handle Start Request (CEID: 20001)
     * Step 5: Equipment -> EC
     */
    ReserveScenarioEC.prototype._handleStartRequest = function (eventData) {
        var self = this;

        // Extract LOT ID and PORT ID
        var lotId = '';
        var portId = 0;

        if (eventData.reports && eventData.reports.length > 0) {
            var report = eventData.reports[0];
            if (report.variables.length >= 2) {
                lotId = report.variables[0];
                portId = report.variables[1];
            }
        }

        console.log('[EC] Start Request - LOT:', lotId, 'PORT:', portId);

        this.emit('startRequest', {
            lotId: lotId,
            portId: portId
        });

        // Step 6: Notify MES - Ready to Operation
        this._sendToMES('ReadyToOperation', {
            lotId: lotId,
            portId: portId
        }, function (err, mesResponse) {
            if (err) {
                console.error('[EC] MES communication error:', err);
                return;
            }

            // Step 7: MES sends Start command
            // This is handled when MES calls sendStartCommand()
            console.log('[EC] Ready to Operation sent to MES');

            self.state = 'READY_TO_START';

            self.emit('readyToOperation', {
                lotId: lotId,
                portId: portId
            });
        });
    };

    /**
     * Send Start Command to Equipment (called by MES)
     * Step 7: MES -> EC -> Equipment
     */
    ReserveScenarioEC.prototype.sendStartCommand = function (lotId, callback) {
        var self = this;

        console.log('[EC] Sending Start command to Equipment');

        var message = this._buildS2F41('START', [
            { cpname: 'LOTID', cpval: lotId }
        ]);

        this.secsHandler.send(message, function (err, reply) {
            if (err) {
                console.error('[EC] Failed to send Start command:', err);
                if (callback) callback(err);
                return;
            }

            console.log('[EC] Start command sent successfully');

            self.state = 'PROCESSING';

            if (self.currentLot) {
                self.currentLot.state = 'PROCESSING';
            }

            self.emit('startCommandSent', { lotId: lotId });

            if (callback) callback(null, reply);
        });
    };

    /**
     * Build S2F41 (Host Command Send) message
     */
    ReserveScenarioEC.prototype._buildS2F41 = function (rcmd, params) {
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

        return message;
    };

    /**
     * Handle S2F42 (Host Command Acknowledge) from Equipment
     */
    ReserveScenarioEC.prototype._handleS2F42 = function (message) {
        var hcack = 0;
        var cpacks = [];

        try {
            if (message.data && message.data.value) {
                hcack = message.data.value[0].value;
                cpacks = message.data.value[1].value || [];
            }
        } catch (e) {
            console.error('[EC] Error parsing S2F42:', e);
        }

        console.log('[EC] S2F42 received, HCACK:', hcack);

        this.emit('commandAcknowledge', {
            hcack: hcack,
            cpacks: cpacks
        });
    };

    /**
     * Send message to MES (simulated or real)
     */
    ReserveScenarioEC.prototype._sendToMES = function (messageType, data, callback) {
        var self = this;

        console.log('[EC] -> MES:', messageType, data);

        this.emit('mesMessageSent', {
            type: messageType,
            data: data
        });

        // If real MES connection is available
        if (this.mesConnection && typeof this.mesConnection.send === 'function') {
            this.mesConnection.send(messageType, data, callback);
            return;
        }

        // Simulated MES response
        setTimeout(function () {
            var response = self._simulateMESResponse(messageType, data);
            console.log('[EC] <- MES:', response);
            if (callback) callback(null, response);
        }, 100);
    };

    /**
     * Simulate MES response (for testing)
     */
    ReserveScenarioEC.prototype._simulateMESResponse = function (messageType, data) {
        switch (messageType) {
            case 'SorterPrepareLot':
                // Simulate MES returning slot/wafer info
                return {
                    lotId: data.lotId,
                    slots: [
                        new SlotInfo(1, 'WAFER001', 'MODEL-A'),
                        new SlotInfo(5, 'WAFER002', 'MODEL-A'),
                        new SlotInfo(9, 'WAFER003', 'MODEL-B'),
                        new SlotInfo(13, 'WAFER004', 'MODEL-A'),
                        new SlotInfo(17, 'WAFER005', 'MODEL-B'),
                        new SlotInfo(21, 'WAFER006', 'MODEL-A'),
                        new SlotInfo(24, 'WAFER007', 'MODEL-B')
                    ]
                };

            case 'ReadyToOperation':
                return {
                    status: 'OK',
                    lotId: data.lotId
                };

            default:
                return { status: 'OK' };
        }
    };

    /**
     * Get current state
     */
    ReserveScenarioEC.prototype.getState = function () {
        return {
            state: this.state,
            currentLot: this.currentLot,
            slotMap: this.slotMap
        };
    };

    // ============================================================
    // EQUIPMENT SIDE IMPLEMENTATION
    // ============================================================

    /**
     * Equipment implementation for Reserve Scenario
     * @class
     */
    function ReserveScenarioEquipment(config) {
        config = config || {};

        this.equipmentId = config.equipmentId || 'SORTER-001';
        this.portCount = config.portCount || 2;

        // Create equipment interface
        this.equipment = new EquipmentInterface({
            equipmentId: this.equipmentId,
            modelName: config.modelName || 'Wafer Sorter',
            softwareRevision: config.softwareRevision || '1.0.0',
            host: config.host || 'localhost',
            port: config.port || 5000
        });

        // Port status
        this.ports = {};
        for (var i = 1; i <= this.portCount; i++) {
            this.ports[i] = {
                portId: i,
                lotId: '',
                slotMap: [],
                state: 'EMPTY'
            };
        }

        // Event callbacks
        this.eventCallbacks = {};

        this._initializeReserveParameters();
        this._registerHandlers();
    }

    /**
     * Initialize parameters for Reserve Scenario
     */
    ReserveScenarioEquipment.prototype._initializeReserveParameters = function () {
        var eq = this.equipment;

        // Define reports
        eq.defineReport(ReserveRPTID.LOT_PORT_INFO, [ReserveDVID.LOT_ID, ReserveDVID.PORT_ID]);
        eq.defineReport(ReserveRPTID.START_INFO, [ReserveDVID.LOT_ID, ReserveDVID.PORT_ID]);

        // Define collection events
        eq.defineCollectionEvent(ReserveCEID.PREPARE_LOT_REQUEST, 'PrepareLotRequest', [ReserveRPTID.LOT_PORT_INFO]);
        eq.defineCollectionEvent(ReserveCEID.START_REQUEST, 'StartRequest', [ReserveRPTID.START_INFO]);
    };

    /**
     * Register command handlers
     */
    ReserveScenarioEquipment.prototype._registerHandlers = function () {
        var self = this;

        this.equipment.on('remoteCommand', function (data) {
            self._handleRemoteCommand(data.command, data.params);
        });
    };

    /**
     * Register event callback
     */
    ReserveScenarioEquipment.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit event
     */
    ReserveScenarioEquipment.prototype.emit = function (event, data) {
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
     * Start equipment
     */
    ReserveScenarioEquipment.prototype.start = function (callback) {
        this.equipment.start(callback);
    };

    /**
     * Request Lot Preparation
     * Step 1: Equipment -> EC (S6F11, CEID:20000)
     */
    ReserveScenarioEquipment.prototype.requestPrepareLot = function (lotId, portId, callback) {
        var self = this;

        console.log('[Equipment] Requesting Prepare Lot - LOT:', lotId, 'PORT:', portId);

        // Update port state
        this.ports[portId] = {
            portId: portId,
            lotId: lotId,
            slotMap: [],
            state: 'PREPARE_REQUESTED'
        };

        // Send S6F11 with CEID 20000
        this.equipment.sendEventReport(ReserveCEID.PREPARE_LOT_REQUEST, {
            LOTID: lotId,
            PORTID: portId
        }, function (err, ackCode) {
            if (err) {
                console.error('[Equipment] Failed to send Prepare Lot Request:', err);
                if (callback) callback(err);
                return;
            }

            console.log('[Equipment] Prepare Lot Request sent, ACK:', ackCode);
            self.emit('prepareLotRequestSent', { lotId: lotId, portId: portId });

            if (callback) callback(null, ackCode);
        });
    };

    /**
     * Request Start
     * Step 5: Equipment -> EC (S6F11, CEID:20001)
     */
    ReserveScenarioEquipment.prototype.requestStart = function (lotId, portId, callback) {
        var self = this;

        console.log('[Equipment] Requesting Start - LOT:', lotId, 'PORT:', portId);

        // Send S6F11 with CEID 20001
        this.equipment.sendEventReport(ReserveCEID.START_REQUEST, {
            LOTID: lotId,
            PORTID: portId
        }, function (err, ackCode) {
            if (err) {
                console.error('[Equipment] Failed to send Start Request:', err);
                if (callback) callback(err);
                return;
            }

            console.log('[Equipment] Start Request sent, ACK:', ackCode);
            self.emit('startRequestSent', { lotId: lotId, portId: portId });

            if (callback) callback(null, ackCode);
        });
    };

    /**
     * Handle remote command from EC
     */
    ReserveScenarioEquipment.prototype._handleRemoteCommand = function (command, params) {
        console.log('[Equipment] Remote command received:', command, params);

        switch (command) {
            case 'PREPARE_LOT':
                this._handlePrepareLotCommand(params);
                break;

            case 'START':
                this._handleStartCommand(params);
                break;

            default:
                console.log('[Equipment] Unknown command:', command);
        }
    };

    /**
     * Handle Prepare Lot command from EC
     * Step 4: EC -> Equipment
     */
    ReserveScenarioEquipment.prototype._handlePrepareLotCommand = function (params) {
        var lotId = params.LOTID || '';
        var slotCount = parseInt(params.SLOTCOUNT) || 0;

        console.log('[Equipment] Prepare Lot command - LOT:', lotId, 'Slots:', slotCount);

        // Parse slot information
        var slotMap = [];
        for (var key in params) {
            if (key.indexOf('SLOT_') === 0) {
                var parts = params[key].split(',');
                if (parts.length >= 3) {
                    slotMap.push(new SlotInfo(
                        parseInt(parts[0]),
                        parts[1],
                        parts[2]
                    ));
                }
            }
        }

        // Update port with slot map
        for (var portId in this.ports) {
            if (this.ports[portId].lotId === lotId) {
                this.ports[portId].slotMap = slotMap;
                this.ports[portId].state = 'PREPARED';
                break;
            }
        }

        console.log('[Equipment] Slot map loaded:', slotMap.length, 'wafers');

        this.emit('prepareLotCommandReceived', {
            lotId: lotId,
            slotCount: slotCount,
            slotMap: slotMap
        });
    };

    /**
     * Handle Start command from EC
     * Step 7: MES -> EC -> Equipment
     */
    ReserveScenarioEquipment.prototype._handleStartCommand = function (params) {
        var lotId = params.LOTID || '';

        console.log('[Equipment] Start command received - LOT:', lotId);

        // Update port state
        for (var portId in this.ports) {
            if (this.ports[portId].lotId === lotId) {
                this.ports[portId].state = 'PROCESSING';
                break;
            }
        }

        this.emit('startCommandReceived', { lotId: lotId });

        // Start processing (would trigger actual equipment operation)
        this._startProcessing(lotId);
    };

    /**
     * Start processing (simulated)
     */
    ReserveScenarioEquipment.prototype._startProcessing = function (lotId) {
        var self = this;

        console.log('[Equipment] Starting processing for LOT:', lotId);

        // Emit lot started event
        this.emit('lotStarted', { lotId: lotId });

        // In real implementation, this would interface with actual equipment control
    };

    /**
     * Get port status
     */
    ReserveScenarioEquipment.prototype.getPortStatus = function (portId) {
        return this.ports[portId];
    };

    // ============================================================
    // MES SIDE IMPLEMENTATION
    // ============================================================

    /**
     * MES implementation for Reserve Scenario
     * @class
     */
    function ReserveScenarioMES(config) {
        config = config || {};

        this.mesId = config.mesId || 'MES-001';

        // Lot database (simulated)
        this.lotDatabase = config.lotDatabase || {};

        // EC connection
        this.ecConnection = null;

        // Event callbacks
        this.eventCallbacks = {};
    }

    /**
     * Register event callback
     */
    ReserveScenarioMES.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit event
     */
    ReserveScenarioMES.prototype.emit = function (event, data) {
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
     * Connect to EC
     */
    ReserveScenarioMES.prototype.connectToEC = function (ec) {
        this.ecConnection = ec;

        // Register for EC events
        var self = this;

        ec.on('prepareLotRequest', function (data) {
            self._handlePrepareLotRequest(data);
        });

        ec.on('readyToOperation', function (data) {
            self._handleReadyToOperation(data);
        });
    };

    /**
     * Handle Prepare Lot Request from EC
     * Step 2: EC -> MES
     */
    ReserveScenarioMES.prototype._handlePrepareLotRequest = function (data) {
        console.log('[MES] Prepare Lot Request received - LOT:', data.lotId);

        // Look up lot information in database
        var lotInfo = this.getLotInfo(data.lotId);

        this.emit('prepareLotRequest', {
            lotId: data.lotId,
            portId: data.portId,
            lotInfo: lotInfo
        });
    };

    /**
     * Handle Ready to Operation from EC
     * Step 6: EC -> MES
     */
    ReserveScenarioMES.prototype._handleReadyToOperation = function (data) {
        console.log('[MES] Ready to Operation received - LOT:', data.lotId);

        this.emit('readyToOperation', {
            lotId: data.lotId,
            portId: data.portId
        });
    };

    /**
     * Send Start command through EC to Equipment
     * Step 7: MES -> EC -> Equipment
     */
    ReserveScenarioMES.prototype.sendStartCommand = function (lotId, callback) {
        console.log('[MES] Sending Start command for LOT:', lotId);

        if (!this.ecConnection) {
            if (callback) callback(new Error('Not connected to EC'));
            return;
        }

        this.ecConnection.sendStartCommand(lotId, callback);
    };

    /**
     * Get lot information from database
     */
    ReserveScenarioMES.prototype.getLotInfo = function (lotId) {
        // Return from database or generate test data
        if (this.lotDatabase[lotId]) {
            return this.lotDatabase[lotId];
        }

        // Generate test slot data
        return {
            lotId: lotId,
            slots: [
                new SlotInfo(1, lotId + '-W01', 'MODEL-A'),
                new SlotInfo(5, lotId + '-W02', 'MODEL-A'),
                new SlotInfo(9, lotId + '-W03', 'MODEL-B'),
                new SlotInfo(13, lotId + '-W04', 'MODEL-A'),
                new SlotInfo(17, lotId + '-W05', 'MODEL-B'),
                new SlotInfo(21, lotId + '-W06', 'MODEL-A'),
                new SlotInfo(24, lotId + '-W07', 'MODEL-B')
            ]
        };
    };

    /**
     * Register lot in database
     */
    ReserveScenarioMES.prototype.registerLot = function (lotId, slots) {
        this.lotDatabase[lotId] = {
            lotId: lotId,
            slots: slots
        };
    };

    // Export to global
    global.ReserveCEID = ReserveCEID;
    global.ReserveRPTID = ReserveRPTID;
    global.ReserveDVID = ReserveDVID;
    global.SlotInfo = SlotInfo;
    global.ReserveScenarioEC = ReserveScenarioEC;
    global.ReserveScenarioEquipment = ReserveScenarioEquipment;
    global.ReserveScenarioMES = ReserveScenarioMES;

})(typeof window !== 'undefined' ? window : global);
