// The device link: what the app needs from a belt or band, whatever carries the bytes. The app only ever talks to this
// interface and decodes the notifications with lib/packets.js. sim/deviceSim.js is the one implementation now;
// a Web Bluetooth adapter can replace it without touching a screen (spec 3.1, 7.1).
import { encodeCommand } from './packets.js';

/** Notification channels, named after the characteristics of spec 7.1. */
export const CHANNEL = {
  STATUS: 'status', // belt and band Status
  FHR: 'fhr', // belt FHR Result (live windows and the summary)
  VITALS: 'vitals', // band Vitals
  SOS: 'sos', // band SOS
  STORED: 'stored', // Stored Records replay, and the end-of-replay packet
  BATTERY: 'battery', // Battery Level (0x2A19): one byte, 0 to 100
  CONNECTION: 'connection', // the link came up or dropped: { connected }
};

/**
 * An adapter moves bytes: connect(serial), disconnect(serial), isConnected(serial), write(serial, bytes) to the
 * Control characteristic, and onNotification(listener), which receives { serial, device, channel, data } and returns
 * a function that stops listening.
 */
export const ADAPTER_METHODS = ['connect', 'disconnect', 'isConnected', 'write', 'onNotification'];

/** The named commands of spec 7.3 on top of an adapter. */
export function createDeviceLink(adapter) {
  for (const name of ADAPTER_METHODS) {
    if (typeof adapter[name] !== 'function') throw new TypeError(`A device adapter needs a ${name} method`);
  }
  const command = (name) => (serial, argument) => adapter.write(serial, encodeCommand(name, argument));
  return {
    connect: (serial) => adapter.connect(serial),
    disconnect: (serial) => adapter.disconnect(serial),
    isConnected: (serial) => adapter.isConnected(serial),
    startCheck: command('START_CHECK'), // (serial, durationS): a belt check, or a band burst
    stop: command('STOP'),
    timeSync: command('TIME_SYNC'), // (serial, unixSeconds)
    requestStored: command('REQUEST_STORED'), // (serial, fromSeq)
    ackStored: command('ACK_STORED'), // (serial, upToSeq)
    identify: command('IDENTIFY'),
    ackSos: command('ACK_SOS'), // (serial, seq)
    onNotification: (listener) => adapter.onNotification(listener),
  };
}
