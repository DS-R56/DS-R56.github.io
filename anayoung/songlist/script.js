/* ╔═══════════════════════════════════════════════════════════╗
   ║  ⚙️  설정                                                ║
   ╚═══════════════════════════════════════════════════════════╝ */
const CONFIG = Object.freeze({
    // 노래 데이터
    SONG_SS_ID : '1sAsXEl14Vr4k1hlAhdHD5JpIjWu4eFQgwo2KP9nP8oU',
    SONG_SHEET : '데이터베이스',
    SONG_RANGE : 'E:I',

    // ⭐ Apps Script 배포 URL (여기에 입력!)
    API_URL    : 'https://script.google.com/macros/s/AKfycbwSK3iHaV3QbyEFpW347SsOaG6ZrkE3Yx9WLrAM-5pmETbkYDgFMN08HWJpYVstUpnu/exec',

    PER_PAGE   : 80,
    CACHE_KEY  : 'songlist_cache',
    CACHE_TTL  : 5 * 60 * 1000,
    THEME_KEY  : 'songlist_theme',
    USER_KEY   : 'songlist_user',
});

const SONG_CSV_URL =
    `https://docs.google.com/spreadsheets/d/${CONFIG.SONG_SS_ID}`
    + `/gviz/tq?tqx=out:csv`
    + `&sheet=${encodeURIComponent(CONFIG.SONG_SHEET)}`
    + `&range=${CONFIG.SONG_RANGE}`;

/* ══════════════════════════════════════
   전역 상태
   ══════════════════════════════════════ */
let allSongs = [], filteredSongs = [], displayedCount = 0;
let activeView = 'all', activeGender = '전체', activeGenre = '전체';
let searchQuery = '', searchLyrics = false;
let sortCol = null, sortDir = 'asc';
let currentRandomSong = null, isRendering = false;

let currentUser = null;
let favorites = new Set();
let favDirty = false;
let serverFavKeys = new Set();
let pendingCreateId = null;  // 생성 대기 중인 아이디

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
let DOM = {};

function cacheDom() {
    DOM = {
        // 로그인
        loginScreen:   $('#loginScreen'),
        appScreen:     $('#appScreen'),
        userIdInput:   $('#userIdInput'),
        loginBtn:      $('#loginBtn'),
        guestBtn:      $('#guestBtn'),
        loginError:    $('#loginError'),
        loginLoading:  $('#loginLoading'),
        // 생성 모달
        createModal:   $('#createModal'),
        createIdText:  $('#createIdDisplay'),
        createConfirm: $('#createConfirmBtn'),
        createCancel:  $('#createCancelBtn'),
        createLoading: $('#createLoading'),
        // 사용자 바
        userBar:       $('#userBar'),
        userBadge:     $('#userBadge'),
        saveFavBtn:    $('#saveFavBtn'),
        logoutBtn:     $('#logoutBtn'),
        // 메인
        tbody:         $('#songTableBody'),
        totalCount:    $('#totalCount'),
        filteredCount: $('#filteredCount'),
        favCount:      $('#favCount'),
        noResult:      $('#noResult'),
        loading:       $('#loading'),
        errorMsg:      $('#errorMsg'),
        wrapper:       $('#songListWrapper'),
        searchInput:   $('#searchInput'),
        sentinel:      $('#scrollSentinel'),
        loadingMore:   $('#loadingMore'),
        // 모달
        lyricsModal:   $('#lyricsModal'),
        randomModal:   $('#randomModal'),
        saveModal:     $('#saveConfirmModal'),
        toast:         $('#toast'),
        scrollTopBtn:  $('#scrollTopBtn'),
        footer:        $('#appFooter'),
    };
}

const songKey = s => `${s.artist}::${s.title}`;

/* ══════════════════════════════════════
   API 호출
   ══════════════════════════════════════ */
