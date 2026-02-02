/**
 * Wafer Tracking System - Complete Usage Example
 *
 * Demonstrates how LOT ID, Slot ID, Wafer ID, and Model are used for:
 * 1. Tracking wafer locations
 * 2. Selecting recipes based on Model
 * 3. Recording process results per wafer
 * 4. Sorting wafers between carriers
 */

(function () {
    'use strict';

    console.log('========================================');
    console.log('   Wafer Tracking System Example');
    console.log('========================================\n');

    // ============================================================
    // STEP 1: Initialize EC System with Recipe Mapping
    // ============================================================

    var ecSystem = new WaferTrackingEC({
        portCount: 2
    });

    // Register recipe mapping: Model -> Recipe
    // Different models require different process parameters
    ecSystem.registerRecipe('PRODUCT-A', 'RECIPE-001');  // Product A uses Recipe 1
    ecSystem.registerRecipe('PRODUCT-B', 'RECIPE-002');  // Product B uses Recipe 2
    ecSystem.registerRecipe('PRODUCT-C', 'RECIPE-003');  // Product C uses Recipe 3

    console.log('[SETUP] Recipe mapping registered:');
    console.log('  PRODUCT-A -> RECIPE-001');
    console.log('  PRODUCT-B -> RECIPE-002');
    console.log('  PRODUCT-C -> RECIPE-003');
    console.log('');

    // ============================================================
    // STEP 2: Carrier Arrives with Lot Information
    // ============================================================

    console.log('--- STEP 2: Carrier Arrival ---\n');

    var carrierId = 'FOUP-001';
    var lotId = 'LOT-2024-001';
    var portId = 1;

    var carrier = ecSystem.carrierArrived(carrierId, portId, lotId);
    console.log('');

    // ============================================================
    // STEP 3: Load Slot Map from MES
    // (This data comes from MES after Prepare Lot request)
    // ============================================================

    console.log('--- STEP 3: Load Slot Map from MES ---\n');

    // Slot data from MES - only populated slots are sent
    // (Wafer가 들어있는 Slot정보만 전송함)
    var mesSlotData = [
        { slotId: 1,  waferId: 'WF-001', model: 'PRODUCT-A' },
        { slotId: 5,  waferId: 'WF-002', model: 'PRODUCT-A' },
        { slotId: 9,  waferId: 'WF-003', model: 'PRODUCT-B' },
        { slotId: 13, waferId: 'WF-004', model: 'PRODUCT-A' },
        { slotId: 17, waferId: 'WF-005', model: 'PRODUCT-B' },
        { slotId: 21, waferId: 'WF-006', model: 'PRODUCT-C' },
        { slotId: 24, waferId: 'WF-007', model: 'PRODUCT-C' }
    ];

    ecSystem.loadSlotMap(carrierId, mesSlotData);
    console.log('');

    // ============================================================
    // STEP 4: Display Slot Map
    // ============================================================

    console.log('--- STEP 4: Current Slot Map ---\n');

    var slotMap = carrier.getSlotMap();
    console.log('Carrier:', carrierId, '| LOT:', lotId, '| Wafers:', slotMap.length);
    console.log('');
    console.log('Slot | Wafer ID  | Model      | Recipe');
    console.log('-----|-----------|------------|------------');
    slotMap.forEach(function (slot) {
        var wafer = ecSystem.getWafer(slot.waferId);
        console.log(
            String(slot.slotId).padStart(4) + ' | ' +
            slot.waferId.padEnd(9) + ' | ' +
            slot.model.padEnd(10) + ' | ' +
            wafer.recipe
        );
    });
    console.log('');

    // ============================================================
    // STEP 5: Process Wafers (Recipe selected by Model)
    // ============================================================

    console.log('--- STEP 5: Process Wafers ---\n');

    // Get wafers grouped by model for batch processing
    var productAWafers = ecSystem.getWafersByModel('PRODUCT-A');
    var productBWafers = ecSystem.getWafersByModel('PRODUCT-B');
    var productCWafers = ecSystem.getWafersByModel('PRODUCT-C');

    console.log('Wafers by Model:');
    console.log('  PRODUCT-A:', productAWafers.length, 'wafers');
    console.log('  PRODUCT-B:', productBWafers.length, 'wafers');
    console.log('  PRODUCT-C:', productCWafers.length, 'wafers');
    console.log('');

    // Process first wafer as example
    var firstWafer = ecSystem.getWafer('WF-001');
    console.log('Processing wafer:', firstWafer.waferId);
    console.log('  LOT ID:', firstWafer.lotId);
    console.log('  Slot:', firstWafer.slotId);
    console.log('  Model:', firstWafer.model);
    console.log('  Recipe:', firstWafer.recipe);
    console.log('');

    // Start process
    ecSystem.startWaferProcess('WF-001');

    // Simulate process completion
    setTimeout(function () {
        // End process with result (0=OK, 1=NG, 2=SKIP)
        ecSystem.endWaferProcess('WF-001', 0); // OK
        console.log('');

        // Process another wafer with different model
        processAnotherWafer();
    }, 100);

    function processAnotherWafer() {
        console.log('--- Processing wafer with different model ---\n');

        var wafer = ecSystem.getWafer('WF-003'); // PRODUCT-B
        console.log('Processing wafer:', wafer.waferId);
        console.log('  Model:', wafer.model);
        console.log('  Recipe:', wafer.recipe, '(different from PRODUCT-A)');
        console.log('');

        ecSystem.startWaferProcess('WF-003');

        setTimeout(function () {
            ecSystem.endWaferProcess('WF-003', 0); // OK
            console.log('');

            // Show wafer sorting example
            showSortingExample();
        }, 100);
    }

    // ============================================================
    // STEP 6: Sorting Example - Move wafer to different slot
    // ============================================================

    function showSortingExample() {
        console.log('--- STEP 6: Wafer Sorting ---\n');

        // Create destination carrier
        var destCarrierId = 'FOUP-002';
        ecSystem.carrierArrived(destCarrierId, 2, 'LOT-2024-001-SORTED');
        console.log('');

        // Sort wafer from FOUP-001 Slot 1 to FOUP-002 Slot 1
        console.log('Sorting WF-001 from FOUP-001 to FOUP-002...\n');

        ecSystem.sortWafer('WF-001', destCarrierId, 1, function () {
            var wafer = ecSystem.getWafer('WF-001');
            console.log('\nWafer WF-001 new location:');
            console.log('  Carrier:', wafer.carrierId);
            console.log('  Slot:', wafer.slotId);
            console.log('');

            // Show final summary
            showSummary();
        });
    }

    // ============================================================
    // STEP 7: Processing Summary
    // ============================================================

    function showSummary() {
        console.log('--- STEP 7: Processing Summary ---\n');

        var summary = ecSystem.getProcessingSummary();
        console.log('Total wafers:', summary.total);
        console.log('Processed:', summary.processed);
        console.log('Remaining:', summary.remaining);
        console.log('OK:', summary.ok);
        console.log('NG:', summary.ng);
        console.log('SKIP:', summary.skip);
        console.log('Yield Rate:', summary.yieldRate);
        console.log('');

        // Show wafer history
        showWaferHistory();
    }

    function showWaferHistory() {
        console.log('--- Wafer WF-001 History ---\n');

        var wafer = ecSystem.getWafer('WF-001');
        wafer.history.forEach(function (entry, index) {
            console.log((index + 1) + '. ' + entry.event);
            console.log('   Time:', entry.timestamp);
            console.log('   Data:', JSON.stringify(entry.data));
        });

        console.log('\n========================================');
        console.log('   Example Complete!');
        console.log('========================================');
    }

    // ============================================================
    // EVENT HANDLERS FOR MONITORING
    // ============================================================

    ecSystem.on('carrierArrived', function (data) {
        // Log to MES database
    });

    ecSystem.on('waferProcessStart', function (data) {
        // Record process start in database
        // data: { waferId, lotId, model, recipe }
    });

    ecSystem.on('waferProcessEnd', function (data) {
        // Record process result in database
        // data: { waferId, lotId, result, processTime }
    });

    // Export for testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ecSystem: ecSystem };
    }

})();

/*
 * KEY CONCEPTS:
 *
 * 1. LOT ID (작업할 LOT ID)
 *    - Groups wafers together for tracking
 *    - Used for batch processing and reporting
 *    - Example: LOT-2024-001
 *
 * 2. SLOT ID
 *    - Physical position in carrier (1-25)
 *    - Only populated slots are transmitted from MES
 *    - Used for robot pick/place operations
 *
 * 3. WAFER ID
 *    - Unique identifier for each wafer
 *    - Read by OCR or assigned by MES
 *    - Used for individual wafer tracking
 *
 * 4. MODEL
 *    - Product type/variant
 *    - Determines which RECIPE to use
 *    - Different models may have different process parameters
 *
 * 5. RECIPE (determined by Model)
 *    - Process parameters for the wafer
 *    - Selected automatically based on Model
 *    - Controls temperature, time, pressure, etc.
 *
 * S6F11 EVENTS SENT:
 *    - CEID 30000: Carrier Arrived
 *    - CEID 30020: Wafer Picked
 *    - CEID 30021: Wafer Placed
 *    - CEID 30030: Wafer Process Start
 *    - CEID 30031: Wafer Process End (with result)
 */
