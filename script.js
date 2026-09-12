let allTripsData = []; // Saara data store karne ke liye
let transport_name = localStorage.getItem('ktc_name') || "Transport Company";

// SECURITY: The Apps Script backend now requires a login-issued token on every request
// (see code.gs — isAuthorized()). Without this, anyone who has the /exec URL could call the
// API directly (curl/Postman) and read all trip, party, and vehicle data even without logging
// in through this page, since the old "login screen" only hid the UI on the client and never
// checked anything on the server. This token is issued by the server at login and must be sent
// with every request from here on.
let authToken = localStorage.getItem('ktc_token') || "";

// Builds a scriptURL with the auth token attached. Pass a query string starting with "?" (or
// nothing) — e.g. apiUrl("?action=getVehicles").
function apiUrl(query) {
    const q = query || '';
    const sep = q.includes('?') ? '&' : '?';
    return scriptURL + q + sep + 'token=' + encodeURIComponent(authToken);
}

// ⚠️ EDIT KAREIN: Statement PDFs ke footer mein yehi company naam/address print hoga.
// Yahan apna sahi naam aur pura address daal dein.
const COMPANY_NAME = "KUNAL TRANSPORT COMPANY";
const COMPANY_ADDRESS = "Lasur Station, Vaijapur Highway, Tq. Gangapur, Dist. Chh. Sambhajinagar";

// Jab bhi statement PDF banayein, ye ek simple full-screen "Generating PDF..." overlay dikhata hai
// taaki neeche wala real (non-hacky) content element user ko flash na ho. Yehi wajah thi ki
// off-screen (position:fixed/-9999px) trick se PDF blank aa raha tha — html2canvas ko element
// normal document-flow mein chahiye, jaisa purana Loading Slip (#receipt-to-print) system karta hai.
function showPdfGeneratingOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'pdfGenOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#ffffff;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;font-family:Arial,sans-serif;color:#003366;';
    overlay.innerHTML = '<div class="spinner-border text-danger mb-2"></div><div>PDF Generate ho raha hai...</div>';
    document.body.appendChild(overlay);
    return overlay;
}
function hidePdfGeneratingOverlay(overlay) {
    if (overlay && overlay.parentNode) document.body.removeChild(overlay);
}

