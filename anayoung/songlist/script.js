/* ╔═══════════════════════════════════════════════════════════╗
   ║  ⚙️  설정                                                ║
   ╚═══════════════════════════════════════════════════════════╝ */
const CONFIG = Object.freeze({
    // 노래 데이터 스프레드시트
    SONG_SS_ID : '1sAsXEl14Vr4k1hlAhdHD5JpIjWu4eFQgwo2KP9nP8oU',
    SONG_SHEET : '데이터베이스',
    SONG_RANGE : 'E:I',

    // ⭐ Google Apps Script 웹앱 URL (배포 후 여기에 입력!)
    API_URL    : 'YOUR_APPS_SCRIPT_URL_HERE',

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

// 사용자 상태
let currentUser = null;      // null = 게스트
let favorites = new Set();
let favDirty = false;        // 저장되지 않은 변경
let serverFavKeys = new Set(); // 서버에 저장된 상태 (비교용)

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
let DOM = {};

function cacheDom() {
    DOM = {
        loginScreen:   $('#loginScreen'),
        appScreen:     $('#appScreen'),
        userIdInput:   $('#userIdInput'),
        loginBtn:      $('#loginBtn'),
        guestBtn:      $('#guestBtn'),
        loginError:    $('#loginError'),
        loginLoading:  $('#loginLoading'),
        createModal:   $('#createModal'),
        userBar:       $('#userBar'),
        userBadge:     $('#userBadge'),
        saveFavBtn:    $('#saveFavBtn'),
        logoutBtn:     $('#logoutBtn'),
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
   API 호출 헬퍼
   ══════════════════════════════════════ */
async function apiGet(action, id) {
    const url = `${CONFIG.API_URL}?action=${action}&id=${encodeURIComponent(id)}`;
    const res = await fetch(url);
    return res.json();
}

async function apiPost(action, id, data = {}) {
    const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, id, ...data }),
    });
    return res.json();
}

/* ══════════════════════════════════════
   로그인 / 사용자 관리
   ══════════════════════════════════════ */
function showLoginError(msg) {
    DOM.loginError.textContent = msg;
    DOM.loginError.style.display = 'block';
}

function hideLoginError() { DOM.loginError.style.display = 'none'; }

function setLoginLoading(on) {
    DOM.loginLoading.style.display = on ? 'flex' : 'none';
    DOM.loginBtn.disabled = on;
    DOM.userIdInput.disabled = on;
}

async function handleLogin() {
    const id = DOM.userIdInput.value.trim();
    if (!id) return showLoginError('아이디를 입력해주세요');
    if (!/^[a-zA-Z0-9가-힣_\-]{1,20}$/.test(id)) {
        return showLoginError('영문, 한글, 숫자, _, - 만 사용 (1~20자)');
    }

    hideLoginError();
    setLoginLoading(true);

    try {
        const result = await apiGet('check', id);

        if (!result.success) {
            showLoginError(result.error || '서버 오류');
            setLoginLoading(false);
            return;
        }

        if (result.exists) {
            // 기존 사용자 → 즐겨찾기 불러오기
            await loginUser(id);
        } else {
            // 새 사용자 → 생성 확인 모달
            setLoginLoading(false);
            showCreateModal(id);
        }
    } catch (err) {
        console.error(err);
        showLoginError('서버에 연결할 수 없습니다');
        setLoginLoading(false);
    }
}

async function loginUser(id) {
    try {
        setLoginLoading(true);
        const result = await apiGet('load', id);

        if (result.success) {
            currentUser = id;
            favorites = new Set(result.favorites.map(f => `${f.artist}::${f.title}`));
            serverFavKeys = new Set(favorites);
            favDirty = false;

            localStorage.setItem(CONFIG.USER_KEY, id);

            enterApp();
            showToast(`👋 ${id}님 환영합니다! (${result.count}곡 즐겨찾기)`);
        } else {
            showLoginError(result.error);
        }
    } catch (err) {
        showLoginError('즐겨찾기를 불러올 수 없습니다');
    }
    setLoginLoading(false);
}

function showCreateModal(id) {
    $('#createIdDisplay').textContent = `"${id}"`;
    DOM.createModal.classList.add('active');
}

function closeCreateModal() {
    DOM.createModal.classList.remove('active');
}

