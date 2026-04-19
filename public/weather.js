/* ── Weather App Module ───────────────────────────────────────────────────────
   Mocks Weather Underground / api.weather.com APIs for Amsterdam
   Integrated as a screen within AutoPMF
────────────────────────────────────────────────────────────────────────────── */
const WX = (() => {

// ── State ─────────────────────────────────────────────────────────────────────
let tab = 'today';
let loc = { name:'Amsterdam', country:'NL', flag:'🇳🇱', lat:52.378, lon:4.9, station:'EHAM', tz:'Europe/Amsterdam', alt:2 };
let cache = {};
let calYear = 2026, calMonth = 4, calData = null, calSel = null, showAlm = false;
let histStart = '2026-04-01', histEnd = '2026-04-15', histData = null;
let histSortCol = 'date', histSortDir = 1;
let searchTO = null;
let charts = {};
let loadBusy = false;
let loadGeneration = 0;
let hadError = false;
let isFirstLoad = true;
let suppressRefreshToast = false;
let lastUpdated = null;
let recentSearches = JSON.parse(localStorage.getItem('wx_recent') || '["Amsterdam, NL","London, UK","Paris, FR"]');

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const qsa = s => document.querySelectorAll(s);
function setContent(html) {
  const el = $('wx-content');
  if (el) { el.scrollTop = 0; el.innerHTML = html; }
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Icons / Colors ────────────────────────────────────────────────────────────
const ICONS = {1:'🌪',2:'🌀',3:'🌀',4:'⛈',5:'🌨',6:'❄️',7:'❄️',8:'🌧',9:'🌦',10:'🌧',11:'🌦',12:'🌧',13:'🌨',14:'🌨',15:'❄️',16:'❄️',17:'⛈',18:'🌨',19:'💨',20:'🌫',21:'🌫',22:'🌫',23:'💨',24:'💨',25:'❄️',26:'☁️',27:'☁️',28:'⛅',29:'🌙',30:'⛅',31:'🌙',32:'☀️',33:'🌙',34:'🌤️',35:'⛈',36:'🌡',37:'⛈',38:'⛈',39:'🌦',40:'🌧',41:'🌨',42:'❄️',43:'❄️',44:'❓',45:'🌦',46:'🌨',47:'⛈'};
const wi = c => ICONS[c] || '🌡';

function tCol(t) {
  if (t<=0) return '#93c5fd'; if (t<=5) return '#60a5fa';
  if (t<=10) return '#67e8f9'; if (t<=15) return '#86efac';
  if (t<=20) return '#fde68a'; if (t<=25) return '#fb923c';
  return '#f87171';
}
const aqiCol = a => a<=50?'#22c55e':a<=100?'#eab308':a<=150?'#f97316':a<=200?'#ef4444':'#a855f7';
const aqiLbl = a => a<=50?'Good':a<=100?'Moderate':a<=150?'Unhealthy (Sensitive)':a<=200?'Unhealthy':'Very Unhealthy';
const polCol = n => n<=1?'#22c55e':n<=2?'#84cc16':n<=3?'#eab308':n<=4?'#f97316':'#ef4444';
const piCol  = mm => mm<=0?'rgba(37,99,235,0.1)':mm<=2?'rgba(37,99,235,0.35)':mm<=5?'rgba(37,99,235,0.55)':mm<=10?'rgba(37,99,235,0.75)':'rgba(37,99,235,0.9)';
const wArrow = d => '↓↙←↖↑↗→↘'[Math.round(((d%360)/45))%8];
function updatedAgo() { if(!lastUpdated) return ''; const s=Math.round((Date.now()-lastUpdated)/1000); if(s<60) return 'Updated just now'; if(s<3600) return `Updated ${Math.floor(s/60)}m ago`; return `Updated ${Math.floor(s/3600)}h ago`; }
const moonEm = p => ({'New Moon':'🌑','Waxing Crescent':'🌒','First Quarter':'🌓','Waxing Gibbous':'🌔','Full Moon':'🌕','Waning Gibbous':'🌖','Last Quarter':'🌗','Waning Crescent':'🌘'})[p]||'🌙';
function hexRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function loadAll() {
  if (loadBusy) return;
  loadBusy = true;
  const myGen = loadGeneration;
  const minMs = 400;
  const t0 = Date.now();
  const wait = () => { const rem = minMs - (Date.now() - t0); return rem > 0 ? new Promise(r => setTimeout(r, rem)) : Promise.resolve(); };
  setContent(`<div class="wx-loading">
    <div class="wx-load-city-flag">${loc.flag||'🌤️'}</div>
    <p class="wx-load-city-name">${loc.name}</p>
    <div class="wx-spinner"></div>
    <p>Loading weather<span class="wx-dot wx-d1">.</span><span class="wx-dot wx-d2">.</span><span class="wx-dot wx-d3">.</span></p>
  </div>`);
  try {
    const [current, forecast, hourly, aqi, pollen] = await Promise.all([
      api(`/api/weather/current?lat=${loc.lat}&lon=${loc.lon}&station=${encodeURIComponent(loc.name + (loc.country ? ', ' + loc.country : ''))}`),
      api(`/api/weather/forecast?lat=${loc.lat}&lon=${loc.lon}`),
      api(`/api/weather/hourly?lat=${loc.lat}&lon=${loc.lon}`),
      api('/api/weather/aqi'),
      api('/api/weather/pollen'),
    ]);
    await wait();
    if (myGen !== loadGeneration) { loadBusy = false; loadAll(); return; }
    const recovering = hadError;
    const wasFirst = isFirstLoad;
    const suppressed = suppressRefreshToast;
    hadError = false;
    isFirstLoad = false;
    suppressRefreshToast = false;
    lastUpdated = new Date();
    cache = { current, forecast, hourly, aqi, pollen };
    loadBusy = false;
    renderTab(tab);
    if (recovering) {
      if (typeof showToast === 'function') showToast('Weather loaded ✓');
    } else if (!wasFirst && !suppressed && typeof showToast === 'function') {
      showToast('Refreshed ✓');
    }
  } catch(e) {
    await wait();
    if (myGen !== loadGeneration) { loadBusy = false; loadAll(); return; }
    hadError = true;
    loadBusy = false;
    setContent(`<div class="wx-error">
      <div class="wx-load-city-flag">${loc.flag||'⚠️'}</div>
      <p class="wx-load-city-name" style="color:#1c1c1e">${loc.name}</p>
      <p class="wx-err-title">Weather data unavailable</p>
      <p class="wx-err-body">Can't reach the weather service. Tap Retry, or switch to a different city.</p>
      <button class="wx-retry-btn" id="wx-retry">Retry</button>
      <button class="wx-switch-city-btn" id="wx-switch-city">Try a different city</button>
    </div>`);
    document.getElementById('wx-retry')?.addEventListener('click', () => {
      const btn = document.getElementById('wx-retry');
      if (btn) { btn.textContent = 'Retrying…'; btn.disabled = true; }
      loadAll();
    });
    document.getElementById('wx-switch-city')?.addEventListener('click', () => switchTab('search'));
    setTimeout(() => { if (!cache.current) loadAll(); }, 15000);
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(t) {
  tab = t;
  qsa('.wx-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
  charts = {};
  renderTab(t);
}

function renderTab(t) {
  if (!cache.current && t !== 'search') { loadAll(); return; }
  if (t === 'today')    renderToday();
  else if (t === 'forecast') renderForecast();
  else if (t === 'calendar') renderCalendarView();
  else if (t === 'history')  renderHistoryView();
  else if (t === 'search')   renderSearchView();
}

// ── TODAY ─────────────────────────────────────────────────────────────────────
function renderToday() {
  const c = cache.current, a = cache.aqi, p = cache.pollen;
  const today = (p||[]).find(d => d.period === 'Today') || (p||[])[0] || {};
  const showHint = !localStorage.getItem('wx_welcomed');
  setContent(`<div class="wx-today">
    ${showHint ? `<div class="wx-onboard-hint" id="wx-onboard">
      <div class="wx-onboard-header"><span class="wx-onboard-title">👋 Welcome to your weather dashboard</span><button class="wx-onboard-close" id="wx-onboard-close" aria-label="Dismiss">Dismiss</button></div>
      <div class="wx-onboard-tabs"><span class="wx-onboard-tab">☀️ Today — conditions</span><span class="wx-onboard-tab">📅 Forecast — 7-day</span><span class="wx-onboard-tab">🗓 Calendar — monthly</span><span class="wx-onboard-tab">📊 History — records</span><span class="wx-onboard-tab">🔍 Search — switch city</span></div>
      <div class="wx-onboard-body">Tap any tab below to explore · Use Search to change your city · Tap <strong>☰</strong> top-left for Stats, Progress &amp; Settings</div>
    </div>` : ''}
    <div class="wx-hero">
      <div class="wx-hero-city">${loc.flag} ${loc.name}</div>
      <div class="wx-hero-icon">${wi(c.iconCode)}</div>
      <div class="wx-hero-temp">${c.temperature}°<span class="wx-hero-unit">C</span></div>
      <div class="wx-hero-phrase">${c.wxPhraseLong}</div>
      <div class="wx-hero-sub">Feels like ${c.feelsLike}° &nbsp;·&nbsp; H:${c.temperatureMax24Hour}° L:${c.temperatureMin24Hour}°</div>
      <div class="wx-hero-station">📍 ${c.stationName} · ${c.obsTimeLocal.slice(11,16)} CEST</div>
      <div class="wx-hero-updated">${updatedAgo()}</div>
    </div>
    <div class="wx-qs-row">
      ${[['💧',`${c.humidity}%`,'Humidity'],['💨',`${c.windDirectionCardinal} ${c.windSpeed}`,'km/h'],
         ['⬇️',`${c.pressureMeanSeaLevel}`,`hPa ${c.pressureTendencyTrend==='Steady'?'→':c.pressureTendencyCode>0?'↑':'↓'}`],
         ['👁️',`${c.visibility}`,'km vis.']].map(([ic,v,l])=>
        `<div class="wx-qs"><div class="wx-qs-ic">${ic}</div><div class="wx-qs-v">${v}</div><div class="wx-qs-l">${l}</div></div>`).join('')}
    </div>
    <div class="wx-section-lbl">Conditions</div>
    <div class="wx-grid-2">
      <div class="wx-card"><div class="wx-card-lbl">Dew Point</div><div class="wx-card-val">${c.dewPoint}°C</div></div>
      <div class="wx-card">
        <div class="wx-card-lbl">UV Index</div>
        <div class="wx-card-val">${c.uvIndex} <small style="font-size:13px;font-weight:400">${c.uvDescription}</small></div>
        <div class="wx-uv-track"><div class="wx-uv-fill" style="width:${Math.min(c.uvIndex/11*100,100)}%;background:${c.uvIndex<=2?'#22c55e':c.uvIndex<=5?'#eab308':c.uvIndex<=7?'#f97316':'#ef4444'}"></div></div>
      </div>
      <div class="wx-card"><div class="wx-card-lbl">Cloud Cover</div><div class="wx-card-val">${c.cloudCover}%</div><div class="wx-card-sub">${c.cloudCoverPhrase}</div></div>
      <div class="wx-card"><div class="wx-card-lbl">Wind</div><div class="wx-card-val">${wArrow(c.windDirection)} ${c.windDirectionCardinal}</div><div class="wx-card-sub">${c.windSpeed} km/h${c.windGust?` · gust ${c.windGust}`:''}</div></div>
      <div class="wx-card"><div class="wx-card-lbl">Pressure</div><div class="wx-card-val">${c.pressureMeanSeaLevel}</div><div class="wx-card-sub">hPa · ${c.pressureTendencyTrend}</div></div>
      <div class="wx-card"><div class="wx-card-lbl">24h Change</div><div class="wx-card-val" style="color:${c.temperatureChange24Hour>=0?'#ef4444':'#60a5fa'}">${c.temperatureChange24Hour>0?'+':''}${c.temperatureChange24Hour}°C</div><div class="wx-card-sub">vs yesterday</div></div>
    </div>
    <div class="wx-section-lbl">Precipitation</div>
    <div class="wx-precip-row">
      ${[['Last hour',c.precip1Hour],['Last 6h',c.precip6Hour],['Last 24h',c.precip24Hour],['Snow 24h',c.snow24Hour||0]].map(([l,v])=>
        `<div class="wx-pi"><div class="wx-pi-v">${v>0?v+' mm':'—'}</div><div class="wx-pi-l">${l}</div></div>`).join('')}
    </div>
    <div class="wx-section-lbl">Sun</div>
    <div class="wx-sun-card">${renderSunArc(c.sunriseTimeLocal, c.sunsetTimeLocal)}</div>
    <div class="wx-short-fcst"><span class="wx-sfcst-icon">☀️</span><div><strong>Next 6 hours</strong><br>${c.shortRangeForecast}</div></div>
    <div class="wx-section-lbl">Air Quality Index</div>
    <div class="wx-aqi-card">
      <div class="wx-aqi-top">
        <div class="wx-aqi-badge" style="background:${aqiCol(a.airQualityIndex)}">${a.airQualityIndex}</div>
        <div><div class="wx-aqi-cat">${aqiLbl(a.airQualityIndex)}</div><div class="wx-aqi-primary">Primary: ${a.primaryPollutant}</div></div>
      </div>
      <div class="wx-aqi-pollutants">
        ${Object.entries(a.pollutants).map(([k,v])=>`<div class="wx-poll-chip" style="border-color:${aqiCol(v.index)}"><div class="wx-poll-name">${k}</div><div class="wx-poll-val">${v.amount}</div><div class="wx-poll-unit">${v.unit}</div></div>`).join('')}
      </div>
    </div>
    <div class="wx-section-lbl">Pollen Forecast</div>
    <div class="wx-pollen-card">
      ${today.tree != null ? [['🌳','Tree Pollen',today.tree,today.treeLabel],['🌿','Grass',today.grass,today.grassLabel],['🌾','Ragweed',today.ragweed,today.ragweedLabel]].map(([ic,n,v,l])=>`
        <div class="wx-pol-row"><span class="wx-pol-ic">${ic}</span><div class="wx-pol-info"><div class="wx-pol-name">${n}</div><div class="wx-pol-track"><div class="wx-pol-fill" style="width:${v/5*100}%;background:${polCol(v)}"></div></div></div><div class="wx-pol-badge" style="background:${polCol(v)};color:#fff">${l}</div></div>`).join('') : ''}
      <div class="wx-pol-fcst-row">
        ${(p||[]).slice(1,5).map(d=>`<div class="wx-pfc-item"><div class="wx-pfc-day">${d.period.slice(0,3)}</div><div class="wx-pfc-icon">🌳</div><div class="wx-pfc-lbl" style="color:${polCol(d.tree)}">${d.treeLabel}</div></div>`).join('')}
      </div>
    </div>
    <div class="wx-context-links">
      <button class="wx-ctx-link" data-goto="forecast">See 7-day forecast <span>→</span></button>
      <button class="wx-ctx-link" data-goto="calendar">Open monthly calendar <span>→</span></button>
    </div>
    <div style="height:16px"></div>
  </div>`);
  document.getElementById('wx-onboard-close')?.addEventListener('click', () => {
    localStorage.setItem('wx_welcomed', '1');
    document.getElementById('wx-onboard')?.remove();
  });
  qsa('.wx-ctx-link').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.goto)));
}

function renderSunArc(riseStr, setStr) {
  const rise = riseStr.slice(11,16), set = setStr.slice(11,16);
  const [rh,rm] = rise.split(':').map(Number), [sh,sm] = set.split(':').map(Number);
  const riseM = rh*60+rm, setM = sh*60+sm, nowM = new Date().getHours()*60+new Date().getMinutes();
  const dayLen = setM - riseM, h = Math.floor(dayLen/60), m = dayLen%60;
  let t = 0;
  if (nowM >= riseM && nowM <= setM) t = (nowM-riseM)/dayLen;
  else if (nowM > setM) t = 1;
  const bx = (1-t)*(1-t)*10 + 2*(1-t)*t*100 + t*t*190;
  const by = (1-t)*(1-t)*62 + 2*(1-t)*t*8 + t*t*62;
  return `<div class="wx-sun-row">
    <div class="wx-sun-item"><div class="wx-sun-ic">🌅</div><div class="wx-sun-time">${rise}</div><div class="wx-sun-lbl">Sunrise</div></div>
    <div class="wx-sun-arc-wrap">
      <svg viewBox="0 0 200 72" width="100%" height="52">
        <path d="M10,62 Q100,8 190,62" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/>
        <circle cx="10" cy="62" r="3.5" fill="#fbbf24"/><circle cx="190" cy="62" r="3.5" fill="#64748b"/>
        ${t>0&&t<1?`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5" fill="#fbbf24"/>`:t>=1?'<circle cx="190" cy="62" r="5" fill="#94a3b8"/>':''}
      </svg>
      <div class="wx-sun-daylen">${h}h ${m}m daylight</div>
    </div>
    <div class="wx-sun-item"><div class="wx-sun-ic">🌇</div><div class="wx-sun-time">${set}</div><div class="wx-sun-lbl">Sunset</div></div>
  </div>`;
}

// ── FORECAST ──────────────────────────────────────────────────────────────────
function renderForecast() {
  const f = cache.forecast, h = cache.hourly;
  setContent(`<div class="wx-forecast">
    <div class="wx-tab-intro">Look ahead 7 days and hour-by-hour · swipe the strip · charts show trends</div>
    <div class="wx-section-lbl">7-Day Forecast</div>
    <div class="wx-fc-scroller"><div class="wx-fc-cards">
      ${f.map((d,i)=>`<div class="wx-fc-card${i===0?' wx-fc-today':''}">
        <div class="wx-fc-day">${i===0?'Today':d.dow}</div>
        <div class="wx-fc-ic">${wi(d.iconCode)}</div>
        <div class="wx-fc-temps"><span class="wx-fc-hi" style="color:${tCol(d.high)}">${d.high}°</span><span class="wx-fc-lo">${d.low}°</span></div>
        <div class="wx-fc-rain"><div class="wx-fc-rb"><div class="wx-fc-rf" style="height:${d.precipChance}%"></div></div><small>${d.precipChance}%</small></div>
        <div class="wx-fc-wind"><small>${d.windDir} ${d.windSpeed}</small></div>
      </div>`).join('')}
    </div></div>
    <div class="wx-narrative">"${f[0].narrative}"</div>
    <div class="wx-section-lbl">Today's Temperature (°C)</div>
    <div class="wx-chart-wrap"><canvas id="wx-tc" height="130"></canvas></div>
    <div class="wx-section-lbl">Precipitation Probability (%)</div>
    <div class="wx-chart-wrap"><canvas id="wx-pc" height="110"></canvas></div>
    <div class="wx-section-lbl">Moon Phases</div>
    <div class="wx-moon-row">
      ${f.map((d,i)=>`<div class="wx-moon-item"><div class="wx-moon-em">${moonEm(d.moonPhase)}</div><div class="wx-moon-day">${i===0?'Today':d.dow.slice(0,3)}</div></div>`).join('')}
    </div>
    <div class="wx-section-lbl">Hourly · April 15</div>
    <div class="wx-hourly-tbl">
      <div class="wx-ht-head"><span>Time</span><span></span><span>°C</span><span>FL</span><span>H%</span><span>💨</span><span>☔%</span></div>
      ${h.map(hr=>`<div class="wx-ht-row${hr.hour===new Date().getHours()?' wx-ht-now':''}">
        <span>${String(hr.hour).padStart(2,'0')}:00</span><span>${wi(hr.iconCode)}</span>
        <span style="color:${tCol(hr.temp)}">${hr.temp}°</span><span>${hr.feelsLike}°</span>
        <span>${hr.humidity}%</span><span>${hr.windSpeed}</span><span>${hr.precipChance}%</span>
      </div>`).join('')}
    </div>
    <div style="height:16px"></div>
  </div>`);
  requestAnimationFrame(() => { drawTempChart(h); drawPrecipChart(f); });
}

function drawTempChart(h) {
  const canvas = $('wx-tc'); if (!canvas || !window.Chart) return;
  charts.temp = new Chart(canvas, {
    type:'line',
    data:{
      labels:h.map(hr=>`${String(hr.hour).padStart(2,'0')}:00`),
      datasets:[
        {label:'Temp',data:h.map(hr=>hr.temp),borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,0.07)',fill:true,tension:0.4,pointRadius:2,borderWidth:2},
        {label:'Feels like',data:h.map(hr=>hr.feelsLike),borderColor:'#94a3b8',borderDash:[4,3],fill:false,tension:0.4,pointRadius:0,borderWidth:1.5}
      ]
    },
    options:{responsive:true,maintainAspectRatio:true,
      plugins:{legend:{display:true,position:'top',labels:{font:{size:10},boxWidth:12}}},
      scales:{x:{ticks:{maxTicksLimit:8,font:{size:9},color:'#888'},grid:{display:false}},y:{ticks:{font:{size:9},color:'#888',callback:v=>`${v}°`},grid:{color:'rgba(0,0,0,0.05)'}}}
    }
  });
}

function drawPrecipChart(f) {
  const canvas = $('wx-pc'); if (!canvas || !window.Chart) return;
  charts.precip = new Chart(canvas, {
    type:'bar',
    data:{
      labels:f.map((d,i)=>i===0?'Today':d.dow.slice(0,3)),
      datasets:[{data:f.map(d=>d.precipChance),backgroundColor:f.map(d=>`rgba(37,99,235,${0.2+d.precipChance/100*0.7})`),borderRadius:5,borderWidth:0}]
    },
    options:{responsive:true,maintainAspectRatio:true,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.raw}% chance`}}},
      scales:{x:{ticks:{font:{size:11},color:'#888'},grid:{display:false}},y:{min:0,max:100,ticks:{font:{size:9},color:'#888',callback:v=>`${v}%`},grid:{color:'rgba(0,0,0,0.05)'}}}
    }
  });
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────
async function renderCalendarView() {
  if (!calData) {
    setContent('<div class="wx-loading"><div class="wx-spinner"></div><p>Loading calendar…</p></div>');
    try {
      const [days, alm] = await Promise.all([
        api(`/api/weather/calendar?year=${calYear}&month=${calMonth}`),
        api(`/api/weather/almanac?month=${calMonth}`)
      ]);
      calData = { days, alm };
    } catch(e) { setContent(`<div class="wx-error">⚠️ Failed to load calendar</div>`); return; }
  }
  drawCalendar();
}

