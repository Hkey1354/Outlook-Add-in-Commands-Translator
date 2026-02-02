# SECS/GEM Communication Module

This module implements SEMI E5 (SECS-II) and E30 (GEM) standards for semiconductor equipment communication with MES (Manufacturing Execution System).

## Overview

The SECS/GEM module provides:

- **S6F11 Event Report** messaging for equipment-to-host event notification
- **Equipment Constants (EC)** management for equipment configuration
- **Status Variables (SV)** for real-time equipment status monitoring
- **MES Interface** for host-side communication
- **Equipment Interface** for equipment-side communication

## Module Structure

```
SecsGem/
├── SecsGemBase.js        # Base SECS/GEM communication handler
├── S6F11Handler.js       # S6F11 Event Report message handling
├── ECSystem.js           # Equipment Constants/Status Variables system
├── MESInterface.js       # MES (Host) side interface
├── EquipmentInterface.js # Equipment side interface
├── examples/
│   ├── EquipmentExample.js  # Equipment usage example
│   └── MESExample.js        # MES usage example
└── README.md
```

## S6F11 Event Report Message

S6F11 (Event Report Send) is a primary message for equipment-to-host communication. It reports collection events with associated data.

### Message Structure

```
S6F11 W
<L
  <DATAID>           // Data ID (U4)
  <CEID>             // Collection Event ID (U4)
  <L n               // List of n reports
    <L 2
      <RPTID>        // Report ID (U4)
      <L m           // List of m variables
        <V>          // Variable value
        ...
      >
    >
    ...
  >
>
```

### S6F12 Acknowledge

```
S6F12
<ACKC6>              // Acknowledge code (Binary)
```

## Usage

### Equipment Side

```javascript
// Create equipment interface
var equipment = new EquipmentInterface({
    equipmentId: 'EQ-001',
    modelName: 'CVD Chamber',
    softwareRevision: '1.0.0',
    host: '192.168.1.100',
    port: 5000
});

// Define custom Equipment Constant
equipment.defineEC({
    ecid: 100,
    ecname: 'ProcessTemperature',
    ecdef: 400,
    ecmin: 200,
    ecmax: 800,
    units: 'degC',
    dataType: ECDataType.FLOAT,
    description: 'Target process temperature'
});

// Define custom Status Variable
equipment.defineSV({
    svid: 100,
    svname: 'ActualTemperature',
    units: 'degC',
    dataType: ECDataType.FLOAT,
    value: 25.0
});

// Define custom collection event with linked reports
equipment.defineReport(100, ['ProcessTemperature', 'ActualTemperature']);
equipment.defineCollectionEvent(200, 'TemperatureChanged', [100]);

// Start equipment
equipment.start(function(err) {
    // Go online
    equipment.goOnline(true, function(err, ack) {
        console.log('Equipment online');
    });
});

// Send S6F11 event report
equipment.sendEventReport(200, {
    ProcessTemperature: 400,
    ActualTemperature: 398.5
}, function(err, ackCode) {
    console.log('Event acknowledged:', ackCode);
});

// Report process events
equipment.reportProcessStarted({
    ppExecName: 'RECIPE001',
    materialId: 'WAFER-001',
    lotId: 'LOT-001'
});

equipment.reportProcessCompleted({
    result: 0,
    processTime: 120.5
});

// Set/Clear alarms
equipment.setAlarm(100, 'Temperature exceeded limit', 2);
equipment.clearAlarm(100);
```

### MES Side

```javascript
// Create MES interface
var mes = new MESInterface({
    autoAcknowledge: true
});

// Register event handlers
mes.on('eventReport', function(eventData) {
    console.log('Event received:', eventData.ceid);
    console.log('Reports:', eventData.reports);
});

// Register handler for specific event
mes.registerEventHandler(CollectionEvents.PROCESSING_STARTED, function(eventData) {
    console.log('Processing started!');
});

// Connect to equipment
mes.connect('EQ-001', { host: '192.168.1.10', port: 5000 }, function(err) {
    // Configure reports on equipment
    mes.defineReports([
        { rptId: 1, vids: [100, 101, 102] }
    ]);

    // Link reports to events
    mes.linkReports([
        { ceid: 200, rptIds: [1] }
    ]);

    // Enable events
    mes.setEventsEnabled(true, []);
});

// Send remote command
mes.sendRemoteCommand('START', [
    { cpname: 'LOT_ID', cpval: 'LOT-001' },
    { cpname: 'RECIPE', cpval: 'RECIPE001' }
]);

// Request/Set equipment constants
mes.requestEquipmentConstants([100, 101, 102]);
mes.setEquipmentConstants([
    { ecid: 100, value: 450 }
]);
```

