/* ============================================
   설정
   ============================================ */
const CONFIG = Object.freeze({
    SONG_SS_ID : '1sAsXEl14Vr4k1hlAhdHD5JpIjWu4eFQgwo2KP9nP8oU',
    SONG_SHEET : '데이터베이스',
    SONG_RANGE : 'E:K',   // ★ CHANGED: E:J → E:K (J=미션곡, K=부른횟수)
    API_URL    : 'https://script.google.com/macros/s/AKfycbwSK3iHaV3QbyEFpW347SsOaG6ZrkE3Yx9WLrAM-5pmETbkYDgFMN08HWJpYVstUpnu/exec',
    PER_PAGE   : 80,
    CACHE_KEY  : 'songlist_cache',
    CACHE_TTL  : 5 * 60 * 1000,
    THEME_KEY  : 'songlist_theme',
    USER_KEY   : 'songlist_user',
});

const SONG_CSV_URL =
    `https://docs.google.com/spreadsheets/d/${CONFIG.SONG_SS_ID}` +
    `/gviz/tq?tqx=out:csv` +
    `&sheet=${encodeURIComponent(CONFIG.SONG_SHEET)}` +
    `&range=${CONFIG.SONG_RANGE}`;

/* ============================================
   전역 상태
   ============================================ */
let allSongs       = [];
let filteredSongs  = [];
let displayedCount = 0;

let activeView   = 'all';
let activeGender = '전체';
let activeGenre  = '전체';
let searchQuery  = '';
let searchLyrics = false;
let sortCol      = null;
let sortDir      = 'asc';

let currentRandomSong = null;
let isRendering       = false;

let currentUser   = null;
let favorites     = new Set();
let favDirty      = false;
let serverFavKeys = new Set();

let pendingCreateId = null;
let pendingFavSong  = null;
let pendingAction   = null;

/* ============================================
   DOM 캐시
   ============================================ */
const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
let DOM  = {};

function cacheDom() {
    DOM = {
        loginOverlay    : $('#loginOverlay'),
        createOverlay   : $('#createOverlay'),
        userIdInput     : $('#userIdInput'),
        loginBtn        : $('#loginBtn'),
        loginError      : $('#loginError'),
        loginLoading    : $('#loginLoading'),
        createIdDisplay : $('#createIdDisplay'),
        createConfirm   : $('#createConfirmBtn'),
        createCancel    : $('#createCancelBtn'),
        createLoading   : $('#createLoading'),
        createError     : $('#createError'),
        loginOpenBtn    : $('#loginOpenBtn'),
        userBadge       : $('#userBadge'),
        saveFavBtn      : $('#saveFavBtn'),
        logoutBtn       : $('#logoutBtn'),
        tbody           : $('#songTableBody'),
        totalCount      : $('#totalCount'),
        filteredCount   : $('#filteredCount'),
        favCount        : $('#favCount'),
        noResult        : $('#noResult'),
        loading         : $('#loading'),
        errorMsg        : $('#errorMsg'),
        wrapper         : $('#songListWrapper'),
        searchInput     : $('#searchInput'),
        sentinel        : $('#scrollSentinel'),
        loadingMore     : $('#loadingMore'),
        lyricsModal     : $('#lyricsModal'),
        randomModal     : $('#randomModal'),
        saveModal       : $('#saveConfirmModal'),
        toast           : $('#toast'),
        scrollTopBtn    : $('#scrollTopBtn'),
    };
}

const songKey = (s) => `${s.artist}::${s.title}`;

/* ============================================
   API
   ============================================ */
