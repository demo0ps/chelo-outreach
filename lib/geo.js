'use strict';
// v69: offline South African gazetteer + distance helpers. Schools carry GPS from the DBE list; suppliers give a town
// (and optionally their phone's GPS). No external geocoder is called — a supplier in a town we do not know falls back
// to the centre of their province and is only reached in the province-wide wave.

const PROVINCE_CENTRES = {
  'Eastern Cape': [-32.3, 26.4], 'Free State': [-28.5, 26.8], 'Gauteng': [-26.1, 28.1], 'KwaZulu-Natal': [-29.0, 30.9], 'Limpopo': [-23.9, 29.5],
  'Mpumalanga': [-25.8, 30.3], 'North West': [-26.2, 25.8], 'Northern Cape': [-29.0, 22.0], 'Western Cape': [-33.3, 20.5]
};

// name, province, lat, lng. Centre of town, good to a few km — fine for 25/75 km rings.
const TOWNS = [
  ['Johannesburg', 'Gauteng', -26.2041, 28.0473], ['Soweto', 'Gauteng', -26.2678, 27.8585], ['Sandton', 'Gauteng', -26.1076, 28.0567], ['Randburg', 'Gauteng', -26.0936, 27.9931], ['Roodepoort', 'Gauteng', -26.1625, 27.8725],
  ['Midrand', 'Gauteng', -25.9992, 28.1263], ['Pretoria', 'Gauteng', -25.7479, 28.2293], ['Tshwane', 'Gauteng', -25.7479, 28.2293], ['Centurion', 'Gauteng', -25.8603, 28.1894], ['Mamelodi', 'Gauteng', -25.7069, 28.3800],
  ['Soshanguve', 'Gauteng', -25.5247, 28.1036], ['Ga-Rankuwa', 'Gauteng', -25.6167, 27.9833], ['Atteridgeville', 'Gauteng', -25.7667, 28.0667], ['Tembisa', 'Gauteng', -25.9964, 28.2268], ['Kempton Park', 'Gauteng', -26.1000, 28.2333],
  ['Benoni', 'Gauteng', -26.1885, 28.3208], ['Boksburg', 'Gauteng', -26.2125, 28.2625], ['Germiston', 'Gauteng', -26.2178, 28.1672], ['Alberton', 'Gauteng', -26.2672, 28.1219], ['Springs', 'Gauteng', -26.2500, 28.4000],
  ['Brakpan', 'Gauteng', -26.2366, 28.3700], ['Daveyton', 'Gauteng', -26.1500, 28.4167], ['Katlehong', 'Gauteng', -26.3333, 28.1500], ['Vosloorus', 'Gauteng', -26.3500, 28.2000], ['Thokoza', 'Gauteng', -26.3333, 28.1333],
  ['Krugersdorp', 'Gauteng', -26.0856, 27.7717], ['Randfontein', 'Gauteng', -26.1800, 27.7000], ['Westonaria', 'Gauteng', -26.3167, 27.6500], ['Carletonville', 'Gauteng', -26.3600, 27.3980], ['Vereeniging', 'Gauteng', -26.6731, 27.9261],
  ['Vanderbijlpark', 'Gauteng', -26.7033, 27.8378], ['Sebokeng', 'Gauteng', -26.5833, 27.8333], ['Evaton', 'Gauteng', -26.5333, 27.8500], ['Meyerton', 'Gauteng', -26.5581, 28.0197], ['Heidelberg', 'Gauteng', -26.5047, 28.3594],
  ['Bronkhorstspruit', 'Gauteng', -25.8100, 28.7400], ['Cullinan', 'Gauteng', -25.6736, 28.5192], ['Diepsloot', 'Gauteng', -25.9333, 28.0167], ['Alexandra', 'Gauteng', -26.1036, 28.0994], ['Orange Farm', 'Gauteng', -26.4833, 27.8500],
  ['Durban', 'KwaZulu-Natal', -29.8587, 31.0218], ['Umlazi', 'KwaZulu-Natal', -29.9667, 30.8833], ['KwaMashu', 'KwaZulu-Natal', -29.7333, 30.9833], ['Phoenix', 'KwaZulu-Natal', -29.7000, 31.0167], ['Pinetown', 'KwaZulu-Natal', -29.8167, 30.8500],
  ['Chatsworth', 'KwaZulu-Natal', -29.9167, 30.8833], ['Inanda', 'KwaZulu-Natal', -29.7000, 30.9333], ['Pietermaritzburg', 'KwaZulu-Natal', -29.6006, 30.3794], ['Edendale', 'KwaZulu-Natal', -29.6500, 30.3000], ['Howick', 'KwaZulu-Natal', -29.4833, 30.2333],
  ['Richards Bay', 'KwaZulu-Natal', -28.7830, 32.0377], ['Empangeni', 'KwaZulu-Natal', -28.7500, 31.9000], ['Eshowe', 'KwaZulu-Natal', -28.8833, 31.4667], ['Ulundi', 'KwaZulu-Natal', -28.3167, 31.4167], ['Nongoma', 'KwaZulu-Natal', -27.9000, 31.6500],
  ['Vryheid', 'KwaZulu-Natal', -27.7694, 30.7914], ['Newcastle', 'KwaZulu-Natal', -27.7577, 29.9318], ['Madadeni', 'KwaZulu-Natal', -27.7500, 30.0500], ['Dundee', 'KwaZulu-Natal', -28.1667, 30.2333], ['Ladysmith', 'KwaZulu-Natal', -28.5597, 29.7806],
  ['Estcourt', 'KwaZulu-Natal', -29.0100, 29.8700], ['Mooi River', 'KwaZulu-Natal', -29.2167, 29.9833], ['Kokstad', 'KwaZulu-Natal', -30.5500, 29.4167], ['Port Shepstone', 'KwaZulu-Natal', -30.7414, 30.4550], ['Margate', 'KwaZulu-Natal', -30.8600, 30.3700],
  ['Scottburgh', 'KwaZulu-Natal', -30.2867, 30.7533], ['Stanger', 'KwaZulu-Natal', -29.3333, 31.2833], ['KwaDukuza', 'KwaZulu-Natal', -29.3333, 31.2833], ['Ballito', 'KwaZulu-Natal', -29.5389, 31.2144], ['Mtubatuba', 'KwaZulu-Natal', -28.4167, 32.1833],
  ['Jozini', 'KwaZulu-Natal', -27.4333, 32.0667], ['Greytown', 'KwaZulu-Natal', -29.0667, 30.5833], ['Ixopo', 'KwaZulu-Natal', -30.1500, 30.0500], ['Harding', 'KwaZulu-Natal', -30.5833, 29.8833], ['Bergville', 'KwaZulu-Natal', -28.7333, 29.3500],
  ['Cape Town', 'Western Cape', -33.9249, 18.4241], ['Khayelitsha', 'Western Cape', -34.0400, 18.6800], ['Mitchells Plain', 'Western Cape', -34.0500, 18.6200], ['Bellville', 'Western Cape', -33.9000, 18.6333], ['Kuils River', 'Western Cape', -33.9333, 18.6833],
  ['Gugulethu', 'Western Cape', -33.9833, 18.5667], ['Nyanga', 'Western Cape', -33.9833, 18.5833], ['Philippi', 'Western Cape', -34.0167, 18.5667], ['Athlone', 'Western Cape', -33.9667, 18.5000], ['Wynberg', 'Western Cape', -34.0000, 18.4667],
  ['Somerset West', 'Western Cape', -34.0833, 18.8500], ['Strand', 'Western Cape', -34.1167, 18.8333], ['Stellenbosch', 'Western Cape', -33.9321, 18.8602], ['Paarl', 'Western Cape', -33.7342, 18.9621], ['Wellington', 'Western Cape', -33.6400, 19.0100],
  ['Malmesbury', 'Western Cape', -33.4600, 18.7300], ['Atlantis', 'Western Cape', -33.5667, 18.4833], ['Worcester', 'Western Cape', -33.6464, 19.4486], ['Robertson', 'Western Cape', -33.8000, 19.8833], ['Caledon', 'Western Cape', -34.2333, 19.4167],
  ['Hermanus', 'Western Cape', -34.4187, 19.2345], ['Grabouw', 'Western Cape', -34.1500, 19.0167], ['Swellendam', 'Western Cape', -34.0167, 20.4333], ['Mossel Bay', 'Western Cape', -34.1833, 22.1333], ['George', 'Western Cape', -33.9630, 22.4617],
  ['Knysna', 'Western Cape', -34.0356, 23.0489], ['Plettenberg Bay', 'Western Cape', -34.0527, 23.3716], ['Oudtshoorn', 'Western Cape', -33.5906, 22.2014], ['Beaufort West', 'Western Cape', -32.3567, 22.5833], ['Vredenburg', 'Western Cape', -32.9000, 17.9833],
  ['Saldanha', 'Western Cape', -33.0117, 17.9442], ['Vredendal', 'Western Cape', -31.6667, 18.5000], ['Ceres', 'Western Cape', -33.3667, 19.3167], ['Riversdale', 'Western Cape', -34.0833, 21.2500], ['Bredasdorp', 'Western Cape', -34.5333, 20.0333],
  ['Gqeberha', 'Eastern Cape', -33.9608, 25.6022], ['Port Elizabeth', 'Eastern Cape', -33.9608, 25.6022], ['Motherwell', 'Eastern Cape', -33.7833, 25.6000], ['Kariega', 'Eastern Cape', -33.7667, 25.4000], ['Uitenhage', 'Eastern Cape', -33.7667, 25.4000],
  ['Despatch', 'Eastern Cape', -33.8000, 25.4667], ['East London', 'Eastern Cape', -33.0153, 27.9116], ['Mdantsane', 'Eastern Cape', -32.9500, 27.7667], ['Qonce', 'Eastern Cape', -32.8833, 27.4000], ['King William\'s Town', 'Eastern Cape', -32.8833, 27.4000],
  ['Bhisho', 'Eastern Cape', -32.8494, 27.4422], ['Mthatha', 'Eastern Cape', -31.5889, 28.7844], ['Umtata', 'Eastern Cape', -31.5889, 28.7844], ['Butterworth', 'Eastern Cape', -32.3333, 28.1500], ['Idutywa', 'Eastern Cape', -32.1000, 28.3167],
  ['Lusikisiki', 'Eastern Cape', -31.3667, 29.5667], ['Port St Johns', 'Eastern Cape', -31.6333, 29.5333], ['Mount Frere', 'Eastern Cape', -30.9000, 28.9833], ['Mount Ayliff', 'Eastern Cape', -30.8167, 29.3667], ['Bizana', 'Eastern Cape', -30.8500, 29.8500],
  ['Flagstaff', 'Eastern Cape', -31.0833, 29.4833], ['Ngcobo', 'Eastern Cape', -31.6833, 27.9833], ['Engcobo', 'Eastern Cape', -31.6833, 27.9833], ['Cofimvaba', 'Eastern Cape', -32.0000, 27.5833], ['Queenstown', 'Eastern Cape', -31.8976, 26.8753],
  ['Komani', 'Eastern Cape', -31.8976, 26.8753], ['Cradock', 'Eastern Cape', -32.1667, 25.6167], ['Graaff-Reinet', 'Eastern Cape', -32.2522, 24.5308], ['Makhanda', 'Eastern Cape', -33.3042, 26.5328], ['Grahamstown', 'Eastern Cape', -33.3042, 26.5328],
  ['Alice', 'Eastern Cape', -32.7833, 26.8333], ['Fort Beaufort', 'Eastern Cape', -32.7833, 26.6333], ['Aliwal North', 'Eastern Cape', -30.6944, 26.7111], ['Sterkspruit', 'Eastern Cape', -30.5333, 27.3667], ['Elliot', 'Eastern Cape', -31.3333, 27.8500],
  ['Matatiele', 'Eastern Cape', -30.3333, 28.8167], ['Jeffreys Bay', 'Eastern Cape', -34.0500, 24.9167], ['Humansdorp', 'Eastern Cape', -34.0333, 24.7667], ['Willowvale', 'Eastern Cape', -32.2667, 28.5000], ['Tsolo', 'Eastern Cape', -31.3167, 28.7500],
  ['Bloemfontein', 'Free State', -29.0852, 26.1596], ['Mangaung', 'Free State', -29.1211, 26.2140], ['Botshabelo', 'Free State', -29.2500, 26.7167], ['Thaba Nchu', 'Free State', -29.2167, 26.8333], ['Welkom', 'Free State', -27.9770, 26.7350],
  ['Thabong', 'Free State', -27.9833, 26.7833], ['Virginia', 'Free State', -28.1000, 26.8667], ['Odendaalsrus', 'Free State', -27.8667, 26.6833], ['Kroonstad', 'Free State', -27.6500, 27.2333], ['Sasolburg', 'Free State', -26.8136, 27.8167],
  ['Parys', 'Free State', -26.9000, 27.4500], ['Bethlehem', 'Free State', -28.2333, 28.3000], ['Harrismith', 'Free State', -28.2667, 29.1333], ['Phuthaditjhaba', 'Free State', -28.5167, 28.8167], ['QwaQwa', 'Free State', -28.5167, 28.8167],
  ['Ficksburg', 'Free State', -28.8667, 27.8667], ['Ladybrand', 'Free State', -29.2000, 27.4500], ['Bothaville', 'Free State', -27.3833, 26.6167], ['Senekal', 'Free State', -28.3167, 27.6167], ['Frankfort', 'Free State', -27.2833, 28.5000],
  ['Polokwane', 'Limpopo', -23.9045, 29.4689], ['Pietersburg', 'Limpopo', -23.9045, 29.4689], ['Seshego', 'Limpopo', -23.8500, 29.3833], ['Mankweng', 'Limpopo', -23.8833, 29.7333], ['Lebowakgomo', 'Limpopo', -24.3000, 29.5000],
  ['Mokopane', 'Limpopo', -24.1944, 29.0097], ['Potgietersrus', 'Limpopo', -24.1944, 29.0097], ['Modimolle', 'Limpopo', -24.7000, 28.4000], ['Bela-Bela', 'Limpopo', -24.8833, 28.2833], ['Lephalale', 'Limpopo', -23.6667, 27.7500],
  ['Thohoyandou', 'Limpopo', -22.9500, 30.4833], ['Louis Trichardt', 'Limpopo', -23.0500, 29.9000], ['Makhado', 'Limpopo', -23.0500, 29.9000], ['Musina', 'Limpopo', -22.3500, 30.0333], ['Sibasa', 'Limpopo', -22.9500, 30.4667],
  ['Giyani', 'Limpopo', -23.3000, 30.7167], ['Tzaneen', 'Limpopo', -23.8333, 30.1667], ['Nkowankowa', 'Limpopo', -23.8833, 30.2833], ['Phalaborwa', 'Limpopo', -23.9333, 31.1167], ['Bochum', 'Limpopo', -23.2833, 29.1333],
  ['Burgersfort', 'Limpopo', -24.6833, 30.3333], ['Jane Furse', 'Limpopo', -24.7667, 29.8333], ['Groblersdal', 'Limpopo', -25.1667, 29.4000], ['Marble Hall', 'Limpopo', -24.9667, 29.3000], ['Elim', 'Limpopo', -23.1667, 30.0500],
  ['Mbombela', 'Mpumalanga', -25.4753, 30.9694], ['Nelspruit', 'Mpumalanga', -25.4753, 30.9694], ['KaNyamazane', 'Mpumalanga', -25.4500, 31.1500], ['White River', 'Mpumalanga', -25.3333, 31.0167], ['Hazyview', 'Mpumalanga', -25.0500, 31.1167],
  ['Bushbuckridge', 'Mpumalanga', -24.8333, 31.0667], ['Acornhoek', 'Mpumalanga', -24.6000, 31.0833], ['Barberton', 'Mpumalanga', -25.7833, 31.0500], ['Malelane', 'Mpumalanga', -25.4833, 31.5167], ['Komatipoort', 'Mpumalanga', -25.4333, 31.9500],
  ['Emalahleni', 'Mpumalanga', -25.8667, 29.2333], ['Witbank', 'Mpumalanga', -25.8667, 29.2333], ['Middelburg', 'Mpumalanga', -25.7750, 29.4650], ['Secunda', 'Mpumalanga', -26.5167, 29.2000], ['Embalenhle', 'Mpumalanga', -26.5333, 29.0833],
  ['Ermelo', 'Mpumalanga', -26.5333, 29.9833], ['Standerton', 'Mpumalanga', -26.9500, 29.2500], ['Bethal', 'Mpumalanga', -26.4500, 29.4667], ['Piet Retief', 'Mpumalanga', -27.0000, 30.8000], ['Lydenburg', 'Mpumalanga', -25.1000, 30.4667],
  ['Mashishing', 'Mpumalanga', -25.1000, 30.4667], ['KwaMhlanga', 'Mpumalanga', -25.4333, 28.7000], ['Siyabuswa', 'Mpumalanga', -25.1167, 29.0500], ['Delmas', 'Mpumalanga', -26.1500, 28.6833], ['Volksrust', 'Mpumalanga', -27.3667, 29.8833],
  ['Mahikeng', 'North West', -25.8652, 25.6442], ['Mafikeng', 'North West', -25.8652, 25.6442], ['Mmabatho', 'North West', -25.8500, 25.6333], ['Rustenburg', 'North West', -25.6667, 27.2422], ['Phokeng', 'North West', -25.5833, 27.1333],
  ['Brits', 'North West', -25.6333, 27.7833], ['Klerksdorp', 'North West', -26.8667, 26.6667], ['Jouberton', 'North West', -26.9000, 26.6000], ['Potchefstroom', 'North West', -26.7167, 27.1000], ['Ikageng', 'North West', -26.7333, 27.0500],
  ['Orkney', 'North West', -26.9833, 26.6833], ['Stilfontein', 'North West', -26.8500, 26.7667], ['Lichtenburg', 'North West', -26.1500, 26.1667], ['Zeerust', 'North West', -25.5333, 26.0833], ['Vryburg', 'North West', -26.9500, 24.7333],
  ['Taung', 'North West', -27.5333, 24.7833], ['Ganyesa', 'North West', -26.5833, 24.1667], ['Mogwase', 'North West', -25.2667, 27.2167], ['Koster', 'North West', -25.8667, 26.9000], ['Wolmaransstad', 'North West', -27.2000, 25.9833],
  ['Kimberley', 'Northern Cape', -28.7282, 24.7499], ['Galeshewe', 'Northern Cape', -28.7167, 24.7333], ['Upington', 'Northern Cape', -28.4478, 21.2561], ['Kuruman', 'Northern Cape', -27.4500, 23.4333], ['Kathu', 'Northern Cape', -27.7000, 23.0500],
  ['Springbok', 'Northern Cape', -29.6667, 17.8833], ['De Aar', 'Northern Cape', -30.6500, 24.0167], ['Colesberg', 'Northern Cape', -30.7167, 25.1000], ['Postmasburg', 'Northern Cape', -28.3333, 23.0667], ['Calvinia', 'Northern Cape', -31.4667, 19.7667],
  ['Douglas', 'Northern Cape', -29.0500, 23.7667], ['Prieska', 'Northern Cape', -29.6667, 22.7500], ['Warrenton', 'Northern Cape', -28.1167, 24.8500], ['Jan Kempdorp', 'Northern Cape', -27.9167, 24.8333], ['Port Nolloth', 'Northern Cape', -29.2500, 16.8667]
];

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const INDEX = new Map(TOWNS.map(t => [norm(t[0]), t]));

