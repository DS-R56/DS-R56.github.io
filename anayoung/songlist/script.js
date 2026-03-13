/* ╔═══════════════════════════════════════════════════════════╗
   ║  ⚙️  스프레드시트 설정                                     ║
   ╚═══════════════════════════════════════════════════════════╝ */
const CONFIG = Object.freeze({
    SPREADSHEET_ID : '1sAsXEl14Vr4k1hlAhdHD5JpIjWu4eFQgwo2KP9nP8oU',
    SHEET_NAME     : '데이터베이스',
    RANGE          : 'E:I',
    PER_PAGE       : 80,
    CACHE_KEY      : 'songlist_cache',
    CACHE_TTL      : 5 * 60 * 1000,   // 5분 캐시
    FAV_KEY        : 'songlist_favorites',
    THEME_KEY      : 'songlist_theme',
});

const CSV_URL =
    `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}`
    + `/gviz/tq?tqx=out:csv`
    + `&sheet=${encodeURIComponent(CONFIG.SHEET_NAME)}`
    + `&range=${CONFIG.RANGE}`;

/* ══════════════════════════════════════
   전역 상태
   ══════════════════════════════════════ */
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
let isRendering  = false;

/* ── DOM 캐시 (한 번만 쿼리) ── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let DOM = {};

function cacheDom() {
    DOM = {
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
        toast:         $('#toast'),
        scrollTopBtn:  $('#scrollTopBtn'),
    };
}

/* ══════════════════════════════════════
   즐겨찾기 (localStorage)
   ══════════════════════════════════════ */
function loadFav() {
    try { return new Set(JSON.parse(localStorage.getItem(CONFIG.FAV_KEY)) || []); }
    catch { return new Set(); }
}
function saveFav(s) { localStorage.setItem(CONFIG.FAV_KEY, JSON.stringify([...s])); }

let favorites = loadFav();
const songKey = (s) => `${s.artist}::${s.title}`;

function updateFavCount() {
    DOM.favCount.textContent = favorites.size;
}

function toggleFavorite(song) {
    const key = songKey(song);
    const wasFav = favorites.has(key);
    wasFav ? favorites.delete(key) : favorites.add(key);
    saveFav(favorites);
    updateFavCount();
    showToast(wasFav ? `💔 "${song.title}" 해제` : `⭐ "${song.title}" 추가!`);
    if (activeView === 'favorites') filterAndRender();
    else updateFavBtnUI(key, !wasFav);
}

function updateFavBtnUI(key, isFav) {
    const btns = DOM.tbody.querySelectorAll(`.fav-btn[data-key="${CSS.escape(key)}"]`);
    btns.forEach(b => { b.textContent = isFav ? '❤️' : '🤍'; b.classList.toggle('active', isFav); });
}

/* ══════════════════════════════════════
   테마 (localStorage)
   ══════════════════════════════════════ */
function loadTheme() {
    const saved = localStorage.getItem(CONFIG.THEME_KEY);
    // 시스템 설정 따르기 (저장값 없을 때)
    const prefer = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    applyTheme(saved || prefer);
}

