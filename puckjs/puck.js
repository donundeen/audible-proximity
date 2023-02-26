

const EDDYSTONE_UUID = 'feaa';
const EDDYSTONE_UID_FRAME = 0x00;
const EDDYSTONE_NAMESPACE_OFFSET = 2;
const EDDYSTONE_NAMESPACE_LENGTH = 10;
const EDDYSTONE_INSTANCE_OFFSET = 14;
const NAMESPACE_FILTER_ID = [ 0x49, 0x6f, 0x49, 0x44, 0x2e,
                              0x2f, 0x2e, 0x6d, 0x70, 0x33 ];
//49 6f 49 44 2e 2f 2e 6d 70 33	
//49 6f 49 44 -434f-4445-b73e-2e2f2e6d7033	
const DIRACT_INSTANCE_LENGTH = 4;
const DIRACT_INSTANCE_OFFSET = 2;
const BITS_PER_BYTE = 8;


// set up I2C
I2C1.setup({ scl : D1, sda: D2 });


console.log("starting");

const SCAN_OPTIONS = {
    filters: [
  //    { manufacturerData: { 0x0583: {} } },
      { services: [ EDDYSTONE_UUID ] }
    ]
};


/**
 * Handle the given Eddystone-UID device, adding to the devices in range if
 * it meets the filter criteria.
 * @param {Array} serviceData The Eddystone service data.
 * @param {Number} rssi The received signal strength.
 */
function handleEddystoneUidDevice(serviceData, rssi) {
  for(let cByte = 0; cByte < EDDYSTONE_NAMESPACE_LENGTH; cByte++) {
    let namespaceIndex = EDDYSTONE_NAMESPACE_OFFSET + cByte;
    if(serviceData[namespaceIndex] !== NAMESPACE_FILTER_ID[cByte]) {
      return;
    }
  }
  
  let instanceId = 0;
  let bitShift = (DIRACT_INSTANCE_LENGTH - 1) * BITS_PER_BYTE;

  for(let cByte = 0; cByte < DIRACT_INSTANCE_LENGTH; cByte++) {
    let instanceByte = serviceData[EDDYSTONE_INSTANCE_OFFSET + cByte];
    instanceId += instanceByte << bitShift;
    bitShift -= BITS_PER_BYTE;
  }

  let unsignedInstanceId = new Uint32Array([instanceId])[0];
  console.log(unsignedInstanceId, rssi);
  sendI2C(unsignedInstanceId, rssi);
}

/**
 * Handle the given device discovered on scan and process further if
 * Eddystone-UID or DirAct.
 * @param {BluetoothDevice} device The discovered device.
 */
function handleDiscoveredDevice(device) {
  let isEddystoneUID = (device.serviceData[EDDYSTONE_UUID][0] ===
                          EDDYSTONE_UID_FRAME);
    if(isEddystoneUID) {
   //   console.log(device);
      handleEddystoneUidDevice(device.serviceData[EDDYSTONE_UUID], device.rssi);
    }  
  
}




function sendI2C(id, rssi){
  digitalWrite(LED2,1)
  console.log("sending?");
  
  I2C1.writeTo(0x12, id.toString() + ":"+rssi.toString());
  // I2C1.writeTo({address:12, stop:false}, 0);


  console.log("sent?");
  digitalWrite(LED2,0)


}

NRF.setScan(handleDiscoveredDevice, SCAN_OPTIONS);  // Start scanning

//setInterval(sendI2C, 3000);
