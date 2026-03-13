const CONFIG=Object.freeze({SONG_SS_ID:'1sAsXEl14Vr4k1hlAhdHD5JpIjWu4eFQgwo2KP9nP8oU',SONG_SHEET:'데이터베이스',SONG_RANGE:'E:I',API_URL:'https://script.google.com/macros/s/AKfycbwSK3iHaV3QbyEFpW347SsOaG6ZrkE3Yx9WLrAM-5pmETbkYDgFMN08HWJpYVstUpnu/exec',PER_PAGE:80,CACHE_KEY:'songlist_cache',CACHE_TTL:5*60*1000,THEME_KEY:'songlist_theme',USER_KEY:'songlist_user'});
const SONG_CSV_URL=`https://docs.google.com/spreadsheets/d/${CONFIG.SONG_SS_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(CONFIG.SONG_SHEET)}&range=${CONFIG.SONG_RANGE}`;

let allSongs=[],filteredSongs=[],displayedCount=0;
let activeView='all',activeGender='전체',activeGenre='전체';
let searchQuery='',searchLyrics=false;
let sortCol=null,sortDir='asc';
let currentRandomSong=null,isRendering=false;
let currentUser=null,favorites=new Set(),favDirty=false,serverFavKeys=new Set();
let pendingCreateId=null,pendingFavSong=null,pendingAction=null;

const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
let DOM={};

function cacheDom(){DOM={loginOverlay:$('#loginOverlay'),createOverlay:$('#createOverlay'),userIdInput:$('#userIdInput'),loginBtn:$('#loginBtn'),loginError:$('#loginError'),loginLoading:$('#loginLoading'),createIdDisplay:$('#createIdDisplay'),createConfirm:$('#createConfirmBtn'),createCancel:$('#createCancelBtn'),createLoading:$('#createLoading'),createError:$('#createError'),loginOpenBtn:$('#loginOpenBtn'),userBadge:$('#userBadge'),saveFavBtn:$('#saveFavBtn'),logoutBtn:$('#logoutBtn'),tbody:$('#songTableBody'),totalCount:$('#totalCount'),filteredCount:$('#filteredCount'),favCount:$('#favCount'),noResult:$('#noResult'),loading:$('#loading'),errorMsg:$('#errorMsg'),wrapper:$('#songListWrapper'),searchInput:$('#searchInput'),sentinel:$('#scrollSentinel'),loadingMore:$('#loadingMore'),lyricsModal:$('#lyricsModal'),randomModal:$('#randomModal'),saveModal:$('#saveConfirmModal'),toast:$('#toast'),scrollTopBtn:$('#scrollTopBtn')}}

const songKey=s=>`${s.artist}::${s.title}`;

async function apiGet(a,id){const r=await fetch(`${CONFIG.API_URL}?action=${encodeURIComponent(a)}&id=${encodeURIComponent(id)}`);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}
async function apiPost(a,id,x={}){const r=await fetch(CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:a,id,...x})});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}

function updateUserBar(){if(currentUser){DOM.loginOpenBtn.style.display='none';DOM.userBadge.textContent=`🎤 ${currentUser}`;DOM.userBadge.style.display='';DOM.saveFavBtn.style.display='';DOM.logoutBtn.style.display='';$('#footerSaveInfo').textContent=`${currentUser} 클라우드 저장`}else{DOM.loginOpenBtn.style.display='';DOM.userBadge.style.display='none';DOM.saveFavBtn.style.display='none';DOM.logoutBtn.style.display='none';$('#footerSaveInfo').textContent='로그인하여 즐겨찾기 저장'}updateFavCount();updateSaveBtn()}

function requireLogin(action,song=null){if(currentUser)return true;pendingAction=action;pendingFavSong=song;showLoginOverlay();return false}

function showLoginOverlay(){DOM.loginError.style.display='none';DOM.loginLoading.style.display='none';DOM.loginBtn.disabled=false;DOM.userIdInput.disabled=false;DOM.userIdInput.value='';DOM.loginOverlay.classList.add('active');setTimeout(()=>DOM.userIdInput.focus(),300)}
function hideLoginOverlay(){DOM.loginOverlay.classList.remove('active');pendingAction=null;pendingFavSong=null}

