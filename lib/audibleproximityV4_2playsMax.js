/**
 * Copyright reelyActive 2022
 * We believe in an open Internet of Things
 */


// based on V4, but limited each audio file to TWO plays maximum

const advlib = require('advlib');
const Barnowl = require('barnowl');
const BarnowlHci = require('barnowl-hci');
const mpg = require('mpg123');// https://www.npmjs.com/package/mpg123
const path = require('path');
const { exec } = require('child_process');
const KalmanFilter = require('kalmanjs');
const fs = require('fs');

const DEFAULT_AUDIO_FOLDER_PATH = './data/audio/';
const DEFAULT_MAX_CONCURRENT_PLAYERS = 1;
const MONITOR_DATA_FILE = "/home/pi/datamon.txt";
const MAX_MON_LINES = 4;

const MAX_NUM_PLAYS = 2;

const AUDIO_FILE_LIST = [
    'data/audio/0000000.mp3',
    'data/audio/0000001.mp3',
    'data/audio/0000002.mp3',
    'data/audio/0000003.mp3',
    'data/audio/0000004.mp3',
    'data/audio/0000005.mp3',
    'data/audio/0000006.mp3',
    'data/audio/0000007.mp3',
    'data/audio/0000008.mp3',
    'data/audio/0000009.mp3',
    'data/audio/0000010.mp3',
    'data/audio/0000011.mp3',
    'data/audio/0000012.mp3',
    'data/audio/0000013.mp3',
    'data/audio/0000014.mp3',
    'data/audio/0000015.mp3',
    'data/audio/0000100.mp3',
    'data/audio/0000101.mp3',
    'data/audio/0000102.mp3',
    'data/audio/0000103.mp3',
    'data/audio/0000104.mp3',
    'data/audio/0000105.mp3',
    'data/audio/0000106.mp3',
    'data/audio/0000107.mp3',
    'data/audio/0000108.mp3',
    'data/audio/0000109.mp3',
    'data/audio/0000110.mp3',
    'data/audio/0000111.mp3',
    'data/audio/0000112.mp3',
    'data/audio/0000113.mp3',
    'data/audio/0000114.mp3',
    'data/audio/0000115.mp3'
    
];
const NUM_AUDIO_FILES = 32;

let play_count = {};  // creating an object to hold the total number of plays per file. key is raddec.signature

const MAX_CONCURRENT_PLAYERS = 1;
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

      self.numCurrentPlayers = 0;
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

      self.barnowl = createBarnowl(options);
      self.barnowl.on('raddec', (raddec) => { handleRaddec(self, raddec); });
      self.players = createPlayers(options);
      setInterval(updateAudioPlayback, DEFAULT_AUDIO_UPDATE_MILLISECONDS, self);

    });
  }

}


