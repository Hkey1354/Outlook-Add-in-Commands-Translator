/**
 * MES Side Example
 * Demonstrates how to use the MESInterface to receive S6F11 Event Reports
 * from equipment and manage equipment communication
 */

// Include required modules (in browser, these would be loaded via script tags)
// <script src="../SecsGemBase.js"></script>
// <script src="../ECSystem.js"></script>
// <script src="../S6F11Handler.js"></script>
// <script src="../MESInterface.js"></script>

(function () {
    'use strict';

    // ============================================================
    // MES INTERFACE SETUP
    // ============================================================

    var mes = new MESInterface({
        deviceId: 0,
        autoAcknowledge: true,  // Automatically send S6F12 ack
        t3Timeout: 45000
    });

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    // General event report handler
    mes.on('eventReport', function (eventData) {
        console.log('========================================');
        console.log('EVENT REPORT RECEIVED');
        console.log('----------------------------------------');
        console.log('Data ID:', eventData.dataId);
        console.log('CEID:', eventData.ceid);
        console.log('Timestamp:', eventData.timestamp);
        console.log('Reports:');

        eventData.reports.forEach(function (report, index) {
            console.log('  Report ' + (index + 1) + ':');
            console.log('    RPTID:', report.rptId);
            console.log('    Variables:', report.variables);
        });

        console.log('========================================');

        // Store event in database (simulated)
        storeEventInDatabase(eventData);
    });

    // Alarm handler
    mes.on('alarm', function (alarmData) {
        console.log('ALARM RECEIVED:', alarmData);

        if (alarmData.alarmSet) {
            handleAlarmSet(alarmData);
        } else {
            handleAlarmCleared(alarmData);
        }
    });

    // Equipment connection events
    mes.on('equipmentConnected', function (data) {
        console.log('Equipment connected:', data.equipmentId);
    });

    mes.on('equipmentDisconnected', function (data) {
        console.log('Equipment disconnected:', data.equipmentId);
    });

    mes.on('communicationsEstablished', function (data) {
        console.log('Communications established');
    });

    // ============================================================
    // SPECIFIC EVENT HANDLERS BY CEID
    // ============================================================

    // Handler for Processing Started (CEID 5)
    mes.registerEventHandler(CollectionEvents.PROCESSING_STARTED, function (eventData) {
        console.log('PROCESSING STARTED event received');

        // Extract process information from reports
        var processInfo = extractVariables(eventData.reports, {
            processState: 0,
            ppExecName: 1,
            materialId: 3,
            lotId: 4
        });

        console.log('Process Info:', processInfo);

        // Update production tracking
        updateProductionTracking('STARTED', processInfo);
    });

    // Handler for Processing Completed (CEID 6)
    mes.registerEventHandler(CollectionEvents.PROCESSING_COMPLETED, function (eventData) {
        console.log('PROCESSING COMPLETED event received');

        var resultInfo = extractVariables(eventData.reports, {
            processState: 0,
            processResult: 1,
            processTime: 2
        });

        console.log('Result Info:', resultInfo);

        // Update production tracking
        updateProductionTracking('COMPLETED', resultInfo);

        // Check for failures
        if (resultInfo.processResult !== 0) {
            handleProcessFailure(eventData, resultInfo);
        }
    });

    // Handler for Lot Started (CEID 100)
    mes.registerEventHandler(CollectionEvents.LOT_STARTED, function (eventData) {
        console.log('LOT STARTED event received');

        var lotInfo = extractVariables(eventData.reports, {
            lotId: 0,
            carrierId: 1
        });

        console.log('Lot Info:', lotInfo);

        // Track lot in MES database
        trackLotStart(lotInfo);
    });

    // Handler for Lot Completed (CEID 101)
    mes.registerEventHandler(CollectionEvents.LOT_COMPLETED, function (eventData) {
        console.log('LOT COMPLETED event received');

        var lotResult = extractVariables(eventData.reports, {
            lotId: 0,
            result: 1
        });

        // Complete lot tracking
        trackLotComplete(lotResult);
    });

    // Handler for Alarm Set (CEID 8)
    mes.registerEventHandler(CollectionEvents.ALARM_SET, function (eventData) {
        console.log('ALARM SET event received');

        var alarmInfo = extractVariables(eventData.reports, {
            alarmId: 0,
            alarmText: 1,
            severity: 2
        });

        // Process alarm
        processAlarm(alarmInfo, true);
    });

    // Handler for Alarm Cleared (CEID 9)
    mes.registerEventHandler(CollectionEvents.ALARM_CLEARED, function (eventData) {
        console.log('ALARM CLEARED event received');

        var alarmInfo = extractVariables(eventData.reports, {
            alarmId: 0,
            alarmText: 1
        });

        // Clear alarm
        processAlarm(alarmInfo, false);
    });

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function extractVariables(reports, mapping) {
        var result = {};

        if (reports && reports.length > 0 && reports[0].variables) {
            var vars = reports[0].variables;

            for (var key in mapping) {
                var index = mapping[key];
                if (index < vars.length) {
                    result[key] = vars[index].value !== undefined ? vars[index].value : vars[index];
                }
            }
        }

        return result;
    }

    function storeEventInDatabase(eventData) {
        // Simulated database storage
        console.log('Storing event in database:', eventData.ceid);

        // In real implementation:
        // - Store in SQL/NoSQL database
        // - Update real-time dashboards
        // - Trigger downstream processes
    }

    function updateProductionTracking(state, info) {
        console.log('Production tracking updated:', state, info);

        // In real implementation:
        // - Update WIP (Work In Progress) tracking
        // - Calculate OEE metrics
        // - Update production schedules
    }

    function handleProcessFailure(eventData, resultInfo) {
        console.log('PROCESS FAILURE detected:', resultInfo);

        // In real implementation:
        // - Send notifications
        // - Update quality tracking
        // - Trigger hold procedures
    }

    function trackLotStart(lotInfo) {
        console.log('Lot started:', lotInfo.lotId);

        // In real implementation:
        // - Update lot tracking
        // - Verify recipe parameters
        // - Check hold status
    }

    function trackLotComplete(lotResult) {
        console.log('Lot completed:', lotResult.lotId, 'Result:', lotResult.result);

        // In real implementation:
        // - Update lot status
        // - Calculate yields
        // - Update shipping/inventory
    }

    function handleAlarmSet(alarmData) {
        console.log('Alarm activated:', alarmData.alarmId, alarmData.alarmText);

        // In real implementation:
        // - Log alarm
        // - Send notifications (email, SMS, dashboard)
        // - Trigger automated responses
    }

    function handleAlarmCleared(alarmData) {
        console.log('Alarm cleared:', alarmData.alarmId);

        // In real implementation:
        // - Update alarm status
        // - Calculate alarm duration
        // - Update maintenance records
    }

    function processAlarm(alarmInfo, isSet) {
        console.log('Processing alarm:', alarmInfo, 'Set:', isSet);
    }

    // ============================================================
    // MES OPERATIONS
    // ============================================================

    /**
     * Connect to equipment and configure event reporting
     */
    function connectToEquipment(equipmentId, host, port) {
        mes.connect(equipmentId, { host: host, port: port }, function (err, result) {
            if (err) {
                console.error('Failed to connect to equipment:', err);
                return;
            }

            console.log('Connected to equipment:', equipmentId);

            // Configure reports on equipment
            configureEquipmentReports();
        });
    }

    /**
     * Configure reports and events on equipment
     */
    function configureEquipmentReports() {
        // Define reports on equipment (S2F33)
        mes.defineReports([
            { rptId: 1, vids: [1, 2, 3] },     // Process status report
            { rptId: 2, vids: [4, 5, 6] },     // Process results report
            { rptId: 3, vids: [7, 8, 9] }      // Alarm report
        ], function (err, reply) {
            if (err) {
                console.error('Failed to define reports:', err);
                return;
            }

            console.log('Reports defined successfully');

            // Link reports to events (S2F35)
            linkEventsToReports();
        });
    }

    /**
     * Link reports to collection events
     */
    function linkEventsToReports() {
        mes.linkReports([
            { ceid: CollectionEvents.PROCESSING_STARTED, rptIds: [1] },
            { ceid: CollectionEvents.PROCESSING_COMPLETED, rptIds: [1, 2] },
            { ceid: CollectionEvents.ALARM_SET, rptIds: [3] },
            { ceid: CollectionEvents.ALARM_CLEARED, rptIds: [3] }
        ], function (err, reply) {
            if (err) {
                console.error('Failed to link reports:', err);
                return;
            }

            console.log('Reports linked to events successfully');

            // Enable event reporting (S2F37)
            enableEventReporting();
        });
    }

    /**
     * Enable event reporting
     */
    function enableEventReporting() {
        // Enable all events (empty array = all)
        mes.setEventsEnabled(true, [], function (err, reply) {
            if (err) {
                console.error('Failed to enable events:', err);
                return;
            }

            console.log('Event reporting enabled');
        });
    }

    /**
     * Send remote command to equipment
     */
    function sendStartCommand(lotId, recipeId) {
        mes.sendRemoteCommand('START', [
            { cpname: 'LOT_ID', cpval: lotId },
            { cpname: 'RECIPE_ID', cpval: recipeId }
        ], function (err, reply) {
            if (err) {
                console.error('Failed to send START command:', err);
                return;
            }

            console.log('START command sent successfully');
        });
    }

    /**
     * Request current equipment status
     */
    function requestEquipmentStatus(svids) {
        mes.requestStatusVariables(svids || [], function (err, reply) {
            if (err) {
                console.error('Failed to request status:', err);
                return;
            }

            console.log('Status variables:', reply.data);
        });
    }

    /**
     * Update equipment constant
     */
    function updateEquipmentConstant(ecid, value) {
        mes.setEquipmentConstants([
            { ecid: ecid, value: value }
        ], function (err, reply) {
            if (err) {
                console.error('Failed to update EC:', err);
                return;
            }

            console.log('EC updated successfully');
        });
    }

    // ============================================================
    // START MES
    // ============================================================

    // Connect to equipment
    connectToEquipment('CVD-001', '192.168.1.10', 5000);

    // Export for external use
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            mes: mes,
            connectToEquipment: connectToEquipment,
            sendStartCommand: sendStartCommand,
            requestEquipmentStatus: requestEquipmentStatus,
            updateEquipmentConstant: updateEquipmentConstant
        };
    }

})();