async function handleCreate() {
    const id = DOM.userIdInput.value.trim();
    const loadEl = $('#createLoading');
    loadEl.style.display = 'flex';
    $('#createConfirmBtn').disabled = true;

    try {
        const result = await apiPost('create', id);

        if (result.success) {
            closeCreateModal();
            await loginUser(id);
        } else {
            closeCreateModal();
            showLoginError(result.error);
        }
    } catch (err) {
        closeCreateModal();
        showLoginError('생성에 실패했습니다');
    }

    loadEl.style.display = 'none';
    $('#createConfirmBtn').disabled = false;
}

function loginAsGuest() {
    currentUser = null;
    favorites = new Set();
    serverFavKeys = new Set();
    favDirty = false;
    enterApp();
    showToast('👤 게스트로 접속했습니다 (즐겨찾기 저장 불가)');
}

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
}

function handleLogout() {
    if (favDirty && currentUser) {
        if (!confirm('저장하지 않은 즐겨찾기 변경사항이 있습니다.\n정말 로그아웃하시겠습니까?')) {
            return;
        }
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
    hideLoginError();

    // 테이블 리셋
    if (activeView === 'favorites') {
        activeView = 'all';
        $('#viewFilters').querySelectorAll('.filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.value === 'all');
        });
    }
    filterAndRender();
}

// 자동 로그인
async function tryAutoLogin() {
    const savedId = localStorage.getItem(CONFIG.USER_KEY);
    if (savedId) {
        DOM.userIdInput.value = savedId;
        try {
            await loginUser(savedId);
        } catch {
            DOM.loginScreen.classList.remove('hidden');
        }
    }
}

/* ══════════════════════════════════════
   즐겨찾기
   ══════════════════════════════════════ */
function updateFavCount() { DOM.favCount.textContent = favorites.size; }

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
    else updateFavBtnUI(key, !wasFav);
}

function updateFavBtnUI(key, isFav) {
    DOM.tbody.querySelectorAll(`.fav-btn[data-key="${CSS.escape(key)}"]`).forEach(b => {
        b.textContent = isFav ? '❤️' : '🤍';
        b.classList.toggle('active', isFav);
    });
}

function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