function drawCalendar() {
  const MNAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mName = MNAMES[calMonth-1];
  const firstDow = (new Date(calYear,calMonth-1,1).getDay()+6)%7;
  const daysInMonth = new Date(calYear,calMonth,0).getDate();
  const dayMap = {}, almMap = {};
  (calData.days||[]).forEach(d=>{ dayMap[d.day]=d; });
  (calData.alm||[]).forEach(d=>{ almMap[d.day]=d; });
  const all = calData.days||[];
  const totPrec = all.reduce((s,d)=>s+d.precip,0);
  const rainy = all.filter(d=>d.precip>0.5).length;
  const sunny = all.filter(d=>[32,34,30].includes(d.iconCode)).length;
  const avgH = all.length?(all.reduce((s,d)=>s+d.high,0)/all.length).toFixed(1):0;
  const avgL = all.length?(all.reduce((s,d)=>s+d.low,0)/all.length).toFixed(1):0;
  const warmest = all.length?all.reduce((a,b)=>a.high>b.high?a:b):null;
  const wettest = all.length?all.reduce((a,b)=>a.precip>b.precip?a:b):null;

  setContent(`<div class="wx-calendar">
    <div class="wx-tab-intro">Monthly overview · tap any day for details · toggle historical averages</div>
    <div class="wx-cal-nav-row">
      <button class="wx-cal-nav-btn" id="wx-cprev">‹</button>
      <span class="wx-cal-title">${mName} ${calYear}</span>
      <button class="wx-cal-nav-btn" id="wx-cnext">›</button>
    </div>
    <label class="wx-alm-toggle"><input type="checkbox" id="wx-alm" ${showAlm?'checked':''}>Show historical averages</label>
    <div class="wx-cal-grid">
      ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div class="wx-cal-dow">${d}</div>`).join('')}
      ${Array(firstDow).fill('<div class="wx-cal-empty"></div>').join('')}
      ${Array.from({length:daysInMonth},(_,i)=>i+1).map(d=>{
        const day=dayMap[d], alm=almMap[d];
        const isToday=calYear===2026&&calMonth===4&&d===15;
        const isSel=calSel===d;
        const bg=day?hexRgba(tCol(day.high),0.13):'transparent';
        return `<div class="wx-cal-cell${isToday?' wx-today-cell':''}${isSel?' wx-sel-cell':''}" data-d="${d}" style="background:${bg}">
          <div class="wx-cal-dn">${d}</div>
          ${day?`<div class="wx-cal-ic">${wi(day.iconCode)}</div>
            <div class="wx-cal-temps"><span style="color:${tCol(day.high)}">${day.high}°</span><span class="wx-cal-lo"> ${day.low}°</span></div>
            ${day.precip>0?`<div class="wx-cal-precip" style="opacity:${Math.min(day.precip/18,1)}"></div>`:''}
            ${showAlm&&alm?`<div class="wx-cal-alm-val">${alm.avgHigh}°/${alm.avgLow}°</div>`:''}`
          :'<div style="height:42px"></div>'}
        </div>`;
      }).join('')}
    </div>
    ${calSel&&dayMap[calSel]?`<div class="wx-cal-detail">${(()=>{
      const d=dayMap[calSel],a=almMap[calSel];
      return `<div class="wx-cal-det-hd">${mName} ${calSel}, ${calYear}</div>
        <div class="wx-cal-det-row"><span>${wi(d.iconCode)} ${d.condition}</span><span>H:${d.high}° / L:${d.low}°</span></div>
        ${d.precip>0?`<div class="wx-cal-det-row"><span>🌧 Precipitation</span><span>${d.precip} mm</span></div>`:''}
        ${a?`<div class="wx-cal-det-row wx-alm-row"><span>📊 Avg high</span><span>${a.avgHigh}°C ${d.high>a.avgHigh?`<span class="wx-above">+${(d.high-a.avgHigh).toFixed(1)}°</span>`:`<span class="wx-below">${(d.high-a.avgHigh).toFixed(1)}°</span>`}</span></div>
        <div class="wx-cal-det-row wx-alm-row"><span>🌧 Normal precip</span><span>${a.avgPrecip} mm/day</span></div>`:''}`
    })()}</div>`:''}
    <div class="wx-section-lbl">Monthly Summary · ${mName}</div>
    <div class="wx-ms-grid">
      ${[['🌧',totPrec.toFixed(1)+' mm','Total Precip'],['🌦',rainy,'Rainy Days'],['☀️',sunny,'Sunny Days'],
         ['🌡',avgH+'°','Avg High'],['❄️',avgL+'°','Avg Low'],
         warmest?['🔥',warmest.high+'°',`Warmest (${warmest.day})`]:null,
         wettest&&wettest.precip>0?['💧',wettest.precip+' mm',`Wettest (${wettest.day})`]:null
        ].filter(Boolean).map(([ic,v,l])=>
        `<div class="wx-ms-card"><div class="wx-ms-ic">${ic}</div><div class="wx-ms-v">${v}</div><div class="wx-ms-l">${l}</div></div>`).join('')}
    </div>
    <div style="height:16px"></div>
  </div>`);

  $('wx-cprev')?.addEventListener('click',()=>{ calMonth--; if(calMonth<1){calMonth=12;calYear--;} calData=null;calSel=null; renderCalendarView(); });
  $('wx-cnext')?.addEventListener('click',()=>{ calMonth++; if(calMonth>12){calMonth=1;calYear++;} calData=null;calSel=null; renderCalendarView(); });
  $('wx-alm')?.addEventListener('change',e=>{ showAlm=e.target.checked; drawCalendar(); });
  qsa('.wx-cal-cell[data-d]').forEach(cell=>cell.addEventListener('click',()=>{ const d=parseInt(cell.dataset.d); calSel=calSel===d?null:d; drawCalendar(); }));
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
async function renderHistoryView() {
  if (!histData) {
    setContent('<div class="wx-loading"><div class="wx-spinner"></div><p>Loading history…</p></div>');
    try { histData = await api(`/api/weather/history?start=${histStart}&end=${histEnd}`); }
    catch(e) { setContent(`<div class="wx-error">⚠️ ${e.message}</div>`); return; }
  }
  drawHistory();
}

function drawHistory() {
  const days = histData||[];
  if (!days.length) { setContent('<div class="wx-error">No data for selected range.</div>'); return; }
  const maxT=Math.max(...days.map(d=>d.maxTemp)), minT=Math.min(...days.map(d=>d.minTemp));
  const totP=days.reduce((s,d)=>s+d.precip,0), avgH=Math.round(days.reduce((s,d)=>s+d.humidity,0)/days.length);
  const maxW=Math.max(...days.map(d=>d.windMax));
  const maxTD=days.find(d=>d.maxTemp===maxT), minTD=days.find(d=>d.minTemp===minT);
  const maxPD=days.reduce((a,b)=>a.precip>b.precip?a:b);
  const sorted=[...days].sort((a,b)=>{
    const av=a[histSortCol],bv=b[histSortCol];
    return typeof av==='string'?histSortDir*av.localeCompare(bv):histSortDir*(av-bv);
  });
  setContent(`<div class="wx-history">
    <div class="wx-tab-intro">Pick a date range to see past weather · tap columns to sort · export to CSV</div>
    <div class="wx-hist-ctrl">
      <div class="wx-hist-field"><label>From</label><input type="date" id="wx-hs" value="${histStart}" max="2026-04-15" min="2025-01-01"></div>
      <div class="wx-hist-field"><label>To</label><input type="date" id="wx-he" value="${histEnd}" max="2026-04-15" min="2025-01-01"></div>
      <button class="wx-hist-go" id="wx-hgo">Go</button>
    </div>
    <div class="wx-section-lbl">Summary · ${days.length} days</div>
    <div class="wx-hs-grid">
      <div class="wx-hs-card" style="border-color:#f97316"><div class="wx-hs-v" style="color:#f97316">${maxT}°C</div><div class="wx-hs-l">Max Temp</div><div class="wx-hs-d">${maxTD?.date?.slice(5)||''}</div></div>
      <div class="wx-hs-card" style="border-color:#60a5fa"><div class="wx-hs-v" style="color:#60a5fa">${minT}°C</div><div class="wx-hs-l">Min Temp</div><div class="wx-hs-d">${minTD?.date?.slice(5)||''}</div></div>
      <div class="wx-hs-card" style="border-color:#2563eb"><div class="wx-hs-v">${totP.toFixed(1)}</div><div class="wx-hs-l">Total mm</div></div>
      <div class="wx-hs-card" style="border-color:#0ea5e9"><div class="wx-hs-v">${avgH}%</div><div class="wx-hs-l">Avg Humidity</div></div>
      <div class="wx-hs-card" style="border-color:#64748b"><div class="wx-hs-v">${maxW}</div><div class="wx-hs-l">Max Wind km/h</div></div>
      <div class="wx-hs-card" style="border-color:#0284c7"><div class="wx-hs-v">${maxPD?.precip||0}</div><div class="wx-hs-l">Max Rain mm</div><div class="wx-hs-d">${maxPD?.date?.slice(5)||''}</div></div>
    </div>
    <div class="wx-section-lbl">Temperature Range (°C)</div>
    <div class="wx-chart-wrap"><canvas id="wx-htc" height="140"></canvas></div>
    <div class="wx-section-lbl">Daily Precipitation (mm)</div>
    <div class="wx-chart-wrap"><canvas id="wx-hpc" height="100"></canvas></div>
    <div class="wx-section-lbl">Observations <small style="font-weight:400;font-size:10px">(tap column to sort)</small></div>
    <div class="wx-obs-wrap"><div class="wx-obs-tbl">
      <div class="wx-obs-head">
        <span class="wx-sh" data-c="date">Date</span><span></span>
        <span class="wx-sh" data-c="maxTemp">Max°</span><span class="wx-sh" data-c="minTemp">Min°</span>
        <span class="wx-sh" data-c="avgTemp">Avg°</span><span class="wx-sh" data-c="precip">mm</span>
        <span class="wx-sh" data-c="humidity">H%</span>
      </div>
      ${sorted.map(d=>`<div class="wx-obs-row${d.maxTemp===maxT?' wx-row-hot':''}${d.minTemp===minT?' wx-row-cold':''}${d.date===maxPD?.date?' wx-row-wet':''}">
        <span>${d.date.slice(5)}</span><span>${wi(d.iconCode)}</span>
        <span style="color:${tCol(d.maxTemp)}">${d.maxTemp}°</span><span style="color:${tCol(d.minTemp)}">${d.minTemp}°</span>
        <span>${d.avgTemp}°</span><span>${d.precip>0?d.precip:'—'}</span><span>${d.humidity}%</span>
      </div>`).join('')}
    </div></div>
    <div class="wx-hist-actions"><button class="wx-export-btn" id="wx-exp">⬇️ Export CSV</button></div>
    <div style="height:16px"></div>
  </div>`);

  $('wx-hgo')?.addEventListener('click',async()=>{
    const s=$('wx-hs')?.value, e=$('wx-he')?.value;
    if(s&&e&&s<=e){ histStart=s; histEnd=e; histData=null; renderHistoryView(); }
  });
  $('wx-exp')?.addEventListener('click',()=>{
    const csv=['date,max,min,avg,precip,humidity,wind'].concat(days.map(d=>`${d.date},${d.maxTemp},${d.minTemp},${d.avgTemp},${d.precip},${d.humidity},${d.windMax}`)).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`amsterdam_${histStart}_${histEnd}.csv`; a.click();
  });
  qsa('.wx-sh').forEach(th=>th.addEventListener('click',()=>{
    const c=th.dataset.c;
    if(histSortCol===c) histSortDir*=-1; else { histSortCol=c; histSortDir=1; }
    drawHistory();
  }));
  requestAnimationFrame(()=>{ drawHistTempChart(days); drawHistPrecipChart(days); });
}

function drawHistTempChart(days) {
  const c=$('wx-htc'); if(!c||!window.Chart)return;
  charts.ht=new Chart(c,{type:'line',data:{labels:days.map(d=>d.date.slice(5)),datasets:[
    {label:'Max',data:days.map(d=>d.maxTemp),borderColor:'#f97316',backgroundColor:'rgba(249,115,22,0.08)',fill:'+1',tension:0.3,pointRadius:2},
    {label:'Avg',data:days.map(d=>d.avgTemp),borderColor:'#22c55e',fill:false,tension:0.3,pointRadius:0,borderDash:[3,2]},
    {label:'Min',data:days.map(d=>d.minTemp),borderColor:'#60a5fa',fill:false,tension:0.3,pointRadius:2}
  ]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:true,position:'top',labels:{font:{size:9},boxWidth:10}}},
    scales:{x:{ticks:{maxTicksLimit:8,font:{size:8},color:'#888',maxRotation:45},grid:{display:false}},y:{ticks:{font:{size:9},color:'#888',callback:v=>`${v}°`},grid:{color:'rgba(0,0,0,0.05)'}}}}});
}

function drawHistPrecipChart(days) {
  const c=$('wx-hpc'); if(!c||!window.Chart)return;
  charts.hp=new Chart(c,{type:'bar',data:{labels:days.map(d=>d.date.slice(5)),datasets:[{data:days.map(d=>d.precip),backgroundColor:days.map(d=>piCol(d.precip)),borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.raw} mm`}}},
      scales:{x:{ticks:{maxTicksLimit:8,font:{size:8},color:'#888',maxRotation:45},grid:{display:false}},y:{ticks:{font:{size:9},color:'#888',callback:v=>`${v}mm`},grid:{color:'rgba(0,0,0,0.05)'}}}}});
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
function renderSearchView() {
  setContent(`<div class="wx-search">
    <div class="wx-loc-card">
      <div class="wx-loc-top">
        <span class="wx-loc-flag">${loc.flag||'🌍'}</span>
        <div class="wx-loc-text"><div class="wx-loc-name">${loc.name}</div><div class="wx-loc-country">${loc.country}</div></div>
        <div class="wx-loc-coords">${loc.lat.toFixed(3)}°N<br>${loc.lon.toFixed(3)}°E</div>
      </div>
      <div class="wx-loc-chips">
        <span class="wx-loc-chip">UTC+2 CEST</span>
        <span class="wx-loc-chip">Station: ${loc.station||'—'}</span>
        <span class="wx-loc-chip">Alt: ${loc.alt||2}m ASL</span>
      </div>
    </div>
    <div class="wx-sbox-wrap">
      <div class="wx-sbox">
        <span class="wx-sbox-ic">🔍</span>
        <input type="search" id="wx-si" class="wx-sinput" placeholder="e.g. London, Tokyo, New York…" autocomplete="off" spellcheck="false">
        <button class="wx-sclr" id="wx-sc" style="display:none">✕</button>
      </div>
      <div class="wx-search-tip">Type a city name, then tap a result to switch location</div>
    </div>
    <div id="wx-sr">
      <div class="wx-section-lbl">Recent</div>
      <div class="wx-recent">
        ${recentSearches.length?recentSearches.map(r=>`<div class="wx-rec-item" data-q="${esc(r.split(',')[0].trim().toLowerCase())}"><span>🕒</span><span class="wx-rec-txt">${esc(r)}</span><button class="wx-rec-del" data-r="${esc(r)}" aria-label="Remove ${esc(r)}">Remove</button></div>`).join(''):'<div class="wx-empty-hint">No recent searches</div>'}
      </div>
      <div class="wx-section-lbl">Popular Cities</div>
      <div class="wx-popular">
        ${[['amsterdam','🇳🇱','Amsterdam'],['rotterdam','🇳🇱','Rotterdam'],['london','🇬🇧','London'],['paris','🇫🇷','Paris'],['berlin','🇩🇪','Berlin'],['rome','🇮🇹','Rome']].map(([q,f,n])=>
          `<button class="wx-pop" data-q="${q}">${f} ${n}</button>`).join('')}
      </div>
    </div>
    <div style="height:16px"></div>
  </div>`);

  const input=$('wx-si'), clr=$('wx-sc');
  input?.addEventListener('input',e=>{ const q=e.target.value.trim(); clr.style.display=q?'':'none'; clearTimeout(searchTO); if(q.length>=2) searchTO=setTimeout(()=>doSearch(q),300); else showDefaults(); });
  clr?.addEventListener('click',()=>{ input.value=''; clr.style.display='none'; showDefaults(); });
  qsa('.wx-rec-del').forEach(btn=>btn.addEventListener('click',e=>{ e.stopPropagation(); recentSearches=recentSearches.filter(r=>r!==btn.dataset.r); localStorage.setItem('wx_recent',JSON.stringify(recentSearches)); renderSearchView(); }));
  qsa('.wx-rec-item').forEach(item=>item.addEventListener('click',()=>{ if(input){input.value=item.dataset.q;clr.style.display='';} doSearch(item.dataset.q); }));
  qsa('.wx-pop').forEach(btn=>btn.addEventListener('click',()=>{ if(input){input.value=btn.dataset.q;clr.style.display='';} doSearch(btn.dataset.q); }));
}

