// ================= GLOBAL VARIABLES =================
window.allTripsData = []; 
window.currentSlipHistory = [];
window.currentVehicleTrips = [];
window._followupGroups = {};
window.transport_name = localStorage.getItem('ktc_name') || "Transport Company";
window.authPass = localStorage.getItem('ktc_pass') || "";

// ⚠️ APNA APPS SCRIPT EXEC URL YAHAN DALEIN
const scriptURL = 'https://script.google.com/macros/s/AKfycbwmWgPL-HGldLbJE-1obiL6QD_EilUM8pIe3rTl3TXXQBII-R8wVHarMUAnG2a0J7SJ/exec';

function apiUrl(query) {
    const q = query || '';
    const sep = q.includes('?') ? '&' : '?';
    const pass = window.authPass || localStorage.getItem('ktc_pass') || "1234";
    return scriptURL + q + sep + 'pass=' + encodeURIComponent(pass);
}

const COMPANY_NAME = "KUNAL TRANSPORT COMPANY";
const COMPANY_ADDRESS = "Lasur Station, Vaijapur Highway, Tq. Gangapur, Dist. Chh. Sambhajinagar";

// ================= DATE & COMMISSION UTILITIES =================
function getTodayDateFormatted() {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

function getTripCommission(trip) {
    if (!trip) return 0;
    let comm = String(trip['_colK'] ?? trip['Commission Amount'] ?? trip['Commission'] ?? '').replace(/[^\d.]/g, '');
    let val = parseFloat(comm);
    if (!isNaN(val) && val > 0) return val;
    
    let alt = String(trip['Amount'] ?? trip['_tripAmount'] ?? '').replace(/[^\d.]/g, '');
    let altVal = parseFloat(alt);
    return (!isNaN(altVal) && altVal > 0) ? altVal : 0;
}

function parseSheetDate(dateStr) {
    if (!dateStr) return null;
    let parts = String(dateStr).split(/[-/]/);
    if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]);
    let d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function formatDisplayDate(dateVal) {
    if (!dateVal) return "-";
    let str = String(dateVal).trim();
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(str)) return str.replace(/\//g, '-');
    let d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
        let day = String(d.getDate()).padStart(2, '0');
        let month = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}-${month}-${d.getFullYear()}`;
    }
    return str;
}

function toDateInputValue(dateStr) {
    const d = parseSheetDate(dateStr);
    if (!d) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWhatsAppPhone(phone) {
    let digits = String(phone || "").replace(/\D/g, '').replace(/^0+/, '');
    if (digits.length === 10) return '91' + digits;
    if (digits.length === 11 && !digits.startsWith('91') && digits.startsWith('0')) return '91' + digits.slice(1);
    return digits;
}

function safeAttr(val) { 
    return String(val == null ? "" : val).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;"); 
}

function tripKeyFor(vNo, date) { return `${vNo}|${date}`; }

function isDateInRange(dateStr, start, end) {
    if (!start && !end) return true;
    let tripDate = parseSheetDate(dateStr);
    if (!tripDate) return false;
    let sDate = start ? new Date(start) : new Date("2000-01-01");
    let eDate = end ? new Date(end) : new Date("2099-12-31");
    tripDate.setHours(0,0,0,0); sDate.setHours(0,0,0,0); eDate.setHours(0,0,0,0);
    return tripDate >= sDate && tripDate <= eDate;
}

function getMsgSendCounts() {
    try { return JSON.parse(localStorage.getItem('ktc_msg_send_counts') || '{}'); } catch (e) { return {}; }
}

function saveMsgSendCounts(obj) {
    try { localStorage.setItem('ktc_msg_send_counts', JSON.stringify(obj)); } catch (e) {}
}

// ================= SPEED CACHE MANAGEMENT =================
function getLocalTripsCache() {
    try {
        const saved = localStorage.getItem('ktc_trips_cache');
        return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
}

function setLocalTripsCache(data) {
    if (Array.isArray(data)) {
        window.allTripsData = data;
        try { localStorage.setItem('ktc_trips_cache', JSON.stringify(data)); } catch(e) {}
        populateTripSuggestions(data);
    }
}

function getLocalSlipsCache() {
    try {
        const saved = localStorage.getItem('ktc_slips_cache');
        return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
}

function setLocalSlipsCache(data) {
    if (Array.isArray(data)) {
        window.currentSlipHistory = data;
        try { localStorage.setItem('ktc_slips_cache', JSON.stringify(data)); } catch(e) {}
    }
}

async function syncDataFromServer(forceRender = false) {
    if (!window.authPass) return;
    try {
        const response = await fetch(apiUrl());
        if (!response.ok) return;
        const data = await response.json();
        
        if (Array.isArray(data)) {
            setLocalTripsCache(data);
            if (forceRender) renderAllActiveViews();
        }
    } catch(e) { console.warn("Trips sync error:", e.message); }
}

// Background sync for Slips from Google Sheet/Drive
async function syncSlipsFromServer() {
    const pass = window.authPass || localStorage.getItem('ktc_pass') || "1234";
    try {
        const response = await fetch(scriptURL + "?action=listSlips&pass=" + encodeURIComponent(pass));
        if (!response.ok) return;
        const slips = await response.json();
        if (Array.isArray(slips)) {
            setLocalSlipsCache(slips);
            renderSlipHistoryList();
        } else {
            console.error("listSlips server response:", slips);
        }
    } catch(e) {
        console.warn("Slips sync error:", e);
    }
}



function renderAllActiveViews() {
    loadHomeRecent();
    if (!document.getElementById('view-trips-section').classList.contains('hidden')) renderTripsList();
    if (!document.getElementById('accounts-section').classList.contains('hidden')) updateAccounts();
    if (!document.getElementById('daily-followup-section').classList.contains('hidden')) loadDailyFollowup();
}

// ================= 🟢 LOADING SLIP HISTORY (DEFINED FIRST) =================
// Loading Slips Tab Handler (Instant Render + Server Sync)
function loadSlipHistory() {
    const container = document.getElementById('slipHistoryList');
    if (!container) return;
    
    window.currentSlipHistory = getLocalSlipsCache();
    if (window.currentSlipHistory && window.currentSlipHistory.length > 0) {
        renderSlipHistoryList();
    } else {
        container.innerHTML = '<div class="text-center w-100 p-4"><div class="spinner-border text-danger spinner-border-sm"></div> Fetching Slips from Sheet...</div>';
    }

    syncSlipsFromServer();
}
window.loadSlipHistory = loadSlipHistory;

function renderSlipHistoryList() {
    const container = document.getElementById('slipHistoryList');
    if (!container) return;

    container.innerHTML = "";

    if (!window.currentSlipHistory || window.currentSlipHistory.length === 0) {
        container.innerHTML = '<div class="text-center w-100 p-5 text-muted"><i class="bi bi-folder-x fs-1 d-block mb-2 opacity-50"></i>No Loading Slips found.</div>';
        return;
    }

    window.currentSlipHistory.forEach(slip => {
        let d = {};
        try { if (slip.formData) d = JSON.parse(slip.formData); } catch(e) {}

        const vNo = d.vNo || slip.name.replace(/^Slip_/, '').split('_')[0] || "TRUCK";
        const route = (d.from && d.to) ? `${d.from} ➔ ${d.to}` : "";
        const party = d.partyName ? ` | ${d.partyName}` : "";

        container.insertAdjacentHTML('beforeend', `
            <div class="col-12 col-md-6 mb-2">
                <div class="card shadow-sm border-0" style="border-radius:12px; border-left: 5px solid #dc3545; background: #ffffff;">
                    <div class="card-body p-3">
                        <div class="d-flex justify-content-between align-items-start">
                            <div class="text-truncate" style="max-width: 68%;">
                                <h6 class="fw-bold mb-1" style="font-size:14px; color:#003366;">
                                    <i class="bi bi-truck me-1"></i>${safeAttr(vNo)}
                                </h6>
                                ${route ? `<small class="text-dark fw-bold d-block" style="font-size:11px;">${safeAttr(route)}</small>` : ''}
                                <small class="text-muted" style="font-size:10px;">
                                    <i class="bi bi-calendar3"></i> ${slip.date || ''} ${safeAttr(party)}
                                </small>
                            </div>
                            <div class="d-flex gap-2">
                                ${slip.url && slip.url !== '#' ? `<a href="${slip.url}" target="_blank" class="btn btn-sm btn-light text-danger border" title="View PDF"><i class="bi bi-file-pdf"></i></a>` : ''}
                                <button class="btn btn-sm btn-outline-primary" onclick="editSavedSlip(${slip.rowNumber})" title="Edit Slip"><i class="bi bi-pencil-square"></i></button>
                                <button class="btn btn-sm btn-success" onclick="shareSlipWhatsApp(${slip.rowNumber})" title="WhatsApp Share"><i class="bi bi-whatsapp"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`);
    });
}
window.renderSlipHistoryList = renderSlipHistoryList;

// ================= LOADING SLIP WHATSAPP SHARE (FAST & DIRECT) =================
function shareSlipWhatsApp(rowNumber) {
    const slip = window.currentSlipHistory.find(s => s.rowNumber === rowNumber);
    if (!slip) {
        alert("Slip data nahi mila. Refresh karke try karein.");
        return;
    }

    let d = {};
    try { if (slip.formData) d = JSON.parse(slip.formData); } catch(e) {}

    const vNo = d.vNo || slip.name.replace(/^Slip_/, '').split('_')[0] || "Vehicle";
    const tDate = d.date || slip.date || getTodayDateFormatted();
    const from = d.from || "N/A";
    const to = d.to || "N/A";
    const party = d.partyName || "N/A";
    const toPay = d.toPay || "0";
    const pdfUrl = (slip.url && slip.url !== '#' && slip.url !== '') ? slip.url : "";

    // Malik ya Driver ka phone number
    let targetPhone = d.ownerMob || d.driverMob || "";
    let cleanPhone = formatWhatsAppPhone(targetPhone);

    const messageText = `🏢 *KUNAL TRANSPORT COMPANY*
_Loading Slip (Beelty)_
==========================
🚚 Vehicle: *${vNo}*
📅 Date: ${tDate}
🛣️ Route: ${from} ➔ ${to}
🏢 Party: ${party}

💰 *NET PAYABLE BALANCE: ₹${toPay}*
${pdfUrl ? `\n📄 *BEELTY PDF LINK:*\n${pdfUrl}\n` : ''}==========================
_Raju Hiwale & Firoj Shaikh_
📲 9403691888 | 9527691888`;

    const encodedMsg = encodeURIComponent(messageText);
    let whatsappURL = "";
    if (cleanPhone && cleanPhone.length >= 12) {
        whatsappURL = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;
    } else {
        whatsappURL = `https://api.whatsapp.com/send?text=${encodedMsg}`;
    }

    try {
        window.location.href = whatsappURL;
    } catch (e) {
        window.open(whatsappURL, '_blank');
    }
}
window.shareSlipWhatsApp = shareSlipWhatsApp;

// Purane button compatibility ke liye fallback
function shareFileFromDrive(fileId, fileName) {
    const slip = window.currentSlipHistory.find(s => s.id === fileId || s.name === fileName);
    if (slip) {
        shareSlipWhatsApp(slip.rowNumber);
    } else {
        const msg = encodeURIComponent(`🏢 *KUNAL TRANSPORT COMPANY*\nLoading Slip: ${fileName}`);
        window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
    }
}
window.shareFileFromDrive = shareFileFromDrive;

