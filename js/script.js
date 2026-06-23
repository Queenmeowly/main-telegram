const SUPABASE_URL = "https://hnroxfhnuuksxwwyxmls.supabase.co";

const SUPABASE_KEY = "sb_publishable_6_c3kWy6NMIKxTloNvtZnQ_T7n34tPH";

const db = supabase.createClient(
SUPABASE_URL,
SUPABASE_KEY
);

// ================= TELEGRAM LOGIN =================

console.log("INIT DATA:", window.Telegram?.WebApp?.initDataUnsafe);
console.log("TG USER:", window.Telegram?.WebApp?.initDataUnsafe?.user);

let USER = null;
let USER_NAME = "";
let USER_USERNAME = "";
let USER_PHOTO = "";

if (
    window.Telegram &&
    window.Telegram.WebApp &&
    window.Telegram.WebApp.initDataUnsafe &&
    window.Telegram.WebApp.initDataUnsafe.user
) {

    window.Telegram.WebApp.ready();

    const tgUser = window.Telegram.WebApp.initDataUnsafe.user;

    USER = String(tgUser.id);
    USER_NAME = tgUser.first_name || "";
    USER_USERNAME = tgUser.username || "";
    USER_PHOTO = tgUser.photo_url || "";

    console.log("Telegram User:", USER, USER_NAME);

} else {

    console.warn("Telegram WebApp not detected, fallback user");

    let stored = localStorage.getItem("user_id");

    if (!stored) {
        stored = String(Date.now());
        localStorage.setItem("user_id", stored);
    }

    USER = String(stored);
    USER_NAME = "Test User";
    USER_USERNAME = "test";
    USER_PHOTO = "";
}

// فقط این try باید بیرون باشه (درست و ساده)
document.addEventListener("DOMContentLoaded", () => {
    try {
        updateDebugPanel("USER SET: " + USER + " | NAME: " + USER_NAME + " | USERNAME: " + USER_USERNAME);
    } catch (e) {}
});
document.addEventListener("DOMContentLoaded", () => {
  updateDebugPanel("USER SET: " + USER);
});
// Force-disable debug panel (prevent save/status UI from appearing)
const DEBUG_PANEL_ENABLED = false;
let coins = Number(localStorage.getItem('coins')) || 0;
let energy = Number(localStorage.getItem('energy')) || 100;

let powerLv = Number(localStorage.getItem('powerLv')) || 1;
let energyLv = Number(localStorage.getItem('energyLv')) || 1;
let mineLv = Number(localStorage.getItem('mineLv')) || 1;
let chargeLv = Number(localStorage.getItem('chargeLv')) || 1;

let maxEnergy = Number(localStorage.getItem('maxEnergy')) || 100;

let energyTimerEnd = Number(localStorage.getItem('energyTimerEnd')) || 0;
const ENERGY_INTERVAL = 30 * 60; // seconds (default 30 minutes)

let energyGain = energyLv;
const particles = [];

// save control
let _saveInProgress = false;
let _savePending = false;
// when we apply offline grants, store the timestamp of the last grant to persist to server
let _pendingLastGrant = null;

// Debug/status panel for environments without a console (Telegram WebView)
function ensureDebugPanel(){
	// intentionally no-op to prevent creation of the save/status UI
	return;
}

function updateDebugPanel(msg){
	// intentionally no-op so no debug messages are shown in UI
	return;
}