// 저장 확인 모달
function showSaveModal() {
    if (!currentUser) return showToast('👤 게스트는 저장할 수 없습니다');
    if (!favDirty) return showToast('✅ 이미 저장되어 있습니다');

    $('#saveConfirmText').textContent =
        `"${currentUser}" 계정에 ${favorites.size}곡을 저장합니다`;
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
            const [artist, title] = key.split('::');
            return { artist, title };
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
    } catch (err) {
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
   초성 검색
   ══════════════════════════════════════ */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
const CHO_SET = new Set(CHO);
function getCho(c) { const n=c.charCodeAt(0); return(n>=0xAC00&&n<=0xD7A3)?CHO[(n-0xAC00)/588|0]:c; }
function isAllCho(s) { return [...s].every(c=>CHO_SET.has(c)); }
function toChoStr(s) { return [...s].map(getCho).join(''); }
function matchText(text,q) {
    if(!q) return true;
    if(text.toLowerCase().includes(q.toLowerCase())) return true;
    if(isAllCho(q)&&toChoStr(text).includes(q)) return true;
    return false;
}

/* ══════════════════════════════════════
   HTML 유틸
   ══════════════════════════════════════ */
const _div = document.createElement('div');
function esc(t) { _div.textContent=t; return _div.innerHTML; }
function hilite(text,q) {
    if(!q) return esc(text);
    const lo=text.toLowerCase(), lq=q.toLowerCase();
    let idx=lo.indexOf(lq);
    if(idx>=0) return esc(text.substring(0,idx))+`<span class="highlight">${esc(text.substring(idx,idx+q.length))}</span>`+esc(text.substring(idx+q.length));
    if(isAllCho(q)){const ini=toChoStr(text);idx=ini.indexOf(q);if(idx>=0) return esc(text.substring(0,idx))+`<span class="highlight">${esc(text.substring(idx,idx+q.length))}</span>`+esc(text.substring(idx+q.length));}
    return esc(text);
}

function parseGenres(s) { return s?s.split(',').map(g=>g.trim()).filter(Boolean):[]; }
function extractGenres(songs) { const s=new Set(); songs.forEach(song=>parseGenres(song.genre).forEach(g=>s.add(g))); return[...s].sort((a,b)=>a.localeCompare(b,'ko')); }

/* ══════════════════════════════════════
   토스트
   ══════════════════════════════════════ */
let _tt;
function showToast(msg) { DOM.toast.textContent=msg; DOM.toast.classList.add('show'); clearTimeout(_tt); _tt=setTimeout(()=>DOM.toast.classList.remove('show'),2500); }

/* ══════════════════════════════════════
   노래 데이터 로드
   ══════════════════════════════════════ */
async function fetchSongs() {
    try {
        DOM.loading.style.display='block';
        DOM.errorMsg.style.display='none';

        let csvText;
        const cached = sessionStorage.getItem(CONFIG.CACHE_KEY);
        if(cached){const{data,ts}=JSON.parse(cached);if(Date.now()-ts<CONFIG.CACHE_TTL)csvText=data;}
        if(!csvText){const res=await fetch(SONG_CSV_URL);if(!res.ok)throw new Error(`HTTP ${res.status}`);csvText=await res.text();try{sessionStorage.setItem(CONFIG.CACHE_KEY,JSON.stringify({data:csvText,ts:Date.now()}));}catch{}}

        const parsed=Papa.parse(csvText,{header:true,skipEmptyLines:true,transformHeader:h=>h.trim()});
        const headers=parsed.meta.fields||[];

        allSongs=parsed.data
            .filter(r=>(r['곡명']||r[headers[3]]||'').trim())
            .map((r,i)=>({
                id:i,
                genre:(r['장르']||r[headers[0]]||'').trim(),
                gender:(r['성별']||r[headers[1]]||'').trim(),
                artist:(r['가수']||r[headers[2]]||'').trim(),
                title:(r['곡명']||r[headers[3]]||'').trim(),
                lyrics:(r['가사']||r[headers[4]]||'').trim(),
            }));

        console.log(`✅ ${allSongs.length}곡 로드`);
        buildGenreFilters();
        updateFavCount();

        DOM.loading.style.display='none';
        DOM.wrapper.style.display='block';
        filterAndRender();
    } catch(err) {
        console.error('❌',err);
        DOM.loading.style.display='none';
        DOM.errorMsg.style.display='block';
    }
}

/* ══════════════════════════════════════
   장르 필터
   ══════════════════════════════════════ */
function buildGenreFilters() {
    const wrap=$('#genreFilters');
    const frag=document.createDocumentFragment();
    extractGenres(allSongs).forEach(g=>{
        const btn=document.createElement('button');
        btn.className='filter-btn'; btn.dataset.value=g; btn.textContent=g;
        frag.appendChild(btn);
    });
    wrap.appendChild(frag);
    wrap.addEventListener('click',e=>{
        const btn=e.target.closest('.filter-btn'); if(!btn) return;
        wrap.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        activeGenre=btn.dataset.value;
        filterAndRender();
    });
}

/* ══════════════════════════════════════
   정렬
   ══════════════════════════════════════ */
function sortSongs(songs) {
    if(!sortCol) return songs;
    return[...songs].sort((a,b)=>{const c=(a[sortCol]||'').localeCompare(b[sortCol]||'','ko');return sortDir==='desc'?-c:c;});
}

function handleSort(col) {
    if(sortCol===col){sortDir=sortDir==='asc'?'desc':(sortCol=null,'asc');}
    else{sortCol=col;sortDir='asc';}
    updateSortUI(); filterAndRender();
}

function updateSortUI() {
    $$('th.sortable').forEach(th=>{
        const a=th.dataset.sort===sortCol;
        th.classList.toggle('sort-active',a);
        th.querySelector('.sort-arrow').textContent=a?(sortDir==='asc'?'▲':'▼'):'⇅';
    });
}

/* ══════════════════════════════════════
   필터 + 렌더
   ══════════════════════════════════════ */
function filterAndRender() {
    const q=searchQuery;
    filteredSongs=allSongs.filter(song=>{
        if(activeView==='favorites'&&!favorites.has(songKey(song))) return false;
        if(activeGender!=='전체'&&song.gender!==activeGender) return false;
        if(activeGenre!=='전체'&&!parseGenres(song.genre).includes(activeGenre)) return false;
        if(q){
            const t=matchText(song.title,q),a=matchText(song.artist,q);
            const l=searchLyrics&&song.lyrics.toLowerCase().includes(q.toLowerCase());
            if(!t&&!a&&!l) return false;
        }
        return true;
    });

    filteredSongs=sortSongs(filteredSongs);
    DOM.totalCount.textContent=allSongs.length;
    DOM.filteredCount.textContent=filteredSongs.length;

    displayedCount=0;
    DOM.tbody.innerHTML='';
    renderMore();
}

function renderMore() {
    if(isRendering) return;
    if(displayedCount>=filteredSongs.length){DOM.loadingMore.style.display='none';return;}

    isRendering=true;
    DOM.loadingMore.style.display=filteredSongs.length>CONFIG.PER_PAGE?'block':'none';

    requestAnimationFrame(()=>{
        if(filteredSongs.length===0){DOM.noResult.style.display='block';DOM.loadingMore.style.display='none';isRendering=false;return;}
        DOM.noResult.style.display='none';

        const end=Math.min(displayedCount+CONFIG.PER_PAGE,filteredSongs.length);
        const frag=document.createDocumentFragment();

        for(let i=displayedCount;i<end;i++){
            const s=filteredSongs[i], key=songKey(s), isFav=favorites.has(key), hasL=s.lyrics.length>0;
            const tr=document.createElement('tr');
            const gBadges=parseGenres(s.genre).map(g=>`<span class="badge badge-genre">${esc(g)}</span>`).join('');
            const gCls=s.gender==='여'?'badge-female':'badge-male';
            const gIcon=s.gender==='여'?'👩':'👨';

            tr.innerHTML=
                `<td>${i+1}</td>`
                +`<td><button class="fav-btn${isFav?' active':''}" data-key="${esc(key)}" data-idx="${i}">${isFav?'❤️':'🤍'}</button></td>`
                +`<td><div class="title-cell"><span class="song-title">${hilite(s.title,searchQuery)}</span>`
                +`<button class="lyrics-btn ${hasL?'has-lyrics':'no-lyrics'}" data-idx="${i}">📜</button></div></td>`
                +`<td class="song-artist">${hilite(s.artist,searchQuery)}</td>`
                +`<td>${gBadges}</td>`
                +`<td><span class="badge ${gCls}">${gIcon} ${esc(s.gender)}</span></td>`;

            frag.appendChild(tr);
        }

        DOM.tbody.appendChild(frag);
        displayedCount=end;
        DOM.loadingMore.style.display='none';
        isRendering=false;
    });
}

/* ══════════════════════════════════════
   무한 스크롤 + 스크롤 버튼
   ══════════════════════════════════════ */
function initScrollObserver() {
    if(!('IntersectionObserver' in window)) return;
    new IntersectionObserver(entries=>{
        if(entries[0].isIntersecting&&displayedCount<filteredSongs.length&&!isRendering) renderMore();
    },{rootMargin:'400px'}).observe(DOM.sentinel);
}

function initScrollTop() {
    let tick=false;
    window.addEventListener('scroll',()=>{
        if(!tick){requestAnimationFrame(()=>{DOM.scrollTopBtn.classList.toggle('visible',window.scrollY>600);tick=false;});tick=true;}
    },{passive:true});
    DOM.scrollTopBtn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
}

/* ══════════════════════════════════════
   가사 모달
   ══════════════════════════════════════ */
function openLyricsModal(song) {
    $('#modalTitle').textContent=song.title;
    $('#modalArtist').textContent=song.artist;
    $('#modalGenre').textContent=song.genre;
    const gt=$('#modalGender');
    gt.textContent=(song.gender==='여'?'👩 ':'👨 ')+song.gender;
    gt.className=`mtag ${song.gender==='여'?'gender-tag':'gender-tag-m'}`;
    const l=song.lyrics.replace(/^[""\u201C\u201D]|[""\u201C\u201D]$/g,'').trim();
    $('#modalLyrics').textContent=l||'가사 정보가 없습니다.';
    DOM.lyricsModal.classList.add('active');
    document.body.style.overflow='hidden';
}

function closeLyricsModal() { DOM.lyricsModal.classList.remove('active'); document.body.style.overflow=''; }

/* ══════════════════════════════════════
   랜덤 추천
   ══════════════════════════════════════ */
function pickRandom() {
    const pool=filteredSongs.length?filteredSongs:allSongs;
    if(!pool.length) return showToast('🎵 곡이 없습니다!');

    const icon=$('#randomIcon');
    icon.classList.remove('spinning'); void icon.offsetWidth; icon.classList.add('spinning');

    const song=pool[Math.random()*pool.length|0];
    currentRandomSong=song;

    $('#randomTitle').textContent=song.title;
    $('#randomArtist').textContent=song.artist;
    $('#randomGenre').textContent=song.genre;
    const gt=$('#randomGender');
    gt.textContent=(song.gender==='여'?'👩 ':'👨 ')+song.gender;
    gt.className=`mtag ${song.gender==='여'?'gender-tag':'gender-tag-m'}`;

    $('#randomFavBtn').textContent=favorites.has(songKey(song))?'💛 해제':'⭐ 즐겨찾기';
    const lb=$('#randomLyricsBtn'); const hl=!!song.lyrics.trim(); lb.disabled=!hl; lb.style.opacity=hl?1:.4;

    DOM.randomModal.classList.add('active');
    document.body.style.overflow='hidden';
}

function closeRandomModal() { DOM.randomModal.classList.remove('active'); document.body.style.overflow=''; }

/* ══════════════════════════════════════
   유틸
   ══════════════════════════════════════ */
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}