// ================= SECTION SWITCHER =================
function showSection(id) {
    document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(id + '-section');
    if(target) target.classList.remove('hidden');
    
    if(id === 'view-trips') renderTripsList();
    if(id === 'accounts') updateAccounts();
    if(id === 'home') loadHomeRecent();
    if(id === 'vehicles') loadVehicles(); 
    if(id === 'daily-followup') loadDailyFollowup();
    if(id === 'loading-slip') { 
        loadVehicleListForSlip(); 
        initWizard(); 
        const slipDateEl = document.getElementById('slip_date');
        if(slipDateEl && (!slipDateEl.value || slipDateEl.value.trim() === '')) {
            slipDateEl.value = getTodayDateFormatted();
        }
    }
    if(id === 'slip-history') loadSlipHistory();
    if(id === 'new-trip' && !document.getElementById('tripEditRow').value) { resetTripWizard(); }

    const sidebar = document.getElementById('sidebar');
    if (sidebar && window.bootstrap) {
        const instance = bootstrap.Offcanvas.getInstance(sidebar);
        if(instance) instance.hide();
    }
}
window.showSection = showSection;

// ================= ONLOAD INITIALIZATION =================
window.onload = () => {
    checkLoginStatus();
    updateGreeting();

    const slipDateEl = document.getElementById('slip_date');
    if (slipDateEl) slipDateEl.value = getTodayDateFormatted();

    window.allTripsData = getLocalTripsCache();
    if (window.allTripsData.length > 0) {
        populateTripSuggestions(window.allTripsData);
        loadHomeRecent();
    }

    window.currentSlipHistory = getLocalSlipsCache();
    if (window.currentSlipHistory.length > 0) {
        renderSlipHistoryList();
    }

    syncDataFromServer(true);
    syncSlipsFromServer();

    setInterval(() => {
        const timeEl = document.getElementById('homeTime');
        if(timeEl) timeEl.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, 60000);
};

// ================= AUTHENTICATION =================
function checkLoginStatus() {
    const lockScreen = document.getElementById('lock-screen');
    if (localStorage.getItem('ktc_unlocked') === 'true' && window.authPass) {
        if(lockScreen) lockScreen.classList.add('lock-hidden');
    }
}

async function handleLogin() {
    const pass = document.getElementById('loginPass').value;
    const btn = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('lock-error');

    if(!pass) { alert("Password bharein!"); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Verifying...';

    try {
        const res = await fetch(scriptURL, {
            method: 'POST',
            body: JSON.stringify({ action: "login", pass })
        });
        const data = await res.json();

        if (data.success) {
            window.authPass = pass;
            localStorage.setItem('ktc_unlocked', 'true');
            localStorage.setItem('ktc_name', data.transportName);
            localStorage.setItem('ktc_pass', window.authPass);
            window.transport_name = data.transportName;
            
            applyBranding();
            document.getElementById('lock-screen').classList.add('lock-hidden');
            syncDataFromServer(true);
            syncSlipsFromServer();
        } else {
            errorMsg.classList.remove('hidden');
            errorMsg.innerText = data.error;
        }
    } catch (e) {
        alert("Server se connection nahi ho paya!");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>LOGIN SYSTEM</span> <i class="bi bi-box-arrow-in-right"></i>';
    }
}

function applyBranding() {
    const name = localStorage.getItem('ktc_name') || "Transport Company";
    const brandEl = document.querySelector('.navbar-brand');
    if(brandEl) brandEl.innerText = name.toUpperCase();
    const homeTitle = document.querySelector('#home-section h3');
    if(homeTitle) homeTitle.innerText = name;
    const beeltyTitle = document.querySelector('.c-company-title');
    if(beeltyTitle) beeltyTitle.innerText = name.toUpperCase();
    window.COMPANY_NAME = name;
}

window.addEventListener('DOMContentLoaded', () => {
    if(localStorage.getItem('ktc_unlocked') === 'true') {
        document.getElementById('lock-screen').classList.add('lock-hidden');
        applyBranding();
    }
});

function logout() {
    if (confirm("Kya aap sach mein Logout karna chahte hain?")) {
        localStorage.clear();
        window.authPass = "";
        location.reload();
    }
}

function updateGreeting() {
    let hrs = new Date().getHours();
    let greet = "Good Morning,";
    if (hrs >= 12 && hrs <= 17) greet = "Good Afternoon,";
    else if (hrs >= 17 && hrs <= 24) greet = "Good Evening,";
    const gElement = document.getElementById('greetingText');
    if(gElement) gElement.innerText = greet;
}

// ================= HOME STATS =================
function loadHomeRecent() {
    const container = document.getElementById('homeRecentTrips');
    const todayBizEl = document.getElementById('todayBiz');
    const todayCountEl = document.getElementById('todayCount');
    const homePendEl = document.getElementById('homePendingCount');
    
    const now = new Date();
    document.getElementById('homeTime').innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('homeDate').innerText = now.toDateString();

    if (!container) return;
    container.innerHTML = '';
    
    let todayBiz = 0;
    let todayCount = 0;
    let pendingCount = 0;
    const todayFormatted = now.toLocaleDateString('en-GB');

    window.allTripsData.forEach((trip, index) => {
        let isCollected = (String(trip['_colG'] || "").toLowerCase().trim() === "yes");
        let commAmt = getTripCommission(trip);
        let tripDateStr = String(trip['Date']).replace(/-/g, '/');
        
        if(tripDateStr === todayFormatted) {
            todayBiz += commAmt;
            todayCount++;
        }
        if(!isCollected) pendingCount++;

        if(index < 5) {
            container.insertAdjacentHTML('beforeend', `
                <div class="recent-item shadow-sm">
                    <div>
                        <div class="fw-bold" style="font-size:14px; color:#003366;"><i class="bi bi-truck me-1"></i>${safeAttr(trip['Vehicle No'])}</div>
                        <small class="text-muted">${safeAttr(trip['From'])} ➔ ${safeAttr(trip['To'])}</small>
                    </div>
                    <div class="text-end">
                        <small class="text-muted d-block" style="font-size:9px; font-weight:700;">COMMISSION</small>
                        <div class="text-success fw-bold" style="font-size:15px;">₹${Number(commAmt).toLocaleString('en-IN')}</div>
                        <small style="font-size: 10px;" class="text-muted">${formatDisplayDate(trip['Date'])}</small>
                    </div>
                </div>`);
        }
    });

    todayBizEl.innerText = "₹" + todayBiz.toLocaleString('en-IN');
    todayCountEl.innerText = todayCount;
    homePendEl.innerText = pendingCount;
}

// ================= GAADI MASTER & HISTORY =================
function renderVehicleHistoryFromMemory(vNo) {
    const safeId = vNo.replace(/[^a-zA-Z0-9]/g, '_');
    const histContainer = document.getElementById(`historyList_${safeId}`);
    const statsContainer = document.getElementById(`stats_${safeId}`);
    if (!histContainer) return;

    const history = window.allTripsData.filter(t => String(t['Vehicle No']).trim().toUpperCase() === vNo.trim().toUpperCase());

    if(history.length === 0) {
        histContainer.innerHTML = '<div class="text-center p-3 text-muted small">No trip history found</div>';
        if (statsContainer) statsContainer.innerHTML = '<div class="col-12 text-center small opacity-50">No Data</div>';
        return;
    }

    let totalComm = 0;
    let pendingComm = 0;
    
    history.forEach(t => { 
        let comm = getTripCommission(t);
        totalComm += comm;
        if(String(t['_colG']).toLowerCase() !== 'yes') pendingComm += comm;
    });

    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="col-4"><div class="p-2 border rounded bg-white shadow-sm"><small class="d-block text-muted" style="font-size:9px">TOTAL TRIPS</small><b class="text-primary">${history.length}</b></div></div>
            <div class="col-4"><div class="p-2 border rounded bg-white shadow-sm"><small class="d-block text-muted" style="font-size:9px">TOTAL COMM.</small><b class="text-success">₹${totalComm.toLocaleString('en-IN')}</b></div></div>
            <div class="col-4"><div class="p-2 border rounded bg-white shadow-sm"><small class="d-block text-muted" style="font-size:9px">PENDING COMM.</small><b class="text-danger">₹${pendingComm.toLocaleString('en-IN')}</b></div></div>
        `;
    }

    histContainer.innerHTML = history.map(trip => {
        const isRec = String(trip['_colG']).toLowerCase() === 'yes';
        const cleanDate = formatDisplayDate(trip['Date']);
        const tripComm = getTripCommission(trip);
        
        return `
        <div class="card mb-2 border-0 shadow-sm overflow-hidden" style="border-left: 4px solid ${isRec ? '#28a745' : '#dc3545'} !important;">
            <div class="card-body p-2" style="font-size: 12px;">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <span class="fw-bold text-dark">${trip['From'] || 'N/A'} <i class="bi bi-arrow-right text-muted"></i> ${trip['To'] || 'N/A'}</span>
                        <div class="text-muted" style="font-size: 10px;">
                            <i class="bi bi-calendar3"></i> ${cleanDate} | <i class="bi bi-person"></i> ${trip['Party Name'] || 'No Party'}
                        </div>
                    </div>
                    <div class="text-end">
                        <small class="text-muted d-block" style="font-size:9px; font-weight:700;">COMMISSION</small>
                        <div class="fw-bold text-primary">₹${tripComm.toLocaleString('en-IN')}</div>
                        <span class="badge ${isRec ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}" style="font-size: 9px;">
                            ${isRec ? 'RECEIVED' : 'PENDING'}
                        </span>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ================= GAADI MASTER & DOCUMENTS (CRASH-PROOF) =================
async function loadVehicles() {
    const container = document.getElementById('vehicleCardsContainer');
    if (!container) return;

    // 1. Memory cache se gaadiyan turant nikaalo
    let vehiclesSet = [...new Set((window.allTripsData || []).map(t => String(t['Vehicle No'] || '').trim().toUpperCase()))].filter(v => v !== "");
    
    // Agar memory me data hai, turant render karo (0 millisecond wait)
    if (vehiclesSet.length > 0) {
        renderVehicleCards(vehiclesSet, []);
    } else {
        container.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-primary spinner-border-sm mb-2"></div><br><small class="text-muted">Gaadiyan load ho rahi hain...</small></div>';
    }

    const pass = window.authPass || localStorage.getItem('ktc_pass') || "1234";

    try {
        // Backend se uploaded list safe check
        let cleanUploadedList = [];
        try {
            const resUploaded = await fetch(scriptURL + "?action=getUploadedList&pass=" + encodeURIComponent(pass));
            const text = await resUploaded.text();
            if (text && !text.trim().startsWith("<")) {
                const uploadedData = JSON.parse(text);
                if (Array.isArray(uploadedData)) {
                    cleanUploadedList = uploadedData.map(v => String(v).trim().toUpperCase());
                }
            }
        } catch (eUpload) {
            console.warn("Uploaded list fetch warning:", eUpload);
        }

        // Agar memory khali thi toh backend se mangwayein
        if (vehiclesSet.length === 0) {
            try {
                const resVehicles = await fetch(scriptURL + "?action=getVehicles&pass=" + encodeURIComponent(pass));
                const vText = await resVehicles.text();
                if (vText && !vText.trim().startsWith("<")) {
                    const vData = JSON.parse(vText);
                    if (Array.isArray(vData)) {
                        vehiclesSet = vData.map(v => String(v).trim().toUpperCase()).filter(v => v !== "");
                    }
                }
            } catch (ev) {}
        }

        // Uploaded list wali gaadiyan bhi jod dein
        cleanUploadedList.forEach(v => {
            if (v && !vehiclesSet.includes(v)) vehiclesSet.push(v);
        });

        renderVehicleCards(vehiclesSet, cleanUploadedList);

    } catch (e) {
        console.error("loadVehicles error:", e);
        if (vehiclesSet.length > 0) {
            renderVehicleCards(vehiclesSet, []);
        } else {
            container.innerHTML = `<div class="text-center p-4 text-danger">
                <i class="bi bi-exclamation-triangle fs-3 d-block mb-1"></i>
                Data load failed.<br>
                <button class="btn btn-sm btn-outline-primary mt-2" onclick="loadVehicles()">🔄 Dobara Koshish Karein</button>
            </div>`;
        }
    }
}
window.loadVehicles = loadVehicles;

function renderVehicleCards(vehiclesSet, cleanUploadedList) {
    const container = document.getElementById('vehicleCardsContainer');
    if (!container) return;

    let done = 0;
    let pending = 0;
    container.innerHTML = '';

    if (!vehiclesSet || vehiclesSet.length === 0) {
        container.innerHTML = '<div class="text-center p-4 text-muted"><i class="bi bi-truck fs-1 d-block mb-2 opacity-50"></i>Koi Gaadi Record me nahi mili.</div>';
        if (document.getElementById('count-done')) document.getElementById('count-done').innerText = '0';
        if (document.getElementById('count-pending')) document.getElementById('count-pending').innerText = '0';
        return;
    }

    const sortedVehicles = [...vehiclesSet].sort((a, b) => {
        const aUp = cleanUploadedList.includes(a);
        const bUp = cleanUploadedList.includes(b);
        if (aUp === bUp) return a.localeCompare(b);
        return aUp ? -1 : 1;
    });

    sortedVehicles.forEach((cleanVNo) => {
        const safeId = cleanVNo.replace(/[^a-zA-Z0-9]/g, '_'); 
        const isUploaded = cleanUploadedList.includes(cleanVNo);
        if (isUploaded) done++; else pending++;

        const statusMark = isUploaded 
            ? '<span class="badge bg-success-subtle text-success ms-2" style="font-size:10px;"><i class="bi bi-check-circle-fill"></i> RC OK</span>' 
            : '<span class="badge bg-danger-subtle text-danger ms-2" style="font-size:10px;"><i class="bi bi-exclamation-circle"></i> NO RC</span>';

        container.insertAdjacentHTML('beforeend', `
            <div class="v-list-item shadow-sm mb-3" style="background: white; border-radius: 12px; border-left: 5px solid ${isUploaded ? '#28a745' : '#dc3545'}; overflow: hidden;">
                <div class="v-item-header p-3 d-flex justify-content-between align-items-center" onclick="toggleDetails('details_${safeId}', '${safeAttr(cleanVNo)}')" style="cursor:pointer;">
                    <div>
                        <span class="fw-bold" style="color: #003366;"><i class="bi bi-truck me-1"></i> ${cleanVNo}</span>
                        ${statusMark}
                    </div>
                    <i class="bi bi-chevron-down text-muted"></i>
                </div>
                
                <div id="details_${safeId}" class="v-item-details hidden p-3 border-top bg-light">
                    <div id="stats_${safeId}" class="row g-2 mb-3 mt-1 text-center small text-muted">Calculating...</div>
                    <div class="d-flex gap-2 mb-3">
                        <button class="btn btn-sm btn-primary w-50" onclick="triggerUpload('${safeId}')">
                            <i class="bi bi-cloud-arrow-up"></i> Update RC
                        </button>
                        <input type="file" id="file_${safeId}" class="hidden" multiple onchange="uploadFile(this, '${safeAttr(cleanVNo)}')">
                        <button class="btn btn-sm btn-outline-info w-50" onclick="fetchVehicleDocs('${safeAttr(cleanVNo)}')">
                            <i class="bi bi-file-earmark-text"></i> Docs
                        </button>
                    </div>
                    <div id="docList_${safeId}" class="mb-3"></div>
                    <h6 class="fw-bold small border-bottom pb-1" style="color:#003366;"><i class="bi bi-clock-history"></i> Trip History</h6>
                    <div id="historyList_${safeId}" class="history-container small text-muted">Loading...</div>
                </div>
            </div>
        `);
    });

    if (document.getElementById('count-done')) document.getElementById('count-done').innerText = done;
    if (document.getElementById('count-pending')) document.getElementById('count-pending').innerText = pending;
}
window.renderVehicleCards = renderVehicleCards;

async function fetchVehicleDocs(vNo) {
    const cleanVNo = String(vNo || "").trim().toUpperCase();
    const safeId = cleanVNo.replace(/[^a-zA-Z0-9]/g, '_');
    const docContainer = document.getElementById(`docList_${safeId}`);
    if(!docContainer) return;

    docContainer.innerHTML = '<div class="p-2 small text-muted"><span class="spinner-border spinner-border-sm me-1 text-primary"></span> Loading docs...</div>';
    
    const pass = window.authPass || localStorage.getItem('ktc_pass') || "1234";
    try {
        const res = await fetch(scriptURL + `?action=getDocs&vNo=${encodeURIComponent(cleanVNo)}&pass=${encodeURIComponent(pass)}`);
        const text = await res.text();
        docContainer.innerHTML = '';

        if (text && !text.trim().startsWith("<")) {
            const docs = JSON.parse(text);
            if (Array.isArray(docs) && docs.length > 0) {
                docs.forEach(doc => {
                    docContainer.insertAdjacentHTML('beforeend', `
                        <div class="d-flex justify-content-between align-items-center p-2 mb-1 rounded border bg-white shadow-sm">
                            <div class="text-truncate" style="max-width: 75%;">
                                <i class="bi bi-file-earmark-check-fill text-success me-1"></i>
                                <span class="fw-bold small text-dark">${safeAttr(doc.name)}</span>
                                ${doc.date ? `<small class="text-muted d-block" style="font-size:10px;"><i class="bi bi-clock"></i> ${doc.date}</small>` : ''}
                            </div>
                            <a href="${doc.url}" target="_blank" class="btn btn-sm btn-outline-primary" style="font-size:11px;">
                                <i class="bi bi-box-arrow-up-right me-1"></i> Open
                            </a>
                        </div>
                    `);
                });
                return;
            }
        }
        docContainer.innerHTML = '<div class="p-2 rounded bg-light border text-muted small"><i class="bi bi-info-circle me-1"></i>Koi document upload nahi hai. Update RC button dabakar upload karein.</div>';
    } catch (e) { 
        docContainer.innerHTML = '<div class="p-2 rounded bg-light border text-muted small"><i class="bi bi-info-circle me-1"></i>Koi document upload nahi hai.</div>'; 
    }
}
window.fetchVehicleDocs = fetchVehicleDocs;

function triggerUpload(safeId) { 
    const inp = document.getElementById(`file_${safeId}`);
    if (inp) inp.click(); 
}

function toggleDetails(id, vNo) {
    const el = document.getElementById(id);
    if(el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        fetchVehicleDocs(vNo);
        renderVehicleHistoryFromMemory(vNo);
    } else {
        el.classList.add('hidden');
    }
}



async function uploadFile(input, vNo) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const btn = input.closest('.v-item-details').querySelector('.btn-primary');
    await uploadFilesDirect(files, vNo, btn);
    input.value = '';
}

async function uploadFilesDirect(files, vNo, btn) {
    const originalText = btn ? btn.innerHTML : '';
    let success = 0;
    let lastError = "";

    for (let i = 0; i < files.length; i++) {
        if (btn) {
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> UPLOADING ${i + 1}/${files.length}...`;
            btn.disabled = true;
        }
        try {
            const res = await uploadSingleFile(files[i], vNo);
            if (res && res.success) {
                success++;
            } else {
                lastError = (res && res.error) ? res.error : "Server error";
            }
        } catch (e) {
            lastError = e.message || "Network error";
        }
    }

    if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }

    if (success > 0) {
        alert(`✅ ${success} Document(s) Google Drive Me Upload Ho Gaye!`);
        fetchVehicleDocs(vNo); 
        loadVehicles();
    } else {
        alert(`❌ Upload Failed!\nReason: ${lastError}`);
    }
}
window.uploadFilesDirect = uploadFilesDirect;

function uploadSingleFile(file, vNo) {
    return new Promise((resolve, reject) => {
        const isImage = file.type.startsWith('image/');
        const reader = new FileReader();

        reader.onload = function(e) {
            const rawResult = e.target.result || "";
            if (isImage) {
                const img = new Image();
                img.onload = function() {
                    try {
                        const canvas = document.createElement('canvas');
                        const maxDim = 1600;
                        let width = img.width, height = img.height;
                        if (width > height && width > maxDim) {
                            height = Math.round((height * maxDim) / width);
                            width = maxDim;
                        } else if (height > maxDim) {
                            width = Math.round((width * maxDim) / height);
                            width = maxDim;
                        }
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.82);
                        sendPayloadToServer(compressedBase64, file.name, 'image/jpeg', vNo, resolve, reject);
                    } catch(cErr) {
                        sendPayloadToServer(rawResult, file.name, file.type || 'image/jpeg', vNo, resolve, reject);
                    }
                };
                img.onerror = () => {
                    sendPayloadToServer(rawResult, file.name, file.type || 'image/jpeg', vNo, resolve, reject);
                };
                img.src = rawResult;
            } else {
                sendPayloadToServer(rawResult, file.name, file.type || 'application/pdf', vNo, resolve, reject);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}
window.uploadSingleFile = uploadSingleFile;

async function sendPayloadToServer(base64, fileName, mimeType, vNo, resolve, reject) {
    try {
        let cleanBase64 = base64;
        if (cleanBase64.indexOf(',') !== -1) {
            cleanBase64 = cleanBase64.split(',')[1];
        }

        const payload = {
            action: "uploadDocument",
            vNo: vNo.toUpperCase().trim(),
            fileName: fileName,
            base64: cleanBase64,
            mimeType: mimeType,
            pass: window.authPass || localStorage.getItem('ktc_pass') || "1234"
        };

        const res = await fetch(scriptURL, { 
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload) 
        });

        const data = await res.json();
        resolve(data);
    } catch (err) { 
        console.error("Upload error details:", err);
        reject(err); 
    }
}
window.sendPayloadToServer = sendPayloadToServer;


// ================= ACCOUNTS (HISAAB-KITAAB) =================
function updateAccounts() {
    const bizEl = document.getElementById('acc-total-business');
    const pendEl = document.getElementById('acc-total-pending');
    const recdEl = document.getElementById('acc-total-received');
    const listEl = document.getElementById('collector-list');

    const startVal = document.getElementById('acc-start-date') ? document.getElementById('acc-start-date').value : '';
    const endVal = document.getElementById('acc-end-date') ? document.getElementById('acc-end-date').value : '';

    const data = window.allTripsData.filter(trip => isDateInRange(trip['Date'], startVal, endVal));

    let totalBus = 0, totalPend = 0, totalRecd = 0;
    let collectorMap = {};

    data.forEach(trip => {
        let commission = getTripCommission(trip);
        totalBus += commission;

        let status = String(trip['_colG'] || "").toLowerCase().trim();
        if (status === "yes") {
            totalRecd += commission;
            let name = String(trip['_colH'] || "Other").trim();
            collectorMap[name] = (collectorMap[name] || 0) + commission;
        } else {
            totalPend += commission;
        }
    });

    bizEl.innerText = "₹" + totalBus.toLocaleString('en-IN');
    pendEl.innerText = "₹" + totalPend.toLocaleString('en-IN');
    recdEl.innerText = "₹" + totalRecd.toLocaleString('en-IN');

    let listHtml = "";
    for (let name in collectorMap) {
        listHtml += `
            <div class="list-group-item d-flex justify-content-between align-items-center small">
                <span><i class="bi bi-person-circle me-2"></i>${name}</span>
                <b class="text-success">₹${collectorMap[name].toLocaleString('en-IN')}</b>
            </div>`;
    }
    listEl.innerHTML = listHtml || '<div class="p-3 text-center small text-muted">No data for this range</div>';
}

// ================= VIEW ALL TRIPS =================
function loadTrips() {
    const container = document.getElementById('tripCardsContainer');
    container.innerHTML = '<div class="text-center p-3"><div class="spinner-border text-primary spinner-border-sm"></div><br><small>Syncing with Sheet...</small></div>';
    syncDataFromServer(true);
}

function renderTripsList() {
    const container = document.getElementById('tripCardsContainer');
    const summaryBar = document.getElementById('tripSummaryBar');
    if (!container) return;

    const startVal = document.getElementById('trip-start-date') ? document.getElementById('trip-start-date').value : '';
    const endVal = document.getElementById('trip-end-date') ? document.getElementById('trip-end-date').value : '';

    const data = window.allTripsData.filter(trip => isDateInRange(trip['Date'], startVal, endVal));

    container.innerHTML = '';
    summaryBar.classList.remove('hidden');

    if(data.length === 0) {
        container.innerHTML = '<div class="text-center p-5 text-muted">No records found.</div>';
        return;
    }

    const vCountMap = {};
    window.allTripsData.forEach(t => {
        let v = t['Vehicle No'];
        vCountMap[v] = (vCountMap[v] || 0) + 1;
    });

    let tCount = 0, colCount = 0, penCount = 0;
    const today = new Date();

    data.forEach(trip => {
        let isCollected = (String(trip['_colG'] || "").toLowerCase().trim() === "yes");
        let collectorName = trip['_colH'] || "Not Specified";
        let collectorRaw = trip['_colH'] || "";
        let amt = trip['Amount'] || trip['_tripAmount'] || 0;
        let commissionAmt = getTripCommission(trip);
        let vNo = trip['Vehicle No'];
        let driverNo = trip['Driver No'] || "";
        let ownerNo = trip['_owner'] || "";
        let tDate = formatDisplayDate(trip['Date']);
        let tFrom = trip['From'];
        let tTo = trip['To'];
        let tParty = trip['Party Name'];
        let tMaterial = trip['Material'];
        let tWeight = trip['Capacity Ton'];
        let tRate = trip['Rate'];
        let calculatedFreight = Math.round(parseFloat(amt) || ((parseFloat(tRate) || 0) * (parseFloat(tWeight) || 0)));
        
        let vCount = vCountMap[vNo];
        let vBadge = vCount === 1 
            ? `<span class="badge bg-info text-dark" style="font-size: 9px; vertical-align: middle; margin-left: 5px;">NEW VEHICLE</span>`
            : `<span class="badge bg-secondary" style="font-size: 9px; vertical-align: middle; margin-left: 5px;">${vCount} TRIPS</span>`;

        let daysText = "";
        let tripDate = parseSheetDate(tDate);
        if (tripDate && !isCollected) {
            tripDate.setHours(0, 0, 0, 0);
            let diffDays = Math.floor((today - tripDate) / (1000 * 60 * 60 * 24));
            if (diffDays >= 1) {
                daysText = diffDays > 15 
                    ? `<span class="overdue-tag bg-danger text-white"><i class="bi bi-exclamation-triangle"></i> ${diffDays} Days Overdue</span>`
                    : `<span class="overdue-tag bg-warning text-dark"><i class="bi bi-clock"></i> ${diffDays} Days Pending</span>`;
            }
        }

        tCount++;
        if(isCollected) colCount++; else penCount++;

        container.insertAdjacentHTML('beforeend', `
            <div class="trip-card shadow-sm ${isCollected ? 'status-collected' : 'status-pending'} mb-4" data-trip-key="${safeAttr(tripKeyFor(vNo, tDate))}">
                <div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2">
                    <div>
                        <h5 class="fw-bold mb-0 text-primary d-inline-block">${vNo}</h5>
                        ${vBadge}
                        <br>
                        <small class="text-muted"><i class="bi bi-calendar3"></i> ${tDate}</small>
                    </div>
                    <div class="text-end">
                        <span class="badge ${isCollected ? 'bg-success' : 'bg-danger'} mb-1">
                            ${isCollected ? 'COLLECTED' : 'PENDING'}
                        </span>
                        ${isCollected ? `<div class="collector-tag"><i class="bi bi-person-check-fill"></i> ${collectorName}</div>` : ''}
                        <small class="text-muted d-block" style="font-size:9px; margin-top:2px;">COMMISSION</small>
                        <div class="fw-bold h5 mb-0" style="color:#003366;">₹${Number(commissionAmt).toLocaleString('en-IN')}</div>
                    </div>
                </div>

                <div class="route-timeline">
                    <div class="point point-start"></div>
                    <div class="small fw-bold text-uppercase">${tFrom || 'N/A'}</div>
                    <div style="height:15px"></div>
                    <div class="point point-end"></div>
                    <div class="small fw-bold text-uppercase">${tTo || 'N/A'}</div>
                </div>

                <div class="details-grid row g-0 text-center mb-2 mt-3 py-2">
                    <div class="col-3 border-end">
                        <small class="text-muted d-block" style="font-size:9px;">MATERIAL</small>
                        <span class="fw-bold small text-truncate d-block px-1">${tMaterial || '-'}</span>
                    </div>
                    <div class="col-3 border-end">
                        <small class="text-muted d-block" style="font-size:9px;">RATE</small>
                        <span class="fw-bold small">₹${tRate || '0'}</span>
                    </div>
                    <div class="col-3 border-end">
                        <small class="text-muted d-block" style="font-size:9px;">WEIGHT</small>
                        <span class="fw-bold small">${tWeight || '0'} T</span> 
                    </div>
                    <div class="col-3">
                        <small class="text-primary fw-bold d-block" style="font-size:9px;">FREIGHT</small>
                        <span class="fw-bold small text-primary">₹${calculatedFreight.toLocaleString('en-IN')}</span>
                    </div>
                </div>

                <div class="mt-2 p-2 rounded" style="background: rgba(0,0,0,0.03); font-size: 12px;">
                    <div class="d-flex justify-content-between mb-1">
                        <span><i class="bi bi-person text-muted"></i> Party:</span>
                        <span class="fw-bold">${tParty || '-'}</span>
                    </div>
                    
                    <div class="d-flex justify-content-between mb-1 align-items-center">
                        <span><i class="bi bi-telephone text-muted"></i> Driver:</span>
                        <div class="d-flex align-items-center gap-3">
                            <span class="fw-bold">${driverNo || '-'}</span>
                            <div class="d-flex gap-2">
                                ${driverNo ? `<a href="tel:${driverNo}" class="text-primary"><i class="bi bi-telephone-fill"></i></a>` : ''}
                                ${driverNo ? `<a href="#" onclick="shareTrip('${safeAttr(driverNo)}', '${safeAttr(vNo)}', '${safeAttr(tFrom)}', '${safeAttr(tTo)}', '${safeAttr(tParty)}', '${safeAttr(amt)}', '${safeAttr(tDate)}', '${safeAttr(tMaterial)}', '${safeAttr(tWeight)}', '${safeAttr(commissionAmt)}')" class="text-success"><i class="bi bi-whatsapp"></i></a>` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="d-flex justify-content-between mb-1 align-items-center">
                        <span><i class="bi bi-person-badge text-muted"></i> Owner:</span>
                        <div class="d-flex align-items-center gap-3">
                            <span class="fw-bold">${ownerNo || '-'}</span>
                            <div class="d-flex gap-2">
                                ${ownerNo ? `<a href="tel:${ownerNo}" class="text-primary"><i class="bi bi-telephone-fill"></i></a>` : ''}
                                ${ownerNo ? `<a href="#" onclick="shareTrip('${safeAttr(ownerNo)}', '${safeAttr(vNo)}', '${safeAttr(tFrom)}', '${safeAttr(tTo)}', '${safeAttr(tParty)}', '${safeAttr(amt)}', '${safeAttr(tDate)}', '${safeAttr(tMaterial)}', '${safeAttr(tWeight)}', '${safeAttr(commissionAmt)}')" class="text-success"><i class="bi bi-whatsapp"></i></a>` : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="mt-3 d-flex justify-content-between align-items-center">
                    <div>${daysText}</div>
                    <div class="d-flex gap-2">
                        <button class="btn btn-sm btn-outline-success" onclick="toggleQuickUpdate(${trip.rowNumber ? trip.rowNumber : 'null'})"><i class="bi bi-pencil-square"></i> Edit Here</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteTripEntry(${trip.rowNumber ? trip.rowNumber : 'null'})"><i class="bi bi-trash"></i></button>
                    </div>
                </div>

                <div id="quickPanel_${trip.rowNumber}" class="quick-update-panel hidden mt-3 p-3 rounded-4" style="background:#eef6ff; border:1px dashed #0d6efd;">
                    <div class="row g-2">
                        <div class="col-6">
                            <label class="small fw-bold mb-1">Date</label>
                            <input type="date" id="q_date_${trip.rowNumber}" class="form-control form-control-sm" value="${toDateInputValue(tDate)}">
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">Vehicle No</label>
                            <input type="text" id="q_vNo_${trip.rowNumber}" list="dl-vNo" class="form-control form-control-sm" value="${safeAttr(vNo)}">
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">From</label>
                            <input type="text" id="q_from_${trip.rowNumber}" list="dl-from" class="form-control form-control-sm" value="${safeAttr(tFrom)}">
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">To</label>
                            <input type="text" id="q_to_${trip.rowNumber}" list="dl-to" class="form-control form-control-sm" value="${safeAttr(tTo)}">
                        </div>
                        <div class="col-12">
                            <label class="small fw-bold mb-1">Party Name</label>
                            <input type="text" id="q_party_${trip.rowNumber}" list="dl-partyName" class="form-control form-control-sm" value="${safeAttr(tParty)}">
                        </div>
                        <div class="col-12">
                            <label class="small fw-bold mb-1">Material</label>
                            <input type="text" id="q_material_${trip.rowNumber}" list="dl-material" class="form-control form-control-sm" value="${safeAttr(tMaterial)}">
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">Rate</label>
                            <input type="number" id="q_rate_${trip.rowNumber}" list="dl-rate" class="form-control form-control-sm" value="${tRate || ''}" oninput="recalcQuickAmount(${trip.rowNumber})">
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">Capacity (Ton)</label>
                            <input type="number" id="q_capacity_${trip.rowNumber}" list="dl-capacity" class="form-control form-control-sm" value="${tWeight || ''}" oninput="recalcQuickAmount(${trip.rowNumber})">
                        </div>
                        <div class="col-12">
                            <label class="small fw-bold mb-1">Amount (Auto-Calculated)</label>
                            <input type="number" id="q_amount_${trip.rowNumber}" class="form-control form-control-sm fw-bold text-success" value="${amt || 0}" readonly>
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">Status</label>
                            <select id="qStatus_${trip.rowNumber}" class="form-select form-select-sm" onchange="toggleQuickCollectorField(${trip.rowNumber})">
                                <option value="No" ${!isCollected ? 'selected' : ''}>❌ Pending</option>
                                <option value="Yes" ${isCollected ? 'selected' : ''}>✅ Received</option>
                            </select>
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">Commission Amt</label>
                            <input type="number" id="qComm_${trip.rowNumber}" class="form-control form-control-sm" value="${commissionAmt || ''}" placeholder="0">
                        </div>
                        <div class="col-12" id="qCollectorWrap_${trip.rowNumber}" ${!isCollected ? 'style="display:none;"' : ''}>
                            <label class="small fw-bold mb-1">Collected By</label>
                            <input type="text" id="qCollector_${trip.rowNumber}" list="dl-collectorName" class="form-control form-control-sm" value="${safeAttr(collectorRaw)}" placeholder="Name">
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">Driver No</label>
                            <input type="text" id="q_dNo_${trip.rowNumber}" list="dl-dNo" class="form-control form-control-sm" value="${safeAttr(driverNo)}">
                        </div>
                        <div class="col-6">
                            <label class="small fw-bold mb-1">Owner No</label>
                            <input type="text" id="q_ownerNo_${trip.rowNumber}" list="dl-ownerNo" class="form-control form-control-sm" value="${safeAttr(ownerNo)}">
                        </div>
                        <div class="col-12">
                            <label class="small fw-bold mb-1">Remark</label>
                            <textarea id="q_remark_${trip.rowNumber}" class="form-control form-control-sm" rows="2">${trip['Remark'] || ''}</textarea>
                        </div>
                    </div>
                    <div class="d-flex gap-2 mt-3">
                        <button class="btn btn-sm btn-success flex-fill" id="qSaveBtn_${trip.rowNumber}" onclick="saveQuickUpdate(${trip.rowNumber})"><i class="bi bi-check-lg"></i> Save All Changes</button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="toggleQuickUpdate(${trip.rowNumber})">Cancel</button>
                    </div>
                </div>
            </div>
        `);
    });

    document.getElementById('sumCount').innerText = tCount;
    document.getElementById('sumColCount').innerText = colCount;
    document.getElementById('sumPenCount').innerText = penCount;
}

// ================= NEW TRIP WIZARD & SAVE =================
const TRIP_TOTAL_STEPS = 4;
let tripCurrentStep = 1;
const TRIP_STEP_TITLES = { 1: "Vehicle & Date", 2: "Route & Party", 3: "Rate & Payment", 4: "Driver & Remark" };

function calculateTotal() {
    let rate = parseFloat(document.getElementById('rate').value) || 0;
    let cap = parseFloat(document.getElementById('capacity').value) || 0;
    document.getElementById('amount').value = Math.round(rate * cap);
}
document.addEventListener('input', function (e) {
    if (e.target && (e.target.id === 'rate' || e.target.id === 'capacity')) calculateTotal();
});

function renderTripStep() {
    document.querySelectorAll('.trip-step').forEach(el => el.classList.add('hidden'));
    const active = document.querySelector(`.trip-step[data-trip-step="${tripCurrentStep}"]`);
    if (active) active.classList.remove('hidden');

    document.querySelectorAll('.t-dot').forEach(dot => {
        dot.classList.toggle('active', parseInt(dot.dataset.dot) <= tripCurrentStep);
    });

    const stepLabel = document.getElementById('tripStepLabel');
    if (stepLabel) stepLabel.innerText = `Step ${tripCurrentStep} of ${TRIP_TOTAL_STEPS}: ${TRIP_STEP_TITLES[tripCurrentStep]}`;

    const backBtn = document.getElementById('tripBackBtn');
    const nextBtn = document.getElementById('tripNextBtn');
    const submitBtn = document.getElementById('submitBtn');
    const submitBeeltyBtn = document.getElementById('submitBeeltyBtn');

    backBtn.classList.toggle('hidden', tripCurrentStep === 1);

    if (tripCurrentStep === TRIP_TOTAL_STEPS) {
        nextBtn.classList.add('hidden');
        submitBtn.classList.remove('hidden');
        if (submitBeeltyBtn) submitBeeltyBtn.classList.remove('hidden');
        renderTripReview();
    } else {
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');
        if (submitBeeltyBtn) submitBeeltyBtn.classList.add('hidden');
    }
}

function renderTripReview() {
    const box = document.getElementById('tripReviewBox');
    if (!box) return;
    const v = id => document.getElementById(id).value;
    box.innerHTML = `
        <div class="fw-bold mb-2" style="color:#003366;"><i class="bi bi-check2-circle me-1"></i>Review Entry</div>
        <div class="d-flex justify-content-between"><span>Vehicle:</span><b>${v('vNo') || '-'}</b></div>
        <div class="d-flex justify-content-between"><span>Date:</span><b>${v('date') || '-'}</b></div>
        <div class="d-flex justify-content-between"><span>Route:</span><b>${v('from') || '-'} ➔ ${v('to') || '-'}</b></div>
        <div class="d-flex justify-content-between"><span>Party:</span><b>${v('partyName') || '-'}</b></div>
        <div class="d-flex justify-content-between"><span>Commission:</span><b>₹${v('commissionAmt') || '0'}</b></div>
        <div class="d-flex justify-content-between"><span>Status:</span><b>${v('received') === 'Yes' ? '✅ Received' : '❌ Pending'}</b></div>
    `;
}

function tripStepIsValid(step) {
    if (step === 1) {
        if (!document.getElementById('vNo').value.trim() || !document.getElementById('date').value) {
            alert("⚠️ Vehicle No aur Date bharna zaroori hai!");
            return false;
        }
    }
    return true;
}
function tripWizardNext() { if (tripStepIsValid(tripCurrentStep) && tripCurrentStep < TRIP_TOTAL_STEPS) { tripCurrentStep++; renderTripStep(); } }
function tripWizardBack() { if (tripCurrentStep > 1) { tripCurrentStep--; renderTripStep(); } }

function resetTripWizard() {
    document.getElementById('tripForm').reset();
    if (document.getElementById('tripEditRow')) document.getElementById('tripEditRow').value = "";
    if (document.getElementById('tripFormTitle')) document.getElementById('tripFormTitle').innerText = "New Trip Entry";
    if (document.getElementById('submitBtnText')) document.getElementById('submitBtnText').innerText = "SAVE TRIP";
    if (document.getElementById('tripCancelEditBtn')) document.getElementById('tripCancelEditBtn').classList.add('hidden');

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('date').value = `${yyyy}-${mm}-${dd}`;

    tripCurrentStep = 1;
    renderTripStep();
}

function populateTripSuggestions(data) {
    if (!data || !Array.isArray(data)) return;
    const fieldMap = {
        'dl-vNo': 'Vehicle No', 'dl-from': 'From', 'dl-to': 'To',
        'dl-partyName': 'Party Name', 'dl-material': 'Material',
        'dl-rate': 'Rate', 'dl-capacity': 'Capacity Ton',
        'dl-dNo': 'Driver No', 'dl-ownerNo': '_owner', 'dl-collectorName': '_colH'
    };
    for (const listId in fieldMap) {
        const dl = document.getElementById(listId);
        if (!dl) continue;
        const key = fieldMap[listId];
        const seen = new Set();
        let optionsHtml = '';
        data.forEach(trip => {
            let val = trip[key];
            if (val === undefined || val === null) return;
            val = String(val).trim();
            if (!val || seen.has(val.toUpperCase())) return;
            seen.add(val.toUpperCase());
            optionsHtml += `<option value="${val.replace(/"/g, '&quot;')}">`;
        });
        dl.innerHTML = optionsHtml;
    }
}

function toggleQuickUpdate(rowNumber) {
    const panel = document.getElementById(`quickPanel_${rowNumber}`);
    if (panel) panel.classList.toggle('hidden');
}
function toggleQuickCollectorField(rowNumber) {
    const status = document.getElementById(`qStatus_${rowNumber}`).value;
    const wrap = document.getElementById(`qCollectorWrap_${rowNumber}`);
    if (wrap) wrap.style.display = (status === 'Yes') ? '' : 'none';
}
function recalcQuickAmount(rowNumber) {
    const rate = parseFloat(document.getElementById(`q_rate_${rowNumber}`).value) || 0;
    const capacity = parseFloat(document.getElementById(`q_capacity_${rowNumber}`).value) || 0;
    const amountEl = document.getElementById(`q_amount_${rowNumber}`);
    if (amountEl) amountEl.value = Math.round(rate * capacity);
}
function toggleCollectorField() {
    const status = document.getElementById('received').value;
    const collectorInput = document.getElementById('collectorName');
    if(status === 'No') collectorInput.value = '';
}

async function submitTrip(openBeeltyAfterSave = false) {
    const btn = document.getElementById('submitBtn');
    const beeltyBtn = document.getElementById('submitBeeltyBtn');
    const vNo = document.getElementById('vNo').value.toUpperCase().trim();
    const date = document.getElementById('date').value;

    if(!date || !vNo) {
        alert("Please fill Date and Vehicle Number!"); return;
    }
    const editRow = document.getElementById('tripEditRow').value;
    const isEdit = !!editRow;

    if (btn) btn.disabled = true;
    if (beeltyBtn) beeltyBtn.disabled = true;

    const payload = {
        action: "saveTrip",
        rowNumber: editRow || "",
        date: date,
        vNo: vNo,
        dNo: document.getElementById('dNo').value,
        ownerNo: document.getElementById('ownerNo').value,
        from: document.getElementById('from').value,
        to: document.getElementById('to').value,
        amount: document.getElementById('amount').value,
        received: document.getElementById('received').value,
        commissionAmt: document.getElementById('commissionAmt').value,
        collectorName: document.getElementById('collectorName').value,
        rate: document.getElementById('rate').value,
        capacity: document.getElementById('capacity').value,
        partyName: document.getElementById('partyName').value,
        material: document.getElementById('material').value,
        remark: document.getElementById('remark').value,
        pass: window.authPass
    };

    const targetRow = isEdit ? parseInt(editRow) : (window.allTripsData.length > 0 ? Math.max(...window.allTripsData.map(t=>t.rowNumber||0))+1 : 2);

    const newEntry = {
        rowNumber: targetRow,
        'Date': date,
        'Vehicle No': vNo,
        'Driver No': payload.dNo,
        '_owner': payload.ownerNo,
        'From': payload.from,
        'To': payload.to,
        'Amount': payload.amount,
        '_tripAmount': payload.amount,
        '_colG': payload.received,
        '_colK': payload.commissionAmt,
        'Commission Amount': payload.commissionAmt,
        '_colH': payload.collectorName,
        'Rate': payload.rate,
        'Capacity Ton': payload.capacity,
        'Party Name': payload.partyName,
        'Material': payload.material,
        'Remark': payload.remark
    };

    if (isEdit) {
        const idx = window.allTripsData.findIndex(t => t.rowNumber === parseInt(editRow));
        if (idx !== -1) window.allTripsData[idx] = newEntry;
    } else {
        window.allTripsData.unshift(newEntry);
    }
    setLocalTripsCache(window.allTripsData);

    fetch(scriptURL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) })
        .then(() => syncDataFromServer(false))
        .catch(err => console.error("Save error:", err));

    if (btn) btn.disabled = false;
    if (beeltyBtn) beeltyBtn.disabled = false;

    if (openBeeltyAfterSave) {
        transferTripToBeelty(newEntry);
    } else {
        alert(isEdit ? "✅ Trip Update Ho Gayi!" : "✅ Trip Saved Successfully!");
        resetTripWizard();
        showSection('view-trips');
    }
}