function showLoginError(m){DOM.loginError.textContent=m;DOM.loginError.style.display='block'}
function hideLoginError(){DOM.loginError.style.display='none'}
function setLoginLoading(on){DOM.loginLoading.style.display=on?'flex':'none';DOM.loginBtn.disabled=on;DOM.userIdInput.disabled=on}

async function handleLogin(){
    const id=DOM.userIdInput.value.trim();
    if(!id){showLoginError('아이디를 입력해주세요');DOM.userIdInput.focus();return}
    if(!/^[a-zA-Z0-9가-힣_\-]{1,20}$/.test(id)){showLoginError('영문, 한글, 숫자, _, - 만 사용 (1~20자)');return}
    hideLoginError();setLoginLoading(true);
    try{const result=await apiGet('check',id);if(!result.success){showLoginError(result.error||'서버 오류');setLoginLoading(false);return}if(result.exists){await loadAndLogin(id)}else{setLoginLoading(false);showCreateOverlay(id)}}catch(e){console.error(e);showLoginError('서버에 연결할 수 없습니다');setLoginLoading(false)}}

async function loadAndLogin(id){
    try{const result=await apiGet('load',id);if(!result.success){showLoginError(result.error);setLoginLoading(false);return}currentUser=id;favorites=new Set(result.favorites.map(f=>`${f.artist}::${f.title}`));serverFavKeys=new Set(favorites);favDirty=false;localStorage.setItem(CONFIG.USER_KEY,id);setLoginLoading(false);hideLoginOverlay();updateUserBar();showToast(`👋 ${id}님 환영합니다! (즐겨찾기 ${result.count}곡)`);executePendingAction();filterAndRender()}catch(e){console.error(e);showLoginError('즐겨찾기를 불러올 수 없습니다');setLoginLoading(false)}}

function showCreateOverlay(id){pendingCreateId=id;DOM.createIdDisplay.textContent=id;DOM.createError.style.display='none';DOM.createLoading.style.display='none';DOM.createConfirm.disabled=false;DOM.createCancel.disabled=false;DOM.loginOverlay.classList.remove('active');DOM.createOverlay.classList.add('active')}
function hideCreateOverlay(){DOM.createOverlay.classList.remove('active');pendingCreateId=null}

async function handleCreateConfirm(){
    if(!pendingCreateId)return;const id=pendingCreateId;DOM.createConfirm.disabled=true;DOM.createCancel.disabled=true;DOM.createLoading.style.display='flex';DOM.createError.style.display='none';
    try{const result=await apiPost('create',id);if(result.success){currentUser=id;favorites=new Set();serverFavKeys=new Set();favDirty=false;localStorage.setItem(CONFIG.USER_KEY,id);DOM.createLoading.style.display='none';hideCreateOverlay();updateUserBar();showToast(`🎉 "${id}" 아이디 생성 완료!`);executePendingAction();filterAndRender()}else{DOM.createLoading.style.display='none';DOM.createConfirm.disabled=false;DOM.createCancel.disabled=false;DOM.createError.textContent=result.error||'생성 실패';DOM.createError.style.display='block'}}catch(e){console.error(e);DOM.createLoading.style.display='none';DOM.createConfirm.disabled=false;DOM.createCancel.disabled=false;DOM.createError.textContent='서버 연결 실패';DOM.createError.style.display='block'}}

function executePendingAction(){const action=pendingAction,song=pendingFavSong;pendingAction=null;pendingFavSong=null;if(!action)return;switch(action){case'fav':if(song)toggleFavorite(song);break;case'viewFavorites':activeView='favorites';$('#viewFilters').querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.value==='favorites'));filterAndRender();break;case'save':showSaveModal();break}}

function handleLogout(){if(favDirty&&currentUser){if(!confirm('저장하지 않은 변경사항이 있습니다.\n정말 로그아웃하시겠습니까?'))return}currentUser=null;favorites=new Set();serverFavKeys=new Set();favDirty=false;localStorage.removeItem(CONFIG.USER_KEY);updateUserBar();if(activeView==='favorites'){activeView='all';$('#viewFilters').querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.value==='all'))}filterAndRender();showToast('👋 로그아웃되었습니다')}