async function apiGet(action, id) {
    const url = `${CONFIG.API_URL}?action=${encodeURIComponent(action)}&id=${encodeURIComponent(id)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function apiPost(action, id, extra = {}) {
    const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, id, ...extra }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/* ══════════════════════════════════════
   🔐 로그인 플로우
   ══════════════════════════════════════ */

// -- UI 헬퍼 --
function showLoginError(msg) {
    DOM.loginError.textContent = msg;
    DOM.loginError.style.display = 'block';
}
function hideLoginError() {
    DOM.loginError.style.display = 'none';
}
function setLoginLoading(on) {
    DOM.loginLoading.style.display = on ? 'flex' : 'none';
    DOM.loginBtn.disabled = on;
    DOM.userIdInput.disabled = on;
    DOM.guestBtn.disabled = on;
}

// -- 메인 로그인 --
async function handleLogin() {
    const id = DOM.userIdInput.value.trim();

    // ① 빈 값 체크
    if (!id) {
        showLoginError('아이디를 입력해주세요');
        DOM.userIdInput.focus();
        return;
    }

    // ② 유효성 검사
    if (!/^[a-zA-Z0-9가-힣_\-]{1,20}$/.test(id)) {
        showLoginError('영문, 한글, 숫자, _, - 만 사용 가능합니다 (1~20자)');
        DOM.userIdInput.focus();
        return;
    }

    hideLoginError();
    setLoginLoading(true);

    try {
        // ③ 서버에 아이디 존재 여부 확인
        console.log(`🔍 아이디 확인: "${id}"`);
        const result = await apiGet('check', id);

        if (!result.success) {
            showLoginError(result.error || '서버 오류가 발생했습니다');
            setLoginLoading(false);
            return;
        }

        if (result.exists) {
            // ④-A: 존재하는 아이디 → 즐겨찾기 불러오기
            console.log(`✅ 아이디 존재: "${id}" → 즐겨찾기 로드`);
            await loadAndEnter(id);
        } else {
            // ④-B: 존재하지 않는 아이디 → 생성 확인 모달
            console.log(`❌ 아이디 없음: "${id}" → 생성 확인 모달`);
            setLoginLoading(false);
            showCreateConfirm(id);
        }

    } catch (err) {
        console.error('로그인 오류:', err);
        showLoginError('서버에 연결할 수 없습니다. 네트워크를 확인해주세요.');
        setLoginLoading(false);
    }
}

// -- 즐겨찾기 로드 후 앱 진입 --
async function loadAndEnter(id) {
    try {
        const result = await apiGet('load', id);

        if (!result.success) {
            showLoginError(result.error || '즐겨찾기를 불러올 수 없습니다');
            setLoginLoading(false);
            return;
        }

        // 사용자 상태 설정
        currentUser = id;
        favorites = new Set(
            result.favorites.map(f => `${f.artist}::${f.title}`)
        );
        serverFavKeys = new Set(favorites);
        favDirty = false;

        // 자동 로그인용 저장
        localStorage.setItem(CONFIG.USER_KEY, id);

        setLoginLoading(false);
        enterApp();
        showToast(`👋 ${id}님 환영합니다! (즐겨찾기 ${result.count}곡)`);

    } catch (err) {
        console.error('로드 오류:', err);
        showLoginError('즐겨찾기를 불러올 수 없습니다');
        setLoginLoading(false);
    }
}

/* ══════════════════════════════════════
   🆕 새 아이디 생성 확인 모달
   ══════════════════════════════════════ */
function showCreateConfirm(id) {
    pendingCreateId = id;
    DOM.createIdText.textContent = id;
    DOM.createModal.classList.add('active');
    DOM.createConfirm.disabled = false;
    DOM.createLoading.style.display = 'none';
}

function closeCreateModal() {
    DOM.createModal.classList.remove('active');
    pendingCreateId = null;
}

async function handleCreateConfirm() {
    if (!pendingCreateId) return;

    const id = pendingCreateId;
    DOM.createConfirm.disabled = true;
    DOM.createCancel.disabled = true;
    DOM.createLoading.style.display = 'flex';

    try {
        console.log(`🆕 시트 생성 요청: "${id}"`);
        const result = await apiPost('create', id);

        if (result.success) {
            console.log(`✅ 시트 생성 완료: "${id}"`);
            closeCreateModal();

            // 생성 직후 → 빈 즐겨찾기로 앱 진입
            currentUser = id;
            favorites = new Set();
            serverFavKeys = new Set();
            favDirty = false;
            localStorage.setItem(CONFIG.USER_KEY, id);

            enterApp();
            showToast(`🎉 "${id}" 아이디가 생성되었습니다! 즐겨찾기를 추가해보세요.`);
        } else {
            DOM.createLoading.style.display = 'none';
            DOM.createConfirm.disabled = false;
            DOM.createCancel.disabled = false;
            closeCreateModal();
            showLoginError(result.error || '생성에 실패했습니다');
        }

    } catch (err) {
        console.error('생성 오류:', err);
        DOM.createLoading.style.display = 'none';
        DOM.createConfirm.disabled = false;
        DOM.createCancel.disabled = false;
        closeCreateModal();
        showLoginError('서버에 연결할 수 없습니다');
    }
}

// -- 게스트 로그인 --
function loginAsGuest() {
    currentUser = null;
    favorites = new Set();
    serverFavKeys = new Set();
    favDirty = false;
    enterApp();
    showToast('👤 게스트 모드: 즐겨찾기는 저장되지 않습니다');
}

// -- 앱 진입 --
function enterApp() {
    DOM.loginScreen.classList.add('hidden');
    DOM.appScreen.style.display = 'block';
    DOM.footer.style.display = 'block';
    DOM.userBar.style.display = 'flex';

    if (currentUser) {
        DOM.userBadge.textContent = `🎤 ${currentUser}`;
        DOM.saveFavBtn.style.display = 'inline-flex';
        $('#footerSaveInfo').textContent = `${currentUser} 클라우드 저장`;
    } else {
        DOM.userBadge.textContent = '👤 게스트';
        DOM.saveFavBtn.style.display = 'none';
        $('#footerSaveInfo').textContent = '게스트 (저장 불가)';
    }

    updateFavCount();
    updateSaveBtn();
    if (allSongs.length > 0) filterAndRender();
}

// -- 로그아웃 --
function handleLogout() {
    if (favDirty && currentUser) {
        if (!confirm('저장하지 않은 변경사항이 있습니다.\n정말 로그아웃하시겠습니까?')) return;
    }

    currentUser = null;
    favorites = new Set();
    serverFavKeys = new Set();
    favDirty = false;
    localStorage.removeItem(CONFIG.USER_KEY);

    DOM.appScreen.style.display = 'none';
    DOM.footer.style.display = 'none';
    DOM.loginScreen.classList.remove('hidden');
    DOM.userIdInput.value = '';
    DOM.userIdInput.disabled = false;
    DOM.loginBtn.disabled = false;
    DOM.guestBtn.disabled = false;
    hideLoginError();

    if (activeView === 'favorites') {
        activeView = 'all';
        $('#viewFilters').querySelectorAll('.filter-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.value === 'all')
        );
    }
    filterAndRender();
}

// -- 자동 로그인 --
async function tryAutoLogin() {
    const savedId = localStorage.getItem(CONFIG.USER_KEY);
    if (!savedId) return;

    DOM.userIdInput.value = savedId;
    setLoginLoading(true);

    try {
        const check = await apiGet('check', savedId);
        if (check.success && check.exists) {
            await loadAndEnter(savedId);
        } else {
            // 저장된 아이디가 삭제됨
            localStorage.removeItem(CONFIG.USER_KEY);
            setLoginLoading(false);
        }
    } catch {
        setLoginLoading(false);
    }
}

/* ══════════════════════════════════════
   ⭐ 즐겨찾기
   ══════════════════════════════════════ */
function updateFavCount() { DOM.favCount.textContent = favorites.size; }

function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

function updateSaveBtn() {
    if (!currentUser) return;
    DOM.saveFavBtn.classList.toggle('unsaved', favDirty);
    DOM.saveFavBtn.textContent = favDirty ? '💾 저장 (변경됨)' : '💾 저장됨';
}

function toggleFavorite(song) {
    const key = songKey(song);
    const wasFav = favorites.has(key);
    wasFav ? favorites.delete(key) : favorites.add(key);
    favDirty = !setsEqual(favorites, serverFavKeys);
    updateFavCount();
    updateSaveBtn();
    showToast(wasFav ? `💔 "${song.title}" 해제` : `⭐ "${song.title}" 추가!`);

    if (activeView === 'favorites') filterAndRender();
    else {
        DOM.tbody.querySelectorAll(`.fav-btn[data-key="${CSS.escape(key)}"]`).forEach(b => {
            b.textContent = !wasFav ? '❤️' : '🤍';
            b.classList.toggle('active', !wasFav);
        });
    }
}

// -- 저장 --
function showSaveModal() {
    if (!currentUser) return showToast('👤 게스트는 저장할 수 없습니다');
    if (!favDirty) return showToast('✅ 이미 저장되어 있습니다');
    $('#saveConfirmText').textContent = `"${currentUser}" 계정에 ${favorites.size}곡을 저장합니다`;
    DOM.saveModal.classList.add('active');
}
function closeSaveModal() { DOM.saveModal.classList.remove('active'); }

async function handleSave() {
    if (!currentUser) return;
    const loadEl = $('#saveLoading');
    loadEl.style.display = 'flex';
    $('#saveConfirmBtn').disabled = true;

    try {
        const favList = [...favorites].map(key => {
            const sep = key.indexOf('::');
            return { artist: key.substring(0, sep), title: key.substring(sep + 2) };
        });

        const result = await apiPost('save', currentUser, { favorites: favList });

        if (result.success) {
            serverFavKeys = new Set(favorites);
            favDirty = false;
            updateSaveBtn();
            closeSaveModal();
            showToast(`💾 ${result.count}곡 저장 완료!`);
        } else {
            showToast(`❌ 저장 실패: ${result.error}`);
        }
    } catch {
        showToast('❌ 서버에 연결할 수 없습니다');
    }

    loadEl.style.display = 'none';
    $('#saveConfirmBtn').disabled = false;
}

/* ══════════════════════════════════════
   테마
   ══════════════════════════════════════ */
function loadTheme() {
    const saved = localStorage.getItem(CONFIG.THEME_KEY);
    const prefer = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    applyTheme(saved || prefer);
}
function applyTheme(t) {
    document.body.setAttribute('data-theme', t);
    $('#themeToggle').textContent = t === 'dark' ? '🌙' : '☀️';
    localStorage.setItem(CONFIG.THEME_KEY, t);
}
function toggleTheme() {
    applyTheme(document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

/* ══════════════════════════════════════
   초성 검색 + HTML 유틸
   ══════════════════════════════════════ */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
const CHO_SET = new Set(CHO);
function getCho(c){const n=c.charCodeAt(0);return(n>=0xAC00&&n<=0xD7A3)?CHO[(n-0xAC00)/588|0]:c;}
function isAllCho(s){return[...s].every(c=>CHO_SET.has(c));}
function toChoStr(s){return[...s].map(getCho).join('');}
function matchText(t,q){if(!q)return true;if(t.toLowerCase().includes(q.toLowerCase()))return true;if(isAllCho(q)&&toChoStr(t).includes(q))return true;return false;}

const _d=document.createElement('div');
function esc(t){_d.textContent=t;return _d.innerHTML;}
function hilite(t,q){
    if(!q)return esc(t);
    let lo=t.toLowerCase(),lq=q.toLowerCase(),i=lo.indexOf(lq);
    if(i>=0)return esc(t.substring(0,i))+`<span class="highlight">${esc(t.substring(i,i+q.length))}</span>`+esc(t.substring(i+q.length));
    if(isAllCho(q)){const ini=toChoStr(t);i=ini.indexOf(q);if(i>=0)return esc(t.substring(0,i))+`<span class="highlight">${esc(t.substring(i,i+q.length))}</span>`+esc(t.substring(i+q.length));}
    return esc(t);
}

function parseGenres(s){return s?s.split(',').map(g=>g.trim()).filter(Boolean):[];}
function extractGenres(songs){const s=new Set();songs.forEach(song=>parseGenres(song.genre).forEach(g=>s.add(g)));return[...s].sort((a,b)=>a.localeCompare(b,'ko'));}

/* ══════════════════════════════════════
   토스트
   ══════════════════════════════════════ */
let _tt;
function showToast(m){DOM.toast.textContent=m;DOM.toast.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>DOM.toast.classList.remove('show'),2500);}

/* ══════════════════════════════════════
   노래 데이터 로드
   ══════════════════════════════════════ */
async function fetchSongs(){
    try{
        DOM.loading.style.display='block';DOM.errorMsg.style.display='none';
        let csv;
        const c=sessionStorage.getItem(CONFIG.CACHE_KEY);
        if(c){const{data,ts}=JSON.parse(c);if(Date.now()-ts<CONFIG.CACHE_TTL)csv=data;}
        if(!csv){const r=await fetch(SONG_CSV_URL);if(!r.ok)throw new Error(`HTTP ${r.status}`);csv=await r.text();try{sessionStorage.setItem(CONFIG.CACHE_KEY,JSON.stringify({data:csv,ts:Date.now()}));}catch{}}
        const p=Papa.parse(csv,{header:true,skipEmptyLines:true,transformHeader:h=>h.trim()});
        const h=p.meta.fields||[];
        allSongs=p.data.filter(r=>(r['곡명']||r[h[3]]||'').trim()).map((r,i)=>({
            id:i,genre:(r['장르']||r[h[0]]||'').trim(),gender:(r['성별']||r[h[1]]||'').trim(),
            artist:(r['가수']||r[h[2]]||'').trim(),title:(r['곡명']||r[h[3]]||'').trim(),
            lyrics:(r['가사']||r[h[4]]||'').trim(),
        }));
        console.log(`✅ ${allSongs.length}곡 로드`);
        buildGenreFilters();updateFavCount();
        DOM.loading.style.display='none';DOM.wrapper.style.display='block';
        filterAndRender();
    }catch(e){console.error('❌',e);DOM.loading.style.display='none';DOM.errorMsg.style.display='block';}
}

/* ══════════════════════════════════════
   장르 필터
   ══════════════════════════════════════ */
function buildGenreFilters(){
    const w=$('#genreFilters'),f=document.createDocumentFragment();
    extractGenres(allSongs).forEach(g=>{const b=document.createElement('button');b.className='filter-btn';b.dataset.value=g;b.textContent=g;f.appendChild(b);});
    w.appendChild(f);
    w.addEventListener('click',e=>{const b=e.target.closest('.filter-btn');if(!b)return;w.querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeGenre=b.dataset.value;filterAndRender();});
}

/* ══════════════════════════════════════
   정렬
   ══════════════════════════════════════ */
function sortSongs(s){if(!sortCol)return s;return[...s].sort((a,b)=>{const c=(a[sortCol]||'').localeCompare(b[sortCol]||'','ko');return sortDir==='desc'?-c:c;});}
function handleSort(c){if(sortCol===c){sortDir=sortDir==='asc'?'desc':(sortCol=null,'asc');}else{sortCol=c;sortDir='asc';}updateSortUI();filterAndRender();}
function updateSortUI(){$$('th.sortable').forEach(th=>{const a=th.dataset.sort===sortCol;th.classList.toggle('sort-active',a);th.querySelector('.sort-arrow').textContent=a?(sortDir==='asc'?'▲':'▼'):'⇅';});}

/* ══════════════════════════════════════
   필터 + 렌더
   ══════════════════════════════════════ */
function filterAndRender(){
    const q=searchQuery;
    filteredSongs=allSongs.filter(s=>{
        if(activeView==='favorites'&&!favorites.has(songKey(s)))return false;
        if(activeGender!=='전체'&&s.gender!==activeGender)return false;
        if(activeGenre!=='전체'&&!parseGenres(s.genre).includes(activeGenre))return false;
        if(q){const t=matchText(s.title,q),a=matchText(s.artist,q),l=searchLyrics&&s.lyrics.toLowerCase().includes(q.toLowerCase());if(!t&&!a&&!l)return false;}
        return true;
    });
    filteredSongs=sortSongs(filteredSongs);
    DOM.totalCount.textContent=allSongs.length;
    DOM.filteredCount.textContent=filteredSongs.length;
    displayedCount=0;DOM.tbody.innerHTML='';renderMore();
}

function renderMore(){
    if(isRendering)return;if(displayedCount>=filteredSongs.length){DOM.loadingMore.style.display='none';return;}
    isRendering=true;DOM.loadingMore.style.display=filteredSongs.length>CONFIG.PER_PAGE?'block':'none';
    requestAnimationFrame(()=>{
        if(!filteredSongs.length){DOM.noResult.style.display='block';DOM.loadingMore.style.display='none';isRendering=false;return;}
        DOM.noResult.style.display='none';
        const end=Math.min(displayedCount+CONFIG.PER_PAGE,filteredSongs.length),frag=document.createDocumentFragment();
        for(let i=displayedCount;i<end;i++){
            const s=filteredSongs[i],key=songKey(s),isFav=favorites.has(key),hasL=s.lyrics.length>0;
            const tr=document.createElement('tr');
            const gB=parseGenres(s.genre).map(g=>`<span class="badge badge-genre">${esc(g)}</span>`).join('');
            const gC=s.gender==='여'?'badge-female':'badge-male',gI=s.gender==='여'?'👩':'👨';
            tr.innerHTML=
                `<td>${i+1}</td>`
                +`<td><button class="fav-btn${isFav?' active':''}" data-key="${esc(key)}" data-idx="${i}">${isFav?'❤️':'🤍'}</button></td>`
                +`<td><div class="title-cell"><span class="song-title">${hilite(s.title,searchQuery)}</span>`
                +`<button class="lyrics-btn ${hasL?'has-lyrics':'no-lyrics'}" data-idx="${i}">📜</button></div></td>`
                +`<td class="song-artist">${hilite(s.artist,searchQuery)}</td>`
                +`<td>${gB}</td>`
                +`<td><span class="badge ${gC}">${gI} ${esc(s.gender)}</span></td>`;
            frag.appendChild(tr);
        }
        DOM.tbody.appendChild(frag);displayedCount=end;DOM.loadingMore.style.display='none';isRendering=false;
    });
}

/* ══════════════════════════════════════
   무한 스크롤 + 스크롤 버튼
   ══════════════════════════════════════ */
function initScrollObserver(){
    if(!('IntersectionObserver' in window))return;
    new IntersectionObserver(e=>{if(e[0].isIntersecting&&displayedCount<filteredSongs.length&&!isRendering)renderMore();},{rootMargin:'400px'}).observe(DOM.sentinel);
}
function initScrollTop(){
    let t=false;
    window.addEventListener('scroll',()=>{if(!t){requestAnimationFrame(()=>{DOM.scrollTopBtn.classList.toggle('visible',window.scrollY>600);t=false;});t=true;}},{passive:true});
    DOM.scrollTopBtn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
}

/* ══════════════════════════════════════
   가사 모달 + 랜덤
   ══════════════════════════════════════ */
function openLyricsModal(s){
    $('#modalTitle').textContent=s.title;$('#modalArtist').textContent=s.artist;$('#modalGenre').textContent=s.genre;
    const g=$('#modalGender');g.textContent=(s.gender==='여'?'👩 ':'👨 ')+s.gender;g.className=`mtag ${s.gender==='여'?'gender-tag':'gender-tag-m'}`;
    const l=s.lyrics.replace(/^[""\u201C\u201D]|[""\u201C\u201D]$/g,'').trim();
    $('#modalLyrics').textContent=l||'가사 정보가 없습니다.';
    DOM.lyricsModal.classList.add('active');document.body.style.overflow='hidden';
}
function closeLyricsModal(){DOM.lyricsModal.classList.remove('active');document.body.style.overflow='';}

function pickRandom(){
    const pool=filteredSongs.length?filteredSongs:allSongs;if(!pool.length)return showToast('🎵 곡이 없습니다!');
    const icon=$('#randomIcon');icon.classList.remove('spinning');void icon.offsetWidth;icon.classList.add('spinning');
    const s=pool[Math.random()*pool.length|0];currentRandomSong=s;
    $('#randomTitle').textContent=s.title;$('#randomArtist').textContent=s.artist;$('#randomGenre').textContent=s.genre;
    const g=$('#randomGender');g.textContent=(s.gender==='여'?'👩 ':'👨 ')+s.gender;g.className=`mtag ${s.gender==='여'?'gender-tag':'gender-tag-m'}`;
    $('#randomFavBtn').textContent=favorites.has(songKey(s))?'💛 해제':'⭐ 즐겨찾기';
    const lb=$('#randomLyricsBtn'),hl=!!s.lyrics.trim();lb.disabled=!hl;lb.style.opacity=hl?1:.4;
    DOM.randomModal.classList.add('active');document.body.style.overflow='hidden';
}
function closeRandomModal(){DOM.randomModal.classList.remove('active');document.body.style.overflow='';}

/* ══════════════════════════════════════
   유틸
   ══════════════════════════════════════ */
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function bindFilterGroup(id,cb){$(id).addEventListener('click',e=>{const b=e.target.closest('.filter-btn');if(!b)return;$(id).querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');cb(b.dataset.value);});}

/* ══════════════════════════════════════
   초기화
   ══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    loadTheme();
    updateSortUI();
    initScrollObserver();
    initScrollTop();
    fetchSongs();
    tryAutoLogin();

    // 테마
    $('#themeToggle').addEventListener('click', toggleTheme);

    // ── 로그인 이벤트 ──
    DOM.loginBtn.addEventListener('click', handleLogin);
    DOM.userIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
    DOM.guestBtn.addEventListener('click', loginAsGuest);

    // ── 생성 확인 모달 ──
    DOM.createConfirm.addEventListener('click', handleCreateConfirm);
    DOM.createCancel.addEventListener('click', closeCreateModal);
    $('.create-overlay').addEventListener('click', closeCreateModal);

    // ── 사용자 바 ──
    DOM.logoutBtn.addEventListener('click', handleLogout);
    DOM.saveFavBtn.addEventListener('click', showSaveModal);

    // ── 저장 모달 ──
    $('#saveConfirmBtn').addEventListener('click', handleSave);
    $('#saveCancelBtn').addEventListener('click', closeSaveModal);
    $('.save-overlay').addEventListener('click', closeSaveModal);

    // ── 검색 ──
    DOM.searchInput.addEventListener('input', debounce(e => {
        searchQuery = e.target.value.trim(); filterAndRender();
    }, 200));
    $('#lyricsSearchToggle').addEventListener('change', e => {
        searchLyrics = e.target.checked; if (searchQuery) filterAndRender();
    });

    // ── 필터 ──
    bindFilterGroup('#viewFilters', v => { activeView = v; filterAndRender(); });
    bindFilterGroup('#genderFilters', v => { activeGender = v; filterAndRender(); });

    // ── 정렬 ──
    $$('th.sortable').forEach(th => th.addEventListener('click', () => handleSort(th.dataset.sort)));

    // ── 테이블 클릭 위임 ──
    DOM.tbody.addEventListener('click', e => {
        const lBtn = e.target.closest('.lyrics-btn.has-lyrics');
        if (lBtn) return openLyricsModal(filteredSongs[+lBtn.dataset.idx]);
        const fBtn = e.target.closest('.fav-btn');
        if (fBtn) return toggleFavorite(filteredSongs[+fBtn.dataset.idx]);
    });

    // ── 모달 닫기 ──
    $('#modalClose').addEventListener('click', closeLyricsModal);
    $('#lyricsModal .modal-overlay').addEventListener('click', closeLyricsModal);

    // ── 랜덤 ──
    $('#randomBtn').addEventListener('click', pickRandom);
    $('#randomClose').addEventListener('click', closeRandomModal);
    $('.random-overlay').addEventListener('click', closeRandomModal);
    $('#randomAgainBtn').addEventListener('click', pickRandom);
    $('#randomLyricsBtn').addEventListener('click', () => {
        if (currentRandomSong?.lyrics.trim()) {
            closeRandomModal(); setTimeout(() => openLyricsModal(currentRandomSong), 250);
        }
    });
    $('#randomFavBtn').addEventListener('click', () => {
        if (!currentRandomSong) return;
        toggleFavorite(currentRandomSong);
        $('#randomFavBtn').textContent = favorites.has(songKey(currentRandomSong)) ? '💛 해제' : '⭐ 즐겨찾기';
    });

    // ── 재시도 ──
    $('#retryBtn').addEventListener('click', () => { sessionStorage.removeItem(CONFIG.CACHE_KEY); fetchSongs(); });

    // ── 키보드 ──
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeLyricsModal(); closeRandomModal(); closeSaveModal(); closeCreateModal(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); DOM.searchInput.focus(); DOM.searchInput.select(); }
    });

    // ── 페이지 나가기 경고 ──
    window.addEventListener('beforeunload', e => {
        if (favDirty && currentUser) { e.preventDefault(); e.returnValue = ''; }
    });
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