async function transferTripToBeelty(trip) {
    resetTripWizard();
    showSection('loading-slip');

    resetBeeltyForm();

    const vNo = (trip['Vehicle No'] || "").toUpperCase();
    document.getElementById('slip_vNo').value = vNo;
    document.getElementById('slip_date').value = formatDisplayDate(trip['Date']) || getTodayDateFormatted();
    document.getElementById('slip_party').value = (trip['Party Name'] || "").toUpperCase();
    document.getElementById('slip_from').value = (trip['From'] || "").toUpperCase();
    document.getElementById('slip_to').value = (trip['To'] || "").toUpperCase();
    document.getElementById('slip_rate').value = trip['Rate'] || 0;
    document.getElementById('slip_weight').value = trip['Capacity Ton'] || 0;
    document.getElementById('slip_oMob').value = (trip['_owner'] || "").toUpperCase();
    document.getElementById('slip_dMob').value = (trip['Driver No'] || "").toUpperCase();
    document.getElementById('slip_rowNum').value = trip.rowNumber || "";

    calculateSlip();
    await autoFillOwnerDriver(vNo);

    currentWizardStep = WIZARD_TOTAL_INPUT_STEPS + 1;
    renderWizardStep();
}

async function saveQuickUpdate(rowNumber) {
    if (!rowNumber) return;

    const val = (name) => {
        const el = document.getElementById(`${name}_${rowNumber}`);
        return el ? el.value : "";
    };

    const date = val('q_date');
    const vNo = val('q_vNo');
    const received = val('qStatus');
    const collectorName = val('qCollector').trim();

    const payload = {
        action: "saveTrip",
        rowNumber: rowNumber,
        date: date,
        vNo: vNo.toUpperCase(),
        dNo: val('q_dNo'),
        ownerNo: val('q_ownerNo'),
        from: val('q_from'),
        to: val('q_to'),
        amount: val('q_amount'),
        received: received,
        commissionAmt: val('qComm'),
        collectorName: received === 'Yes' ? collectorName : "",
        rate: val('q_rate'),
        capacity: val('q_capacity'),
        partyName: val('q_party'),
        material: val('q_material'),
        remark: val('q_remark'),
        pass: window.authPass
    };

    const idx = window.allTripsData.findIndex(t => t.rowNumber === rowNumber);
    if (idx !== -1) {
        window.allTripsData[idx] = {
            ...window.allTripsData[idx],
            'Date': date,
            'Vehicle No': vNo.toUpperCase(),
            'From': payload.from,
            'To': payload.to,
            'Amount': payload.amount,
            '_tripAmount': payload.amount,
            '_colG': received,
            '_colK': payload.commissionAmt,
            'Commission Amount': payload.commissionAmt,
            '_colH': payload.collectorName,
            'Rate': payload.rate,
            'Capacity Ton': payload.capacity,
            'Party Name': payload.partyName,
            'Material': payload.material,
            'Remark': payload.remark,
            'Driver No': payload.dNo,
            '_owner': payload.ownerNo
        };
        setLocalTripsCache(window.allTripsData);
        renderTripsList();
    }

    fetch(scriptURL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) })
        .then(() => syncDataFromServer(false));
}

