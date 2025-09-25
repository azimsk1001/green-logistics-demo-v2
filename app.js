// ===== Vehicle dataset (Malaysia-aligned defaults) =====
const vehicleData = {
  vehicles: {
    "Volvo FH 460": {
      "Euro V":  { fuel_l_per_100km: 35, nox_g_per_km: 2.5, pm_g_per_km: 0.08 },
      "Euro VI": { fuel_l_per_100km: 33, nox_g_per_km: 0.6, pm_g_per_km: 0.01 }
    },
    "Mercedes Actros 2644": {
      "Euro V":  { fuel_l_per_100km: 35, nox_g_per_km: 2.5, pm_g_per_km: 0.08 }
    },
    "Mercedes Actros 2651": {
      "Euro VI": { fuel_l_per_100km: 34, nox_g_per_km: 0.6, pm_g_per_km: 0.01 }
    },
    "Scania R450": {
      "Euro VI": { fuel_l_per_100km: 33, nox_g_per_km: 0.6, pm_g_per_km: 0.01 }
    }
  },
  ef_co2_diesel_kg_per_l: 2.68,   // IPCC fuel-based CO2 factor
  wtt_uplift_default: 0.18         // +18% Well-to-Tank uplift (toggle)
};

// ===== Load scaling (payload affects fuel/NOx) =====
const LOAD_BASE_KG = 10000;        // baseline payload (kg)
const FUEL_SLOPE_PER_TON = 0.006;  // +0.6% fuel per +1,000 kg
const NOX_SLOPE_PER_TON  = 0.006;  // +0.6% NOx per +1,000 kg

// ===== External services =====
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

// ===== Map and state =====
let map, routeLayer;
let origin = null; // {name, lat, lon, marker}
let destinations = []; // [{id, name, lat, lon, marker, inputEl, suggEl, selectedEl, box}]
let destIdSeq = 1;
const MAX_DESTS = 5;
let lastReport = null; // stores latest results for export

// Marker styles
const originStyle = { radius: 7, color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 0.9, weight: 2 };
const destStyle   = { radius: 7, color: '#065f46', fillColor: '#10b981', fillOpacity: 0.9, weight: 2 };

// ===== Helpers =====
function debounce(fn, wait) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function showError(msg) {
  const el = document.getElementById('errorBox');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}
function clearError() { showError(''); }

function updateCounts() {
  const valid = destinations.filter(d => d.name && d.lat != null && d.lon != null).length;
  const vc = document.getElementById('validCount');
  const tc = document.getElementById('totalCount');
  if (vc) vc.textContent = valid;
  if (tc) tc.textContent = destinations.length;
}
function updateCalcEnabled() {
  const calcBtn = document.getElementById('calcBtn');
  if (!calcBtn) return;
  const valid = destinations.filter(d => d.name && d.lat != null && d.lon != null).length;
  calcBtn.disabled = !origin || valid === 0;
}
function fmt(n) { return Number(n || 0).toFixed(2); }
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ===== Export buttons wiring =====
function wireExportButtons() {
  const csvBtn = document.getElementById('exportCsv');
  const jsonBtn = document.getElementById('exportJson');
  if (!csvBtn || !jsonBtn) return;
  csvBtn.addEventListener('click', exportCSV);
  jsonBtn.addEventListener('click', exportJSON);
  csvBtn.disabled = true;
  jsonBtn.disabled = true;
}

// ===== Export helpers =====
 function exportJSON() 
 { if (!lastReport) return; const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' }); 
  const url = URL.createObjectURL(blob); triggerDownload(url, makeFileName('route_report', 'json')); }

