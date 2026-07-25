const STORAGE_KEY = 'quest-tracker-state';
const CATEGORY_ICONS = {
  'Kesehatan':'🩻', 'Belajar':'📚', 'Produktivitas':'💼', 'Sosial':'🤝', 'Self-care':'✨'
};
const DIFF_XP = { easy:10, medium:20, hard:35 };
const DIFF_LABEL = { easy:'Mudah', medium:'Sedang', hard:'Sulit' };

function todayStr(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function dateDiffDays(a,b){
  const da = new Date(a+'T00:00:00');
  const db = new Date(b+'T00:00:00');
  return Math.round((da-db)/86400000);
}
function xpForLevel(level){ return 100 + (level-1)*50; }
function levelTitle(level){
  if(level>=360) return 'Legenda';
  if(level>=100) return 'Veteran';
  if(level>=30) return 'Penjelajah';
  return 'Petualang Pemula';
}
function uid(){ return 'q'+Date.now()+Math.floor(Math.random()*1000); }

function defaultQuests(){
  return [
    {id:uid(), title:'Sesepedahan', category:'Kesehatan', difficulty:'easy', xp:10, done:false, custom:false},
    {id:uid(), title:'Meminum air putih', category:'Kesehatan', difficulty:'medium', xp:20, done:false, custom:false},
    {id:uid(), title:'Ngodink', category:'Belajar', difficulty:'easy', xp:10, done:false, custom:false},
    {id:uid(), title:'Membangun projek ', category:'Produktivitas', difficulty:'hard', xp:35, done:false, custom:false},
    {id:uid(), title:'Tidur lebih awal  ', category:'Produktivitas', difficulty:'easy', xp:10, done:false, custom:false},
    {id:uid(), title:'Mabar bareng temen', category:'Sosial', difficulty:'medium', xp:20, done:false, custom:false},
    {id:uid(), title:'Menonton film Forrest Gump', category:'Self-care', difficulty:'hard', xp:20, done:false, custom:false},
    {id:uid(), title:'Kulineran', category:'Self-care', difficulty:'easy', xp:10, done:false, custom:false},
  ];
}

function defaultState(){
  return {
    player:{ xp:0, level:1, streak:0, lastResetDate: todayStr(), lastCompleteDate: null, totalCompleted:0 },
    quests: defaultQuests(),
    history: [],
    settings: {
      completeSoundOn: true,
      morningOn: false,
      eveningOn: false,
      morningTime: '08:00',
      eveningTime: '20:00',
      lastMorningNotif: null,
      lastEveningNotif: null
    }
  };
}

/* ---------- SOUND ENGINE (Web Audio, no external files) ---------- */
let audioCtx = null;
function getAudioCtx(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if(audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTone(freq, startTime, duration, type='sine', gainPeak=0.18){
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}
function playCompleteSound(){
  if(!state.settings.completeSoundOn) return;
  const ctx = getAudioCtx();
  const t = ctx.currentTime;
  playTone(523.25, t, 0.14, 'triangle');
  playTone(783.99, t + 0.1, 0.22, 'triangle');
}
function playLevelUpSound(){
  const ctx = getAudioCtx();
  const t = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f,i)=> playTone(f, t + i*0.11, 0.2, 'triangle', 0.16));
}
function makeDistortionCurve(amount){
  const n = 4096;
  const curve = new Float32Array(n);
  const k = amount;
  for(let i=0;i<n;i++){
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * Math.PI/180) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
function playPowerChord(rootFreq, startTime, duration){
  const ctx = getAudioCtx();
  const distortion = ctx.createWaveShaper();
  distortion.curve = makeDistortionCurve(55);
  distortion.oversample = '4x';

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.11, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  distortion.connect(gain).connect(ctx.destination);

  // power chord = root + perfect fifth + octave, sawtooth for grit
  [1, 1.5, 2].forEach((mult, i)=>{
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = rootFreq * mult;
    osc.detune.value = (i - 1) * 6; // slight detune for thickness
    osc.connect(distortion);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  });
}
function playReminderSound(){
  // short energizing rock riff: three punchy power chords, ascending
  const ctx = getAudioCtx();
  const t = ctx.currentTime;
  playPowerChord(164.81, t, 0.18);        // E3
  playPowerChord(196.00, t + 0.22, 0.18); // G3
  playPowerChord(246.94, t + 0.44, 0.32); // B3 (held, triumphant finish)
}

function notifStatusLabel(perm){
  if(perm==='granted') return {text:'Diizinkan ✔', cls:'granted'};
  if(perm==='denied') return {text:'Ditolak — aktifkan lewat pengaturan browser', cls:'denied'};
  return {text:'Belum diminta', cls:'default'};
}

function sendNotification(title, body){
  if('Notification' in window && Notification.permission === 'granted'){
    try{ new Notification(title, {body, icon:''}); }catch(e){ /* ignore */ }
  }
}

function checkReminders(){
  if(!state.settings) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const nowHM = hh + ':' + mm;
  const today = todayStr();

  if(state.settings.morningOn && nowHM === state.settings.morningTime && state.settings.lastMorningNotif !== today){
    playReminderSound();
    sendNotification('🎸 Quest Harian', 'Bangun, petualang! Saatnya nge-gas quest hari ini! 🔥');
    state.settings.lastMorningNotif = today;
    saveState();
  }
  if(state.settings.eveningOn && nowHM === state.settings.eveningTime && state.settings.lastEveningNotif !== today){
    const unfinished = state.quests.filter(q=>!q.done).length;
    if(unfinished > 0){
      playReminderSound();
      sendNotification('🎸 Quest Harian', `Jangan kasih kendor! Masih ${unfinished} quest nunggu buat ditaklukin malam ini. 🔥`);
    }
    state.settings.lastEveningNotif = today;
    saveState();
  }
}
setInterval(checkReminders, 20000);

let state = null;
let activeFilter = 'Semua';
let activeTab = 'board';

async function loadState(){
  try{
    const res = await window.storage.get(STORAGE_KEY, false);
    if(res && res.value){
      state = JSON.parse(res.value);
    } else {
      state = defaultState();
    }
  }catch(e){
    state = defaultState();
  }
  if(!state.settings){
    state.settings = defaultState().settings;
  }
  handleDailyReset();
  render();
  initSettingsUI();
}

async function saveState(){
  try{
    await window.storage.set(STORAGE_KEY, JSON.stringify(state), false);
  }catch(e){
    console.error('Gagal menyimpan data', e);
  }
}

function handleDailyReset(){
  const today = todayStr();
  if(state.player.lastResetDate !== today){
    state.quests.forEach(q => q.done = false);
    if(state.player.lastCompleteDate){
      const diff = dateDiffDays(today, state.player.lastCompleteDate);
      if(diff > 1) state.player.streak = 0;
    }
    state.player.lastResetDate = today;
    saveState();
  }
}

function completeQuest(id){
  const q = state.quests.find(x=>x.id===id);
  if(!q) return;
  const today = todayStr();
  if(!q.done){
    q.done = true;
    playCompleteSound();
    state.player.xp += q.xp;
    state.player.totalCompleted += 1;
    state.history.unshift({date: today, title:q.title, xp:q.xp, category:q.category});
    if(state.history.length > 200) state.history.pop();
    if(state.player.lastCompleteDate !== today){
      state.player.streak += 1;
      state.player.lastCompleteDate = today;
    }
    let leveledUp = false;
    while(state.player.xp >= xpForLevel(state.player.level)){
      state.player.xp -= xpForLevel(state.player.level);
      state.player.level += 1;
      leveledUp = true;
    }
    if(leveledUp) showLevelUp(state.player.level);
  } else {
    q.done = false;
    state.player.xp -= q.xp;
    state.player.totalCompleted = Math.max(0, state.player.totalCompleted - 1);
    const idx = state.history.findIndex(h => h.date===today && h.title===q.title && h.xp===q.xp);
    if(idx>-1) state.history.splice(idx,1);
    if(state.player.xp < 0){
      if(state.player.level > 1){
        state.player.level -= 1;
        state.player.xp += xpForLevel(state.player.level);
      } else {
        state.player.xp = 0;
      }
    }
  }
  saveState();
  render();
}

function deleteQuest(id){
  state.quests = state.quests.filter(q=>q.id!==id);
  saveState();
  render();
}

function addQuest(title, category, difficulty){
  state.quests.push({
    id: uid(), title, category, difficulty, xp: DIFF_XP[difficulty], done:false, custom:true
  });
  saveState();
  render();
}

function showLevelUp(level){
  playLevelUpSound();
  document.getElementById('newLevelNum').textContent = level;
  const toast = document.getElementById('levelUpToast');
  toast.classList.add('show');
  setTimeout(()=> toast.classList.remove('show'), 2200);
}

/* ---------- RENDER ---------- */
function render(){
  renderPlayer();
  renderFilters();
  renderQuests();
  renderJournal();
  renderStats();
}

function renderPlayer(){
  const p = state.player;
  document.getElementById('levelText').textContent = 'Level ' + p.level;
  document.getElementById('titleText').textContent = levelTitle(p.level);
  const need = xpForLevel(p.level);
  const pct = Math.min(100, Math.round((p.xp/need)*100));
  document.getElementById('xpFill').style.width = pct + '%';
  document.getElementById('xpLabel').textContent = p.xp + ' / ' + need + ' XP';
  document.getElementById('streakNum').textContent = p.streak + '🔥';
}

function renderFilters(){
  const cats = ['Semua', ...Object.keys(CATEGORY_ICONS)];
  const el = document.getElementById('filters');
  el.innerHTML = '';
  cats.forEach(cat=>{
    const chip = document.createElement('button');
    chip.className = 'chip' + (activeFilter===cat ? ' active' : '');
    chip.textContent = (CATEGORY_ICONS[cat] ? CATEGORY_ICONS[cat]+' ' : '🎯 ') + cat;
    chip.onclick = ()=>{ activeFilter = cat; renderFilters(); renderQuests(); };
    el.appendChild(chip);
  });
}

function renderQuests(){
  const grid = document.getElementById('questGrid');
  grid.innerHTML = '';
  let list = state.quests;
  if(activeFilter !== 'Semua') list = list.filter(q=>q.category===activeFilter);
  if(list.length===0){
    grid.innerHTML = '<div class="empty-state">Belum ada quest di kategori ini. Yuk tambahkan satu! ✨</div>';
    return;
  }
  list.forEach(q=>{
    const card = document.createElement('div');
    card.className = 'quest-card' + (q.done ? ' done' : '');
    card.innerHTML = `
      <div class="quest-top">
        <span class="quest-cat">${CATEGORY_ICONS[q.category]||'🎯'} ${q.category}</span>
        <span class="quest-diff diff-${q.difficulty}">${DIFF_LABEL[q.difficulty]}</span>
      </div>
      <div class="quest-title">${escapeHtml(q.title)}</div>
      <div class="quest-bottom">
        <span class="quest-xp">+${q.xp} XP</span>
        <div class="quest-actions">
          ${q.custom ? `<button class="btn-del" title="Hapus quest" data-del="${q.id}">✕</button>` : ''}
          <button class="btn-complete ${q.done?'done':''}" data-complete="${q.id}">${q.done ? '✔ Selesai' : 'Selesaikan'}</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-complete]').forEach(btn=>{
    btn.onclick = ()=> completeQuest(btn.getAttribute('data-complete'));
  });
  grid.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = ()=> deleteQuest(btn.getAttribute('data-del'));
  });
}

function renderJournal(){
  const el = document.getElementById('journalList');
  el.innerHTML = '';
  if(state.history.length===0){
    el.innerHTML = '<div class="empty-state">Jurnal masih kosong. Selesaikan quest pertamamu untuk mulai menulis cerita! 📖</div>';
    return;
  }
  const grouped = {};
  state.history.forEach(h=>{
    if(!grouped[h.date]) grouped[h.date] = [];
    grouped[h.date].push(h);
  });
  Object.keys(grouped).sort((a,b)=> b.localeCompare(a)).forEach(date=>{
    const dayDiv = document.createElement('div');
    dayDiv.className = 'journal-day';
    const entries = grouped[date];
    const totalXp = entries.reduce((s,e)=>s+e.xp,0);
    let entriesHtml = entries.map(e=>`
      <div class="journal-entry"><span>${CATEGORY_ICONS[e.category]||'🎯'} ${escapeHtml(e.title)}</span><span class="xp">+${e.xp} XP</span></div>
    `).join('');
    dayDiv.innerHTML = `<div class="journal-date">${formatDate(date)} — total ${totalXp} XP</div>${entriesHtml}`;
    el.appendChild(dayDiv);
  });
}

function renderStats(){
  const el = document.getElementById('statsGrid');
  const p = state.player;
  const totalXpEarned = state.history.reduce((s,h)=>s+h.xp,0);
  const stats = [
    {num:p.level, lbl:'Level Saat Ini'},
    {num:p.streak, lbl:'Hari Beruntun'},
    {num:p.totalCompleted, lbl:'Total Quest Selesai'},
    {num:totalXpEarned, lbl:'Total XP Terkumpul'},
    {num:state.quests.filter(q=>q.custom).length, lbl:'Quest Buatanmu'},
  ];
  el.innerHTML = stats.map(s=>`<div class="stat-box"><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div>`).join('');
}

function formatDate(dateStr){
  const d = new Date(dateStr+'T00:00:00');
  const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return d.getDate() + ' ' + bulan[d.getMonth()] + ' ' + d.getFullYear();
}
function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- TABS ---------- */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.getAttribute('data-tab');
    document.getElementById('tab-board').style.display = activeTab==='board' ? 'block':'none';
    document.getElementById('tab-journal').style.display = activeTab==='journal' ? 'block':'none';
    document.getElementById('tab-stats').style.display = activeTab==='stats' ? 'block':'none';
    document.getElementById('tab-settings').style.display = activeTab==='settings' ? 'block':'none';
  };
});

/* ---------- SETTINGS UI ---------- */
function updateSoundHeaderIcon(){
  const btn = document.getElementById('soundToggleHeader');
  if(btn) btn.textContent = state.settings.completeSoundOn ? '🔊' : '🔇';
}
function updateNotifStatusUI(){
  const el = document.getElementById('notifStatus');
  if(!el) return;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const info = perm==='unsupported'
    ? {text:'Browser tidak mendukung notifikasi', cls:'denied'}
    : notifStatusLabel(perm);
  el.textContent = info.text;
  el.className = 'notif-status ' + info.cls;
}

function initSettingsUI(){
  const s = state.settings;
  document.getElementById('toggleCompleteSound').checked = s.completeSoundOn;
  document.getElementById('toggleMorning').checked = s.morningOn;
  document.getElementById('toggleEvening').checked = s.eveningOn;
  document.getElementById('morningTime').value = s.morningTime;
  document.getElementById('eveningTime').value = s.eveningTime;
  updateSoundHeaderIcon();
  updateNotifStatusUI();

  document.getElementById('toggleCompleteSound').onchange = (e)=>{
    s.completeSoundOn = e.target.checked;
    updateSoundHeaderIcon();
    saveState();
  };
  document.getElementById('soundToggleHeader').onclick = ()=>{
    s.completeSoundOn = !s.completeSoundOn;
    document.getElementById('toggleCompleteSound').checked = s.completeSoundOn;
    updateSoundHeaderIcon();
    saveState();
    if(s.completeSoundOn) playCompleteSound();
  };
  document.getElementById('toggleMorning').onchange = (e)=>{
    s.morningOn = e.target.checked;
    if(s.morningOn && 'Notification' in window && Notification.permission === 'default'){
      Notification.requestPermission().then(updateNotifStatusUI);
    }
    saveState();
  };
  document.getElementById('toggleEvening').onchange = (e)=>{
    s.eveningOn = e.target.checked;
    if(s.eveningOn && 'Notification' in window && Notification.permission === 'default'){
      Notification.requestPermission().then(updateNotifStatusUI);
    }
    saveState();
  };
  document.getElementById('morningTime').onchange = (e)=>{
    s.morningTime = e.target.value;
    s.lastMorningNotif = null;
    saveState();
  };
  document.getElementById('eveningTime').onchange = (e)=>{
    s.eveningTime = e.target.value;
    s.lastEveningNotif = null;
    saveState();
  };
  document.getElementById('requestNotifBtn').onclick = ()=>{
    if(!('Notification' in window)){ updateNotifStatusUI(); return; }
    Notification.requestPermission().then(updateNotifStatusUI);
  };
  document.getElementById('testSoundBtn').onclick = ()=>{
    playReminderSound();
  };
}

/* ---------- ADD QUEST FORM ---------- */
document.getElementById('addToggle').onclick = ()=>{
  document.getElementById('addForm').classList.toggle('open');
};
document.getElementById('submitQuest').onclick = ()=>{
  const titleInput = document.getElementById('newTitle');
  const title = titleInput.value.trim();
  if(!title){ titleInput.focus(); return; }
  const category = document.getElementById('newCategory').value;
  const difficulty = document.getElementById('newDifficulty').value;
  addQuest(title, category, difficulty);
  titleInput.value = '';
  document.getElementById('addForm').classList.remove('open');
};

loadState();