function bindFilterGroup(id,cb){
    $(id).addEventListener('click',e=>{
        const btn=e.target.closest('.filter-btn');if(!btn)return;
        $(id).querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active'); cb(btn.dataset.value);
    });
}

/* ══════════════════════════════════════
   초기화
   ══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
    cacheDom();
    loadTheme();
    updateSortUI();
    initScrollObserver();
    initScrollTop();
    fetchSongs();

    // 자동 로그인
    tryAutoLogin();

    // ── 테마 ──
    $('#themeToggle').addEventListener('click',toggleTheme);

    // ── 로그인 ──
    DOM.loginBtn.addEventListener('click',handleLogin);
    DOM.userIdInput.addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin();});
    DOM.guestBtn.addEventListener('click',loginAsGuest);

    // ── 새 아이디 생성 ──
    $('#createConfirmBtn').addEventListener('click',handleCreate);
    $('#createCancelBtn').addEventListener('click',closeCreateModal);
    $('.create-overlay').addEventListener('click',closeCreateModal);

    // ── 로그아웃 ──
    DOM.logoutBtn.addEventListener('click',handleLogout);

    // ── 저장 ──
    DOM.saveFavBtn.addEventListener('click',showSaveModal);
    $('#saveConfirmBtn').addEventListener('click',handleSave);
    $('#saveCancelBtn').addEventListener('click',closeSaveModal);
    $('.save-overlay').addEventListener('click',closeSaveModal);

    // ── 검색 ──
    DOM.searchInput.addEventListener('input',debounce(e=>{searchQuery=e.target.value.trim();filterAndRender();},200));
    $('#lyricsSearchToggle').addEventListener('change',e=>{searchLyrics=e.target.checked;if(searchQuery)filterAndRender();});

    // ── 필터 ──
    bindFilterGroup('#viewFilters',v=>{activeView=v;filterAndRender();});
    bindFilterGroup('#genderFilters',v=>{activeGender=v;filterAndRender();});

    // ── 정렬 ──
    $$('th.sortable').forEach(th=>th.addEventListener('click',()=>handleSort(th.dataset.sort)));

    // ── 테이블 클릭 ──
    DOM.tbody.addEventListener('click',e=>{
        const lBtn=e.target.closest('.lyrics-btn.has-lyrics');
        if(lBtn) return openLyricsModal(filteredSongs[+lBtn.dataset.idx]);
        const fBtn=e.target.closest('.fav-btn');
        if(fBtn) return toggleFavorite(filteredSongs[+fBtn.dataset.idx]);
    });

    // ── 모달 닫기 ──
    $('#modalClose').addEventListener('click',closeLyricsModal);
    $('#lyricsModal .modal-overlay').addEventListener('click',closeLyricsModal);

    // ── 랜덤 ──
    $('#randomBtn').addEventListener('click',pickRandom);
    $('#randomClose').addEventListener('click',closeRandomModal);
    $('.random-overlay').addEventListener('click',closeRandomModal);
    $('#randomAgainBtn').addEventListener('click',pickRandom);
    $('#randomLyricsBtn').addEventListener('click',()=>{
        if(currentRandomSong?.lyrics.trim()){closeRandomModal();setTimeout(()=>openLyricsModal(currentRandomSong),250);}
    });
    $('#randomFavBtn').addEventListener('click',()=>{
        if(!currentRandomSong)return;
        toggleFavorite(currentRandomSong);
        $('#randomFavBtn').textContent=favorites.has(songKey(currentRandomSong))?'💛 해제':'⭐ 즐겨찾기';
    });

    // ── 재시도 ──
    $('#retryBtn').addEventListener('click',()=>{sessionStorage.removeItem(CONFIG.CACHE_KEY);fetchSongs();});

    // ── 키보드 ──
    document.addEventListener('keydown',e=>{
        if(e.key==='Escape'){closeLyricsModal();closeRandomModal();closeSaveModal();closeCreateModal();}
        if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();DOM.searchInput.focus();DOM.searchInput.select();}
    });

    // ── 페이지 나가기 경고 ──
    window.addEventListener('beforeunload',e=>{
        if(favDirty&&currentUser){e.preventDefault();e.returnValue='';}
    });
});

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