// html2pdf se PDF banane ke baad, HAR page ke neeche Company Name + Address wala footer print karta hai,
// aur page number bhi. Ye seedhe jsPDF instance par kaam karta hai (html2pdf isi ka wrapper hai),
// isliye export (download) aur share (blob) dono isi ek function ko reuse karte hain.
async function generateStatementPdf(container, opt) {
    const worker = html2pdf().set(opt).from(container).toPdf();
    const pdf = await worker.get('pdf');
    const pageCount = pdf.internal.getNumberOfPages();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(120, 120, 120);
        pdf.text(`${COMPANY_NAME} | ${COMPANY_ADDRESS}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
        pdf.text(`Page ${i} / ${pageCount}`, pageWidth - 8, pageHeight - 6, { align: 'right' });
    }
    return pdf;
}

// PDF ko pehle device mein SAVE/DOWNLOAD karta hai, aur uske baad WhatsApp/share menu bhi khol deta hai —
// taaki statement hamesha phone mein bhi rahe aur turant kisi ko bhej bhi saken.
async function sharePdfOrDownload(blob, filename) {
    // 1. Pehle PDF download karo (device mein save)
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // 2. Fir WhatsApp (ya jo bhi share sheet available ho) khol do
    try {
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            return;
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return; // User ne share cancel kar diya, download to ho hi chuka hai
    }
    alert("PDF download ho gayi hai. Is device par direct share menu available nahi tha — WhatsApp kholkar ye PDF file manually attach kar dein.");
}

// --- LOCAL DATABASE SETUP (IndexedDB) ---
let db;
const request = indexedDB.open("KTC_Slips_DB", 1);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    db.createObjectStore("slips", { keyPath: "id", autoIncrement: true });
};
request.onsuccess = (e) => { db = e.target.result; };

// Function: PDF ko local storage mein save karna
function saveSlipLocally(vNo, date, blob) {
    const transaction = db.transaction(["slips"], "readwrite");
    const store = transaction.objectStore("slips");
    store.add({ vNo, date, pdfBlob: blob, timestamp: new Date() });
}
// Check if already logged in (Refresh par baar baar lock na dikhe - Optional)
// Agar aap chahte hain ki har baar app khulte hi lock dikhe, toh localStorage mat use karein
function checkLoginStatus() {
    const lockScreen = document.getElementById('lock-screen');
    if (localStorage.getItem('ktc_unlocked') === 'true' && authToken) {
        lockScreen.classList.add('lock-hidden');
    }
}

// PIN Verification
// (transport_name is already declared once at the top of this file — redeclaring it with
// "let" here used to throw "Identifier 'transport_name' has already been declared", which is a
// parse-time SyntaxError. That single error stopped script.js from loading at all, which is why
// NOTHING in the app worked — no login, no buttons, nothing. Removed the duplicate declaration.)

// Login Function
async function handleLogin() {
    const user = document.getElementById('loginUser').value;
    const pass = document.getElementById('loginPass').value;
    const btn = document.getElementById('loginBtn');
    const errorMsg = document.getElementById('lock-error');

    if(!user || !pass) { alert("Dono field bharein!"); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Verifying...';

    try {
        const res = await fetch(scriptURL, {
            method: 'POST',
            body: JSON.stringify({ action: "login", user, pass })
        });
        const data = await res.json();

        if (data.success) {
            // Data Save Karein
            authToken = data.token || "";
            localStorage.setItem('ktc_unlocked', 'true');
            localStorage.setItem('ktc_name', data.transportName);
            localStorage.setItem('ktc_token', authToken);
            transport_name = data.transportName;
            
            // UI Update Karein
            applyBranding();
            
            document.getElementById('lock-screen').classList.add('lock-hidden');
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

// Poori App mein naam update karne ka function
function applyBranding() {
    const name = localStorage.getItem('ktc_name') || "Transport Company";
    
    // 1. Title bar mein
    const brandEl = document.querySelector('.navbar-brand');
    if(brandEl) brandEl.innerText = name.toUpperCase();

    // 2. Home Screen par
    const homeTitle = document.querySelector('#home-section h3');
    if(homeTitle) homeTitle.innerText = name;

    // 3. Beelty (Loading Slip) par
    const beeltyTitle = document.querySelector('.c-company-title');
    if(beeltyTitle) beeltyTitle.innerText = name.toUpperCase();

    // 4. Constants update karein (For PDF/WhatsApp)
    window.COMPANY_NAME = name;
}

// Window load par branding apply karein
window.addEventListener('DOMContentLoaded', () => {
    if(localStorage.getItem('ktc_unlocked') === 'true') {
        document.getElementById('lock-screen').classList.add('lock-hidden');
        applyBranding();
    }
});

// Sidebar se Logout karne ka option (Optional)
// Sidebar / Navbar se Logout karne ka function
function logout() {
    if (confirm("Kya aap sach mein Logout karna chahte hain?")) {
        // Saare saved session aur keys delete karo
        localStorage.removeItem('ktc_unlocked');
        localStorage.removeItem('ktc_token');
        localStorage.removeItem('ktc_name');
        authToken = "";
        
        // Input fields ko reset karo
        const userInp = document.getElementById('loginUser');
        const passInp = document.getElementById('loginPass');
        if (userInp) userInp.value = "";
        if (passInp) passInp.value = "";
        
        // Lock screen wapas dikhao aur app reload karo
        const lockScreen = document.getElementById('lock-screen');
        if (lockScreen) lockScreen.classList.remove('lock-hidden');
        
        location.reload();
    }
}
// IS LINE KO SAHI SE CHECK KAREIN - Sirf URL hona chahiye
// ⚠️ IMPORTANT: Naya Google Apps Script Web App deploy karne ke baad, uska "/exec" URL yahan paste karein.
// (Extensions > Apps Script > Deploy > New deployment > Web app > Execute as: Me, Access: Anyone > Deploy)
const scriptURL = 'https://script.google.com/macros/s/AKfycbwmWgPL-HGldLbJE-1obiL6QD_EilUM8pIe3rTl3TXXQBII-R8wVHarMUAnG2a0J7SJ/exec';

window.onload = () => {
    checkLoginStatus();
    updateGreeting();
    loadHomeRecent();
    // Background mein saara data pehle hi kheench lo taaki history turant dikhe
    fetch(apiUrl())
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (data.error) {
                console.error("Backend error:", data.error);
                return;
            }
            if (Array.isArray(data)) {
                allTripsData = data;
                populateTripSuggestions(data);
            } else {
                console.error("Invalid data format, expected array:", data);
            }
        })
        .catch(e => console.error("📊 Background data load error:", e.message));

    setInterval(() => {
        const timeEl = document.getElementById('homeTime');
        if(timeEl) timeEl.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, 60000);
};

// Live typing convert to Capital Letters for Beelty slip inputs
document.addEventListener('input', function (e) {
    if (e.target && e.target.closest('#receipt-to-print')) {
        if (e.target.tagName === 'INPUT' && e.target.type !== 'number' && e.target.type !== 'date') {
            let start = e.target.selectionStart;
            let end = e.target.selectionEnd;
            e.target.value = e.target.value.toUpperCase();
            if (start !== null && end !== null) {
                e.target.setSelectionRange(start, end);
            }
        }
    }
});

function updateGreeting() {
    let hrs = new Date().getHours();
    let greet = "Good Morning,";
    if (hrs >= 12 && hrs <= 17) greet = "Good Afternoon,";
    else if (hrs >= 17 && hrs <= 24) greet = "Good Evening,";
    const gElement = document.getElementById('greetingText');
    if(gElement) gElement.innerText = greet;
}

// --- SECTION SWITCHER ---
function showSection(id) {
    document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(id + '-section');
    if(target) target.classList.remove('hidden');
    
    if(id === 'view-trips') loadTrips();
    if(id === 'accounts') updateAccounts();
    if(id === 'home') loadHomeRecent();
    if(id === 'vehicles') loadVehicles(); 
    if(id === 'daily-followup') loadDailyFollowup();
    
    // --- YE DO LINES ZAROORI HAIN ---
    if(id === 'loading-slip') { loadVehicleListForSlip(); initWizard(); }
    if(id === 'slip-history') loadSlipHistory(); // Ye missing tha
    if(id === 'new-trip' && !document.getElementById('tripEditRow').value) { resetTripWizard(); }
    if(id === 'new-trip') {
        // Agar background fetch abhi tak complete nahi hua, to yahan se bhi try kar lein
        // taaki suggestions form khulte hi ready mile.
        if (allTripsData && allTripsData.length) {
            populateTripSuggestions(allTripsData);
        } else {
            fetch(apiUrl())
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.json();
                })
                .then(data => {
                    if (data.error) {
                        console.error("Backend error:", data.error);
                        return;
                    }
                    if (Array.isArray(data)) {
                        allTripsData = data;
                        populateTripSuggestions(data);
                    }
                })
                .catch(e => console.error("❌ Suggestion load error:", e.message));
        }
    }

    const sidebar = document.getElementById('sidebar');
    const instance = bootstrap.Offcanvas.getInstance(sidebar);
    if(instance) instance.hide();
}

// --- TRIP ENTRY WIZARD (Simple 4-Step Smart Form) ---
const TRIP_TOTAL_STEPS = 4;
let tripCurrentStep = 1;
const TRIP_STEP_TITLES = {
    1: "Vehicle & Date",
    2: "Route & Party",
    3: "Rate & Payment",
    4: "Driver & Remark"
};

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

    backBtn.classList.toggle('hidden', tripCurrentStep === 1);

    if (tripCurrentStep === TRIP_TOTAL_STEPS) {
        nextBtn.classList.add('hidden');
        submitBtn.classList.remove('hidden');
        renderTripReview();
    } else {
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');
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
        <div class="d-flex justify-content-between"><span>Amount:</span><b>₹${v('amount') || '0'}</b></div>
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

function tripWizardNext() {
    if (!tripStepIsValid(tripCurrentStep)) return;
    if (tripCurrentStep < TRIP_TOTAL_STEPS) { tripCurrentStep++; renderTripStep(); }
}
function tripWizardBack() {
    if (tripCurrentStep > 1) { tripCurrentStep--; renderTripStep(); }
}

// --- NEW TRIP FORM: PURANE DATA SE SUGGESTIONS (Datalist Autocomplete) ---
// Har field ke liye purani entries se unique values nikaal ke datalist mein daal deta hai,
// taaki baar baar wahi Vehicle No, Party, Material, Driver/Owner No, Rate, Collector Name
// type na karna pade — sirf list se select kar sakein ya type karte hi suggestion aa jaaye.
function populateTripSuggestions(data) {
    if (!data || !Array.isArray(data)) return;

    const fieldMap = {
        'dl-vNo': 'Vehicle No',
        'dl-from': 'From',
        'dl-to': 'To',
        'dl-partyName': 'Party Name',
        'dl-material': 'Material',
        'dl-rate': 'Rate',
        'dl-capacity': 'Capacity Ton',
        'dl-dNo': 'Driver No',
        'dl-ownerNo': '_owner',
        'dl-collectorName': '_colH'
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

function resetTripWizard() {
    document.getElementById('tripForm').reset();
    
    if (document.getElementById('tripEditRow')) document.getElementById('tripEditRow').value = "";
    if (document.getElementById('tripFormTitle')) document.getElementById('tripFormTitle').innerText = "New Trip Entry";
    if (document.getElementById('submitBtnText')) document.getElementById('submitBtnText').innerText = "SAVE TRIP";
    if (document.getElementById('tripCancelEditBtn')) document.getElementById('tripCancelEditBtn').classList.add('hidden');
    
    // Naye fields ko bhi manually clear kar lein safety ke liye
    if (document.getElementById('commissionAmt')) document.getElementById('commissionAmt').value = "";
    if (document.getElementById('collectorName')) document.getElementById('collectorName').value = "";
    if (document.getElementById('ownerNo')) document.getElementById('ownerNo').value = "";

    tripCurrentStep = 1;
    renderTripStep();
}

// Trip card ke "Edit" button se call hota hai — poora record form mein bharke wizard step 1 par le jaata hai
async function startTripEdit(rowNumber) {
    if (!rowNumber) { alert("⚠️ Ye entry edit nahi ho sakti (row number missing)."); return; }
    const trip = allTripsData.find(t => t.rowNumber === rowNumber);
    if (!trip) { alert("Entry nahi mili. Refresh karke dobara try karein."); return; }

    showSection('new-trip');

    document.getElementById('tripEditRow').value = rowNumber;
    document.getElementById('vNo').value = trip['Vehicle No'] || "";
    document.getElementById('date').value = toDateInputValue(trip['Date']);
    document.getElementById('from').value = trip['From'] || "";
    document.getElementById('to').value = trip['To'] || "";
    document.getElementById('partyName').value = trip['Party Name'] || "";
    document.getElementById('material').value = trip['Material'] || "";
    document.getElementById('rate').value = trip['Rate'] || "";
    document.getElementById('capacity').value = trip['Capacity Ton'] || "";
    document.getElementById('received').value = (String(trip['_colG'] || "").toLowerCase().trim() === "yes") ? "Yes" : "No";
    document.getElementById('commissionAmt').value = trip['_colK'] || trip['Commission Amount'] || "";
    document.getElementById('collectorName').value = trip['_colH'] || trip['Collector Name'] || "";
    document.getElementById('dNo').value = trip['Driver No'] || "";
    document.getElementById('ownerNo').value = trip['_owner'] || "";
    document.getElementById('remark').value = trip['Remark'] || "";
    calculateTotal();

    document.getElementById('tripFormTitle').innerText = "Edit Trip Entry";
    document.getElementById('submitBtnText').innerText = "UPDATE TRIP";
    document.getElementById('tripCancelEditBtn').classList.remove('hidden');

    tripCurrentStep = 1;
    renderTripStep();
}

function toggleCollectorField() {
    const status = document.getElementById('received').value;
    const collectorInput = document.getElementById('collectorName');
    if(status === 'No') collectorInput.value = ''; // Pending hai toh naam hata do
}


function cancelTripEdit() {
    resetTripWizard();
    showSection('view-trips');
}

// Trip card ke "Delete" (trash) button se call hota hai
async function deleteTripEntry(rowNumber) {
    if (!rowNumber) { alert("⚠️ Ye entry delete nahi ho sakti (row number missing)."); return; }
    if (!confirm("Kya aap sach mein ye trip entry delete karna chahte hain?")) return;
    try {
        await fetch(scriptURL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: "deleteTrip", rowNumber, token: authToken }) });
        alert("✅ Entry Delete Ho Gayi!");
        loadTrips();
    } catch (e) { alert("Error connecting to server!"); }
}

// --- QUICK UPDATE (Card par hi Status/Commission/Collector edit) ---
// Pura Trip Edit form kholne ke bajaye, sirf Received Status, Commission Amount aur
// Collected By ko seedha card se hi update karne ke liye. Baaki fields (From/To/Rate/etc)
// nahi chhedta — uske liye "Edit" button hi use hoga.
function toggleQuickUpdate(rowNumber) {
    if (!rowNumber) { alert("⚠️ Ye entry update nahi ho sakti (row number missing)."); return; }
    const panel = document.getElementById(`quickPanel_${rowNumber}`);
    if (panel) panel.classList.toggle('hidden');
}

function toggleQuickCollectorField(rowNumber) {
    const status = document.getElementById(`qStatus_${rowNumber}`).value;
    const wrap = document.getElementById(`qCollectorWrap_${rowNumber}`);
    if (wrap) wrap.style.display = (status === 'Yes') ? '' : 'none';
}

// Quick panel ke Rate/Capacity badalte hi Amount auto-calculate karta hai (jaise New Trip form mein hota hai)
function recalcQuickAmount(rowNumber) {
    const rate = parseFloat(document.getElementById(`q_rate_${rowNumber}`).value) || 0;
    const capacity = parseFloat(document.getElementById(`q_capacity_${rowNumber}`).value) || 0;
    const amountEl = document.getElementById(`q_amount_${rowNumber}`);
    if (amountEl) amountEl.value = Math.round(rate * capacity);
}

async function saveQuickUpdate(rowNumber) {
    if (!rowNumber) { alert("⚠️ Ye entry update nahi ho sakti (row number missing)."); return; }

    const val = (name) => {
        const el = document.getElementById(`${name}_${rowNumber}`);
        return el ? el.value : "";
    };

    const date = val('q_date');
    const vNo = val('q_vNo');
    const received = val('qStatus');
    const collectorName = val('qCollector').trim();

    if (!date || !vNo) {
        alert("⚠️ Date aur Vehicle No zaroori hai."); return;
    }
    if (received === 'Yes' && !collectorName) {
        alert("⚠️ Kripya 'Collected By' naam bharein."); return;
    }

    const btn = document.getElementById(`qSaveBtn_${rowNumber}`);
    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Saving...`;

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
        token: authToken
    };

    try {
        await fetch(scriptURL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
    } catch (e) {
        // no-cors ki wajah se yahan bhi request generally chali jaati hai
    }

    loadTrips(); // Card turant saari updated details ke saath refresh ho jayegi
}

// Sheet date string (DD-MM-YYYY / DD/MM/YYYY) ko <input type=date> ke liye YYYY-MM-DD mein convert karta hai
function toDateInputValue(dateStr) {
    const d = parseSheetDate(dateStr);
    if (!d) return "";
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --- SUBMIT TRIP (New entry ya Existing entry ka Update) ---
async function submitTrip() {
    const btn = document.getElementById('submitBtn');
    if(!document.getElementById('date').value || !document.getElementById('vNo').value) {
        alert("Please fill Date and Vehicle Number!"); return;
    }
    const editRow = document.getElementById('tripEditRow').value;
    const isEdit = !!editRow;

    // Loading Shuru
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${isEdit ? 'UPDATING...' : 'SAVING...'}`;
    btn.disabled = true;

    const formData = {
        action: "saveTrip",
        rowNumber: editRow || "",
        date: document.getElementById('date').value,
        vNo: document.getElementById('vNo').value.toUpperCase(),
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
        token: authToken
    };

    try {
        await fetch(scriptURL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(formData) });
        alert(isEdit ? "✅ Trip Update Ho Gayi!" : "✅ Trip Saved Successfully!");
    } catch (e) {
        // Localhost block issue aane par
        alert(isEdit ? "✅ Trip Update Ho Gayi!" : "✅ Trip Saved Successfully!");
    }

    // --- FIX: Sabse pehle button wapas laao ---
    btn.innerHTML = `<i class="bi bi-cloud-arrow-up-fill me-1"></i> <span id="submitBtnText">${isEdit ? 'UPDATE TRIP' : 'SAVE TRIP'}</span>`;
    btn.disabled = false;
    
    // --- Usk baad form reset karke page change karo ---
    resetTripWizard();
    showSection('view-trips');
}

// --- DATA FETCHING ---
// --- UPDATED HOME DATA & STATS ---
async function loadHomeRecent() {
    const container = document.getElementById('homeRecentTrips');
    const todayBizEl = document.getElementById('todayBiz');
    const todayCountEl = document.getElementById('todayCount');
    const homePendEl = document.getElementById('homePendingCount');
    
    // Set Clock & Date
    const now = new Date();
    document.getElementById('homeTime').innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('homeDate').innerText = now.toDateString();

    try {
        const response = await fetch(apiUrl());
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        const data = await response.json();
        
        // Check if data is an error object
        if (data.error) {
            console.error("Backend error:", data.error);
            if (data.authError) {
                container.innerHTML = '<div class="text-center p-3 text-danger">Session expired. Please login again.</div>';
                return;
            }
            throw new Error(data.error);
        }
        
        if (!Array.isArray(data)) {
            console.error("Invalid data format:", data);
            throw new Error("Invalid data format");
        }
        
        container.innerHTML = '';
        let todayBiz = 0;
        let todayCount = 0;
        let pendingCount = 0;
        
        const todayFormatted = now.toLocaleDateString('en-GB'); // "DD/MM/YYYY"

       data.forEach((trip, index) => {
    let isCollected = (String(trip['_colG'] || "").toLowerCase().trim() === "yes");
    let amt = parseFloat(trip['Amount']) || 0;
    
    // Date comparison (Sheet date string vs Today's string)
    let tripDateStr = String(trip['Date']).replace(/-/g, '/'); // Dash ko slash me badlein
    if(tripDateStr === todayFormatted) {
        todayBiz += amt;
        todayCount++;
    }

            if(!isCollected) pendingCount++;

            // Sirf aakhri 5 trips Home par dikhao
            if(index < 5) {
                container.insertAdjacentHTML('beforeend', `
                    <div class="recent-item shadow-sm">
                        <div>
                            <div class="fw-bold" style="font-size:14px;">${safeAttr(trip['Vehicle No'])}</div>
                            <small class="text-muted">${safeAttr(trip['From'])} ➔ ${safeAttr(trip['To'])}</small>
                        </div>
                        <div class="text-end">
                            <div class="text-primary fw-bold">₹${Number(amt).toLocaleString('en-IN')}</div>
                            <small style="font-size: 10px;">${formatDisplayDate(trip['Date'])}</small>
                        </div>
                    </div>`);
            }
        });

        // Update UI Badges
        todayBizEl.innerText = "₹" + todayBiz.toLocaleString('en-IN');
        todayCountEl.innerText = todayCount;
        homePendEl.innerText = pendingCount;

    } catch (e) {
        console.error("❌ Home data loading error:", e.message, e);
        container.innerHTML = '<div class="text-center p-3 small text-danger">Error loading home data.<br><small style="font-size:10px;">Check console (F12) for details</small></div>';
    }
}


function toggleAmountVisibility() {
    const amtEl = document.getElementById('sumAmount');
    const eyeIcon = document.getElementById('eyeIcon');
    isAmountVisible = !isAmountVisible;
    
    if (isAmountVisible) {
        amtEl.classList.remove('amount-hidden');
        eyeIcon.classList.replace('bi-eye-slash', 'bi-eye');
    } else {
        amtEl.classList.add('amount-hidden');
        eyeIcon.classList.replace('bi-eye', 'bi-eye-slash');
    }
}

// --- VIEW ALL TRIPS ---
// Date ko sahi format mein badalne ke liye helper function
function parseSheetDate(dateStr) {
    if (!dateStr) return null;
    // Agar date string hai, to use / ya - se split karein
    let parts = String(dateStr).split(/[-/]/);
    if (parts.length === 3) {
        // Parts order: [DD, MM, YYYY]
        // Note: Month 0-indexed hota hai isliye -1 kiya hai
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    let d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}


// --- WHATSAPP PHONE NUMBER FIX ---
// Sheet mein zyaadatar numbers 10-digit (bina country code ke) hote hain, jiski wajah se
// WhatsApp kabhi kabhi number detect nahi kar paata tha. Ye function har number ko
// WhatsApp ke liye sahi format (91XXXXXXXXXX) mein convert karta hai.
function formatWhatsAppPhone(phone) {
    let digits = String(phone || "").replace(/\D/g, '');
    digits = digits.replace(/^0+/, ''); // Agar number 0 se start hota hai (jaise 09876543210), 0 hata do
    if (digits.length === 10) {
        digits = '91' + digits; // Plain 10-digit Indian mobile number -> country code add karo
    } else if (digits.length === 11 && digits.startsWith('91') === false && digits.startsWith('0')) {
        digits = '91' + digits.slice(1);
    }
    return digits;
}

// Kisi bhi format ki date ko sundar "DD-MM-YYYY" me badalne ke liye
function formatDisplayDate(dateVal) {
    if (!dateVal) return "-";
    
    // Agar pehle se DD-MM-YYYY ya DD/MM/YYYY hai (10 characters)
    let str = String(dateVal).trim();
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(str)) {
        return str.replace(/\//g, '-');
    }
    
    // Agar ISO Date (2026-09-11T18:30:00.000Z) ya YYYY-MM-DD hai
    let d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
        let day = String(d.getDate()).padStart(2, '0');
        let month = String(d.getMonth() + 1).padStart(2, '0');
        let year = d.getFullYear();
        return `${day}-${month}-${year}`;
    }
    
    return str;
}

// --- COMMISSION MESSAGE REMINDER TRACKING ---
// Har trip ke liye kitni baar commission message bheja gaya hai, ye localStorage mein
// (device par hi) track karte hain, taaki 2nd/3rd baar bhejte waqt reminder strong ho jaaye.
function getMsgSendCounts() {
    try { return JSON.parse(localStorage.getItem('ktc_msg_send_counts') || '{}'); } catch (e) { return {}; }
}
function saveMsgSendCounts(obj) {
    try { localStorage.setItem('ktc_msg_send_counts', JSON.stringify(obj)); } catch (e) { /* ignore */ }
}
function tripKeyFor(vNo, date) {
    return `${vNo}|${date}`;
}

// WhatsApp Share
async function shareTrip(phone, vNo, from, to, party, amt, date, material, weight) {
    // 1. Phone number cleaning + country code fix
    let cleanPhone = formatWhatsAppPhone(phone);
    let last10Digits = cleanPhone.slice(-10);

    if (cleanPhone.length < 12) {
        alert("⚠️ Ye number sahi format mein nahi hai, WhatsApp nahi khul payega. Kripya number check karein: " + phone);
        return;
    }

    // 2. Reminder Escalation Check
    const tripKey = tripKeyFor(vNo, date);
    const counts = getMsgSendCounts();
    const prevCount = counts[tripKey] || 0;
    let reminderTag = "";

    if (prevCount === 1) {
        const proceed = confirm(`⚠️ REMINDER\n\nVehicle ${vNo} ke liye commission message pehle EK baar bheja ja chuka hai.\n\nDusra reminder bhejna hai?`);
        if (!proceed) return;
        reminderTag = `🔔 *REMINDER — 2nd MESSAGE*\nPichla message shaayad miss ho gaya, kripya jald commission bhej dein.\n\n`;
    } else if (prevCount >= 2) {
        const proceed = confirm(`🚨 STRONG REMINDER\n\nVehicle ${vNo} ke liye ye ${prevCount + 1}-va (baar) message hoga!\n\nBhejna hai?`);
        if (!proceed) return;
        reminderTag = `🚨🔴 *URGENT — FINAL REMINDER (Message #${prevCount + 1})*\nYe ${prevCount} baar reminder bhejne ke baad ka message hai. Kripya TURANT commission clear karein.\n\n`;
    }

    // 3. History Calculation with Destinations (From/To)
    let historyList = "";
    let oldPendingAmt = 0;
    let pendingTripsCount = 0;

    if (allTripsData && allTripsData.length > 0) {
        allTripsData.forEach(t => {
            let tPhoneD = String(t['Driver No'] || "").replace(/\D/g, '').slice(-10);
            let tPhoneO = String(t['_owner'] || "").replace(/\D/g, '').slice(-10);
            let isCollected = (String(t['_colG'] || "").toLowerCase().trim() === "yes");

            // Agar number match kare aur payment pending ho
            if ((tPhoneD === last10Digits || tPhoneO === last10Digits) && !isCollected) {
                // Check karein ki ye current trip toh nahi hai
                if (!(t['Vehicle No'] === vNo && t['Date'] === date)) {
                    let v = String(t['Vehicle No']).replace(/&/g, "and");
                    let f = String(t['From'] || "N/A").replace(/&/g, "and");
                    let rt = String(t['To'] || "N/A").replace(/&/g, "and");
                    let a = parseFloat(t['Amount'] || 0);
                    let dt = t['Date'] || "No Date";

                    // Designing each old trip entry
                    historyList += `▪️ *${v}* (${dt})\n`;
                    historyList += `   📍 ${f} ➔ ${rt}\n`; // Destinations added here
                    historyList += `   💰 Fare: ₹${a}\n\n`;

                    oldPendingAmt += a;
                    pendingTripsCount++;
                }
            }
        });
    }

    let currentAmt = parseFloat(amt || 0);
    let totalOutstanding = currentAmt + oldPendingAmt;

    // 4. Message Body Design
    let messageBody = `🏢 *KUNAL TRANSPORT COMPANY*
_Raju Hiwale & Firoj Shaikh_
==========================
${reminderTag}📍 *CURRENT TRIP DETAILS*
📅 Date: ${date}
🚚 Vehicle: *${vNo}*
🛣️ Route: ${from} To ${to}
💰 Fare: *₹${currentAmt}*

${pendingTripsCount > 0 ? `⚠️ *OLD PENDING TRIPS (${pendingTripsCount})*
--------------------------
${historyList}--------------------------` : ''}

📊 *FINANCIAL SUMMARY*
Old Balance: ₹${oldPendingAmt}
Current Fare: ₹${currentAmt}
━━━━━━━━━━━━━━━━━━
🛑 *TOTAL PAYABLE: ₹${totalOutstanding}*
━━━━━━━━━━━━━━━━━━

💸 *PAYMENT INSTRUCTIONS*
Commission bhej kar SS dein 🙏
📲 UPI: *9403691888*

_Thank you for choosing Kunal Transport Company!_`;

    // 5. Proper Encoding (Taki message na kate)
    let encodedMsg = encodeURIComponent(messageBody);
    let whatsappURL = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;

    // 6. Is trip ko "last shared" mark karo, taaki list wapas aane par yahin scroll ho jaaye
    localStorage.setItem('ktc_last_shared_trip', tripKey);
    // 7. Send count badhao
    counts[tripKey] = prevCount + 1;
    saveMsgSendCounts(counts);

    // 8. Open WhatsApp
    try {
        window.location.href = whatsappURL;
    } catch (e) {
        window.open(whatsappURL, '_blank');
    }
}

// --- VEHICLE SECTION LOGIC ---

async function loadTrips() {
    const container = document.getElementById('tripCardsContainer');
    const summaryBar = document.getElementById('tripSummaryBar');
    
    // Filter Inputs se value lena
    const startVal = document.getElementById('trip-start-date') ? document.getElementById('trip-start-date').value : '';
    const endVal = document.getElementById('trip-end-date') ? document.getElementById('trip-end-date').value : '';

    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary spinner-border-sm"></div><br>Filtering Sheet Data...</div>';
    
    try {
        const response = await fetch(apiUrl());
        
        // Check if response is ok
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        
        const allData = await response.json();
        
        // Check if response is an error object (backend returned error)
        if (allData.error) {
            console.error("Backend Error:", allData.error);
            if (allData.authError) {
                container.innerHTML = '<div class="text-center p-5 text-danger">🔐 Session expired. Please login again.</div>';
                setTimeout(() => location.reload(), 2000);
                return;
            }
            throw new Error(allData.error);
        }
        
        // Check if allData is an array
        if (!Array.isArray(allData)) {
            console.error("Invalid data format. Expected array, got:", typeof allData, allData);
            throw new Error("Invalid data format received from server");
        }
        
        allTripsData = allData;
        populateTripSuggestions(allData);
        
        // --- DATE FILTER LOGIC ---
        const data = allData.filter(trip => isDateInRange(trip['Date'], startVal, endVal));

        container.innerHTML = '';
        summaryBar.classList.remove('hidden');

        if(data.length === 0) {
            container.innerHTML = '<div class="text-center p-5 text-muted">No records found for selected dates.</div>';
            return;
        }

        // Vehicle Counting Logic (Badges ke liye)
        const vCountMap = {};
        allData.forEach(t => {
            let v = t['Vehicle No'];
            vCountMap[v] = (vCountMap[v] || 0) + 1;
        });

        let tCount = 0, colCount = 0, penCount = 0;
        const today = new Date();
const todayFormatted = today.toLocaleDateString('en-GB'); // Ye "DD/MM/YYYY" deta hai


        data.forEach(trip => {
            // Data Mapping as per your Sheet Headers
            let isCollected = (String(trip['_colG'] || "").toLowerCase().trim() === "yes"); // Column G: Recived or Not
            let collectorName = trip['_colH'] || "Not Specified"; // Column H: collected name
            let collectorRaw = trip['_colH'] || ""; // Quick-edit prefill ke liye (bina fallback text ke)
            let amt = trip['Amount'] || 0;
            let commissionAmt = trip['_colK'] || trip['Commission Amount'] || 0;
            let vNo = trip['Vehicle No'];
            let driverNo = trip['Driver No'] || "";
            let ownerNo = trip['_owner'] || ""; // Column I: Lorry Owner Contact
            let tDate = formatDisplayDate(trip['Date']);
            let tFrom = trip['From'];
            let tTo = trip['To'];
            let tParty = trip['Party Name'];
            let tMaterial = trip['Material'];
            let tWeight = trip['Capacity Ton'];
            let tRate = trip['Rate'];
            let calculatedFreight = Math.round(parseFloat(amt) || ((parseFloat(tRate) || 0) * (parseFloat(tWeight) || 0)));
            
            // Badge Logic
            let vCount = vCountMap[vNo];
            let vBadge = vCount === 1 
                ? `<span class="badge bg-info text-dark" style="font-size: 9px; vertical-align: middle; margin-left: 5px; border-radius: 4px;">NEW VEHICLE</span>`
                : `<span class="badge bg-secondary" style="font-size: 9px; vertical-align: middle; margin-left: 5px; border-radius: 4px;">${vCount} TRIPS</span>`;

            // Overdue Logic
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

            // TRIP CARD HTML
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
                        
                        <!-- DRIVER -->
                        <div class="d-flex justify-content-between mb-1 align-items-center">
                            <span><i class="bi bi-telephone text-muted"></i> Driver:</span>
                            <div class="d-flex align-items-center gap-3">
                                <span class="fw-bold">${driverNo || '-'}</span>
                                <div class="d-flex gap-2">
                                    ${driverNo ? `<a href="tel:${driverNo}" class="text-primary"><i class="bi bi-telephone-fill"></i></a>` : ''}
                                    ${driverNo ? `<a href="#" onclick="shareTrip('${safeAttr(driverNo)}', '${safeAttr(vNo)}', '${safeAttr(tFrom)}', '${safeAttr(tTo)}', '${safeAttr(tParty)}', '${safeAttr(amt)}', '${safeAttr(tDate)}', '${safeAttr(tMaterial)}', '${safeAttr(tWeight)}')" class="text-success"><i class="bi bi-whatsapp"></i></a>` : ''}
                                </div>
                            </div>
                        </div>

                        <!-- OWNER -->
                        <div class="d-flex justify-content-between mb-1 align-items-center">
                            <span><i class="bi bi-person-badge text-muted"></i> Owner:</span>
                            <div class="d-flex align-items-center gap-3">
                                <span class="fw-bold">${ownerNo || '-'}</span>
                                <div class="d-flex gap-2">
                                    ${ownerNo ? `<a href="tel:${ownerNo}" class="text-primary"><i class="bi bi-telephone-fill"></i></a>` : ''}
                                    ${ownerNo ? `<a href="#" onclick="shareTrip('${safeAttr(ownerNo)}', '${safeAttr(vNo)}', '${safeAttr(tFrom)}', '${safeAttr(tTo)}', '${safeAttr(tParty)}', '${safeAttr(amt)}', '${safeAttr(tDate)}', '${safeAttr(tMaterial)}', '${safeAttr(tWeight)}')" class="text-success"><i class="bi bi-whatsapp"></i></a>` : ''}
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

                    <!-- QUICK UPDATE PANEL: Card par hi POORI entry (har field) edit karne ke liye,
                         taaki entry karte waqt hui koi bhi galti yahin se turant theek ho sake —
                         alag se pura Edit wizard kholne ki zaroorat nahi -->
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

        // Summary Bar Update
        document.getElementById('sumCount').innerText = tCount;
        document.getElementById('sumColCount').innerText = colCount;
        document.getElementById('sumPenCount').innerText = penCount;

        // --- FIX: SCROLL POSITION YAAD RAKHNA ---
        // Jab WhatsApp par msg bhejne ke baad user wapas app par aata hai aur list yahan
        // reload hoti hai, to hum use list ke TOP par le jaane ke bajaye seedha usi
        // trip card tak scroll kar dete hain jahan se wo pichli baar gaya tha.
        const lastKey = localStorage.getItem('ktc_last_shared_trip');
        if (lastKey) {
            let target = null;
            container.querySelectorAll('[data-trip-key]').forEach(card => {
                if (card.getAttribute('data-trip-key') === lastKey) target = card;
            });
            if (target) {
                setTimeout(() => {
                    target.scrollIntoView({ behavior: 'auto', block: 'center' });
                    target.classList.add('trip-card-highlight');
                    setTimeout(() => target.classList.remove('trip-card-highlight'), 1800);
                }, 50);
            }
        }

    } catch (e) {
        console.error("❌ Trip Loading Error:", e.message, e);
        let errorMsg = e.message || "Unknown error";
        if (errorMsg.includes("Failed to fetch")) {
            errorMsg = "Network error. Check your internet connection or API URL.";
        }
        container.innerHTML = `<div class="text-center p-5 text-danger">
            <strong>Error loading data:</strong><br>
            ${errorMsg}<br>
            <small class="text-muted" style="font-size: 11px;">Check browser console (F12) for details</small>
        </div>`;
    }
}

// --- HELPER: DATE RANGE CHECK ---
function isDateInRange(dateStr, start, end) {
    if (!start && !end) return true;
    let tripDate = parseSheetDate(dateStr);
    if (!tripDate) return false;

    let sDate = start ? new Date(start) : new Date("2000-01-01");
    let eDate = end ? new Date(end) : new Date("2099-12-31");
    
    tripDate.setHours(0,0,0,0);
    sDate.setHours(0,0,0,0);
    eDate.setHours(0,0,0,0);

    return tripDate >= sDate && tripDate <= eDate;
}

async function fetchVehicleHistory(vNo) {
    const safeId = vNo.replace(/\s+/g, '_');
    const histContainer = document.getElementById(`historyList_${safeId}`);
    const statsContainer = document.getElementById(`stats_${safeId}`);
    
    try {
        const res = await fetch(apiUrl(`?action=getVehicleHistory&vNo=${encodeURIComponent(vNo)}`));
        const history = await res.json();
        
        if(!history || history.length === 0) {
            histContainer.innerHTML = '<div class="text-center p-3 text-muted small">No history found for this vehicle</div>';
            statsContainer.innerHTML = '<div class="col-12 text-center small opacity-50">No Data</div>';
            return;
        }

        // --- 1. CALCULATE TOTALS ---
        let totalBus = 0;
        let pendingAmt = 0;
        history.forEach(t => { 
            let amt = parseFloat(t['Amount']) || 0;
            totalBus += amt;
            // Balance = pending COMMISSION (Column K), not pending freight amount.
            if(String(t['_status']).toLowerCase() !== 'yes') {
                let commission = parseFloat(String(t['_colK'] || t['Commission Amount'] || "0").replace(/[^0-9.]/g, '')) || 0;
                pendingAmt += commission;
            }
        });

        // --- 2. PREMIUM STATS CARDS ---
        statsContainer.innerHTML = `
            <div class="col-4">
                <div class="p-2 border rounded bg-white shadow-sm">
                    <small class="d-block text-muted" style="font-size:9px">TRIPS</small>
                    <b class="text-primary">${history.length}</b>
                </div>
            </div>
            <div class="col-4">
                <div class="p-2 border rounded bg-white shadow-sm">
                    <small class="d-block text-muted" style="font-size:9px">TOTAL BIZ</small>
                    <b class="text-success">₹${totalBus.toLocaleString('en-IN')}</b>
                </div>
            </div>
            <div class="col-4">
                <div class="p-2 border rounded bg-white shadow-sm">
                    <small class="d-block text-muted" style="font-size:9px">BALANCE</small>
                    <b class="text-danger">₹${pendingAmt.toLocaleString('en-IN')}</b>
                </div>
            </div>
        `;

        // --- 3. STYLISH HISTORY ITEMS ---
        histContainer.innerHTML = history.map(trip => {
            const isRec = String(trip['_status']).toLowerCase() === 'yes';
            return `
            <div class="card mb-2 border-0 shadow-sm overflow-hidden" style="border-left: 4px solid ${isRec ? '#28a745' : '#dc3545'} !important;">
                <div class="card-body p-2" style="font-size: 12px;">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <span class="fw-bold text-dark">${trip['From']} <i class="bi bi-arrow-right text-muted"></i> ${trip['To']}</span>
                            <div class="text-muted" style="font-size: 10px;">
                                <i class="bi bi-calendar3"></i> ${trip['Date']} | <i class="bi bi-person"></i> ${trip['Party Name'] || 'No Party'}
                            </div>
                        </div>
                        <div class="text-end">
                            <div class="fw-bold text-primary">₹${(trip['Amount'] || 0).toLocaleString('en-IN')}</div>
                            <span class="badge ${isRec ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}" style="font-size: 9px;">
                                ${isRec ? 'RECEIVED' : 'PENDING'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            `;
        }).join('');

    } catch (e) { 
        histContainer.innerHTML = '<div class="text-danger small p-2">Failed to load history.</div>'; 
    }
}


async function fetchVehicleDocs(vNo) {
    const safeId = vNo.replace(/\s+/g, '_'); // ID dhoondhne ke liye space hatayein
    const docContainer = document.getElementById(`docList_${safeId}`);
    if(!docContainer) return;

    docContainer.innerHTML = 'Loading docs...';
    
    try {
        const res = await fetch(apiUrl(`?action=getDocs&vNo=${encodeURIComponent(vNo)}`));
        const docs = await res.json();
        docContainer.innerHTML = '';
        
        if(!docs || docs.length === 0) {
            docContainer.innerHTML = '<small class="text-muted">No documents found.</small>';
        } else {
            docs.forEach(doc => {
                docContainer.insertAdjacentHTML('beforeend', `
                    <a href="${doc.url}" target="_blank" class="doc-link-item d-block p-1 small">
                        <i class="bi bi-file-earmark-text"></i> ${doc.name}
                    </a>
                `);
            });
        }
    } catch (e) { docContainer.innerHTML = 'Error loading docs.'; }
}

// Trigger file picker
function triggerUpload(safeId) { 
    const inp = document.getElementById(`file_${safeId}`);
    if (inp) inp.click(); 
}

// File select hone par auto compression aur upload
async function uploadFile(input, vNo) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const btn = input.closest('.v-item-details').querySelector('.btn-primary');
    await uploadFilesDirect(files, vNo, btn);
    input.value = ''; // reset input
}

// Drag & Drop handling
function handleFileDrop(e, vNo) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const btn = e.currentTarget.closest('.v-item-details').querySelector('.btn-primary');
    uploadFilesDirect(files, vNo, btn);
}

// Upload coordinator with actual server response verification
async function uploadFilesDirect(files, vNo, btn) {
    const originalText = btn ? btn.innerHTML : '';
    let success = 0;
    let failed = 0;
    let lastError = "";

    for (let i = 0; i < files.length; i++) {
        if (btn) {
            btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> UPLOADING ${i + 1}/${files.length}...`;
            btn.disabled = true;
        }
        try {
            const resText = await uploadSingleFile(files[i], vNo);
            if (resText === "Success") {
                success++;
            } else {
                failed++;
                lastError = resText;
            }
        } catch (e) {
            failed++;
            lastError = e.message;
        }
    }

    if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }

    if (failed === 0 && success > 0) {
        alert(`✅ ${success} Document(s) Uploaded Successfully!`);
        fetchVehicleDocs(vNo); 
        loadVehicles(); // Counters aur badges refresh
    } else {
        alert(`❌ Upload Failed!\nReason: ${lastError || "Unknown Error"}`);
    }
}

// Single File Processor (Compresses large images & sends payload)
function uploadSingleFile(file, vNo) {
    return new Promise((resolve, reject) => {
        if (!authToken) {
            return resolve("Unauthorized: Token missing. Please Logout and Login again.");
        }

        const isImage = file.type.startsWith('image/');
        const reader = new FileReader();

        reader.onload = function(e) {
            if (isImage) {
                // Large images ko canvas se compress karte hain
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const maxDim = 1600;
                    let width = img.width;
                    let height = img.height;

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

                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
                    sendPayloadToServer(compressedBase64, file.name, 'image/jpeg', vNo, resolve, reject);
                };
                img.onerror = () => {
                    const base64 = e.target.result.split(',')[1];
                    sendPayloadToServer(base64, file.name, file.type, vNo, resolve, reject);
                };
                img.src = e.target.result;
            } else {
                // PDF ya other files ko direct bhejte hain
                const base64 = e.target.result.split(',')[1];
                sendPayloadToServer(base64, file.name, file.type || 'application/pdf', vNo, resolve, reject);
            }
        };

        reader.onerror = () => reject(new Error("File read error"));
        reader.readAsDataURL(file);
    });
}

// Server communication helper
async function sendPayloadToServer(base64, fileName, mimeType, vNo, resolve, reject) {
    try {
        const payload = {
            action: "uploadDocument",
            vNo: vNo.toUpperCase().trim(),
            fileName: fileName,
            base64: base64,
            mimeType: mimeType,
            token: authToken
        };

        const res = await fetch(scriptURL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const text = await res.text();
        if (text.includes("Success")) {
            resolve("Success");
        } else {
            resolve(text);
        }
    } catch (err) {
        reject(err);
    }
}

// --- ACCOUNTS CALCULATION (Hisaab-Kitaab) ---
async function updateAccounts() {
    const bizEl = document.getElementById('acc-total-business');
    const pendEl = document.getElementById('acc-total-pending');
    const recdEl = document.getElementById('acc-total-received');
    const listEl = document.getElementById('collector-list');

    const startVal = document.getElementById('acc-start-date').value;
    const endVal = document.getElementById('acc-end-date').value;

    bizEl.innerText = "Loading...";

    try {
        const response = await fetch(apiUrl());
        const allData = await response.json();

        if (!Array.isArray(allData)) {
    bizEl.innerText = "₹0";
    pendEl.innerText = "₹0";
    recdEl.innerText = "₹0";
    listEl.innerHTML = '<div class="p-3 text-center text-danger">Session expired. Kripya login karein.</div>';
    return;
}

        
        // Filter Apply
        const data = allData.filter(trip => isDateInRange(trip['Date'], startVal, endVal));

        let totalBus = 0, totalPend = 0, totalRecd = 0;
        let collectorMap = {};

        data.forEach(trip => {
            // Total Business Value = total COMMISSION (Column K), freight Amount nahi —
            // isi wajah se pehle "Total Business Value" mein 0 aa raha tha jab Amount blank
            // hota tha lekin Commission bhara hota tha.
            let commission = parseFloat(String(trip['_colK'] || trip['Commission Amount'] || "0").replace(/[^0-9.]/g, '')) || 0;
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

    } catch (e) { console.error(e); }
}


// ================= "WHAT'S NEW" UPDATE NOTIFICATION =================
// Jab bhi app ko naye features/fixes ke saath deploy karein, TWO CHIZEIN badlein:
//   1. Yahan APP_VERSION number badhayein (e.g. "1.1.0" -> "1.2.0")
//   2. Uske neeche ek naya changelog entry (version + notes) add karein
//   3. sw.js mein CACHE_NAME bhi badhayein (v1 -> v2...) taaki purana cache clear ho aur
//      sabko turant naye files milein
// Isse jaise hi koi user app kholega, agar unhone ye version pehle nahi dekha,
// to unhe ek popup mein "kya naya hai" dikh jayega.
const APP_VERSION = "1.0.0";
const APP_CHANGELOG = [
    {
        version: "1.0.0",
        notes: [
            "🚀 Kunal Transport Company App Launch — naya branding, naya design!",
            "✍️ Trip Entry ab ek aasan 4-step Smart Form mein hai (Vehicle & Date → Route & Party → Rate & Payment → Driver & Remark).",
            "🔄 Ab View Trips se kisi bhi purani entry ko seedha Edit/Update kar sakte hain — Google Sheet mein duplicate row nahi banegi.",
            "🗑️ Trip entries ko delete karne ka option bhi add hua hai."
        ]
    }
    // Agla update yahan upar naya object add karke likhein
];

function checkForAppUpdates() {
    const lastSeen = localStorage.getItem('ktc_last_seen_version');
    if (lastSeen === APP_VERSION) return; // Ye version pehle hi dekh chuke hain

    const latest = APP_CHANGELOG.find(c => c.version === APP_VERSION);
    const body = document.getElementById('whatsNewBody');
    if (body) {
        if (latest && latest.notes && latest.notes.length) {
            body.innerHTML = `<p class="text-muted small mb-2">Version ${APP_VERSION}</p><ul class="mb-0 ps-3">${latest.notes.map(n => `<li class="mb-2">${n}</li>`).join('')}</ul>`;
        } else {
            body.innerHTML = `<p class="mb-0">App update ho chuki hai (Version ${APP_VERSION}). Kuch fixes aur improvements add hue hain.</p>`;
        }
    }

    const modalEl = document.getElementById('whatsNewModal');
    if (modalEl && window.bootstrap) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
    localStorage.setItem('ktc_last_seen_version', APP_VERSION);
}

document.addEventListener('DOMContentLoaded', checkForAppUpdates);
// ================= END "WHAT'S NEW" UPDATE NOTIFICATION =================

// --- FILTERS & HELPERS ---
function filterTrips() {
    let val = document.getElementById("tripSearch").value.toUpperCase();
    let cards = document.getElementsByClassName("trip-card");
    for (let c of cards) { c.style.display = c.innerText.toUpperCase().includes(val) ? "" : "none"; }
}

function filterVehicles() {
    let val = document.getElementById("vSearch").value.toUpperCase();
    let cards = document.getElementsByClassName("v-list-item"); 
    for (let c of cards) { 
        c.style.display = c.innerText.toUpperCase().includes(val) ? "" : "none"; 
    }
}

let currentVehicleTrips = [];



// 2. Fill Logic
function fillSlipFromSelection() {
    const idx = document.getElementById('tripSelectDropdown').value;
    const trip = currentVehicleTrips[idx];
    
    if(!trip) return;

    // Header Data
    document.getElementById('slip_vNo').value = (trip['Vehicle No'] || "").toUpperCase();
    document.getElementById('slip_date').value = (trip['Date'] || "").toUpperCase();
    document.getElementById('slip_party').value = (trip['Party Name'] || "").toUpperCase();
    document.getElementById('slip_from').value = (trip['From'] || "").toUpperCase();
    document.getElementById('slip_to').value = (trip['To'] || "").toUpperCase();
    
    // Finance Data
    document.getElementById('slip_rate').value = trip['Rate'] || 0;
    document.getElementById('slip_weight').value = (trip['Capacity Ton'] ? trip['Capacity Ton'] * 1000 : 0);
    document.getElementById('slip_advance').value = trip['Advance'] || 0;
    document.getElementById('slip_dPrice').value = trip['Driver Prize'] || trip['Driver Price'] || 0;
    
    // Contacts & Details
    document.getElementById('slip_lOwner').value = (trip['Lorry Owner Name'] || "").toUpperCase();
    document.getElementById('slip_oMob').value = (trip['Lorry Owner Contact'] || trip['_owner'] || "").toUpperCase();
    document.getElementById('slip_dName').value = (trip['Driver Name'] || "").toUpperCase();
    document.getElementById('slip_dMob').value = (trip['Driver No'] || "").toUpperCase();
    document.getElementById('slip_licence').value = (trip['Licence No'] || "").toUpperCase();
    
    const rowInput = document.getElementById('slip_rowNum');
    if(rowInput) rowInput.value = trip.rowNumber;

    calculateSlip(); 
}

// 3. Calculation
// --- UPDATED LOADING SLIP CALCULATION ---
function calculateSlip() {
    let rate = parseFloat(document.getElementById('slip_rate').value) || 0;     // Per Ton Rate
    let weight = parseFloat(document.getElementById('slip_weight').value) || 0; // In Tons (e.g. 30.250)
    let overWeightEl = document.getElementById('slip_overWeight');
    let overWeight = overWeightEl ? (parseFloat(overWeightEl.value) || 0) : 0;  // Extra/overload tons
    let overRateEl = document.getElementById('slip_overRate');
    let overRateInput = overRateEl ? (parseFloat(overRateEl.value) || 0) : 0;   // Overload ka apna rate (agar diya ho)
    let effectiveOverRate = overRateInput > 0 ? overRateInput : rate; // Warna normal Rate hi use hoga

    // Freight = Rate * Weight (Tons)
    let freight_total = Math.round(weight * rate);
    
    // Agar Rate aur Weight dala hai, toh Freight auto-fill karein
    if(rate > 0 && weight > 0) {
        document.getElementById('slip_freight').value = freight_total;
    }

    // Overloading charge: apna (O.Rate) hai to usi se, warna normal Rate se calculate hoga
    if(effectiveOverRate > 0 && overWeight > 0) {
        document.getElementById('slip_overCharge').value = Math.round(overWeight * effectiveOverRate);
    }
    
    updateFinalNetPayable();
}

// 2. Agar user direct Bhada (Freight) likhna chahe toh ye kaam karega
function calculateTotalFromManual() {
    updateFinalNetPayable();
}

// 3. Final calculation logic
function updateFinalNetPayable() {
    let freight = parseFloat(document.getElementById('slip_freight').value) || 0;
    let overCharge = parseFloat(document.getElementById('slip_overCharge').value) || 0;
    let adv = parseFloat(document.getElementById('slip_advance').value) || 0;
    let dPrice = parseFloat(document.getElementById('slip_dPrice').value) || 0;

    // Net Payable = Freight + Overloading Charge - Advance + Driver Price
    let toPay = (freight + overCharge - adv) + dPrice;

    document.getElementById('slip_toPay').value = Math.round(toPay);
}

// ================= BEELTY MOBILE WIZARD (Step-by-Step Fill) =================
let currentWizardStep = 1;
const WIZARD_TOTAL_INPUT_STEPS = 5; // 5 input steps + 1 review step
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
        document.getElementById('receipt-to-print').classList.remove('wizard-mode'); // sab dikhao, full preview
        // FIX: Review step par "Review — Print Se Pehle Check Karein" patti hata di, aur nav bar ko
        // sticky se static kar diya (class: review-mode) taaki ye beelty ke content ke upar
        // overlap na ho — Back button phir bhi kaam karega, bas ab neeche normal jagah par dikhega.
        navBar.classList.add('review-mode');
        document.getElementById('wizardStepLabel').style.display = 'none';
    } else {
        navBar.style.display = 'block';
        navBar.classList.remove('review-mode');
        document.getElementById('wizardStepLabel').style.display = 'block';
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

function wizardNext() {
    if (currentWizardStep <= WIZARD_TOTAL_INPUT_STEPS + 1) currentWizardStep++;
    renderWizardStep();
}

function wizardBack() {
    if (currentWizardStep > 1) currentWizardStep--;
    renderWizardStep();
}

// --- AUTOMATIC CAPITAL DATA SAVE ---
// Sabhi inputs ko save karte waqt capital mein convert karne ke liye function
function getInputValueCaps(id) {
    let val = document.getElementById(id).value;
    return val ? val.toUpperCase().trim() : "";
}

// Timing Suffix (Auto 'Hr' add karna)
const timingInput = document.getElementById('slip_timing');
if(timingInput) {
    timingInput.addEventListener('blur', function() {
        let val = this.value.trim();
        if(val !== "" && !val.toUpperCase().includes('HR')) {
            this.value = val + " Hr";
        }
    });
}

// 4. Generate & Save
// script.js mein generateBeeltyPDF function ko update karein

async function generateBeeltyPDF() {
    const btn = document.getElementById('slipSubmitBtn');
    const element = document.getElementById('receipt-to-print');

    // --- FIX: ENFORCE CAPITAL LETTERS IN ALL DOM INPUT VALUES & ATTRIBUTES FOR PDF CAPTURE ---
    const allInputs = element.querySelectorAll('input');
    allInputs.forEach(input => {
        if (input.type !== 'number' && input.type !== 'date') {
            input.value = (input.value || "").toUpperCase();
        }
        // HTML attribute update karein taaki html2canvas ise Capital read kare
        input.setAttribute('value', input.value); 
    });

    const vNo = document.getElementById('slip_vNo').value || "N/A";

    if(!vNo || vNo === "N/A") return alert("Data select karein!");

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating PDF...';

    // Wizard ke saare steps PDF capture se pehle dikhne chahiye (chahe abhi kisi step par ruke ho)
    element.classList.remove('wizard-mode');
    document.querySelectorAll('[data-wizard-step]').forEach(el => el.classList.add('wizard-active'));

    // --- FIX: "Review — Print Se Pehle Check Karein" patti aur Back/Next/Submit buttons
    // PDF mein kabhi kabhi bleed ho jaate the (sticky positioning ki wajah se). Capture se
    // pehle inhe poori tarah hide kar dete hain taaki PDF sirf saaf beelty ho, koi UI bar nahi.
    const navBar = document.getElementById('wizardNavBar');
    const actionBar = document.querySelector('.slip-action-bar');
    const navBarOriginalDisplay = navBar ? navBar.style.display : null;
    const actionBarOriginalDisplay = actionBar ? actionBar.style.display : null;
    if (navBar) navBar.style.display = 'none';
    if (actionBar) actionBar.style.display = 'none';

    // --- FIX: MOBILE SCALING ISSUES ---
    const originalTransform = element.style.transform;
    const originalMargin = element.style.margin;
    const originalPosition = element.style.position;
    const originalHeight = element.style.height;

    element.style.transform = "none"; // Scale reset to 100%
    element.style.margin = "0 auto";
    element.style.position = "relative";
    element.style.width = "794px"; // Standard A4 Width
    // FIX: Fixed height hata kar content ke hisaab se hone dete hain, warna neeche ka
    // content (footer/signatures) clip ya overlap ho raha tha.
    element.style.height = "auto";

    const opt = {
        margin: 0,
        filename: `Slip_${vNo}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2,
            useCORS: true, 
            logging: false,
            letterRendering: true,
            scrollX: 0,
            scrollY: 0,
            width: 794
        }
    };

    try {
        // --- FIX: EK HI PAGE KA PDF ---
        // Pehle poore element ka canvas banate hain, phir uske exact height ke barabar
        // ek custom-size PDF page banate hain (A4 fixed size nahi) — isse content chahe
        // thoda lamba/chota ho, PDF hamesha SIRF EK PAGE ka banega, koi khaali/adhoora
        // dusra page nahi aayega.
        // NOTE: 'new jsPDF(...)' seedha use karne par "jsPDFCtor is not a constructor"
        // error aa raha tha (global naam library load order/version ke hisaab se badal
        // jaata hai). Isliye ab html2pdf ke apne worker chain ka hi jsPDF instance use
        // kar rahe hain (jaisa is file mein generateStatementPdf() pehle se karta hai) —
        // ye tareeka guaranteed available hai, global window.jsPDF par depend nahi karta.
        const worker = html2pdf().set(opt).from(element).toCanvas();
        const canvas = await worker.get('canvas');

        const pdfWidthMM = 210; // A4 width in mm
        const pdfHeightMM = (canvas.height * pdfWidthMM) / canvas.width;

        // Worker ke jsPDF page-format ko content ke exact size jitna set kar dete hain,
        // taaki bina kisi slicing ke sirf EK hi page bane
        const pdf = await worker
            .set({ jsPDF: { unit: 'mm', format: [pdfWidthMM, pdfHeightMM], orientation: 'portrait' } })
            .toPdf()
            .get('pdf');

        const pdfBase64 = pdf.output('datauristring').split(',')[1];

        // Save PDF to Device
        pdf.save(opt.filename);

        // Google Sheet payload (Caps ensured)
        const payload = {
            action: "saveLoadingSlip",
            rowNumber: document.getElementById('slip_rowNum').value,
            archiveRow: document.getElementById('slip_archiveRow').value,
            vNo: vNo.toUpperCase(),
            date: document.getElementById('slip_date').value || "NoDate",
            pdfBase64: pdfBase64,
            partyName: document.getElementById('slip_party').value.toUpperCase(),
            from: document.getElementById('slip_from').value.toUpperCase(),
            to: document.getElementById('slip_to').value.toUpperCase(),
            rate: document.getElementById('slip_rate').value,
            weight: document.getElementById('slip_weight').value,
            overWeight: document.getElementById('slip_overWeight').value,
            overRate: document.getElementById('slip_overRate').value,
            overCharge: document.getElementById('slip_overCharge').value,
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
            token: authToken
        };

        // Server par bhejein
        await fetch(scriptURL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });

        alert("✅ PDF Saved Successfully!");
        resetBeeltyForm();
        showSection('slip-history');

    } catch (e) {
        console.error(e);
        alert("Error: " + e.message);
    } finally {
        element.style.transform = originalTransform;
        element.style.margin = originalMargin;
        element.style.position = originalPosition;
        element.style.height = originalHeight;

        // Nav bar aur action bar wapas dikhao
        if (navBar) navBar.style.display = navBarOriginalDisplay;
        if (actionBar) actionBar.style.display = actionBarOriginalDisplay;

        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-2"></i> FINALIZE, SAVE & WHATSAPP';
    }
}


// Search field aur form reset karne ka naya function
function resetBeeltyForm() {
    // 1. Search fields clear karein
    document.getElementById('slipSearchVNo').value = "";
    document.getElementById('tripSelectionArea').classList.add('hidden');
    document.getElementById('newVehicleAlert').classList.add('hidden');
    
    // 2. Beelty Form clear karein (Inputs)
    const slipInputs = [
        'slip_vNo', 'slip_date', 'slip_party', 'slip_from', 'slip_to',
        'slip_rate', 'slip_weight', 'slip_overWeight', 'slip_overRate', 'slip_overCharge', 'slip_advance', 'slip_dPrice',
        'slip_lOwner', 'slip_oVillage', 'slip_oMob', 'slip_dName', 'slip_dVillage', 'slip_dMob', 
        'slip_licence', 'slip_toPay', 'slip_rowNum', 'slip_archiveRow'
    ];
    
    slipInputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = (id.includes('rate') || id.includes('weight') || id.includes('Weight') || id.includes('Charge') || id.includes('advance') || id.includes('Price') || id.includes('Pay')) ? 0 : "";
    });

    // Wizard ko wapas Step 1 par le jayein agli entry ke liye
    initWizard();
}