// ================= SAVE =================
async function saveOnline(){
	// simple single-writer lock to avoid race conditions when saveOnline is called rapidly
	if(_saveInProgress){
		_savePending = true;
		return;
	}

	_saveInProgress = true;
	try{
		updateDebugPanel('saveOnline() - USER: ' + String(USER));
		console.log("SAVE DATA:", {
telegram_id: USER,			coins,
			energy,
			power: powerLv,
			max_energy: maxEnergy
		});
		updateDebugPanel('SAVE DATA: coins=' + String(coins) + ' energy=' + String(energy) + ' power=' + String(powerLv));

		const minimalPayload = {
telegram_id: USER,
			coins: Number(coins),
			energy: Number(energy),
			power: Number(powerLv),
			max_energy: Number(maxEnergy)
		};

		// include last_grant only when we specifically set one (from offline grant computation)
		if(_pendingLastGrant){
			minimalPayload.last_grant = _pendingLastGrant;
		}

		// persist the next scheduled grant time so timer continues across devices/refreshes
		if(energyTimerEnd && energy < maxEnergy){
			try{
				minimalPayload.energy_timer_end = new Date(Number(energyTimerEnd)).toISOString();
			}catch(e){ /* ignore */ }
		}

		// use array form and request representation so we get the saved row back
		const { data, error, status } = await db.from('users').upsert([minimalPayload], { onConflict: 'telegram_id', returning: 'representation' });

		if(error){
			console.warn('supabase upsert error', status, error);
			updateDebugPanel('supabase upsert error: ' + status + ' ' + JSON.stringify(error));
			// try an update fallback (if upsert fails for some reason)
			try{
				const { data: d2, error: e2, status: s2 } = await db.from('users').update(minimalPayload).eq('telegram_id', USER).select();
				if(e2) console.warn('supabase update fallback error', s2, e2);
				if(e2) updateDebugPanel('supabase update fallback error: ' + s2 + ' ' + JSON.stringify(e2));
				else {
					console.log('update fallback saved:', d2);
					updateDebugPanel('update fallback saved: ' + JSON.stringify(d2));
					// sync local values to returned row if present
					if(Array.isArray(d2) && d2[0]){
						const row = d2[0];
						coins = row.coins ?? coins;
						energy = row.energy ?? energy;
						localStorage.setItem('coins', String(coins));
						localStorage.setItem('energy', String(energy));
						// update succeeded — clear pending last_grant so we don't resend it
						_pendingLastGrant = null;
					}
				}
			}catch(ex){
				console.error('update fallback unexpected error', ex);
			}
		} else {
			console.log('saved (upsert):', USER, coins, data);
			updateDebugPanel('saved (upsert) — telegram_id: ' + String(USER) + '\n' + JSON.stringify(data));
			Telegram.WebApp && Telegram.WebApp.HapticFeedback && Telegram.WebApp.HapticFeedback.notificationOccurred && Telegram.WebApp.HapticFeedback.notificationOccurred("success");
			// if server returned the saved row, sync it to localStorage to keep refresh stable
			if(Array.isArray(data) && data[0]){
				const row = data[0];
				coins = row.coins ?? coins;
				energy = row.energy ?? energy;
				powerLv = row.power ?? powerLv;
				maxEnergy = row.max_energy ?? maxEnergy;
				localStorage.setItem('coins', String(coins));
				localStorage.setItem('energy', String(energy));
				localStorage.setItem('powerLv', String(powerLv));
				localStorage.setItem('maxEnergy', String(maxEnergy));
					// successful save — clear pending last_grant
					_pendingLastGrant = null;
			}
		}

		// verify by selecting the row we just upserted and log it
		try{
			const { data: verifyRow, error: verifyErr } = await db.from('users').select('*').eq('telegram_id', USER).maybeSingle();
			updateDebugPanel('verify select after saveOnline: ' + JSON.stringify(verifyRow) + ' err:' + String(verifyErr));
		}catch(vE){
			console.warn('verify select failed', vE);
		}

	}catch(err){
		console.error('saveOnline unexpected error', err);
	}finally{
		_saveInProgress = false;
		// if there was a pending save requested while we were saving, do one more
		if(_savePending){
			_savePending = false;
			// schedule next tick so we don't recurse deeply
			setTimeout(()=>saveOnline(), 50);
		}
	}
}
// ================= UI =================
function render(){
document.getElementById("coinsValue").innerText = coins;
document.getElementById("energy").innerText = `${energy}/${maxEnergy}`;
}

// ================ UPGRADES UI / LOGIC =================
const basePrices = { power:10, energy:30, mine:60, charge:80 };
function priceFor(kind, lvl){
	const base = basePrices[kind] || 10;
	return Math.max(1, Math.floor(base * Math.pow(1.6, lvl-1)));
}

function updateUpgradeUI(){
	// levels
	const p = document.getElementById("powerLv"); if(p) p.innerText = powerLv;
	const e = document.getElementById("energyLv"); if(e) e.innerText = energyLv;
	const m = document.getElementById("mineLv"); if(m) m.innerText = mineLv;
	const c = document.getElementById("chargeLv"); if(c) c.innerText = chargeLv;
	// prices
	const pp = document.getElementById("powerPrice"); if(pp) pp.innerText = priceFor('power', powerLv);
	const ep = document.getElementById("energyPrice"); if(ep) ep.innerText = priceFor('energy', energyLv);
	const mp = document.getElementById("minePrice"); if(mp) mp.innerText = priceFor('mine', mineLv);
	const cp = document.getElementById("chargePrice"); if(cp) cp.innerText = priceFor('charge', chargeLv);
}

