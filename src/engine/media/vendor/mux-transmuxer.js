// Generated from mux.js 6.3.0 (Apache-2.0). See scripts/vendor-media.mjs and mux-LICENSE.txt.
// Flux changes: reject malformed AAC sizes/rates, bound audio frame and video NAL counts.
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/mux.js/cjs/utils/stream.js
var require_stream = __commonJS({
  "node_modules/mux.js/cjs/utils/stream.js"(exports, module) {
    "use strict";
    var Stream = function Stream2() {
      this.init = function() {
        var listeners = {};
        this.on = function(type, listener) {
          if (!listeners[type]) {
            listeners[type] = [];
          }
          listeners[type] = listeners[type].concat(listener);
        };
        this.off = function(type, listener) {
          var index;
          if (!listeners[type]) {
            return false;
          }
          index = listeners[type].indexOf(listener);
          listeners[type] = listeners[type].slice();
          listeners[type].splice(index, 1);
          return index > -1;
        };
        this.trigger = function(type) {
          var callbacks, i, length, args;
          callbacks = listeners[type];
          if (!callbacks) {
            return;
          }
          if (arguments.length === 2) {
            length = callbacks.length;
            for (i = 0; i < length; ++i) {
              callbacks[i].call(this, arguments[1]);
            }
          } else {
            args = [];
            i = arguments.length;
            for (i = 1; i < arguments.length; ++i) {
              args.push(arguments[i]);
            }
            length = callbacks.length;
            for (i = 0; i < length; ++i) {
              callbacks[i].apply(this, args);
            }
          }
        };
        this.dispose = function() {
          listeners = {};
        };
      };
    };
    Stream.prototype.pipe = function(destination) {
      this.on("data", function(data) {
        destination.push(data);
      });
      this.on("done", function(flushSource) {
        destination.flush(flushSource);
      });
      this.on("partialdone", function(flushSource) {
        destination.partialFlush(flushSource);
      });
      this.on("endedtimeline", function(flushSource) {
        destination.endTimeline(flushSource);
      });
      this.on("reset", function(flushSource) {
        destination.reset(flushSource);
      });
      return destination;
    };
    Stream.prototype.push = function(data) {
      this.trigger("data", data);
    };
    Stream.prototype.flush = function(flushSource) {
      this.trigger("done", flushSource);
    };
    Stream.prototype.partialFlush = function(flushSource) {
      this.trigger("partialdone", flushSource);
    };
    Stream.prototype.endTimeline = function(flushSource) {
      this.trigger("endedtimeline", flushSource);
    };
    Stream.prototype.reset = function(flushSource) {
      this.trigger("reset", flushSource);
    };
    module.exports = Stream;
  }
});

// node_modules/mux.js/cjs/utils/numbers.js
var require_numbers = __commonJS({
  "node_modules/mux.js/cjs/utils/numbers.js"(exports, module) {
    "use strict";
    var MAX_UINT32 = Math.pow(2, 32);
    var getUint64 = function getUint642(uint8) {
      var dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
      var value;
      if (dv.getBigUint64) {
        value = dv.getBigUint64(0);
        if (value < Number.MAX_SAFE_INTEGER) {
          return Number(value);
        }
        return value;
      }
      return dv.getUint32(0) * MAX_UINT32 + dv.getUint32(4);
    };
    module.exports = {
      getUint64,
      MAX_UINT32
    };
  }
});

// node_modules/mux.js/cjs/mp4/mp4-generator.js
var require_mp4_generator = __commonJS({
  "node_modules/mux.js/cjs/mp4/mp4-generator.js"(exports, module) {
    "use strict";
    var MAX_UINT32 = require_numbers().MAX_UINT32;
    var box;
    var dinf;
    var esds;
    var ftyp;
    var mdat;
    var mfhd;
    var minf;
    var moof;
    var moov;
    var mvex;
    var mvhd;
    var trak;
    var tkhd;
    var mdia;
    var mdhd;
    var hdlr;
    var sdtp;
    var stbl;
    var stsd;
    var traf;
    var trex;
    var trun;
    var types;
    var MAJOR_BRAND;
    var MINOR_VERSION;
    var AVC1_BRAND;
    var VIDEO_HDLR;
    var AUDIO_HDLR;
    var HDLR_TYPES;
    var VMHD;
    var SMHD;
    var DREF;
    var STCO;
    var STSC;
    var STSZ;
    var STTS;
    (function() {
      var i;
      types = {
        avc1: [],
        // codingname
        avcC: [],
        btrt: [],
        dinf: [],
        dref: [],
        esds: [],
        ftyp: [],
        hdlr: [],
        mdat: [],
        mdhd: [],
        mdia: [],
        mfhd: [],
        minf: [],
        moof: [],
        moov: [],
        mp4a: [],
        // codingname
        mvex: [],
        mvhd: [],
        pasp: [],
        sdtp: [],
        smhd: [],
        stbl: [],
        stco: [],
        stsc: [],
        stsd: [],
        stsz: [],
        stts: [],
        styp: [],
        tfdt: [],
        tfhd: [],
        traf: [],
        trak: [],
        trun: [],
        trex: [],
        tkhd: [],
        vmhd: []
      };
      if (typeof Uint8Array === "undefined") {
        return;
      }
      for (i in types) {
        if (types.hasOwnProperty(i)) {
          types[i] = [i.charCodeAt(0), i.charCodeAt(1), i.charCodeAt(2), i.charCodeAt(3)];
        }
      }
      MAJOR_BRAND = new Uint8Array(["i".charCodeAt(0), "s".charCodeAt(0), "o".charCodeAt(0), "m".charCodeAt(0)]);
      AVC1_BRAND = new Uint8Array(["a".charCodeAt(0), "v".charCodeAt(0), "c".charCodeAt(0), "1".charCodeAt(0)]);
      MINOR_VERSION = new Uint8Array([0, 0, 0, 1]);
      VIDEO_HDLR = new Uint8Array([
        0,
        // version 0
        0,
        0,
        0,
        // flags
        0,
        0,
        0,
        0,
        // pre_defined
        118,
        105,
        100,
        101,
        // handler_type: 'vide'
        0,
        0,
        0,
        0,
        // reserved
        0,
        0,
        0,
        0,
        // reserved
        0,
        0,
        0,
        0,
        // reserved
        86,
        105,
        100,
        101,
        111,
        72,
        97,
        110,
        100,
        108,
        101,
        114,
        0
        // name: 'VideoHandler'
      ]);
      AUDIO_HDLR = new Uint8Array([
        0,
        // version 0
        0,
        0,
        0,
        // flags
        0,
        0,
        0,
        0,
        // pre_defined
        115,
        111,
        117,
        110,
        // handler_type: 'soun'
        0,
        0,
        0,
        0,
        // reserved
        0,
        0,
        0,
        0,
        // reserved
        0,
        0,
        0,
        0,
        // reserved
        83,
        111,
        117,
        110,
        100,
        72,
        97,
        110,
        100,
        108,
        101,
        114,
        0
        // name: 'SoundHandler'
      ]);
      HDLR_TYPES = {
        video: VIDEO_HDLR,
        audio: AUDIO_HDLR
      };
      DREF = new Uint8Array([
        0,
        // version 0
        0,
        0,
        0,
        // flags
        0,
        0,
        0,
        1,
        // entry_count
        0,
        0,
        0,
        12,
        // entry_size
        117,
        114,
        108,
        32,
        // 'url' type
        0,
        // version 0
        0,
        0,
        1
        // entry_flags
      ]);
      SMHD = new Uint8Array([
        0,
        // version
        0,
        0,
        0,
        // flags
        0,
        0,
        // balance, 0 means centered
        0,
        0
        // reserved
      ]);
      STCO = new Uint8Array([
        0,
        // version
        0,
        0,
        0,
        // flags
        0,
        0,
        0,
        0
        // entry_count
      ]);
      STSC = STCO;
      STSZ = new Uint8Array([
        0,
        // version
        0,
        0,
        0,
        // flags
        0,
        0,
        0,
        0,
        // sample_size
        0,
        0,
        0,
        0
        // sample_count
      ]);
      STTS = STCO;
      VMHD = new Uint8Array([
        0,
        // version
        0,
        0,
        1,
        // flags
        0,
        0,
        // graphicsmode
        0,
        0,
        0,
        0,
        0,
        0
        // opcolor
      ]);
    })();
    box = function box2(type) {
      var payload = [], size = 0, i, result, view;
      for (i = 1; i < arguments.length; i++) {
        payload.push(arguments[i]);
      }
      i = payload.length;
      while (i--) {
        size += payload[i].byteLength;
      }
      result = new Uint8Array(size + 8);
      view = new DataView(result.buffer, result.byteOffset, result.byteLength);
      view.setUint32(0, result.byteLength);
      result.set(type, 4);
      for (i = 0, size = 8; i < payload.length; i++) {
        result.set(payload[i], size);
        size += payload[i].byteLength;
      }
      return result;
    };
    dinf = function dinf2() {
      return box(types.dinf, box(types.dref, DREF));
    };
    esds = function esds2(track) {
      return box(types.esds, new Uint8Array([
        0,
        // version
        0,
        0,
        0,
        // flags
        // ES_Descriptor
        3,
        // tag, ES_DescrTag
        25,
        // length
        0,
        0,
        // ES_ID
        0,
        // streamDependenceFlag, URL_flag, reserved, streamPriority
        // DecoderConfigDescriptor
        4,
        // tag, DecoderConfigDescrTag
        17,
        // length
        64,
        // object type
        21,
        // streamType
        0,
        6,
        0,
        // bufferSizeDB
        0,
        0,
        218,
        192,
        // maxBitrate
        0,
        0,
        218,
        192,
        // avgBitrate
        // DecoderSpecificInfo
        5,
        // tag, DecoderSpecificInfoTag
        2,
        // length
        // ISO/IEC 14496-3, AudioSpecificConfig
        // for samplingFrequencyIndex see ISO/IEC 13818-7:2006, 8.1.3.2.2, Table 35
        track.audioobjecttype << 3 | track.samplingfrequencyindex >>> 1,
        track.samplingfrequencyindex << 7 | track.channelcount << 3,
        6,
        1,
        2
        // GASpecificConfig
      ]));
    };
    ftyp = function ftyp2() {
      return box(types.ftyp, MAJOR_BRAND, MINOR_VERSION, MAJOR_BRAND, AVC1_BRAND);
    };
    hdlr = function hdlr2(type) {
      return box(types.hdlr, HDLR_TYPES[type]);
    };
    mdat = function mdat2(data) {
      return box(types.mdat, data);
    };
    mdhd = function mdhd2(track) {
      var result = new Uint8Array([
        0,
        // version 0
        0,
        0,
        0,
        // flags
        0,
        0,
        0,
        2,
        // creation_time
        0,
        0,
        0,
        3,
        // modification_time
        0,
        1,
        95,
        144,
        // timescale, 90,000 "ticks" per second
        track.duration >>> 24 & 255,
        track.duration >>> 16 & 255,
        track.duration >>> 8 & 255,
        track.duration & 255,
        // duration
        85,
        196,
        // 'und' language (undetermined)
        0,
        0
      ]);
      if (track.samplerate) {
        result[12] = track.samplerate >>> 24 & 255;
        result[13] = track.samplerate >>> 16 & 255;
        result[14] = track.samplerate >>> 8 & 255;
        result[15] = track.samplerate & 255;
      }
      return box(types.mdhd, result);
    };
    mdia = function mdia2(track) {
      return box(types.mdia, mdhd(track), hdlr(track.type), minf(track));
    };
    mfhd = function mfhd2(sequenceNumber) {
      return box(types.mfhd, new Uint8Array([
        0,
        0,
        0,
        0,
        // flags
        (sequenceNumber & 4278190080) >> 24,
        (sequenceNumber & 16711680) >> 16,
        (sequenceNumber & 65280) >> 8,
        sequenceNumber & 255
        // sequence_number
      ]));
    };
    minf = function minf2(track) {
      return box(types.minf, track.type === "video" ? box(types.vmhd, VMHD) : box(types.smhd, SMHD), dinf(), stbl(track));
    };
    moof = function moof2(sequenceNumber, tracks) {
      var trackFragments = [], i = tracks.length;
      while (i--) {
        trackFragments[i] = traf(tracks[i]);
      }
      return box.apply(null, [types.moof, mfhd(sequenceNumber)].concat(trackFragments));
    };
    moov = function moov2(tracks) {
      var i = tracks.length, boxes = [];
      while (i--) {
        boxes[i] = trak(tracks[i]);
      }
      return box.apply(null, [types.moov, mvhd(4294967295)].concat(boxes).concat(mvex(tracks)));
    };
    mvex = function mvex2(tracks) {
      var i = tracks.length, boxes = [];
      while (i--) {
        boxes[i] = trex(tracks[i]);
      }
      return box.apply(null, [types.mvex].concat(boxes));
    };
    mvhd = function mvhd2(duration) {
      var bytes = new Uint8Array([
        0,
        // version 0
        0,
        0,
        0,
        // flags
        0,
        0,
        0,
        1,
        // creation_time
        0,
        0,
        0,
        2,
        // modification_time
        0,
        1,
        95,
        144,
        // timescale, 90,000 "ticks" per second
        (duration & 4278190080) >> 24,
        (duration & 16711680) >> 16,
        (duration & 65280) >> 8,
        duration & 255,
        // duration
        0,
        1,
        0,
        0,
        // 1.0 rate
        1,
        0,
        // 1.0 volume
        0,
        0,
        // reserved
        0,
        0,
        0,
        0,
        // reserved
        0,
        0,
        0,
        0,
        // reserved
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        64,
        0,
        0,
        0,
        // transformation: unity matrix
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        // pre_defined
        255,
        255,
        255,
        255
        // next_track_ID
      ]);
      return box(types.mvhd, bytes);
    };
    sdtp = function sdtp2(track) {
      var samples = track.samples || [], bytes = new Uint8Array(4 + samples.length), flags, i;
      for (i = 0; i < samples.length; i++) {
        flags = samples[i].flags;
        bytes[i + 4] = flags.dependsOn << 4 | flags.isDependedOn << 2 | flags.hasRedundancy;
      }
      return box(types.sdtp, bytes);
    };
    stbl = function stbl2(track) {
      return box(types.stbl, stsd(track), box(types.stts, STTS), box(types.stsc, STSC), box(types.stsz, STSZ), box(types.stco, STCO));
    };
    (function() {
      var videoSample, audioSample;
      stsd = function stsd2(track) {
        return box(types.stsd, new Uint8Array([
          0,
          // version 0
          0,
          0,
          0,
          // flags
          0,
          0,
          0,
          1
        ]), track.type === "video" ? videoSample(track) : audioSample(track));
      };
      videoSample = function videoSample2(track) {
        var sps = track.sps || [], pps = track.pps || [], sequenceParameterSets = [], pictureParameterSets = [], i, avc1Box;
        for (i = 0; i < sps.length; i++) {
          sequenceParameterSets.push((sps[i].byteLength & 65280) >>> 8);
          sequenceParameterSets.push(sps[i].byteLength & 255);
          sequenceParameterSets = sequenceParameterSets.concat(Array.prototype.slice.call(sps[i]));
        }
        for (i = 0; i < pps.length; i++) {
          pictureParameterSets.push((pps[i].byteLength & 65280) >>> 8);
          pictureParameterSets.push(pps[i].byteLength & 255);
          pictureParameterSets = pictureParameterSets.concat(Array.prototype.slice.call(pps[i]));
        }
        avc1Box = [types.avc1, new Uint8Array([
          0,
          0,
          0,
          0,
          0,
          0,
          // reserved
          0,
          1,
          // data_reference_index
          0,
          0,
          // pre_defined
          0,
          0,
          // reserved
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          // pre_defined
          (track.width & 65280) >> 8,
          track.width & 255,
          // width
          (track.height & 65280) >> 8,
          track.height & 255,
          // height
          0,
          72,
          0,
          0,
          // horizresolution
          0,
          72,
          0,
          0,
          // vertresolution
          0,
          0,
          0,
          0,
          // reserved
          0,
          1,
          // frame_count
          19,
          118,
          105,
          100,
          101,
          111,
          106,
          115,
          45,
          99,
          111,
          110,
          116,
          114,
          105,
          98,
          45,
          104,
          108,
          115,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          // compressorname
          0,
          24,
          // depth = 24
          17,
          17
          // pre_defined = -1
        ]), box(types.avcC, new Uint8Array([
          1,
          // configurationVersion
          track.profileIdc,
          // AVCProfileIndication
          track.profileCompatibility,
          // profile_compatibility
          track.levelIdc,
          // AVCLevelIndication
          255
          // lengthSizeMinusOne, hard-coded to 4 bytes
        ].concat(
          [sps.length],
          // numOfSequenceParameterSets
          sequenceParameterSets,
          // "SPS"
          [pps.length],
          // numOfPictureParameterSets
          pictureParameterSets
          // "PPS"
        ))), box(types.btrt, new Uint8Array([
          0,
          28,
          156,
          128,
          // bufferSizeDB
          0,
          45,
          198,
          192,
          // maxBitrate
          0,
          45,
          198,
          192
          // avgBitrate
        ]))];
        if (track.sarRatio) {
          var hSpacing = track.sarRatio[0], vSpacing = track.sarRatio[1];
          avc1Box.push(box(types.pasp, new Uint8Array([(hSpacing & 4278190080) >> 24, (hSpacing & 16711680) >> 16, (hSpacing & 65280) >> 8, hSpacing & 255, (vSpacing & 4278190080) >> 24, (vSpacing & 16711680) >> 16, (vSpacing & 65280) >> 8, vSpacing & 255])));
        }
        return box.apply(null, avc1Box);
      };
      audioSample = function audioSample2(track) {
        return box(types.mp4a, new Uint8Array([
          // SampleEntry, ISO/IEC 14496-12
          0,
          0,
          0,
          0,
          0,
          0,
          // reserved
          0,
          1,
          // data_reference_index
          // AudioSampleEntry, ISO/IEC 14496-12
          0,
          0,
          0,
          0,
          // reserved
          0,
          0,
          0,
          0,
          // reserved
          (track.channelcount & 65280) >> 8,
          track.channelcount & 255,
          // channelcount
          (track.samplesize & 65280) >> 8,
          track.samplesize & 255,
          // samplesize
          0,
          0,
          // pre_defined
          0,
          0,
          // reserved
          (track.samplerate & 65280) >> 8,
          track.samplerate & 255,
          0,
          0
          // samplerate, 16.16
          // MP4AudioSampleEntry, ISO/IEC 14496-14
        ]), esds(track));
      };
    })();
    tkhd = function tkhd2(track) {
      var result = new Uint8Array([
        0,
        // version 0
        0,
        0,
        7,
        // flags
        0,
        0,
        0,
        0,
        // creation_time
        0,
        0,
        0,
        0,
        // modification_time
        (track.id & 4278190080) >> 24,
        (track.id & 16711680) >> 16,
        (track.id & 65280) >> 8,
        track.id & 255,
        // track_ID
        0,
        0,
        0,
        0,
        // reserved
        (track.duration & 4278190080) >> 24,
        (track.duration & 16711680) >> 16,
        (track.duration & 65280) >> 8,
        track.duration & 255,
        // duration
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        // reserved
        0,
        0,
        // layer
        0,
        0,
        // alternate_group
        1,
        0,
        // non-audio track volume
        0,
        0,
        // reserved
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        64,
        0,
        0,
        0,
        // transformation: unity matrix
        (track.width & 65280) >> 8,
        track.width & 255,
        0,
        0,
        // width
        (track.height & 65280) >> 8,
        track.height & 255,
        0,
        0
        // height
      ]);
      return box(types.tkhd, result);
    };
    traf = function traf2(track) {
      var trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun, sampleDependencyTable, dataOffset, upperWordBaseMediaDecodeTime, lowerWordBaseMediaDecodeTime;
      trackFragmentHeader = box(types.tfhd, new Uint8Array([
        0,
        // version 0
        0,
        0,
        58,
        // flags
        (track.id & 4278190080) >> 24,
        (track.id & 16711680) >> 16,
        (track.id & 65280) >> 8,
        track.id & 255,
        // track_ID
        0,
        0,
        0,
        1,
        // sample_description_index
        0,
        0,
        0,
        0,
        // default_sample_duration
        0,
        0,
        0,
        0,
        // default_sample_size
        0,
        0,
        0,
        0
        // default_sample_flags
      ]));
      upperWordBaseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime / MAX_UINT32);
      lowerWordBaseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime % MAX_UINT32);
      trackFragmentDecodeTime = box(types.tfdt, new Uint8Array([
        1,
        // version 1
        0,
        0,
        0,
        // flags
        // baseMediaDecodeTime
        upperWordBaseMediaDecodeTime >>> 24 & 255,
        upperWordBaseMediaDecodeTime >>> 16 & 255,
        upperWordBaseMediaDecodeTime >>> 8 & 255,
        upperWordBaseMediaDecodeTime & 255,
        lowerWordBaseMediaDecodeTime >>> 24 & 255,
        lowerWordBaseMediaDecodeTime >>> 16 & 255,
        lowerWordBaseMediaDecodeTime >>> 8 & 255,
        lowerWordBaseMediaDecodeTime & 255
      ]));
      dataOffset = 32 + // tfhd
      20 + // tfdt
      8 + // traf header
      16 + // mfhd
      8 + // moof header
      8;
      if (track.type === "audio") {
        trackFragmentRun = trun(track, dataOffset);
        return box(types.traf, trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun);
      }
      sampleDependencyTable = sdtp(track);
      trackFragmentRun = trun(track, sampleDependencyTable.length + dataOffset);
      return box(types.traf, trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun, sampleDependencyTable);
    };
    trak = function trak2(track) {
      track.duration = track.duration || 4294967295;
      return box(types.trak, tkhd(track), mdia(track));
    };
    trex = function trex2(track) {
      var result = new Uint8Array([
        0,
        // version 0
        0,
        0,
        0,
        // flags
        (track.id & 4278190080) >> 24,
        (track.id & 16711680) >> 16,
        (track.id & 65280) >> 8,
        track.id & 255,
        // track_ID
        0,
        0,
        0,
        1,
        // default_sample_description_index
        0,
        0,
        0,
        0,
        // default_sample_duration
        0,
        0,
        0,
        0,
        // default_sample_size
        0,
        1,
        0,
        1
        // default_sample_flags
      ]);
      if (track.type !== "video") {
        result[result.length - 1] = 0;
      }
      return box(types.trex, result);
    };
    (function() {
      var audioTrun, videoTrun, trunHeader;
      trunHeader = function trunHeader2(samples, offset) {
        var durationPresent = 0, sizePresent = 0, flagsPresent = 0, compositionTimeOffset = 0;
        if (samples.length) {
          if (samples[0].duration !== void 0) {
            durationPresent = 1;
          }
          if (samples[0].size !== void 0) {
            sizePresent = 2;
          }
          if (samples[0].flags !== void 0) {
            flagsPresent = 4;
          }
          if (samples[0].compositionTimeOffset !== void 0) {
            compositionTimeOffset = 8;
          }
        }
        return [
          0,
          // version 0
          0,
          durationPresent | sizePresent | flagsPresent | compositionTimeOffset,
          1,
          // flags
          (samples.length & 4278190080) >>> 24,
          (samples.length & 16711680) >>> 16,
          (samples.length & 65280) >>> 8,
          samples.length & 255,
          // sample_count
          (offset & 4278190080) >>> 24,
          (offset & 16711680) >>> 16,
          (offset & 65280) >>> 8,
          offset & 255
          // data_offset
        ];
      };
      videoTrun = function videoTrun2(track, offset) {
        var bytesOffest, bytes, header, samples, sample, i;
        samples = track.samples || [];
        offset += 8 + 12 + 16 * samples.length;
        header = trunHeader(samples, offset);
        bytes = new Uint8Array(header.length + samples.length * 16);
        bytes.set(header);
        bytesOffest = header.length;
        for (i = 0; i < samples.length; i++) {
          sample = samples[i];
          bytes[bytesOffest++] = (sample.duration & 4278190080) >>> 24;
          bytes[bytesOffest++] = (sample.duration & 16711680) >>> 16;
          bytes[bytesOffest++] = (sample.duration & 65280) >>> 8;
          bytes[bytesOffest++] = sample.duration & 255;
          bytes[bytesOffest++] = (sample.size & 4278190080) >>> 24;
          bytes[bytesOffest++] = (sample.size & 16711680) >>> 16;
          bytes[bytesOffest++] = (sample.size & 65280) >>> 8;
          bytes[bytesOffest++] = sample.size & 255;
          bytes[bytesOffest++] = sample.flags.isLeading << 2 | sample.flags.dependsOn;
          bytes[bytesOffest++] = sample.flags.isDependedOn << 6 | sample.flags.hasRedundancy << 4 | sample.flags.paddingValue << 1 | sample.flags.isNonSyncSample;
          bytes[bytesOffest++] = sample.flags.degradationPriority & 240 << 8;
          bytes[bytesOffest++] = sample.flags.degradationPriority & 15;
          bytes[bytesOffest++] = (sample.compositionTimeOffset & 4278190080) >>> 24;
          bytes[bytesOffest++] = (sample.compositionTimeOffset & 16711680) >>> 16;
          bytes[bytesOffest++] = (sample.compositionTimeOffset & 65280) >>> 8;
          bytes[bytesOffest++] = sample.compositionTimeOffset & 255;
        }
        return box(types.trun, bytes);
      };
      audioTrun = function audioTrun2(track, offset) {
        var bytes, bytesOffest, header, samples, sample, i;
        samples = track.samples || [];
        offset += 8 + 12 + 8 * samples.length;
        header = trunHeader(samples, offset);
        bytes = new Uint8Array(header.length + samples.length * 8);
        bytes.set(header);
        bytesOffest = header.length;
        for (i = 0; i < samples.length; i++) {
          sample = samples[i];
          bytes[bytesOffest++] = (sample.duration & 4278190080) >>> 24;
          bytes[bytesOffest++] = (sample.duration & 16711680) >>> 16;
          bytes[bytesOffest++] = (sample.duration & 65280) >>> 8;
          bytes[bytesOffest++] = sample.duration & 255;
          bytes[bytesOffest++] = (sample.size & 4278190080) >>> 24;
          bytes[bytesOffest++] = (sample.size & 16711680) >>> 16;
          bytes[bytesOffest++] = (sample.size & 65280) >>> 8;
          bytes[bytesOffest++] = sample.size & 255;
        }
        return box(types.trun, bytes);
      };
      trun = function trun2(track, offset) {
        if (track.type === "audio") {
          return audioTrun(track, offset);
        }
        return videoTrun(track, offset);
      };
    })();
    module.exports = {
      ftyp,
      mdat,
      moof,
      moov,
      initSegment: function initSegment(tracks) {
        var fileType = ftyp(), movie = moov(tracks), result;
        result = new Uint8Array(fileType.byteLength + movie.byteLength);
        result.set(fileType);
        result.set(movie, fileType.byteLength);
        return result;
      }
    };
  }
});