async function tryAutoLogin(){const saved=localStorage.getItem(CONFIG.USER_KEY);if(!saved)return;try{const check=await apiGet('check',saved);if(check.success&&check.exists){const result=await apiGet('load',saved);if(result.success){currentUser=saved;favorites=new Set(result.favorites.map(f=>`${f.artist}::${f.title}`));serverFavKeys=new Set(favorites);favDirty=false;updateUserBar();filterAndRender()}}else{localStorage.removeItem(CONFIG.USER_KEY)}}catch{}}

function updateFavCount(){DOM.favCount.textContent=favorites.size}
function setsEqual(a,b){if(a.size!==b.size)return false;for(const v of a)if(!b.has(v))return false;return true}
function updateSaveBtn(){if(!currentUser)return;DOM.saveFavBtn.classList.toggle('unsaved',favDirty);DOM.saveFavBtn.textContent=favDirty?'💾 저장 (변경됨)':'💾 저장됨'}

function toggleFavorite(song){if(!requireLogin('fav',song))return;const key=songKey(song),wasFav=favorites.has(key);wasFav?favorites.delete(key):favorites.add(key);favDirty=!setsEqual(favorites,serverFavKeys);updateFavCount();updateSaveBtn();showToast(wasFav?`💔 "${song.title}" 해제`:`⭐ "${song.title}" 추가!`);if(activeView==='favorites')filterAndRender();else DOM.tbody.querySelectorAll(`.fav-btn[data-key="${CSS.escape(key)}"]`).forEach(b=>{b.textContent=!wasFav?'❤️':'🤍';b.classList.toggle('active',!wasFav)})}

function showSaveModal(){if(!requireLogin('save'))return;if(!favDirty)return showToast('✅ 이미 저장되어 있습니다');$('#saveConfirmText').textContent=`"${currentUser}" 계정에 ${favorites.size}곡을 저장합니다`;DOM.saveModal.classList.add('active')}
function closeSaveModal(){DOM.saveModal.classList.remove('active')}
async function handleSave(){if(!currentUser)return;const ld=$('#saveLoading');ld.style.display='flex';$('#saveConfirmBtn').disabled=true;try{const favList=[...favorites].map(key=>{const sep=key.indexOf('::');return{artist:key.substring(0,sep),title:key.substring(sep+2)}});const result=await apiPost('save',currentUser,{favorites:favList});if(result.success){serverFavKeys=new Set(favorites);favDirty=false;updateSaveBtn();closeSaveModal();showToast(`💾 ${result.count}곡 저장 완료!`)}else showToast(`❌ ${result.error}`)}catch{showToast('❌ 서버 연결 실패')}ld.style.display='none';$('#saveConfirmBtn').disabled=false}

function loadTheme(){const s=localStorage.getItem(CONFIG.THEME_KEY);const p=window.matchMedia?.('(prefers-color-scheme:light)').matches?'light':'dark';applyTheme(s||p)}
function applyTheme(t){document.body.setAttribute('data-theme',t);$('#themeToggle').textContent=t==='dark'?'🌙':'☀️';localStorage.setItem(CONFIG.THEME_KEY,t)}
function toggleTheme(){applyTheme(document.body.getAttribute('data-theme')==='dark'?'light':'dark')}

const CHO='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');const CHO_SET=new Set(CHO);
function getCho(c){const n=c.charCodeAt(0);return(n>=0xAC00&&n<=0xD7A3)?CHO[(n-0xAC00)/588|0]:c}
function isAllCho(s){return[...s].every(c=>CHO_SET.has(c))}
function toChoStr(s){return[...s].map(getCho).join('')}
function matchText(t,q){if(!q)return true;if(t.toLowerCase().includes(q.toLowerCase()))return true;if(isAllCho(q)&&toChoStr(t).includes(q))return true;return false}
const _d=document.createElement('div');
function esc(t){_d.textContent=t;return _d.innerHTML}
function hilite(t,q){if(!q)return esc(t);let lo=t.toLowerCase(),lq=q.toLowerCase(),i=lo.indexOf(lq);if(i>=0)return esc(t.substring(0,i))+`<span class="highlight">${esc(t.substring(i,i+q.length))}</span>`+esc(t.substring(i+q.length));if(isAllCho(q)){const ini=toChoStr(t);i=ini.indexOf(q);if(i>=0)return esc(t.substring(0,i))+`<span class="highlight">${esc(t.substring(i,i+q.length))}</span>`+esc(t.substring(i+q.length))}return esc(t)}
function parseGenres(s){return s?s.split(',').map(g=>g.trim()).filter(Boolean):[]}
function extractGenres(songs){const s=new Set();songs.forEach(song=>parseGenres(song.genre).forEach(g=>s.add(g)));return[...s].sort((a,b)=>a.localeCompare(b,'ko'))}

