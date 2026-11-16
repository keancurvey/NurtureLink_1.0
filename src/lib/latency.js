// Short artificial latency (250 to 700 ms) so loading, success and error states look like a real network.
export const LATENCY_MS = { min: 250, max: 700 };

/** A wait between the minimum and the maximum, from a random number between 0 and 1. */
export function latencyMs(random = Math.random) {
  return Math.round(LATENCY_MS.min + random() * (LATENCY_MS.max - LATENCY_MS.min));
}

export function latency(random = Math.random) {
  return new Promise((resolve) => {
    setTimeout(resolve, latencyMs(random));
  });
}
