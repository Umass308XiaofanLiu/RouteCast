// presets.js — demo trips. Departure is a local wall-clock time in the origin's zone,
// on the next calendar day (computed at runtime) unless a snapshot date is used.
export const PLACES = {
  amherst: { id: 'amherst', name: 'Amherst', state: 'MA', label: 'Amherst, MA', lat: 42.3732, lon: -72.5199, timezone: 'America/New_York' },
  chicago: { id: 'chicago', name: 'Chicago', state: 'IL', label: 'Chicago, IL', lat: 41.8781, lon: -87.6298, timezone: 'America/Chicago' },
  nyc: { id: 'nyc', name: 'New York', state: 'NY', label: 'New York, NY', lat: 40.7128, lon: -74.006, timezone: 'America/New_York' },
  albany: { id: 'albany', name: 'Albany', state: 'NY', label: 'Albany, NY', lat: 42.6526, lon: -73.7562, timezone: 'America/New_York' },
  boston: { id: 'boston', name: 'Boston', state: 'MA', label: 'Boston, MA', lat: 42.3601, lon: -71.0589, timezone: 'America/New_York' },
};

export const PRESETS = [
  { id: 'chicago-sunset', title: 'Amherst → Chicago', subtitle: 'Westbound into the sunset', origin: 'amherst', dest: 'chicago', hour: 8, minute: 0, snapshot: 'amherst-chicago.json' },
  { id: 'boston-sunrise', title: 'Albany → Boston', subtitle: 'Eastbound into the sunrise', origin: 'albany', dest: 'boston', hour: 6, minute: 45, snapshot: 'albany-boston.json' },
  { id: 'nyc-evening', title: 'Amherst → New York', subtitle: 'Afternoon run south', origin: 'amherst', dest: 'nyc', hour: 15, minute: 30, snapshot: 'amherst-nyc.json' },
];