function recalcDerived(){
	power = powerLv; // simple: 1 coin per power level
	// maxEnergy is controlled by charge level: level1 => 100, level2 => 101, etc.
	maxEnergy = 100 + (chargeLv - 1);
	// amount of energy granted each interval equals energy level
	energyGain = energyLv;
}

function tryUpgrade(kind){
	let lvlVar = 1;

	if(kind==='power') lvlVar = powerLv;
	else if(kind==='energy') lvlVar = energyLv;
	else if(kind==='mine') lvlVar = mineLv;
	else if(kind==='charge') lvlVar = chargeLv;
	else return false;

	const price = priceFor(kind, lvlVar);

	if(coins < price) return false;

	coins -= price;

	if(kind==='power') powerLv++;
	else if(kind==='energy') energyLv++;
	else if(kind==='mine') mineLv++;
	else if(kind==='charge') chargeLv++;

	recalcDerived();

	localStorage.setItem('coins', String(coins));
	localStorage.setItem('powerLv', String(powerLv));
	localStorage.setItem('energyLv', String(energyLv));
	localStorage.setItem('mineLv', String(mineLv));
	localStorage.setItem('chargeLv', String(chargeLv));
	localStorage.setItem('maxEnergy', String(maxEnergy));

	render();
	updateUpgradeUI();
	saveOnline();

	return true;
}

// hook buttons (if present)
// Attach upgrade button handlers reliably (works even if DOMContentLoaded already fired)
function attachUpgradeButtons(){
	const upPower = document.getElementById('upPower'); if(upPower) upPower.onclick = ()=> tryUpgrade('power');
	const upEnergy = document.getElementById('upEnergy'); if(upEnergy) upEnergy.onclick = ()=> tryUpgrade('energy');
	const upMine = document.getElementById('upMine'); if(upMine) upMine.onclick = ()=> tryUpgrade('mine');
	const upCharge = document.getElementById('upCharge'); if(upCharge) upCharge.onclick = ()=> tryUpgrade('charge');
	updateUpgradeUI();

	// compact top menu: hamburger slides left, top buttons appear
	const menuBtn = document.getElementById('menuBtn');
	const topMenuItems = document.querySelector('.top-menu-items');

	function toggleTopMenu(){
		const opened = document.body.classList.toggle('menu-open');
		if(opened){
			document.body.setAttribute('data-menu-open','true');
			topMenuItems && topMenuItems.setAttribute('aria-hidden','false');
		} else {
			document.body.removeAttribute('data-menu-open');
			topMenuItems && topMenuItems.setAttribute('aria-hidden','true');
		}
	}

	if(menuBtn) menuBtn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleTopMenu(); });

	// close when clicking outside the top menu area
	document.addEventListener('click', (e)=>{
		if(!document.body.classList.contains('menu-open')) return;
		const target = e.target;
		if(target === menuBtn || (topMenuItems && topMenuItems.contains(target))) return;
		document.body.classList.remove('menu-open');
		topMenuItems && topMenuItems.setAttribute('aria-hidden','true');
	});

	// hook simple actions for menu buttons
	const menuProfile = document.getElementById('menuProfile'); if(menuProfile) menuProfile.onclick = ()=>{ alert('Profile (placeholder)'); document.body.classList.remove('menu-open'); };
	const menuStats = document.getElementById('menuStats'); if(menuStats) menuStats.onclick = ()=>{ alert('Stats (placeholder)'); document.body.classList.remove('menu-open'); };
	const menuLeader = document.getElementById('menuLeader'); if(menuLeader) menuLeader.onclick = ()=>{ alert('Leader Board (placeholder)'); document.body.classList.remove('menu-open'); };
}

// ensure handlers attach when DOM is ready
if(document.readyState === 'loading'){
	document.addEventListener('DOMContentLoaded', ()=>{ attachUpgradeButtons(); });
} else {
	// already ready
	attachUpgradeButtons();
}
// ensure derived stats and UI reflect persisted levels immediately
recalcDerived();
updateUpgradeUI();

