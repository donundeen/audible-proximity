/**
 * Copyright reelyActive 2022
 * We believe in an open Internet of Things
 */


const advlib = require('advlib');
const Barnowl = require('barnowl');
const BarnowlHci = require('barnowl-hci');
const mpg = require('mpg123');// https://www.npmjs.com/package/mpg123
const path = require('path');
const { exec } = require('child_process');
const KalmanFilter = require('kalmanjs');
const fs = require('fs');

var sys   = require('util');
var spawn = require('child_process').spawn;



const DEFAULT_AUDIO_FOLDER_PATH = './data/audio/';
const DEFAULT_MAX_CONCURRENT_PLAYERS = 1;
const MONITOR_DATA_FILE = "/home/pi/datamon.txt";
const MAX_MON_LINES = 4;


const AUDIO_FILE_LIST = [
  '0000000.mp3',
  '0000001.mp3',
  '0000002.mp3',
  '0000003.mp3',
  '0000004.mp3',
  '0000005.mp3',
  '0000006.mp3',
  '0000007.mp3',
  '0000008.mp3',
  '0000009.mp3',
  '0000010.mp3',
  '0000011.mp3',
  '0000012.mp3',
  '0000013.mp3',
  '0000014.mp3',
  '0000015.mp3',
  '0000016.mp3',
  '0000017.mp3',
  '0000018.mp3',
  '0000019.mp3',
  '0000020.mp3'
];
const NUM_AUDIO_FILES = 21;

const PAUSE_BETWEEN_LOOPS = 3000; // pause, in milliseconds, between loops of the same track
const DEFAULT_MAX_VOLUME_RSSI = -60;
const DEFAULT_MIN_VOLUME_RSSI = -80;
const BEACON_STALE_TIMEOUT_MS = 4000; // if beacon signal is older than this, it's "gone"
const STALE_VOLUME_RATIO = .8;
const DEFAULT_AUDIO_UPDATE_MILLISECONDS = 500;
const DEFAULT_STALE_THRESHOLD_MILLISECONDS = 10000;
const DEFAULT_PACKET_PROCESSORS = [
  {
    processor: require('advlib-ble'),
    libraries: [require('advlib-ble-services'),
    require('advlib-ble-manufacturers')],
    options: { ignoreProtocolOverhead: true }
  }
];
const DEFAULT_PACKET_INTERPRETERS = [require('advlib-interoperable')];

// load vars set in .env file
require('dotenv').config();


/**
 * AudibleProximity Class
 * Programatically play audio files on a portable computer, like the Raspberry
 * Pi, based on its proximity to Bluetooth beacons.
 */
class AudibleProximity {

  /**
   * AudibleProximity constructor
   * @param {Object} options The configuration options.
   * @constructor
   */
  constructor(options) {
    let self = this;
    options = options || {};


    waitForHeadphones(options, function () {
      console.log("starting players");

      self.audibleDevices = new Map();
      self.audioFolderPath = options.audioFolderPath || DEFAULT_AUDIO_FOLDER_PATH;
      self.maxVolumeRSSI = options.maxVolumeRSSI || DEFAULT_MAX_VOLUME_RSSI;
      self.minVolumeRSSI = options.minVolumeRSSI || DEFAULT_MIN_VOLUME_RSSI;
      self.staleThresholdMilliseconds = options.staleThresholdMilliseconds ||
        DEFAULT_STALE_THRESHOLD_MILLISECONDS;
      self.packetProcessors = options.packetProcessors ||
        DEFAULT_PACKET_PROCESSORS;
      self.packetInterpreters = options.packetInterpreters ||
        DEFAULT_PACKET_INTERPRETERS;
      self.beaconStaleTimeoutMS = options.beaconStaleTimeoutMS || BEACON_STALE_TIMEOUT_MS;
      self.isDebug = options.isDebug || false;

      self.players = createPlayers(options);
      setInterval(updateAudioPlayback, DEFAULT_AUDIO_UPDATE_MILLISECONDS, self);
      
      let dummy  = spawn('python', ['/home/pi/audible-proximity/lib/getbeacondata.py']);
//      dummy.stdout.pipe(process.stdout);
//      dummy.stderr.pipe(process.stderr);

      dummy.stdout.on('data', function(data) {
        console.log("data is ");
        console.log(data.toString());
        data = data.toString();
        if(data.trim() != ""){
            var split = data.split(":");
            var id = split[0].trim();
            var rssi = split[1].trim();
  //          console.log(id+":"+rssi+":"+parseInt(rssi));
            handleRaddec(self, id, parseInt(rssi));
        } 
        
      });      

    });
  }

}


