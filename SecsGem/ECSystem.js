/**
 * Equipment Constants (EC) System
 * Implements SEMI E5/E30 Equipment Constants management
 *
 * Equipment Constants are parameters that define equipment behavior.
 * They can be read (S2F13/S2F14) and modified (S2F15/S2F16) by the host.
 *
 * @module SecsGem/ECSystem
 */

(function (global) {
    'use strict';

    /**
     * EC Data Types
     */
    var ECDataType = {
        BOOLEAN: 'BOOLEAN',
        INT: 'INT',
        UINT: 'UINT',
        FLOAT: 'FLOAT',
        ASCII: 'ASCII',
        BINARY: 'BINARY',
        LIST: 'LIST'
    };

    /**
     * Equipment Constant definition
     * @class
     * @param {Object} config - EC configuration
     */
    function EquipmentConstant(config) {
        this.ecid = config.ecid;              // Equipment Constant ID
        this.ecname = config.ecname || '';    // EC name
        this.ecdef = config.ecdef;            // Default value
        this.ecmin = config.ecmin;            // Minimum value
        this.ecmax = config.ecmax;            // Maximum value
        this.units = config.units || '';      // Units (e.g., 'mm', 'sec', 'degC')
        this.dataType = config.dataType || ECDataType.UINT;
        this.value = config.value !== undefined ? config.value : config.ecdef;
        this.readOnly = config.readOnly || false;
        this.description = config.description || '';
        this.category = config.category || 'General';
    }

    EquipmentConstant.prototype.validate = function (newValue) {
        if (this.readOnly) {
            return { valid: false, error: 'EC is read-only' };
        }

        if (this.dataType === ECDataType.INT || this.dataType === ECDataType.UINT ||
            this.dataType === ECDataType.FLOAT) {
            if (typeof newValue !== 'number') {
                return { valid: false, error: 'Value must be a number' };
            }
            if (this.ecmin !== undefined && newValue < this.ecmin) {
                return { valid: false, error: 'Value below minimum: ' + this.ecmin };
            }
            if (this.ecmax !== undefined && newValue > this.ecmax) {
                return { valid: false, error: 'Value above maximum: ' + this.ecmax };
            }
        }

        if (this.dataType === ECDataType.BOOLEAN) {
            if (typeof newValue !== 'boolean') {
                return { valid: false, error: 'Value must be boolean' };
            }
        }

        return { valid: true };
    };

    EquipmentConstant.prototype.setValue = function (newValue) {
        var validation = this.validate(newValue);
        if (!validation.valid) {
            return validation;
        }
        this.value = newValue;
        return { valid: true, value: this.value };
    };

    EquipmentConstant.prototype.toObject = function () {
        return {
            ecid: this.ecid,
            ecname: this.ecname,
            ecdef: this.ecdef,
            ecmin: this.ecmin,
            ecmax: this.ecmax,
            units: this.units,
            dataType: this.dataType,
            value: this.value,
            readOnly: this.readOnly,
            description: this.description,
            category: this.category
        };
    };

    /**
     * Status Variable definition
     * @class
     * @param {Object} config - SV configuration
     */
    function StatusVariable(config) {
        this.svid = config.svid;              // Status Variable ID
        this.svname = config.svname || '';    // SV name
        this.units = config.units || '';      // Units
        this.dataType = config.dataType || ECDataType.UINT;
        this.value = config.value !== undefined ? config.value : 0;
        this.description = config.description || '';
        this.category = config.category || 'General';
        this.getter = config.getter || null;   // Dynamic value getter function
    }

    StatusVariable.prototype.getValue = function () {
        if (this.getter && typeof this.getter === 'function') {
            return this.getter();
        }
        return this.value;
    };

    StatusVariable.prototype.setValue = function (newValue) {
        this.value = newValue;
        return { valid: true, value: this.value };
    };

    StatusVariable.prototype.toObject = function () {
        return {
            svid: this.svid,
            svname: this.svname,
            units: this.units,
            dataType: this.dataType,
            value: this.getValue(),
            description: this.description,
            category: this.category
        };
    };

    /**
     * Data Variable definition (for collection event reports)
     * @class
     * @param {Object} config - DV configuration
     */
    function DataVariable(config) {
        this.dvid = config.dvid;              // Data Variable ID
        this.dvname = config.dvname || '';    // DV name
        this.units = config.units || '';      // Units
        this.dataType = config.dataType || ECDataType.ASCII;
        this.value = config.value;
        this.description = config.description || '';
    }

    DataVariable.prototype.getValue = function () {
        return this.value;
    };

    DataVariable.prototype.setValue = function (newValue) {
        this.value = newValue;
    };

    /**
     * Equipment Constants System
     * Manages ECs, SVs, and DVs for SECS/GEM communication
     * @class
     * @param {SecsGemHandler} secsHandler - The SECS/GEM handler
     */
    function ECSystem(secsHandler) {
        this.secsHandler = secsHandler;

        // Equipment Constants: ECID -> EquipmentConstant
        this.equipmentConstants = {};

        // Status Variables: SVID -> StatusVariable
        this.statusVariables = {};

        // Data Variables: DVID -> DataVariable
        this.dataVariables = {};

        // Event callbacks
        this.eventCallbacks = {};

        // Change history
        this.changeHistory = [];
        this.maxHistorySize = 1000;

        this._registerHandlers();
        this._initializeDefaultParameters();
    }

    /**
     * Register SECS message handlers for EC/SV operations
     */
    ECSystem.prototype._registerHandlers = function () {
        var self = this;

        // S2F13 - Equipment Constant Request
        this.secsHandler.registerHandler(2, 13, function (message) {
            self._handleS2F13(message);
        });

        // S2F15 - New Equipment Constant Send
        this.secsHandler.registerHandler(2, 15, function (message) {
            self._handleS2F15(message);
        });

        // S2F29 - Equipment Constant Namelist Request
        this.secsHandler.registerHandler(2, 29, function (message) {
            self._handleS2F29(message);
        });

        // S1F3 - Selected Equipment Status Request
        this.secsHandler.registerHandler(1, 3, function (message) {
            self._handleS1F3(message);
        });

        // S1F11 - Status Variable Namelist Request
        this.secsHandler.registerHandler(1, 11, function (message) {
            self._handleS1F11(message);
        });
    };

    /**
     * Initialize default equipment constants
     */
    ECSystem.prototype._initializeDefaultParameters = function () {
        // Common Equipment Constants
        this.defineEC({
            ecid: 1,
            ecname: 'EstablishCommunicationsTimeout',
            ecdef: 30,
            ecmin: 1,
            ecmax: 300,
            units: 'sec',
            dataType: ECDataType.UINT,
            description: 'Time to wait for communications establishment',
            category: 'Communication'
        });

        this.defineEC({
            ecid: 2,
            ecname: 'TimeFormat',
            ecdef: 1,
            ecmin: 0,
            ecmax: 2,
            units: '',
            dataType: ECDataType.UINT,
            description: 'Time format: 0=12hr, 1=24hr, 2=SEMI E30',
            category: 'General'
        });

        this.defineEC({
            ecid: 3,
            ecname: 'InitControlState',
            ecdef: 2,
            ecmin: 1,
            ecmax: 4,
            units: '',
            dataType: ECDataType.UINT,
            description: 'Initial control state: 1=Off-Line, 2=Local, 3=Remote',
            category: 'Control'
        });

        this.defineEC({
            ecid: 4,
            ecname: 'DeviceID',
            ecdef: 0,
            ecmin: 0,
            ecmax: 32767,
            units: '',
            dataType: ECDataType.UINT,
            description: 'SECS Device ID',
            category: 'Communication'
        });

        this.defineEC({
            ecid: 5,
            ecname: 'SpoolMaxSize',
            ecdef: 1000,
            ecmin: 0,
            ecmax: 100000,
            units: 'messages',
            dataType: ECDataType.UINT,
            description: 'Maximum spool size',
            category: 'Spooling'
        });

        this.defineEC({
            ecid: 6,
            ecname: 'SpoolEnabled',
            ecdef: true,
            units: '',
            dataType: ECDataType.BOOLEAN,
            description: 'Enable spooling',
            category: 'Spooling'
        });

        // Common Status Variables
        this.defineSV({
            svid: 1,
            svname: 'ControlState',
            units: '',
            dataType: ECDataType.UINT,
            value: 2,
            description: 'Current control state',
            category: 'Control'
        });

        this.defineSV({
            svid: 2,
            svname: 'EventsEnabled',
            units: '',
            dataType: ECDataType.BOOLEAN,
            value: true,
            description: 'Events reporting enabled',
            category: 'Events'
        });

        this.defineSV({
            svid: 3,
            svname: 'AlarmsEnabled',
            units: '',
            dataType: ECDataType.BOOLEAN,
            value: true,
            description: 'Alarms reporting enabled',
            category: 'Alarms'
        });

        this.defineSV({
            svid: 4,
            svname: 'Clock',
            units: '',
            dataType: ECDataType.ASCII,
            description: 'Equipment clock',
            category: 'General',
            getter: function () {
                return new Date().toISOString();
            }
        });

        this.defineSV({
            svid: 5,
            svname: 'PPExecName',
            units: '',
            dataType: ECDataType.ASCII,
            value: '',
            description: 'Currently executing process program',
            category: 'Process'
        });

        this.defineSV({
            svid: 6,
            svname: 'ProcessState',
            units: '',
            dataType: ECDataType.UINT,
            value: 0,
            description: 'Current process state',
            category: 'Process'
        });
    };

    /**
     * Register event callback
     */
    ECSystem.prototype.on = function (event, callback) {
        if (!this.eventCallbacks[event]) {
            this.eventCallbacks[event] = [];
        }
        this.eventCallbacks[event].push(callback);
    };

    /**
     * Emit event
     */
    ECSystem.prototype.emit = function (event, data) {
        var callbacks = this.eventCallbacks[event];
        if (callbacks) {
            for (var i = 0; i < callbacks.length; i++) {
                try {
                    callbacks[i](data);
                } catch (e) {
                    console.error('ECSystem event callback error:', e);
                }
            }
        }
    };

    /**
     * Define an Equipment Constant
     * @param {Object} config - EC configuration
     */
    ECSystem.prototype.defineEC = function (config) {
        var ec = new EquipmentConstant(config);
        this.equipmentConstants[ec.ecid] = ec;
        return ec;
    };

    /**
     * Define a Status Variable
     * @param {Object} config - SV configuration
     */
    ECSystem.prototype.defineSV = function (config) {
        var sv = new StatusVariable(config);
        this.statusVariables[sv.svid] = sv;
        return sv;
    };

    /**
     * Define a Data Variable
     * @param {Object} config - DV configuration
     */
    ECSystem.prototype.defineDV = function (config) {
        var dv = new DataVariable(config);
        this.dataVariables[dv.dvid] = dv;
        return dv;
    };

    /**
     * Get EC value by ID or name
     * @param {number|string} ecid - EC ID or name
     */
    ECSystem.prototype.getEC = function (ecid) {
        if (typeof ecid === 'string') {
            // Search by name
            for (var id in this.equipmentConstants) {
                if (this.equipmentConstants[id].ecname === ecid) {
                    return this.equipmentConstants[id];
                }
            }
            return null;
        }
        return this.equipmentConstants[ecid];
    };

    /**
     * Get EC value
     */
    ECSystem.prototype.getECValue = function (ecid) {
        var ec = this.getEC(ecid);
        return ec ? ec.value : null;
    };

    /**
     * Set EC value
     */
    ECSystem.prototype.setECValue = function (ecid, value) {
        var ec = this.getEC(ecid);
        if (!ec) {
            return { valid: false, error: 'EC not found: ' + ecid };
        }

        var oldValue = ec.value;
        var result = ec.setValue(value);

        if (result.valid) {
            this._recordChange('EC', ecid, oldValue, value);
            this.emit('ecChanged', {
                ecid: ecid,
                ecname: ec.ecname,
                oldValue: oldValue,
                newValue: value
            });
        }

        return result;
    };

    /**
     * Get SV value by ID or name
     * @param {number|string} svid - SV ID or name
     */
    ECSystem.prototype.getSV = function (svid) {
        if (typeof svid === 'string') {
            for (var id in this.statusVariables) {
                if (this.statusVariables[id].svname === svid) {
                    return this.statusVariables[id];
                }
            }
            return null;
        }
        return this.statusVariables[svid];
    };

    /**
     * Get SV value
     */
    ECSystem.prototype.getSVValue = function (svid) {
        var sv = this.getSV(svid);
        return sv ? sv.getValue() : null;
    };

    /**
     * Set SV value
     */
    ECSystem.prototype.setSVValue = function (svid, value) {
        var sv = this.getSV(svid);
        if (!sv) {
            return { valid: false, error: 'SV not found: ' + svid };
        }

        var oldValue = sv.value;
        var result = sv.setValue(value);

        if (result.valid) {
            this._recordChange('SV', svid, oldValue, value);
            this.emit('svChanged', {
                svid: svid,
                svname: sv.svname,
                oldValue: oldValue,
                newValue: value
            });
        }

        return result;
    };

    /**
     * Get DV value
     */
    ECSystem.prototype.getDVValue = function (dvid) {
        var dv = this.dataVariables[dvid];
        return dv ? dv.getValue() : null;
    };

    /**
     * Set DV value
     */
    ECSystem.prototype.setDVValue = function (dvid, value) {
        var dv = this.dataVariables[dvid];
        if (dv) {
            dv.setValue(value);
        }
    };

    /**
     * Generic getValue that checks EC, SV, and DV
     * @param {number|string} vid - Variable ID
     */
    ECSystem.prototype.getValue = function (vid) {
        // Check EC first
        var ec = this.getEC(vid);
        if (ec) return ec.value;

        // Check SV
        var sv = this.getSV(vid);
        if (sv) return sv.getValue();

        // Check DV
        var dv = this.dataVariables[vid];
        if (dv) return dv.getValue();

        return null;
    };

    /**
     * Record change in history
     */
    ECSystem.prototype._recordChange = function (type, id, oldValue, newValue) {
        this.changeHistory.push({
            timestamp: new Date().toISOString(),
            type: type,
            id: id,
            oldValue: oldValue,
            newValue: newValue
        });

        // Trim history if needed
        if (this.changeHistory.length > this.maxHistorySize) {
            this.changeHistory = this.changeHistory.slice(-this.maxHistorySize);
        }
    };

    /**
     * Handle S2F13 - Equipment Constant Request
     */
    ECSystem.prototype._handleS2F13 = function (message) {
        var ecids = [];
        var values = [];

        if (message.data && message.data.value) {
            // Request for specific ECIDs
            var requestedIds = message.data.value;
            for (var i = 0; i < requestedIds.length; i++) {
                ecids.push(requestedIds[i].value);
            }
        } else {
            // Request for all ECIDs
            for (var id in this.equipmentConstants) {
                ecids.push(parseInt(id));
            }
        }

        // Build response values
        for (var j = 0; j < ecids.length; j++) {
            var ec = this.equipmentConstants[ecids[j]];
            if (ec) {
                values.push(this.secsHandler.serializeData(ec.value));
            } else {
                values.push({ type: SecsDataType.LIST, length: 0, value: [] });
            }
        }

        // Send S2F14 response
        var response = new SecsMessage(2, 14, false, {
            type: SecsDataType.LIST,
            length: values.length,
            value: values
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S2F15 - New Equipment Constant Send
     */
    ECSystem.prototype._handleS2F15 = function (message) {
        var eac = 0; // Equipment Acknowledge Code (0 = OK)

        try {
            if (message.data && message.data.value) {
                var ecList = message.data.value;

                for (var i = 0; i < ecList.length; i++) {
                    var ecData = ecList[i].value;
                    var ecid = ecData[0].value;
                    var newValue = ecData[1].value;

                    var result = this.setECValue(ecid, newValue);
                    if (!result.valid) {
                        eac = 1; // At least one error
                    }
                }
            }
        } catch (e) {
            console.error('Error handling S2F15:', e);
            eac = 2; // Equipment busy
        }

        // Send S2F16 response
        var response = new SecsMessage(2, 16, false, {
            type: SecsDataType.BINARY,
            value: eac
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S2F29 - Equipment Constant Namelist Request
     */
    ECSystem.prototype._handleS2F29 = function (message) {
        var ecids = [];

        if (message.data && message.data.value && message.data.value.length > 0) {
            var requestedIds = message.data.value;
            for (var i = 0; i < requestedIds.length; i++) {
                ecids.push(requestedIds[i].value);
            }
        } else {
            for (var id in this.equipmentConstants) {
                ecids.push(parseInt(id));
            }
        }

        // Build response
        var ecInfoList = [];
        for (var j = 0; j < ecids.length; j++) {
            var ec = this.equipmentConstants[ecids[j]];
            if (ec) {
                ecInfoList.push({
                    type: SecsDataType.LIST,
                    length: 6,
                    value: [
                        SecsGemHandler.createDataItem(SecsDataType.UINT4, ec.ecid),
                        SecsGemHandler.createDataItem(SecsDataType.ASCII, ec.ecname),
                        this.secsHandler.serializeData(ec.ecmin),
                        this.secsHandler.serializeData(ec.ecmax),
                        this.secsHandler.serializeData(ec.ecdef),
                        SecsGemHandler.createDataItem(SecsDataType.ASCII, ec.units)
                    ]
                });
            }
        }

        // Send S2F30 response
        var response = new SecsMessage(2, 30, false, {
            type: SecsDataType.LIST,
            length: ecInfoList.length,
            value: ecInfoList
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S1F3 - Selected Equipment Status Request
     */
    ECSystem.prototype._handleS1F3 = function (message) {
        var svids = [];

        if (message.data && message.data.value && message.data.value.length > 0) {
            var requestedIds = message.data.value;
            for (var i = 0; i < requestedIds.length; i++) {
                svids.push(requestedIds[i].value);
            }
        } else {
            for (var id in this.statusVariables) {
                svids.push(parseInt(id));
            }
        }

        // Build response values
        var values = [];
        for (var j = 0; j < svids.length; j++) {
            var sv = this.statusVariables[svids[j]];
            if (sv) {
                values.push(this.secsHandler.serializeData(sv.getValue()));
            } else {
                values.push({ type: SecsDataType.LIST, length: 0, value: [] });
            }
        }

        // Send S1F4 response
        var response = new SecsMessage(1, 4, false, {
            type: SecsDataType.LIST,
            length: values.length,
            value: values
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Handle S1F11 - Status Variable Namelist Request
     */
    ECSystem.prototype._handleS1F11 = function (message) {
        var svids = [];

        if (message.data && message.data.value && message.data.value.length > 0) {
            var requestedIds = message.data.value;
            for (var i = 0; i < requestedIds.length; i++) {
                svids.push(requestedIds[i].value);
            }
        } else {
            for (var id in this.statusVariables) {
                svids.push(parseInt(id));
            }
        }

        // Build response
        var svInfoList = [];
        for (var j = 0; j < svids.length; j++) {
            var sv = this.statusVariables[svids[j]];
            if (sv) {
                svInfoList.push({
                    type: SecsDataType.LIST,
                    length: 3,
                    value: [
                        SecsGemHandler.createDataItem(SecsDataType.UINT4, sv.svid),
                        SecsGemHandler.createDataItem(SecsDataType.ASCII, sv.svname),
                        SecsGemHandler.createDataItem(SecsDataType.ASCII, sv.units)
                    ]
                });
            }
        }

        // Send S1F12 response
        var response = new SecsMessage(1, 12, false, {
            type: SecsDataType.LIST,
            length: svInfoList.length,
            value: svInfoList
        });
        response.systemBytes = message.systemBytes;
        this.secsHandler.send(response);
    };

    /**
     * Get all ECs as array
     */
    ECSystem.prototype.getAllECs = function () {
        var result = [];
        for (var id in this.equipmentConstants) {
            result.push(this.equipmentConstants[id].toObject());
        }
        return result;
    };

    /**
     * Get all SVs as array
     */
    ECSystem.prototype.getAllSVs = function () {
        var result = [];
        for (var id in this.statusVariables) {
            result.push(this.statusVariables[id].toObject());
        }
        return result;
    };

    /**
     * Export all parameters to object
     */
    ECSystem.prototype.exportConfig = function () {
        return {
            equipmentConstants: this.getAllECs(),
            statusVariables: this.getAllSVs(),
            changeHistory: this.changeHistory
        };
    };

    /**
     * Import parameters from object
     */
    ECSystem.prototype.importConfig = function (config) {
        if (config.equipmentConstants) {
            for (var i = 0; i < config.equipmentConstants.length; i++) {
                this.defineEC(config.equipmentConstants[i]);
            }
        }
        if (config.statusVariables) {
            for (var j = 0; j < config.statusVariables.length; j++) {
                this.defineSV(config.statusVariables[j]);
            }
        }
    };

    // Export to global
    global.ECDataType = ECDataType;
    global.EquipmentConstant = EquipmentConstant;
    global.StatusVariable = StatusVariable;
    global.DataVariable = DataVariable;
    global.ECSystem = ECSystem;

})(typeof window !== 'undefined' ? window : global);