/** Town (+ province hint) → { lat, lng, town, province, precision: 'town' | 'province' | '' }. */
function geocodeTown(town, province = '') {
  const key = norm(town);
  if (key) {
    const hit = INDEX.get(key) || TOWNS.find(t => norm(t[0]).startsWith(key) && key.length >= 4) || TOWNS.find(t => key.includes(norm(t[0])) && norm(t[0]).length >= 5);
    if (hit) return { lat: hit[2], lng: hit[3], town: hit[0], province: hit[1], precision: 'town' };
  }
  const c = PROVINCE_CENTRES[province];
  if (c) return { lat: c[0], lng: c[1], town: String(town || '').trim(), province, precision: 'province' };
  return { lat: null, lng: null, town: String(town || '').trim(), province, precision: '' };
}

function inSouthAfrica(lat, lng) { return Number.isFinite(lat) && Number.isFinite(lng) && lat <= -22 && lat >= -35 && lng >= 16 && lng <= 33.5; }

function distanceKm(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Nearest known town to a point — used to describe where a job was ("near Tzaneen"). */
function nearestTown(point) {
  if (!point || !Number.isFinite(point.lat)) return '';
  let best = null, bestD = Infinity;
  for (const t of TOWNS) { const d = distanceKm(point, { lat: t[2], lng: t[3] }); if (d !== null && d < bestD) { bestD = d; best = t; } }
  return best ? best[0] : '';
}

module.exports = { TOWNS, PROVINCE_CENTRES, geocodeTown, inSouthAfrica, distanceKm, nearestTown };