function showDefaults() {
  const sr = document.getElementById('wx-sr');
  if (!sr) { renderSearchView(); return; }
  const recHtml = recentSearches.length
    ? recentSearches.map(r=>`<div class="wx-rec-item" data-q="${esc(r.split(',')[0].trim().toLowerCase())}"><span>🕒</span><span class="wx-rec-txt">${esc(r)}</span><button class="wx-rec-del" data-r="${esc(r)}" aria-label="Remove ${esc(r)}">Remove</button></div>`).join('')
    : '<div class="wx-empty-hint">No recent searches</div>';
  sr.innerHTML = `<div class="wx-section-lbl">Recent</div><div class="wx-recent">${recHtml}</div>
    <div class="wx-section-lbl">Popular Cities</div>
    <div class="wx-popular">${[['amsterdam','🇳🇱','Amsterdam'],['rotterdam','🇳🇱','Rotterdam'],['london','🇬🇧','London'],['paris','🇫🇷','Paris'],['berlin','🇩🇪','Berlin'],['rome','🇮🇹','Rome']].map(([q,f,n])=>`<button class="wx-pop" data-q="${q}">${f} ${n}</button>`).join('')}</div>`;
  const input = document.getElementById('wx-si'), clr = document.getElementById('wx-sc');
  sr.querySelectorAll('.wx-rec-del').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();recentSearches=recentSearches.filter(r=>r!==btn.dataset.r);localStorage.setItem('wx_recent',JSON.stringify(recentSearches));showDefaults();}));
  sr.querySelectorAll('.wx-rec-item').forEach(item=>item.addEventListener('click',()=>{if(input){input.value=item.dataset.q;if(clr)clr.style.display='';}doSearch(item.dataset.q);}));
  sr.querySelectorAll('.wx-pop').forEach(btn=>btn.addEventListener('click',()=>{if(input){input.value=btn.dataset.q;if(clr)clr.style.display='';}doSearch(btn.dataset.q);}));
}