// Loading Slip ke liye gaadiyon ki list load karna
// 1. Datalist ko load karna (Autocomplete ke liye)
async function loadVehicleListForSlip() {
    const list = document.getElementById('vehicleListOptions');
    if (!list) return;

    try {
        const response = await fetch(apiUrl("?action=getVehicles"));
        const vehicles = await response.json();
        // Datalist mein saari gaadiyan add karein
        list.innerHTML = vehicles.map(v => `<option value="${v}">`).join('');
    } catch (e) {
        console.error("Datalist error:", e);
    }
}

// 2. Search ya New Entry handle karna
async function searchVehicleForSlip() {
    const vNo = document.getElementById('slipSearchVNo').value.toUpperCase().trim();
    if(!vNo) return alert("Please enter a Vehicle Number!");
    
    const btn = document.querySelector('[onclick="searchVehicleForSlip()"]');
    const selectionArea = document.getElementById('tripSelectionArea');
    const newVAlert = document.getElementById('newVehicleAlert');
    
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    selectionArea.classList.add('hidden');
    newVAlert.classList.add('hidden');

    try {
        const res = await fetch(apiUrl("?action=getTripsByVehicle&vNo=" + encodeURIComponent(vNo)));
        currentVehicleTrips = await res.json();
        
        if(!currentVehicleTrips || currentVehicleTrips.length === 0) {
            // CASE: Nayi Gaadi (Record mein nahi hai)
            newVAlert.classList.remove('hidden');
            clearSlipForNewEntry(vNo);
        } else {
            // CASE: Record mil gaya
            const dropdown = document.getElementById('tripSelectDropdown');
            dropdown.innerHTML = currentVehicleTrips.map((t, i) => 
                `<option value="${i}">${t['Date']} | ${t['From']} to ${t['To']}</option>`
            ).join('');
            selectionArea.classList.remove('hidden');
            fillSlipFromSelection(); // Pehli trip auto-fill karein
            autoFillOwnerDriver(vNo); // Village/Licence jaisi details jo trip record me nahi hoti, wo profile se bhar do
        }
    } catch(e) { 
        alert("Server error. Please try again."); 
    } finally {
        btn.innerHTML = '<i class="bi bi-search me-1"></i> GO';
    }
}