async function deleteTripEntry(rowNumber) {
    if (!rowNumber || !confirm("Kya aap sach mein ye trip delete karna chahte hain?")) return;
    
    window.allTripsData = window.allTripsData.filter(t => t.rowNumber !== rowNumber);
    setLocalTripsCache(window.allTripsData);
    renderTripsList();

    fetch(scriptURL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: "deleteTrip", rowNumber, pass: window.authPass }) })
        .then(() => syncDataFromServer(false));
}

// ================= DAILY FOLLOW-UP =================
function loadDailyFollowup() {
    const container = document.getElementById('followupCardsContainer');
    if (!container) return;

    window._followupGroups = {};

    window.allTripsData.forEach(t => {
        const isCollected = (String(t['_colG'] || "").toLowerCase().trim() === "yes");
        if (isCollected) return;

        const amt = getTripCommission(t);
        if (amt <= 0) return;

        const driverPhone = String(t['Driver No'] || "").replace(/\D/g, '').slice(-10);
        const ownerPhone = String(t['_owner'] || "").replace(/\D/g, '').slice(-10);
        const phone = ownerPhone.length === 10 ? ownerPhone : (driverPhone.length === 10 ? driverPhone : "");
        if (!phone) return;

        const name = t['Lorry Owner Name'] || t['Driver Name'] || t['Vehicle No'];

        if (!window._followupGroups[phone]) {
            window._followupGroups[phone] = { 
                phone, name, 
                vehicles: new Set(), 
                totalAmt: 0, 
                oldestDate: null, 
                trips: [],
                commissionByVehicle: {}
            };
        }
        const g = window._followupGroups[phone];
        const numAmt = parseFloat(amt) || 0;
        g.totalAmt += numAmt;
        const vNo = t['Vehicle No'];
        g.vehicles.add(vNo);
        g.trips.push(t);
        
        if (!g.commissionByVehicle[vNo]) g.commissionByVehicle[vNo] = [];
        g.commissionByVehicle[vNo].push({ trip: t, amount: numAmt });

        const d = parseSheetDate(t['Date']);
        if (d && (!g.oldestDate || d < g.oldestDate)) g.oldestDate = d;
    });

    const list = Object.values(window._followupGroups).sort((a, b) => b.totalAmt - a.totalAmt);

    document.getElementById('followupCount').innerText = list.length;
    document.getElementById('followupTotal').innerText = '₹' + list.reduce((s, g) => s + g.totalAmt, 0).toLocaleString('en-IN');

    if (list.length === 0) {
        container.innerHTML = '<div class="text-center p-4 text-success">🎉 Koi bhi commission pending nahi hai!</div>';
        return;
    }

    const sentToday = getFollowupSentMap();
    container.innerHTML = '';

    list.forEach(g => {
        const days = g.oldestDate ? Math.floor((new Date() - g.oldestDate) / 86400000) : 0;
        const isSent = !!sentToday[g.phone];
        const vNoList = [...g.vehicles].join(', ');

        container.insertAdjacentHTML('beforeend', `
            <div class="v-list-item shadow-sm mb-3 p-3" style="background:white;border-radius:12px;border-left:5px solid ${isSent ? '#28a745' : '#dc3545'};">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <div class="fw-bold" style="color:#003366;">${safeAttr(g.name)}</div>
                        <small class="text-muted"><i class="bi bi-truck"></i> ${safeAttr(vNoList)}</small><br>
                        <small class="text-muted"><i class="bi bi-clock"></i> ${days} din se pending</small>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold text-danger">₹${g.totalAmt.toLocaleString('en-IN')}</div>
                        ${isSent ? '<span class="badge bg-success-subtle text-success mt-1" style="font-size:10px;">✅ Aaj bheja</span>' : ''}
                    </div>
                </div>
                <div class="d-flex gap-2 mt-2">
                    <button class="btn btn-sm btn-success flex-fill" onclick="sendFollowupWhatsapp('${g.phone}')">
                        <i class="bi bi-whatsapp"></i> Message
                    </button>
                    <a href="tel:+91${g.phone}" class="btn btn-sm btn-outline-primary flex-fill" onclick="markFollowupSent('${g.phone}')">
                        <i class="bi bi-telephone-fill"></i> Call
                    </a>
                </div>
            </div>
        `);
    });
}