// node_modules/mux.js/cjs/mp4/frame-utils.js
var require_frame_utils = __commonJS({
  "node_modules/mux.js/cjs/mp4/frame-utils.js"(exports, module) {
    "use strict";
    var groupNalsIntoFrames = function groupNalsIntoFrames2(nalUnits) {
      var i, currentNal, currentFrame = [], frames = [];
      frames.byteLength = 0;
      frames.nalCount = 0;
      frames.duration = 0;
      currentFrame.byteLength = 0;
      for (i = 0; i < nalUnits.length; i++) {
        currentNal = nalUnits[i];
        if (currentNal.nalUnitType === "access_unit_delimiter_rbsp") {
          if (currentFrame.length) {
            currentFrame.duration = currentNal.dts - currentFrame.dts;
            frames.byteLength += currentFrame.byteLength;
            frames.nalCount += currentFrame.length;
            frames.duration += currentFrame.duration;
            frames.push(currentFrame);
          }
          currentFrame = [currentNal];
          currentFrame.byteLength = currentNal.data.byteLength;
          currentFrame.pts = currentNal.pts;
          currentFrame.dts = currentNal.dts;
        } else {
          if (currentNal.nalUnitType === "slice_layer_without_partitioning_rbsp_idr") {
            currentFrame.keyFrame = true;
          }
          currentFrame.duration = currentNal.dts - currentFrame.dts;
          currentFrame.byteLength += currentNal.data.byteLength;
          currentFrame.push(currentNal);
        }
      }
      if (frames.length && (!currentFrame.duration || currentFrame.duration <= 0)) {
        currentFrame.duration = frames[frames.length - 1].duration;
      }
      frames.byteLength += currentFrame.byteLength;
      frames.nalCount += currentFrame.length;
      frames.duration += currentFrame.duration;
      frames.push(currentFrame);
      return frames;
    };
    var groupFramesIntoGops = function groupFramesIntoGops2(frames) {
      var i, currentFrame, currentGop = [], gops = [];
      currentGop.byteLength = 0;
      currentGop.nalCount = 0;
      currentGop.duration = 0;
      currentGop.pts = frames[0].pts;
      currentGop.dts = frames[0].dts;
      gops.byteLength = 0;
      gops.nalCount = 0;
      gops.duration = 0;
      gops.pts = frames[0].pts;
      gops.dts = frames[0].dts;
      for (i = 0; i < frames.length; i++) {
        currentFrame = frames[i];
        if (currentFrame.keyFrame) {
          if (currentGop.length) {
            gops.push(currentGop);
            gops.byteLength += currentGop.byteLength;
            gops.nalCount += currentGop.nalCount;
            gops.duration += currentGop.duration;
          }
          currentGop = [currentFrame];
          currentGop.nalCount = currentFrame.length;
          currentGop.byteLength = currentFrame.byteLength;
          currentGop.pts = currentFrame.pts;
          currentGop.dts = currentFrame.dts;
          currentGop.duration = currentFrame.duration;
        } else {
          currentGop.duration += currentFrame.duration;
          currentGop.nalCount += currentFrame.length;
          currentGop.byteLength += currentFrame.byteLength;
          currentGop.push(currentFrame);
        }
      }
      if (gops.length && currentGop.duration <= 0) {
        currentGop.duration = gops[gops.length - 1].duration;
      }
      gops.byteLength += currentGop.byteLength;
      gops.nalCount += currentGop.nalCount;
      gops.duration += currentGop.duration;
      gops.push(currentGop);
      return gops;
    };
    var extendFirstKeyFrame = function extendFirstKeyFrame2(gops) {
      var currentGop;
      if (!gops[0][0].keyFrame && gops.length > 1) {
        currentGop = gops.shift();
        gops.byteLength -= currentGop.byteLength;
        gops.nalCount -= currentGop.nalCount;
        gops[0][0].dts = currentGop.dts;
        gops[0][0].pts = currentGop.pts;
        gops[0][0].duration += currentGop.duration;
      }
      return gops;
    };
    var createDefaultSample = function createDefaultSample2() {
      return {
        size: 0,
        flags: {
          isLeading: 0,
          dependsOn: 1,
          isDependedOn: 0,
          hasRedundancy: 0,
          degradationPriority: 0,
          isNonSyncSample: 1
        }
      };
    };
    var sampleForFrame = function sampleForFrame2(frame, dataOffset) {
      var sample = createDefaultSample();
      sample.dataOffset = dataOffset;
      sample.compositionTimeOffset = frame.pts - frame.dts;
      sample.duration = frame.duration;
      sample.size = 4 * frame.length;
      sample.size += frame.byteLength;
      if (frame.keyFrame) {
        sample.flags.dependsOn = 2;
        sample.flags.isNonSyncSample = 0;
      }
      return sample;
    };
    var generateSampleTable = function generateSampleTable2(gops, baseDataOffset) {
      var h, i, sample, currentGop, currentFrame, dataOffset = baseDataOffset || 0, samples = [];
      for (h = 0; h < gops.length; h++) {
        currentGop = gops[h];
        for (i = 0; i < currentGop.length; i++) {
          currentFrame = currentGop[i];
          sample = sampleForFrame(currentFrame, dataOffset);
          dataOffset += sample.size;
          samples.push(sample);
        }
      }
      return samples;
    };
    var concatenateNalData = function concatenateNalData2(gops) {
      var h, i, j, currentGop, currentFrame, currentNal, dataOffset = 0, nalsByteLength = gops.byteLength, numberOfNals = gops.nalCount, totalByteLength = nalsByteLength + 4 * numberOfNals, data = new Uint8Array(totalByteLength), view = new DataView(data.buffer);
      for (h = 0; h < gops.length; h++) {
        currentGop = gops[h];
        for (i = 0; i < currentGop.length; i++) {
          currentFrame = currentGop[i];
          for (j = 0; j < currentFrame.length; j++) {
            currentNal = currentFrame[j];
            view.setUint32(dataOffset, currentNal.data.byteLength);
            dataOffset += 4;
            data.set(currentNal.data, dataOffset);
            dataOffset += currentNal.data.byteLength;
          }
        }
      }
      return data;
    };
    var generateSampleTableForFrame = function generateSampleTableForFrame2(frame, baseDataOffset) {
      var sample, dataOffset = baseDataOffset || 0, samples = [];
      sample = sampleForFrame(frame, dataOffset);
      samples.push(sample);
      return samples;
    };
    var concatenateNalDataForFrame = function concatenateNalDataForFrame2(frame) {
      var i, currentNal, dataOffset = 0, nalsByteLength = frame.byteLength, numberOfNals = frame.length, totalByteLength = nalsByteLength + 4 * numberOfNals, data = new Uint8Array(totalByteLength), view = new DataView(data.buffer);
      for (i = 0; i < frame.length; i++) {
        currentNal = frame[i];
        view.setUint32(dataOffset, currentNal.data.byteLength);
        dataOffset += 4;
        data.set(currentNal.data, dataOffset);
        dataOffset += currentNal.data.byteLength;
      }
      return data;
    };
    module.exports = {
      groupNalsIntoFrames,
      groupFramesIntoGops,
      extendFirstKeyFrame,
      generateSampleTable,
      concatenateNalData,
      generateSampleTableForFrame,
      concatenateNalDataForFrame
    };
  }
});

// node_modules/mux.js/cjs/data/silence.js
var require_silence = __commonJS({
  "node_modules/mux.js/cjs/data/silence.js"(exports, module) {
    "use strict";
    var highPrefix = [33, 16, 5, 32, 164, 27];
    var lowPrefix = [33, 65, 108, 84, 1, 2, 4, 8, 168, 2, 4, 8, 17, 191, 252];
    var zeroFill = function zeroFill2(count) {
      var a = [];
      while (count--) {
        a.push(0);
      }
      return a;
    };
    var makeTable = function makeTable2(metaTable) {
      return Object.keys(metaTable).reduce(function(obj, key) {
        obj[key] = new Uint8Array(metaTable[key].reduce(function(arr, part) {
          return arr.concat(part);
        }, []));
        return obj;
      }, {});
    };
    var silence;
    module.exports = function() {
      if (!silence) {
        var coneOfSilence = {
          96e3: [highPrefix, [227, 64], zeroFill(154), [56]],
          88200: [highPrefix, [231], zeroFill(170), [56]],
          64e3: [highPrefix, [248, 192], zeroFill(240), [56]],
          48e3: [highPrefix, [255, 192], zeroFill(268), [55, 148, 128], zeroFill(54), [112]],
          44100: [highPrefix, [255, 192], zeroFill(268), [55, 163, 128], zeroFill(84), [112]],
          32e3: [highPrefix, [255, 192], zeroFill(268), [55, 234], zeroFill(226), [112]],
          24e3: [highPrefix, [255, 192], zeroFill(268), [55, 255, 128], zeroFill(268), [111, 112], zeroFill(126), [224]],
          16e3: [highPrefix, [255, 192], zeroFill(268), [55, 255, 128], zeroFill(268), [111, 255], zeroFill(269), [223, 108], zeroFill(195), [1, 192]],
          12e3: [lowPrefix, zeroFill(268), [3, 127, 248], zeroFill(268), [6, 255, 240], zeroFill(268), [13, 255, 224], zeroFill(268), [27, 253, 128], zeroFill(259), [56]],
          11025: [lowPrefix, zeroFill(268), [3, 127, 248], zeroFill(268), [6, 255, 240], zeroFill(268), [13, 255, 224], zeroFill(268), [27, 255, 192], zeroFill(268), [55, 175, 128], zeroFill(108), [112]],
          8e3: [lowPrefix, zeroFill(268), [3, 121, 16], zeroFill(47), [7]]
        };
        silence = makeTable(coneOfSilence);
      }
      return silence;
    };
  }
});

// node_modules/mux.js/cjs/utils/clock.js
var require_clock = __commonJS({
  "node_modules/mux.js/cjs/utils/clock.js"(exports, module) {
    "use strict";
    var ONE_SECOND_IN_TS = 9e4;
    var secondsToVideoTs;
    var secondsToAudioTs;
    var videoTsToSeconds;
    var audioTsToSeconds;
    var audioTsToVideoTs;
    var videoTsToAudioTs;
    var metadataTsToSeconds;
    secondsToVideoTs = function secondsToVideoTs2(seconds) {
      return seconds * ONE_SECOND_IN_TS;
    };
    secondsToAudioTs = function secondsToAudioTs2(seconds, sampleRate) {
      return seconds * sampleRate;
    };
    videoTsToSeconds = function videoTsToSeconds2(timestamp) {
      return timestamp / ONE_SECOND_IN_TS;
    };
    audioTsToSeconds = function audioTsToSeconds2(timestamp, sampleRate) {
      return timestamp / sampleRate;
    };
    audioTsToVideoTs = function audioTsToVideoTs2(timestamp, sampleRate) {
      return secondsToVideoTs(audioTsToSeconds(timestamp, sampleRate));
    };
    videoTsToAudioTs = function videoTsToAudioTs2(timestamp, sampleRate) {
      return secondsToAudioTs(videoTsToSeconds(timestamp), sampleRate);
    };
    metadataTsToSeconds = function metadataTsToSeconds2(timestamp, timelineStartPts, keepOriginalTimestamps) {
      return videoTsToSeconds(keepOriginalTimestamps ? timestamp : timestamp - timelineStartPts);
    };
    module.exports = {
      ONE_SECOND_IN_TS,
      secondsToVideoTs,
      secondsToAudioTs,
      videoTsToSeconds,
      audioTsToSeconds,
      audioTsToVideoTs,
      videoTsToAudioTs,
      metadataTsToSeconds
    };
  }
});

// node_modules/mux.js/cjs/mp4/audio-frame-utils.js
var require_audio_frame_utils = __commonJS({
  "node_modules/mux.js/cjs/mp4/audio-frame-utils.js"(exports, module) {
    "use strict";
    var coneOfSilence = require_silence();
    var clock = require_clock();
    var sumFrameByteLengths = function sumFrameByteLengths2(array) {
      var i, currentObj, sum = 0;
      for (i = 0; i < array.length; i++) {
        currentObj = array[i];
        sum += currentObj.data.byteLength;
      }
      return sum;
    };
    var prefixWithSilence = function prefixWithSilence2(track, frames, audioAppendStartTs, videoBaseMediaDecodeTime) {
      var baseMediaDecodeTimeTs, frameDuration = 0, audioGapDuration = 0, audioFillFrameCount = 0, audioFillDuration = 0, silentFrame, i, firstFrame;
      if (!frames.length) {
        return;
      }
      baseMediaDecodeTimeTs = clock.audioTsToVideoTs(track.baseMediaDecodeTime, track.samplerate);
      frameDuration = Math.ceil(clock.ONE_SECOND_IN_TS / (track.samplerate / 1024));
      if (audioAppendStartTs && videoBaseMediaDecodeTime) {
        audioGapDuration = baseMediaDecodeTimeTs - Math.max(audioAppendStartTs, videoBaseMediaDecodeTime);
        audioFillFrameCount = Math.floor(audioGapDuration / frameDuration);
        audioFillDuration = audioFillFrameCount * frameDuration;
      }
      if (audioFillFrameCount < 1 || audioFillDuration > clock.ONE_SECOND_IN_TS / 2) {
        return;
      }
      silentFrame = coneOfSilence()[track.samplerate];
      if (!silentFrame) {
        silentFrame = frames[0].data;
      }
      for (i = 0; i < audioFillFrameCount; i++) {
        firstFrame = frames[0];
        frames.splice(0, 0, {
          data: silentFrame,
          dts: firstFrame.dts - frameDuration,
          pts: firstFrame.pts - frameDuration
        });
      }
      track.baseMediaDecodeTime -= Math.floor(clock.videoTsToAudioTs(audioFillDuration, track.samplerate));
      return audioFillDuration;
    };
    var trimAdtsFramesByEarliestDts = function trimAdtsFramesByEarliestDts2(adtsFrames, track, earliestAllowedDts) {
      if (track.minSegmentDts >= earliestAllowedDts) {
        return adtsFrames;
      }
      track.minSegmentDts = Infinity;
      return adtsFrames.filter(function(currentFrame) {
        if (currentFrame.dts >= earliestAllowedDts) {
          track.minSegmentDts = Math.min(track.minSegmentDts, currentFrame.dts);
          track.minSegmentPts = track.minSegmentDts;
          return true;
        }
        return false;
      });
    };
    var generateSampleTable = function generateSampleTable2(frames) {
      var i, currentFrame, samples = [];
      for (i = 0; i < frames.length; i++) {
        currentFrame = frames[i];
        samples.push({
          size: currentFrame.data.byteLength,
          duration: 1024
          // For AAC audio, all samples contain 1024 samples
        });
      }
      return samples;
    };
    var concatenateFrameData = function concatenateFrameData2(frames) {
      var i, currentFrame, dataOffset = 0, data = new Uint8Array(sumFrameByteLengths(frames));
      for (i = 0; i < frames.length; i++) {
        currentFrame = frames[i];
        data.set(currentFrame.data, dataOffset);
        dataOffset += currentFrame.data.byteLength;
      }
      return data;
    };
    module.exports = {
      prefixWithSilence,
      trimAdtsFramesByEarliestDts,
      generateSampleTable,
      concatenateFrameData
    };
  }
});