// 3. Agar gaadi nayi hai toh form khali karke sirf number daalna
function clearSlipForNewEntry(vNo) {
    // Beelty ke fields ko khali karein
    document.getElementById('slip_vNo').value = vNo;
    document.getElementById('slip_date').value = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
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
    document.getElementById('slip_rowNum').value = ""; // Nayi entry ke liye row number khali

    calculateSlip();
    autoFillOwnerDriver(vNo); // Purani Owner/Driver details (agar pehle kabhi bhari thi) khud bhar do
}

// --- 1-TAP AUTO-FILL: Owner/Driver details jo pichli baar is gaadi ke liye save hui thi ---
async function autoFillOwnerDriver(vNo) {
    vNo = (vNo || "").toUpperCase().trim();
    if (!vNo) return;
    try {
        const res = await fetch(apiUrl(`?action=getVehicleProfile&vNo=${encodeURIComponent(vNo)}`));
        const profile = await res.json();
        if (!profile || Object.keys(profile).length === 0) return; // Pehli baar hai gaadi, kuch nahi milega

        if (profile.lOwner) document.getElementById('slip_lOwner').value = profile.lOwner;
        if (profile.oVillage) document.getElementById('slip_oVillage').value = profile.oVillage;
        if (profile.oMob) document.getElementById('slip_oMob').value = profile.oMob;
        if (profile.dName) document.getElementById('slip_dName').value = profile.dName;
        if (profile.dVillage) document.getElementById('slip_dVillage').value = profile.dVillage;
        if (profile.dMob) document.getElementById('slip_dMob').value = profile.dMob;
        if (profile.licence) document.getElementById('slip_licence').value = profile.licence;
    } catch (e) {
        console.error("Auto-fill failed:", e);
    }
}