function exportCSV() 
{ if (!lastReport) return; const r = lastReport; 
 const lines = [];

lines.push('Field,Value'); lines.push(Timestamp,${r.timestamp}); lines.push(Vehicle,${csvEscape(r.vehicle.model)} (${csvEscape(r.vehicle.euro)})); lines.push(WTT included,${r.inputs.wtt_on ? 'Yes' : 'No'}); lines.push(Load (kg),${r.inputs.load_kg}); lines.push(Fuel base (L/100km),${r.inputs.fuel_l_per_100km_base}); lines.push(NOx base (g/km),${r.inputs.nox_g_per_km_base}); lines.push(PM base (g/km),${r.inputs.pm_g_per_km_base}); lines.push(Fuel adj factor,${r.inputs.fuel_factor}); lines.push(NOx adj factor,${r.inputs.nox_factor}); lines.push(Total distance (km),${r.route.total_distance_km}); lines.push(Total fuel (L),${r.totals.fuel_l}); lines.push(CO2 TTW (kg),${r.totals.co2_ttw_kg}); lines.push(CO2 TTW+WTT (kg),${r.totals.co2_ttw_wtt_kg}); lines.push(NOx (kg),${r.totals.nox_kg}); lines.push(PM (kg),${r.totals.pm_kg}); lines.push('');

// Route order lines.push('Route order'); r.route.points.forEach((name, i) => { lines.push(${i + 1},${csvEscape(name)}); }); lines.push('');

// Per-leg table (if available) if (r.route.legs_km && r.route.legs_km.length) { lines.push('Leg,From,To,Distance (km)'); for (let i = 0; i < r.route.legs_km.length; i++) { const from = r.route.points[i] || ''; const to = r.route.points[i + 1] || ''; lines.push(${i + 1},${csvEscape(from)},${csvEscape(to)},${r.route.legs_km[i]}); } }

const csv = lines.join('\n'); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); triggerDownload(url, makeFileName('route_report', 'csv')); }

function triggerDownload(url, filename) { const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0); }

function makeFileName(base, ext) { const ts = new Date().toISOString().replace(/[:.]/g, '-'); return ${base}_${ts}.${ext}; }