// node_modules/mux.js/cjs/mp4/track-decode-info.js
var require_track_decode_info = __commonJS({
  "node_modules/mux.js/cjs/mp4/track-decode-info.js"(exports, module) {
    "use strict";
    var ONE_SECOND_IN_TS = require_clock().ONE_SECOND_IN_TS;
    var collectDtsInfo = function collectDtsInfo2(track, data) {
      if (typeof data.pts === "number") {
        if (track.timelineStartInfo.pts === void 0) {
          track.timelineStartInfo.pts = data.pts;
        }
        if (track.minSegmentPts === void 0) {
          track.minSegmentPts = data.pts;
        } else {
          track.minSegmentPts = Math.min(track.minSegmentPts, data.pts);
        }
        if (track.maxSegmentPts === void 0) {
          track.maxSegmentPts = data.pts;
        } else {
          track.maxSegmentPts = Math.max(track.maxSegmentPts, data.pts);
        }
      }
      if (typeof data.dts === "number") {
        if (track.timelineStartInfo.dts === void 0) {
          track.timelineStartInfo.dts = data.dts;
        }
        if (track.minSegmentDts === void 0) {
          track.minSegmentDts = data.dts;
        } else {
          track.minSegmentDts = Math.min(track.minSegmentDts, data.dts);
        }
        if (track.maxSegmentDts === void 0) {
          track.maxSegmentDts = data.dts;
        } else {
          track.maxSegmentDts = Math.max(track.maxSegmentDts, data.dts);
        }
      }
    };
    var clearDtsInfo = function clearDtsInfo2(track) {
      delete track.minSegmentDts;
      delete track.maxSegmentDts;
      delete track.minSegmentPts;
      delete track.maxSegmentPts;
    };
    var calculateTrackBaseMediaDecodeTime = function calculateTrackBaseMediaDecodeTime2(track, keepOriginalTimestamps) {
      var baseMediaDecodeTime, scale, minSegmentDts = track.minSegmentDts;
      if (!keepOriginalTimestamps) {
        minSegmentDts -= track.timelineStartInfo.dts;
      }
      baseMediaDecodeTime = track.timelineStartInfo.baseMediaDecodeTime;
      baseMediaDecodeTime += minSegmentDts;
      baseMediaDecodeTime = Math.max(0, baseMediaDecodeTime);
      if (track.type === "audio") {
        scale = track.samplerate / ONE_SECOND_IN_TS;
        baseMediaDecodeTime *= scale;
        baseMediaDecodeTime = Math.floor(baseMediaDecodeTime);
      }
      return baseMediaDecodeTime;
    };
    module.exports = {
      clearDtsInfo,
      calculateTrackBaseMediaDecodeTime,
      collectDtsInfo
    };
  }
});

// node_modules/mux.js/cjs/tools/caption-packet-parser.js
var require_caption_packet_parser = __commonJS({
  "node_modules/mux.js/cjs/tools/caption-packet-parser.js"(exports, module) {
    "use strict";
    var USER_DATA_REGISTERED_ITU_T_T35 = 4;
    var RBSP_TRAILING_BITS = 128;
    var parseSei = function parseSei2(bytes) {
      var i = 0, result = {
        payloadType: -1,
        payloadSize: 0
      }, payloadType = 0, payloadSize = 0;
      while (i < bytes.byteLength) {
        if (bytes[i] === RBSP_TRAILING_BITS) {
          break;
        }
        while (bytes[i] === 255) {
          payloadType += 255;
          i++;
        }
        payloadType += bytes[i++];
        while (bytes[i] === 255) {
          payloadSize += 255;
          i++;
        }
        payloadSize += bytes[i++];
        if (!result.payload && payloadType === USER_DATA_REGISTERED_ITU_T_T35) {
          var userIdentifier = String.fromCharCode(bytes[i + 3], bytes[i + 4], bytes[i + 5], bytes[i + 6]);
          if (userIdentifier === "GA94") {
            result.payloadType = payloadType;
            result.payloadSize = payloadSize;
            result.payload = bytes.subarray(i, i + payloadSize);
            break;
          } else {
            result.payload = void 0;
          }
        }
        i += payloadSize;
        payloadType = 0;
        payloadSize = 0;
      }
      return result;
    };
    var parseUserData = function parseUserData2(sei) {
      if (sei.payload[0] !== 181) {
        return null;
      }
      if ((sei.payload[1] << 8 | sei.payload[2]) !== 49) {
        return null;
      }
      if (String.fromCharCode(sei.payload[3], sei.payload[4], sei.payload[5], sei.payload[6]) !== "GA94") {
        return null;
      }
      if (sei.payload[7] !== 3) {
        return null;
      }
      return sei.payload.subarray(8, sei.payload.length - 1);
    };
    var parseCaptionPackets = function parseCaptionPackets2(pts, userData) {
      var results = [], i, count, offset, data;
      if (!(userData[0] & 64)) {
        return results;
      }
      count = userData[0] & 31;
      for (i = 0; i < count; i++) {
        offset = i * 3;
        data = {
          type: userData[offset + 2] & 3,
          pts
        };
        if (userData[offset + 2] & 4) {
          data.ccData = userData[offset + 3] << 8 | userData[offset + 4];
          results.push(data);
        }
      }
      return results;
    };
    var discardEmulationPreventionBytes = function discardEmulationPreventionBytes2(data) {
      var length = data.byteLength, emulationPreventionBytesPositions = [], i = 1, newLength, newData;
      while (i < length - 2) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 3) {
          emulationPreventionBytesPositions.push(i + 2);
          i += 2;
        } else {
          i++;
        }
      }
      if (emulationPreventionBytesPositions.length === 0) {
        return data;
      }
      newLength = length - emulationPreventionBytesPositions.length;
      newData = new Uint8Array(newLength);
      var sourceIndex = 0;
      for (i = 0; i < newLength; sourceIndex++, i++) {
        if (sourceIndex === emulationPreventionBytesPositions[0]) {
          sourceIndex++;
          emulationPreventionBytesPositions.shift();
        }
        newData[i] = data[sourceIndex];
      }
      return newData;
    };
    module.exports = {
      parseSei,
      parseUserData,
      parseCaptionPackets,
      discardEmulationPreventionBytes,
      USER_DATA_REGISTERED_ITU_T_T35
    };
  }
});