// --- PURANI SAVED BEELTY EDIT KARNA (Mistake fix karne ke liye) ---
function editSavedSlip(rowNumber) {
    const slip = currentSlipHistory.find(s => s.rowNumber === rowNumber);
    if (!slip || !slip.formData) {
        alert("Ye slip purani hai — isme edit ke liye zaroori data save nahi hai. Naya Loading Slip bana lein.");
        return;
    }

    let d;
    try { d = JSON.parse(slip.formData); } catch (e) {
        alert("Data padhne mein error aayi. Dubara try karein.");
        return;
    }

    showSection('loading-slip');

    // Sab fields wapas bhar do
    document.getElementById('slip_vNo').value = d.vNo || "";
    document.getElementById('slip_date').value = d.date || "";
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
    document.getElementById('slip_archiveRow').value = rowNumber; // Isse pata chalega ke Overwrite karna hai, nayi entry nahi

    calculateSlip();

    // Wizard step-by-step nahi — seedha Review/Full-view mein khol do taaki galti turant dikhe aur fix ho sake
    currentWizardStep = WIZARD_TOTAL_INPUT_STEPS + 1;
    renderWizardStep();
}

// --- DRIVE SE SLIPS LOAD KARNA ---
let currentSlipHistory = []; // Edit button ke liye cache (safe lookup, HTML attribute mein JSON embed nahi karna padta)