let _tt;function showToast(m){DOM.toast.textContent=m;DOM.toast.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>DOM.toast.classList.remove('show'),2500)}

async function fetchSongs(){try{DOM.loading.style.display='block';DOM.errorMsg.style.display='none';let csv;const c=sessionStorage.getItem(CONFIG.CACHE_KEY);if(c){const{data,ts}=JSON.parse(c);if(Date.now()-ts<CONFIG.CACHE_TTL)csv=data}if(!csv){const r=await fetch(SONG_CSV_URL);if(!r.ok)throw new Error(`HTTP ${r.status}`);csv=await r.text();try{sessionStorage.setItem(CONFIG.CACHE_KEY,JSON.stringify({data:csv,ts:Date.now()}))}catch{}}const p=Papa.parse(csv,{header:true,skipEmptyLines:true,transformHeader:h=>h.trim()});const h=p.meta.fields||[];allSongs=p.data.filter(r=>(r['곡명']||r[h[3]]||'').trim()).map((r,i)=>({id:i,genre:(r['장르']||r[h[0]]||'').trim(),gender:(r['성별']||r[h[1]]||'').trim(),artist:(r['가수']||r[h[2]]||'').trim(),title:(r['곡명']||r[h[3]]||'').trim(),lyrics:(r['가사']||r[h[4]]||'').trim()}));buildGenreFilters();updateFavCount();DOM.loading.style.display='none';DOM.wrapper.style.display='block';filterAndRender()}catch(e){console.error(e);DOM.loading.style.display='none';DOM.errorMsg.style.display='block'}}

function buildGenreFilters(){const w=$('#genreFilters'),f=document.createDocumentFragment();extractGenres(allSongs).forEach(g=>{const b=document.createElement('button');b.className='filter-btn';b.dataset.value=g;b.textContent=g;f.appendChild(b)});w.appendChild(f);w.addEventListener('click',e=>{const b=e.target.closest('.filter-btn');if(!b)return;w.querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeGenre=b.dataset.value;filterAndRender()})}

function sortSongs(s){if(!sortCol)return s;return[...s].sort((a,b)=>{const c=(a[sortCol]||'').localeCompare(b[sortCol]||'','ko');return sortDir==='desc'?-c:c})}
function handleSort(c){if(sortCol===c){sortDir=sortDir==='asc'?'desc':(sortCol=null,'asc')}else{sortCol=c;sortDir='asc'}updateSortUI();filterAndRender()}
function updateSortUI(){$$('th.sortable').forEach(th=>{const a=th.dataset.sort===sortCol;th.classList.toggle('sort-active',a);th.querySelector('.sort-arrow').textContent=a?(sortDir==='asc'?'▲':'▼'):'⇅'})}

function filterAndRender(){const q=searchQuery;filteredSongs=allSongs.filter(s=>{if(activeView==='favorites'&&!favorites.has(songKey(s)))return false;if(activeGender!=='전체'&&s.gender!==activeGender)return false;if(activeGenre!=='전체'&&!parseGenres(s.genre).includes(activeGenre))return false;if(q){const t=matchText(s.title,q),a=matchText(s.artist,q),l=searchLyrics&&s.lyrics.toLowerCase().includes(q.toLowerCase());if(!t&&!a&&!l)return false}return true});filteredSongs=sortSongs(filteredSongs);DOM.totalCount.textContent=allSongs.length;DOM.filteredCount.textContent=filteredSongs.length;displayedCount=0;DOM.tbody.innerHTML='';renderMore()}