function getFollowupSentMap() {
    const todayKey = new Date().toLocaleDateString('en-GB');
    try {
        const stored = JSON.parse(localStorage.getItem('ktc_followup_sent') || '{}');
        if (stored._date !== todayKey) return {};
        return stored;
    } catch (e) { return {}; }
}

function markFollowupSent(phone) {
    const todayKey = new Date().toLocaleDateString('en-GB');
    let stored;
    try { stored = JSON.parse(localStorage.getItem('ktc_followup_sent') || '{}'); } catch (e) { stored = {}; }
    if (stored._date !== todayKey) stored = { _date: todayKey };
    stored[phone] = true;
    localStorage.setItem('ktc_followup_sent', JSON.stringify(stored));
    loadDailyFollowup();
}

function sendFollowupWhatsapp(phone) {
    const g = window._followupGroups[phone];
    if (!g) return;

    const cleanPhone = formatWhatsAppPhone(phone);
    if (cleanPhone.length < 12) {
        alert("⚠️ Ye number sahi format mein nahi hai: " + phone);
        return;
    }

    let historyList = "";
    const vehicles = Object.keys(g.commissionByVehicle);
    
    if (vehicles.length > 1) {
        historyList += `📍 *COMMISSION BREAKDOWN (Multiple Vehicles):*\n\n`;
        vehicles.forEach(vNo => {
            const trips = g.commissionByVehicle[vNo];
            let vTotal = 0;
            let vDetails = "";
            trips.forEach(item => {
                const t = item.trip;
                const a = item.amount;
                vTotal += a;
                const dt = formatDisplayDate(t['Date']) || "No Date";
                const f = String(t['From'] || "N/A").replace(/&/g, "and");
                const rt = String(t['To'] || "N/A").replace(/&/g, "and");
                vDetails += `   • (${dt}) ${f} ➔ ${rt}: ₹${a.toLocaleString('en-IN')}\n`;
            });
            historyList += `🚗 *${vNo}*: ₹${vTotal.toLocaleString('en-IN')}\n${vDetails}\n`;
        });
    } else {
        const trips = g.commissionByVehicle[vehicles[0]] || [];
        historyList += `🚗 *${vehicles[0]}* - Pending Commissions:\n\n`;
        trips.forEach(item => {
            const t = item.trip;
            const a = item.amount;
            const dt = formatDisplayDate(t['Date']) || "No Date";
            const f = String(t['From'] || "N/A").replace(/&/g, "and");
            const rt = String(t['To'] || "N/A").replace(/&/g, "and");
            historyList += `▪️ (${dt}) ${f} ➔ ${rt}\n   💰 Commission: ₹${a.toLocaleString('en-IN')}\n\n`;
        });
    }

    const messageBody = `🏢 *KUNAL TRANSPORT COMPANY*
==========================
🔔 *COMMISSION PAYMENT REMINDER*

Namaste ${g.name},

Aapke naam par nimnlikhit COMMISSION PAYMENT abhi tak PENDING hai:

--------------------------
${historyList}--------------------------

🛑 *TOTAL PENDING COMMISSION: ₹${g.totalAmt.toLocaleString('en-IN')}*

💸 Commission bhej kar SS dein 🙏
📲 UPI: *9403691888*

_Kripya jald se jald clear karein. Dhanyawad!_`;

    const encodedMsg = encodeURIComponent(messageBody);
    const whatsappURL = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;

    markFollowupSent(phone);

    try { window.location.href = whatsappURL; } catch (e) { window.open(whatsappURL, '_blank'); }
}