// ================= ENERGY TIMER UI & LOGIC =================
function formatDuration(sec){
	sec = Math.max(0, Math.floor(sec));
	const m = Math.floor(sec/60);
	const s = sec%60;
	return `${m}m ${s}s`;
}

function ensureEnergyTimerElement(){
	if(document.getElementById("energyTimer")) return;
	const el = document.createElement("div");
	el.id = "energyTimer";
	el.style.fontSize = "13px";
	el.style.marginTop = "6px";
	el.style.color = "#fff";
	const energyEl = document.getElementById("energy");
	if(energyEl && energyEl.parentNode) energyEl.parentNode.appendChild(el);
	else document.body.appendChild(el);
}

function updateEnergyTimer(){
	ensureEnergyTimerElement();
	const el = document.getElementById("energyTimer");

	const now = Date.now();

	if(energy >= maxEnergy){
		el.innerText = "";
		energyTimerEnd = 0;
		localStorage.setItem('energyTimerEnd', String(energyTimerEnd));
		return;
	}

	// if energy is below max and there's no active timer, restore from storage or start a new one
	if(energy < maxEnergy && (!energyTimerEnd || energyTimerEnd <= 0)){
		const stored = Number(localStorage.getItem('energyTimerEnd')) || 0;
		if(stored && stored > now){
			energyTimerEnd = stored;
		} else {
			energyTimerEnd = now + ENERGY_INTERVAL * 1000;
			localStorage.setItem('energyTimerEnd', String(energyTimerEnd));
			// persist this scheduled timer to server so refreshes/devices keep the same countdown
			try{ saveOnline(); }catch(e){}
		}
	}

	// only grant when a timer is active and it has reached 0
	if(energyTimerEnd && energyTimerEnd <= now){
		const intervalMs = ENERGY_INTERVAL * 1000;
		// how many intervals have passed since the scheduled next grant
		const passedMs = now - energyTimerEnd;
		const intervalsPassed = 1 + Math.floor(passedMs / intervalMs);
		const gainPer = (typeof energyGain !== 'undefined' ? energyGain : energyLv);
		const totalGain = intervalsPassed * gainPer;

		const prevEnergy = energy;
		energy = Math.min(maxEnergy, energy + totalGain);

		if(energy < maxEnergy){
			// schedule next grant after the intervals that already passed
			energyTimerEnd = energyTimerEnd + intervalsPassed * intervalMs;
			localStorage.setItem('energyTimerEnd', String(energyTimerEnd));
			// persist updated timer to server
			try{ saveOnline(); }catch(e){}
		} else {
			// reached max — clear timer
			energyTimerEnd = 0;
			localStorage.setItem('energyTimerEnd', String(energyTimerEnd));
			// persist clear timer to server
			try{ saveOnline(); }catch(e){}
		}

		// if energy changed, persist locally and try to save online
		if(energy !== prevEnergy){
			localStorage.setItem('energy', String(energy));
			try{ saveOnline(); }catch(e){}
		}

		render();
	}

	if(energyTimerEnd){
		const remaining = Math.ceil((energyTimerEnd - now) / 1000);
		const gain = (typeof energyGain !== 'undefined' ? energyGain : energyLv);
		el.innerText = `${formatDuration(remaining)} | + ${gain} energy`;
	} else {
		el.innerText = "";
	}
}

// start periodic update every second
setInterval(updateEnergyTimer, 1000);
updateEnergyTimer();

// NOTE: remove immediate startup fallback here — timer should be derived from stored value or server
// (we set/restore `energyTimerEnd` inside `loadOnline()` to preserve continuity across refreshes).

// ================= THREE JS =================
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60,1,0.1,1000);
camera.position.z = 6;

const renderer = new THREE.WebGLRenderer({
alpha:true,
antialias:true
});

renderer.setSize(260,260);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;

document.getElementById("coin3d").appendChild(renderer.domElement);

// ================= LIGHTS =================
scene.add(new THREE.AmbientLight(0xffffff, 5));

const light1 = new THREE.DirectionalLight(0xffffff, 4);
light1.position.set(5,10,5);
scene.add(light1);

const light2 = new THREE.DirectionalLight(0xfff0c2, 2.5);
light2.position.set(-5,-2,5);
scene.add(light2);

