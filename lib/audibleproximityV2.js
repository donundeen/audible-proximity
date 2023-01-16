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

const DEFAULT_AUDIO_FOLDER_PATH = './data/audio/';
const DEFAULT_MAX_CONCURRENT_PLAYERS = 1;

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
  'data/audio/0000016.mp3',
  'data/audio/0000017.mp3',
  'data/audio/0000018.mp3',
  'data/audio/0000019.mp3',
  'data/audio/0000020.mp3'
];
const NUM_AUDIO_FILES = 21;

const PAUSE_BETWEEN_LOOPS = 15000; // pause, in milliseconds, between loops of the same track
const DEFAULT_MAX_VOLUME_RSSI = -60;
const DEFAULT_MIN_VOLUME_RSSI = -80;
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
      self.isDebug = options.isDebug || false;

      self.barnowl = createBarnowl(options);
      self.barnowl.on('raddec', (raddec) => { handleRaddec(self, raddec); });
      self.players = createPlayers(options);
      setInterval(updateAudioPlayback, DEFAULT_AUDIO_UPDATE_MILLISECONDS, self);

    });
  }

}


function waitForHeadphones(options, callback) {


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
    let player = { instance: new mpg.MpgPlayer(), file: file, volume: 0 };
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
    let audibleDevice = instance.audibleDevices.get(raddec.signature);

    kfrssi = audibleDevice.kalman.filter(rssi);

    // recalculating taret volume, now that we have a known audible devie with a karman filtered rssi
    if (kfrssi > instance.maxVolumeRSSI) {
      targetVolume = 100;
    }
    else if (kfrssi > instance.minVolumeRSSI) {
      targetVolume = (kfrssi - instance.minVolumeRSSI) *
        (100 / (instance.maxVolumeRSSI - instance.minVolumeRSSI));
    }

    // console.log("sig " + sig +" : "+pre+" " + rssi+ " : " +kfrssi+": " + targetVolume +"\n");

    let newTargetVolume = (audibleDevice.targetVolume + targetVolume) / 2;

    audibleDevice.targetVolume = newTargetVolume;
    audibleDevice.timestamp = raddec.timestamp;
    audibleDevice.kfrssi = kfrssi;

    instance.audibleDevices.set(raddec.signature, audibleDevice);
  }
  else {
    let processedPackets = {};

    try {
      processedPackets = advlib.process(raddec.packets,
        instance.packetProcessors,
        instance.packetInterpreters);
    }
    catch (error) { }

    let isAudible = (processedPackets.hasOwnProperty('uri') &&
      processedPackets.uri.startsWith('file:/') &&
      processedPackets.uri.endsWith('.mp3'));

    if (isAudible) {
      let file = path.join(instance.audioFolderPath,
        new URL(processedPackets.uri).pathname);
      console.log("file is " + file);
      let pindex = AUDIO_FILE_LIST.indexOf(file);
      console.log("index is " + pindex);
      let player = instance.players[pindex];
      let audibleDevice = {
        file: file,
        player: player,
        targetVolume: targetVolume,
        isPlaying: false,
        inWaitLoop: false,
        timestamp: raddec.timestamp,
        kfrssi: -1,
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
  if (instance.audibleDevices.size === 0) {
    if (instance.isDebug) {
      console.log('No audible devices in proximity');
    }
    return;
  }

  /* 
  sort all audibleDevices by volume
  for each one, up to max concurrent devices
    - update player volume
  - if it's not playing, AND it's not in "loop wait" mode, play it
    - attach a "stop" event that puts it in "loop wait" mode, with a setTimeout(PAUSE_BETWEEN_LOOPS) to take out of loop wait mode
  - it it's not playing and it IS in "loop wait" mode, skip it, but maintain its place in "concurrent players" list
  - if it IS playing, leave it
  for each one PAST max concurrent devices:
    - if it's playing, reduce volume until the volume is 0
  - if it's playing and volume is 0, stop playing
  - if it's not playing, leave it
  */
  let concurrencyCount = 0;
  let unplayedDevices = [];
  let availablePlayers = Array(instance.players.length).fill(true);
  let closestAudibleDevices = new Map([...instance.audibleDevices.entries()]
    .sort((a, b) => b[1].targetVolume - a[1].targetVolume));

  // Second loop: update players already matched with audible devices
  closestAudibleDevices.forEach(function (audibleDevice) {
    let player = audibleDevice.player;
    if (concurrencyCount++ < DEFAULT_MAX_CONCURRENT_PLAYERS) {
      console.log(concurrencyCount + " out of " + DEFAULT_MAX_CONCURRENT_PLAYERS);
      /*
      for each one, up to max concurrent devices
    - update player volume
  */
      console.log("active " + player.file + " : " + audibleDevice.kfrssi + " : " + player.volume);
      player.volume = audibleDevice.targetVolume;
      player.instance.volume(audibleDevice.targetVolume);

      /*
        - if it's not playing, AND it's not in "loop wait" mode, play it
        - attach a "stop" event that puts it in "loop wait" mode, with a setTimeout(PAUSE_BETWEEN_LOOPS) to take out of loop wait mode
      */
      if (!audibleDevice.isPlaying && !audibleDevice.inWaitLoop) {
        (function (thisAudibleDevice, thisPlayer) {
          thisAudibleDevice.isPlaying = true; // we are currently playing	      
          thisPlayer.instance.on("end", function () {
            // when the track ends
            thisAudibleDevice.inWaitLoop = true; // we're now in "loop wait" mode
            thisAudibleDevice.isPlaying = false; // we're not currently playing
            setTimeout(function () {
              thisAudibleDevice.inWaitLoop = false;
            }, PAUSE_BETWEEN_LOOPS);
          });
          thisPlayer.instance.play(thisAudibleDevice.file);
        })(audibleDevice, player);
      }
      /*
      - it it's not playing and it IS in "loop wait" mode, skip it, but maintain its place in "concurrent players" list
      - if it IS playing, leave it
      */


    } else {
      /*
        for each one PAST max concurrent devices:
    - if it's playing, reduce volume until the volume is 0
  - if it's playing and volume is 0, stop playing
  - if it's not playing, leave it
  */
      audibleDevice.targetVolume *= STALE_VOLUME_RATIO;
      // First loop: progressively reduce the volume of devices no longer detected
      if (audibleDevice.targetVolume < 1) {
        audibleDevice.targetVolume = 0;
      }
      else {
        audibleDevice.targetVolume *= STALE_VOLUME_RATIO;
      }
      player.volume = audibleDevice.targetVolume;
      player.instance.volume(audibleDevice.targetVolume);
      console.log("INactive " + player.file + " : " + audibleDevice.kfrssi + " : " + player.volume);
      if (audibleDevice.isPlaying == true && player.volume == 0) {
        console.log("stopping");
        player.instance.stop();
        audibleDevice.isPlaying = false;
      }
    }
  });
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