async function shareTrip(phone, vNo, from, to, party, amt, date, material, weight, commissionAmt) {
    let cleanPhone = formatWhatsAppPhone(phone);
    let last10Digits = cleanPhone.slice(-10);

    if (cleanPhone.length < 12) {
        alert("⚠️ Ye number sahi format mein nahi hai: " + phone);
        return;
    }

    let currentComm = parseFloat(String(commissionAmt || "0").replace(/[^\d.]/g, '')) || 0;
    if (currentComm === 0) currentComm = parseFloat(String(amt || "0").replace(/[^\d.]/g, '')) || 0;

    const tripKey = tripKeyFor(vNo, date);
    const counts = getMsgSendCounts();
    const prevCount = counts[tripKey] || 0;
    let reminderTag = "";

    if (prevCount === 1) {
        if (!confirm(`⚠️ REMINDER\n\nVehicle ${vNo} ke liye pehle EK baar message bheja gaya hai. Dusra reminder bhejna hai?`)) return;
        reminderTag = `🔔 *REMINDER — 2nd MESSAGE*\nPichla message shaayad miss ho gaya, kripya jald commission bhej dein.\n\n`;
    } else if (prevCount >= 2) {
        if (!confirm(`🚨 STRONG REMINDER\n\nYe ${prevCount + 1}-va message hoga! Bhejna hai?`)) return;
        reminderTag = `🚨🔴 *URGENT — FINAL REMINDER (Message #${prevCount + 1})*\nYe ${prevCount} baar reminder bhejne ke baad ka message hai. Kripya TURANT commission clear karein.\n\n`;
    }

    let historyList = "";
    let oldPendingAmt = 0;
    let pendingTripsCount = 0;

    if (window.allTripsData && window.allTripsData.length > 0) {
        window.allTripsData.forEach(t => {
            let tPhoneD = String(t['Driver No'] || "").replace(/\D/g, '').slice(-10);
            let tPhoneO = String(t['_owner'] || "").replace(/\D/g, '').slice(-10);
            let isCollected = (String(t['_colG'] || "").toLowerCase().trim() === "yes");

            if ((tPhoneD === last10Digits || tPhoneO === last10Digits) && !isCollected) {
                if (!(t['Vehicle No'] === vNo && t['Date'] === date)) {
                    let v = String(t['Vehicle No']).replace(/&/g, "and");
                    let f = String(t['From'] || "N/A").replace(/&/g, "and");
                    let rt = String(t['To'] || "N/A").replace(/&/g, "and");
                    let commOld = getTripCommission(t);
                    let dt = formatDisplayDate(t['Date']) || "No Date";

                    historyList += `▪️ *${v}* (${dt})\n`;
                    historyList += `   📍 ${f} ➔ ${rt}\n`;
                    historyList += `   💰 Commission: ₹${commOld.toLocaleString('en-IN')}\n\n`;

                    oldPendingAmt += commOld;
                    pendingTripsCount++;
                }
            }
        });
    }

    let totalOutstanding = currentComm + oldPendingAmt;

    let messageBody = `🏢 *KUNAL TRANSPORT COMPANY*
_Raju Hiwale & Firoj Shaikh_
==========================
${reminderTag}📍 *CURRENT TRIP COMMISSION*
📅 Date: ${date}
🚚 Vehicle: *${vNo}*
🛣️ Route: ${from} To ${to}
💰 Commission: *₹${currentComm.toLocaleString('en-IN')}*

${pendingTripsCount > 0 ? `⚠️ *OLD PENDING COMMISSION TRIPS (${pendingTripsCount})*
--------------------------
${historyList}--------------------------` : ''}

📊 *COMMISSION SUMMARY*
Old Balance: ₹${oldPendingAmt.toLocaleString('en-IN')}
Current Commission: ₹${currentComm.toLocaleString('en-IN')}
━━━━━━━━━━━━━━━━━━
🛑 *TOTAL PAYABLE COMMISSION: ₹${totalOutstanding.toLocaleString('en-IN')}*
━━━━━━━━━━━━━━━━━━

💸 *PAYMENT INSTRUCTIONS*
Commission bhej kar SS dein 🙏
📲 UPI: *9403691888*

_Thank you for choosing Kunal Transport Company!_`;

    let encodedMsg = encodeURIComponent(messageBody);
    let whatsappURL = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;

    localStorage.setItem('ktc_last_shared_trip', tripKey);
    counts[tripKey] = prevCount + 1;
    saveMsgSendCounts(counts);

    try { window.location.href = whatsappURL; } catch (e) { window.open(whatsappURL, '_blank'); }
}