async function apiGet(action, id) {
    const url = `${CONFIG.API_URL}?action=${encodeURIComponent(action)}&id=${encodeURIComponent(id)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function apiPost(action, id, extra = {}) {
    const res = await fetch(CONFIG.API_URL, {
        method  : 'POST',
        headers : { 'Content-Type': 'text/plain' },
        body    : JSON.stringify({ action, id, ...extra }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/* ============================================
   유저바 UI
   ============================================ */
function updateUserBar() {
    if (currentUser) {
        DOM.loginOpenBtn.style.display = 'none';
        DOM.userBadge.textContent      = `🎤 ${currentUser}`;
        DOM.userBadge.style.display    = '';
        DOM.saveFavBtn.style.display   = '';
        DOM.logoutBtn.style.display    = '';
        $('#footerSaveInfo').textContent = `${currentUser} 클라우드 저장`;
    } else {
        DOM.loginOpenBtn.style.display = '';
        DOM.userBadge.style.display    = 'none';
        DOM.saveFavBtn.style.display   = 'none';
        DOM.logoutBtn.style.display    = 'none';
        $('#footerSaveInfo').textContent = '로그인하여 즐겨찾기 저장';
    }
    updateFavCount();
    updateSaveBtn();
}

/* ============================================
   로그인 가드
   ============================================ */
function requireLogin(action, song = null) {
    if (currentUser) return true;
    pendingAction  = action;
    pendingFavSong = song;
    showLoginOverlay();
    return false;
}

/* ============================================
   로그인 오버레이
   ============================================ */
function showLoginOverlay() {
    DOM.loginError.style.display   = 'none';
    DOM.loginLoading.style.display = 'none';
    DOM.loginBtn.disabled          = false;
    DOM.userIdInput.disabled       = false;
    DOM.userIdInput.value          = '';
    DOM.loginOverlay.classList.add('active');
    setTimeout(() => DOM.userIdInput.focus(), 300);
}

function hideLoginOverlay() {
    DOM.loginOverlay.classList.remove('active');
    pendingAction  = null;
    pendingFavSong = null;
}

function showLoginError(msg) {
    DOM.loginError.textContent   = msg;
    DOM.loginError.style.display = 'block';
}

function hideLoginError() {
    DOM.loginError.style.display = 'none';
}

function setLoginLoading(on) {
    DOM.loginLoading.style.display = on ? 'flex' : 'none';
    DOM.loginBtn.disabled          = on;
    DOM.userIdInput.disabled       = on;
}

async function handleLogin() {
    const id = DOM.userIdInput.value.trim();
    if (!id)                                         { showLoginError('아이디를 입력해주세요'); DOM.userIdInput.focus(); return; }
    if (!/^[a-zA-Z0-9가-힣_\-]{1,20}$/.test(id))    { showLoginError('영문, 한글, 숫자, _, - 만 사용 (1~20자)'); return; }

    hideLoginError();
    setLoginLoading(true);

    try {
        const result = await apiGet('check', id);
        if (!result.success) { showLoginError(result.error || '서버 오류'); setLoginLoading(false); return; }

        if (result.exists) {
            await loadAndLogin(id);
        } else {
            setLoginLoading(false);
            showCreateOverlay(id);
        }
    } catch (err) {
        console.error(err);
        showLoginError('서버에 연결할 수 없습니다');
        setLoginLoading(false);
    }
}

async function loadAndLogin(id) {
    try {
        const result = await apiGet('load', id);
        if (!result.success) { showLoginError(result.error); setLoginLoading(false); return; }

        currentUser   = id;
        favorites     = new Set(result.favorites.map(f => `${f.artist}::${f.title}`));
        serverFavKeys = new Set(favorites);
        favDirty      = false;

        localStorage.setItem(CONFIG.USER_KEY, id);
        setLoginLoading(false);
        hideLoginOverlay();
        updateUserBar();
        showToast(`👋 ${id}님 환영합니다! (즐겨찾기 ${result.count}곡)`);
        executePendingAction();
        filterAndRender();
    } catch (err) {
        console.error(err);
        showLoginError('즐겨찾기를 불러올 수 없습니다');
        setLoginLoading(false);
    }
}

/* ============================================
   아이디 생성 확인 오버레이
   ============================================ */
function showCreateOverlay(id) {
    pendingCreateId = id;
    DOM.createIdDisplay.textContent = id;
    DOM.createError.style.display   = 'none';
    DOM.createLoading.style.display = 'none';
    DOM.createConfirm.disabled      = false;
    DOM.createCancel.disabled       = false;
    DOM.loginOverlay.classList.remove('active');
    DOM.createOverlay.classList.add('active');
}

function hideCreateOverlay() {
    DOM.createOverlay.classList.remove('active');
    pendingCreateId = null;
}

async function handleCreateConfirm() {
    if (!pendingCreateId) return;
    const id = pendingCreateId;

    DOM.createConfirm.disabled      = true;
    DOM.createCancel.disabled       = true;
    DOM.createLoading.style.display = 'flex';
    DOM.createError.style.display   = 'none';

    try {
        const result = await apiPost('create', id);
        if (result.success) {
            currentUser   = id;
            favorites     = new Set();
            serverFavKeys = new Set();
            favDirty      = false;

            localStorage.setItem(CONFIG.USER_KEY, id);
            DOM.createLoading.style.display = 'none';
            hideCreateOverlay();
            updateUserBar();
            showToast(`🎉 "${id}" 아이디 생성 완료!`);
            executePendingAction();
            filterAndRender();
        } else {
            DOM.createLoading.style.display = 'none';
            DOM.createConfirm.disabled      = false;
            DOM.createCancel.disabled       = false;
            DOM.createError.textContent     = result.error || '생성 실패';
            DOM.createError.style.display   = 'block';
        }
    } catch (err) {
        console.error(err);
        DOM.createLoading.style.display = 'none';
        DOM.createConfirm.disabled      = false;
        DOM.createCancel.disabled       = false;
        DOM.createError.textContent     = '서버 연결 실패';
        DOM.createError.style.display   = 'block';
    }
}

/* ============================================
   로그인 후 대기 액션 실행
   ============================================ */
function executePendingAction() {
    const action = pendingAction;
    const song   = pendingFavSong;
    pendingAction  = null;
    pendingFavSong = null;
    if (!action) return;

    switch (action) {
        case 'fav':
            if (song) toggleFavorite(song);
            break;
        case 'viewFavorites':
            activeView = 'favorites';
            $('#viewFilters').querySelectorAll('.filter-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.value === 'favorites'));
            filterAndRender();
            break;
        case 'save':
            showSaveModal();
            break;
    }
}

/* ============================================
   로그아웃
   ============================================ */
function handleLogout() {
    if (favDirty && currentUser) {
        if (!confirm('저장하지 않은 변경사항이 있습니다.\n정말 로그아웃하시겠습니까?')) return;
    }

    currentUser   = null;
    favorites     = new Set();
    serverFavKeys = new Set();
    favDirty      = false;
    localStorage.removeItem(CONFIG.USER_KEY);
    updateUserBar();

    if (activeView === 'favorites') {
        activeView = 'all';
        $('#viewFilters').querySelectorAll('.filter-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.value === 'all'));
    }
    filterAndRender();
    showToast('👋 로그아웃되었습니다');
}

/* ============================================
   자동 로그인 (백그라운드)
   ============================================ */
async function tryAutoLogin() {
    const saved = localStorage.getItem(CONFIG.USER_KEY);
    if (!saved) return;

    try {
        const check = await apiGet('check', saved);
        if (check.success && check.exists) {
            const result = await apiGet('load', saved);
            if (result.success) {
                currentUser   = saved;
                favorites     = new Set(result.favorites.map(f => `${f.artist}::${f.title}`));
                serverFavKeys = new Set(favorites);
                favDirty      = false;
                updateUserBar();
                filterAndRender();
            }
        } else {
            localStorage.removeItem(CONFIG.USER_KEY);
        }
    } catch { /* 조용히 실패 */ }
}

/* ============================================
   즐겨찾기
   ============================================ */
function updateFavCount() {
    DOM.favCount.textContent = favorites.size;
}

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
    if (!requireLogin('fav', song)) return;

    const key    = songKey(song);
    const wasFav = favorites.has(key);
    wasFav ? favorites.delete(key) : favorites.add(key);
    favDirty = !setsEqual(favorites, serverFavKeys);

    updateFavCount();
    updateSaveBtn();
    showToast(wasFav ? `💔 "${song.title}" 해제` : `⭐ "${song.title}" 추가!`);

    if (activeView === 'favorites') {
        filterAndRender();
    } else {
        DOM.tbody.querySelectorAll(`.fav-btn[data-key="${CSS.escape(key)}"]`).forEach(b => {
            b.textContent = !wasFav ? '❤️' : '♡';
            b.classList.toggle('active', !wasFav);
        });
    }
}

/* ============================================
   저장
   ============================================ */
function showSaveModal() {
    if (!requireLogin('save')) return;
    if (!favDirty) return showToast('✅ 이미 저장되어 있습니다');
    $('#saveConfirmText').textContent = `"${currentUser}" 계정에 ${favorites.size}곡을 저장합니다`;
    DOM.saveModal.classList.add('active');
}

function closeSaveModal() {
    DOM.saveModal.classList.remove('active');
}

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
            showToast(`❌ ${result.error}`);
        }
    } catch {
        showToast('❌ 서버 연결 실패');
    }
    loadEl.style.display = 'none';
    $('#saveConfirmBtn').disabled = false;
}

/* ============================================
   테마
   ============================================ */
function loadTheme() {
    const saved  = localStorage.getItem(CONFIG.THEME_KEY);
    const prefer = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    applyTheme(saved || prefer);
}

function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    $('#themeToggle').textContent = theme === 'dark' ? '🌙' : '☀️';
    localStorage.setItem(CONFIG.THEME_KEY, theme);
}

function toggleTheme() {
    applyTheme(document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

/* ============================================
   초성 검색
   ============================================ */
const CHO     = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
const CHO_SET = new Set(CHO);

function getCho(c) {
    const n = c.charCodeAt(0);
    return (n >= 0xAC00 && n <= 0xD7A3) ? CHO[Math.floor((n - 0xAC00) / 588)] : c;
}
function isAllCho(s) { return [...s].every(c => CHO_SET.has(c)); }
function toChoStr(s) { return [...s].map(getCho).join(''); }

function matchText(text, query) {
    if (!query) return true;
    if (text.toLowerCase().includes(query.toLowerCase())) return true;
    if (isAllCho(query) && toChoStr(text).includes(query)) return true;
    return false;
}

/* ============================================
   HTML 유틸
   ============================================ */
const _escDiv = document.createElement('div');
function esc(t) { _escDiv.textContent = t; return _escDiv.innerHTML; }

function hilite(text, query) {
    if (!query) return esc(text);
    const lo = text.toLowerCase(), lq = query.toLowerCase();
    let idx = lo.indexOf(lq);

    if (idx >= 0) {
        return esc(text.substring(0, idx))
            + `<span class="highlight">${esc(text.substring(idx, idx + query.length))}</span>`
            + esc(text.substring(idx + query.length));
    }

    if (isAllCho(query)) {
        const ini = toChoStr(text);
        idx = ini.indexOf(query);
        if (idx >= 0) {
            return esc(text.substring(0, idx))
                + `<span class="highlight">${esc(text.substring(idx, idx + query.length))}</span>`
                + esc(text.substring(idx + query.length));
        }
    }
    return esc(text);
}

function parseGenres(s)      { return s ? s.split(',').map(g => g.trim()).filter(Boolean) : []; }
function extractGenres(songs) {
    const s = new Set();
    songs.forEach(song => parseGenres(song.genre).forEach(g => s.add(g)));
    return [...s].sort((a, b) => a.localeCompare(b, 'ko'));
}

// ★ NEW: 미션곡 M 뱃지 HTML 생성
function missionHtml(song) {
    return song.mission ? '<span class="mission-badge">M</span>' : '';
}

/* ============================================
   토스트
   ============================================ */
let toastTimer;
function showToast(msg) {
    DOM.toast.textContent = msg;
    DOM.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => DOM.toast.classList.remove('show'), 2500);
}

/* ============================================
   노래 데이터 로드
   ============================================ */
async function fetchSongs() {
    try {
        DOM.loading.style.display  = 'block';
        DOM.errorMsg.style.display = 'none';

        let csvText;
        const cached = sessionStorage.getItem(CONFIG.CACHE_KEY);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < CONFIG.CACHE_TTL) csvText = data;
        }

        if (!csvText) {
            const res = await fetch(SONG_CSV_URL);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            csvText = await res.text();
            try { sessionStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({ data: csvText, ts: Date.now() })); } catch {}
        }

        const parsed  = Papa.parse(csvText, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
        const headers = parsed.meta.fields || [];

        // ★ CHANGED: E=장르[0], F=성별[1], G=가수[2], H=곡명[3], I=가사[4], J=미션곡[5], K=부른횟수[6]
        allSongs = parsed.data
            .filter(row => (row['곡명'] || row[headers[3]] || '').trim())
            .map((row, i) => ({
                id:        i,
                genre:     (row['장르']     || row[headers[0]] || '').trim(),
                gender:    (row['성별']     || row[headers[1]] || '').trim(),
                artist:    (row['가수']     || row[headers[2]] || '').trim(),
                title:     (row['곡명']     || row[headers[3]] || '').trim(),
                lyrics:    (row['가사']     || row[headers[4]] || '').trim(),
                mission:   (row['미션곡']   || row[headers[5]] || '').trim().toUpperCase() === 'TRUE',  // ★ NEW: J열
                sungCount: parseInt(row['부른횟수'] || row[headers[6]] || '0', 10) || 0,                // ★ CHANGED: K열
            }));

        buildGenreFilters();
        updateFavCount();
        DOM.loading.style.display = 'none';
        DOM.wrapper.style.display = 'block';
        filterAndRender();
    } catch (err) {
        console.error(err);
        DOM.loading.style.display  = 'none';
        DOM.errorMsg.style.display = 'block';
    }
}

/* ============================================
   장르 필터 동적 생성
   ============================================ */
function buildGenreFilters() {
    const wrap = $('#genreFilters');
    const frag = document.createDocumentFragment();

    extractGenres(allSongs).forEach(genre => {
        const btn = document.createElement('button');
        btn.className     = 'filter-btn';
        btn.dataset.value = genre;
        btn.textContent   = genre;
        frag.appendChild(btn);
    });

    wrap.appendChild(frag);
    wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        wrap.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeGenre = btn.dataset.value;
        filterAndRender();
    });
}

/* ============================================
   정렬
   ============================================ */
function sortSongs(songs) {
    if (!sortCol) return songs;
    return [...songs].sort((a, b) => {
        const cmp = (a[sortCol] || '').localeCompare(b[sortCol] || '', 'ko');
        return sortDir === 'desc' ? -cmp : cmp;
    });
}

function handleSort(col) {
    if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : (sortCol = null, 'asc');
    } else {
        sortCol = col;
        sortDir = 'asc';
    }
    updateSortUI();
    filterAndRender();
}

function updateSortUI() {
    $$('th.sortable').forEach(th => {
        const isActive = th.dataset.sort === sortCol;
        th.classList.toggle('sort-active', isActive);
        th.querySelector('.sort-arrow').textContent = isActive
            ? (sortDir === 'asc' ? '▲' : '▼')
            : '⇅';
    });
}

/* ============================================
   필터 + 렌더
   ============================================ */
function filterAndRender() {
    const q = searchQuery;

    filteredSongs = allSongs.filter(song => {
        if (activeView === 'favorites' && !favorites.has(songKey(song))) return false;
        if (activeGender !== '전체' && song.gender !== activeGender)     return false;
        if (activeGenre !== '전체' && !parseGenres(song.genre).includes(activeGenre)) return false;
        if (q) {
            const t = matchText(song.title, q);
            const a = matchText(song.artist, q);
            const l = searchLyrics && song.lyrics.toLowerCase().includes(q.toLowerCase());
            if (!t && !a && !l) return false;
        }
        return true;
    });

    filteredSongs = sortSongs(filteredSongs);
    DOM.totalCount.textContent    = allSongs.length;
    DOM.filteredCount.textContent = filteredSongs.length;
    displayedCount = 0;
    DOM.tbody.innerHTML = '';
    renderMore();
}

/* ============================================
   렌더링 (페이지네이션)
   ★ 곡명 옆에 미션곡 M 뱃지 표시
   ============================================ */
function renderMore() {
    if (isRendering) return;
    if (displayedCount >= filteredSongs.length) { DOM.loadingMore.style.display = 'none'; return; }

    isRendering = true;
    DOM.loadingMore.style.display = filteredSongs.length > CONFIG.PER_PAGE ? 'block' : 'none';

    requestAnimationFrame(() => {
        if (!filteredSongs.length) {
            DOM.noResult.style.display    = 'block';
            DOM.loadingMore.style.display = 'none';
            isRendering = false;
            return;
        }
        DOM.noResult.style.display = 'none';

        const end  = Math.min(displayedCount + CONFIG.PER_PAGE, filteredSongs.length);
        const frag = document.createDocumentFragment();

        for (let i = displayedCount; i < end; i++) {
            const song   = filteredSongs[i];
            const key    = songKey(song);
            const isFav  = favorites.has(key);
            const hasLyr = song.lyrics.length > 0;

            const tr = document.createElement('tr');

            const genreBadges = parseGenres(song.genre)
                .map(g => `<span class="badge badge-genre">${esc(g)}</span>`)
                .join('');

            const gCls  = song.gender === '여' ? 'badge-female' : 'badge-male';
            const gIcon = song.gender === '여' ? '👩' : '👨';

            tr.innerHTML =
                `<td>${i + 1}</td>` +
                `<td>` +
                    `<button class="fav-btn${isFav ? ' active' : ''}" ` +
                        `data-key="${esc(key)}" data-idx="${i}">` +
                        `${isFav ? '❤️' : '♡'}` +
                    `</button>` +
                `</td>` +
                `<td class="song-artist">${hilite(song.artist, searchQuery)}</td>` +

                // ★ CHANGED: 곡명 + 미션곡 M 뱃지
                `<td class="song-title">${hilite(song.title, searchQuery)}${missionHtml(song)}</td>` +

                `<td>` +
                    `<button class="lyrics-btn ${hasLyr ? 'has-lyrics' : 'no-lyrics'}" ` +
                        `data-idx="${i}" title="${hasLyr ? '가사 보기' : '가사 없음'}">📜</button>` +
                `</td>` +
                `<td>${genreBadges}</td>` +
                `<td><span class="badge ${gCls}">${gIcon} ${esc(song.gender)}</span></td>`;

            frag.appendChild(tr);
        }

        DOM.tbody.appendChild(frag);
        displayedCount = end;
        DOM.loadingMore.style.display = 'none';
        isRendering = false;
    });
}

/* ============================================
   무한 스크롤 + 스크롤 맨위
   ============================================ */
function initScrollObserver() {
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && displayedCount < filteredSongs.length && !isRendering) renderMore();
    }, { rootMargin: '400px' }).observe(DOM.sentinel);
}

function initScrollTop() {
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                DOM.scrollTopBtn.classList.toggle('visible', window.scrollY > 600);
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });
    DOM.scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ============================================
   가사 모달 (★ CHANGED: M 뱃지 표시)
   ============================================ */
function openLyricsModal(song) {
    // ★ CHANGED: innerHTML로 M 뱃지 포함
    $('#modalTitle').innerHTML   = esc(song.title) + missionHtml(song);
    $('#modalArtist').textContent = song.artist;
    $('#modalGenre').textContent  = song.genre;

    const gt = $('#modalGender');
    gt.textContent = (song.gender === '여' ? '👩 ' : '👨 ') + song.gender;
    gt.className   = `mtag ${song.gender === '여' ? 'gender-tag' : 'gender-tag-m'}`;

    const lyrics = song.lyrics.replace(/^[""\u201C\u201D]|[""\u201C\u201D]$/g, '').trim();
    $('#modalLyrics').textContent = lyrics || '가사 정보가 없습니다.';

    DOM.lyricsModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLyricsModal() {
    DOM.lyricsModal.classList.remove('active');
    document.body.style.overflow = '';
}

/* ============================================
   가중치 랜덤 선택
   ============================================ */
function weightedRandomPick(pool) {
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];

    const EXPONENT = 0.3;

    const weights = pool.map(song =>
        1 / Math.pow((song.sungCount || 0) + 1, EXPONENT)
    );

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let r = Math.random() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
}

/* ============================================
   랜덤 추천 (★ CHANGED: M 뱃지 표시)
   ============================================ */
function pickRandom() {
    const pool = filteredSongs.length ? filteredSongs : allSongs;
    if (!pool.length) return showToast('🎵 곡이 없습니다!');

    const icon = $('#randomIcon');
    icon.classList.remove('spinning');
    void icon.offsetWidth;
    icon.classList.add('spinning');

    const song = weightedRandomPick(pool);
    currentRandomSong = song;

    // ★ CHANGED: innerHTML로 M 뱃지 포함
    $('#randomTitle').innerHTML   = esc(song.title) + missionHtml(song);
    $('#randomArtist').textContent = song.artist;
    $('#randomGenre').textContent  = song.genre;

    const gt = $('#randomGender');
    gt.textContent = (song.gender === '여' ? '👩 ' : '👨 ') + song.gender;
    gt.className   = `mtag ${song.gender === '여' ? 'gender-tag' : 'gender-tag-m'}`;

    $('#randomFavBtn').textContent = favorites.has(songKey(song)) ? '💛 해제' : '⭐ 즐겨찾기';

    const lb  = $('#randomLyricsBtn');
    const has = !!song.lyrics.trim();
    lb.disabled     = !has;
    lb.style.opacity = has ? 1 : 0.4;

    DOM.randomModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeRandomModal() {
    DOM.randomModal.classList.remove('active');
    document.body.style.overflow = '';
}

/* ============================================
   유틸
   ============================================ */
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ============================================
   초기화
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    loadTheme();
    updateSortUI();
    initScrollObserver();
    initScrollTop();
    updateUserBar();

    fetchSongs();
    tryAutoLogin();

    $('#themeToggle').addEventListener('click', toggleTheme);

    DOM.loginOpenBtn.addEventListener('click', () => showLoginOverlay());
    DOM.loginBtn.addEventListener('click', handleLogin);
    DOM.userIdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    $('#loginCloseBtn').addEventListener('click', hideLoginOverlay);
    $('#loginOverlayBg').addEventListener('click', hideLoginOverlay);

    DOM.createConfirm.addEventListener('click', handleCreateConfirm);
    DOM.createCancel.addEventListener('click', () => { hideCreateOverlay(); showLoginOverlay(); });
    $('#createCloseBtn').addEventListener('click', hideCreateOverlay);
    $('#createOverlayBg').addEventListener('click', hideCreateOverlay);

    DOM.logoutBtn.addEventListener('click', handleLogout);
    DOM.saveFavBtn.addEventListener('click', () => showSaveModal());
    $('#saveConfirmBtn').addEventListener('click', handleSave);
    $('#saveCancelBtn').addEventListener('click', closeSaveModal);
    $('.save-modal-overlay').addEventListener('click', closeSaveModal);

    DOM.searchInput.addEventListener('input', debounce((e) => {
        searchQuery = e.target.value.trim();
        filterAndRender();
    }, 200));
    $('#lyricsSearchToggle').addEventListener('change', (e) => {
        searchLyrics = e.target.checked;
        if (searchQuery) filterAndRender();
    });

    $('#viewFilters').addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        const value = btn.dataset.value;
        if (value === 'favorites' && !currentUser) { requireLogin('viewFavorites'); return; }
        $('#viewFilters').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeView = value;
        filterAndRender();
    });

    $('#genderFilters').addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        $('#genderFilters').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeGender = btn.dataset.value;
        filterAndRender();
    });

    $$('th.sortable').forEach(th => th.addEventListener('click', () => handleSort(th.dataset.sort)));

    DOM.tbody.addEventListener('click', (e) => {
        const lBtn = e.target.closest('.lyrics-btn.has-lyrics');
        if (lBtn) return openLyricsModal(filteredSongs[+lBtn.dataset.idx]);
        const fBtn = e.target.closest('.fav-btn');
        if (fBtn) return toggleFavorite(filteredSongs[+fBtn.dataset.idx]);
    });

    $('#modalClose').addEventListener('click', closeLyricsModal);
    $('.lyrics-modal-overlay').addEventListener('click', closeLyricsModal);

    $('#randomBtn').addEventListener('click', pickRandom);
    $('#randomClose').addEventListener('click', closeRandomModal);
    $('.random-modal-overlay').addEventListener('click', closeRandomModal);
    $('#randomAgainBtn').addEventListener('click', pickRandom);
    $('#randomLyricsBtn').addEventListener('click', () => {
        if (currentRandomSong?.lyrics.trim()) {
            closeRandomModal();
            setTimeout(() => openLyricsModal(currentRandomSong), 250);
        }
    });
    $('#randomFavBtn').addEventListener('click', () => {
        if (!currentRandomSong) return;
        toggleFavorite(currentRandomSong);
        if (currentUser) {
            $('#randomFavBtn').textContent = favorites.has(songKey(currentRandomSong)) ? '💛 해제' : '⭐ 즐겨찾기';
        }
    });

    $('#retryBtn').addEventListener('click', () => { sessionStorage.removeItem(CONFIG.CACHE_KEY); fetchSongs(); });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeLyricsModal(); closeRandomModal(); closeSaveModal(); hideLoginOverlay(); hideCreateOverlay(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); DOM.searchInput.focus(); DOM.searchInput.select(); }
    });

    window.addEventListener('beforeunload', (e) => {
        if (favDirty && currentUser) { e.preventDefault(); e.returnValue = ''; }
    });
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