function csvEscape(s) { if (s == null) return ''; const str = String(s); if (/[",\n]/.test(str)) { return "${str.replace(/"/g, '""')}"; } return str; }

  // ===== Boot =====
window.addEventListener('load', initApp);

function initApp() {
  initMap();
  wireVehicleSelectors();
  wireRouteUI();
  wireExportButtons();
  const ml = document.getElementById('mapLoading');
  if (ml) ml.style.display = 'none';
}

function initMap() {
  map = L.map('map').setView([3.9, 109.5], 6); // Malaysia wide view
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

// ===== VEHICLE UI =====
function wireVehicleSelectors() {
  const modelSelect = document.getElementById('modelSelect');
  const euroSelect  = document.getElementById('euroSelect');
  const fuelInput   = document.getElementById('fuelInput');
  const noxInput    = document.getElementById('noxInput');
  const pmInput     = document.getElementById('pmInput');
  const wttToggle   = document.getElementById('wttToggle');

  // Populate models
  Object.keys(vehicleData.vehicles).forEach(model => {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    modelSelect.appendChild(opt);
  });

  modelSelect.addEventListener('change', () => {
    populateEuroOptions();
    applyDefaults();
  });

  euroSelect.addEventListener('change', applyDefaults);

  function populateEuroOptions() {
    euroSelect.innerHTML = '';
    const model = modelSelect.value;
    const euroMap = vehicleData.vehicles[model] || {};
    Object.keys(euroMap).forEach(euro => {
      const opt = document.createElement('option');
      opt.value = euro;
      opt.textContent = euro;
      euroSelect.appendChild(opt);
    });
  }

  function applyDefaults() {
    const model = modelSelect.value;
    const euro  = euroSelect.value;
    const d = vehicleData.vehicles[model]?.[euro];
    if (!d) return;
    fuelInput.value = d.fuel_l_per_100km;
    noxInput.value  = d.nox_g_per_km;
    pmInput.value   = d.pm_g_per_km;
    wttToggle.checked = false; // default OFF
  }

  // Initialize
  modelSelect.selectedIndex = 0;
  populateEuroOptions();
  applyDefaults();
}

// ===== ROUTE UI =====
function wireRouteUI() {
  const originInput = document.getElementById('originInput');
  const originSugg  = document.getElementById('originSuggestions');
  const originSelected = document.getElementById('originSelected');
  const addDestBtn  = document.getElementById('addDest');
  const calcBtn     = document.getElementById('calcBtn');

  originInput.addEventListener('input', debounce(async () => {
    const list = await searchPlaces(originInput.value);
    renderSuggestions(originSugg, list, place => {
      setOrigin(place);
      originInput.value = place.fullName;
      originSelected.textContent = `Selected: ${place.name}`;
      originSugg.style.display = 'none';
      updateCalcEnabled();
    });
  }, 300));

  originInput.addEventListener('focus', () => {
    if (originInput.value.length >= 2) originInput.dispatchEvent(new Event('input'));
  });

  addDestBtn.addEventListener('click', addDestinationRow);
  calcBtn.addEventListener('click', calculateRouteAndEmissions);

  document.addEventListener('click', () => {
    originSugg.style.display = 'none';
    destinations.forEach(d => d.suggEl.style.display = 'none');
  });

  updateCounts();
  updateCalcEnabled();
}

function addDestinationRow() {
  if (destinations.length >= MAX_DESTS) {
    showError('Maximum 5 destinations allowed');
    return;
  }
  const id = destIdSeq++;
  const destContainer = document.getElementById('destContainer');

  const box = document.createElement('div');
  box.className = 'dest-box';
  box.innerHTML = `
    <div class="input-wrapper" style="position:relative;">
      <input type="text" placeholder="e.g., Singapore" autocomplete="off"/>
      <div class="suggestions"></div>
    </div>
    <div class="small"></div>
    <button class="remove">Remove</button>
  `;

  const inputEl = box.querySelector('input');
  const suggEl  = box.querySelector('.suggestions');
  const selectedEl = box.querySelector('.small');
  const removeBtn  = box.querySelector('.remove');

  const destObj = { id, name: null, lat: null, lon: null, marker: null, inputEl, suggEl, selectedEl, box };

  inputEl.addEventListener('input', debounce(async () => {
    const list = await searchPlaces(inputEl.value);
    renderSuggestions(suggEl, list, place => {
      setDestination(destObj, place);
      inputEl.value = place.fullName;
      selectedEl.textContent = `Selected: ${place.name}`;
      suggEl.style.display = 'none';
      updateCounts();
      updateCalcEnabled();
    });
  }, 300));

  inputEl.addEventListener('focus', () => {
    if (inputEl.value.length >= 2) inputEl.dispatchEvent(new Event('input'));
  });

  suggEl.addEventListener('click', e => e.stopPropagation());

  removeBtn.addEventListener('click', () => {
    if (destObj.marker) map.removeLayer(destObj.marker);
    const idx = destinations.findIndex(d => d.id === id);
    if (idx > -1) destinations.splice(idx, 1);
    box.remove();
    updateCounts();
    updateCalcEnabled();
  });

  destinations.push(destObj);
  destContainer.appendChild(box);
  updateCounts();
}

// ===== SEARCH/SUGGESTIONS =====
async function searchPlaces(query) {
  if (!query || query.length < 2) return [];
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' }});
    const data = await res.json();
    return data.map(item => ({
      name: item.display_name.split(',')[0],
      fullName: item.display_name,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon)
    }));
  } catch (e) {
    console.error('Search error:', e);
    return [];
  }
}

function renderSuggestions(container, list, onSelect) {
  container.innerHTML = '';
  if (!list || list.length === 0) {
    container.style.display = 'none';
    return;
  }
  list.forEach(place => {
    const div = document.createElement('div');
    div.className = 'suggestion';
    div.textContent = place.fullName;
    div.addEventListener('click', e => {
      e.stopPropagation();
      onSelect(place);
    });
    container.appendChild(div);
  });
  container.style.display = 'block';
}
// ===== SET ORIGIN/DEST =====
function setOrigin(place) {
  if (origin && origin.marker) map.removeLayer(origin.marker);
  origin = {
    name: place.fullName,
    lat: place.lat,
    lon: place.lon,
    marker: L.circleMarker([place.lat, place.lon], originStyle).addTo(map).bindPopup(place.fullName)
  };
  map.setView([place.lat, place.lon], 10);
}

function setDestination(destObj, place) {
  if (destObj.marker) map.removeLayer(destObj.marker);
  destObj.name = place.fullName;
  destObj.lat  = place.lat;
  destObj.lon  = place.lon;
  destObj.marker = L.circleMarker([place.lat, place.lon], destStyle).addTo(map).bindPopup(place.fullName);
  map.setView([place.lat, place.lon], 9);
}

// ===== ROUTE + EMISSIONS =====
async function calculateRouteAndEmissions() {
  clearError();
  if (!origin) {
    showError('Please select an origin');
    return;
  }
  const validDests = destinations.filter(d => d.name && d.lat != null && d.lon != null);
  if (validDests.length === 0) {
    showError('Please add at least one destination');
    return;
  }

  const points = [origin, ...validDests];

  try {
    const route = await getRoute(points);
    if (!route) {
      showError('Failed to get route from OSRM');
      return;
    }

    drawRoute(route.coords);

    const distanceKm = (route.distance_m || 0) / 1000;
    const legsKm = (route.legs_m || []).map(m => m / 1000);

    const em = computeEmissions(distanceKm);
    renderResults({
      distanceKm,
      legsKm,
      points,
      fuelL: em.fuelL,
      co2kg: em.co2kg,
      co2kg_wtt: em.co2kg_wtt,
      noxkg: em.noxkg,
      pmkg: em.pmkg,
      fuelFactor: em.fuelFactor,
      noxFactor: em.noxFactor,
      loadKg: em.loadKg
    });
  } catch (e) {
    console.error(e);
    showError('Error calculating route/emissions');
  }
}

async function getRoute(points) {
  const coordsStr = points.map(p => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM_URL}/${coordsStr}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.routes || !data.routes[0]) return null;
  const r = data.routes[0];

  const coords = (r.geometry?.coordinates || []).map(c => [c[1], c[0]]);
  const legs_m = r.legs ? r.legs.map(l => l.distance) : (typeof r.distance === 'number' ? [r.distance] : []);
  return { coords, distance_m: r.distance, legs_m };
}

function drawRoute(coords) {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.polyline(coords || [], { color: '#2563eb', weight: 4 }).addTo(map);
  if (coords && coords.length) {
    map.fitBounds(routeLayer.getBounds().pad(0.15));
  }
}

// ===== EMISSIONS with load scaling =====
function computeEmissions(distanceKm) {
  const fuelInput   = document.getElementById('fuelInput');
  const noxInput    = document.getElementById('noxInput');
  const pmInput     = document.getElementById('pmInput');
  const wttToggle   = document.getElementById('wttToggle');
  const loadEl      = document.getElementById('loadWeight');

  const fuelPer100_base = parseFloat(fuelInput.value) || 0;   // L/100km
  const nox_g_km_base   = parseFloat(noxInput.value) || 0;    // g/km
  const pm_g_km         = parseFloat(pmInput.value) || 0;     // g/km
  const efCO2           = vehicleData.ef_co2_diesel_kg_per_l; // kg/L
  const loadKg          = loadEl ? (parseFloat(loadEl.value) || 0) : LOAD_BASE_KG;

  // Load adjustment (linear rule-of-thumb, clamped)
  const deltaTons = (loadKg - LOAD_BASE_KG) / 1000;
  const fuelFactor = clamp(1 + FUEL_SLOPE_PER_TON * deltaTons, 0.8, 1.5);
  const noxFactor  = clamp(1 + NOX_SLOPE_PER_TON  * deltaTons, 0.8, 1.5);

  const fuelPer100 = fuelPer100_base * fuelFactor; // adjusted L/100km
  const nox_g_km   = nox_g_km_base   * noxFactor;  // adjusted g/km

  const fuelL = distanceKm * (fuelPer100 / 100);   // liters
  const co2kg = fuelL * efCO2;                     // TTW CO2
  const co2kg_wtt = (wttToggle && wttToggle.checked)
    ? co2kg * (1 + vehicleData.wtt_uplift_default)
    : co2kg;

  const noxkg = (distanceKm * nox_g_km) / 1000;    // kg
  const pmkg  = (distanceKm * pm_g_km) / 1000;     // kg

  return { fuelL, co2kg, co2kg_wtt, noxkg, pmkg, fuelFactor, noxFactor, loadKg };
}

function renderResults({ distanceKm, legsKm, points, fuelL, co2kg, co2kg_wtt, noxkg, pmkg, fuelFactor, noxFactor, loadKg }) {
  const results = document.getElementById('results');
  const wttOn = document.getElementById('wttToggle')?.checked;

  const totalKm = Math.max(distanceKm, 0.0001);
  const fuelPerKm   = fuelL / totalKm;
  const co2PerKm    = co2kg / totalKm;
  const co2WttPerKm = co2kg_wtt / totalKm;
  const noxPerKm    = noxkg / totalKm;
  const pmPerKm
let legsHtml = ''; if (legsKm && legsKm.length && points && points.length === legsKm.length + 1) 
{ for (let i = 0; i < legsKm.length; i++) 
{ const legKm = legsKm[i]; legsHtml +=  <div class="result-item"> <div><strong>Leg ${i + 1}:</strong> ${escapeHtml(points[i].name)} → ${escapeHtml(points[i + 1].name)}</div> 
  <div class="small">Distance: ${fmt(legKm)} km</div> <div class="small">Fuel: ${fmt(legKm * fuelPerKm)} L</div> 
  <div class="small">CO2 (TTW): ${fmt(legKm * co2PerKm)} kg${wttOn ? | CO2 (TTW+WTT): ${fmt(legKm * co2WttPerKm)} kg: ''}</div> <div class="small">NOx: ${fmt(legKm * noxPerKm)} kg | PM: ${fmt(legKm * pmPerKm)} kg</div> </div> ; } }

results.innerHTML = `

<div class="result-item"> <div><strong>Total Distance:</strong> 
${fmt(distanceKm)} km</div> <div><strong>Fuel Used:</strong> 
${fmt(fuelL)} L</div> <div><strong>CO2 (TTW):</strong> 
${fmt(co2kg)} kg ${wttOn ? `<span class="badge">+ WTT</span>` : ''}</div> 
${wttOn ? `<div><strong>CO2 (TTW + WTT):</strong> ${fmt(co2kg_wtt)} kg</div>` : ''} <div><strong>NOx:</strong> 
${fmt(noxkg)} kg | <strong>PM:</strong> ${fmt(pmkg)} kg</div> <div class="muted">CO2 factor: 
${vehicleData.ef_co2_diesel_kg_per_l} kg/L diesel${wttOn ? `, WTT +
${Math.round(vehicleData.wtt_uplift_default * 100)}%` : ''}</div> <div class="muted">Load: 
${Math.round(loadKg)} kg | Fuel adj: ${((fuelFactor - 1) * 100).toFixed(1)}% | NOx adj: 
${((noxFactor - 1) * 100).toFixed(1)}%</div> </div>
${legsHtml ? `<h2>Legs</h2>${legsHtml}` : ''} `;
// Build lastReport for export const model = document.getElementById('modelSelect')?.value || ''; const euro = document.getElementById('euroSelect')?.value || ''; const fuelBase = parseFloat(document.getElementById('fuelInput')?.value || '0'); const noxBase = parseFloat(document.getElementById('noxInput')?.value || '0'); const pmBase = parseFloat(document.getElementById('pmInput')?.value || '0'); const wttOnVal = !!wttOn;

lastReport = { timestamp: new Date().toISOString(), vehicle: { model, euro },
              inputs: { fuel_l_per_100km_base: fuelBase, nox_g_per_km_base: noxBase, pm_g_per_km_base: pmBase, wtt_on: wttOnVal, load_kg: loadKg, fuel_factor: fuelFactor, nox_factor: noxFactor }, 
              route: { total_distance_km: distanceKm, legs_km: legsKm, points: points.map(p => p.name) }, 
              totals: { fuel_l: fuelL, co2_ttw_kg: co2kg, co2_ttw_wtt_kg: co2kg_wtt, nox_kg: noxkg, pm_kg: pmkg }