// ================= GOLD TEXTURE =================
function goldTexture(){
const c=document.createElement("canvas");
c.width=512;c.height=512;
const x=c.getContext("2d");

let g=x.createRadialGradient(256,256,10,256,256,260);
g.addColorStop(0,"#ffffff");
g.addColorStop(0.3,"#ffeaa0");
g.addColorStop(0.6,"#f2c94c");
g.addColorStop(1,"#b8860b");

x.fillStyle=g;
x.fillRect(0,0,512,512);

// sparkle
for(let i=0;i<180;i++){
x.fillStyle=`rgba(255,255,255,${Math.random()*0.06})`;
x.fillRect(Math.random()*512,Math.random()*512,2,2);
}

// soft glow
x.globalAlpha = 0.25;
x.fillStyle="#fff";
x.fillRect(0,0,512,512);
x.globalAlpha = 1;

// rim
x.strokeStyle="#f0d070";
x.lineWidth=26;
x.beginPath();
x.arc(256,256,200,0,Math.PI*2);
x.stroke();

// star
x.font="bold 170px Arial";
x.textAlign="center";
x.textBaseline="middle";
x.fillStyle="#fff3b0";
x.fillText("⭐",256,256);

return new THREE.CanvasTexture(c);
}

// ================= COIN (FIXED THICKNESS) =================
const coin = new THREE.Mesh(
new THREE.CylinderGeometry(2.7,2.7,0.45,180), // 🔥 نازک‌تر شد
new THREE.MeshStandardMaterial({
map: goldTexture(),
metalness: 1,
roughness: 0.18,
emissive: new THREE.Color(0x2a1a00),
emissiveIntensity: 0.3
})
);

coin.rotation.x = Math.PI/2;
scene.add(coin);

// ================= PARTICLES =================
function spawnParticles(){
for(let i=0;i<22;i++){
particles.push({
x:0,
y:0,
z:0,
vx:(Math.random()-0.5)*2,
vy:(Math.random())*2,
vz:(Math.random()-0.5)*2,
life:45
});
}
}

// ================= ANIMATION =================
function animate(){
requestAnimationFrame(animate);

coin.rotation.z += 0.005;
coin.position.y = Math.sin(Date.now()*0.002)*0.04;

// particles update
for(let i=particles.length-1;i>=0;i--){
const p=particles[i];

p.x += p.vx;
p.y += p.vy;
p.z += p.vz;

p.vy -= 0.03;
p.life--;

const dot = new THREE.Mesh(
new THREE.SphereGeometry(0.06,6,6),
new THREE.MeshBasicMaterial({color:0xffd36b})
);

dot.position.set(p.x,p.y,p.z);
scene.add(dot);

setTimeout(()=>scene.remove(dot),110);

if(p.life<=0) particles.splice(i,1);
}

renderer.render(scene,camera);
}
animate();

// ================= CLICK EFFECT =================
// Attach interactive handlers safely (call after DOM ready)
function attachHandlers(){
	const el = document.getElementById("coin3d");
	if(el){
		el.onclick = async () => {
			try{
				if(energy <= 0) return;

				coins += power;
				energy--;

				if(energy < maxEnergy && !energyTimerEnd){
					energyTimerEnd = Date.now() + ENERGY_INTERVAL * 1000;
					localStorage.setItem('energyTimerEnd', String(energyTimerEnd));
				}

				// افکت
				coin.scale.set(1.1,1.1,1.1);
				setTimeout(()=>{ coin.scale.set(1,1,1); },120);

				spawnParticles();

				camera.position.z = 5.75;
				setTimeout(()=>{ camera.position.z = 6; },90);

				render();

				// persist locally immediately so refresh has latest while we sync to server
				localStorage.setItem('coins', String(coins));
				localStorage.setItem('energy', String(energy));
				localStorage.setItem('energyTimerEnd', String(energyTimerEnd));

				// save to server (await so order is preserved)
				await saveOnline();
			}catch(err){
				console.error('coin click handler error', err);
				updateDebugPanel('coin click handler error: ' + String(err));
			}
		};
	}
}

// ensure handlers attach when DOM is ready
document.addEventListener('DOMContentLoaded', attachHandlers);