## Standard Collection Events (CEID)

| CEID | Name | Description |
|------|------|-------------|
| 1 | EquipmentOffline | Equipment went offline |
| 2 | ControlStateLocal | Control state changed to Local |
| 3 | ControlStateRemote | Control state changed to Remote |
| 5 | ProcessingStarted | Processing started |
| 6 | ProcessingCompleted | Processing completed |
| 8 | AlarmSet | Alarm was set |
| 9 | AlarmCleared | Alarm was cleared |
| 100 | LotStarted | Lot processing started |
| 101 | LotCompleted | Lot processing completed |

## Equipment Constants (EC)

Equipment Constants are configurable parameters that control equipment behavior.

```javascript
// Define EC
equipment.defineEC({
    ecid: 100,              // Unique ID
    ecname: 'ProcessTemp',  // Name
    ecdef: 400,             // Default value
    ecmin: 200,             // Minimum value
    ecmax: 800,             // Maximum value
    units: 'degC',          // Units
    dataType: ECDataType.FLOAT,
    description: 'Process temperature setpoint'
});

// Access EC values
var value = equipment.ecSystem.getECValue(100);
equipment.ecSystem.setECValue(100, 450);
```

## Status Variables (SV)

Status Variables represent current equipment state that can be monitored.

```javascript
// Define SV
equipment.defineSV({
    svid: 100,
    svname: 'ActualTemp',
    units: 'degC',
    dataType: ECDataType.FLOAT,
    value: 25.0,
    description: 'Actual temperature'
});

// Access SV values
var value = equipment.ecSystem.getSVValue(100);
equipment.ecSystem.setSVValue(100, 398.5);

// Dynamic SV with getter function
equipment.defineSV({
    svid: 101,
    svname: 'Clock',
    getter: function() {
        return new Date().toISOString();
    }
});
```

## SECS Message Handling

### Supported Messages

**Equipment to Host:**
- S6F11 - Event Report Send
- S5F1 - Alarm Report Send
- S6F1 - Trace Data Send
- S1F2 - On Line Data
- S1F14 - Establish Communications Data

**Host to Equipment:**
- S6F12 - Event Report Acknowledge
- S2F33 - Define Report
- S2F35 - Link Event Report
- S2F37 - Enable/Disable Event Report
- S2F13 - Equipment Constant Request
- S2F15 - New Equipment Constant Send
- S1F3 - Selected Equipment Status Request
- S2F41 - Host Command Send

## Data Types

```javascript
var SecsDataType = {
    LIST: 0x00,      // List
    BINARY: 0x08,    // Binary
    BOOLEAN: 0x09,   // Boolean
    ASCII: 0x10,     // ASCII String
    INT1: 0x19,      // 1-byte signed integer
    INT2: 0x1A,      // 2-byte signed integer
    INT4: 0x1C,      // 4-byte signed integer
    FLOAT4: 0x24,    // 4-byte floating point
    FLOAT8: 0x28,    // 8-byte floating point
    UINT1: 0x29,     // 1-byte unsigned integer
    UINT2: 0x2A,     // 2-byte unsigned integer
    UINT4: 0x2C      // 4-byte unsigned integer
};
```

## Events

### Equipment Interface Events

- `started` - Equipment started
- `stopped` - Equipment stopped
- `controlStateChanged` - Control state changed
- `communicationsEstablished` - Communications established
- `eventReportAcknowledged` - S6F11 acknowledged
- `remoteCommand` - Remote command received
- `ecChanged` - Equipment constant changed
- `alarmSet` - Alarm activated
- `alarmCleared` - Alarm cleared

### MES Interface Events

- `equipmentConnected` - Equipment connected
- `equipmentDisconnected` - Equipment disconnected
- `eventReport` - S6F11 event report received
- `alarm` - Alarm report received
- `traceData` - Trace data received
- `communicationsEstablished` - Communications established

## Browser Usage

```html
<script src="SecsGem/SecsGemBase.js"></script>
<script src="SecsGem/ECSystem.js"></script>
<script src="SecsGem/S6F11Handler.js"></script>
<script src="SecsGem/EquipmentInterface.js"></script>
<script src="SecsGem/MESInterface.js"></script>
<script>
    var equipment = new EquipmentInterface({
        equipmentId: 'EQ-001'
    });
    // ... use equipment
</script>
```

## References

- SEMI E5: SEMI Equipment Communications Standard 2 Message Content (SECS-II)
- SEMI E30: Generic Model for Communications and Control of Manufacturing Equipment (GEM)
- SEMI E37: High-Speed SECS Message Services (HSMS)
