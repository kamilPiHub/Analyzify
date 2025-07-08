document.addEventListener('DOMContentLoaded', initializeApp);

const appContainer = document.getElementById('app');


let accessToken = null;
let tokenExpiresAt = null;
let isRefreshingToken = false;

async function fetchWithAuth(url, options = {}) {
    if (accessToken && tokenExpiresAt && Date.now() >= tokenExpiresAt) {
        console.log('Access token expired, refreshing...');
        try {
            await refreshToken();
        } catch (error) {
            console.error('Failed to refresh token, logging out.', error);
            handleLogout();
            throw new Error('Session expired. Please log in again.');
        }
    }

    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        console.log('Received 401, attempting to refresh token...');
        try {
            await refreshToken();
            const newHeaders = { ...headers, 'Authorization': `Bearer ${accessToken}` };
            response = await fetch(url, { ...options, headers: newHeaders });
        } catch (error) {
            console.error('Failed to refresh token after 401, logging out.', error);
            handleLogout();
            throw new Error('Session expired. Please log in again.');
        }
    }
    return response;
}


async function refreshToken() {
    if (isRefreshingToken) {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (!isRefreshingToken) {
                    clearInterval(checkInterval);
                    if (accessToken) resolve();
                    else reject();
                }
            }, 100);
        });
    }

    isRefreshingToken = true;
    try {
        const response = await fetch('/api/refresh-token', { method: 'POST' });
        if (!response.ok) {
            throw new Error('Could not refresh token');
        }
        const data = await response.json();
        accessToken = data.access_token;
        tokenExpiresAt = Date.now() + 55 * 60 * 1000;
        console.log('Token refreshed successfully.');
    } finally {
        isRefreshingToken = false;
    }
}


async function initializeApp() {
    try {
        await refreshToken();
        showLoader();
        await fetchAllDashboardData();
    } catch (error) {
        console.log('Initialization failed, rendering login view.', error);
        renderLoginView();
    }
}

function showLoader() {
    appContainer.innerHTML = `
        <div class="loader-container">
            <div class="loader-spinner"></div>
            <div class="loader-text">Loading Spotify data...</div>
        </div>
    `;
}

function renderLoginView() {
    document.body.classList.add('login-view-active');
    accessToken = null;
    tokenExpiresAt = null;
    appContainer.innerHTML = `
        <div class="login-container">
            <h2>Welcome to Analyzify!</h2>
            <p>See your Spotify summary</p>
            <a href="/login">
                <button>
                    <img src="/static/img/logo_spotify.png" alt="Spotify Logo" class="spotify-icon">
                    <span>Log in with Spotify</span>
                </button>
            </a>
        </div>
    `;
}

let dashboardCache = {
    short_term: null,
    medium_term: null,
    long_term: null
};

async function fetchAllDashboardData() {
    try {
        const [shortRes, mediumRes, longRes] = await Promise.all([
            fetchWithAuth('/api/dashboard-data?time_range=short_term'),
            fetchWithAuth('/api/dashboard-data?time_range=medium_term'),
            fetchWithAuth('/api/dashboard-data?time_range=long_term')
        ]);
        if (!shortRes.ok || !mediumRes.ok || !longRes.ok) {
            throw new Error('Authorization error');
        }
        dashboardCache.short_term = await shortRes.json();
        dashboardCache.medium_term = await mediumRes.json();
        dashboardCache.long_term = await longRes.json();
        renderDashboardView(dashboardCache.long_term, 'long_term');
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        handleLogout();
    }
}

async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
        console.error("Error during server logout:", e);
    } finally {
        accessToken = null;
        tokenExpiresAt = null;
        dashboardCache = { short_term: null, medium_term: null, long_term: null };
        renderLoginView();
    }
}

function renderDashboardView(data, currentRange = 'long_term', activeTab = null) {
    document.body.classList.remove('login-view-active');
    let tab = activeTab;
    if (!tab) {
        const tracksBtn = document.getElementById('btn-tracks');
        if (tracksBtn && tracksBtn.classList.contains('active')) {
            tab = 'tracks';
        } else {
            const artistsBtn = document.getElementById('btn-artists');
            if (artistsBtn && artistsBtn.classList.contains('active')) {
                tab = 'artists';
            }
        }
    }
    appContainer.innerHTML = getDashboardHTML(data, currentRange);
    setupDashboardButtons(currentRange, tab);
}