async function loadSlipHistory() {
    const container = document.getElementById('slipHistoryList');
    if (!container) return;
    
    // Yahan text change kiya gaya hai
    container.innerHTML = '<div class="text-center w-100 p-4"><div class="spinner-border text-danger spinner-border-sm"></div> Fetching Loading Slips...</div>';
    
    try {
        const response = await fetch(apiUrl("?action=listSlips"));
        const slips = await response.json();
        currentSlipHistory = slips || [];
        
        container.innerHTML = ""; 

        if (!slips || slips.length === 0) {
            container.innerHTML = '<div class="text-center w-100 p-5 text-muted">No Loading Slips found.</div>';
            return;
        }

        slips.forEach(slip => {
            container.insertAdjacentHTML('beforeend', `
                <div class="col-12 col-md-6 mb-2">
                    <div class="card shadow-sm border-0" style="border-radius:12px; border-left: 5px solid #dc3545;">
                        <div class="card-body p-2 px-3">
                            <div class="d-flex justify-content-between align-items-center">
                                <div class="text-truncate" style="max-width: 65%;">
                                    <h6 class="fw-bold mb-0" style="font-size:13px;">${slip.name}</h6>
                                    <small class="text-muted" style="font-size:10px;">${slip.date}</small>
                                </div>
                                <div class="d-flex gap-2">
                                    <a href="${slip.url}" target="_blank" class="btn btn-sm btn-light text-danger"><i class="bi bi-file-pdf"></i></a>
                                    <button class="btn btn-sm btn-outline-primary" onclick="editSavedSlip(${slip.rowNumber})"><i class="bi bi-pencil-square"></i></button>
                                    <button class="btn btn-sm btn-success" onclick="shareFileFromDrive('${slip.id}', '${slip.name}')"><i class="bi bi-whatsapp"></i></button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`);
        });
    } catch (e) {
        container.innerHTML = '<div class="alert alert-danger">Archive load failed.</div>';
    }
}

