// Circuit maps from the race pages on formula1.com (https://www.formula1.com/en/racing/2026/<race>).
//
// Each race page has a CIRCUIT section with a track map. The file names below were read from
// the 23 race pages and every image was checked: all load as 1252x704 transparent drawings.
// They are keyed by the circuit id of the results service (the same ids the calendar import
// stores), so the right map follows the right track even if the calendar changes.
//
// The maps are shown in black and white by the web page (style.css, class .track).
// A circuit that is not listed here simply shows a chequered-flag placeholder.
//
// NEXT SEASON / NEW TRACK: see "Updating track maps" in README.md.

const BASE = 'https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/2026/track/';

export const TRACKS = {
  albert_park: '2026trackmelbournedetailed.webp',  // /en/racing/2026/australia
  shanghai: '2026trackshanghaidetailed.webp',  // /en/racing/2026/china
  suzuka: '2026tracksuzukadetailed.webp',  // /en/racing/2026/japan
  miami: '2026trackmiamidetailed.webp',  // /en/racing/2026/miami
  villeneuve: '2026trackmontrealdetailed.webp',  // /en/racing/2026/canada
  monaco: '2026trackmontecarlodetailed.webp',  // /en/racing/2026/monaco
  catalunya: '2026trackcatalunyadetailed.webp',  // /en/racing/2026/barcelona-catalunya
  red_bull_ring: '2026trackspielbergdetailed.webp',  // /en/racing/2026/austria
  silverstone: '2026tracksilverstonedetailed.webp',  // /en/racing/2026/great-britain
  spa: '2026trackspafrancorchampsdetailed.webp',  // /en/racing/2026/belgium
  hungaroring: '2026trackhungaroringdetailed.webp',  // /en/racing/2026/hungary
  zandvoort: '2026trackzandvoortdetailed.webp',  // /en/racing/2026/netherlands
  monza: '2026trackmonzadetailed.webp',  // /en/racing/2026/italy
  madring: '2026trackmadringdetailed.webp',  // /en/racing/2026/spain
  baku: '2026trackbakudetailed.webp',  // /en/racing/2026/azerbaijan
  sepang: '2026trackkualalumpurdetailed.webp',  // /en/racing/2026/bahrain
  marina_bay: '2026tracksingaporedetailed.webp',  // /en/racing/2026/singapore
  americas: '2026trackaustindetailed.webp',  // /en/racing/2026/united-states
  rodriguez: '2026trackmexicocitydetailed.webp',  // /en/racing/2026/mexico
  interlagos: '2026trackinterlagosdetailed.webp',  // /en/racing/2026/brazil
  vegas: '2026tracklasvegasdetailed.webp',  // /en/racing/2026/las-vegas
  losail: '2026tracklusaildetailed.webp',  // /en/racing/2026/qatar
  yas_marina: '2026trackyasmarinacircuitdetailed.webp',  // /en/racing/2026/united-arab-emirates
};

export function f1TrackFor(circuitId) {
  const file = TRACKS[circuitId];
  return file ? BASE + file : null;
}