// ================= LOADING SLIP (BEELTY) LOGIC =================
let currentWizardStep = 1;
const WIZARD_TOTAL_INPUT_STEPS = 5;
const WIZARD_TITLES = ["Vehicle & Date", "Party Details", "Route & Owner", "Driver Details", "Finance & Total"];

function initWizard() {
    const receipt = document.getElementById('receipt-to-print');
    if (!receipt) return;
    receipt.classList.add('wizard-mode');
    document.getElementById('wizardNavBar').style.display = 'block';
    currentWizardStep = 1;
    renderWizardStep();
}

function renderWizardStep() {
    const allSteps = document.querySelectorAll('[data-wizard-step]');
    allSteps.forEach(el => el.classList.remove('wizard-active'));

    const isReview = currentWizardStep > WIZARD_TOTAL_INPUT_STEPS;
    const navBar = document.getElementById('wizardNavBar');

    if (isReview) {
        allSteps.forEach(el => el.classList.add('wizard-active'));
        document.getElementById('receipt-to-print').classList.remove('wizard-mode');
        if (navBar) {
            navBar.classList.add('review-mode');
            document.getElementById('wizardStepLabel').style.display = 'none';
        }
    } else {
        if (navBar) {
            navBar.style.display = 'block';
            navBar.classList.remove('review-mode');
            document.getElementById('wizardStepLabel').style.display = 'block';
        }
        document.getElementById('receipt-to-print').classList.add('wizard-mode');
        document.querySelectorAll(`[data-wizard-step="${currentWizardStep}"]`).forEach(el => el.classList.add('wizard-active'));
        document.getElementById('wizardStepLabel').innerText = `Step ${currentWizardStep} of ${WIZARD_TOTAL_INPUT_STEPS}: ${WIZARD_TITLES[currentWizardStep - 1]}`;
    }

    document.getElementById('wizardBackBtn').disabled = (currentWizardStep === 1);
    document.getElementById('wizardNextBtn').style.display = isReview ? 'none' : 'block';
    document.getElementById('wizardNextBtn').innerText = (currentWizardStep === WIZARD_TOTAL_INPUT_STEPS) ? 'Preview ➜' : 'Next ➜';
    document.getElementById('slipSubmitBtn').style.display = isReview ? 'block' : 'none';
    document.getElementById('receipt-to-print').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wizardNext() { if (currentWizardStep <= WIZARD_TOTAL_INPUT_STEPS + 1) { currentWizardStep++; renderWizardStep(); } }
function wizardBack() { if (currentWizardStep > 1) { currentWizardStep--; renderWizardStep(); } }

function calculateSlip() {
    let rate = parseFloat(document.getElementById('slip_rate').value) || 0;
    let weight = parseFloat(document.getElementById('slip_weight').value) || 0;
    let overWeight = parseFloat(document.getElementById('slip_overWeight')?.value || 0) || 0;
    let overRateInput = parseFloat(document.getElementById('slip_overRate')?.value || 0) || 0;
    let effectiveOverRate = overRateInput > 0 ? overRateInput : rate;

    let freight_total = Math.round(weight * rate);
    if(rate > 0 && weight > 0) document.getElementById('slip_freight').value = freight_total;
    if(effectiveOverRate > 0 && overWeight > 0) document.getElementById('slip_overCharge').value = Math.round(overWeight * effectiveOverRate);
    updateFinalNetPayable();
}

function calculateTotalFromManual() { updateFinalNetPayable(); }
function updateFinalNetPayable() {
    let freight = parseFloat(document.getElementById('slip_freight').value) || 0;
    let overCharge = parseFloat(document.getElementById('slip_overCharge').value) || 0;
    let adv = parseFloat(document.getElementById('slip_advance').value) || 0;
    let dPrice = parseFloat(document.getElementById('slip_dPrice').value) || 0;
    document.getElementById('slip_toPay').value = Math.round((freight + overCharge - adv) + dPrice);
}

function loadVehicleListForSlip() {
    const list = document.getElementById('vehicleListOptions');
    if (!list) return;
    const vehicles = [...new Set(window.allTripsData.map(t => String(t['Vehicle No']||'').trim().toUpperCase()))].filter(v => v !== "");
    list.innerHTML = vehicles.map(v => `<option value="${v}">`).join('');
}

function searchVehicleForSlip() {
    const vNo = document.getElementById('slipSearchVNo').value.toUpperCase().trim();
    if(!vNo) return alert("Please enter a Vehicle Number!");
    
    const selectionArea = document.getElementById('tripSelectionArea');
    const newVAlert = document.getElementById('newVehicleAlert');
    selectionArea.classList.add('hidden');
    newVAlert.classList.add('hidden');

    window.currentVehicleTrips = window.allTripsData.filter(t => String(t['Vehicle No']).trim().toUpperCase() === vNo);
    
    if(!window.currentVehicleTrips || window.currentVehicleTrips.length === 0) {
        newVAlert.classList.remove('hidden');
        clearSlipForNewEntry(vNo);
    } else {
        const dropdown = document.getElementById('tripSelectDropdown');
        dropdown.innerHTML = window.currentVehicleTrips.map((t, i) => 
            `<option value="${i}">${formatDisplayDate(t['Date'])} | ${t['From']} to ${t['To']}</option>`
        ).join('');
        selectionArea.classList.remove('hidden');
        fillSlipFromSelection();
        autoFillOwnerDriver(vNo);
    }
}

function fillSlipFromSelection() {
    const idx = document.getElementById('tripSelectDropdown').value;
    const trip = window.currentVehicleTrips[idx];
    if(!trip) return;

    document.getElementById('slip_vNo').value = (trip['Vehicle No'] || "").toUpperCase();
    document.getElementById('slip_date').value = formatDisplayDate(trip['Date']) || getTodayDateFormatted();
    document.getElementById('slip_party').value = (trip['Party Name'] || "").toUpperCase();
    document.getElementById('slip_from').value = (trip['From'] || "").toUpperCase();
    document.getElementById('slip_to').value = (trip['To'] || "").toUpperCase();
    document.getElementById('slip_rate').value = trip['Rate'] || 0;
    document.getElementById('slip_weight').value = (trip['Capacity Ton'] || 0);
    document.getElementById('slip_lOwner').value = (trip['_owner'] || "").toUpperCase();
    document.getElementById('slip_dMob').value = (trip['Driver No'] || "").toUpperCase();
    document.getElementById('slip_rowNum').value = trip.rowNumber;

    calculateSlip(); 
}

function resetBeeltyForm() {
    document.getElementById('slipSearchVNo').value = "";
    document.getElementById('tripSelectionArea').classList.add('hidden');
    document.getElementById('newVehicleAlert').classList.add('hidden');
    
    const slipInputs = [
        'slip_vNo', 'slip_party', 'slip_from', 'slip_to',
        'slip_rate', 'slip_weight', 'slip_overWeight', 'slip_overRate', 'slip_overCharge', 'slip_advance', 'slip_dPrice',
        'slip_lOwner', 'slip_oVillage', 'slip_oMob', 'slip_dName', 'slip_dVillage', 'slip_dMob', 
        'slip_licence', 'slip_toPay', 'slip_rowNum', 'slip_archiveRow'
    ];
    
    slipInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = (id.includes('rate') || id.includes('weight') || id.includes('Weight') || id.includes('Charge') || id.includes('advance') || id.includes('Price') || id.includes('Pay')) ? 0 : "";
    });

    document.getElementById('slip_date').value = getTodayDateFormatted();
    initWizard();
}