async function doSearch(q) {
  const el=$('wx-sr'); if(!el)return;
  if(!/[a-zA-Z\u00C0-\u024F]/.test(q)){ el.innerHTML='<div class="wx-empty-hint">Try a city name like <strong>London</strong> or <strong>Berlin</strong></div>'; return; }
  el.innerHTML='<div class="wx-search-loading">🔍 Searching…</div>';
  try {
    const results=await api(`/api/weather/search?q=${encodeURIComponent(q)}`);
    if(!results.length){ el.innerHTML=`<div class="wx-empty-hint">No results for "${esc(q)}"</div>`; return; }
    el.innerHTML=`<div class="wx-section-lbl">Results</div><div class="wx-results">${results.map(r=>`
      <div class="wx-result" data-r='${JSON.stringify(r).replace(/'/g,"&#39;")}'>
        <div class="wx-res-flag">${r.flag}</div>
        <div class="wx-res-info">
          <div class="wx-res-name">${r.displayName}</div>
          <div class="wx-res-addr">${r.address}</div>
          <div class="wx-res-meta"><span class="wx-type-badge">${r.type}</span><span>${r.lat.toFixed(2)}°N · ${r.lon.toFixed(2)}°E</span></div>
        </div>
      </div>`).join('')}</div>`;
    qsa('.wx-result').forEach(item=>item.addEventListener('click',()=>{
      try {
        item.style.background = 'rgba(0,122,255,0.12)';
        setTimeout(() => selectLoc(JSON.parse(item.dataset.r)), 180);
      } catch(e) {}
    }));
  } catch(e) { el.innerHTML=`<div class="wx-empty-hint">Search failed</div>`; }
}