function waitForHeadphones(options, callback) {
//    callback();
    

  // if there's a headphones_id set, then we need to try to connect to it manually here
  if (process.env.HEADPHONES_ID) {
    console.log("connected to headphones " + process.env.HEADPHONES_ID);
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
 * Create a barnowl instance with a HCI listener.
 * @param {Object} options The configuration options.
 * @return {Barnowl} The Barnowl instance.
 */
function createBarnowl(options) {
  if (!options.hasOwnProperty('barnowl')) {
    options.barnowl = { enableMixing: true };
  }

  let barnowl = new Barnowl(options.barnowl);

  barnowl.addListener(BarnowlHci, {}, BarnowlHci.SocketListener, {});

  return barnowl;
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
    let player = { instance: new mpg.MpgPlayer(), file: file, volume: 0, numplays: 0 }; // adding numplays to track the number of times this file has been played
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
function handleRaddec(instance, raddec) {
  let isKnownAudibleDevice = instance.audibleDevices.has(raddec.signature);
  let rssi = raddec.rssiSignature[0].rssi;
  let sig = raddec.signature;
  let targetVolume = 0;


// if targetValume has any value, it's 100
  if (rssi > instance.minVolumeRSSI) {
      targetVolume = 100;
  }
  
  // if it's already been played MAX_NUM_PLAYS, then skip it entirely
  if(play_count[sig] && play_count[sig] >= MAX_NUM_PLAYS){
    // skip this whole section
    console.log("played too many times, skipping for " + sig);
    return;
  }else{
    console.log("count for " + sig + ": "+play_count[sig]);
  }

  if (isKnownAudibleDevice) {

    // showing some debug lines, to see the beacon values
    let pre = "           ";
    if (sig == "ac233fa341bc/2") {
      pre = "";
    }
    let audibleDevice = instance.audibleDevices.get(raddec.signature);
    console.log(sig + " KNOWN V " + audibleDevice.file + " : " + targetVolume + " R " + rssi);

    kfrssi = audibleDevice.kalman.filter(rssi);

    
    // console.log("sig " + sig +" : "+pre+" " + rssi+ " : " +kfrssi+": " + targetVolume +"\n");

//    targetVolume = (audibleDevice.targetVolume + targetVolume) / 2;

    audibleDevice.targetVolume = targetVolume;
    audibleDevice.lastRead = Date.now();
    audibleDevice.timestamp = raddec.timestamp;
    audibleDevice.kfrssi = kfrssi;
    audibleDevice.rssi = rssi;

    instance.audibleDevices.set(raddec.signature, audibleDevice);
  }
  else {
    let processedPackets = {};

    try {
//      console.log("start process packets");
      processedPackets = advlib.process(raddec.packets,
        instance.packetProcessors,
        instance.packetInterpreters);
 //     console.log("end process packets");
    }
    catch (error) {
      console.log("process packet error " + error);
    }

    let isAudible = (processedPackets.hasOwnProperty('uri') &&
      processedPackets.uri.startsWith('file:/') &&
      processedPackets.uri.endsWith('.mp3'));

    if (isAudible) {

      let file = path.join(instance.audioFolderPath,
        new URL(processedPackets.uri).pathname);
  //    console.log("file is " + file);
      let pindex = AUDIO_FILE_LIST.indexOf(file);
//      console.log("index is " + pindex);
      let player = instance.players[pindex];
      console.log(sig + " NEW V " + file + " : " + targetVolume + " R " + rssi );
      let audibleDevice = {
        file: file,
        player: player,
        sig: sig,
        targetVolume: targetVolume,
        lastRead : Date.now(),
        isPlaying: false,
        inWaitLoop: false,
        isFading: false,
        timestamp: raddec.timestamp,
        kfrssi: rssi,
        rssi: rssi,
        // don: adding a kalmanfilter here to smooth the rssi values
        kalman: new KalmanFilter()
      };

      instance.audibleDevices.set(raddec.signature, audibleDevice);
    }
  }
}


/**
 * Update the audio playback.
 * @param {AudibleProximity} instance The AudibleProximity instance.
 */
function updateAudioPlayback(instance) {

  showDebugScreen(instance.audibleDevices);    
    
  if (instance.audibleDevices.size === 0) {
	  if (instance.isDebug) {
	    console.log('No audible devices in proximity');
	  }
	  return;
  }

  console.log("1. numCurrenbtPlayers " + instance.numCurrentPlayers + " < " + MAX_CONCURRENT_PLAYERS);
    
  // if the max number of concurrent devices are already playing, then skip all this
  if(instance.numCurrentPlayers >= MAX_CONCURRENT_PLAYERS){
  	return;
  }
    
  let concurrencyCount = 0;
  let unplayedDevices = [];
  let availablePlayers = Array(instance.players.length).fill(true);
    
  /*
      let closestAudibleDevices = new Map([...instance.audibleDevices.entries()]
      .sort((a, b) => b[1].targetVolume - a[1].targetVolume));
  */
  let closestAudibleDevices = new Map([...instance.audibleDevices.entries()]
	  .sort((a, b) => b[1].rssi - a[1].rssi));
    
    
  closestAudibleDevices.forEach(function (audibleDevice) {
	
  	console.log("2. numCurrenbtPlayers " + instance.numCurrentPlayers + " < " + MAX_CONCURRENT_PLAYERS);	
  	if(instance.numCurrentPlayers >= MAX_CONCURRENT_PLAYERS){
  	  return;
  	}
  	
  	let player = audibleDevice.player;
  	
  	/*
  	  for each one
  	  - update player volume
  	*/
  	console.log("volume " + player.file  + "  : " + player.volume + " : " + audibleDevice.rssi);
  	player.volume = audibleDevice.targetVolume;
  	player.instance.volume(audibleDevice.targetVolume);
  	
  	/*
  	  - if it's not playing, AND it's not in "loop wait" mode, AND the targetVolume is > 0, play it
  	  - attach a "stop" event that puts it in "loop wait" mode, with a setTimeout(PAUSE_BETWEEN_LOOPS) to take out of loop wait mode
      */    
  	if (instance.numCurrentPlayers < MAX_CONCURRENT_PLAYERS && !audibleDevice.isPlaying && !audibleDevice.inWaitLoop && audibleDevice.targetVolume > 0) {
      instance.numCurrentPlayers++;
      console.log("3. numCurrenbtPlayers " + instance.numCurrentPlayers + " < " + MAX_CONCURRENT_PLAYERS);	
      (function (thisAudibleDevice, thisPlayer) {
        thisAudibleDevice.isPlaying = true; // we are currently playing	 
        thisAudibleDevice.isFading  = false; // we are NOT fading     
        thisPlayer.instance.on("end", function () {
          instance.numCurrentPlayers--;
          console.log("4. numCurrenbtPlayers " + instance.numCurrentPlayers + " < " + MAX_CONCURRENT_PLAYERS);
		
          player.numplays++; // ad to the count of plays of this track
          play_count[thisAudibleDevice.sig] = player.numplays; // set it to 0 if it's not set, add one otherwise.
          if(player.numplays >= MAX_NUM_PLAYS){ // if it's >= MAX_NUM_PLAYS, remove it from AudibleDevices
	    console.log("removing " +thisAudibleDevice.sig);
            instance.audibleDevices.delete(thisAudibleDevice.sig);
          }
          
          player.instance.removeAllListeners("end");             
          console.log(thisAudibleDevice.file + " ended *************************************************************" + player.numplays);
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
    
}




function showDebugScreen(audibleDevices){
  
  // clear screen
  // 1. Print empty lines until the screen is blank.
//  process.stdout.write('\033[2J');
  // 2. Clear the scrollback.
//  process.stdout.write('\u001b[H\u001b[2J\u001b[3J');  
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
    let report = audibleDevice.file.replace("data/audio/0000","").replace(/\.mp3/i,"") + ":" + state + ":" + volume + ":" + rssi + ":" + duration;
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