function applyTheme(t) {
    document.body.setAttribute('data-theme', t);
    $('#themeToggle').textContent = t === 'dark' ? '🌙' : '☀️';
    document.querySelector('meta[name="theme-color"][media*="dark"]')
        ?.setAttribute('content', t === 'dark' ? '#0f0c29' : '#f0f2f5');
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

function getCho(c) {
    const n = c.charCodeAt(0);
    return (n >= 0xAC00 && n <= 0xD7A3) ? CHO[(n - 0xAC00) / 588 | 0] : c;
}

function isAllCho(s) { return [...s].every(c => CHO_SET.has(c)); }
function toChoStr(s) { return [...s].map(getCho).join(''); }

function matchText(text, q) {
    if (!q) return true;
    if (text.toLowerCase().includes(q.toLowerCase())) return true;
    if (isAllCho(q) && toChoStr(text).includes(q)) return true;
    return false;
}

/* ══════════════════════════════════════
   HTML 유틸
   ══════════════════════════════════════ */
const _div = document.createElement('div');
function esc(t) { _div.textContent = t; return _div.innerHTML; }

function hilite(text, q) {
    if (!q) return esc(text);
    const lo = text.toLowerCase(), lq = q.toLowerCase();
    let idx = lo.indexOf(lq);
    if (idx >= 0) {
        return esc(text.substring(0, idx))
            + `<span class="highlight">${esc(text.substring(idx, idx + q.length))}</span>`
            + esc(text.substring(idx + q.length));
    }
    if (isAllCho(q)) {
        const ini = toChoStr(text);
        idx = ini.indexOf(q);
        if (idx >= 0) {
            return esc(text.substring(0, idx))
                + `<span class="highlight">${esc(text.substring(idx, idx + q.length))}</span>`
                + esc(text.substring(idx + q.length));
        }
    }
    return esc(text);
}

/* ══════════════════════════════════════
   장르 유틸
   ══════════════════════════════════════ */
function parseGenres(s) { return s ? s.split(',').map(g => g.trim()).filter(Boolean) : []; }

function extractGenres(songs) {
    const s = new Set();
    songs.forEach(song => parseGenres(song.genre).forEach(g => s.add(g)));
    return [...s].sort((a, b) => a.localeCompare(b, 'ko'));
}

/* ══════════════════════════════════════
   토스트
   ══════════════════════════════════════ */
let _toastT;
function showToast(msg) {
    DOM.toast.textContent = msg;
    DOM.toast.classList.add('show');
    clearTimeout(_toastT);
    _toastT = setTimeout(() => DOM.toast.classList.remove('show'), 2200);
}

/* ══════════════════════════════════════
   데이터 로드 + sessionStorage 캐시
   ══════════════════════════════════════ */
async function fetchSongs() {
    try {
        DOM.loading.style.display = 'block';
        DOM.errorMsg.style.display = 'none';

        let csvText;

        // sessionStorage 캐시 확인
        const cached = sessionStorage.getItem(CONFIG.CACHE_KEY);
        if (cached) {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < CONFIG.CACHE_TTL) {
                csvText = data;
                console.log('📦 캐시에서 로드');
            }
        }

        // 캐시 없으면 네트워크 요청
        if (!csvText) {
            const res = await fetch(CSV_URL);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            csvText = await res.text();
            try {
                sessionStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({
                    data: csvText,
                    ts: Date.now(),
                }));
            } catch { /* quota exceeded */ }
            console.log('🌐 네트워크에서 로드');
        }

        const parsed = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            transformHeader: h => h.trim(),
        });

        const headers = parsed.meta.fields || [];

        allSongs = parsed.data
            .filter(r => (r['곡명'] || r[headers[3]] || '').trim())
            .map((r, i) => ({
                id:     i,
                genre:  (r['장르']  || r[headers[0]] || '').trim(),
                gender: (r['성별']  || r[headers[1]] || '').trim(),
                artist: (r['가수']  || r[headers[2]] || '').trim(),
                title:  (r['곡명']  || r[headers[3]] || '').trim(),
                lyrics: (r['가사']  || r[headers[4]] || '').trim(),
            }));

        console.log(`✅ ${allSongs.length}곡 로드`);

        buildGenreFilters();
        updateFavCount();

        DOM.loading.style.display = 'none';
        DOM.wrapper.style.display = 'block';
        filterAndRender();

    } catch (err) {
        console.error('❌', err);
        DOM.loading.style.display = 'none';
        DOM.errorMsg.style.display = 'block';
    }
}

/* ══════════════════════════════════════
   장르 필터 동적 생성
   ══════════════════════════════════════ */
function buildGenreFilters() {
    const wrap = $('#genreFilters');
    const frag = document.createDocumentFragment();
    extractGenres(allSongs).forEach(g => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.value = g;
        btn.textContent = g;
        frag.appendChild(btn);
    });
    wrap.appendChild(frag);

    wrap.addEventListener('click', e => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        wrap.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeGenre = btn.dataset.value;
        filterAndRender();
    });
}

/* ══════════════════════════════════════
   정렬
   ══════════════════════════════════════ */
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

/* ══════════════════════════════════════
   필터 + 렌더
   ══════════════════════════════════════ */