function clearSlipForNewEntry(vNo) {
    document.getElementById('slip_vNo').value = vNo;
    document.getElementById('slip_date').value = getTodayDateFormatted();
    document.getElementById('slip_party').value = "";
    document.getElementById('slip_from').value = "";
    document.getElementById('slip_to').value = "";
    document.getElementById('slip_rate').value = 0;
    document.getElementById('slip_weight').value = 0;
    document.getElementById('slip_advance').value = 0;
    document.getElementById('slip_dPrice').value = 0;
    document.getElementById('slip_lOwner').value = "";
    document.getElementById('slip_oMob').value = "";
    document.getElementById('slip_dName').value = "";
    document.getElementById('slip_dMob').value = "";
    document.getElementById('slip_licence').value = "";
    document.getElementById('slip_rowNum').value = "";
    calculateSlip();
    autoFillOwnerDriver(vNo);
}

async function autoFillOwnerDriver(vNo) {
    vNo = (vNo || "").toUpperCase().trim();
    if (!vNo) return;
    try {
        const res = await fetch(apiUrl(`?action=getVehicleProfile&vNo=${encodeURIComponent(vNo)}`));
        const profile = await res.json();
        if (!profile || Object.keys(profile).length === 0) return;

        if (profile.lOwner) document.getElementById('slip_lOwner').value = profile.lOwner;
        if (profile.oVillage) document.getElementById('slip_oVillage').value = profile.oVillage;
        if (profile.oMob) document.getElementById('slip_oMob').value = profile.oMob;
        if (profile.dName) document.getElementById('slip_dName').value = profile.dName;
        if (profile.dVillage) document.getElementById('slip_dVillage').value = profile.dVillage;
        if (profile.dMob) document.getElementById('slip_dMob').value = profile.dMob;
        if (profile.licence) document.getElementById('slip_licence').value = profile.licence;
    } catch (e) {}
}

function editSavedSlip(rowNumber) {
    const slip = window.currentSlipHistory.find(s => s.rowNumber === rowNumber);
    if (!slip || !slip.formData) {
        alert("Ye slip purani hai — isme edit ke liye zaroori data save nahi hai.");
        return;
    }

    let d;
    try { d = JSON.parse(slip.formData); } catch (e) {
        alert("Data padhne mein error aayi.");
        return;
    }

    showSection('loading-slip');

    document.getElementById('slip_vNo').value = d.vNo || "";
    document.getElementById('slip_date').value = d.date || getTodayDateFormatted();
    document.getElementById('slip_party').value = d.partyName || "";
    document.getElementById('slip_from').value = d.from || "";
    document.getElementById('slip_to').value = d.to || "";
    document.getElementById('slip_rate').value = d.rate || 0;
    document.getElementById('slip_weight').value = d.weight || 0;
    document.getElementById('slip_overWeight').value = d.overWeight || 0;
    document.getElementById('slip_overRate').value = d.overRate || 0;
    document.getElementById('slip_overCharge').value = d.overCharge || 0;
    document.getElementById('slip_advance').value = d.advance || 0;
    document.getElementById('slip_dPrice').value = d.driverPrice || 0;
    document.getElementById('slip_lOwner').value = d.lorryOwner || "";
    document.getElementById('slip_oVillage').value = d.ownerVillage || "";
    document.getElementById('slip_oMob').value = d.ownerMob || "";
    document.getElementById('slip_dName').value = d.driverName || "";
    document.getElementById('slip_dVillage').value = d.driverVillage || "";
    document.getElementById('slip_dMob').value = d.driverMob || "";
    document.getElementById('slip_licence').value = d.licenceNo || "";
    document.getElementById('slip_rowNum').value = d.rowNumber || "";
    document.getElementById('slip_archiveRow').value = rowNumber;

    calculateSlip();
    currentWizardStep = WIZARD_TOTAL_INPUT_STEPS + 1;
    renderWizardStep();
}

// --- PERFECT BEELTY PDF GENERATION & INSTANT TAB SYNC ---
async function generateBeeltyPDF() {
    const btn = document.getElementById('slipSubmitBtn');
    const originalElement = document.getElementById('receipt-to-print');
    const vNo = (document.getElementById('slip_vNo').value || "N/A").toUpperCase().trim();

    if (!vNo || vNo === "N/A") return alert("Data select karein!");

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating PDF & Saving to Drive...';

    const allInputs = originalElement.querySelectorAll('input');
    allInputs.forEach(input => {
        if (input.type !== 'number' && input.type !== 'date') {
            input.value = (input.value || "").toUpperCase();
        }
        input.setAttribute('value', input.value);
    });

    const clone = originalElement.cloneNode(true);
    clone.querySelectorAll('#wizardNavBar, .wizard-nav-bar, .slip-action-bar, button').forEach(el => el.remove());
    clone.classList.remove('wizard-mode');
    clone.querySelectorAll('[data-wizard-step]').forEach(el => {
        el.classList.add('wizard-active');
        el.style.display = 'block';
    });

    const wrapper = document.createElement('div');
    wrapper.id = 'pdf-render-wrapper';
    wrapper.style.cssText = 'position: absolute; left: 0; top: 0; width: 794px; background: #fffdf9; z-index: 999999; margin: 0; padding: 0;';
    clone.style.cssText = 'width: 794px; height: auto; min-height: 0; background: #fffdf9; margin: 0 auto; transform: none; box-shadow: none; border: 3px double #002347; outline: 1.5px solid #d4af37; outline-offset: -7px; border-radius: 4px; padding: 24px 30px; display: flex; flex-direction: column; justify-content: flex-start; box-sizing: border-box;';
    
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    window.scrollTo(0, 0);

    const opt = {
        margin: [0, 0, 0, 0],
        filename: `Slip_${vNo}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            scrollX: 0,
            scrollY: 0,
            x: 0,
            y: 0,
            width: 794,
            windowWidth: 794,
            logging: false
        }
    };

    try {
        const worker = html2pdf().set(opt).from(clone).toCanvas();
        const canvas = await worker.get('canvas');
        const pdfWidthMM = 210;
        const pdfHeightMM = (canvas.height * pdfWidthMM) / canvas.width;

        const pdf = await worker
            .set({ jsPDF: { unit: 'mm', format: [pdfWidthMM, pdfHeightMM], orientation: 'portrait' } })
            .toPdf()
            .get('pdf');

        const pdfBlob = pdf.output('blob');
        const pdfBase64 = pdf.output('datauristring').split(',')[1];

        // 1. Device me PDF download
        pdf.save(opt.filename);

        const slipDateVal = document.getElementById('slip_date').value || getTodayDateFormatted();
        const editArchiveRow = document.getElementById('slip_archiveRow').value;
        const isEditSlip = !!editArchiveRow;

        const payload = {
            action: "saveLoadingSlip",
            rowNumber: document.getElementById('slip_rowNum').value,
            archiveRow: editArchiveRow || "",
            vNo: vNo,
            date: slipDateVal,
            pdfBase64: pdfBase64,
            partyName: document.getElementById('slip_party').value.toUpperCase(),
            from: document.getElementById('slip_from').value.toUpperCase(),
            to: document.getElementById('slip_to').value.toUpperCase(),
            rate: document.getElementById('slip_rate').value,
            weight: document.getElementById('slip_weight').value,
            overWeight: document.getElementById('slip_overWeight')?.value || 0,
            overRate: document.getElementById('slip_overRate')?.value || 0,
            overCharge: document.getElementById('slip_overCharge')?.value || 0,
            advance: document.getElementById('slip_advance').value,
            driverPrice: document.getElementById('slip_dPrice').value,
            toPay: document.getElementById('slip_toPay').value,
            lorryOwner: document.getElementById('slip_lOwner').value.toUpperCase(),
            ownerVillage: document.getElementById('slip_oVillage').value.toUpperCase(),
            ownerMob: document.getElementById('slip_oMob').value.toUpperCase(),
            driverName: document.getElementById('slip_dName').value.toUpperCase(),
            driverVillage: document.getElementById('slip_dVillage').value.toUpperCase(),
            driverMob: document.getElementById('slip_dMob').value.toUpperCase(),
            licenceNo: document.getElementById('slip_licence').value.toUpperCase(),
            pass: window.authPass || localStorage.getItem('ktc_pass') || "1234"
        };

        // 2. Google Sheet & Drive me Save karein (No silent failure)
        const response = await fetch(scriptURL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload) 
        });

        const resData = await response.json();

        if (resData && resData.success) {
            const targetRow = isEditSlip ? parseInt(editArchiveRow) : (window.currentSlipHistory.length > 0 ? Math.max(...window.currentSlipHistory.map(s=>s.rowNumber||0))+1 : 2);
            
            const newSlipEntry = {
                rowNumber: targetRow,
                name: `Slip_${vNo}_${slipDateVal.replace(/\//g, '-')}.pdf`,
                id: resData.fileId || "",
                date: slipDateVal,
                url: resData.fileUrl || "#",
                formData: JSON.stringify(payload)
            };

            if (isEditSlip) {
                const idx = window.currentSlipHistory.findIndex(s => s.rowNumber === parseInt(editArchiveRow));
                if (idx !== -1) window.currentSlipHistory[idx] = newSlipEntry;
            } else {
                window.currentSlipHistory.unshift(newSlipEntry);
            }
            setLocalSlipsCache(window.currentSlipHistory);

            alert("✅ Loading Slip Saved to Google Sheet & Drive Successfully!");
            resetBeeltyForm();
            showSection('slip-history');
        } else {
            alert("❌ Server Save Error: " + (resData.error || "Could not save to Google Drive"));
        }

    } catch (e) {
        console.error("PDF generation error:", e);
        alert("PDF Error: " + e.message);
    } finally {
        if (wrapper && wrapper.parentNode) {
            document.body.removeChild(wrapper);
        }
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-2"></i> FINALIZE, SAVE & WHATSAPP';
    }
}

// ================= DRIVE FILE SHARE =================
async function shareFileFromDrive(fileId, fileName) {
    const originalBtn = event.currentTarget;
    const originalHtml = originalBtn ? originalBtn.innerHTML : '';
    if (originalBtn) {
        originalBtn.disabled = true;
        originalBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }

    try {
        const response = await fetch(apiUrl(`?action=getFileContent&fileId=${fileId}`));
        const base64Data = await response.text();
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const file = new File([blob], `${fileName}.pdf`, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'KTC Loading Slip', text: 'Vehicle: ' + fileName });
        } else {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${fileName}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            alert("File download ho gayi hai!");
        }
    } catch (err) {
        alert("File load nahi ho saki.");
    } finally {
        if (originalBtn) {
            originalBtn.disabled = false;
            originalBtn.innerHTML = originalHtml;
        }
    }
}

// ================= VEHICLE NUMBER AUTO-FORMATTER =================
function formatIndianVehicleNumber(val) {
    let cleanStr = val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    let res = "";
    if (cleanStr.length > 0) res += cleanStr.substring(0, 2); 
    if (cleanStr.length > 2) res += " " + cleanStr.substring(2, 4); 
    if (cleanStr.length > 4) {
        let remaining = cleanStr.substring(4);
        let letters = remaining.match(/^[A-Z]+/);
        if (letters) {
            res += " " + letters[0];
            let numbers = remaining.substring(letters[0].length);
            if (numbers) res += " " + numbers.substring(0, 4);
        } else {
            res += " " + remaining.substring(0, 4);
        }
    }
    return res;
}

document.addEventListener('input', function(e) {
    const vNoFields = ['vNo', 'slipSearchVNo', 'slip_vNo', 'vSearch'];
    if (vNoFields.includes(e.target.id)) {
        e.target.value = formatIndianVehicleNumber(e.target.value);
    }
});