// ================= LOOP =================
setInterval(render,1000);
render();
async function loadOnline(){
  try{
		console.log('loadOnline() - USER:', USER);

		const { data, error } = await db
	.from("users")
	.select("*")
.eq("telegram_id", USER)
	.maybeSingle();

if (error) {
  console.log("load error:", error);
  return;
}

if (!data) {
  console.log("user not found → creating...");
  await saveOnline();
  return;
}

    coins = data.coins ?? 0;
    energy = data.energy ?? 100;

    powerLv = data.power ?? 1;
    energyLv = data.energy_lv ?? 1;
    mineLv = data.mine_lv ?? 1;
    chargeLv = data.charge_lv ?? 1;

    maxEnergy = data.max_energy ?? 100;
		// restore or compute a proper energyTimerEnd so countdown continues across refreshes and while offline
		try{
			const now = Date.now();

			// 1) Prefer local stored timer if valid
			const stored = Number(localStorage.getItem('energyTimerEnd')) || 0;
			if(stored && stored > now){
				energyTimerEnd = stored;
			} else {
				// 1b) Prefer server-saved explicit timer if present
				let serverTimer = 0;
				if(data && data.energy_timer_end){
					const parsed = Date.parse(data.energy_timer_end);
					if(!isNaN(parsed)) serverTimer = parsed;
					else serverTimer = Number(data.energy_timer_end) || 0;
				}
				if(serverTimer && serverTimer > now){
					energyTimerEnd = serverTimer;
					localStorage.setItem('energyTimerEnd', String(energyTimerEnd));
				} else if(data && data.last_grant){
					// 2) If server provided last_grant, compute next timer based on that
					const last = Date.parse(data.last_grant);
					if(!isNaN(last)){
						const intervalMs = ENERGY_INTERVAL * 1000;
						const passedMs = Math.max(0, now - last);
						const intervalsPassed = Math.floor(passedMs / intervalMs);
						// apply missed grants immediately
						if(intervalsPassed > 0){
							const gainPer = (typeof energyGain !== 'undefined' ? energyGain : energyLv);
							const totalGain = intervalsPassed * gainPer;
							energy = Math.min(maxEnergy, energy + totalGain);
							localStorage.setItem('energy', String(energy));
							updateDebugPanel('Applied offline gain from last_grant: +' + totalGain + ' energy');
							try{ await saveOnline(); }catch(e){ updateDebugPanel('save after offline apply failed: ' + String(e)); }
						}
						// next scheduled grant time after last_grant
						energyTimerEnd = last + (intervalsPassed + 1) * intervalMs;
						if(energyTimerEnd <= now) energyTimerEnd = now + intervalMs;
						localStorage.setItem('energyTimerEnd', String(energyTimerEnd));
					}
				} else if(energy < maxEnergy){
					// 3) fallback: if nothing stored and no server info, start a timer now
					energyTimerEnd = now + ENERGY_INTERVAL * 1000;
					localStorage.setItem('energyTimerEnd', String(energyTimerEnd));
					try{ saveOnline(); }catch(e){}
				}
			}
		}catch(ex){ console.warn('energyTimer restore failed', ex); }

	// persist loaded values locally so reloads show same state immediately
	localStorage.setItem('coins', String(coins));
	localStorage.setItem('energy', String(energy));
	localStorage.setItem('powerLv', String(powerLv));
	localStorage.setItem('energyLv', String(energyLv));
	localStorage.setItem('mineLv', String(mineLv));
	localStorage.setItem('chargeLv', String(chargeLv));
	localStorage.setItem('maxEnergy', String(maxEnergy));

recalcDerived();

render();

updateUpgradeUI();

updateEnergyTimer();
		updateDebugPanel('loadOnline() - USER: ' + String(USER));
console.log("DATA LOADED:", data);

  }catch(e){
    console.log("load crash", e);
  }
}
(async () => {
  const { data, error } = await db.from("users").select("*");
  console.log("ALL USERS:", data);
  console.log("ERROR:", error);
})();
(async()=>{

await loadOnline();

render();

// attach handlers in case DOM was already ready or will be
try{ attachHandlers(); }catch(e){}

// try to save once after load to ensure DB row exists
try{ await saveOnline(); }catch(e){ updateDebugPanel('initial save failed: '+String(e)); }

updateEnergyTimer();

})();

// global error handlers (show in debug panel for Telegram WebView)
window.addEventListener('error', (ev)=>{
	try{ updateDebugPanel('Uncaught error: '+ (ev && ev.message ? ev.message : String(ev))); }catch(e){}
});
window.addEventListener('unhandledrejection', (ev)=>{
	try{ updateDebugPanel('Unhandled rejection: '+ String(ev && ev.reason ? ev.reason : ev)); }catch(e){}
});