function filterAndRender() {
    const q = searchQuery;

    filteredSongs = allSongs.filter(song => {
        if (activeView === 'favorites' && !favorites.has(songKey(song))) return false;
        if (activeGender !== '전체' && song.gender !== activeGender) return false;
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

    DOM.totalCount.textContent = allSongs.length;
    DOM.filteredCount.textContent = filteredSongs.length;

    displayedCount = 0;
    DOM.tbody.innerHTML = '';
    renderMore();
}

/* ══════════════════════════════════════
   렌더링 (requestAnimationFrame)
   ══════════════════════════════════════ */
function renderMore() {
    if (isRendering) return;
    if (displayedCount >= filteredSongs.length) {
        DOM.loadingMore.style.display = 'none';
        return;
    }

    isRendering = true;
    DOM.loadingMore.style.display = filteredSongs.length > CONFIG.PER_PAGE ? 'block' : 'none';

    requestAnimationFrame(() => {
        if (filteredSongs.length === 0) {
            DOM.noResult.style.display = 'block';
            DOM.loadingMore.style.display = 'none';
            isRendering = false;
            return;
        }
        DOM.noResult.style.display = 'none';

        const end  = Math.min(displayedCount + CONFIG.PER_PAGE, filteredSongs.length);
        const frag = document.createDocumentFragment();

        for (let i = displayedCount; i < end; i++) {
            const s       = filteredSongs[i];
            const key     = songKey(s);
            const isFav   = favorites.has(key);
            const hasLyr  = s.lyrics.length > 0;

            const tr = document.createElement('tr');

            const genreHTML = parseGenres(s.genre)
                .map(g => `<span class="badge badge-genre">${esc(g)}</span>`).join('');

            const gCls  = s.gender === '여' ? 'badge-female' : 'badge-male';
            const gIcon = s.gender === '여' ? '👩' : '👨';

            tr.innerHTML =
                `<td>${i+1}</td>`
              + `<td><button class="fav-btn${isFav?' active':''}" `
              +     `data-key="${esc(key)}" data-idx="${i}">`
              +     `${isFav?'❤️':'🤍'}</button></td>`
              + `<td><div class="title-cell">`
              +     `<span class="song-title">${hilite(s.title,searchQuery)}</span>`
              +     `<button class="lyrics-btn ${hasLyr?'has-lyrics':'no-lyrics'}" `
              +         `data-idx="${i}" title="${hasLyr?'가사 보기':'가사 없음'}">📜</button>`
              + `</div></td>`
              + `<td class="song-artist">${hilite(s.artist,searchQuery)}</td>`
              + `<td>${genreHTML}</td>`
              + `<td><span class="badge ${gCls}">${gIcon} ${esc(s.gender)}</span></td>`;

            frag.appendChild(tr);
        }

        DOM.tbody.appendChild(frag);
        displayedCount = end;
        DOM.loadingMore.style.display = 'none';
        isRendering = false;
    });
}

/* ══════════════════════════════════════
   무한 스크롤 (IntersectionObserver)
   ══════════════════════════════════════ */
let scrollObserver;

function initScrollObserver() {
    if (!('IntersectionObserver' in window)) return;

    scrollObserver = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && displayedCount < filteredSongs.length && !isRendering) {
            renderMore();
        }
    }, {
        rootMargin: '400px',   // 400px 전에 미리 로드
        threshold: 0,
    });

    scrollObserver.observe(DOM.sentinel);
}

/* ══════════════════════════════════════
   스크롤 맨위 버튼
   ══════════════════════════════════════ */
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

    DOM.scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

/* ══════════════════════════════════════
   가사 모달
   ══════════════════════════════════════ */
