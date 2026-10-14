// Teams for the "favorite team" feature. Logos, car images and race photos are linked from
// formula1.com's image server (media.formula1.com), like the driver photos and track maps.
// Re-check the lists at the start of a season: https://www.formula1.com/en/teams
const MEDIA = 'https://media.formula1.com/image/upload/';
const V = 'v1740000001/';

// folder = the directory name formula1.com uses for the team's images
// drivers = last names (lower case, no accents) used to find the team's drivers in the drivers list
// photos  = race-weekend photos from the team's page on formula1.com
const TEAMS = [
  { slug: 'mercedes', name: 'Mercedes', folder: 'mercedes', color: '#27F4D2', drivers: ['russell', 'antonelli'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268554779.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268571554.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Australia___Qualifying/2265209242.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan/2268884816.webp'] },
  { slug: 'ferrari', name: 'Ferrari', folder: 'ferrari', color: '#E80020', drivers: ['leclerc', 'hamilton'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268572376.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_China___Sprint__Qualifying/2266430502.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268577899.webp',
    'trackside-images/2026/Formula_1_Testing_in_Bahrain___Day_3/2262590967.webp'] },
  { slug: 'mclaren', name: 'McLaren', folder: 'mclaren', color: '#FF8000', drivers: ['norris', 'piastri'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Qualifying/2268737809.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Previews/2268386179.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268566614.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_China___Sprint__Qualifying/2266430496.webp'] },
  { slug: 'red-bull-racing', name: 'Red Bull Racing', folder: 'redbullracing', color: '#3671C6', drivers: ['verstappen', 'hadjar'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Qualifying/2268728198.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Previews/2268393761.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Qualifying/2268725259.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_China___Sprint__Qualifying/2266407902.webp'] },
  { slug: 'racing-bulls', name: 'Racing Bulls', folder: 'racingbulls', color: '#6692FF', drivers: ['lawson', 'lindblad'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268544506.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Qualifying/2268740686.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_China___Sprint__Qualifying/2266421433.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_China/2266576203.webp'] },
  { slug: 'alpine', name: 'Alpine', folder: 'alpine', color: '#FF87BC', drivers: ['gasly', 'colapinto'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Australia/2265359570.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268571549.webp',
    'trackside-images/2026/Formula_1_Testing_in_Bahrain___Day_2/2262423826.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268566310.webp'] },
  { slug: 'haas', name: 'Haas F1 Team', folder: 'haasf1team', color: '#B6BABD', drivers: ['ocon', 'bearman'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Japan/2268876176.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_China___Sprint__Qualifying/2266430506.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Australia___Practice/2265040425.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Australia___Qualifying/2265209293.webp'] },
  { slug: 'audi', name: 'Audi', folder: 'audi', color: '#F50537', drivers: ['hulkenberg', 'bortoleto'], photos: [
    'trackside-images/2026/Formula_1_Testing_in_Bahrain___Day_1/2262310040.webp',
    'trackside-images/2026/Formula_1_Testing_in_Bahrain___Day_2/2262497656.webp',
    'trackside-images/2026/Formula_1_Testing_in_Bahrain___Day_3/2262603158.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Practice/2268570436.webp'] },
  { slug: 'williams', name: 'Williams', folder: 'williams', color: '#64C4FF', drivers: ['sainz', 'albon'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Japan/2268884877.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Qualifying/2268737625.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Previews/2268389856.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan/2268874944.webp'] },
  { slug: 'aston-martin', name: 'Aston Martin', folder: 'astonmartin', color: '#229971', drivers: ['alonso', 'stroll'], photos: [
    'trackside-images/2026/F1_Grand_Prix_Of_Japan___Qualifying/2268728398.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_China___Practice__Sprint_Qualifying/2266273831.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Japan/2268856846.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Australia___Practice/2265040423.webp'] },
  { slug: 'cadillac', name: 'Cadillac', folder: 'cadillac', color: '#AAAAAD', drivers: ['perez', 'bottas'], photos: [
    'trackside-images/2026/Formula_1_Testing_in_Bahrain___Day_3/2262604512.webp',
    'trackside-images/2026/Formula_1_Testing_in_Bahrain___Day_2/2261277576.webp',
    'trackside-images/2026/Formula_1_Testing_in_Bahrain___Day_2/2262433021.webp',
    'trackside-images/2026/F1_Grand_Prix_Of_Singapore/2299656194.webp'] },
];

export const TEAM_SLUGS = new Set(TEAMS.map((t) => t.slug));

export function teamsForClient() {
  return TEAMS.map((t) => ({
    slug: t.slug,
    name: t.name,
    color: t.color,
    drivers: t.drivers,
    url: `https://www.formula1.com/en/teams/${t.slug}`,
    logo: `${MEDIA}c_fit,h_96/q_auto/${V}common/f1/2026/${t.folder}/2026${t.folder}logowhite.webp`,
    car: `${MEDIA}c_lfill,w_720/q_auto/${V}common/f1/2026/${t.folder}/2026${t.folder}carright.webp`,
    photos: t.photos.map((p) => `${MEDIA}t_16by9Centre/c_fill,w_352/q_auto/${V}${p}`),
  }));
}