// node_modules/mux.js/cjs/m2ts/caption-stream.js
var require_caption_stream = __commonJS({
  "node_modules/mux.js/cjs/m2ts/caption-stream.js"(exports, module) {
    "use strict";
    var Stream = require_stream();
    var cea708Parser = require_caption_packet_parser();
    var CaptionStream = function CaptionStream2(options) {
      options = options || {};
      CaptionStream2.prototype.init.call(this);
      this.parse708captions_ = typeof options.parse708captions === "boolean" ? options.parse708captions : true;
      this.captionPackets_ = [];
      this.ccStreams_ = [
        new Cea608Stream(0, 0),
        // eslint-disable-line no-use-before-define
        new Cea608Stream(0, 1),
        // eslint-disable-line no-use-before-define
        new Cea608Stream(1, 0),
        // eslint-disable-line no-use-before-define
        new Cea608Stream(1, 1)
        // eslint-disable-line no-use-before-define
      ];
      if (this.parse708captions_) {
        this.cc708Stream_ = new Cea708Stream({
          captionServices: options.captionServices
        });
      }
      this.reset();
      this.ccStreams_.forEach(function(cc) {
        cc.on("data", this.trigger.bind(this, "data"));
        cc.on("partialdone", this.trigger.bind(this, "partialdone"));
        cc.on("done", this.trigger.bind(this, "done"));
      }, this);
      if (this.parse708captions_) {
        this.cc708Stream_.on("data", this.trigger.bind(this, "data"));
        this.cc708Stream_.on("partialdone", this.trigger.bind(this, "partialdone"));
        this.cc708Stream_.on("done", this.trigger.bind(this, "done"));
      }
    };
    CaptionStream.prototype = new Stream();
    CaptionStream.prototype.push = function(event) {
      var sei, userData, newCaptionPackets;
      if (event.nalUnitType !== "sei_rbsp") {
        return;
      }
      sei = cea708Parser.parseSei(event.escapedRBSP);
      if (!sei.payload) {
        return;
      }
      if (sei.payloadType !== cea708Parser.USER_DATA_REGISTERED_ITU_T_T35) {
        return;
      }
      userData = cea708Parser.parseUserData(sei);
      if (!userData) {
        return;
      }
      if (event.dts < this.latestDts_) {
        this.ignoreNextEqualDts_ = true;
        return;
      } else if (event.dts === this.latestDts_ && this.ignoreNextEqualDts_) {
        this.numSameDts_--;
        if (!this.numSameDts_) {
          this.ignoreNextEqualDts_ = false;
        }
        return;
      }
      newCaptionPackets = cea708Parser.parseCaptionPackets(event.pts, userData);
      this.captionPackets_ = this.captionPackets_.concat(newCaptionPackets);
      if (this.latestDts_ !== event.dts) {
        this.numSameDts_ = 0;
      }
      this.numSameDts_++;
      this.latestDts_ = event.dts;
    };
    CaptionStream.prototype.flushCCStreams = function(flushType) {
      this.ccStreams_.forEach(function(cc) {
        return flushType === "flush" ? cc.flush() : cc.partialFlush();
      }, this);
    };
    CaptionStream.prototype.flushStream = function(flushType) {
      if (!this.captionPackets_.length) {
        this.flushCCStreams(flushType);
        return;
      }
      this.captionPackets_.forEach(function(elem, idx) {
        elem.presortIndex = idx;
      });
      this.captionPackets_.sort(function(a, b) {
        if (a.pts === b.pts) {
          return a.presortIndex - b.presortIndex;
        }
        return a.pts - b.pts;
      });
      this.captionPackets_.forEach(function(packet) {
        if (packet.type < 2) {
          this.dispatchCea608Packet(packet);
        } else {
          this.dispatchCea708Packet(packet);
        }
      }, this);
      this.captionPackets_.length = 0;
      this.flushCCStreams(flushType);
    };
    CaptionStream.prototype.flush = function() {
      return this.flushStream("flush");
    };
    CaptionStream.prototype.partialFlush = function() {
      return this.flushStream("partialFlush");
    };
    CaptionStream.prototype.reset = function() {
      this.latestDts_ = null;
      this.ignoreNextEqualDts_ = false;
      this.numSameDts_ = 0;
      this.activeCea608Channel_ = [null, null];
      this.ccStreams_.forEach(function(ccStream) {
        ccStream.reset();
      });
    };
    CaptionStream.prototype.dispatchCea608Packet = function(packet) {
      if (this.setsTextOrXDSActive(packet)) {
        this.activeCea608Channel_[packet.type] = null;
      } else if (this.setsChannel1Active(packet)) {
        this.activeCea608Channel_[packet.type] = 0;
      } else if (this.setsChannel2Active(packet)) {
        this.activeCea608Channel_[packet.type] = 1;
      }
      if (this.activeCea608Channel_[packet.type] === null) {
        return;
      }
      this.ccStreams_[(packet.type << 1) + this.activeCea608Channel_[packet.type]].push(packet);
    };
    CaptionStream.prototype.setsChannel1Active = function(packet) {
      return (packet.ccData & 30720) === 4096;
    };
    CaptionStream.prototype.setsChannel2Active = function(packet) {
      return (packet.ccData & 30720) === 6144;
    };
    CaptionStream.prototype.setsTextOrXDSActive = function(packet) {
      return (packet.ccData & 28928) === 256 || (packet.ccData & 30974) === 4138 || (packet.ccData & 30974) === 6186;
    };
    CaptionStream.prototype.dispatchCea708Packet = function(packet) {
      if (this.parse708captions_) {
        this.cc708Stream_.push(packet);
      }
    };
    var CHARACTER_TRANSLATION_708 = {
      127: 9834,
      // ♪
      4128: 32,
      // Transparent Space
      4129: 160,
      // Nob-breaking Transparent Space
      4133: 8230,
      // …
      4138: 352,
      // Š
      4140: 338,
      // Œ
      4144: 9608,
      // █
      4145: 8216,
      // ‘
      4146: 8217,
      // ’
      4147: 8220,
      // “
      4148: 8221,
      // ”
      4149: 8226,
      // •
      4153: 8482,
      // ™
      4154: 353,
      // š
      4156: 339,
      // œ
      4157: 8480,
      // ℠
      4159: 376,
      // Ÿ
      4214: 8539,
      // ⅛
      4215: 8540,
      // ⅜
      4216: 8541,
      // ⅝
      4217: 8542,
      // ⅞
      4218: 9168,
      // ⏐
      4219: 9124,
      // ⎤
      4220: 9123,
      // ⎣
      4221: 9135,
      // ⎯
      4222: 9126,
      // ⎦
      4223: 9121,
      // ⎡
      4256: 12600
      // ㄸ (CC char)
    };
    var get708CharFromCode = function get708CharFromCode2(code) {
      var newCode = CHARACTER_TRANSLATION_708[code] || code;
      if (code & 4096 && code === newCode) {
        return "";
      }
      return String.fromCharCode(newCode);
    };
    var within708TextBlock = function within708TextBlock2(b) {
      return 32 <= b && b <= 127 || 160 <= b && b <= 255;
    };
    var Cea708Window = function Cea708Window2(windowNum) {
      this.windowNum = windowNum;
      this.reset();
    };
    Cea708Window.prototype.reset = function() {
      this.clearText();
      this.pendingNewLine = false;
      this.winAttr = {};
      this.penAttr = {};
      this.penLoc = {};
      this.penColor = {};
      this.visible = 0;
      this.rowLock = 0;
      this.columnLock = 0;
      this.priority = 0;
      this.relativePositioning = 0;
      this.anchorVertical = 0;
      this.anchorHorizontal = 0;
      this.anchorPoint = 0;
      this.rowCount = 1;
      this.virtualRowCount = this.rowCount + 1;
      this.columnCount = 41;
      this.windowStyle = 0;
      this.penStyle = 0;
    };
    Cea708Window.prototype.getText = function() {
      return this.rows.join("\n");
    };
    Cea708Window.prototype.clearText = function() {
      this.rows = [""];
      this.rowIdx = 0;
    };
    Cea708Window.prototype.newLine = function(pts) {
      if (this.rows.length >= this.virtualRowCount && typeof this.beforeRowOverflow === "function") {
        this.beforeRowOverflow(pts);
      }
      if (this.rows.length > 0) {
        this.rows.push("");
        this.rowIdx++;
      }
      while (this.rows.length > this.virtualRowCount) {
        this.rows.shift();
        this.rowIdx--;
      }
    };
    Cea708Window.prototype.isEmpty = function() {
      if (this.rows.length === 0) {
        return true;
      } else if (this.rows.length === 1) {
        return this.rows[0] === "";
      }
      return false;
    };
    Cea708Window.prototype.addText = function(text) {
      this.rows[this.rowIdx] += text;
    };
    Cea708Window.prototype.backspace = function() {
      if (!this.isEmpty()) {
        var row = this.rows[this.rowIdx];
        this.rows[this.rowIdx] = row.substr(0, row.length - 1);
      }
    };
    var Cea708Service = function Cea708Service2(serviceNum, encoding, stream) {
      this.serviceNum = serviceNum;
      this.text = "";
      this.currentWindow = new Cea708Window(-1);
      this.windows = [];
      this.stream = stream;
      if (typeof encoding === "string") {
        this.createTextDecoder(encoding);
      }
    };
    Cea708Service.prototype.init = function(pts, beforeRowOverflow) {
      this.startPts = pts;
      for (var win = 0; win < 8; win++) {
        this.windows[win] = new Cea708Window(win);
        if (typeof beforeRowOverflow === "function") {
          this.windows[win].beforeRowOverflow = beforeRowOverflow;
        }
      }
    };
    Cea708Service.prototype.setCurrentWindow = function(windowNum) {
      this.currentWindow = this.windows[windowNum];
    };
    Cea708Service.prototype.createTextDecoder = function(encoding) {
      if (typeof TextDecoder === "undefined") {
        this.stream.trigger("log", {
          level: "warn",
          message: "The `encoding` option is unsupported without TextDecoder support"
        });
      } else {
        try {
          this.textDecoder_ = new TextDecoder(encoding);
        } catch (error) {
          this.stream.trigger("log", {
            level: "warn",
            message: "TextDecoder could not be created with " + encoding + " encoding. " + error
          });
        }
      }
    };
    var Cea708Stream = function Cea708Stream2(options) {
      options = options || {};
      Cea708Stream2.prototype.init.call(this);
      var self = this;
      var captionServices = options.captionServices || {};
      var captionServiceEncodings = {};
      var serviceProps;
      Object.keys(captionServices).forEach(function(serviceName) {
        serviceProps = captionServices[serviceName];
        if (/^SERVICE/.test(serviceName)) {
          captionServiceEncodings[serviceName] = serviceProps.encoding;
        }
      });
      this.serviceEncodings = captionServiceEncodings;
      this.current708Packet = null;
      this.services = {};
      this.push = function(packet) {
        if (packet.type === 3) {
          self.new708Packet();
          self.add708Bytes(packet);
        } else {
          if (self.current708Packet === null) {
            self.new708Packet();
          }
          self.add708Bytes(packet);
        }
      };
    };
    Cea708Stream.prototype = new Stream();
    Cea708Stream.prototype.new708Packet = function() {
      if (this.current708Packet !== null) {
        this.push708Packet();
      }
      this.current708Packet = {
        data: [],
        ptsVals: []
      };
    };
    Cea708Stream.prototype.add708Bytes = function(packet) {
      var data = packet.ccData;
      var byte0 = data >>> 8;
      var byte1 = data & 255;
      this.current708Packet.ptsVals.push(packet.pts);
      this.current708Packet.data.push(byte0);
      this.current708Packet.data.push(byte1);
    };
    Cea708Stream.prototype.push708Packet = function() {
      var packet708 = this.current708Packet;
      var packetData = packet708.data;
      var serviceNum = null;
      var blockSize = null;
      var i = 0;
      var b = packetData[i++];
      packet708.seq = b >> 6;
      packet708.sizeCode = b & 63;
      for (; i < packetData.length; i++) {
        b = packetData[i++];
        serviceNum = b >> 5;
        blockSize = b & 31;
        if (serviceNum === 7 && blockSize > 0) {
          b = packetData[i++];
          serviceNum = b;
        }
        this.pushServiceBlock(serviceNum, i, blockSize);
        if (blockSize > 0) {
          i += blockSize - 1;
        }
      }
    };
    Cea708Stream.prototype.pushServiceBlock = function(serviceNum, start, size) {
      var b;
      var i = start;
      var packetData = this.current708Packet.data;
      var service = this.services[serviceNum];
      if (!service) {
        service = this.initService(serviceNum, i);
      }
      for (; i < start + size && i < packetData.length; i++) {
        b = packetData[i];
        if (within708TextBlock(b)) {
          i = this.handleText(i, service);
        } else if (b === 24) {
          i = this.multiByteCharacter(i, service);
        } else if (b === 16) {
          i = this.extendedCommands(i, service);
        } else if (128 <= b && b <= 135) {
          i = this.setCurrentWindow(i, service);
        } else if (152 <= b && b <= 159) {
          i = this.defineWindow(i, service);
        } else if (b === 136) {
          i = this.clearWindows(i, service);
        } else if (b === 140) {
          i = this.deleteWindows(i, service);
        } else if (b === 137) {
          i = this.displayWindows(i, service);
        } else if (b === 138) {
          i = this.hideWindows(i, service);
        } else if (b === 139) {
          i = this.toggleWindows(i, service);
        } else if (b === 151) {
          i = this.setWindowAttributes(i, service);
        } else if (b === 144) {
          i = this.setPenAttributes(i, service);
        } else if (b === 145) {
          i = this.setPenColor(i, service);
        } else if (b === 146) {
          i = this.setPenLocation(i, service);
        } else if (b === 143) {
          service = this.reset(i, service);
        } else if (b === 8) {
          service.currentWindow.backspace();
        } else if (b === 12) {
          service.currentWindow.clearText();
        } else if (b === 13) {
          service.currentWindow.pendingNewLine = true;
        } else if (b === 14) {
          service.currentWindow.clearText();
        } else if (b === 141) {
          i++;
        } else if (b === 142) {
        } else if (b === 3) {
        } else if (b === 0) {
        } else {
        }
      }
    };
    Cea708Stream.prototype.extendedCommands = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[++i];
      if (within708TextBlock(b)) {
        i = this.handleText(i, service, {
          isExtended: true
        });
      } else {
      }
      return i;
    };
    Cea708Stream.prototype.getPts = function(byteIndex) {
      return this.current708Packet.ptsVals[Math.floor(byteIndex / 2)];
    };
    Cea708Stream.prototype.initService = function(serviceNum, i) {
      var serviceName = "SERVICE" + serviceNum;
      var self = this;
      var serviceName;
      var encoding;
      if (serviceName in this.serviceEncodings) {
        encoding = this.serviceEncodings[serviceName];
      }
      this.services[serviceNum] = new Cea708Service(serviceNum, encoding, self);
      this.services[serviceNum].init(this.getPts(i), function(pts) {
        self.flushDisplayed(pts, self.services[serviceNum]);
      });
      return this.services[serviceNum];
    };
    Cea708Stream.prototype.handleText = function(i, service, options) {
      var isExtended = options && options.isExtended;
      var isMultiByte = options && options.isMultiByte;
      var packetData = this.current708Packet.data;
      var extended = isExtended ? 4096 : 0;
      var currentByte = packetData[i];
      var nextByte = packetData[i + 1];
      var win = service.currentWindow;
      var char;
      var charCodeArray;
      if (service.textDecoder_ && !isExtended) {
        if (isMultiByte) {
          charCodeArray = [currentByte, nextByte];
          i++;
        } else {
          charCodeArray = [currentByte];
        }
        char = service.textDecoder_.decode(new Uint8Array(charCodeArray));
      } else {
        char = get708CharFromCode(extended | currentByte);
      }
      if (win.pendingNewLine && !win.isEmpty()) {
        win.newLine(this.getPts(i));
      }
      win.pendingNewLine = false;
      win.addText(char);
      return i;
    };
    Cea708Stream.prototype.multiByteCharacter = function(i, service) {
      var packetData = this.current708Packet.data;
      var firstByte = packetData[i + 1];
      var secondByte = packetData[i + 2];
      if (within708TextBlock(firstByte) && within708TextBlock(secondByte)) {
        i = this.handleText(++i, service, {
          isMultiByte: true
        });
      } else {
      }
      return i;
    };
    Cea708Stream.prototype.setCurrentWindow = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[i];
      var windowNum = b & 7;
      service.setCurrentWindow(windowNum);
      return i;
    };
    Cea708Stream.prototype.defineWindow = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[i];
      var windowNum = b & 7;
      service.setCurrentWindow(windowNum);
      var win = service.currentWindow;
      b = packetData[++i];
      win.visible = (b & 32) >> 5;
      win.rowLock = (b & 16) >> 4;
      win.columnLock = (b & 8) >> 3;
      win.priority = b & 7;
      b = packetData[++i];
      win.relativePositioning = (b & 128) >> 7;
      win.anchorVertical = b & 127;
      b = packetData[++i];
      win.anchorHorizontal = b;
      b = packetData[++i];
      win.anchorPoint = (b & 240) >> 4;
      win.rowCount = b & 15;
      b = packetData[++i];
      win.columnCount = b & 63;
      b = packetData[++i];
      win.windowStyle = (b & 56) >> 3;
      win.penStyle = b & 7;
      win.virtualRowCount = win.rowCount + 1;
      return i;
    };
    Cea708Stream.prototype.setWindowAttributes = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[i];
      var winAttr = service.currentWindow.winAttr;
      b = packetData[++i];
      winAttr.fillOpacity = (b & 192) >> 6;
      winAttr.fillRed = (b & 48) >> 4;
      winAttr.fillGreen = (b & 12) >> 2;
      winAttr.fillBlue = b & 3;
      b = packetData[++i];
      winAttr.borderType = (b & 192) >> 6;
      winAttr.borderRed = (b & 48) >> 4;
      winAttr.borderGreen = (b & 12) >> 2;
      winAttr.borderBlue = b & 3;
      b = packetData[++i];
      winAttr.borderType += (b & 128) >> 5;
      winAttr.wordWrap = (b & 64) >> 6;
      winAttr.printDirection = (b & 48) >> 4;
      winAttr.scrollDirection = (b & 12) >> 2;
      winAttr.justify = b & 3;
      b = packetData[++i];
      winAttr.effectSpeed = (b & 240) >> 4;
      winAttr.effectDirection = (b & 12) >> 2;
      winAttr.displayEffect = b & 3;
      return i;
    };
    Cea708Stream.prototype.flushDisplayed = function(pts, service) {
      var displayedText = [];
      for (var winId = 0; winId < 8; winId++) {
        if (service.windows[winId].visible && !service.windows[winId].isEmpty()) {
          displayedText.push(service.windows[winId].getText());
        }
      }
      service.endPts = pts;
      service.text = displayedText.join("\n\n");
      this.pushCaption(service);
      service.startPts = pts;
    };
    Cea708Stream.prototype.pushCaption = function(service) {
      if (service.text !== "") {
        this.trigger("data", {
          startPts: service.startPts,
          endPts: service.endPts,
          text: service.text,
          stream: "cc708_" + service.serviceNum
        });
        service.text = "";
        service.startPts = service.endPts;
      }
    };
    Cea708Stream.prototype.displayWindows = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[++i];
      var pts = this.getPts(i);
      this.flushDisplayed(pts, service);
      for (var winId = 0; winId < 8; winId++) {
        if (b & 1 << winId) {
          service.windows[winId].visible = 1;
        }
      }
      return i;
    };
    Cea708Stream.prototype.hideWindows = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[++i];
      var pts = this.getPts(i);
      this.flushDisplayed(pts, service);
      for (var winId = 0; winId < 8; winId++) {
        if (b & 1 << winId) {
          service.windows[winId].visible = 0;
        }
      }
      return i;
    };
    Cea708Stream.prototype.toggleWindows = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[++i];
      var pts = this.getPts(i);
      this.flushDisplayed(pts, service);
      for (var winId = 0; winId < 8; winId++) {
        if (b & 1 << winId) {
          service.windows[winId].visible ^= 1;
        }
      }
      return i;
    };
    Cea708Stream.prototype.clearWindows = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[++i];
      var pts = this.getPts(i);
      this.flushDisplayed(pts, service);
      for (var winId = 0; winId < 8; winId++) {
        if (b & 1 << winId) {
          service.windows[winId].clearText();
        }
      }
      return i;
    };
    Cea708Stream.prototype.deleteWindows = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[++i];
      var pts = this.getPts(i);
      this.flushDisplayed(pts, service);
      for (var winId = 0; winId < 8; winId++) {
        if (b & 1 << winId) {
          service.windows[winId].reset();
        }
      }
      return i;
    };
    Cea708Stream.prototype.setPenAttributes = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[i];
      var penAttr = service.currentWindow.penAttr;
      b = packetData[++i];
      penAttr.textTag = (b & 240) >> 4;
      penAttr.offset = (b & 12) >> 2;
      penAttr.penSize = b & 3;
      b = packetData[++i];
      penAttr.italics = (b & 128) >> 7;
      penAttr.underline = (b & 64) >> 6;
      penAttr.edgeType = (b & 56) >> 3;
      penAttr.fontStyle = b & 7;
      return i;
    };
    Cea708Stream.prototype.setPenColor = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[i];
      var penColor = service.currentWindow.penColor;
      b = packetData[++i];
      penColor.fgOpacity = (b & 192) >> 6;
      penColor.fgRed = (b & 48) >> 4;
      penColor.fgGreen = (b & 12) >> 2;
      penColor.fgBlue = b & 3;
      b = packetData[++i];
      penColor.bgOpacity = (b & 192) >> 6;
      penColor.bgRed = (b & 48) >> 4;
      penColor.bgGreen = (b & 12) >> 2;
      penColor.bgBlue = b & 3;
      b = packetData[++i];
      penColor.edgeRed = (b & 48) >> 4;
      penColor.edgeGreen = (b & 12) >> 2;
      penColor.edgeBlue = b & 3;
      return i;
    };
    Cea708Stream.prototype.setPenLocation = function(i, service) {
      var packetData = this.current708Packet.data;
      var b = packetData[i];
      var penLoc = service.currentWindow.penLoc;
      service.currentWindow.pendingNewLine = true;
      b = packetData[++i];
      penLoc.row = b & 15;
      b = packetData[++i];
      penLoc.column = b & 63;
      return i;
    };
    Cea708Stream.prototype.reset = function(i, service) {
      var pts = this.getPts(i);
      this.flushDisplayed(pts, service);
      return this.initService(service.serviceNum, i);
    };
    var CHARACTER_TRANSLATION = {
      42: 225,
      // á
      92: 233,
      // é
      94: 237,
      // í
      95: 243,
      // ó
      96: 250,
      // ú
      123: 231,
      // ç
      124: 247,
      // ÷
      125: 209,
      // Ñ
      126: 241,
      // ñ
      127: 9608,
      // █
      304: 174,
      // ®
      305: 176,
      // °
      306: 189,
      // ½
      307: 191,
      // ¿
      308: 8482,
      // ™
      309: 162,
      // ¢
      310: 163,
      // £
      311: 9834,
      // ♪
      312: 224,
      // à
      313: 160,
      //
      314: 232,
      // è
      315: 226,
      // â
      316: 234,
      // ê
      317: 238,
      // î
      318: 244,
      // ô
      319: 251,
      // û
      544: 193,
      // Á
      545: 201,
      // É
      546: 211,
      // Ó
      547: 218,
      // Ú
      548: 220,
      // Ü
      549: 252,
      // ü
      550: 8216,
      // ‘
      551: 161,
      // ¡
      552: 42,
      // *
      553: 39,
      // '
      554: 8212,
      // —
      555: 169,
      // ©
      556: 8480,
      // ℠
      557: 8226,
      // •
      558: 8220,
      // “
      559: 8221,
      // ”
      560: 192,
      // À
      561: 194,
      // Â
      562: 199,
      // Ç
      563: 200,
      // È
      564: 202,
      // Ê
      565: 203,
      // Ë
      566: 235,
      // ë
      567: 206,
      // Î
      568: 207,
      // Ï
      569: 239,
      // ï
      570: 212,
      // Ô
      571: 217,
      // Ù
      572: 249,
      // ù
      573: 219,
      // Û
      574: 171,
      // «
      575: 187,
      // »
      800: 195,
      // Ã
      801: 227,
      // ã
      802: 205,
      // Í
      803: 204,
      // Ì
      804: 236,
      // ì
      805: 210,
      // Ò
      806: 242,
      // ò
      807: 213,
      // Õ
      808: 245,
      // õ
      809: 123,
      // {
      810: 125,
      // }
      811: 92,
      // \
      812: 94,
      // ^
      813: 95,
      // _
      814: 124,
      // |
      815: 126,
      // ~
      816: 196,
      // Ä
      817: 228,
      // ä
      818: 214,
      // Ö
      819: 246,
      // ö
      820: 223,
      // ß
      821: 165,
      // ¥
      822: 164,
      // ¤
      823: 9474,
      // │
      824: 197,
      // Å
      825: 229,
      // å
      826: 216,
      // Ø
      827: 248,
      // ø
      828: 9484,
      // ┌
      829: 9488,
      // ┐
      830: 9492,
      // └
      831: 9496
      // ┘
    };
    var getCharFromCode = function getCharFromCode2(code) {
      if (code === null) {
        return "";
      }
      code = CHARACTER_TRANSLATION[code] || code;
      return String.fromCharCode(code);
    };
    var BOTTOM_ROW = 14;
    var ROWS = [4352, 4384, 4608, 4640, 5376, 5408, 5632, 5664, 5888, 5920, 4096, 4864, 4896, 5120, 5152];
    var createDisplayBuffer = function createDisplayBuffer2() {
      var result = [], i = BOTTOM_ROW + 1;
      while (i--) {
        result.push("");
      }
      return result;
    };
    var Cea608Stream = function Cea608Stream2(field, dataChannel) {
      Cea608Stream2.prototype.init.call(this);
      this.field_ = field || 0;
      this.dataChannel_ = dataChannel || 0;
      this.name_ = "CC" + ((this.field_ << 1 | this.dataChannel_) + 1);
      this.setConstants();
      this.reset();
      this.push = function(packet) {
        var data, swap, char0, char1, text;
        data = packet.ccData & 32639;
        if (data === this.lastControlCode_) {
          this.lastControlCode_ = null;
          return;
        }
        if ((data & 61440) === 4096) {
          this.lastControlCode_ = data;
        } else if (data !== this.PADDING_) {
          this.lastControlCode_ = null;
        }
        char0 = data >>> 8;
        char1 = data & 255;
        if (data === this.PADDING_) {
          return;
        } else if (data === this.RESUME_CAPTION_LOADING_) {
          this.mode_ = "popOn";
        } else if (data === this.END_OF_CAPTION_) {
          this.mode_ = "popOn";
          this.clearFormatting(packet.pts);
          this.flushDisplayed(packet.pts);
          swap = this.displayed_;
          this.displayed_ = this.nonDisplayed_;
          this.nonDisplayed_ = swap;
          this.startPts_ = packet.pts;
        } else if (data === this.ROLL_UP_2_ROWS_) {
          this.rollUpRows_ = 2;
          this.setRollUp(packet.pts);
        } else if (data === this.ROLL_UP_3_ROWS_) {
          this.rollUpRows_ = 3;
          this.setRollUp(packet.pts);
        } else if (data === this.ROLL_UP_4_ROWS_) {
          this.rollUpRows_ = 4;
          this.setRollUp(packet.pts);
        } else if (data === this.CARRIAGE_RETURN_) {
          this.clearFormatting(packet.pts);
          this.flushDisplayed(packet.pts);
          this.shiftRowsUp_();
          this.startPts_ = packet.pts;
        } else if (data === this.BACKSPACE_) {
          if (this.mode_ === "popOn") {
            this.nonDisplayed_[this.row_] = this.nonDisplayed_[this.row_].slice(0, -1);
          } else {
            this.displayed_[this.row_] = this.displayed_[this.row_].slice(0, -1);
          }
        } else if (data === this.ERASE_DISPLAYED_MEMORY_) {
          this.flushDisplayed(packet.pts);
          this.displayed_ = createDisplayBuffer();
        } else if (data === this.ERASE_NON_DISPLAYED_MEMORY_) {
          this.nonDisplayed_ = createDisplayBuffer();
        } else if (data === this.RESUME_DIRECT_CAPTIONING_) {
          if (this.mode_ !== "paintOn") {
            this.flushDisplayed(packet.pts);
            this.displayed_ = createDisplayBuffer();
          }
          this.mode_ = "paintOn";
          this.startPts_ = packet.pts;
        } else if (this.isSpecialCharacter(char0, char1)) {
          char0 = (char0 & 3) << 8;
          text = getCharFromCode(char0 | char1);
          this[this.mode_](packet.pts, text);
          this.column_++;
        } else if (this.isExtCharacter(char0, char1)) {
          if (this.mode_ === "popOn") {
            this.nonDisplayed_[this.row_] = this.nonDisplayed_[this.row_].slice(0, -1);
          } else {
            this.displayed_[this.row_] = this.displayed_[this.row_].slice(0, -1);
          }
          char0 = (char0 & 3) << 8;
          text = getCharFromCode(char0 | char1);
          this[this.mode_](packet.pts, text);
          this.column_++;
        } else if (this.isMidRowCode(char0, char1)) {
          this.clearFormatting(packet.pts);
          this[this.mode_](packet.pts, " ");
          this.column_++;
          if ((char1 & 14) === 14) {
            this.addFormatting(packet.pts, ["i"]);
          }
          if ((char1 & 1) === 1) {
            this.addFormatting(packet.pts, ["u"]);
          }
        } else if (this.isOffsetControlCode(char0, char1)) {
          this.column_ += char1 & 3;
        } else if (this.isPAC(char0, char1)) {
          var row = ROWS.indexOf(data & 7968);
          if (this.mode_ === "rollUp") {
            if (row - this.rollUpRows_ + 1 < 0) {
              row = this.rollUpRows_ - 1;
            }
            this.setRollUp(packet.pts, row);
          }
          if (row !== this.row_) {
            this.clearFormatting(packet.pts);
            this.row_ = row;
          }
          if (char1 & 1 && this.formatting_.indexOf("u") === -1) {
            this.addFormatting(packet.pts, ["u"]);
          }
          if ((data & 16) === 16) {
            this.column_ = ((data & 14) >> 1) * 4;
          }
          if (this.isColorPAC(char1)) {
            if ((char1 & 14) === 14) {
              this.addFormatting(packet.pts, ["i"]);
            }
          }
        } else if (this.isNormalChar(char0)) {
          if (char1 === 0) {
            char1 = null;
          }
          text = getCharFromCode(char0);
          text += getCharFromCode(char1);
          this[this.mode_](packet.pts, text);
          this.column_ += text.length;
        }
      };
    };
    Cea608Stream.prototype = new Stream();
    Cea608Stream.prototype.flushDisplayed = function(pts) {
      var content = this.displayed_.map(function(row, index) {
        try {
          return row.trim();
        } catch (e) {
          this.trigger("log", {
            level: "warn",
            message: "Skipping a malformed 608 caption at index " + index + "."
          });
          return "";
        }
      }, this).join("\n").replace(/^\n+|\n+$/g, "");
      if (content.length) {
        this.trigger("data", {
          startPts: this.startPts_,
          endPts: pts,
          text: content,
          stream: this.name_
        });
      }
    };
    Cea608Stream.prototype.reset = function() {
      this.mode_ = "popOn";
      this.topRow_ = 0;
      this.startPts_ = 0;
      this.displayed_ = createDisplayBuffer();
      this.nonDisplayed_ = createDisplayBuffer();
      this.lastControlCode_ = null;
      this.column_ = 0;
      this.row_ = BOTTOM_ROW;
      this.rollUpRows_ = 2;
      this.formatting_ = [];
    };
    Cea608Stream.prototype.setConstants = function() {
      if (this.dataChannel_ === 0) {
        this.BASE_ = 16;
        this.EXT_ = 17;
        this.CONTROL_ = (20 | this.field_) << 8;
        this.OFFSET_ = 23;
      } else if (this.dataChannel_ === 1) {
        this.BASE_ = 24;
        this.EXT_ = 25;
        this.CONTROL_ = (28 | this.field_) << 8;
        this.OFFSET_ = 31;
      }
      this.PADDING_ = 0;
      this.RESUME_CAPTION_LOADING_ = this.CONTROL_ | 32;
      this.END_OF_CAPTION_ = this.CONTROL_ | 47;
      this.ROLL_UP_2_ROWS_ = this.CONTROL_ | 37;
      this.ROLL_UP_3_ROWS_ = this.CONTROL_ | 38;
      this.ROLL_UP_4_ROWS_ = this.CONTROL_ | 39;
      this.CARRIAGE_RETURN_ = this.CONTROL_ | 45;
      this.RESUME_DIRECT_CAPTIONING_ = this.CONTROL_ | 41;
      this.BACKSPACE_ = this.CONTROL_ | 33;
      this.ERASE_DISPLAYED_MEMORY_ = this.CONTROL_ | 44;
      this.ERASE_NON_DISPLAYED_MEMORY_ = this.CONTROL_ | 46;
    };
    Cea608Stream.prototype.isSpecialCharacter = function(char0, char1) {
      return char0 === this.EXT_ && char1 >= 48 && char1 <= 63;
    };
    Cea608Stream.prototype.isExtCharacter = function(char0, char1) {
      return (char0 === this.EXT_ + 1 || char0 === this.EXT_ + 2) && char1 >= 32 && char1 <= 63;
    };
    Cea608Stream.prototype.isMidRowCode = function(char0, char1) {
      return char0 === this.EXT_ && char1 >= 32 && char1 <= 47;
    };
    Cea608Stream.prototype.isOffsetControlCode = function(char0, char1) {
      return char0 === this.OFFSET_ && char1 >= 33 && char1 <= 35;
    };
    Cea608Stream.prototype.isPAC = function(char0, char1) {
      return char0 >= this.BASE_ && char0 < this.BASE_ + 8 && char1 >= 64 && char1 <= 127;
    };
    Cea608Stream.prototype.isColorPAC = function(char1) {
      return char1 >= 64 && char1 <= 79 || char1 >= 96 && char1 <= 127;
    };
    Cea608Stream.prototype.isNormalChar = function(char) {
      return char >= 32 && char <= 127;
    };
    Cea608Stream.prototype.setRollUp = function(pts, newBaseRow) {
      if (this.mode_ !== "rollUp") {
        this.row_ = BOTTOM_ROW;
        this.mode_ = "rollUp";
        this.flushDisplayed(pts);
        this.nonDisplayed_ = createDisplayBuffer();
        this.displayed_ = createDisplayBuffer();
      }
      if (newBaseRow !== void 0 && newBaseRow !== this.row_) {
        for (var i = 0; i < this.rollUpRows_; i++) {
          this.displayed_[newBaseRow - i] = this.displayed_[this.row_ - i];
          this.displayed_[this.row_ - i] = "";
        }
      }
      if (newBaseRow === void 0) {
        newBaseRow = this.row_;
      }
      this.topRow_ = newBaseRow - this.rollUpRows_ + 1;
    };
    Cea608Stream.prototype.addFormatting = function(pts, format) {
      this.formatting_ = this.formatting_.concat(format);
      var text = format.reduce(function(text2, format2) {
        return text2 + "<" + format2 + ">";
      }, "");
      this[this.mode_](pts, text);
    };
    Cea608Stream.prototype.clearFormatting = function(pts) {
      if (!this.formatting_.length) {
        return;
      }
      var text = this.formatting_.reverse().reduce(function(text2, format) {
        return text2 + "</" + format + ">";
      }, "");
      this.formatting_ = [];
      this[this.mode_](pts, text);
    };
    Cea608Stream.prototype.popOn = function(pts, text) {
      var baseRow = this.nonDisplayed_[this.row_];
      baseRow += text;
      this.nonDisplayed_[this.row_] = baseRow;
    };
    Cea608Stream.prototype.rollUp = function(pts, text) {
      var baseRow = this.displayed_[this.row_];
      baseRow += text;
      this.displayed_[this.row_] = baseRow;
    };
    Cea608Stream.prototype.shiftRowsUp_ = function() {
      var i;
      for (i = 0; i < this.topRow_; i++) {
        this.displayed_[i] = "";
      }
      for (i = this.row_ + 1; i < BOTTOM_ROW + 1; i++) {
        this.displayed_[i] = "";
      }
      for (i = this.topRow_; i < this.row_; i++) {
        this.displayed_[i] = this.displayed_[i + 1];
      }
      this.displayed_[this.row_] = "";
    };
    Cea608Stream.prototype.paintOn = function(pts, text) {
      var baseRow = this.displayed_[this.row_];
      baseRow += text;
      this.displayed_[this.row_] = baseRow;
    };
    module.exports = {
      CaptionStream,
      Cea608Stream,
      Cea708Stream
    };
  }
});

