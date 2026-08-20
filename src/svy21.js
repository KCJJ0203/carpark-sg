// SVY21 (Singapore's national grid) -> WGS84 lat/lng.
//
// data.gov.sg publishes carpark coordinates as SVY21 eastings and northings
// ("x_coord": 30314.79). They are metres from a projection origin, NOT degrees.
// Using them directly puts every carpark in the Gulf of Guinea, so this module
// is tested against the projection origin and a carpark whose real position is
// known before anything is drawn on a map.
//
// SVY21 is a Transverse Mercator projection on the WGS84 ellipsoid, so no datum
// shift is needed - this is pure projection maths. Parameters are SLA's.

const a = 6378137.0;                 // WGS84 semi-major axis
const f = 1 / 298.257223563;         // WGS84 flattening
const oLat = 1.366666;               // origin latitude,  1 deg 22' N
const oLng = 103.833333;             // origin longitude, 103 deg 50' E
const No = 38744.572;                // false northing
const Eo = 28001.642;                // false easting
const k = 1.0;                       // scale factor

const b = a * (1 - f);
const e2 = (2 * f) - (f * f);
const e4 = e2 * e2;
const e6 = e4 * e2;
const n = (a - b) / (a + b);
const n2 = n * n, n3 = n2 * n, n4 = n2 * n2;

const A0 = 1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256;
const A2 = (3 / 8) * (e2 + e4 / 4 + 15 * e6 / 128);
const A4 = (15 / 256) * (e4 + 3 * e6 / 4);
const A6 = 35 * e6 / 3072;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Meridian distance from the equator to a given latitude.
function meridian(lat) {
  return a * (A0 * lat - A2 * Math.sin(2 * lat) + A4 * Math.sin(4 * lat) - A6 * Math.sin(6 * lat));
}

const Mo = meridian(rad(oLat));

function svy21ToWgs84(x, y) {
  const E = Number(x);
  const N = Number(y);
  if (!isFinite(E) || !isFinite(N) || x === "" || x === null || x === undefined) return null;
  if (y === "" || y === null || y === undefined) return null;

  const Nprime = N - No;
  const Mprime = Mo + Nprime / k;
  const G = a * (1 - n) * (1 - n2) * (1 + (9 * n2) / 4 + (225 * n4) / 64) * (Math.PI / 180);
  const sigma = ((Mprime * Math.PI) / 180) / G;

  // Foot-point latitude: the latitude whose meridian distance equals Mprime.
  const latP =
    sigma +
    ((3 * n) / 2 - (27 * n3) / 32) * Math.sin(2 * sigma) +
    ((21 * n2) / 16 - (55 * n4) / 32) * Math.sin(4 * sigma) +
    ((151 * n3) / 96) * Math.sin(6 * sigma) +
    ((1097 * n4) / 512) * Math.sin(8 * sigma);

  const sinLatP = Math.sin(latP);
  const sin2 = sinLatP * sinLatP;
  const rhoP = (a * (1 - e2)) / Math.pow(1 - e2 * sin2, 1.5);
  const vP = a / Math.sqrt(1 - e2 * sin2);
  const psiP = vP / rhoP;
  const psiP2 = psiP * psiP, psiP3 = psiP2 * psiP, psiP4 = psiP2 * psiP2;
  const tP = Math.tan(latP);
  const tP2 = tP * tP, tP4 = tP2 * tP2, tP6 = tP4 * tP2;

  const Eprime = E - Eo;
  const X = Eprime / (k * vP);
  const X2 = X * X, X3 = X2 * X, X5 = X3 * X2, X7 = X5 * X2;

  const latTerm1 = (tP / (k * rhoP)) * ((Eprime * X) / 2);
  const latTerm2 = (tP / (k * rhoP)) * ((Eprime * X3) / 24) * (-4 * psiP2 + 9 * psiP * (1 - tP2) + 12 * tP2);
  const latTerm3 =
    (tP / (k * rhoP)) *
    ((Eprime * X5) / 720) *
    (8 * psiP4 * (11 - 24 * tP2) -
      12 * psiP3 * (21 - 71 * tP2) +
      15 * psiP2 * (15 - 98 * tP2 + 15 * tP4) +
      180 * psiP * (5 * tP2 - 3 * tP4) +
      360 * tP4);
  const latTerm4 =
    (tP / (k * rhoP)) *
    ((Eprime * X7) / 40320) *
    (1385 + 3633 * tP2 + 4095 * tP4 + 1575 * tP6);
  const lat = latP - latTerm1 + latTerm2 - latTerm3 + latTerm4;

  const secLatP = 1 / Math.cos(latP);
  const lngTerm1 = X * secLatP;
  const lngTerm2 = ((X3 * secLatP) / 6) * (psiP + 2 * tP2);
  const lngTerm3 = ((X5 * secLatP) / 120) * (-4 * psiP3 * (1 - 6 * tP2) + psiP2 * (9 - 68 * tP2) + 72 * psiP * tP2 + 24 * tP4);
  const lngTerm4 = ((X7 * secLatP) / 5040) * (61 + 662 * tP2 + 1320 * tP4 + 720 * tP6);
  const lng = rad(oLng) + lngTerm1 - lngTerm2 + lngTerm3 - lngTerm4;

  return { lat: deg(lat), lng: deg(lng) };
}

module.exports = { svy21ToWgs84 };