function renderMore(){if(isRendering)return;if(displayedCount>=filteredSongs.length){DOM.loadingMore.style.display='none';return}isRendering=true;DOM.loadingMore.style.display=filteredSongs.length>CONFIG.PER_PAGE?'block':'none';requestAnimationFrame(()=>{if(!filteredSongs.length){DOM.noResult.style.display='block';DOM.loadingMore.style.display='none';isRendering=false;return}DOM.noResult.style.display='none';const end=Math.min(displayedCount+CONFIG.PER_PAGE,filteredSongs.length),frag=document.createDocumentFragment();for(let i=displayedCount;i<end;i++){const s=filteredSongs[i],key=songKey(s),isFav=favorites.has(key),hasL=s.lyrics.length>0;const tr=document.createElement('tr');const gB=parseGenres(s.genre).map(g=>`<span class="badge badge-genre">${esc(g)}</span>`).join('');const gC=s.gender==='여'?'badge-female':'badge-male',gI=s.gender==='여'?'👩':'👨';tr.innerHTML=`<td>${i+1}</td><td><button class="fav-btn${isFav?' active':''}" data-key="${esc(key)}" data-idx="${i}">${isFav?'❤️':'🤍'}</button></td><td><div class="title-cell"><span class="song-title">${hilite(s.title,searchQuery)}</span><button class="lyrics-btn ${hasL?'has-lyrics':'no-lyrics'}" data-idx="${i}">📜</button></div></td><td class="song-artist">${hilite(s.artist,searchQuery)}</td><td>${gB}</td><td><span class="badge ${gC}">${gI} ${esc(s.gender)}</span></td>`;frag.appendChild(tr)}DOM.tbody.appendChild(frag);displayedCount=end;DOM.loadingMore.style.display='none';isRendering=false})}

function initScrollObserver(){if(!('IntersectionObserver' in window))return;new IntersectionObserver(e=>{if(e[0].isIntersecting&&displayedCount<filteredSongs.length&&!isRendering)renderMore()},{rootMargin:'400px'}).observe(DOM.sentinel)}
function initScrollTop(){let t=false;window.addEventListener('scroll',()=>{if(!t){requestAnimationFrame(()=>{DOM.scrollTopBtn.classList.toggle('visible',window.scrollY>600);t=false});t=true}},{passive:true});DOM.scrollTopBtn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}))}

function openLyricsModal(s){$('#modalTitle').textContent=s.title;$('#modalArtist').textContent=s.artist;$('#modalGenre').textContent=s.genre;const g=$('#modalGender');g.textContent=(s.gender==='여'?'👩 ':'👨 ')+s.gender;g.className=`mtag ${s.gender==='여'?'gender-tag':'gender-tag-m'}`;$('#modalLyrics').textContent=s.lyrics.replace(/^[""\u201C\u201D]|[""\u201C\u201D]$/g,'').trim()||'가사 정보가 없습니다.';DOM.lyricsModal.classList.add('active');document.body.style.overflow='hidden'}
function closeLyricsModal(){DOM.lyricsModal.classList.remove('active');document.body.style.overflow=''}

function pickRandom(){const pool=filteredSongs.length?filteredSongs:allSongs;if(!pool.length)return showToast('🎵 곡이 없습니다!');const icon=$('#randomIcon');icon.classList.remove('spinning');void icon.offsetWidth;icon.classList.add('spinning');const s=pool[Math.random()*pool.length|0];currentRandomSong=s;$('#randomTitle').textContent=s.title;$('#randomArtist').textContent=s.artist;$('#randomGenre').textContent=s.genre;const g=$('#randomGender');g.textContent=(s.gender==='여'?'👩 ':'👨 ')+s.gender;g.className=`mtag ${s.gender==='여'?'gender-tag':'gender-tag-m'}`;$('#randomFavBtn').textContent=favorites.has(songKey(s))?'💛 해제':'⭐ 즐겨찾기';const lb=$('#randomLyricsBtn'),hl=!!s.lyrics.trim();lb.disabled=!hl;lb.style.opacity=hl?1:.4;DOM.randomModal.classList.add('active');document.body.style.overflow='hidden'}
function closeRandomModal(){DOM.randomModal.classList.remove('active');document.body.style.overflow=''}