// node_modules/mux.js/cjs/m2ts/stream-types.js
var require_stream_types = __commonJS({
  "node_modules/mux.js/cjs/m2ts/stream-types.js"(exports, module) {
    "use strict";
    module.exports = {
      H264_STREAM_TYPE: 27,
      ADTS_STREAM_TYPE: 15,
      METADATA_STREAM_TYPE: 21
    };
  }
});

// node_modules/mux.js/cjs/m2ts/timestamp-rollover-stream.js
var require_timestamp_rollover_stream = __commonJS({
  "node_modules/mux.js/cjs/m2ts/timestamp-rollover-stream.js"(exports, module) {
    "use strict";
    var Stream = require_stream();
    var MAX_TS = 8589934592;
    var RO_THRESH = 4294967296;
    var TYPE_SHARED = "shared";
    var handleRollover = function handleRollover2(value, reference) {
      var direction = 1;
      if (value > reference) {
        direction = -1;
      }
      while (Math.abs(reference - value) > RO_THRESH) {
        value += direction * MAX_TS;
      }
      return value;
    };
    var TimestampRolloverStream = function TimestampRolloverStream2(type) {
      var lastDTS, referenceDTS;
      TimestampRolloverStream2.prototype.init.call(this);
      this.type_ = type || TYPE_SHARED;
      this.push = function(data) {
        if (this.type_ !== TYPE_SHARED && data.type !== this.type_) {
          return;
        }
        if (referenceDTS === void 0) {
          referenceDTS = data.dts;
        }
        data.dts = handleRollover(data.dts, referenceDTS);
        data.pts = handleRollover(data.pts, referenceDTS);
        lastDTS = data.dts;
        this.trigger("data", data);
      };
      this.flush = function() {
        referenceDTS = lastDTS;
        this.trigger("done");
      };
      this.endTimeline = function() {
        this.flush();
        this.trigger("endedtimeline");
      };
      this.discontinuity = function() {
        referenceDTS = void 0;
        lastDTS = void 0;
      };
      this.reset = function() {
        this.discontinuity();
        this.trigger("reset");
      };
    };
    TimestampRolloverStream.prototype = new Stream();
    module.exports = {
      TimestampRolloverStream,
      handleRollover
    };
  }
});

// node_modules/mux.js/cjs/utils/typed-array.js
var require_typed_array = __commonJS({
  "node_modules/mux.js/cjs/utils/typed-array.js"(exports, module) {
    "use strict";
    var typedArrayIndexOf = function typedArrayIndexOf2(typedArray, element, fromIndex) {
      if (!typedArray) {
        return -1;
      }
      var currentIndex = fromIndex;
      for (; currentIndex < typedArray.length; currentIndex++) {
        if (typedArray[currentIndex] === element) {
          return currentIndex;
        }
      }
      return -1;
    };
    module.exports = {
      typedArrayIndexOf
    };
  }
});

// node_modules/mux.js/cjs/tools/parse-id3.js
var require_parse_id3 = __commonJS({
  "node_modules/mux.js/cjs/tools/parse-id3.js"(exports, module) {
    "use strict";
    var typedArrayIndexOf = require_typed_array().typedArrayIndexOf;
    var textEncodingDescriptionByte = {
      Iso88591: 0,
      // ISO-8859-1, terminated with \0.
      Utf16: 1,
      // UTF-16 encoded Unicode BOM, terminated with \0\0
      Utf16be: 2,
      // UTF-16BE encoded Unicode, without BOM, terminated with \0\0
      Utf8: 3
      // UTF-8 encoded Unicode, terminated with \0
    };
    var percentEncode = function percentEncode2(bytes, start, end) {
      var i, result = "";
      for (i = start; i < end; i++) {
        result += "%" + ("00" + bytes[i].toString(16)).slice(-2);
      }
      return result;
    };
    var parseUtf8 = function parseUtf82(bytes, start, end) {
      return decodeURIComponent(percentEncode(bytes, start, end));
    };
    var parseIso88591 = function parseIso885912(bytes, start, end) {
      return unescape(percentEncode(bytes, start, end));
    };
    var parseSyncSafeInteger = function parseSyncSafeInteger2(data) {
      return data[0] << 21 | data[1] << 14 | data[2] << 7 | data[3];
    };
    var frameParsers = {
      "APIC": function APIC(frame) {
        var i = 1, mimeTypeEndIndex, descriptionEndIndex, LINK_MIME_TYPE = "-->";
        if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
          return;
        }
        mimeTypeEndIndex = typedArrayIndexOf(frame.data, 0, i);
        if (mimeTypeEndIndex < 0) {
          return;
        }
        frame.mimeType = parseIso88591(frame.data, i, mimeTypeEndIndex);
        i = mimeTypeEndIndex + 1;
        frame.pictureType = frame.data[i];
        i++;
        descriptionEndIndex = typedArrayIndexOf(frame.data, 0, i);
        if (descriptionEndIndex < 0) {
          return;
        }
        frame.description = parseUtf8(frame.data, i, descriptionEndIndex);
        i = descriptionEndIndex + 1;
        if (frame.mimeType === LINK_MIME_TYPE) {
          frame.url = parseIso88591(frame.data, i, frame.data.length);
        } else {
          frame.pictureData = frame.data.subarray(i, frame.data.length);
        }
      },
      "T*": function T(frame) {
        if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
          return;
        }
        frame.value = parseUtf8(frame.data, 1, frame.data.length).replace(/\0*$/, "");
        frame.values = frame.value.split("\0");
      },
      "TXXX": function TXXX(frame) {
        var descriptionEndIndex;
        if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
          return;
        }
        descriptionEndIndex = typedArrayIndexOf(frame.data, 0, 1);
        if (descriptionEndIndex === -1) {
          return;
        }
        frame.description = parseUtf8(frame.data, 1, descriptionEndIndex);
        frame.value = parseUtf8(frame.data, descriptionEndIndex + 1, frame.data.length).replace(/\0*$/, "");
        frame.data = frame.value;
      },
      "W*": function W(frame) {
        frame.url = parseIso88591(frame.data, 0, frame.data.length).replace(/\0.*$/, "");
      },
      "WXXX": function WXXX(frame) {
        var descriptionEndIndex;
        if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
          return;
        }
        descriptionEndIndex = typedArrayIndexOf(frame.data, 0, 1);
        if (descriptionEndIndex === -1) {
          return;
        }
        frame.description = parseUtf8(frame.data, 1, descriptionEndIndex);
        frame.url = parseIso88591(frame.data, descriptionEndIndex + 1, frame.data.length).replace(/\0.*$/, "");
      },
      "PRIV": function PRIV(frame) {
        var i;
        for (i = 0; i < frame.data.length; i++) {
          if (frame.data[i] === 0) {
            frame.owner = parseIso88591(frame.data, 0, i);
            break;
          }
        }
        frame.privateData = frame.data.subarray(i + 1);
        frame.data = frame.privateData;
      }
    };
    var parseId3Frames = function parseId3Frames2(data) {
      var frameSize, frameHeader, frameStart = 10, tagSize = 0, frames = [];
      if (data.length < 10 || data[0] !== "I".charCodeAt(0) || data[1] !== "D".charCodeAt(0) || data[2] !== "3".charCodeAt(0)) {
        return;
      }
      tagSize = parseSyncSafeInteger(data.subarray(6, 10));
      tagSize += 10;
      var hasExtendedHeader = data[5] & 64;
      if (hasExtendedHeader) {
        frameStart += 4;
        frameStart += parseSyncSafeInteger(data.subarray(10, 14));
        tagSize -= parseSyncSafeInteger(data.subarray(16, 20));
      }
      do {
        frameSize = parseSyncSafeInteger(data.subarray(frameStart + 4, frameStart + 8));
        if (frameSize < 1) {
          break;
        }
        frameHeader = String.fromCharCode(data[frameStart], data[frameStart + 1], data[frameStart + 2], data[frameStart + 3]);
        var frame = {
          id: frameHeader,
          data: data.subarray(frameStart + 10, frameStart + frameSize + 10)
        };
        frame.key = frame.id;
        if (frameParsers[frame.id]) {
          frameParsers[frame.id](frame);
        } else if (frame.id[0] === "T") {
          frameParsers["T*"](frame);
        } else if (frame.id[0] === "W") {
          frameParsers["W*"](frame);
        }
        frames.push(frame);
        frameStart += 10;
        frameStart += frameSize;
      } while (frameStart < tagSize);
      return frames;
    };
    module.exports = {
      parseId3Frames,
      parseSyncSafeInteger,
      frameParsers
    };
  }
});

// node_modules/mux.js/cjs/m2ts/metadata-stream.js
var require_metadata_stream = __commonJS({
  "node_modules/mux.js/cjs/m2ts/metadata-stream.js"(exports, module) {
    "use strict";
    var Stream = require_stream();
    var StreamTypes = require_stream_types();
    var id3 = require_parse_id3();
    var _MetadataStream;
    _MetadataStream = function MetadataStream(options) {
      var settings = {
        // the bytes of the program-level descriptor field in MP2T
        // see ISO/IEC 13818-1:2013 (E), section 2.6 "Program and
        // program element descriptors"
        descriptor: options && options.descriptor
      }, tagSize = 0, buffer = [], bufferSize = 0, i;
      _MetadataStream.prototype.init.call(this);
      this.dispatchType = StreamTypes.METADATA_STREAM_TYPE.toString(16);
      if (settings.descriptor) {
        for (i = 0; i < settings.descriptor.length; i++) {
          this.dispatchType += ("00" + settings.descriptor[i].toString(16)).slice(-2);
        }
      }
      this.push = function(chunk) {
        var tag, frameStart, frameSize, frame, i2, frameHeader;
        if (chunk.type !== "timed-metadata") {
          return;
        }
        if (chunk.dataAlignmentIndicator) {
          bufferSize = 0;
          buffer.length = 0;
        }
        if (buffer.length === 0 && (chunk.data.length < 10 || chunk.data[0] !== "I".charCodeAt(0) || chunk.data[1] !== "D".charCodeAt(0) || chunk.data[2] !== "3".charCodeAt(0))) {
          this.trigger("log", {
            level: "warn",
            message: "Skipping unrecognized metadata packet"
          });
          return;
        }
        buffer.push(chunk);
        bufferSize += chunk.data.byteLength;
        if (buffer.length === 1) {
          tagSize = id3.parseSyncSafeInteger(chunk.data.subarray(6, 10));
          tagSize += 10;
        }
        if (bufferSize < tagSize) {
          return;
        }
        tag = {
          data: new Uint8Array(tagSize),
          frames: [],
          pts: buffer[0].pts,
          dts: buffer[0].dts
        };
        for (i2 = 0; i2 < tagSize; ) {
          tag.data.set(buffer[0].data.subarray(0, tagSize - i2), i2);
          i2 += buffer[0].data.byteLength;
          bufferSize -= buffer[0].data.byteLength;
          buffer.shift();
        }
        frameStart = 10;
        if (tag.data[5] & 64) {
          frameStart += 4;
          frameStart += id3.parseSyncSafeInteger(tag.data.subarray(10, 14));
          tagSize -= id3.parseSyncSafeInteger(tag.data.subarray(16, 20));
        }
        do {
          frameSize = id3.parseSyncSafeInteger(tag.data.subarray(frameStart + 4, frameStart + 8));
          if (frameSize < 1) {
            this.trigger("log", {
              level: "warn",
              message: "Malformed ID3 frame encountered. Skipping remaining metadata parsing."
            });
            break;
          }
          frameHeader = String.fromCharCode(tag.data[frameStart], tag.data[frameStart + 1], tag.data[frameStart + 2], tag.data[frameStart + 3]);
          frame = {
            id: frameHeader,
            data: tag.data.subarray(frameStart + 10, frameStart + frameSize + 10)
          };
          frame.key = frame.id;
          if (id3.frameParsers[frame.id]) {
            id3.frameParsers[frame.id](frame);
          } else if (frame.id[0] === "T") {
            id3.frameParsers["T*"](frame);
          } else if (frame.id[0] === "W") {
            id3.frameParsers["W*"](frame);
          }
          if (frame.owner === "com.apple.streaming.transportStreamTimestamp") {
            var d = frame.data, size = (d[3] & 1) << 30 | d[4] << 22 | d[5] << 14 | d[6] << 6 | d[7] >>> 2;
            size *= 4;
            size += d[7] & 3;
            frame.timeStamp = size;
            if (tag.pts === void 0 && tag.dts === void 0) {
              tag.pts = frame.timeStamp;
              tag.dts = frame.timeStamp;
            }
            this.trigger("timestamp", frame);
          }
          tag.frames.push(frame);
          frameStart += 10;
          frameStart += frameSize;
        } while (frameStart < tagSize);
        this.trigger("data", tag);
      };
    };
    _MetadataStream.prototype = new Stream();
    module.exports = _MetadataStream;
  }
});