function openLyricsModal(song) {
    $('#modalTitle').textContent  = song.title;
    $('#modalArtist').textContent = song.artist;
    $('#modalGenre').textContent  = song.genre;

    const gt = $('#modalGender');
    gt.textContent = (song.gender === '여' ? '👩 ' : '👨 ') + song.gender;
    gt.className = `mtag ${song.gender === '여' ? 'gender-tag' : 'gender-tag-m'}`;

    const lyrics = song.lyrics.replace(/^[""\u201C\u201D]|[""\u201C\u201D]$/g, '').trim();
    $('#modalLyrics').textContent = lyrics || '가사 정보가 없습니다.';

    DOM.lyricsModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLyricsModal() {
    DOM.lyricsModal.classList.remove('active');
    document.body.style.overflow = '';
}

/* ══════════════════════════════════════
   랜덤 추천
   ══════════════════════════════════════ */
function pickRandom() {
    const pool = filteredSongs.length ? filteredSongs : allSongs;
    if (!pool.length) return showToast('🎵 추천할 곡이 없습니다!');

    const icon = $('#randomIcon');
    icon.classList.remove('spinning');
    void icon.offsetWidth;
    icon.classList.add('spinning');

    const song = pool[Math.random() * pool.length | 0];
    currentRandomSong = song;

    $('#randomTitle').textContent  = song.title;
    $('#randomArtist').textContent = song.artist;
    $('#randomGenre').textContent  = song.genre;

    const gt = $('#randomGender');
    gt.textContent = (song.gender === '여' ? '👩 ' : '👨 ') + song.gender;
    gt.className = `mtag ${song.gender === '여' ? 'gender-tag' : 'gender-tag-m'}`;

    const isFav = favorites.has(songKey(song));
    $('#randomFavBtn').textContent = isFav ? '💛 해제' : '⭐ 즐겨찾기';

    const lBtn = $('#randomLyricsBtn');
    const hasL = !!song.lyrics.trim();
    lBtn.disabled = !hasL;
    lBtn.style.opacity = hasL ? 1 : .4;

    DOM.randomModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeRandomModal() {
    DOM.randomModal.classList.remove('active');
    document.body.style.overflow = '';
}

/* ══════════════════════════════════════
   유틸
   ══════════════════════════════════════ */
function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function bindFilterGroup(id, callback) {
    $(id).addEventListener('click', e => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        $(id).querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        callback(btn.dataset.value);
    });
}

/* ══════════════════════════════════════
   초기화
   ══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    loadTheme();
    updateSortUI();
    initScrollObserver();
    initScrollTop();

    // 데이터 로드
    fetchSongs();

    // ── 테마 ──
    $('#themeToggle').addEventListener('click', toggleTheme);

    // ── 검색 ──
    DOM.searchInput.addEventListener('input', debounce(e => {
        searchQuery = e.target.value.trim();
        filterAndRender();
    }, 200));

    // ── 가사 포함 검색 ──
    $('#lyricsSearchToggle').addEventListener('change', e => {
        searchLyrics = e.target.checked;
        if (searchQuery) filterAndRender();
    });

    // ── 필터 그룹 ──
    bindFilterGroup('#viewFilters', v => { activeView = v; filterAndRender(); });
    bindFilterGroup('#genderFilters', v => { activeGender = v; filterAndRender(); });

    // ── 정렬 ──
    $$('th.sortable').forEach(th =>
        th.addEventListener('click', () => handleSort(th.dataset.sort))
    );

    // ── 테이블 클릭 위임 ──
    DOM.tbody.addEventListener('click', e => {
        const lBtn = e.target.closest('.lyrics-btn.has-lyrics');
        if (lBtn) return openLyricsModal(filteredSongs[+lBtn.dataset.idx]);

        const fBtn = e.target.closest('.fav-btn');
        if (fBtn) return toggleFavorite(filteredSongs[+fBtn.dataset.idx]);
    });

    // ── 가사 모달 닫기 ──
    $('#modalClose').addEventListener('click', closeLyricsModal);
    $('#lyricsModal .modal-overlay').addEventListener('click', closeLyricsModal);

    // ── 랜덤 ──
    $('#randomBtn').addEventListener('click', pickRandom);
    $('#randomClose').addEventListener('click', closeRandomModal);
    $('.random-overlay').addEventListener('click', closeRandomModal);
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
        const isFav = favorites.has(songKey(currentRandomSong));
        $('#randomFavBtn').textContent = isFav ? '💛 해제' : '⭐ 즐겨찾기';
    });

    // ── 재시도 ──
    $('#retryBtn').addEventListener('click', () => {
        sessionStorage.removeItem(CONFIG.CACHE_KEY);
        fetchSongs();
    });

    // ── ESC ──
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeLyricsModal(); closeRandomModal(); }
    });

    // ── 키보드 검색 단축키 (Ctrl+K / Cmd+K) ──
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            DOM.searchInput.focus();
            DOM.searchInput.select();
        }
    });
});

/* ══════════════════════════════════════
   Service Worker 등록
   ══════════════════════════════════════ */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}