function selectLoc(r) {
  const isSameCity = r.displayName === loc.name && r.countryCode === loc.country;
  if (isSameCity) {
    if (typeof showToast === 'function') showToast(`Already showing ${loc.name}`);
    return;
  }
  loc={name:r.displayName,country:r.countryCode,flag:r.flag,lat:r.lat,lon:r.lon,station:r.locId||r.icaoCode||'',tz:r.timezone,alt:r.alt||10};
  const entry=`${r.displayName}, ${r.countryCode}`;
  recentSearches=[entry,...recentSearches.filter(x=>x!==entry)].slice(0,5);
  localStorage.setItem('wx_recent',JSON.stringify(recentSearches));
  const ttl=document.getElementById('wx-location-title')||document.querySelector('#weather-screen .sub-bar-title');
  if(ttl) { ttl.textContent=`${loc.flag||'🌤️'} ${loc.name}`; ttl.classList.remove('wx-city-changed'); void ttl.offsetWidth; ttl.classList.add('wx-city-changed'); }
  if(typeof showToast==='function') showToast(`Switched to ${loc.name}`);
  cache={}; histData=null; calData=null;
  loadGeneration++;
  loadBusy = false;
  suppressRefreshToast = true;
  loadAll(); switchTab('today');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
function init() {
  qsa('.wx-tab').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));
  loadAll();
}

return { init, loadAll, switchTab, get busy() { return loadBusy; } };
})();

// Auto-initialise tab click handlers once DOM is ready
document.addEventListener('DOMContentLoaded', () => WX.init());