// node_modules/mux.js/cjs/m2ts/m2ts.js
var require_m2ts = __commonJS({
  "node_modules/mux.js/cjs/m2ts/m2ts.js"(exports, module) {
    "use strict";
    var Stream = require_stream();
    var CaptionStream = require_caption_stream();
    var StreamTypes = require_stream_types();
    var TimestampRolloverStream = require_timestamp_rollover_stream().TimestampRolloverStream;
    var _TransportPacketStream;
    var _TransportParseStream;
    var _ElementaryStream;
    var MP2T_PACKET_LENGTH = 188;
    var SYNC_BYTE = 71;
    _TransportPacketStream = function TransportPacketStream() {
      var buffer = new Uint8Array(MP2T_PACKET_LENGTH), bytesInBuffer = 0;
      _TransportPacketStream.prototype.init.call(this);
      this.push = function(bytes) {
        var startIndex = 0, endIndex = MP2T_PACKET_LENGTH, everything;
        if (bytesInBuffer) {
          everything = new Uint8Array(bytes.byteLength + bytesInBuffer);
          everything.set(buffer.subarray(0, bytesInBuffer));
          everything.set(bytes, bytesInBuffer);
          bytesInBuffer = 0;
        } else {
          everything = bytes;
        }
        while (endIndex < everything.byteLength) {
          if (everything[startIndex] === SYNC_BYTE && everything[endIndex] === SYNC_BYTE) {
            this.trigger("data", everything.subarray(startIndex, endIndex));
            startIndex += MP2T_PACKET_LENGTH;
            endIndex += MP2T_PACKET_LENGTH;
            continue;
          }
          startIndex++;
          endIndex++;
        }
        if (startIndex < everything.byteLength) {
          buffer.set(everything.subarray(startIndex), 0);
          bytesInBuffer = everything.byteLength - startIndex;
        }
      };
      this.flush = function() {
        if (bytesInBuffer === MP2T_PACKET_LENGTH && buffer[0] === SYNC_BYTE) {
          this.trigger("data", buffer);
          bytesInBuffer = 0;
        }
        this.trigger("done");
      };
      this.endTimeline = function() {
        this.flush();
        this.trigger("endedtimeline");
      };
      this.reset = function() {
        bytesInBuffer = 0;
        this.trigger("reset");
      };
    };
    _TransportPacketStream.prototype = new Stream();
    _TransportParseStream = function TransportParseStream() {
      var parsePsi, parsePat, parsePmt, self;
      _TransportParseStream.prototype.init.call(this);
      self = this;
      this.packetsWaitingForPmt = [];
      this.programMapTable = void 0;
      parsePsi = function parsePsi2(payload, psi) {
        var offset = 0;
        if (psi.payloadUnitStartIndicator) {
          offset += payload[offset] + 1;
        }
        if (psi.type === "pat") {
          parsePat(payload.subarray(offset), psi);
        } else {
          parsePmt(payload.subarray(offset), psi);
        }
      };
      parsePat = function parsePat2(payload, pat) {
        pat.section_number = payload[7];
        pat.last_section_number = payload[8];
        self.pmtPid = (payload[10] & 31) << 8 | payload[11];
        pat.pmtPid = self.pmtPid;
      };
      parsePmt = function parsePmt2(payload, pmt) {
        var sectionLength, tableEnd, programInfoLength, offset;
        if (!(payload[5] & 1)) {
          return;
        }
        self.programMapTable = {
          video: null,
          audio: null,
          "timed-metadata": {}
        };
        sectionLength = (payload[1] & 15) << 8 | payload[2];
        tableEnd = 3 + sectionLength - 4;
        programInfoLength = (payload[10] & 15) << 8 | payload[11];
        offset = 12 + programInfoLength;
        while (offset < tableEnd) {
          var streamType = payload[offset];
          var pid = (payload[offset + 1] & 31) << 8 | payload[offset + 2];
          if (streamType === StreamTypes.H264_STREAM_TYPE && self.programMapTable.video === null) {
            self.programMapTable.video = pid;
          } else if (streamType === StreamTypes.ADTS_STREAM_TYPE && self.programMapTable.audio === null) {
            self.programMapTable.audio = pid;
          } else if (streamType === StreamTypes.METADATA_STREAM_TYPE) {
            self.programMapTable["timed-metadata"][pid] = streamType;
          }
          offset += ((payload[offset + 3] & 15) << 8 | payload[offset + 4]) + 5;
        }
        pmt.programMapTable = self.programMapTable;
      };
      this.push = function(packet) {
        var result = {}, offset = 4;
        result.payloadUnitStartIndicator = !!(packet[1] & 64);
        result.pid = packet[1] & 31;
        result.pid <<= 8;
        result.pid |= packet[2];
        if ((packet[3] & 48) >>> 4 > 1) {
          offset += packet[offset] + 1;
        }
        if (result.pid === 0) {
          result.type = "pat";
          parsePsi(packet.subarray(offset), result);
          this.trigger("data", result);
        } else if (result.pid === this.pmtPid) {
          result.type = "pmt";
          parsePsi(packet.subarray(offset), result);
          this.trigger("data", result);
          while (this.packetsWaitingForPmt.length) {
            this.processPes_.apply(this, this.packetsWaitingForPmt.shift());
          }
        } else if (this.programMapTable === void 0) {
          this.packetsWaitingForPmt.push([packet, offset, result]);
        } else {
          this.processPes_(packet, offset, result);
        }
      };
      this.processPes_ = function(packet, offset, result) {
        if (result.pid === this.programMapTable.video) {
          result.streamType = StreamTypes.H264_STREAM_TYPE;
        } else if (result.pid === this.programMapTable.audio) {
          result.streamType = StreamTypes.ADTS_STREAM_TYPE;
        } else {
          result.streamType = this.programMapTable["timed-metadata"][result.pid];
        }
        result.type = "pes";
        result.data = packet.subarray(offset);
        this.trigger("data", result);
      };
    };
    _TransportParseStream.prototype = new Stream();
    _TransportParseStream.STREAM_TYPES = {
      h264: 27,
      adts: 15
    };
    _ElementaryStream = function ElementaryStream() {
      var self = this, segmentHadPmt = false, video = {
        data: [],
        size: 0
      }, audio = {
        data: [],
        size: 0
      }, timedMetadata = {
        data: [],
        size: 0
      }, programMapTable, parsePes = function parsePes2(payload, pes) {
        var ptsDtsFlags;
        var startPrefix = payload[0] << 16 | payload[1] << 8 | payload[2];
        pes.data = new Uint8Array();
        if (startPrefix !== 1) {
          return;
        }
        pes.packetLength = 6 + (payload[4] << 8 | payload[5]);
        pes.dataAlignmentIndicator = (payload[6] & 4) !== 0;
        ptsDtsFlags = payload[7];
        if (ptsDtsFlags & 192) {
          pes.pts = (payload[9] & 14) << 27 | (payload[10] & 255) << 20 | (payload[11] & 254) << 12 | (payload[12] & 255) << 5 | (payload[13] & 254) >>> 3;
          pes.pts *= 4;
          pes.pts += (payload[13] & 6) >>> 1;
          pes.dts = pes.pts;
          if (ptsDtsFlags & 64) {
            pes.dts = (payload[14] & 14) << 27 | (payload[15] & 255) << 20 | (payload[16] & 254) << 12 | (payload[17] & 255) << 5 | (payload[18] & 254) >>> 3;
            pes.dts *= 4;
            pes.dts += (payload[18] & 6) >>> 1;
          }
        }
        pes.data = payload.subarray(9 + payload[8]);
      }, flushStream = function flushStream2(stream, type2, forceFlush) {
        var packetData = new Uint8Array(stream.size), event = {
          type: type2
        }, i = 0, offset = 0, packetFlushable = false, fragment;
        if (!stream.data.length || stream.size < 9) {
          return;
        }
        event.trackId = stream.data[0].pid;
        for (i = 0; i < stream.data.length; i++) {
          fragment = stream.data[i];
          packetData.set(fragment.data, offset);
          offset += fragment.data.byteLength;
        }
        parsePes(packetData, event);
        packetFlushable = type2 === "video" || event.packetLength <= stream.size;
        if (forceFlush || packetFlushable) {
          stream.size = 0;
          stream.data.length = 0;
        }
        if (packetFlushable) {
          self.trigger("data", event);
        }
      };
      _ElementaryStream.prototype.init.call(this);
      this.push = function(data) {
        ({
          pat: function pat() {
          },
          pes: function pes() {
            var stream, streamType;
            switch (data.streamType) {
              case StreamTypes.H264_STREAM_TYPE:
                stream = video;
                streamType = "video";
                break;
              case StreamTypes.ADTS_STREAM_TYPE:
                stream = audio;
                streamType = "audio";
                break;
              case StreamTypes.METADATA_STREAM_TYPE:
                stream = timedMetadata;
                streamType = "timed-metadata";
                break;
              default:
                return;
            }
            if (data.payloadUnitStartIndicator) {
              flushStream(stream, streamType, true);
            }
            stream.data.push(data);
            stream.size += data.data.byteLength;
          },
          pmt: function pmt() {
            var event = {
              type: "metadata",
              tracks: []
            };
            programMapTable = data.programMapTable;
            if (programMapTable.video !== null) {
              event.tracks.push({
                timelineStartInfo: {
                  baseMediaDecodeTime: 0
                },
                id: +programMapTable.video,
                codec: "avc",
                type: "video"
              });
            }
            if (programMapTable.audio !== null) {
              event.tracks.push({
                timelineStartInfo: {
                  baseMediaDecodeTime: 0
                },
                id: +programMapTable.audio,
                codec: "adts",
                type: "audio"
              });
            }
            segmentHadPmt = true;
            self.trigger("data", event);
          }
        })[data.type]();
      };
      this.reset = function() {
        video.size = 0;
        video.data.length = 0;
        audio.size = 0;
        audio.data.length = 0;
        this.trigger("reset");
      };
      this.flushStreams_ = function() {
        flushStream(video, "video");
        flushStream(audio, "audio");
        flushStream(timedMetadata, "timed-metadata");
      };
      this.flush = function() {
        if (!segmentHadPmt && programMapTable) {
          var pmt = {
            type: "metadata",
            tracks: []
          };
          if (programMapTable.video !== null) {
            pmt.tracks.push({
              timelineStartInfo: {
                baseMediaDecodeTime: 0
              },
              id: +programMapTable.video,
              codec: "avc",
              type: "video"
            });
          }
          if (programMapTable.audio !== null) {
            pmt.tracks.push({
              timelineStartInfo: {
                baseMediaDecodeTime: 0
              },
              id: +programMapTable.audio,
              codec: "adts",
              type: "audio"
            });
          }
          self.trigger("data", pmt);
        }
        segmentHadPmt = false;
        this.flushStreams_();
        this.trigger("done");
      };
    };
    _ElementaryStream.prototype = new Stream();
    var m2ts = {
      PAT_PID: 0,
      MP2T_PACKET_LENGTH,
      TransportPacketStream: _TransportPacketStream,
      TransportParseStream: _TransportParseStream,
      ElementaryStream: _ElementaryStream,
      TimestampRolloverStream,
      CaptionStream: CaptionStream.CaptionStream,
      Cea608Stream: CaptionStream.Cea608Stream,
      Cea708Stream: CaptionStream.Cea708Stream,
      MetadataStream: require_metadata_stream()
    };
    for (type in StreamTypes) {
      if (StreamTypes.hasOwnProperty(type)) {
        m2ts[type] = StreamTypes[type];
      }
    }
    var type;
    module.exports = m2ts;
  }
});

// node_modules/mux.js/cjs/codecs/adts.js
var require_adts = __commonJS({
  "node_modules/mux.js/cjs/codecs/adts.js"(exports, module) {
    "use strict";
    var Stream = require_stream();
    var ONE_SECOND_IN_TS = require_clock().ONE_SECOND_IN_TS;
    var _AdtsStream;
    var ADTS_SAMPLING_FREQUENCIES = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
    _AdtsStream = function AdtsStream2(handlePartialSegments) {
      var buffer, frameNum = 0, fluxFrames = 0;
      _AdtsStream.prototype.init.call(this);
      this.skipWarn_ = function(start, end) {
        this.trigger("log", {
          level: "warn",
          message: "adts skiping bytes " + start + " to " + end + " in frame " + frameNum + " outside syncword"
        });
      };
      this.push = function(packet) {
        var i = 0, frameLength, protectionSkipBytes, frameEnd, oldBuffer, sampleCount, adtsFrameDuration;
        if (!handlePartialSegments) {
          frameNum = 0;
        }
        if (packet.type !== "audio") {
          return;
        }
        if (buffer && buffer.length) {
          oldBuffer = buffer;
          buffer = new Uint8Array(oldBuffer.byteLength + packet.data.byteLength);
          buffer.set(oldBuffer);
          buffer.set(packet.data, oldBuffer.byteLength);
        } else {
          buffer = packet.data;
        }
        var skip;
        while (i + 7 < buffer.length) {
          if (buffer[i] !== 255 || (buffer[i + 1] & 246) !== 240) {
            if (typeof skip !== "number") {
              skip = i;
            }
            i++;
            continue;
          }
          if (typeof skip === "number") {
            this.skipWarn_(skip, i);
            skip = null;
          }
          protectionSkipBytes = (~buffer[i + 1] & 1) * 2;
          frameLength = (buffer[i + 3] & 3) << 11 | buffer[i + 4] << 3 | (buffer[i + 5] & 224) >> 5;
          if (frameLength <= 7 + protectionSkipBytes) throw new Error("Invalid AAC frame length.");
          sampleCount = ((buffer[i + 6] & 3) + 1) * 1024;
          adtsFrameDuration = sampleCount * ONE_SECOND_IN_TS / ADTS_SAMPLING_FREQUENCIES[(buffer[i + 2] & 60) >>> 2];
          if (buffer.byteLength - i < frameLength) {
            break;
          }
          if (!Number.isFinite(adtsFrameDuration) || adtsFrameDuration <= 0 || ++fluxFrames > 32768) throw new Error("Invalid or excessive AAC frames.");
          this.trigger("data", {
            pts: packet.pts + frameNum * adtsFrameDuration,
            dts: packet.dts + frameNum * adtsFrameDuration,
            sampleCount,
            audioobjecttype: (buffer[i + 2] >>> 6 & 3) + 1,
            channelcount: (buffer[i + 2] & 1) << 2 | (buffer[i + 3] & 192) >>> 6,
            samplerate: ADTS_SAMPLING_FREQUENCIES[(buffer[i + 2] & 60) >>> 2],
            samplingfrequencyindex: (buffer[i + 2] & 60) >>> 2,
            // assume ISO/IEC 14496-12 AudioSampleEntry default of 16
            samplesize: 16,
            // data is the frame without it's header
            data: buffer.subarray(i + 7 + protectionSkipBytes, i + frameLength)
          });
          frameNum++;
          i += frameLength;
        }
        if (typeof skip === "number") {
          this.skipWarn_(skip, i);
          skip = null;
        }
        buffer = buffer.subarray(i);
      };
      this.flush = function() {
        frameNum = 0;
        this.trigger("done");
      };
      this.reset = function() {
        buffer = void 0;
        this.trigger("reset");
      };
      this.endTimeline = function() {
        buffer = void 0;
        this.trigger("endedtimeline");
      };
    };
    _AdtsStream.prototype = new Stream();
    module.exports = _AdtsStream;
  }
});

// node_modules/mux.js/cjs/utils/exp-golomb.js
var require_exp_golomb = __commonJS({
  "node_modules/mux.js/cjs/utils/exp-golomb.js"(exports, module) {
    "use strict";
    var ExpGolomb;
    ExpGolomb = function ExpGolomb2(workingData) {
      var workingBytesAvailable = workingData.byteLength, workingWord = 0, workingBitsAvailable = 0;
      this.length = function() {
        return 8 * workingBytesAvailable;
      };
      this.bitsAvailable = function() {
        return 8 * workingBytesAvailable + workingBitsAvailable;
      };
      this.loadWord = function() {
        var position = workingData.byteLength - workingBytesAvailable, workingBytes = new Uint8Array(4), availableBytes = Math.min(4, workingBytesAvailable);
        if (availableBytes === 0) {
          throw new Error("no bytes available");
        }
        workingBytes.set(workingData.subarray(position, position + availableBytes));
        workingWord = new DataView(workingBytes.buffer).getUint32(0);
        workingBitsAvailable = availableBytes * 8;
        workingBytesAvailable -= availableBytes;
      };
      this.skipBits = function(count) {
        var skipBytes;
        if (workingBitsAvailable > count) {
          workingWord <<= count;
          workingBitsAvailable -= count;
        } else {
          count -= workingBitsAvailable;
          skipBytes = Math.floor(count / 8);
          count -= skipBytes * 8;
          workingBytesAvailable -= skipBytes;
          this.loadWord();
          workingWord <<= count;
          workingBitsAvailable -= count;
        }
      };
      this.readBits = function(size) {
        var bits = Math.min(workingBitsAvailable, size), valu = workingWord >>> 32 - bits;
        workingBitsAvailable -= bits;
        if (workingBitsAvailable > 0) {
          workingWord <<= bits;
        } else if (workingBytesAvailable > 0) {
          this.loadWord();
        }
        bits = size - bits;
        if (bits > 0) {
          return valu << bits | this.readBits(bits);
        }
        return valu;
      };
      this.skipLeadingZeros = function() {
        var leadingZeroCount;
        for (leadingZeroCount = 0; leadingZeroCount < workingBitsAvailable; ++leadingZeroCount) {
          if ((workingWord & 2147483648 >>> leadingZeroCount) !== 0) {
            workingWord <<= leadingZeroCount;
            workingBitsAvailable -= leadingZeroCount;
            return leadingZeroCount;
          }
        }
        this.loadWord();
        return leadingZeroCount + this.skipLeadingZeros();
      };
      this.skipUnsignedExpGolomb = function() {
        this.skipBits(1 + this.skipLeadingZeros());
      };
      this.skipExpGolomb = function() {
        this.skipBits(1 + this.skipLeadingZeros());
      };
      this.readUnsignedExpGolomb = function() {
        var clz = this.skipLeadingZeros();
        return this.readBits(clz + 1) - 1;
      };
      this.readExpGolomb = function() {
        var valu = this.readUnsignedExpGolomb();
        if (1 & valu) {
          return 1 + valu >>> 1;
        }
        return -1 * (valu >>> 1);
      };
      this.readBoolean = function() {
        return this.readBits(1) === 1;
      };
      this.readUnsignedByte = function() {
        return this.readBits(8);
      };
      this.loadWord();
    };
    module.exports = ExpGolomb;
  }
});

// node_modules/mux.js/cjs/codecs/h264.js
var require_h264 = __commonJS({
  "node_modules/mux.js/cjs/codecs/h264.js"(exports, module) {
    "use strict";
    var Stream = require_stream();
    var ExpGolomb = require_exp_golomb();
    var _H264Stream;
    var _NalByteStream;
    var PROFILES_WITH_OPTIONAL_SPS_DATA;
    _NalByteStream = function NalByteStream() {
      var syncPoint = 0, i, buffer;
      _NalByteStream.prototype.init.call(this);
      this.push = function(data) {
        var swapBuffer;
        if (!buffer) {
          buffer = data.data;
        } else {
          swapBuffer = new Uint8Array(buffer.byteLength + data.data.byteLength);
          swapBuffer.set(buffer);
          swapBuffer.set(data.data, buffer.byteLength);
          buffer = swapBuffer;
        }
        var len = buffer.byteLength;
        for (; syncPoint < len - 3; syncPoint++) {
          if (buffer[syncPoint + 2] === 1) {
            i = syncPoint + 5;
            break;
          }
        }
        while (i < len) {
          switch (buffer[i]) {
            case 0:
              if (buffer[i - 1] !== 0) {
                i += 2;
                break;
              } else if (buffer[i - 2] !== 0) {
                i++;
                break;
              }
              if (syncPoint + 3 !== i - 2) {
                this.trigger("data", buffer.subarray(syncPoint + 3, i - 2));
              }
              do {
                i++;
              } while (buffer[i] !== 1 && i < len);
              syncPoint = i - 2;
              i += 3;
              break;
            case 1:
              if (buffer[i - 1] !== 0 || buffer[i - 2] !== 0) {
                i += 3;
                break;
              }
              this.trigger("data", buffer.subarray(syncPoint + 3, i - 2));
              syncPoint = i - 2;
              i += 3;
              break;
            default:
              i += 3;
              break;
          }
        }
        buffer = buffer.subarray(syncPoint);
        i -= syncPoint;
        syncPoint = 0;
      };
      this.reset = function() {
        buffer = null;
        syncPoint = 0;
        this.trigger("reset");
      };
      this.flush = function() {
        if (buffer && buffer.byteLength > 3) {
          this.trigger("data", buffer.subarray(syncPoint + 3));
        }
        buffer = null;
        syncPoint = 0;
        this.trigger("done");
      };
      this.endTimeline = function() {
        this.flush();
        this.trigger("endedtimeline");
      };
    };
    _NalByteStream.prototype = new Stream();
    PROFILES_WITH_OPTIONAL_SPS_DATA = {
      100: true,
      110: true,
      122: true,
      244: true,
      44: true,
      83: true,
      86: true,
      118: true,
      128: true,
      // TODO: the three profiles below don't
      // appear to have sps data in the specificiation anymore?
      138: true,
      139: true,
      134: true
    };
    _H264Stream = function H264Stream() {
      var nalByteStream = new _NalByteStream(), self, trackId, currentPts, currentDts, discardEmulationPreventionBytes, readSequenceParameterSet, skipScalingList;
      _H264Stream.prototype.init.call(this);
      self = this;
      this.push = function(packet) {
        if (packet.type !== "video") {
          return;
        }
        trackId = packet.trackId;
        currentPts = packet.pts;
        currentDts = packet.dts;
        nalByteStream.push(packet);
      };
      nalByteStream.on("data", function(data) {
        var event = {
          trackId,
          pts: currentPts,
          dts: currentDts,
          data,
          nalUnitTypeCode: data[0] & 31
        };
        switch (event.nalUnitTypeCode) {
          case 5:
            event.nalUnitType = "slice_layer_without_partitioning_rbsp_idr";
            break;
          case 6:
            event.nalUnitType = "sei_rbsp";
            event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
            break;
          case 7:
            event.nalUnitType = "seq_parameter_set_rbsp";
            event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
            event.config = readSequenceParameterSet(event.escapedRBSP);
            break;
          case 8:
            event.nalUnitType = "pic_parameter_set_rbsp";
            break;
          case 9:
            event.nalUnitType = "access_unit_delimiter_rbsp";
            break;
          default:
            break;
        }
        self.trigger("data", event);
      });
      nalByteStream.on("done", function() {
        self.trigger("done");
      });
      nalByteStream.on("partialdone", function() {
        self.trigger("partialdone");
      });
      nalByteStream.on("reset", function() {
        self.trigger("reset");
      });
      nalByteStream.on("endedtimeline", function() {
        self.trigger("endedtimeline");
      });
      this.flush = function() {
        nalByteStream.flush();
      };
      this.partialFlush = function() {
        nalByteStream.partialFlush();
      };
      this.reset = function() {
        nalByteStream.reset();
      };
      this.endTimeline = function() {
        nalByteStream.endTimeline();
      };
      skipScalingList = function skipScalingList2(count, expGolombDecoder) {
        var lastScale = 8, nextScale = 8, j, deltaScale;
        for (j = 0; j < count; j++) {
          if (nextScale !== 0) {
            deltaScale = expGolombDecoder.readExpGolomb();
            nextScale = (lastScale + deltaScale + 256) % 256;
          }
          lastScale = nextScale === 0 ? lastScale : nextScale;
        }
      };
      discardEmulationPreventionBytes = function discardEmulationPreventionBytes2(data) {
        var length = data.byteLength, emulationPreventionBytesPositions = [], i = 1, newLength, newData;
        while (i < length - 2) {
          if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 3) {
            emulationPreventionBytesPositions.push(i + 2);
            i += 2;
          } else {
            i++;
          }
        }
        if (emulationPreventionBytesPositions.length === 0) {
          return data;
        }
        newLength = length - emulationPreventionBytesPositions.length;
        newData = new Uint8Array(newLength);
        var sourceIndex = 0;
        for (i = 0; i < newLength; sourceIndex++, i++) {
          if (sourceIndex === emulationPreventionBytesPositions[0]) {
            sourceIndex++;
            emulationPreventionBytesPositions.shift();
          }
          newData[i] = data[sourceIndex];
        }
        return newData;
      };
      readSequenceParameterSet = function readSequenceParameterSet2(data) {
        var frameCropLeftOffset = 0, frameCropRightOffset = 0, frameCropTopOffset = 0, frameCropBottomOffset = 0, sarScale = 1, expGolombDecoder, profileIdc, levelIdc, profileCompatibility, chromaFormatIdc, picOrderCntType, numRefFramesInPicOrderCntCycle, picWidthInMbsMinus1, picHeightInMapUnitsMinus1, frameMbsOnlyFlag, scalingListCount, sarRatio = [1, 1], aspectRatioIdc, i;
        expGolombDecoder = new ExpGolomb(data);
        profileIdc = expGolombDecoder.readUnsignedByte();
        profileCompatibility = expGolombDecoder.readUnsignedByte();
        levelIdc = expGolombDecoder.readUnsignedByte();
        expGolombDecoder.skipUnsignedExpGolomb();
        if (PROFILES_WITH_OPTIONAL_SPS_DATA[profileIdc]) {
          chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();
          if (chromaFormatIdc === 3) {
            expGolombDecoder.skipBits(1);
          }
          expGolombDecoder.skipUnsignedExpGolomb();
          expGolombDecoder.skipUnsignedExpGolomb();
          expGolombDecoder.skipBits(1);
          if (expGolombDecoder.readBoolean()) {
            scalingListCount = chromaFormatIdc !== 3 ? 8 : 12;
            for (i = 0; i < scalingListCount; i++) {
              if (expGolombDecoder.readBoolean()) {
                if (i < 6) {
                  skipScalingList(16, expGolombDecoder);
                } else {
                  skipScalingList(64, expGolombDecoder);
                }
              }
            }
          }
        }
        expGolombDecoder.skipUnsignedExpGolomb();
        picOrderCntType = expGolombDecoder.readUnsignedExpGolomb();
        if (picOrderCntType === 0) {
          expGolombDecoder.readUnsignedExpGolomb();
        } else if (picOrderCntType === 1) {
          expGolombDecoder.skipBits(1);
          expGolombDecoder.skipExpGolomb();
          expGolombDecoder.skipExpGolomb();
          numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();
          for (i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
            expGolombDecoder.skipExpGolomb();
          }
        }
        expGolombDecoder.skipUnsignedExpGolomb();
        expGolombDecoder.skipBits(1);
        picWidthInMbsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
        picHeightInMapUnitsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
        frameMbsOnlyFlag = expGolombDecoder.readBits(1);
        if (frameMbsOnlyFlag === 0) {
          expGolombDecoder.skipBits(1);
        }
        expGolombDecoder.skipBits(1);
        if (expGolombDecoder.readBoolean()) {
          frameCropLeftOffset = expGolombDecoder.readUnsignedExpGolomb();
          frameCropRightOffset = expGolombDecoder.readUnsignedExpGolomb();
          frameCropTopOffset = expGolombDecoder.readUnsignedExpGolomb();
          frameCropBottomOffset = expGolombDecoder.readUnsignedExpGolomb();
        }
        if (expGolombDecoder.readBoolean()) {
          if (expGolombDecoder.readBoolean()) {
            aspectRatioIdc = expGolombDecoder.readUnsignedByte();
            switch (aspectRatioIdc) {
              case 1:
                sarRatio = [1, 1];
                break;
              case 2:
                sarRatio = [12, 11];
                break;
              case 3:
                sarRatio = [10, 11];
                break;
              case 4:
                sarRatio = [16, 11];
                break;
              case 5:
                sarRatio = [40, 33];
                break;
              case 6:
                sarRatio = [24, 11];
                break;
              case 7:
                sarRatio = [20, 11];
                break;
              case 8:
                sarRatio = [32, 11];
                break;
              case 9:
                sarRatio = [80, 33];
                break;
              case 10:
                sarRatio = [18, 11];
                break;
              case 11:
                sarRatio = [15, 11];
                break;
              case 12:
                sarRatio = [64, 33];
                break;
              case 13:
                sarRatio = [160, 99];
                break;
              case 14:
                sarRatio = [4, 3];
                break;
              case 15:
                sarRatio = [3, 2];
                break;
              case 16:
                sarRatio = [2, 1];
                break;
              case 255: {
                sarRatio = [expGolombDecoder.readUnsignedByte() << 8 | expGolombDecoder.readUnsignedByte(), expGolombDecoder.readUnsignedByte() << 8 | expGolombDecoder.readUnsignedByte()];
                break;
              }
            }
            if (sarRatio) {
              sarScale = sarRatio[0] / sarRatio[1];
            }
          }
        }
        return {
          profileIdc,
          levelIdc,
          profileCompatibility,
          width: (picWidthInMbsMinus1 + 1) * 16 - frameCropLeftOffset * 2 - frameCropRightOffset * 2,
          height: (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16 - frameCropTopOffset * 2 - frameCropBottomOffset * 2,
          // sar is sample aspect ratio
          sarRatio
        };
      };
    };
    _H264Stream.prototype = new Stream();
    module.exports = {
      H264Stream: _H264Stream,
      NalByteStream: _NalByteStream
    };
  }
});

