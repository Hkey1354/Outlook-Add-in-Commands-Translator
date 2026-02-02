/**
 * Equipment Side Example
 * Demonstrates how to use the EquipmentInterface to communicate with MES
 * using S6F11 Event Report messages with EC parameters
 */

// Include required modules (in browser, these would be loaded via script tags)
// <script src="../SecsGemBase.js"></script>
// <script src="../ECSystem.js"></script>
// <script src="../S6F11Handler.js"></script>
// <script src="../EquipmentInterface.js"></script>

(function () {
    'use strict';

    // ============================================================
    // EQUIPMENT SETUP
    // ============================================================

    // Create equipment interface
    var equipment = new EquipmentInterface({
        equipmentId: 'CVD-001',
        modelName: 'CVD Chamber',
        softwareRevision: '2.1.0',
        deviceId: 1,
        host: '192.168.1.100',  // MES host address
        port: 5000
    });

    // ============================================================
    // DEFINE CUSTOM EQUIPMENT CONSTANTS (EC)
    // ============================================================

    // Define process-specific ECs
    equipment.defineEC({
        ecid: 100,
        ecname: 'ProcessTemperature',
        ecdef: 400,
        ecmin: 200,
        ecmax: 800,
        units: 'degC',
        dataType: ECDataType.FLOAT,
        description: 'Target process temperature',
        category: 'Process'
    });

    equipment.defineEC({
        ecid: 101,
        ecname: 'ProcessPressure',
        ecdef: 1.0,
        ecmin: 0.1,
        ecmax: 10.0,
        units: 'Torr',
        dataType: ECDataType.FLOAT,
        description: 'Target process pressure',
        category: 'Process'
    });

    equipment.defineEC({
        ecid: 102,
        ecname: 'ProcessTime',
        ecdef: 60,
        ecmin: 10,
        ecmax: 3600,
        units: 'sec',
        dataType: ECDataType.UINT,
        description: 'Process duration',
        category: 'Process'
    });

    equipment.defineEC({
        ecid: 103,
        ecname: 'GasFlowRate',
        ecdef: 100,
        ecmin: 0,
        ecmax: 500,
        units: 'sccm',
        dataType: ECDataType.FLOAT,
        description: 'Process gas flow rate',
        category: 'Process'
    });

    // ============================================================
    // DEFINE CUSTOM STATUS VARIABLES (SV)
    // ============================================================

    equipment.defineSV({
        svid: 100,
        svname: 'ActualTemperature',
        units: 'degC',
        dataType: ECDataType.FLOAT,
        value: 25.0,
        description: 'Current chamber temperature'
    });

    equipment.defineSV({
        svid: 101,
        svname: 'ActualPressure',
        units: 'Torr',
        dataType: ECDataType.FLOAT,
        value: 760.0,
        description: 'Current chamber pressure'
    });

    equipment.defineSV({
        svid: 102,
        svname: 'WaferCount',
        units: '',
        dataType: ECDataType.UINT,
        value: 0,
        description: 'Number of wafers processed'
    });

    // ============================================================
    // DEFINE CUSTOM COLLECTION EVENTS AND REPORTS
    // ============================================================

    // Custom report for process parameters
    equipment.defineReport(100, [
        'ProcessTemperature',
        'ProcessPressure',
        'ProcessTime',
        'GasFlowRate'
    ]);

    // Custom report for actual values
    equipment.defineReport(101, [
        'ActualTemperature',
        'ActualPressure',
        'WaferCount'
    ]);

    // Custom collection events
    equipment.defineCollectionEvent(200, 'ProcessParametersChanged', [100]);
    equipment.defineCollectionEvent(201, 'WaferProcessed', [101]);
    equipment.defineCollectionEvent(202, 'RecipeSelected', [100]);
    equipment.defineCollectionEvent(203, 'ChamberReady', [101]);

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    equipment.on('started', function (data) {
        console.log('Equipment started:', data.equipmentId);
    });

    equipment.on('controlStateChanged', function (data) {
        console.log('Control state changed:', data.oldState, '->', data.newState);
    });

    equipment.on('communicationsEstablished', function (data) {
        console.log('Communications established with MES');
    });

    equipment.on('eventReportAcknowledged', function (data) {
        console.log('Event report acknowledged:', data.eventName, 'ACK:', data.ackCode);
    });

    equipment.on('remoteCommand', function (data) {
        console.log('Remote command received:', data.command, 'Params:', data.params);
        handleRemoteCommand(data.command, data.params);
    });

    equipment.on('ecChanged', function (data) {
        console.log('EC changed:', data.ecname, data.oldValue, '->', data.newValue);
    });

    // ============================================================
    // REMOTE COMMAND HANDLER
    // ============================================================

    function handleRemoteCommand(command, params) {
        switch (command) {
            case 'START':
                startProcess(params);
                break;
            case 'STOP':
                stopProcess();
                break;
            case 'PAUSE':
                pauseProcess();
                break;
            case 'RESUME':
                resumeProcess();
                break;
            case 'PP_SELECT':
                selectRecipe(params.PPID);
                break;
            default:
                console.log('Unknown command:', command);
        }
    }

    // ============================================================
    // PROCESS SIMULATION FUNCTIONS
    // ============================================================

    var currentLotId = '';
    var currentRecipe = '';

    function selectRecipe(recipeId) {
        currentRecipe = recipeId;
        console.log('Recipe selected:', recipeId);

        // Send S6F11 for recipe selection
        equipment.sendEventReport(202, {
            PPExecName: recipeId,
            ProcessTemperature: equipment.ecSystem.getECValue(100),
            ProcessPressure: equipment.ecSystem.getECValue(101),
            ProcessTime: equipment.ecSystem.getECValue(102),
            GasFlowRate: equipment.ecSystem.getECValue(103)
        }, function (err, ackCode) {
            if (err) {
                console.error('Failed to send recipe selection event:', err);
            }
        });
    }

    function startProcess(params) {
        currentLotId = params.LOT_ID || 'LOT001';

        console.log('Starting process for lot:', currentLotId);

        // Report lot started
        equipment.reportLotStarted({
            lotId: currentLotId,
            carrierId: params.CARRIER_ID || 'CARRIER001'
        });

        // Simulate processing each wafer
        processNextWafer(1, 25); // Process 25 wafers
    }

    function processNextWafer(waferNum, totalWafers) {
        if (waferNum > totalWafers) {
            // All wafers processed
            completeLot();
            return;
        }

        console.log('Processing wafer', waferNum, 'of', totalWafers);

        // Report process started
        equipment.reportProcessStarted({
            ppExecName: currentRecipe,
            materialId: 'WAFER-' + waferNum,
            lotId: currentLotId
        });

        // Simulate process time
        var processTime = equipment.ecSystem.getECValue(102) || 60;

        // Simulate temperature ramp up
        var targetTemp = equipment.ecSystem.getECValue(100);
        equipment.ecSystem.setSVValue(100, targetTemp);

        setTimeout(function () {
            // Update wafer count
            var count = equipment.ecSystem.getSVValue(102) || 0;
            equipment.ecSystem.setSVValue(102, count + 1);

            // Report process completed
            equipment.reportProcessCompleted({
                result: 0, // Success
                processTime: processTime
            });

            // Report wafer processed event with actual values
            equipment.sendEventReport(201, {
                ActualTemperature: equipment.ecSystem.getSVValue(100),
                ActualPressure: equipment.ecSystem.getSVValue(101),
                WaferCount: equipment.ecSystem.getSVValue(102)
            });

            // Process next wafer
            processNextWafer(waferNum + 1, totalWafers);

        }, 100); // Accelerated for demo (100ms instead of actual process time)
    }

    function completeLot() {
        console.log('Lot completed:', currentLotId);

        equipment.reportLotCompleted({
            lotId: currentLotId,
            result: 0 // Success
        });

        currentLotId = '';
    }

    function stopProcess() {
        console.log('Stopping process');
        equipment.setAlarm(100, 'Process stopped by operator', 1);
    }

    function pauseProcess() {
        console.log('Pausing process');
    }

    function resumeProcess() {
        console.log('Resuming process');
    }

    // ============================================================
    // START EQUIPMENT
    // ============================================================

    equipment.start(function (err) {
        if (err) {
            console.error('Failed to start equipment:', err);
            return;
        }

        console.log('Equipment started successfully');

        // Go online in remote control mode
        equipment.goOnline(true, function (err, ackCode) {
            if (err) {
                console.error('Failed to go online:', err);
                return;
            }

            console.log('Equipment is now online (remote control)');

            // Send chamber ready event
            equipment.sendEventReport(203, {
                ActualTemperature: 25.0,
                ActualPressure: 760.0,
                WaferCount: 0
            });
        });
    });

    // ============================================================
    // EXAMPLE: SEND CUSTOM S6F11 WITH SPECIFIC DATA
    // ============================================================

    function sendCustomEventReport() {
        // Send S6F11 with explicit report data
        equipment.sendEventReportWithData(
            200, // CEID: ProcessParametersChanged
            [
                {
                    rptId: 100,
                    variables: [400.0, 1.5, 120, 150.0] // temp, pressure, time, flow
                }
            ],
            function (err, ackCode) {
                if (err) {
                    console.error('Failed to send custom event:', err);
                } else {
                    console.log('Custom event sent, ACK:', ackCode);
                }
            }
        );
    }

    // Export for testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            equipment: equipment,
            selectRecipe: selectRecipe,
            startProcess: startProcess,
            sendCustomEventReport: sendCustomEventReport
        };
    }

})();