function waitForHeadphones(options, callback) {

/*  
  console.log("skippping headphone connect");
  callback();
  return;
*/
  // if there's a headphones_id set, then we need to try to connect to it manually here
  if (process.env.HEADPHONES_ID) {
    console.log("connecting to headphones " + process.env.HEADPHONES_ID);
    exec("bluetoothctl connect " + process.env.HEADPHONES_ID, (error, stdout, stderr) => {
      if (error) {
        console.log(`exec error: ${error.message}`);
      }
      if (stderr) {
        console.log(`exec stderr: ${stderr}`);
      }
 //     console.log(`exec stdout ${stdout}`);
    });
  }

  // this is where we might wait until we see a set of headphones connected before we start
  exec("pacmd list-sinks", (error, stdout, stderr) => {
    if (error) {
      console.log(`exec error: ${error.message}`);
    }
    if (stderr) {
      console.log(`exec stderr: ${stderr}`);
    }
    //		if(stdout.includes("drive: <module-bluez5-device.c>")){
    if (stdout.includes("module-bluez5-device")) {

      console.log("headphones found");
      callback();
    } else {
      console.log("headphones not found");
 //     console.log(`exec stdout ${stdout}`);
      setTimeout(function () { waitForHeadphones(options, callback) }, 1000);
    }
  });


}




/**
 * Create an array of media players.
 * @param {Object} options The configuration options.
 * @return {Array} The media players.
 */
function createPlayers(options) {
  let players = [];

  for (let cPlayer = 0; cPlayer < NUM_AUDIO_FILES; cPlayer++) {
    // WHERE NEW MPG PLAYERS ARE CREATED: https://www.npmjs.com/package/mpg123
    // there are enough players created for the max number of concurrent players
    let file = AUDIO_FILE_LIST[cPlayer];
    let filepath = DEFAULT_AUDIO_FOLDER_PATH  + file;
    let player = { instance: new mpg.MpgPlayer(), file: filepath, volume: 0 };
    player.instance.on('error', (error) => { console.log(error.message); });
    players.push(player);
  }

  return players;
}


/**
 * Handle the given raddec.
 * @param {AudibleProximity} instance The AudibleProximity instance.
 * @param {Raddec} raddec The raddec to handle.
 */
function handleRaddec(instance, id, rssi) {
  let isKnownAudibleDevice = instance.audibleDevices.has(id);
  let sig = id;
  let targetVolume = 0;

  if (rssi > instance.maxVolumeRSSI) {
    targetVolume = 100;
  }
  else if (rssi > instance.minVolumeRSSI) {
    targetVolume = (rssi - instance.minVolumeRSSI) *
      (100 / (instance.maxVolumeRSSI - instance.minVolumeRSSI));
  }
  
  if (isKnownAudibleDevice) {

    // showing some debug lines, to see the beacon values
    let pre = "           ";
    if (sig == "ac233fa341bc/2") {
      pre = "";
    }
    let audibleDevice = instance.audibleDevices.get(id);
    console.log(sig + " KNOWN V " + audibleDevice.file + " : " + targetVolume + " R " + rssi);

    kfrssi = audibleDevice.kalman.filter(rssi);

    // console.log("sig " + sig +" : "+pre+" " + rssi+ " : " +kfrssi+": " + targetVolume +"\n");

    targetVolume = (audibleDevice.targetVolume + targetVolume) / 2;

    audibleDevice.targetVolume = targetVolume;
    audibleDevice.lastRead = Date.now();
//    audibleDevice.timestamp = raddec.timestamp;
    audibleDevice.kfrssi = kfrssi;
    audibleDevice.rssi = rssi;

    instance.audibleDevices.set(id, audibleDevice);
  }
  else {
    let processedPackets = {};

    let file = id.padStart(7, "0")+".mp3";
    

     filepath = instance.audioFolderPath + file;
  //    console.log("file is " + file);
      let pindex = AUDIO_FILE_LIST.indexOf(file);
//      console.log("index is " + pindex);
      let player = instance.players[pindex];
      console.log(sig + " NEW V " + file + " : " + targetVolume + " R " + rssi + " player " + player);
      let audibleDevice = {
        file: filepath,
        player: player,
        sig: sig,
        targetVolume: targetVolume,
        lastRead : Date.now(),
        isPlaying: false,
        inWaitLoop: false,
        isFading: false,
     //   timestamp: raddec.timestamp,
        kfrssi: rssi,
        rssi: rssi,
        // don: adding a kalmanfilter here to smooth the rssi values
        kalman: new KalmanFilter()
      };

      instance.audibleDevices.set(sig, audibleDevice);
    
  }
}


/**
 * Update the audio playback.
 * @param {AudibleProximity} instance The AudibleProximity instance.
 */