function getDashboardHTML(data, currentRange) {
    const logoutIcon = `<img src="/static/img/log_out.png" alt="Log Out" class="logout-icon-img">`;
    const userName = data.user && data.user.display_name ? data.user.display_name : 'User';
    return `
        <nav id="navbar">
            <div class="navbar-content">
                <div class="navbar-left">
                    <img src="/static/img/logo_spotify.png" alt="Spotify" class="navbar-spotify-icon">
                    <span class="user-name">${userName}</span>
                </div>
                <div class="navbar-right">
                    <button id="logout-btn" title="LOG OUT">${logoutIcon}</button>
                </div>
            </div>
        </nav>
        <div class="dashboard-container">
            <div class="dashboard-bar">
                <div class="dashboard-bar-left">
                    <div class="tabs-nav">
                        <a href="#" id="btn-tracks" class="tab-btn active">TOP TRACKS</a>
                        <a href="#" id="btn-artists" class="tab-btn">TOP ARTISTS</a>
                    </div>
                </div>
                <div class="dashboard-bar-right">
                    <div class="range-buttons">
                        <a href="#" id="btn-short-term" class="range-btn${currentRange==='short_term' ? ' active' : ''}">4 weeks</a>
                        <a href="#" id="btn-medium-term" class="range-btn${currentRange==='medium_term' ? ' active' : ''}">6 months</a>
                        <a href="#" id="btn-long-term" class="range-btn${currentRange==='long_term' ? ' active' : ''}">All time</a>
                    </div>
                </div>
            </div>
            <div id="tracks-container" class="tab-content">
                <ul class="item-list">
                    <li class="item-list-header">
                        <div class="col-track">TRACK</div>
                        <div class="col-artist">ARTIST</div>
                        <div class="col-link">LINK</div>
                    </li>
                    ${data.top_tracks.map(track => `
                        <li class="item-list-row">
                            <div class="col-track">${track.name}</div>
                            <div class="col-artist">${track.artist}</div>
                            <div class="col-link">
                                <a href="${track.url}" target="_blank" rel="noopener noreferrer">See</a>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>

            <div id="artists-container" class="tab-content" style="display:none;">
                 <ul class="item-list">
                    <li class="item-list-header">
                        <div class="col-track">ARTIST</div>
                        <div class="col-artist"></div> <div class="col-link">LINK</div>
                    </li>
                    ${data.top_artists.map(artist => `
                        <li class="item-list-row">
                             <div class="col-track">${artist.name}</div>
                             <div class="col-artist"></div>
                             <div class="col-link">
                                <a href="${artist.url}" target="_blank" rel="noopener noreferrer">See</a>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        </div>
    `;
}

function setupDashboardButtons(currentRange, activeTab = null) {
    const btnTracks = document.getElementById('btn-tracks');
    const btnArtists = document.getElementById('btn-artists');
    const tracksContainer = document.getElementById('tracks-container');
    const artistsContainer = document.getElementById('artists-container');
    const logoutBtn = document.getElementById('logout-btn');
    const btnShort = document.getElementById('btn-short-term');
    const btnMedium = document.getElementById('btn-medium-term');
    const btnLong = document.getElementById('btn-long-term');

    function setTab(tab) {
        if (tab === 'artists') {
            tracksContainer.style.display = 'none';
            artistsContainer.style.display = 'block';
            btnArtists.classList.add('active');
            btnTracks.classList.remove('active');
        } else {
            tracksContainer.style.display = 'block';
            artistsContainer.style.display = 'none';
            btnTracks.classList.add('active');
            btnArtists.classList.remove('active');
        }
    }

    setTab(activeTab);

    btnTracks.addEventListener('click', (e) => { e.preventDefault(); setTab('tracks'); });
    btnArtists.addEventListener('click', (e) => { e.preventDefault(); setTab('artists'); });

    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogout();
    });

    btnShort.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentRange !== 'short_term') {
            let tab = btnArtists.classList.contains('active') ? 'artists' : 'tracks';
            renderDashboardView(dashboardCache.short_term, 'short_term', tab);
        }
    });
    btnMedium.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentRange !== 'medium_term') {
            let tab = btnArtists.classList.contains('active') ? 'artists' : 'tracks';
            renderDashboardView(dashboardCache.medium_term, 'medium_term', tab);
        }
    });
    btnLong.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentRange !== 'long_term') {
            let tab = btnArtists.classList.contains('active') ? 'artists' : 'tracks';
            renderDashboardView(dashboardCache.long_term, 'long_term', tab);
        }
    });
}