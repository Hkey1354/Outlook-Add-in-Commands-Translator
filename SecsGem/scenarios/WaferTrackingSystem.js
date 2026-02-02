/**
 * Wafer Tracking System with EC Parameters
 *
 * Uses LOT ID, Slot ID, Wafer ID, and Model for:
 * 1. Wafer Sorting - Move wafers between slots/carriers
 * 2. Recipe Selection - Apply correct process based on Model
 * 3. Traceability - Track wafer location and history
 * 4. Quality Control - Record process results per wafer
 *
 * @module SecsGem/scenarios/WaferTrackingSystem
 */

(function (global) {
    'use strict';

    // ============================================================
    // COLLECTION EVENT IDs for Wafer Tracking
    // ============================================================
    var WaferTrackingCEID = {
        // Carrier Events
        CARRIER_ARRIVED: 30000,        // Carrier placed on port
        CARRIER_REMOVED: 30001,        // Carrier removed from port
        CARRIER_CLAMPED: 30002,        // Carrier clamped
        CARRIER_UNCLAMPED: 30003,      // Carrier unclamped

        // Slot Map Events
        SLOT_MAP_READ: 30010,          // Slot map reading completed
        SLOT_MAP_VERIFIED: 30011,      // Slot map verified with MES

        // Wafer Events
        WAFER_PICKED: 30020,           // Wafer picked from slot
        WAFER_PLACED: 30021,           // Wafer placed to slot
        WAFER_ALIGNED: 30022,          // Wafer alignment completed
        WAFER_ID_READ: 30023,          // Wafer ID (OCR) read completed

        // Process Events
        WAFER_PROCESS_START: 30030,    // Wafer process started
        WAFER_PROCESS_END: 30031,      // Wafer process ended
        WAFER_PROCESS_ABORT: 30032,    // Wafer process aborted

        // Sorting Events
        SORT_JOB_START: 30040,         // Sorting job started
        SORT_JOB_END: 30041,           // Sorting job completed
        SORT_JOB_ABORT: 30042          // Sorting job aborted
    };

    // ============================================================
    // REPORT IDs for Wafer Tracking
    // ============================================================
    var WaferTrackingRPTID = {
        CARRIER_INFO: 200,             // Carrier information
        SLOT_MAP: 201,                 // Full slot map
        WAFER_INFO: 202,               // Single wafer info
        WAFER_LOCATION: 203,           // Wafer current location
        PROCESS_RESULT: 204,           // Process result data
        SORT_JOB_INFO: 205             // Sort job information
    };

    // ============================================================
    // WAFER CLASS - Core tracking unit
    // ============================================================

    /**
     * Wafer information class
     * @class
     */
    function Wafer(config) {
        config = config || {};

        // Identification
        this.waferId = config.waferId || '';           // Unique wafer ID
        this.lotId = config.lotId || '';               // Parent lot ID
        this.model = config.model || '';               // Product model/type

        // Location
        this.carrierId = config.carrierId || '';       // Current carrier ID
        this.slotId = config.slotId || 0;              // Current slot position
        this.portId = config.portId || 0;              // Current port

        // Status
        this.state = config.state || 'UNKNOWN';        // UNKNOWN, PRESENT, PROCESSING, COMPLETED, ERROR
        this.processState = config.processState || ''; // Current process state

        // Process Data
        this.recipe = config.recipe || '';             // Recipe used
        this.processStartTime = null;
        this.processEndTime = null;
        this.processResult = null;                     // 0=OK, 1=NG, 2=SKIP

        // History
        this.history = [];
    }

    Wafer.prototype.addHistory = function (event, data) {
        this.history.push({
            timestamp: new Date().toISOString(),
            event: event,
            data: data
        });
    };

    Wafer.prototype.toObject = function () {
        return {
            waferId: this.waferId,
            lotId: this.lotId,
            model: this.model,
            carrierId: this.carrierId,
            slotId: this.slotId,
            portId: this.portId,
            state: this.state,
            processState: this.processState,
            recipe: this.recipe,
            processResult: this.processResult,
            historyCount: this.history.length
        };
    };

    // ============================================================
    // CARRIER CLASS - Container for wafers
    // ============================================================

    /**
     * Carrier (FOUP/Cassette) class
     * @class
     */
    function Carrier(config) {
        config = config || {};

        this.carrierId = config.carrierId || '';
        this.lotId = config.lotId || '';
        this.portId = config.portId || 0;
        this.maxSlots = config.maxSlots || 25;

        // Slot map: slotId -> Wafer object or null
        this.slots = {};
        for (var i = 1; i <= this.maxSlots; i++) {
            this.slots[i] = null;
        }

        this.state = 'EMPTY'; // EMPTY, MAPPED, PROCESSING, COMPLETED
    }

    /**
     * Load wafer into slot
     */
    Carrier.prototype.loadWafer = function (slotId, wafer) {
        if (slotId < 1 || slotId > this.maxSlots) {
            return { success: false, error: 'Invalid slot ID' };
        }
        if (this.slots[slotId] !== null) {
            return { success: false, error: 'Slot already occupied' };
        }

        wafer.slotId = slotId;
        wafer.carrierId = this.carrierId;
        wafer.portId = this.portId;
        wafer.state = 'PRESENT';
        wafer.addHistory('LOADED', { slotId: slotId, carrierId: this.carrierId });

        this.slots[slotId] = wafer;
        return { success: true };
    };

    /**
     * Unload wafer from slot
     */
    Carrier.prototype.unloadWafer = function (slotId) {
        if (this.slots[slotId] === null) {
            return { success: false, error: 'Slot is empty' };
        }

        var wafer = this.slots[slotId];
        wafer.addHistory('UNLOADED', { slotId: slotId, carrierId: this.carrierId });

        this.slots[slotId] = null;
        return { success: true, wafer: wafer };
    };

    /**
     * Get slot map (only occupied slots)
     */
    Carrier.prototype.getSlotMap = function () {
        var map = [];
        for (var slotId in this.slots) {
            if (this.slots[slotId] !== null) {
                var wafer = this.slots[slotId];
                map.push({
                    slotId: parseInt(slotId),
                    waferId: wafer.waferId,
                    model: wafer.model,
                    state: wafer.state
                });
            }
        }
        return map;
    };

    /**
     * Get wafer count
     */
    Carrier.prototype.getWaferCount = function () {
        var count = 0;
        for (var slotId in this.slots) {
            if (this.slots[slotId] !== null) {
                count++;
            }
        }
        return count;
    };

    // ============================================================
    // WAFER TRACKING EC SYSTEM
    // ============================================================

    /**
     * Wafer Tracking EC System
     * @class
     */
    function WaferTrackingEC(config) {
        config = config || {};

        // Create base SECS handler
        this.secsHandler = new SecsGemHandler({
            deviceId: config.deviceId || 0,
            host: config.host || 'localhost',
            port: config.port || 5000,
            isActive: true
        });

        // Create EC System
        this.ecSystem = new ECSystem(this.secsHandler);

        // Create S6F11 Handler
        this.s6f11Handler = new S6F11Handler(this.secsHandler, this.ecSystem);

        // Carrier registry: carrierId -> Carrier
        this.carriers = {};

        // Wafer registry: waferId -> Wafer
        this.wafers = {};

        // Port registry: portId -> carrierId
        this.ports = {};
        this.portCount = config.portCount || 2;

        // Recipe mapping: model -> recipe
        this.recipeMap = config.recipeMap || {};

        // Event callbacks
        this.eventCallbacks = {};

        this._initializeParameters();
        this._registerHandlers();
    }

    /**
     * Initialize EC parameters
     */
    WaferTrackingEC.prototype._initializeParameters = function () {
        // Equipment Constants
        this.ecSystem.defineEC({
            ecid: 300,
            ecname: 'MaxSlotsPerCarrier',
            ecdef: 25,
            ecmin: 1,
            ecmax: 50,
            description: 'Maximum slots per carrier'
        });

        this.ecSystem.defineEC({
            ecid: 301,
            ecname: 'WaferIDReadEnabled',
            ecdef: true,
            dataType: ECDataType.BOOLEAN,
            description: 'Enable OCR wafer ID reading'
        });

        this.ecSystem.defineEC({
            ecid: 302,
            ecname: 'SlotMapVerifyEnabled',
            ecdef: true,
            dataType: ECDataType.BOOLEAN,
            description: 'Enable slot map verification with MES'
        });

        // Status Variables
        this.ecSystem.defineSV({
            svid: 300,
            svname: 'CurrentLotId',
            dataType: ECDataType.ASCII,
            value: ''
        });

        this.ecSystem.defineSV({
            svid: 301,
            svname: 'CurrentCarrierId',
            dataType: ECDataType.ASCII,
            value: ''
        });

        this.ecSystem.defineSV({
            svid: 302,
            svname: 'ProcessingWaferId',
            dataType: ECDataType.ASCII,
            value: ''
        });

        this.ecSystem.defineSV({
            svid: 303,
            svname: 'ProcessingSlotId',
            dataType: ECDataType.UINT,
            value: 0
        });

        this.ecSystem.defineSV({
            svid: 304,
            svname: 'TotalWaferCount',
            dataType: ECDataType.UINT,
            value: 0
        });

        this.ecSystem.defineSV({
            svid: 305,
            svname: 'ProcessedWaferCount',
            dataType: ECDataType.UINT,
            value: 0
        });

        this.ecSystem.defineSV({
            svid: 306,
            svname: 'CurrentRecipe',
            dataType: ECDataType.ASCII,
            value: ''
        });

        // Define Reports
        this.s6f11Handler.defineReport(WaferTrackingRPTID.CARRIER_INFO, [
            'CarrierId', 'LotId', 'PortId', 'WaferCount'
        ]);

        this.s6f11Handler.defineReport(WaferTrackingRPTID.WAFER_INFO, [
            'WaferId', 'LotId', 'SlotId', 'Model', 'State'
        ]);

        this.s6f11Handler.defineReport(WaferTrackingRPTID.WAFER_LOCATION, [
            'WaferId', 'CarrierId', 'SlotId', 'PortId'
        ]);

        this.s6f11Handler.defineReport(WaferTrackingRPTID.PROCESS_RESULT, [
            'WaferId', 'LotId', 'Recipe', 'ProcessResult', 'ProcessTime'
        ]);

        // Define Collection Events
        this.s6f11Handler.defineCollectionEvent(
            WaferTrackingCEID.CARRIER_ARRIVED,
            'CarrierArrived',
            [WaferTrackingRPTID.CARRIER_INFO]
        );

        this.s6f11Handler.defineCollectionEvent(
            WaferTrackingCEID.SLOT_MAP_READ,
            'SlotMapRead',
            [WaferTrackingRPTID.CARRIER_INFO, WaferTrackingRPTID.SLOT_MAP]
        );

        this.s6f11Handler.defineCollectionEvent(
            WaferTrackingCEID.WAFER_PICKED,
            'WaferPicked',
            [WaferTrackingRPTID.WAFER_LOCATION]
        );

        this.s6f11Handler.defineCollectionEvent(
            WaferTrackingCEID.WAFER_PLACED,
            'WaferPlaced',
            [WaferTrackingRPTID.WAFER_LOCATION]
        );

        this.s6f11Handler.defineCollectionEvent(
            WaferTrackingCEID.WAFER_PROCESS_START,
            'WaferProcessStart',
            [WaferTrackingRPTID.WAFER_INFO]
        );

        this.s6f11Handler.defineCollectionEvent(
            WaferTrackingCEID.WAFER_PROCESS_END,
            'WaferProcessEnd',
            [WaferTrackingRPTID.PROCESS_RESULT]
        );
    };

    /**
     * Register message handlers
     */
    WaferTrackingEC.prototype._registerHandlers = function () {
        var self = this;

        this.secsHandler.registerHandler(6, 11, function (message) {
            self._handleS6F11(message);
        });
    };

    /**
     * Register event callback
     */
    WaferTrackingEC.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit event
     */
    WaferTrackingEC.prototype.emit = function (event, data) {
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

    // ============================================================
    // CARRIER OPERATIONS
    // ============================================================

    /**
     * Register carrier arrival on port
     */
    WaferTrackingEC.prototype.carrierArrived = function (carrierId, portId, lotId, callback) {
        console.log('[EC] Carrier arrived:', carrierId, 'Port:', portId, 'Lot:', lotId);

        var carrier = new Carrier({
            carrierId: carrierId,
            lotId: lotId,
            portId: portId
        });

        this.carriers[carrierId] = carrier;
        this.ports[portId] = carrierId;

        this.ecSystem.setSVValue(300, lotId);
        this.ecSystem.setSVValue(301, carrierId);

        // Send S6F11 event
        this.s6f11Handler.setVariable('CarrierId', carrierId);
        this.s6f11Handler.setVariable('LotId', lotId);
        this.s6f11Handler.setVariable('PortId', portId);
        this.s6f11Handler.setVariable('WaferCount', 0);

        this.s6f11Handler.sendEventReport(WaferTrackingCEID.CARRIER_ARRIVED, {}, callback);

        this.emit('carrierArrived', { carrierId: carrierId, portId: portId, lotId: lotId });

        return carrier;
    };

    /**
     * Load slot map from MES data
     * This is called after MES returns slot/wafer information
     */
    WaferTrackingEC.prototype.loadSlotMap = function (carrierId, slotData) {
        var carrier = this.carriers[carrierId];
        if (!carrier) {
            return { success: false, error: 'Carrier not found' };
        }

        console.log('[EC] Loading slot map for carrier:', carrierId);
        console.log('[EC] Slot data received:', slotData.length, 'wafers');

        // Load each wafer into carrier
        for (var i = 0; i < slotData.length; i++) {
            var slot = slotData[i];

            var wafer = new Wafer({
                waferId: slot.waferId,
                lotId: carrier.lotId,
                model: slot.model,
                slotId: slot.slotId
            });

            // Register wafer
            this.wafers[wafer.waferId] = wafer;

            // Load into carrier
            carrier.loadWafer(slot.slotId, wafer);

            // Look up recipe for this model
            var recipe = this.recipeMap[slot.model] || 'DEFAULT';
            wafer.recipe = recipe;

            console.log('[EC] Loaded Slot', slot.slotId + ':', slot.waferId,
                        '(Model:', slot.model, ', Recipe:', recipe + ')');
        }

        carrier.state = 'MAPPED';

        // Update SV
        this.ecSystem.setSVValue(304, carrier.getWaferCount());

        this.emit('slotMapLoaded', {
            carrierId: carrierId,
            lotId: carrier.lotId,
            waferCount: carrier.getWaferCount(),
            slotMap: carrier.getSlotMap()
        });

        return { success: true, waferCount: carrier.getWaferCount() };
    };

    // ============================================================
    // WAFER OPERATIONS
    // ============================================================

    /**
     * Pick wafer from slot (robot picks wafer)
     */
    WaferTrackingEC.prototype.pickWafer = function (carrierId, slotId, callback) {
        var carrier = this.carriers[carrierId];
        if (!carrier) {
            if (callback) callback(new Error('Carrier not found'));
            return;
        }

        var wafer = carrier.slots[slotId];
        if (!wafer) {
            if (callback) callback(new Error('No wafer in slot'));
            return;
        }

        console.log('[EC] Picking wafer:', wafer.waferId, 'from Slot:', slotId);

        wafer.state = 'PICKED';
        wafer.addHistory('PICKED', { carrierId: carrierId, slotId: slotId });

        // Update SVs
        this.ecSystem.setSVValue(302, wafer.waferId);
        this.ecSystem.setSVValue(303, slotId);

        // Send S6F11 event
        this.s6f11Handler.setVariable('WaferId', wafer.waferId);
        this.s6f11Handler.setVariable('CarrierId', carrierId);
        this.s6f11Handler.setVariable('SlotId', slotId);
        this.s6f11Handler.setVariable('PortId', carrier.portId);

        this.s6f11Handler.sendEventReport(WaferTrackingCEID.WAFER_PICKED, {}, callback);

        this.emit('waferPicked', { waferId: wafer.waferId, slotId: slotId });

        return wafer;
    };

    /**
     * Place wafer to slot (robot places wafer)
     */
    WaferTrackingEC.prototype.placeWafer = function (waferId, carrierId, slotId, callback) {
        var wafer = this.wafers[waferId];
        if (!wafer) {
            if (callback) callback(new Error('Wafer not found'));
            return;
        }

        var carrier = this.carriers[carrierId];
        if (!carrier) {
            if (callback) callback(new Error('Carrier not found'));
            return;
        }

        console.log('[EC] Placing wafer:', waferId, 'to Slot:', slotId);

        // Update wafer location
        wafer.carrierId = carrierId;
        wafer.slotId = slotId;
        wafer.portId = carrier.portId;
        wafer.state = 'PRESENT';
        wafer.addHistory('PLACED', { carrierId: carrierId, slotId: slotId });

        // Update carrier slot
        carrier.slots[slotId] = wafer;

        // Send S6F11 event
        this.s6f11Handler.setVariable('WaferId', waferId);
        this.s6f11Handler.setVariable('CarrierId', carrierId);
        this.s6f11Handler.setVariable('SlotId', slotId);
        this.s6f11Handler.setVariable('PortId', carrier.portId);

        this.s6f11Handler.sendEventReport(WaferTrackingCEID.WAFER_PLACED, {}, callback);

        this.emit('waferPlaced', { waferId: waferId, slotId: slotId });
    };

    /**
     * Start wafer processing
     */
    WaferTrackingEC.prototype.startWaferProcess = function (waferId, callback) {
        var wafer = this.wafers[waferId];
        if (!wafer) {
            if (callback) callback(new Error('Wafer not found'));
            return;
        }

        console.log('[EC] Starting process for wafer:', waferId);
        console.log('[EC] Model:', wafer.model, ', Recipe:', wafer.recipe);

        wafer.state = 'PROCESSING';
        wafer.processStartTime = new Date();
        wafer.addHistory('PROCESS_START', { recipe: wafer.recipe });

        // Update SVs
        this.ecSystem.setSVValue(302, waferId);
        this.ecSystem.setSVValue(306, wafer.recipe);

        // Send S6F11 event
        this.s6f11Handler.setVariable('WaferId', waferId);
        this.s6f11Handler.setVariable('LotId', wafer.lotId);
        this.s6f11Handler.setVariable('SlotId', wafer.slotId);
        this.s6f11Handler.setVariable('Model', wafer.model);
        this.s6f11Handler.setVariable('State', 'PROCESSING');

        this.s6f11Handler.sendEventReport(WaferTrackingCEID.WAFER_PROCESS_START, {}, callback);

        this.emit('waferProcessStart', {
            waferId: waferId,
            lotId: wafer.lotId,
            model: wafer.model,
            recipe: wafer.recipe
        });
    };

    /**
     * End wafer processing
     * @param {string} waferId - Wafer ID
     * @param {number} result - 0=OK, 1=NG, 2=SKIP
     */
    WaferTrackingEC.prototype.endWaferProcess = function (waferId, result, callback) {
        var wafer = this.wafers[waferId];
        if (!wafer) {
            if (callback) callback(new Error('Wafer not found'));
            return;
        }

        wafer.processEndTime = new Date();
        wafer.processResult = result;
        wafer.state = result === 0 ? 'COMPLETED' : 'ERROR';

        var processTime = (wafer.processEndTime - wafer.processStartTime) / 1000;

        wafer.addHistory('PROCESS_END', {
            result: result,
            processTime: processTime
        });

        console.log('[EC] Process ended for wafer:', waferId);
        console.log('[EC] Result:', result === 0 ? 'OK' : (result === 1 ? 'NG' : 'SKIP'));
        console.log('[EC] Process time:', processTime, 'seconds');

        // Update SVs
        var processedCount = this.ecSystem.getSVValue(305) || 0;
        this.ecSystem.setSVValue(305, processedCount + 1);

        // Send S6F11 event
        this.s6f11Handler.setVariable('WaferId', waferId);
        this.s6f11Handler.setVariable('LotId', wafer.lotId);
        this.s6f11Handler.setVariable('Recipe', wafer.recipe);
        this.s6f11Handler.setVariable('ProcessResult', result);
        this.s6f11Handler.setVariable('ProcessTime', processTime);

        this.s6f11Handler.sendEventReport(WaferTrackingCEID.WAFER_PROCESS_END, {}, callback);

        this.emit('waferProcessEnd', {
            waferId: waferId,
            lotId: wafer.lotId,
            result: result,
            processTime: processTime
        });
    };

    // ============================================================
    // SORTING OPERATIONS
    // ============================================================

    /**
     * Sort wafer from source to destination
     */
    WaferTrackingEC.prototype.sortWafer = function (waferId, destCarrierId, destSlotId, callback) {
        var self = this;
        var wafer = this.wafers[waferId];

        if (!wafer) {
            if (callback) callback(new Error('Wafer not found'));
            return;
        }

        var srcCarrierId = wafer.carrierId;
        var srcSlotId = wafer.slotId;

        console.log('[EC] Sorting wafer:', waferId);
        console.log('[EC] From:', srcCarrierId, 'Slot', srcSlotId);
        console.log('[EC] To:', destCarrierId, 'Slot', destSlotId);

        // Pick from source
        this.pickWafer(srcCarrierId, srcSlotId, function (err) {
            if (err) {
                if (callback) callback(err);
                return;
            }

            // Remove from source carrier
            var srcCarrier = self.carriers[srcCarrierId];
            srcCarrier.slots[srcSlotId] = null;

            // Place to destination
            self.placeWafer(waferId, destCarrierId, destSlotId, callback);
        });
    };

    // ============================================================
    // RECIPE MANAGEMENT
    // ============================================================

    /**
     * Register recipe for model
     */
    WaferTrackingEC.prototype.registerRecipe = function (model, recipe) {
        this.recipeMap[model] = recipe;
        console.log('[EC] Recipe registered:', model, '->', recipe);
    };

    /**
     * Get recipe for model
     */
    WaferTrackingEC.prototype.getRecipeForModel = function (model) {
        return this.recipeMap[model] || 'DEFAULT';
    };

    /**
     * Get recipe for wafer
     */
    WaferTrackingEC.prototype.getRecipeForWafer = function (waferId) {
        var wafer = this.wafers[waferId];
        if (!wafer) return null;
        return wafer.recipe || this.getRecipeForModel(wafer.model);
    };

    // ============================================================
    // QUERY OPERATIONS
    // ============================================================

    /**
     * Get wafer by ID
     */
    WaferTrackingEC.prototype.getWafer = function (waferId) {
        return this.wafers[waferId];
    };

    /**
     * Get carrier by ID
     */
    WaferTrackingEC.prototype.getCarrier = function (carrierId) {
        return this.carriers[carrierId];
    };

    /**
     * Get wafers by lot ID
     */
    WaferTrackingEC.prototype.getWafersByLot = function (lotId) {
        var result = [];
        for (var waferId in this.wafers) {
            if (this.wafers[waferId].lotId === lotId) {
                result.push(this.wafers[waferId]);
            }
        }
        return result;
    };

    /**
     * Get wafers by model
     */
    WaferTrackingEC.prototype.getWafersByModel = function (model) {
        var result = [];
        for (var waferId in this.wafers) {
            if (this.wafers[waferId].model === model) {
                result.push(this.wafers[waferId]);
            }
        }
        return result;
    };

    /**
     * Get processing summary
     */
    WaferTrackingEC.prototype.getProcessingSummary = function () {
        var total = 0;
        var processed = 0;
        var ok = 0;
        var ng = 0;
        var skip = 0;

        for (var waferId in this.wafers) {
            var wafer = this.wafers[waferId];
            total++;
            if (wafer.processResult !== null) {
                processed++;
                if (wafer.processResult === 0) ok++;
                else if (wafer.processResult === 1) ng++;
                else if (wafer.processResult === 2) skip++;
            }
        }

        return {
            total: total,
            processed: processed,
            remaining: total - processed,
            ok: ok,
            ng: ng,
            skip: skip,
            yieldRate: total > 0 ? (ok / total * 100).toFixed(2) + '%' : 'N/A'
        };
    };

    /**
     * Handle S6F11
     */
    WaferTrackingEC.prototype._handleS6F11 = function (message) {
        var eventData = this.s6f11Handler.parseS6F11(message);
        this.s6f11Handler.sendS6F12(AckCode.ACCEPTED, message.systemBytes);
        this.emit('eventReceived', eventData);
    };

    // Export to global
    global.WaferTrackingCEID = WaferTrackingCEID;
    global.WaferTrackingRPTID = WaferTrackingRPTID;
    global.Wafer = Wafer;
    global.Carrier = Carrier;
    global.WaferTrackingEC = WaferTrackingEC;

})(typeof window !== 'undefined' ? window : global);