// node_modules/mux.js/cjs/aac/utils.js
var require_utils = __commonJS({
  "node_modules/mux.js/cjs/aac/utils.js"(exports, module) {
    "use strict";
    var ADTS_SAMPLING_FREQUENCIES = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
    var parseId3TagSize = function parseId3TagSize2(header, byteIndex) {
      var returnSize = header[byteIndex + 6] << 21 | header[byteIndex + 7] << 14 | header[byteIndex + 8] << 7 | header[byteIndex + 9], flags = header[byteIndex + 5], footerPresent = (flags & 16) >> 4;
      returnSize = returnSize >= 0 ? returnSize : 0;
      if (footerPresent) {
        return returnSize + 20;
      }
      return returnSize + 10;
    };
    var getId3Offset = function getId3Offset2(data, offset) {
      if (data.length - offset < 10 || data[offset] !== "I".charCodeAt(0) || data[offset + 1] !== "D".charCodeAt(0) || data[offset + 2] !== "3".charCodeAt(0)) {
        return offset;
      }
      offset += parseId3TagSize(data, offset);
      return getId3Offset2(data, offset);
    };
    var isLikelyAacData = function isLikelyAacData2(data) {
      var offset = getId3Offset(data, 0);
      return data.length >= offset + 2 && (data[offset] & 255) === 255 && (data[offset + 1] & 240) === 240 && // verify that the 2 layer bits are 0, aka this
      // is not mp3 data but aac data.
      (data[offset + 1] & 22) === 16;
    };
    var parseSyncSafeInteger = function parseSyncSafeInteger2(data) {
      return data[0] << 21 | data[1] << 14 | data[2] << 7 | data[3];
    };
    var percentEncode = function percentEncode2(bytes, start, end) {
      var i, result = "";
      for (i = start; i < end; i++) {
        result += "%" + ("00" + bytes[i].toString(16)).slice(-2);
      }
      return result;
    };
    var parseIso88591 = function parseIso885912(bytes, start, end) {
      return unescape(percentEncode(bytes, start, end));
    };
    var parseAdtsSize = function parseAdtsSize2(header, byteIndex) {
      var lowThree = (header[byteIndex + 5] & 224) >> 5, middle = header[byteIndex + 4] << 3, highTwo = header[byteIndex + 3] & 3 << 11;
      return highTwo | middle | lowThree;
    };
    var parseType = function parseType2(header, byteIndex) {
      if (header[byteIndex] === "I".charCodeAt(0) && header[byteIndex + 1] === "D".charCodeAt(0) && header[byteIndex + 2] === "3".charCodeAt(0)) {
        return "timed-metadata";
      } else if (header[byteIndex] & true && (header[byteIndex + 1] & 240) === 240) {
        return "audio";
      }
      return null;
    };
    var parseSampleRate = function parseSampleRate2(packet) {
      var i = 0;
      while (i + 5 < packet.length) {
        if (packet[i] !== 255 || (packet[i + 1] & 246) !== 240) {
          i++;
          continue;
        }
        return ADTS_SAMPLING_FREQUENCIES[(packet[i + 2] & 60) >>> 2];
      }
      return null;
    };
    var parseAacTimestamp = function parseAacTimestamp2(packet) {
      var frameStart, frameSize, frame, frameHeader;
      frameStart = 10;
      if (packet[5] & 64) {
        frameStart += 4;
        frameStart += parseSyncSafeInteger(packet.subarray(10, 14));
      }
      do {
        frameSize = parseSyncSafeInteger(packet.subarray(frameStart + 4, frameStart + 8));
        if (frameSize < 1) {
          return null;
        }
        frameHeader = String.fromCharCode(packet[frameStart], packet[frameStart + 1], packet[frameStart + 2], packet[frameStart + 3]);
        if (frameHeader === "PRIV") {
          frame = packet.subarray(frameStart + 10, frameStart + frameSize + 10);
          for (var i = 0; i < frame.byteLength; i++) {
            if (frame[i] === 0) {
              var owner = parseIso88591(frame, 0, i);
              if (owner === "com.apple.streaming.transportStreamTimestamp") {
                var d = frame.subarray(i + 1);
                var size = (d[3] & 1) << 30 | d[4] << 22 | d[5] << 14 | d[6] << 6 | d[7] >>> 2;
                size *= 4;
                size += d[7] & 3;
                return size;
              }
              break;
            }
          }
        }
        frameStart += 10;
        frameStart += frameSize;
      } while (frameStart < packet.byteLength);
      return null;
    };
    module.exports = {
      isLikelyAacData,
      parseId3TagSize,
      parseAdtsSize,
      parseType,
      parseSampleRate,
      parseAacTimestamp
    };
  }
});

// node_modules/mux.js/cjs/aac/index.js
var require_aac = __commonJS({
  "node_modules/mux.js/cjs/aac/index.js"(exports, module) {
    "use strict";
    var Stream = require_stream();
    var aacUtils = require_utils();
    var _AacStream;
    _AacStream = function AacStream() {
      var everything = new Uint8Array(), timeStamp = 0;
      _AacStream.prototype.init.call(this);
      this.setTimestamp = function(timestamp) {
        timeStamp = timestamp;
      };
      this.push = function(bytes) {
        var frameSize = 0, byteIndex = 0, bytesLeft, chunk, packet, tempLength;
        if (everything.length) {
          tempLength = everything.length;
          everything = new Uint8Array(bytes.byteLength + tempLength);
          everything.set(everything.subarray(0, tempLength));
          everything.set(bytes, tempLength);
        } else {
          everything = bytes;
        }
        while (everything.length - byteIndex >= 3) {
          if (everything[byteIndex] === "I".charCodeAt(0) && everything[byteIndex + 1] === "D".charCodeAt(0) && everything[byteIndex + 2] === "3".charCodeAt(0)) {
            if (everything.length - byteIndex < 10) {
              break;
            }
            frameSize = aacUtils.parseId3TagSize(everything, byteIndex);
            if (byteIndex + frameSize > everything.length) {
              break;
            }
            chunk = {
              type: "timed-metadata",
              data: everything.subarray(byteIndex, byteIndex + frameSize)
            };
            this.trigger("data", chunk);
            byteIndex += frameSize;
            continue;
          } else if ((everything[byteIndex] & 255) === 255 && (everything[byteIndex + 1] & 240) === 240) {
            if (everything.length - byteIndex < 7) {
              break;
            }
            frameSize = aacUtils.parseAdtsSize(everything, byteIndex);
            if (byteIndex + frameSize > everything.length) {
              break;
            }
            packet = {
              type: "audio",
              data: everything.subarray(byteIndex, byteIndex + frameSize),
              pts: timeStamp,
              dts: timeStamp
            };
            this.trigger("data", packet);
            byteIndex += frameSize;
            continue;
          }
          byteIndex++;
        }
        bytesLeft = everything.length - byteIndex;
        if (bytesLeft > 0) {
          everything = everything.subarray(byteIndex);
        } else {
          everything = new Uint8Array();
        }
      };
      this.reset = function() {
        everything = new Uint8Array();
        this.trigger("reset");
      };
      this.endTimeline = function() {
        everything = new Uint8Array();
        this.trigger("endedtimeline");
      };
    };
    _AacStream.prototype = new Stream();
    module.exports = _AacStream;
  }
});

// node_modules/mux.js/cjs/constants/audio-properties.js
var require_audio_properties = __commonJS({
  "node_modules/mux.js/cjs/constants/audio-properties.js"(exports, module) {
    "use strict";
    var AUDIO_PROPERTIES = ["audioobjecttype", "channelcount", "samplerate", "samplingfrequencyindex", "samplesize"];
    module.exports = AUDIO_PROPERTIES;
  }
});

// node_modules/mux.js/cjs/constants/video-properties.js
var require_video_properties = __commonJS({
  "node_modules/mux.js/cjs/constants/video-properties.js"(exports, module) {
    "use strict";
    var VIDEO_PROPERTIES = ["width", "height", "profileIdc", "levelIdc", "profileCompatibility", "sarRatio"];
    module.exports = VIDEO_PROPERTIES;
  }
});

