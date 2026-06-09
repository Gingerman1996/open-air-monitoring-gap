/* ============================================================
   Mock data for the demo — CITY level.
   ~35 world cities spanning the burden spectrum: wealthy cities
   densely monitored & low mortality; high-pollution cities barely
   monitored & high mortality. Monitors are scattered tightly
   around each city so they cluster per-city when zoomed out.
   Exposes: window.CITIES, window.MONITORS, window.AQ
   ============================================================ */
(function () {
  // name, Thai name, country, iso2, lat, lng, metro population,
  // avg pm2.5 (µg/m³), deaths_per_100k/yr (PM2.5-attributable), planned monitors
  const C = [
    // wealthy / low burden — densely monitored
    ['Berlin','เบอร์ลิน','Germany','DE',52.520,13.405,3700000,12,11,40],
    ['Paris','ปารีส','France','FR',48.857,2.352,11000000,14,12,38],
    ['London','ลอนดอน','United Kingdom','GB',51.507,-0.127,9000000,11,13,44],
    ['New York','นิวยอร์ก','United States','US',40.713,-74.006,18800000,8,12,56],
    ['Los Angeles','ลอสแอนเจลิส','United States','US',34.052,-118.244,12500000,13,14,46],
    ['Sydney','ซิดนีย์','Australia','AU',-33.868,151.209,5300000,7,6,26],
    ['Tokyo','โตเกียว','Japan','JP',35.689,139.692,37000000,12,18,52],
    ['Madrid','มาดริด','Spain','ES',40.416,-3.703,6600000,11,16,24],
    ['Toronto','โทรอนโต','Canada','CA',43.651,-79.383,6200000,8,9,28],
    ['Stockholm','สตอกโฮล์ม','Sweden','SE',59.329,18.068,2400000,6,6,18],
    // middle burden
    ['Bangkok','กรุงเทพฯ','Thailand','TH',13.756,100.501,10700000,26,56,16],
    ['Manila','มะนิลา','Philippines','PH',14.599,120.984,13900000,30,60,9],
    ['Istanbul','อิสตันบูล','Türkiye','TR',41.008,28.978,15500000,24,52,14],
    ['Mexico City','เม็กซิโกซิตี','Mexico','MX',19.432,-99.133,21800000,22,40,20],
    ['São Paulo','เซาเปาลู','Brazil','BR',-23.550,-46.633,22400000,17,18,22],
    ['Nairobi','ไนโรบี','Kenya','KE',-1.286,36.817,4900000,36,68,5],
    ['Accra','อักกรา','Ghana','GH',5.603,-0.187,5400000,38,70,4],
    ['Tehran','เตหะราน','Iran','IR',35.689,51.389,9400000,38,70,8],
    ['Johannesburg','โจฮันเนสเบิร์ก','South Africa','ZA',-26.204,28.047,6200000,25,55,7],
    ['Tashkent','ทาชเคนต์','Uzbekistan','UZ',41.299,69.240,2900000,40,70,5],
    // high burden — barely monitored
    ['Delhi','เดลี','India','IN',28.704,77.102,32900000,92,120,18],
    ['Mumbai','มุมไบ','India','IN',19.076,72.877,21000000,55,110,12],
    ['Kolkata','โกลกาตา','India','IN',22.572,88.363,15000000,65,115,8],
    ['Lahore','ลาฮอร์','Pakistan','PK',31.520,74.358,13500000,100,125,5],
    ['Karachi','การาจี','Pakistan','PK',24.860,67.001,16800000,64,118,6],
    ['Dhaka','ธากา','Bangladesh','BD',23.810,90.412,22000000,80,122,7],
    ['Kathmandu','กาฐมาณฑุ','Nepal','NP',27.717,85.324,1500000,60,105,3],
    ['Beijing','ปักกิ่ง','China','CN',39.904,116.407,21500000,40,93,30],
    ['Cairo','ไคโร','Egypt','EG',30.044,31.236,21300000,58,89,5],
    ['Lagos','ลากอส','Nigeria','NG',6.524,3.379,15400000,50,96,3],
    ['Kinshasa','กินชาซา','DR Congo','CD',-4.322,15.307,16000000,45,85,1],
    ['Jakarta','จาการ์ตา','Indonesia','ID',-6.208,106.846,11000000,42,74,10],
    ['Kabul','คาบูล','Afghanistan','AF',34.555,69.207,4600000,70,110,2],
    ['Baghdad','แบกแดด','Iraq','IQ',33.315,44.366,7500000,60,85,3],
    ['Hanoi','ฮานอย','Vietnam','VN',21.028,105.804,8100000,48,65,6]
  ];
  const rand=(a,b)=>a+Math.random()*(b-a);
  const pick=a=>a[Math.floor(Math.random()*a.length)];
  const OWN=['Community','University','City Government','NGO','Private'];

  function aqiFromPm(p){
    const bp=[[0,12,0,50],[12.1,35.4,51,100],[35.5,55.4,101,150],[55.5,150.4,151,200],[150.5,250.4,201,300],[250.5,500,301,500]];
    for(const [cl,ch,al,ah] of bp){ if(p<=ch) return Math.round((ah-al)/(ch-cl)*(p-cl)+al); }
    return 500;
  }
  function aqiColor(a){
    if(a<=50) return '#36A45C';
    if(a<=100) return '#E4BB36';
    if(a<=150) return '#E68A38';
    if(a<=200) return '#D8484A';
    if(a<=300) return '#8C56AE';
    return '#7C3B3B';
  }
  function healthColor(d){
    if(d<15) return '#36A45C';
    if(d<35) return '#E4BB36';
    if(d<65) return '#E68A38';
    if(d<95) return '#D8484A';
    return '#7C3B3B';
  }

  const CITIES = C.map(r=>{
    const [name,nameTh,country,iso2,lat,lng,pop,pm25,deaths,mon]=r;
    return {name,nameTh,country,iso2,lat,lng,pop,avg_pm25:pm25,deaths_per_100k:deaths,monitors_planned:mon};
  });

  const MONITORS=[];
  let id=1000;
  CITIES.forEach(c=>{
    const spread = 0.10 + Math.min(c.pop/1e8,0.16); // larger metros spread a bit more
    for(let i=0;i<c.monitors_planned;i++){
      id++;
      const lat=c.lat+rand(-spread,spread);
      const lng=c.lng+rand(-spread,spread)/Math.max(0.4,Math.cos(c.lat*Math.PI/180));
      const pm=Math.max(3,c.avg_pm25+rand(-10,14));
      const type=Math.random()<0.16?'reference':'low_cost';
      const oaf=c.deaths_per_100k>55 && type==='low_cost' && Math.random()<0.55;
      const mfg=oaf?'AirGradient':(type==='reference'?'Reference (Gov)':pick(['AirGradient','PurpleAir','Clarity','Sensirion']));
      MONITORS.push({
        id:'AG-'+id, name:c.iso2+'-'+String(i+1).padStart(3,'0'),
        city:c.name, country:c.country, iso2:c.iso2,
        lat:+lat.toFixed(4), lng:+lng.toFixed(4),
        manufacturer:mfg, type, owner:oaf?'NGO':pick(OWN), oaf,
        status:Math.random()<0.9?'online':'offline',
        pm25:+pm.toFixed(1), aqi:aqiFromPm(pm)
      });
    }
  });

  CITIES.forEach(c=>{
    const ms=MONITORS.filter(m=>m.city===c.name);
    c.monitors_total=ms.length;
    c.monitors_online=ms.filter(m=>m.status==='online').length;
    c.reference=ms.filter(m=>m.type==='reference').length;
    c.low_cost=ms.filter(m=>m.type==='low_cost').length;
    c.oaf=ms.filter(m=>m.oaf).length;
    c.cur_pm25=+(ms.reduce((s,m)=>s+m.pm25,0)/Math.max(ms.length,1)).toFixed(1);
    c.cur_aqi=aqiFromPm(c.cur_pm25);
    c.monitors_per_100k=+(c.monitors_total/(c.pop/100000)).toFixed(3);
    c.gap_ratio=+(c.deaths_per_100k/Math.max(c.monitors_per_100k,0.001)).toFixed(1);
  });

  const sorted=[...CITIES].map(c=>c.monitors_per_100k).sort((a,b)=>a-b);
  const medianDensity=sorted[Math.floor(sorted.length/2)];

  window.CITIES=CITIES;
  window.MONITORS=MONITORS;
  window.AQ={aqiFromPm,aqiColor,healthColor,medianDensity};

  /* Country-level deaths attributable to PM2.5 (absolute, rough GBD/SoGA-style
     estimates) + population, keyed by world-atlas (Natural Earth) names.
     Drives the country choropleth. [deaths_per_year, population_millions] */
  const CDraw={
    'India':[1600000,1417],'China':[1300000,1412],
    'Indonesia':[220000,275],'Pakistan':[256000,235],'Bangladesh':[173000,171],
    'United States of America':[90000,333],'Russia':[130000,144],'Brazil':[66000,215],'Japan':[75000,125],
    'Germany':[72000,83],'Egypt':[90000,110],'Nigeria':[100000,218],'Vietnam':[70000,98],'Philippines':[66000,114],
    'Myanmar':[80000,54],'Turkey':[70000,85],'Iran':[70000,88],'Mexico':[64000,128],'Ukraine':[64000,43],
    'Ethiopia':[90000,123],'Dem. Rep. Congo':[80000,99],'Thailand':[64000,72],
    'United Kingdom':[30000,67],'France':[40000,68],'Italy':[45000,59],'Spain':[25000,47],'Poland':[45000,38],
    'South Africa':[40000,60],'Argentina':[30000,46],'Colombia':[30000,52],'Iraq':[35000,43],'Afghanistan':[50000,41],
    'Uzbekistan':[40000,35],'Sudan':[40000,46],'Tanzania':[45000,65],'Kenya':[35000,54],'Uganda':[30000,47],
    'Nepal':[42000,30],'Morocco':[30000,37],'Algeria':[30000,44],'Saudi Arabia':[30000,36],'Peru':[25000,34],
    'Kazakhstan':[25000,19],'Ghana':[25000,33],'Malaysia':[25000,33],'South Korea':[30000,52],'Netherlands':[21000,17],
    'Canada':[18000,38],'Australia':[9000,26],'Sweden':[4000,10],'Norway':[3000,5],'Finland':[4000,6],'Chile':[18000,19]
  };
  const COUNTRY_DEATHS={};
  Object.keys(CDraw).forEach(k=>{ COUNTRY_DEATHS[k]={deaths:CDraw[k][0],pop:CDraw[k][1]*1e6}; });
  window.COUNTRY_DEATHS=COUNTRY_DEATHS;
})();
