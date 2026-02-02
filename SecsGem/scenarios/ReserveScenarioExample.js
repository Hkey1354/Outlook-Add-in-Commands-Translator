/**
 * Reserve Scenario Complete Example
 *
 * This example demonstrates the full communication flow:
 *
 * 1. Equipment -> EC: Prepare Lot Request (S6F11, CEID:20000) with LOTID, PORTID
 * 2. EC -> MES: Sorter Prepare Lot (LOTID, PORTID)
 * 3. MES -> EC: Sorter Prepare Lot Reply (LOTID, SlotID, WaferID, Model)
 * 4. EC -> Equipment: RCMD S2F41 Prepare Lot (LOTID, SlotID, WaferID, Model)
 * 5. Equipment -> EC: Start Request (S6F11, CEID:20001) with LOTID, PORTID
 * 6. EC -> MES: Ready to Operation
 * 7. MES -> EC -> Equipment: Host Command S2F41 (Start)
 */

// Include required modules:
// <script src="../SecsGemBase.js"></script>
// <script src="../ECSystem.js"></script>
// <script src="../S6F11Handler.js"></script>
// <script src="../EquipmentInterface.js"></script>
// <script src="../MESInterface.js"></script>
// <script src="ReserveScenario.js"></script>

(function () {
    'use strict';

    console.log('========================================');
    console.log('   Reserve Scenario Example');
    console.log('========================================\n');

    // ============================================================
    // STEP 0: Initialize all systems
    // ============================================================

    console.log('[INIT] Creating EC System...');
    var ecSystem = new ReserveScenarioEC({
        host: '192.168.1.10',
        port: 5000
    });

    console.log('[INIT] Creating Equipment...');
    var equipment = new ReserveScenarioEquipment({
        equipmentId: 'SORTER-001',
        modelName: 'Wafer Sorter',
        portCount: 2,
        host: '192.168.1.10',
        port: 5000
    });

    console.log('[INIT] Creating MES...');
    var mes = new ReserveScenarioMES({
        mesId: 'MES-001'
    });

    // Register lot data in MES
    mes.registerLot('LOT-2024-001', [
        new SlotInfo(1, 'WF-001', 'PRODUCT-A'),
        new SlotInfo(5, 'WF-002', 'PRODUCT-A'),
        new SlotInfo(9, 'WF-003', 'PRODUCT-B'),
        new SlotInfo(13, 'WF-004', 'PRODUCT-A'),
        new SlotInfo(17, 'WF-005', 'PRODUCT-B'),
        new SlotInfo(21, 'WF-006', 'PRODUCT-A'),
        new SlotInfo(24, 'WF-007', 'PRODUCT-B')
    ]);

    // ============================================================
    // STEP 0.5: Setup Event Handlers
    // ============================================================

    // EC System events
    ecSystem.on('connected', function (data) {
        console.log('\n[EC] Connected to Equipment:', data.host + ':' + data.port);
    });

    ecSystem.on('prepareLotRequest', function (data) {
        console.log('\n[EC] === STEP 1 RECEIVED ===');
        console.log('[EC] Prepare Lot Request from Equipment');
        console.log('[EC] LOT ID:', data.lotId);
        console.log('[EC] PORT ID:', data.portId);
    });

    ecSystem.on('mesPrepareLotReply', function (data) {
        console.log('\n[EC] === STEP 3 RECEIVED ===');
        console.log('[EC] MES Prepare Lot Reply');
        console.log('[EC] LOT ID:', data.lotId);
        console.log('[EC] Wafer Count:', data.slotCount);
        console.log('[EC] Slot Map:');
        data.slots.forEach(function (slot) {
            console.log('     Slot', slot.slotId + ':', slot.waferId, '(' + slot.model + ')');
        });
    });

    ecSystem.on('prepareLotCommandSent', function (data) {
        console.log('\n[EC] === STEP 4 SENT ===');
        console.log('[EC] Prepare Lot Command sent to Equipment');
        console.log('[EC] LOT ID:', data.lotId);
        console.log('[EC] Slot Count:', data.slotCount);
    });

    ecSystem.on('startRequest', function (data) {
        console.log('\n[EC] === STEP 5 RECEIVED ===');
        console.log('[EC] Start Request from Equipment');
        console.log('[EC] LOT ID:', data.lotId);
        console.log('[EC] PORT ID:', data.portId);
    });

    ecSystem.on('readyToOperation', function (data) {
        console.log('\n[EC] === STEP 6 SENT ===');
        console.log('[EC] Ready to Operation sent to MES');
        console.log('[EC] LOT ID:', data.lotId);
    });

    ecSystem.on('startCommandSent', function (data) {
        console.log('\n[EC] === STEP 7 SENT ===');
        console.log('[EC] Start Command sent to Equipment');
        console.log('[EC] LOT ID:', data.lotId);
    });

    // Equipment events
    equipment.on('prepareLotRequestSent', function (data) {
        console.log('\n[Equipment] === STEP 1 SENT ===');
        console.log('[Equipment] S6F11 (CEID:20000) - Prepare Lot Request');
        console.log('[Equipment] LOT ID:', data.lotId);
        console.log('[Equipment] PORT ID:', data.portId);
    });

    equipment.on('prepareLotCommandReceived', function (data) {
        console.log('\n[Equipment] === STEP 4 RECEIVED ===');
        console.log('[Equipment] S2F41 - Prepare Lot Command');
        console.log('[Equipment] LOT ID:', data.lotId);
        console.log('[Equipment] Slot Count:', data.slotCount);
        console.log('[Equipment] Loaded wafers:');
        data.slotMap.forEach(function (slot) {
            console.log('     Slot', slot.slotId + ':', slot.waferId);
        });

        // After receiving slot map, equipment is ready to request start
        setTimeout(function () {
            requestStart();
        }, 500);
    });

    equipment.on('startRequestSent', function (data) {
        console.log('\n[Equipment] === STEP 5 SENT ===');
        console.log('[Equipment] S6F11 (CEID:20001) - Start Request');
        console.log('[Equipment] LOT ID:', data.lotId);
        console.log('[Equipment] PORT ID:', data.portId);
    });

    equipment.on('startCommandReceived', function (data) {
        console.log('\n[Equipment] === STEP 7 RECEIVED ===');
        console.log('[Equipment] S2F41 - Start Command');
        console.log('[Equipment] LOT ID:', data.lotId);
    });

    equipment.on('lotStarted', function (data) {
        console.log('\n[Equipment] *** LOT PROCESSING STARTED ***');
        console.log('[Equipment] LOT ID:', data.lotId);
        console.log('\n========================================');
        console.log('   Reserve Scenario Complete!');
        console.log('========================================\n');
    });

    // MES events
    mes.on('prepareLotRequest', function (data) {
        console.log('\n[MES] === STEP 2 RECEIVED ===');
        console.log('[MES] Sorter Prepare Lot Request');
        console.log('[MES] LOT ID:', data.lotId);
        console.log('[MES] PORT ID:', data.portId);
        console.log('[MES] Looking up lot information...');
    });

    mes.on('readyToOperation', function (data) {
        console.log('\n[MES] === STEP 6 RECEIVED ===');
        console.log('[MES] Ready to Operation');
        console.log('[MES] LOT ID:', data.lotId);

        // MES decides to start the operation
        setTimeout(function () {
            sendStartFromMES(data.lotId);
        }, 300);
    });

    // Connect MES to EC
    mes.connectToEC(ecSystem);

    // ============================================================
    // SCENARIO EXECUTION FUNCTIONS
    // ============================================================

    var currentLotId = 'LOT-2024-001';
    var currentPortId = 1;

    /**
     * Step 1: Equipment requests lot preparation
     */
    function requestPrepareLot() {
        console.log('\n========================================');
        console.log('   Starting Reserve Scenario');
        console.log('   LOT:', currentLotId);
        console.log('   PORT:', currentPortId);
        console.log('========================================\n');

        equipment.requestPrepareLot(currentLotId, currentPortId, function (err, ack) {
            if (err) {
                console.error('[ERROR] Prepare Lot Request failed:', err);
            }
        });
    }

    /**
     * Step 5: Equipment requests start after preparation
     */
    function requestStart() {
        equipment.requestStart(currentLotId, currentPortId, function (err, ack) {
            if (err) {
                console.error('[ERROR] Start Request failed:', err);
            }
        });
    }

    /**
     * Step 7: MES sends start command
     */
    function sendStartFromMES(lotId) {
        console.log('\n[MES] Sending Start command for LOT:', lotId);

        mes.sendStartCommand(lotId, function (err, reply) {
            if (err) {
                console.error('[ERROR] Start command failed:', err);
            }
        });
    }

    // ============================================================
    // START THE SCENARIO
    // ============================================================

    // Connect EC to equipment
    ecSystem.connect(function (err) {
        if (err) {
            console.error('[ERROR] EC connection failed:', err);
            return;
        }

        // Start equipment
        equipment.start(function (err) {
            if (err) {
                console.error('[ERROR] Equipment start failed:', err);
                return;
            }

            // Begin the scenario after a short delay
            setTimeout(function () {
                requestPrepareLot();
            }, 200);
        });
    });

    // ============================================================
    // UTILITY FUNCTIONS FOR MANUAL TESTING
    // ============================================================

    /**
     * Print current state of all systems
     */
    function printStatus() {
        console.log('\n--- CURRENT STATUS ---');
        console.log('EC State:', ecSystem.getState());
        console.log('Equipment Port 1:', equipment.getPortStatus(1));
        console.log('Equipment Port 2:', equipment.getPortStatus(2));
        console.log('----------------------\n');
    }

    /**
     * Run a new lot
     */
    function runNewLot(lotId, portId) {
        currentLotId = lotId;
        currentPortId = portId;
        requestPrepareLot();
    }

    // Export for testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ecSystem: ecSystem,
            equipment: equipment,
            mes: mes,
            printStatus: printStatus,
            runNewLot: runNewLot
        };
    }

    // Also expose to global for browser testing
    if (typeof window !== 'undefined') {
        window.ReserveScenarioDemo = {
            ecSystem: ecSystem,
            equipment: equipment,
            mes: mes,
            printStatus: printStatus,
            runNewLot: runNewLot
        };
    }

})();