// node_modules/mux.js/cjs/mp4/transmuxer.js
var require_transmuxer = __commonJS({
  "node_modules/mux.js/cjs/mp4/transmuxer.js"(exports, module) {
    "use strict";
    var Stream = require_stream();
    var mp4 = require_mp4_generator();
    var frameUtils = require_frame_utils();
    var audioFrameUtils = require_audio_frame_utils();
    var trackDecodeInfo = require_track_decode_info();
    var m2ts = require_m2ts();
    var clock = require_clock();
    var AdtsStream2 = require_adts();
    var H264Stream = require_h264().H264Stream;
    var AacStream = require_aac();
    var isLikelyAacData = require_utils().isLikelyAacData;
    var ONE_SECOND_IN_TS = require_clock().ONE_SECOND_IN_TS;
    var AUDIO_PROPERTIES = require_audio_properties();
    var VIDEO_PROPERTIES = require_video_properties();
    var _VideoSegmentStream;
    var _AudioSegmentStream;
    var _Transmuxer;
    var _CoalesceStream;
    var retriggerForStream = function retriggerForStream2(key, event) {
      event.stream = key;
      this.trigger("log", event);
    };
    var addPipelineLogRetriggers = function addPipelineLogRetriggers2(transmuxer, pipeline) {
      var keys = Object.keys(pipeline);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key === "headOfPipeline" || !pipeline[key].on) {
          continue;
        }
        pipeline[key].on("log", retriggerForStream.bind(transmuxer, key));
      }
    };
    var arrayEquals = function arrayEquals2(a, b) {
      var i;
      if (a.length !== b.length) {
        return false;
      }
      for (i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          return false;
        }
      }
      return true;
    };
    var generateSegmentTimingInfo = function generateSegmentTimingInfo2(baseMediaDecodeTime, startDts, startPts, endDts, endPts, prependedContentDuration) {
      var ptsOffsetFromDts = startPts - startDts, decodeDuration = endDts - startDts, presentationDuration = endPts - startPts;
      return {
        start: {
          dts: baseMediaDecodeTime,
          pts: baseMediaDecodeTime + ptsOffsetFromDts
        },
        end: {
          dts: baseMediaDecodeTime + decodeDuration,
          pts: baseMediaDecodeTime + presentationDuration
        },
        prependedContentDuration,
        baseMediaDecodeTime
      };
    };
    _AudioSegmentStream = function AudioSegmentStream(track, options) {
      var adtsFrames = [], sequenceNumber, earliestAllowedDts = 0, audioAppendStartTs = 0, videoBaseMediaDecodeTime = Infinity;
      options = options || {};
      sequenceNumber = options.firstSequenceNumber || 0;
      _AudioSegmentStream.prototype.init.call(this);
      this.push = function(data) {
        trackDecodeInfo.collectDtsInfo(track, data);
        if (track) {
          AUDIO_PROPERTIES.forEach(function(prop) {
            track[prop] = data[prop];
          });
        }
        adtsFrames.push(data);
      };
      this.setEarliestDts = function(earliestDts) {
        earliestAllowedDts = earliestDts;
      };
      this.setVideoBaseMediaDecodeTime = function(baseMediaDecodeTime) {
        videoBaseMediaDecodeTime = baseMediaDecodeTime;
      };
      this.setAudioAppendStart = function(timestamp) {
        audioAppendStartTs = timestamp;
      };
      this.flush = function() {
        var frames, moof, mdat, boxes, frameDuration, segmentDuration, videoClockCyclesOfSilencePrefixed;
        if (adtsFrames.length === 0) {
          this.trigger("done", "AudioSegmentStream");
          return;
        }
        frames = audioFrameUtils.trimAdtsFramesByEarliestDts(adtsFrames, track, earliestAllowedDts);
        track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps);
        videoClockCyclesOfSilencePrefixed = audioFrameUtils.prefixWithSilence(track, frames, audioAppendStartTs, videoBaseMediaDecodeTime);
        track.samples = audioFrameUtils.generateSampleTable(frames);
        mdat = mp4.mdat(audioFrameUtils.concatenateFrameData(frames));
        adtsFrames = [];
        moof = mp4.moof(sequenceNumber, [track]);
        boxes = new Uint8Array(moof.byteLength + mdat.byteLength);
        sequenceNumber++;
        boxes.set(moof);
        boxes.set(mdat, moof.byteLength);
        trackDecodeInfo.clearDtsInfo(track);
        frameDuration = Math.ceil(ONE_SECOND_IN_TS * 1024 / track.samplerate);
        if (frames.length) {
          segmentDuration = frames.length * frameDuration;
          this.trigger("segmentTimingInfo", generateSegmentTimingInfo(
            // The audio track's baseMediaDecodeTime is in audio clock cycles, but the
            // frame info is in video clock cycles. Convert to match expectation of
            // listeners (that all timestamps will be based on video clock cycles).
            clock.audioTsToVideoTs(track.baseMediaDecodeTime, track.samplerate),
            // frame times are already in video clock, as is segment duration
            frames[0].dts,
            frames[0].pts,
            frames[0].dts + segmentDuration,
            frames[0].pts + segmentDuration,
            videoClockCyclesOfSilencePrefixed || 0
          ));
          this.trigger("timingInfo", {
            start: frames[0].pts,
            end: frames[0].pts + segmentDuration
          });
        }
        this.trigger("data", {
          track,
          boxes
        });
        this.trigger("done", "AudioSegmentStream");
      };
      this.reset = function() {
        trackDecodeInfo.clearDtsInfo(track);
        adtsFrames = [];
        this.trigger("reset");
      };
    };
    _AudioSegmentStream.prototype = new Stream();
    _VideoSegmentStream = function VideoSegmentStream(track, options) {
      var sequenceNumber, nalUnits = [], gopsToAlignWith = [], config, pps;
      options = options || {};
      sequenceNumber = options.firstSequenceNumber || 0;
      _VideoSegmentStream.prototype.init.call(this);
      delete track.minPTS;
      this.gopCache_ = [];
      this.push = function(nalUnit) {
        trackDecodeInfo.collectDtsInfo(track, nalUnit);
        if (nalUnit.nalUnitType === "seq_parameter_set_rbsp" && !config) {
          config = nalUnit.config;
          track.sps = [nalUnit.data];
          VIDEO_PROPERTIES.forEach(function(prop) {
            track[prop] = config[prop];
          }, this);
        }
        if (nalUnit.nalUnitType === "pic_parameter_set_rbsp" && !pps) {
          pps = nalUnit.data;
          track.pps = [nalUnit.data];
        }
        if (nalUnits.length >= 65536 || nalUnit.data.byteLength > 8388608) throw new Error("Excessive H.264 metadata or sample size.");
        nalUnits.push(nalUnit);
      };
      this.flush = function() {
        var frames, gopForFusion, gops, moof, mdat, boxes, prependedContentDuration = 0, firstGop, lastGop;
        var fluxVcl = nalUnits.findIndex(function(nal) {
          return (nal.data[0] & 31) >= 1 && (nal.data[0] & 31) <= 5;
        });
        var fluxAud = nalUnits.findIndex(function(nal) {
          return nal.nalUnitType === "access_unit_delimiter_rbsp";
        });
        if (fluxVcl >= 0 && (fluxAud < 0 || fluxAud > fluxVcl)) throw new Error("H.264 access unit boundaries are missing. This segment needs another remux workflow.");
        while (nalUnits.length) {
          if (nalUnits[0].nalUnitType === "access_unit_delimiter_rbsp") {
            break;
          }
          nalUnits.shift();
        }
        if (nalUnits.length === 0) {
          this.resetStream_();
          this.trigger("done", "VideoSegmentStream");
          return;
        }
        frames = frameUtils.groupNalsIntoFrames(nalUnits);
        gops = frameUtils.groupFramesIntoGops(frames);
        if (!gops[0][0].keyFrame) {
          throw new Error("This TS segment starts between keyframes. A continuous remux workflow is needed; no frames were discarded.");
          gopForFusion = this.getGopForFusion_(nalUnits[0], track);
          if (gopForFusion) {
            prependedContentDuration = gopForFusion.duration;
            gops.unshift(gopForFusion);
            gops.byteLength += gopForFusion.byteLength;
            gops.nalCount += gopForFusion.nalCount;
            gops.pts = gopForFusion.pts;
            gops.dts = gopForFusion.dts;
            gops.duration += gopForFusion.duration;
          } else {
            gops = frameUtils.extendFirstKeyFrame(gops);
          }
        }
        if (gopsToAlignWith.length) {
          var alignedGops;
          if (options.alignGopsAtEnd) {
            alignedGops = this.alignGopsAtEnd_(gops);
          } else {
            alignedGops = this.alignGopsAtStart_(gops);
          }
          if (!alignedGops) {
            this.gopCache_.unshift({
              gop: gops.pop(),
              pps: track.pps,
              sps: track.sps
            });
            this.gopCache_.length = Math.min(6, this.gopCache_.length);
            nalUnits = [];
            this.resetStream_();
            this.trigger("done", "VideoSegmentStream");
            return;
          }
          trackDecodeInfo.clearDtsInfo(track);
          gops = alignedGops;
        }
        trackDecodeInfo.collectDtsInfo(track, gops);
        track.samples = frameUtils.generateSampleTable(gops);
        mdat = mp4.mdat(frameUtils.concatenateNalData(gops));
        track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps);
        this.trigger("processedGopsInfo", gops.map(function(gop) {
          return {
            pts: gop.pts,
            dts: gop.dts,
            byteLength: gop.byteLength
          };
        }));
        firstGop = gops[0];
        lastGop = gops[gops.length - 1];
        this.trigger("segmentTimingInfo", generateSegmentTimingInfo(track.baseMediaDecodeTime, firstGop.dts, firstGop.pts, lastGop.dts + lastGop.duration, lastGop.pts + lastGop.duration, prependedContentDuration));
        this.trigger("timingInfo", {
          start: gops[0].pts,
          end: gops[gops.length - 1].pts + gops[gops.length - 1].duration
        });
        this.gopCache_.unshift({
          gop: gops.pop(),
          pps: track.pps,
          sps: track.sps
        });
        this.gopCache_.length = Math.min(6, this.gopCache_.length);
        nalUnits = [];
        this.trigger("baseMediaDecodeTime", track.baseMediaDecodeTime);
        this.trigger("timelineStartInfo", track.timelineStartInfo);
        moof = mp4.moof(sequenceNumber, [track]);
        boxes = new Uint8Array(moof.byteLength + mdat.byteLength);
        sequenceNumber++;
        boxes.set(moof);
        boxes.set(mdat, moof.byteLength);
        this.trigger("data", {
          track,
          boxes
        });
        this.resetStream_();
        this.trigger("done", "VideoSegmentStream");
      };
      this.reset = function() {
        this.resetStream_();
        nalUnits = [];
        this.gopCache_.length = 0;
        gopsToAlignWith.length = 0;
        this.trigger("reset");
      };
      this.resetStream_ = function() {
        trackDecodeInfo.clearDtsInfo(track);
        config = void 0;
        pps = void 0;
      };
      this.getGopForFusion_ = function(nalUnit) {
        var halfSecond = 45e3, allowableOverlap = 1e4, nearestDistance = Infinity, dtsDistance, nearestGopObj, currentGop, currentGopObj, i;
        for (i = 0; i < this.gopCache_.length; i++) {
          currentGopObj = this.gopCache_[i];
          currentGop = currentGopObj.gop;
          if (!(track.pps && arrayEquals(track.pps[0], currentGopObj.pps[0])) || !(track.sps && arrayEquals(track.sps[0], currentGopObj.sps[0]))) {
            continue;
          }
          if (currentGop.dts < track.timelineStartInfo.dts) {
            continue;
          }
          dtsDistance = nalUnit.dts - currentGop.dts - currentGop.duration;
          if (dtsDistance >= -allowableOverlap && dtsDistance <= halfSecond) {
            if (!nearestGopObj || nearestDistance > dtsDistance) {
              nearestGopObj = currentGopObj;
              nearestDistance = dtsDistance;
            }
          }
        }
        if (nearestGopObj) {
          return nearestGopObj.gop;
        }
        return null;
      };
      this.alignGopsAtStart_ = function(gops) {
        var alignIndex, gopIndex, align, gop, byteLength, nalCount, duration, alignedGops;
        byteLength = gops.byteLength;
        nalCount = gops.nalCount;
        duration = gops.duration;
        alignIndex = gopIndex = 0;
        while (alignIndex < gopsToAlignWith.length && gopIndex < gops.length) {
          align = gopsToAlignWith[alignIndex];
          gop = gops[gopIndex];
          if (align.pts === gop.pts) {
            break;
          }
          if (gop.pts > align.pts) {
            alignIndex++;
            continue;
          }
          gopIndex++;
          byteLength -= gop.byteLength;
          nalCount -= gop.nalCount;
          duration -= gop.duration;
        }
        if (gopIndex === 0) {
          return gops;
        }
        if (gopIndex === gops.length) {
          return null;
        }
        alignedGops = gops.slice(gopIndex);
        alignedGops.byteLength = byteLength;
        alignedGops.duration = duration;
        alignedGops.nalCount = nalCount;
        alignedGops.pts = alignedGops[0].pts;
        alignedGops.dts = alignedGops[0].dts;
        return alignedGops;
      };
      this.alignGopsAtEnd_ = function(gops) {
        var alignIndex, gopIndex, align, gop, alignEndIndex, matchFound;
        alignIndex = gopsToAlignWith.length - 1;
        gopIndex = gops.length - 1;
        alignEndIndex = null;
        matchFound = false;
        while (alignIndex >= 0 && gopIndex >= 0) {
          align = gopsToAlignWith[alignIndex];
          gop = gops[gopIndex];
          if (align.pts === gop.pts) {
            matchFound = true;
            break;
          }
          if (align.pts > gop.pts) {
            alignIndex--;
            continue;
          }
          if (alignIndex === gopsToAlignWith.length - 1) {
            alignEndIndex = gopIndex;
          }
          gopIndex--;
        }
        if (!matchFound && alignEndIndex === null) {
          return null;
        }
        var trimIndex;
        if (matchFound) {
          trimIndex = gopIndex;
        } else {
          trimIndex = alignEndIndex;
        }
        if (trimIndex === 0) {
          return gops;
        }
        var alignedGops = gops.slice(trimIndex);
        var metadata = alignedGops.reduce(function(total, gop2) {
          total.byteLength += gop2.byteLength;
          total.duration += gop2.duration;
          total.nalCount += gop2.nalCount;
          return total;
        }, {
          byteLength: 0,
          duration: 0,
          nalCount: 0
        });
        alignedGops.byteLength = metadata.byteLength;
        alignedGops.duration = metadata.duration;
        alignedGops.nalCount = metadata.nalCount;
        alignedGops.pts = alignedGops[0].pts;
        alignedGops.dts = alignedGops[0].dts;
        return alignedGops;
      };
      this.alignGopsWith = function(newGopsToAlignWith) {
        gopsToAlignWith = newGopsToAlignWith;
      };
    };
    _VideoSegmentStream.prototype = new Stream();
    _CoalesceStream = function CoalesceStream(options, metadataStream) {
      this.numberOfTracks = 0;
      this.metadataStream = metadataStream;
      options = options || {};
      if (typeof options.remux !== "undefined") {
        this.remuxTracks = !!options.remux;
      } else {
        this.remuxTracks = true;
      }
      if (typeof options.keepOriginalTimestamps === "boolean") {
        this.keepOriginalTimestamps = options.keepOriginalTimestamps;
      } else {
        this.keepOriginalTimestamps = false;
      }
      this.pendingTracks = [];
      this.videoTrack = null;
      this.pendingBoxes = [];
      this.pendingCaptions = [];
      this.pendingMetadata = [];
      this.pendingBytes = 0;
      this.emittedTracks = 0;
      _CoalesceStream.prototype.init.call(this);
      this.push = function(output) {
        if (output.text) {
          return this.pendingCaptions.push(output);
        }
        if (output.frames) {
          return this.pendingMetadata.push(output);
        }
        this.pendingTracks.push(output.track);
        this.pendingBytes += output.boxes.byteLength;
        if (output.track.type === "video") {
          this.videoTrack = output.track;
          this.pendingBoxes.push(output.boxes);
        }
        if (output.track.type === "audio") {
          this.audioTrack = output.track;
          this.pendingBoxes.unshift(output.boxes);
        }
      };
    };
    _CoalesceStream.prototype = new Stream();
    _CoalesceStream.prototype.flush = function(flushSource) {
      var offset = 0, event = {
        captions: [],
        captionStreams: {},
        metadata: [],
        info: {}
      }, caption, id3, initSegment, timelineStartPts = 0, i;
      if (this.pendingTracks.length < this.numberOfTracks) {
        if (flushSource !== "VideoSegmentStream" && flushSource !== "AudioSegmentStream") {
          return;
        } else if (this.remuxTracks) {
          return;
        } else if (this.pendingTracks.length === 0) {
          this.emittedTracks++;
          if (this.emittedTracks >= this.numberOfTracks) {
            this.trigger("done");
            this.emittedTracks = 0;
          }
          return;
        }
      }
      if (this.videoTrack) {
        timelineStartPts = this.videoTrack.timelineStartInfo.pts;
        VIDEO_PROPERTIES.forEach(function(prop) {
          event.info[prop] = this.videoTrack[prop];
        }, this);
      } else if (this.audioTrack) {
        timelineStartPts = this.audioTrack.timelineStartInfo.pts;
        AUDIO_PROPERTIES.forEach(function(prop) {
          event.info[prop] = this.audioTrack[prop];
        }, this);
      }
      if (this.videoTrack || this.audioTrack) {
        if (this.pendingTracks.length === 1) {
          event.type = this.pendingTracks[0].type;
        } else {
          event.type = "combined";
        }
        this.emittedTracks += this.pendingTracks.length;
        initSegment = mp4.initSegment(this.pendingTracks);
        event.initSegment = new Uint8Array(initSegment.byteLength);
        event.initSegment.set(initSegment);
        event.data = new Uint8Array(this.pendingBytes);
        for (i = 0; i < this.pendingBoxes.length; i++) {
          event.data.set(this.pendingBoxes[i], offset);
          offset += this.pendingBoxes[i].byteLength;
        }
        for (i = 0; i < this.pendingCaptions.length; i++) {
          caption = this.pendingCaptions[i];
          caption.startTime = clock.metadataTsToSeconds(caption.startPts, timelineStartPts, this.keepOriginalTimestamps);
          caption.endTime = clock.metadataTsToSeconds(caption.endPts, timelineStartPts, this.keepOriginalTimestamps);
          event.captionStreams[caption.stream] = true;
          event.captions.push(caption);
        }
        for (i = 0; i < this.pendingMetadata.length; i++) {
          id3 = this.pendingMetadata[i];
          id3.cueTime = clock.metadataTsToSeconds(id3.pts, timelineStartPts, this.keepOriginalTimestamps);
          event.metadata.push(id3);
        }
        event.metadata.dispatchType = this.metadataStream.dispatchType;
        this.pendingTracks.length = 0;
        this.videoTrack = null;
        this.pendingBoxes.length = 0;
        this.pendingCaptions.length = 0;
        this.pendingBytes = 0;
        this.pendingMetadata.length = 0;
        this.trigger("data", event);
        for (i = 0; i < event.captions.length; i++) {
          caption = event.captions[i];
          this.trigger("caption", caption);
        }
        for (i = 0; i < event.metadata.length; i++) {
          id3 = event.metadata[i];
          this.trigger("id3Frame", id3);
        }
      }
      if (this.emittedTracks >= this.numberOfTracks) {
        this.trigger("done");
        this.emittedTracks = 0;
      }
    };
    _CoalesceStream.prototype.setRemux = function(val) {
      this.remuxTracks = val;
    };
    _Transmuxer = function Transmuxer2(options) {
      var self = this, hasFlushed = true, videoTrack, audioTrack;
      _Transmuxer.prototype.init.call(this);
      options = options || {};
      this.baseMediaDecodeTime = options.baseMediaDecodeTime || 0;
      this.transmuxPipeline_ = {};
      this.setupAacPipeline = function() {
        var pipeline = {};
        this.transmuxPipeline_ = pipeline;
        pipeline.type = "aac";
        pipeline.metadataStream = new m2ts.MetadataStream();
        pipeline.aacStream = new AacStream();
        pipeline.audioTimestampRolloverStream = new m2ts.TimestampRolloverStream("audio");
        pipeline.timedMetadataTimestampRolloverStream = new m2ts.TimestampRolloverStream("timed-metadata");
        pipeline.adtsStream = new AdtsStream2();
        pipeline.coalesceStream = new _CoalesceStream(options, pipeline.metadataStream);
        pipeline.headOfPipeline = pipeline.aacStream;
        pipeline.aacStream.pipe(pipeline.audioTimestampRolloverStream).pipe(pipeline.adtsStream);
        pipeline.aacStream.pipe(pipeline.timedMetadataTimestampRolloverStream).pipe(pipeline.metadataStream).pipe(pipeline.coalesceStream);
        pipeline.metadataStream.on("timestamp", function(frame) {
          pipeline.aacStream.setTimestamp(frame.timeStamp);
        });
        pipeline.aacStream.on("data", function(data) {
          if (data.type !== "timed-metadata" && data.type !== "audio" || pipeline.audioSegmentStream) {
            return;
          }
          audioTrack = audioTrack || {
            timelineStartInfo: {
              baseMediaDecodeTime: self.baseMediaDecodeTime
            },
            codec: "adts",
            type: "audio"
          };
          pipeline.coalesceStream.numberOfTracks++;
          pipeline.audioSegmentStream = new _AudioSegmentStream(audioTrack, options);
          pipeline.audioSegmentStream.on("log", self.getLogTrigger_("audioSegmentStream"));
          pipeline.audioSegmentStream.on("timingInfo", self.trigger.bind(self, "audioTimingInfo"));
          pipeline.adtsStream.pipe(pipeline.audioSegmentStream).pipe(pipeline.coalesceStream);
          self.trigger("trackinfo", {
            hasAudio: !!audioTrack,
            hasVideo: !!videoTrack
          });
        });
        pipeline.coalesceStream.on("data", this.trigger.bind(this, "data"));
        pipeline.coalesceStream.on("done", this.trigger.bind(this, "done"));
        addPipelineLogRetriggers(this, pipeline);
      };
      this.setupTsPipeline = function() {
        var pipeline = {};
        this.transmuxPipeline_ = pipeline;
        pipeline.type = "ts";
        pipeline.metadataStream = new m2ts.MetadataStream();
        pipeline.packetStream = new m2ts.TransportPacketStream();
        pipeline.parseStream = new m2ts.TransportParseStream();
        pipeline.elementaryStream = new m2ts.ElementaryStream();
        pipeline.timestampRolloverStream = new m2ts.TimestampRolloverStream();
        pipeline.adtsStream = new AdtsStream2();
        pipeline.h264Stream = new H264Stream();
        pipeline.captionStream = new m2ts.CaptionStream(options);
        pipeline.coalesceStream = new _CoalesceStream(options, pipeline.metadataStream);
        pipeline.headOfPipeline = pipeline.packetStream;
        pipeline.packetStream.pipe(pipeline.parseStream).pipe(pipeline.elementaryStream).pipe(pipeline.timestampRolloverStream);
        pipeline.timestampRolloverStream.pipe(pipeline.h264Stream);
        pipeline.timestampRolloverStream.pipe(pipeline.adtsStream);
        pipeline.timestampRolloverStream.pipe(pipeline.metadataStream).pipe(pipeline.coalesceStream);
        pipeline.h264Stream.pipe(pipeline.captionStream).pipe(pipeline.coalesceStream);
        pipeline.elementaryStream.on("data", function(data) {
          var i;
          if (data.type === "metadata") {
            i = data.tracks.length;
            while (i--) {
              if (!videoTrack && data.tracks[i].type === "video") {
                videoTrack = data.tracks[i];
                videoTrack.timelineStartInfo.baseMediaDecodeTime = self.baseMediaDecodeTime;
              } else if (!audioTrack && data.tracks[i].type === "audio") {
                audioTrack = data.tracks[i];
                audioTrack.timelineStartInfo.baseMediaDecodeTime = self.baseMediaDecodeTime;
              }
            }
            if (videoTrack && !pipeline.videoSegmentStream) {
              pipeline.coalesceStream.numberOfTracks++;
              pipeline.videoSegmentStream = new _VideoSegmentStream(videoTrack, options);
              pipeline.videoSegmentStream.on("log", self.getLogTrigger_("videoSegmentStream"));
              pipeline.videoSegmentStream.on("timelineStartInfo", function(timelineStartInfo) {
                if (audioTrack && !options.keepOriginalTimestamps) {
                  audioTrack.timelineStartInfo = timelineStartInfo;
                  pipeline.audioSegmentStream.setEarliestDts(timelineStartInfo.dts - self.baseMediaDecodeTime);
                }
              });
              pipeline.videoSegmentStream.on("processedGopsInfo", self.trigger.bind(self, "gopInfo"));
              pipeline.videoSegmentStream.on("segmentTimingInfo", self.trigger.bind(self, "videoSegmentTimingInfo"));
              pipeline.videoSegmentStream.on("baseMediaDecodeTime", function(baseMediaDecodeTime) {
                if (audioTrack) {
                  pipeline.audioSegmentStream.setVideoBaseMediaDecodeTime(baseMediaDecodeTime);
                }
              });
              pipeline.videoSegmentStream.on("timingInfo", self.trigger.bind(self, "videoTimingInfo"));
              pipeline.h264Stream.pipe(pipeline.videoSegmentStream).pipe(pipeline.coalesceStream);
            }
            if (audioTrack && !pipeline.audioSegmentStream) {
              pipeline.coalesceStream.numberOfTracks++;
              pipeline.audioSegmentStream = new _AudioSegmentStream(audioTrack, options);
              pipeline.audioSegmentStream.on("log", self.getLogTrigger_("audioSegmentStream"));
              pipeline.audioSegmentStream.on("timingInfo", self.trigger.bind(self, "audioTimingInfo"));
              pipeline.audioSegmentStream.on("segmentTimingInfo", self.trigger.bind(self, "audioSegmentTimingInfo"));
              pipeline.adtsStream.pipe(pipeline.audioSegmentStream).pipe(pipeline.coalesceStream);
            }
            self.trigger("trackinfo", {
              hasAudio: !!audioTrack,
              hasVideo: !!videoTrack
            });
          }
        });
        pipeline.coalesceStream.on("data", this.trigger.bind(this, "data"));
        pipeline.coalesceStream.on("id3Frame", function(id3Frame) {
          id3Frame.dispatchType = pipeline.metadataStream.dispatchType;
          self.trigger("id3Frame", id3Frame);
        });
        pipeline.coalesceStream.on("caption", this.trigger.bind(this, "caption"));
        pipeline.coalesceStream.on("done", this.trigger.bind(this, "done"));
        addPipelineLogRetriggers(this, pipeline);
      };
      this.setBaseMediaDecodeTime = function(baseMediaDecodeTime) {
        var pipeline = this.transmuxPipeline_;
        if (!options.keepOriginalTimestamps) {
          this.baseMediaDecodeTime = baseMediaDecodeTime;
        }
        if (audioTrack) {
          audioTrack.timelineStartInfo.dts = void 0;
          audioTrack.timelineStartInfo.pts = void 0;
          trackDecodeInfo.clearDtsInfo(audioTrack);
          if (pipeline.audioTimestampRolloverStream) {
            pipeline.audioTimestampRolloverStream.discontinuity();
          }
        }
        if (videoTrack) {
          if (pipeline.videoSegmentStream) {
            pipeline.videoSegmentStream.gopCache_ = [];
          }
          videoTrack.timelineStartInfo.dts = void 0;
          videoTrack.timelineStartInfo.pts = void 0;
          trackDecodeInfo.clearDtsInfo(videoTrack);
          pipeline.captionStream.reset();
        }
        if (pipeline.timestampRolloverStream) {
          pipeline.timestampRolloverStream.discontinuity();
        }
      };
      this.setAudioAppendStart = function(timestamp) {
        if (audioTrack) {
          this.transmuxPipeline_.audioSegmentStream.setAudioAppendStart(timestamp);
        }
      };
      this.setRemux = function(val) {
        var pipeline = this.transmuxPipeline_;
        options.remux = val;
        if (pipeline && pipeline.coalesceStream) {
          pipeline.coalesceStream.setRemux(val);
        }
      };
      this.alignGopsWith = function(gopsToAlignWith) {
        if (videoTrack && this.transmuxPipeline_.videoSegmentStream) {
          this.transmuxPipeline_.videoSegmentStream.alignGopsWith(gopsToAlignWith);
        }
      };
      this.getLogTrigger_ = function(key) {
        var self2 = this;
        return function(event) {
          event.stream = key;
          self2.trigger("log", event);
        };
      };
      this.push = function(data) {
        if (hasFlushed) {
          var isAac = isLikelyAacData(data);
          if (isAac && this.transmuxPipeline_.type !== "aac") {
            this.setupAacPipeline();
          } else if (!isAac && this.transmuxPipeline_.type !== "ts") {
            this.setupTsPipeline();
          }
          hasFlushed = false;
        }
        this.transmuxPipeline_.headOfPipeline.push(data);
      };
      this.flush = function() {
        hasFlushed = true;
        this.transmuxPipeline_.headOfPipeline.flush();
      };
      this.endTimeline = function() {
        this.transmuxPipeline_.headOfPipeline.endTimeline();
      };
      this.reset = function() {
        if (this.transmuxPipeline_.headOfPipeline) {
          this.transmuxPipeline_.headOfPipeline.reset();
        }
      };
      this.resetCaptions = function() {
        if (this.transmuxPipeline_.captionStream) {
          this.transmuxPipeline_.captionStream.reset();
        }
      };
    };
    _Transmuxer.prototype = new Stream();
    module.exports = {
      Transmuxer: _Transmuxer,
      VideoSegmentStream: _VideoSegmentStream,
      AudioSegmentStream: _AudioSegmentStream,
      AUDIO_PROPERTIES,
      VIDEO_PROPERTIES,
      // exported for testing
      generateSegmentTimingInfo
    };
  }
});

// <stdin>
var import_transmuxer = __toESM(require_transmuxer());
var import_adts = __toESM(require_adts());
var Transmuxer = import_transmuxer.default.Transmuxer;
var export_AdtsStream = import_adts.default;
export {
  export_AdtsStream as AdtsStream,
  Transmuxer
};