// --- DRIVE SE ASLI PDF FILE SHARE KARNA ---
// --- DRIVE SE PDF SHARE/DOWNLOAD KARNA (PRO VERSION) ---
async function shareFileFromDrive(fileId, fileName) {
    const originalBtn = event.currentTarget;
    const originalHtml = originalBtn.innerHTML;
    
    // UI Feedback: Loading dikhayein
    originalBtn.disabled = true;
    originalBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    try {
        // 1. Google Script se File Content mangwayein
        const response = await fetch(apiUrl(`?action=getFileContent&fileId=${fileId}`));
        if (!response.ok) throw new Error("Server response error");
        
        const base64Data = await response.text();
        if(!base64Data || base64Data.length < 100) throw new Error("Empty file data");

        // 2. Base64 ko Blob mein convert karein
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);

        // 3. File Object banayein (Share ke liye)
        const file = new File([blob], `${fileName}.pdf`, { type: 'application/pdf' });

        // 4. Try SHARE (Mobile Share Menu)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'KTC Loading Slip',
                text: 'Vehicle: ' + fileName
            });
        } 
        else {
            // 5. FALLBACK: Direct Download (Agar share support nahi hai)
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `${fileName}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            alert("Share system block hai. File DOWNLOAD ho gayi hai, ab aap bhej sakte hain.");
        }
    } catch (err) {
        console.error("Error:", err);
        alert("File load nahi ho saki. Internet check karein ya manual download karein.");
    } finally {
        originalBtn.disabled = false;
        originalBtn.innerHTML = originalHtml;
    }
}

// PDF View karne ke liye
function viewSlip(id) {
    const transaction = db.transaction(["slips"], "readonly");
    const store = transaction.objectStore("slips");
    store.get(id).onsuccess = (e) => {
        const fileURL = URL.createObjectURL(e.target.result.pdfBlob);
        window.open(fileURL, '_blank');
    };
}

// ASLI PDF FILE WHATSAPP PAR BHEJNA (Native Share)
async function shareActualFile(id) {
    const transaction = db.transaction(["slips"], "readonly");
    const store = transaction.objectStore("slips");
    
    store.get(id).onsuccess = async (e) => {
        const slip = e.target.result;
        const file = new File([slip.pdfBlob], `Slip_${slip.vNo}.pdf`, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: 'KTC Loading Slip',
                    text: `Loading Slip for Vehicle: ${slip.vNo}`
                });
            } catch (err) { console.error("Share failed", err); }
        } else {
            alert("Your browser does not support direct file sharing. Please 'View' and then download/share.");
        }
    };
}

// --- GAADI MASTER: VEHICLE LIST LOAD KARNA ---
// --- GAADI MASTER: VEHICLE LIST LOAD KARNA (Updated & Fixed) ---
async function loadVehicles() {
    const container = document.getElementById('vehicleCardsContainer');
    if(!container) return;

    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary spinner-border-sm"></div><br>Gaadiyan aur Documents Check ho rahe hain...</div>';
    
    try {
        // 1. Gaadiyon ki list aur Uploaded list dono ek saath mangwayein
        const [resVehicles, resUploaded] = await Promise.all([
            fetch(apiUrl("?action=getVehicles")),
            fetch(apiUrl("?action=getUploadedList"))
        ]);

        const allVehicles = await resVehicles.json();
        const uploadedList = await resUploaded.json();

        // Check if backend returned error or unauthorized
        if (!Array.isArray(allVehicles)) {
            container.innerHTML = `<div class="text-center p-4 text-danger">${allVehicles.error || "Session Expired. Please Login Again."}</div>`;
            return;
        }

        const cleanUploadedList = Array.isArray(uploadedList) 
            ? uploadedList.map(v => String(v).trim().toUpperCase()) 
            : [];

        // 2. Counters Calculate karein
        let done = 0;
        let pending = 0;
        container.innerHTML = '';

        if (allVehicles.length === 0) {
            container.innerHTML = '<div class="text-center p-4 text-muted">Koi Gaadi Record me nahi mili.</div>';
            return;
        }

        // Jinke documents upload hain unhe upar dikhao (Priority Sorting)
        const sortedVehicles = [...allVehicles].sort((a, b) => {
            const aUp = cleanUploadedList.includes(String(a).trim().toUpperCase());
            const bUp = cleanUploadedList.includes(String(b).trim().toUpperCase());
            if (aUp === bUp) return String(a).localeCompare(String(b));
            return aUp ? -1 : 1;
        });

        sortedVehicles.forEach((vNo) => {
            const cleanVNo = String(vNo).trim().toUpperCase();
            const safeId = cleanVNo.replace(/[^a-zA-Z0-9]/g, '_'); 
            const isUploaded = cleanUploadedList.includes(cleanVNo);
            
            if(isUploaded) done++; else pending++;

            // Status Badge
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
                        <div class="upload-drop-zone mb-3 text-center small text-muted"
                             ondragover="event.preventDefault(); this.classList.add('drag-over');"
                             ondragleave="this.classList.remove('drag-over');"
                             ondrop="handleFileDrop(event, '${safeAttr(cleanVNo)}')">
                            <i class="bi bi-cloud-arrow-up"></i> Document yahan drag-drop karein
                        </div>
                        <div id="docList_${safeId}" class="mb-3"></div>
                        <h6 class="fw-bold small border-bottom pb-1" style="color:#003366;"><i class="bi bi-clock-history"></i> Trip History</h6>
                        <div id="historyList_${safeId}" class="history-container small text-muted">Loading...</div>
                    </div>
                </div>
            `);
        });

        // Counters Update karein
        document.getElementById('count-done').innerText = done;
        document.getElementById('count-pending').innerText = pending;

    } catch (e) { 
        console.error("Vehicle Load Error:", e);
        container.innerHTML = '<div class="text-center p-3 text-danger">Error: Sheet connection fail ho gaya. Internet check karein.</div>'; 
    }
}

// Upload Trigger helper
function triggerUpload(safeId) { 
    const inp = document.getElementById(`file_${safeId}`);
    if (inp) inp.click(); 
}

