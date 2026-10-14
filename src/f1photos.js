// Driver photos from https://www.formula1.com/en/drivers
//
// These addresses were read from the live page (the <img> of every driver card) and checked:
// each loads as a 440x1265 transparent portrait. They are keyed by the driver's page name on
// formula1.com, so a driver is matched by first + last name and the table keeps working if the
// results service changes its internal driver ids.
//
// Drivers that are not listed here (reserve drivers, new team-mates) fall back to a Wikipedia
// portrait, and if that is missing too the app shows the driver's initials.
//
// NEXT SEASON / NEW DRIVER: open https://www.formula1.com/en/drivers in a desktop browser, press F12,
// open the Console, paste the one-liner from README.md ("Updating driver photos"), then replace
// the PHOTOS object below with what it printed.

const BASE =
  'https://media.formula1.com/image/upload/c_lfill,w_440/q_auto/d_common:f1:2026:fallback:driver:2026fallbackdriverright.webp/v1740000001/';

export const PHOTOS = {
  'george-russell': 'common/f1/2026/mercedes/georus01/2026mercedesgeorus01right.webp',
  'kimi-antonelli': 'common/f1/2026/mercedes/andant01/2026mercedesandant01right.webp',
  'charles-leclerc': 'common/f1/2026/ferrari/chalec01/2026ferrarichalec01right.webp',
  'lewis-hamilton': 'common/f1/2026/ferrari/lewham01/2026ferrarilewham01right.webp',
  'lando-norris': 'common/f1/2026/mclaren/lannor01/2026mclarenlannor01right.webp',
  'oscar-piastri': 'common/f1/2026/mclaren/oscpia01/2026mclarenoscpia01right.webp',
  'max-verstappen': 'common/f1/2026/redbullracing/maxver01/2026redbullracingmaxver01right.webp',
  'isack-hadjar': 'common/f1/2026/redbullracing/isahad01/2026redbullracingisahad01right.webp',
  'liam-lawson': 'common/f1/2026/racingbulls/lialaw01/2026racingbullslialaw01right.webp',
  'arvid-lindblad': 'common/f1/2026/racingbulls/arvlin01/2026racingbullsarvlin01right.webp',
  'pierre-gasly': 'common/f1/2026/alpine/piegas01/2026alpinepiegas01right.webp',
  'franco-colapinto': 'common/f1/2026/alpine/fracol01/2026alpinefracol01right.webp',
  'esteban-ocon': 'common/f1/2026/haasf1team/estoco01/2026haasf1teamestoco01right.webp',
  'oliver-bearman': 'common/f1/2026/haasf1team/olibea01/2026haasf1teamolibea01right.webp',
  'nico-hulkenberg': 'common/f1/2026/audi/nichul01/2026audinichul01right.webp',
  'gabriel-bortoleto': 'common/f1/2026/audi/gabbor01/2026audigabbor01right.webp',
  'carlos-sainz': 'common/f1/2026/williams/carsai01/2026williamscarsai01right.webp',
  'alexander-albon': 'common/f1/2026/williams/alealb01/2026williamsalealb01right.webp',
  'fernando-alonso': 'common/f1/2026/astonmartin/feralo01/2026astonmartinferalo01right.webp',
  'lance-stroll': 'common/f1/2026/astonmartin/lanstr01/2026astonmartinlanstr01right.webp',
  'sergio-perez': 'common/f1/2026/cadillac/serper01/2026cadillacserper01right.webp',
  'valtteri-bottas': 'common/f1/2026/cadillac/valbot01/2026cadillacvalbot01right.webp',
};

const plain = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .trim();

// Finds the formula1.com photo for a driver name like "Andrea Kimi Antonelli" or "Nico Hülkenberg".
// A page name ("kimi-antonelli") matches when its last part is the driver's last name and its
// first part appears somewhere in the driver's name.
export function f1PhotoFor(driverName) {
  const tokens = plain(driverName).split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1];
  for (const [slug, path] of Object.entries(PHOTOS)) {
    const parts = slug.split('-');
    if (parts[parts.length - 1] === last && tokens.includes(parts[0])) return BASE + path;
  }
  return null;
}