function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

document.addEventListener('DOMContentLoaded',()=>{
    cacheDom();loadTheme();updateSortUI();initScrollObserver();initScrollTop();updateUserBar();
    fetchSongs();tryAutoLogin();

    $('#themeToggle').addEventListener('click',toggleTheme);
    DOM.loginOpenBtn.addEventListener('click',()=>showLoginOverlay());
    DOM.loginBtn.addEventListener('click',handleLogin);
    DOM.userIdInput.addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin()});
    $('#loginCloseBtn').addEventListener('click',hideLoginOverlay);
    $('#loginOverlayBg').addEventListener('click',hideLoginOverlay);

    DOM.createConfirm.addEventListener('click',handleCreateConfirm);
    DOM.createCancel.addEventListener('click',()=>{hideCreateOverlay();showLoginOverlay()});
    $('#createCloseBtn').addEventListener('click',hideCreateOverlay);
    $('#createOverlayBg').addEventListener('click',hideCreateOverlay);

    DOM.logoutBtn.addEventListener('click',handleLogout);
    DOM.saveFavBtn.addEventListener('click',()=>showSaveModal());

    $('#saveConfirmBtn').addEventListener('click',handleSave);
    $('#saveCancelBtn').addEventListener('click',closeSaveModal);
    $('.save-modal-overlay').addEventListener('click',closeSaveModal);

    DOM.searchInput.addEventListener('input',debounce(e=>{searchQuery=e.target.value.trim();filterAndRender()},200));
    $('#lyricsSearchToggle').addEventListener('change',e=>{searchLyrics=e.target.checked;if(searchQuery)filterAndRender()});

    $('#viewFilters').addEventListener('click',e=>{const b=e.target.closest('.filter-btn');if(!b)return;const value=b.dataset.value;if(value==='favorites'&&!currentUser){requireLogin('viewFavorites');return}$('#viewFilters').querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeView=value;filterAndRender()});

    $('#genderFilters').addEventListener('click',e=>{const b=e.target.closest('.filter-btn');if(!b)return;$('#genderFilters').querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeGender=b.dataset.value;filterAndRender()});

    $$('th.sortable').forEach(th=>th.addEventListener('click',()=>handleSort(th.dataset.sort)));

    DOM.tbody.addEventListener('click',e=>{const lBtn=e.target.closest('.lyrics-btn.has-lyrics');if(lBtn)return openLyricsModal(filteredSongs[+lBtn.dataset.idx]);const fBtn=e.target.closest('.fav-btn');if(fBtn)return toggleFavorite(filteredSongs[+fBtn.dataset.idx])});

    $('#modalClose').addEventListener('click',closeLyricsModal);
    $('.lyrics-modal-overlay').addEventListener('click',closeLyricsModal);
    $('#randomBtn').addEventListener('click',pickRandom);
    $('#randomClose').addEventListener('click',closeRandomModal);
    $('.random-modal-overlay').addEventListener('click',closeRandomModal);
    $('#randomAgainBtn').addEventListener('click',pickRandom);
    $('#randomLyricsBtn').addEventListener('click',()=>{if(currentRandomSong?.lyrics.trim()){closeRandomModal();setTimeout(()=>openLyricsModal(currentRandomSong),250)}});
    $('#randomFavBtn').addEventListener('click',()=>{if(!currentRandomSong)return;toggleFavorite(currentRandomSong);if(currentUser)$('#randomFavBtn').textContent=favorites.has(songKey(currentRandomSong))?'💛 해제':'⭐ 즐겨찾기'});

    $('#retryBtn').addEventListener('click',()=>{sessionStorage.removeItem(CONFIG.CACHE_KEY);fetchSongs()});

    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeLyricsModal();closeRandomModal();closeSaveModal();hideLoginOverlay();hideCreateOverlay()}if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();DOM.searchInput.focus();DOM.searchInput.select()}});

    window.addEventListener('beforeunload',e=>{if(favDirty&&currentUser){e.preventDefault();e.returnValue=''}});
});

if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