function updateAudioPlayback(instance) {
  if (instance.audibleDevices.size === 0) {
    if (instance.isDebug) {
      console.log('No audible devices in proximity');
    }
    return;
  }
  
  

  /* 
  sort all audibleDevices by volume
  for each one, 
    - update player volume
  - if it's not playing, AND it's not in "loop wait" mode, play it
    - attach a "stop" event that puts it in "loop wait" mode, with a setTimeout(PAUSE_BETWEEN_LOOPS) to take out of loop wait mode
  - it it's not playing and it IS in "loop wait" mode, skip it, but maintain its place in "concurrent players" list
  - if it IS playing, leave it
  */
  let concurrencyCount = 0;
  let unplayedDevices = [];
  let availablePlayers = Array(instance.players.length).fill(true);

  /*
  let closestAudibleDevices = new Map([...instance.audibleDevices.entries()]
    .sort((a, b) => b[1].targetVolume - a[1].targetVolume));
  */
  let closestAudibleDevices = new Map([...instance.audibleDevices.entries()]
    .sort((a, b) => b[1].rssi - a[1].rssi));

  // Second loop: update players already matched with audible devices
  closestAudibleDevices.forEach(function (audibleDevice) {
    // if it hasn't been read in a while, set volume to half each cycle
    if((Date.now() - audibleDevice.lastRead) > instance.beaconStaleTimeoutMS){
      // BEACON_STALE_TIMEOUT_MS
      // beacon signal is too old, it's "done" - set rssi low 
      audibleDevice.rssi = instance.minVolumeRSSI - 10;     
      audibleDevice.targetVolume = audibleDevice.targetVolume / 2;
    }    
    
    // if device volume is really low, just set it to 0
    if(audibleDevice.targetVolume <= 1){
       audibleDevice.targetVolume = 0;
    }
    let player = audibleDevice.player;


    /*
    for each one
    - update player volume
    */
    console.log("volume " + player.file  + "  : " + player.volume + " : " + audibleDevice.rssi);
    player.volume = audibleDevice.targetVolume;
    player.instance.volume(audibleDevice.targetVolume);

    
    // if player volume is super low, then just stop it.
    if(audibleDevice.targetVolume == 0){
      // don't do the loop thing (remove listeners)
      player.instance.removeAllListeners("end");
      audibleDevice.inWaitLoop = false;   
      audibleDevice.isPlaying  = false;      
      player.instance.stop(); 
    }
    
    /*
      - if it's not playing, AND it's not in "loop wait" mode, AND the targetVolume is > 0, play it
      - attach a "stop" event that puts it in "loop wait" mode, with a setTimeout(PAUSE_BETWEEN_LOOPS) to take out of loop wait mode
    */    
    if (!audibleDevice.isPlaying && !audibleDevice.inWaitLoop && audibleDevice.targetVolume > 0) {
      (function (thisAudibleDevice, thisPlayer) {
        thisAudibleDevice.isPlaying = true; // we are currently playing	 
        thisAudibleDevice.isFading  = false; // we are NOT fading     
        thisPlayer.instance.on("end", function () {
          player.instance.removeAllListeners("end");             
          console.log(thisAudibleDevice.file + " ended");
          // when the track ends       
          thisAudibleDevice.inWaitLoop = true; // we're now in "loop wait" mode
          thisAudibleDevice.isFading  = false;
          thisAudibleDevice.isPlaying  = false; // we're not currently playing
          setTimeout(function () {
            thisAudibleDevice.inWaitLoop = false;
          }, PAUSE_BETWEEN_LOOPS);
        });
        console.log("playing " + thisAudibleDevice.file);
        thisPlayer.instance.play(thisAudibleDevice.file);
      })(audibleDevice, player);
    } 

  });
  showDebugScreen(instance.audibleDevices);    
}




function showDebugScreen(audibleDevices){
  
  // clear screen
  // 1. Print empty lines until the screen is blank.
//  process.stdout.write('\033[2J');
  // 2. Clear the scrollback.
  //process.stdout.write('\u001b[H\u001b[2J\u001b[3J');  
  let content = "";
   
  let closestAudibleDevices = new Map([...audibleDevices.entries()]
    .sort((a, b) => b[1].rssi - a[1].rssi));

  // Second loop: update players already matched with audible devices
  let i = 0;
  let extraLines = 0;
  closestAudibleDevices.forEach(function (audibleDevice) {
    i++;
    let player = audibleDevice.player;
    let state = ((audibleDevice.isPlaying ? "P" : "") + (audibleDevice.isFading ? "F" : "")).padStart(1," ");
    let volume = Math.round(player.volume).toString().padStart(3," ");
    let rssi = Math.round(audibleDevice.rssi).toString().padStart(4," ");
    let duration = (Date.now() - audibleDevice.lastRead).toString().padEnd(5, " ");
    let report = audibleDevice.file.replace("data/audio/00000","").replace(/\.mp3/i,"") + ":" + state + ":" + volume + ":" + rssi + ":" + duration;
    console.log(report);    
    if(i <= MAX_MON_LINES){
      content += report;      
    }
    if(i < MAX_MON_LINES){
      content += "\n";
    }
    if(i > MAX_MON_LINES){
      extraLines++;  
    }
  });
  if(extraLines > 0){
    content += "   +"+extraLines;
  }
  
  // write the content to a file
  try {
    fs.writeFileSync(MONITOR_DATA_FILE, content);
    // file written successfully
  } catch (err) {
    console.error(err);
  }   
  
}

/**
 * Print the current status to the console.
 * @param {AudibleProximity} instance The AudibleProximity instance.
 */
function printStatus(instance) {
  console.log('\r\n----- Playing:');
  instance.players.forEach(player => {

    console.log(player.file + ' @ ' + Math.round(player.volume));
  });
  console.log('----- Based on:');
  instance.audibleDevices.forEach(device => {
    console.log(device.file + ' @ ' + Math.round(device.targetVolume));
  });
 
  
}


module.exports = AudibleProximity;