// Fixed History Function with Formatted Dates & Accurate Commission
async function fetchVehicleHistory(vNo) {
    const safeId = vNo.replace(/[^a-zA-Z0-9]/g, '_');
    const histContainer = document.getElementById(`historyList_${safeId}`);
    const statsContainer = document.getElementById(`stats_${safeId}`);
    if (!histContainer) return;
    
    try {
        const res = await fetch(apiUrl(`?action=getVehicleHistory&vNo=${encodeURIComponent(vNo)}`));
        const history = await res.json();
        
        if(!Array.isArray(history) || history.length === 0) {
            histContainer.innerHTML = '<div class="text-center p-3 text-muted small">No trip history found for this vehicle</div>';
            if (statsContainer) statsContainer.innerHTML = '<div class="col-12 text-center small opacity-50">No Data</div>';
            return;
        }

        let totalBus = 0;
        let pendingAmt = 0;
        
        history.forEach(t => { 
            let amt = parseFloat(t['Amount'] || t['_tripAmount'] || 0) || 0;
            totalBus += amt;
            if(String(t['_status']).toLowerCase() !== 'yes') {
                let commission = parseFloat(String(t['_colK'] || t['Commission Amount'] || "0").replace(/[^0-9.]/g, '')) || 0;
                pendingAmt += (commission > 0 ? commission : amt);
            }
        });

        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="col-4">
                    <div class="p-2 border rounded bg-white shadow-sm">
                        <small class="d-block text-muted" style="font-size:9px">TOTAL TRIPS</small>
                        <b class="text-primary">${history.length}</b>
                    </div>
                </div>
                <div class="col-4">
                    <div class="p-2 border rounded bg-white shadow-sm">
                        <small class="d-block text-muted" style="font-size:9px">TOTAL FARE</small>
                        <b class="text-success">₹${totalBus.toLocaleString('en-IN')}</b>
                    </div>
                </div>
                <div class="col-4">
                    <div class="p-2 border rounded bg-white shadow-sm">
                        <small class="d-block text-muted" style="font-size:9px">PENDING</small>
                        <b class="text-danger">₹${pendingAmt.toLocaleString('en-IN')}</b>
                    </div>
                </div>
            `;
        }

        histContainer.innerHTML = history.map(trip => {
            const isRec = String(trip['_status']).toLowerCase() === 'yes';
            const cleanDate = formatDisplayDate(trip['Date']);
            const tripAmt = parseFloat(trip['Amount'] || trip['_tripAmount'] || 0) || 0;
            
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
                            <div class="fw-bold text-primary">₹${tripAmt.toLocaleString('en-IN')}</div>
                            <span class="badge ${isRec ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}" style="font-size: 9px;">
                                ${isRec ? 'RECEIVED' : 'PENDING'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            `;
        }).join('');

    } catch (e) { 
        console.error(e);
        histContainer.innerHTML = '<div class="text-danger small p-2">Failed to load history.</div>'; 
    }
}


// Toggle logic (Simple & Auto-load)
function toggleDetails(id, vNo) {
    const el = document.getElementById(id);
    if(el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        // Click karte hi apne aap load hoga
        fetchVehicleDocs(vNo);
        fetchVehicleHistory(vNo);
    } else {
        el.classList.add('hidden');
    }
}

// Data ko onclick="...('...')" ke andar surakshit tarike se daalne ke liye
// (agar naam mein ' ya " ho toh ye HTML/JS ko tootne se bachata hai)
function safeAttr(val) {
    return String(val == null ? "" : val)
        .replace(/&/g, "&amp;")
        .replace(/'/g, "&#39;")
        .replace(/"/g, "&quot;");
}

// ================= DAILY FOLLOW-UP (Pending Commission Roz Ka Reminder) =================
// Saare ABHI TAK PENDING trips ko phone number ke hisaab se group karta hai (jitne bhi
// vehicles/trips ek driver/owner ke pending hain, sab jodkar), taaki roz subah ek hi jagah se
// sabko WhatsApp bhej sakein ya call kar sakein — bina kisi paid API/service ke.
let _followupGroups = {};

async function loadDailyFollowup() {
    const container = document.getElementById('followupCardsContainer');
    if (!container) return;
    container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary spinner-border-sm"></div><br>Pending Calculate ho raha hai...</div>';

    // Agar data abhi tak load nahi hua (page turant khola ho), fresh mangwa lo
    if (!allTripsData || allTripsData.length === 0) {
        try {
            const res = await fetch(apiUrl());
            allTripsData = await res.json();
        } catch (e) {
            container.innerHTML = '<div class="text-center p-3 text-danger">Data load nahi ho saka. Internet check karke Refresh dabayein.</div>';
            return;
        }
    }

    _followupGroups = {};

    allTripsData.forEach(t => {
        const isCollected = (String(t['_colG'] || "").toLowerCase().trim() === "yes");
        if (isCollected) return;

        // ✅ COMMISSION AMOUNT USE KARO ✅ (Column K: Commission Amount)
        // Agar commission amount set hai to use karo, nahi to trip Amount use karo
        // Clean string values (remove spaces, commas, etc) before parsing
        const commissionAmt = parseFloat(String(t['_colK'] || "0").replace(/[^\d.]/g, '')) || 0;
        const tripAmt = parseFloat(String(t['Amount'] || t['_tripAmount'] || "0").replace(/[^\d.]/g, '')) || 0;
        const amt = commissionAmt > 0 ? commissionAmt : tripAmt;
        
        // DEBUG: Check if amounts are 0
        if (amt <= 0) {
            console.log(`⚠️ Skipping trip: vNo=${t['Vehicle No']}, commission=${commissionAmt}, amount=${tripAmt}`);
            return;
        }

        // Owner number ko priority do — taaki ek hi owner ki saari gaadiyan EK card mein group ho jayein.
        // Agar owner ka number nahi hai, tabhi driver number use karo (warna wo trip kisi group mein nahi aayega).
        const driverPhone = String(t['Driver No'] || "").replace(/\D/g, '').slice(-10);
        const ownerPhone = String(t['_owner'] || "").replace(/\D/g, '').slice(-10);
        const phone = ownerPhone.length === 10 ? ownerPhone : (driverPhone.length === 10 ? driverPhone : "");
        if (!phone) return; // Bina number ke message/call nahi ja sakta

        // Party Name yahan jaan-boojhkar NAHI liya — wo sirf maal bhejne wale ka naam hota hai,
        // gaadi Owner/Driver ka nahi. Agar Owner ka naam missing ho to Driver Name par jao, warna Vehicle No dikhao.
        const name = t['Lorry Owner Name'] || t['Driver Name'] || t['Vehicle No'];

        if (!_followupGroups[phone]) {
            _followupGroups[phone] = { 
                phone, name, 
                vehicles: new Set(), 
                totalAmt: 0, 
                oldestDate: null, 
                trips: [],
                commissionByVehicle: {} // 🆕 Vehicle-wise commission breakdown
            };
        }
        const g = _followupGroups[phone];
        const numAmt = parseFloat(amt) || 0; // Ensure it's a number
        g.totalAmt += numAmt;
        const vNo = t['Vehicle No'];
        g.vehicles.add(vNo);
        g.trips.push(t);
        
        // 🆕 Track commission amount per vehicle (for detailed message breakdown)
        if (!g.commissionByVehicle[vNo]) g.commissionByVehicle[vNo] = [];
        g.commissionByVehicle[vNo].push({ trip: t, amount: numAmt });

        const d = parseSheetDate(t['Date']);
        if (d && (!g.oldestDate || d < g.oldestDate)) g.oldestDate = d;
    });

    // Sabse zyada pending amount wale sabse upar
    const list = Object.values(_followupGroups).sort((a, b) => b.totalAmt - a.totalAmt);

    console.log("🔍 DEBUG - Followup Groups:", _followupGroups);
    console.log("🔍 DEBUG - Total groups found:", list.length);
    console.log("🔍 DEBUG - Total amount:", list.reduce((s, g) => s + g.totalAmt, 0));

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

// "Aaj kisko msg/call gaya" — device ke localStorage mein track karta hai, roz naya din aate hi reset ho jaata hai
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
    loadDailyFollowup(); // List refresh taaki card green ho jaye
}

// Ek party ke SAARE pending trips jodkar ek WhatsApp message banata hai aur bhejta hai
// 🆕 Saari gaadiyon ke commission amounts ko aggregate karke bhejta hai
function sendFollowupWhatsapp(phone) {
    const g = _followupGroups[phone];
    if (!g) return;

    const cleanPhone = formatWhatsAppPhone(phone);
    if (cleanPhone.length < 12) {
        alert("⚠️ Ye number sahi format mein nahi hai: " + phone);
        return;
    }

    // 🆕 Vehicle-wise commission breakdown banao
    let historyList = "";
    const vehicles = Object.keys(g.commissionByVehicle);
    
    if (vehicles.length > 1) {
        // ✅ Agar multiple vehicles hain, to har vehicle ke commission separately dikhaao
        historyList += `📍 *COMMISSION BREAKDOWN (Multiple Vehicles):*\n\n`;
        vehicles.forEach(vNo => {
            const trips = g.commissionByVehicle[vNo];
            let vTotal = 0;
            let vDetails = "";
            
            trips.forEach(item => {
                const t = item.trip;
                const a = item.amount;
                vTotal += a;
                const dt = t['Date'] || "No Date";
                const f = String(t['From'] || "N/A").replace(/&/g, "and");
                const rt = String(t['To'] || "N/A").replace(/&/g, "and");
                vDetails += `   • (${dt}) ${f} ➔ ${rt}: ₹${a.toLocaleString('en-IN')}\n`;
            });
            
            historyList += `🚗 *${vNo}*: ₹${vTotal.toLocaleString('en-IN')}\n${vDetails}\n`;
        });
    } else {
        // ✅ Single vehicle - simple format
        const trips = g.commissionByVehicle[vehicles[0]] || [];
        historyList += `🚗 *${vehicles[0]}* - Pending Commissions:\n\n`;
        trips.forEach(item => {
            const t = item.trip;
            const a = item.amount;
            const dt = t['Date'] || "No Date";
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

    try {
        window.location.href = whatsappURL;
    } catch (e) {
        window.open(whatsappURL, '_blank');
    }
}

function formatINR(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
}

// =========================================================================
// VEHICLE NUMBER AUTO-FORMATTER (Live Typing Format: MH 20 AC 0000)
// =========================================================================

function formatIndianVehicleNumber(val) {
    // 1. Sirf letters aur numbers ko rakho, baaki sab hata do (spaces, dashes, etc.)
    let cleanStr = val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    let res = "";
    
    // 2. State Code (e.g., MH)
    if (cleanStr.length > 0) res += cleanStr.substring(0, 2); 
    
    // 3. RTO Code (e.g., 20)
    if (cleanStr.length > 2) res += " " + cleanStr.substring(2, 4); 
    
    // 4. Series & Number
    if (cleanStr.length > 4) {
        let remaining = cleanStr.substring(4);
        let letters = remaining.match(/^[A-Z]+/); // Gaadi ki series dhoondho (e.g., AC)
        
        if (letters) {
            res += " " + letters[0];
            let numbers = remaining.substring(letters[0].length);
            if (numbers) {
                res += " " + numbers.substring(0, 4); // Aakhri 4 digit (e.g., 1234)
            }
        } else {
            // Agar series nahi hai, seedhe number hain
            res += " " + remaining.substring(0, 4);
        }
    }
    return res;
}

// App mein jahan bhi gaadi number ki fields hain, unpar ye auto-apply ho jayega
document.addEventListener('input', function(e) {
    // Ye un sabhi IDs ki list hai jahan Gaadi Number type hota hai
    const vNoFields = ['vNo', 'slipSearchVNo', 'slip_vNo', 'vSearch'];
    
    if (vNoFields.includes(e.target.id)) {
        // Jese hi user type karega, value format hokar wapas input me set ho jayegi
        e.target.value = formatIndianVehicleNumber(e.target.value);
    }
});