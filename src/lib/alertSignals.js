// The sound and vibration of an alert (ALR-03). The sound is made with the Web Audio API, no audio files. Neither asks
// the browser for a permission; both wait until the person has used the page (browsers refuse before that and log a
// warning), and both are skipped quietly where they are not supported.

const TONES = {
  // Two short beeps for an alert, three alternating ones for an SOS: [frequency Hz, start s, length s].
  alert: [[880, 0, 0.14], [880, 0.22, 0.14]],
  sos: [[988, 0, 0.16], [784, 0.24, 0.16], [988, 0.48, 0.16]],
};
const VIBRATION = { alert: [200, 100, 200], sos: [400, 150, 400, 150, 400] };
const GAIN = 0.12;

const hasUsedPage = (nav) => (nav?.userActivation ? nav.userActivation.hasBeenActive : true);

/**
 * environment is injectable for tests: { AudioContext, navigator }. play(kind) answers { sound, vibration }:
 * whether each was started.
 */
export function createAlertSignals(environment = {}) {
  const AudioCtor = 'AudioContext' in environment ? environment.AudioContext : (globalThis.AudioContext ?? globalThis.webkitAudioContext);
  const nav = 'navigator' in environment ? environment.navigator : globalThis.navigator;
  let context = null;

  function sound(kind) {
    const tones = TONES[kind];
    if (!tones || !AudioCtor || !hasUsedPage(nav)) return false;
    try {
      context ??= new AudioCtor();
      if (context.state === 'suspended') context.resume?.().catch?.(() => {});
      const start = context.currentTime;
      for (const [frequency, offset, length] of tones) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start + offset);
        gain.gain.linearRampToValueAtTime(GAIN, start + offset + 0.02);
        gain.gain.linearRampToValueAtTime(0, start + offset + length);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + length + 0.02);
      }
      return true;
    } catch {
      return false;
    }
  }

  function vibrate(kind) {
    const pattern = VIBRATION[kind];
    if (!pattern || typeof nav?.vibrate !== 'function' || !hasUsedPage(nav)) return false;
    try {
      return nav.vibrate(pattern) !== false;
    } catch {
      return false;
    }
  }

  return { play: (kind) => ({ sound: sound(kind), vibration: vibrate(kind) }) };
}

/** The one the app uses. */
export const alertSignals = createAlertSignals();