/*
 * Expected Console Output:
 *
 * ========================================
 *    Reserve Scenario Example
 * ========================================
 *
 * [INIT] Creating EC System...
 * [INIT] Creating Equipment...
 * [INIT] Creating MES...
 *
 * [EC] Connected to Equipment: 192.168.1.10:5000
 *
 * ========================================
 *    Starting Reserve Scenario
 *    LOT: LOT-2024-001
 *    PORT: 1
 * ========================================
 *
 * [Equipment] === STEP 1 SENT ===
 * [Equipment] S6F11 (CEID:20000) - Prepare Lot Request
 * [Equipment] LOT ID: LOT-2024-001
 * [Equipment] PORT ID: 1
 *
 * [EC] === STEP 1 RECEIVED ===
 * [EC] Prepare Lot Request from Equipment
 * [EC] LOT ID: LOT-2024-001
 * [EC] PORT ID: 1
 *
 * [MES] === STEP 2 RECEIVED ===
 * [MES] Sorter Prepare Lot Request
 * [MES] LOT ID: LOT-2024-001
 * [MES] PORT ID: 1
 * [MES] Looking up lot information...
 *
 * [EC] === STEP 3 RECEIVED ===
 * [EC] MES Prepare Lot Reply
 * [EC] LOT ID: LOT-2024-001
 * [EC] Wafer Count: 7
 * [EC] Slot Map:
 *      Slot 1: WF-001 (PRODUCT-A)
 *      Slot 5: WF-002 (PRODUCT-A)
 *      Slot 9: WF-003 (PRODUCT-B)
 *      ...
 *
 * [EC] === STEP 4 SENT ===
 * [EC] Prepare Lot Command sent to Equipment
 *
 * [Equipment] === STEP 4 RECEIVED ===
 * [Equipment] S2F41 - Prepare Lot Command
 * [Equipment] Loaded wafers:
 *      Slot 1: WF-001
 *      Slot 5: WF-002
 *      ...
 *
 * [Equipment] === STEP 5 SENT ===
 * [Equipment] S6F11 (CEID:20001) - Start Request
 *
 * [EC] === STEP 5 RECEIVED ===
 * [EC] Start Request from Equipment
 *
 * [EC] === STEP 6 SENT ===
 * [EC] Ready to Operation sent to MES
 *
 * [MES] === STEP 6 RECEIVED ===
 * [MES] Ready to Operation
 *
 * [MES] Sending Start command for LOT: LOT-2024-001
 *
 * [EC] === STEP 7 SENT ===
 * [EC] Start Command sent to Equipment
 *
 * [Equipment] === STEP 7 RECEIVED ===
 * [Equipment] S2F41 - Start Command
 *
 * [Equipment] *** LOT PROCESSING STARTED ***
 *
 * ========================================
 *    Reserve Scenario Complete!
 * ========================================
 */
