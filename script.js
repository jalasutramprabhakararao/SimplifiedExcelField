// Simple Excel Card App: script.js
// Uses SheetJS via CDN for Excel parsing
// Handles localStorage with expiration, dynamic card rendering, search, and offline usability

const DB_NAME = 'excel_card_db';
const DB_STORE = 'excel_data';
const FILE_KEY = 'excel_card_file'; // Only used as key in IndexedDB
const CONFIG_KEY = 'excel_card_config';
const EXPIRY_KEY = 'excel_card_expiry';
const EXPIRY_DAYS = 30;

let excelData = [];
let selectedFields = [];

// --- IndexedDB helpers ---
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function(e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.createObjectStore(DB_STORE);
            }
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function(e) { reject(e.target.error); };
    });
}
async function saveExcelToDB(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        store.put(data, FILE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error);
    });
}
async function loadExcelFromDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.get(FILE_KEY);
        req.onsuccess = e => resolve(e.target.result || null);
        req.onerror = e => reject(e.target.error);
    });
}
async function clearExcelDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        store.delete(FILE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error);
    });
}

const fileInput = document.getElementById('excel-file');
const fileError = document.getElementById('file-error');
const columnSection = document.getElementById('column-select-section');
const columnForm = document.getElementById('column-form');
const saveColumnsBtn = document.getElementById('save-columns');
const searchSection = document.getElementById('search-section');
const searchInput = document.getElementById('search-input');
const cardsSection = document.getElementById('cards-section');
const noMatches = document.getElementById('no-matches');

// Utility: Set expiry in localStorage
function setExpiry() {
    const now = new Date();
    const expiry = now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(EXPIRY_KEY, expiry);
}

// Utility: Check and clear expired data
async function checkExpiry() {
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (expiry && Date.now() > parseInt(expiry, 10)) {
        await clearExcelDB();
        localStorage.removeItem(CONFIG_KEY);
        localStorage.removeItem(EXPIRY_KEY);
        return true;
    }
    return false;
}

// Utility: Save data to IndexedDB, config to localStorage
async function saveToStorage(data, fields) {
    await saveExcelToDB(data);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(fields));
    setExpiry();
}

// Utility: Load from IndexedDB/localStorage
async function loadFromStorage() {
    if (await checkExpiry()) return null;
    const config = localStorage.getItem(CONFIG_KEY);
    const data = await loadExcelFromDB();
    if (data && config) {
        try {
            return {
                data,
                fields: JSON.parse(config)
            };
        } catch {
            return null;
        }
    }
    return null;
}

// Utility: Parse Excel file using SheetJS
function parseExcel(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(firstSheet, {defval: ''});
            callback(null, json);
        } catch (err) {
            callback(err);
        }
    };
    reader.onerror = function() {
        callback(new Error('Failed to read file.'));
    };
    reader.readAsArrayBuffer(file);
}

// UI: Show column selection
function showColumnSelection(columns) {
    columnForm.innerHTML = '';
    columns.forEach(col => {
        const id = 'col-' + col.replace(/\W+/g, '-');
        const label = document.createElement('label');
        label.htmlFor = id;
        label.innerText = col;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.name = 'columns';
        checkbox.value = col;
        checkbox.checked = true;
        label.prepend(checkbox);
        columnForm.appendChild(label);
    });
    columnSection.style.display = '';
}

// Helper: Detect if a field contains 'registratio' (case-insensitive, partial match, not requiring 'n' at the end)
function isRegistrationField(fieldName) {
    return fieldName.toLowerCase().includes('registratio');
}

// --- Virtualized Card Rendering ---
const CARDS_PER_PAGE = 30;
let lastMatches = [];
let lastFields = [];
let lastSearchTerm = '';
let currentPage = 1;
let loadMoreBtn = null;
const CHUNK_SIZE = 10; // cards per rendering chunk
const loadingSpinner = document.getElementById('loading-spinner');

function clearLoadMoreBtn() {
    if (loadMoreBtn && loadMoreBtn.parentNode) {
        loadMoreBtn.parentNode.removeChild(loadMoreBtn);
    }
    loadMoreBtn = null;
}

function showSpinner(show) {
    if (loadingSpinner) loadingSpinner.style.display = show ? '' : 'none';
}

function renderCards(data, fields, searchTerm = '') {
    cardsSection.innerHTML = '';
    clearLoadMoreBtn();
    let matches = data;
    const term = (searchTerm || '').toLowerCase().trim();
    // Only allow search in registration fields
    const regFields = fields.filter(isRegistrationField);
    if (term && regFields.length > 0) {
        matches = data.filter(row =>
            regFields.some(field =>
                String(row[field] || '').toLowerCase().includes(term)
            )
        );
    }
    if (!matches.length) {
        noMatches.style.display = '';
        showSpinner(false);
        return;
    } else {
        noMatches.style.display = 'none';
    }
    lastMatches = matches;
    lastFields = fields;
    lastSearchTerm = searchTerm;
    currentPage = 1;
    renderCardsPage();
}

function renderCardsPage() {
    cardsSection.innerHTML = '';
    clearLoadMoreBtn();
    showSpinner(true);
    const end = currentPage * CARDS_PER_PAGE;
    const toShow = lastMatches.slice(0, end);
    let i = 0;
    function renderChunk() {
        const chunkEnd = Math.min(i + CHUNK_SIZE, toShow.length);
        for (; i < chunkEnd; i++) {
            const row = toShow[i];
            const card = document.createElement('div');
            card.className = 'card';
            lastFields.forEach(field => {
                const value = row[field] || '';
                const fieldDiv = document.createElement('div');
                fieldDiv.innerHTML = `<strong>${field}:</strong> ${value}`;
                card.appendChild(fieldDiv);
            });
            cardsSection.appendChild(card);
        }
        if (i < toShow.length) {
            if (window.requestIdleCallback) {
                requestIdleCallback(renderChunk);
            } else {
                requestAnimationFrame(renderChunk);
            }
        } else {
            showSpinner(false);
            if (lastMatches.length > end) {
                loadMoreBtn = document.createElement('button');
                loadMoreBtn.id = 'load-more-btn';
                loadMoreBtn.textContent = 'Load More';
                loadMoreBtn.onclick = function() {
                    currentPage++;
                    renderCardsPage();
                };
                cardsSection.parentNode.insertBefore(loadMoreBtn, cardsSection.nextSibling);
            }
        }
    }
    renderChunk();
}

// --- Debounced Search ---
let searchDebounceTimer = null;
searchInput.addEventListener('input', function(e) {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    const term = (e.target.value || '').toLowerCase().trim();
    searchDebounceTimer = setTimeout(() => {
        renderCards(excelData, selectedFields, term);
    }, 200);
});


// Handle file upload
fileInput.addEventListener('change', function(e) {
    fileError.textContent = '';
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.xlsx')) {
        fileError.textContent = 'Please upload a valid .xlsx file.';
        return;
    }
    parseExcel(file, (err, data) => {
        if (err) {
            fileError.textContent = 'Failed to parse Excel file.';
            return;
        }
        if (!data.length) {
            fileError.textContent = 'Excel file is empty or invalid.';
            return;
        }
        excelData = data;
        const columns = Object.keys(data[0]);
        showColumnSelection(columns);
    });
});

// Handle column selection save
saveColumnsBtn.addEventListener('click', async function(e) {
    e.preventDefault();
    const checked = Array.from(columnForm.querySelectorAll('input[type="checkbox"]:checked'));
    if (!checked.length) {
        alert('Please select at least one field.');
        return;
    }
    selectedFields = checked.map(cb => cb.value);
    try {
        await saveToStorage(excelData, selectedFields);
    } catch (err) {
        alert('Failed to save data: ' + (err && err.message ? err.message : err));
        return;
    }
    columnSection.style.display = 'none';
    searchSection.style.display = '';
    renderCards(excelData, selectedFields);
});

// Handle search
searchInput.addEventListener('input', function(e) {
    const term = e.target.value;
    renderCards(excelData, selectedFields, term);
});

// --- Dark Mode Logic ---
const darkModeToggle = document.getElementById('dark-mode-toggle');

function setDarkMode(enabled) {
    document.body.classList.toggle('dark-mode', enabled);
    if (darkModeToggle) {
        darkModeToggle.textContent = enabled ? '☀️' : '🌙';
    }
    localStorage.setItem('excel_card_darkmode', enabled ? '1' : '0');
}

function restoreDarkMode() {
    const dm = localStorage.getItem('excel_card_darkmode');
    setDarkMode(dm === '1');
}

if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        const enabled = !document.body.classList.contains('dark-mode');
        setDarkMode(enabled);
    });
}

// --- Enhanced Search Function ---
searchInput.addEventListener('input', function(e) {
    const term = (e.target.value || '').toLowerCase().trim();
    renderCards(excelData, selectedFields, term);
});

// On load: try to restore from storage and dark mode
window.addEventListener('DOMContentLoaded', async () => {
    restoreDarkMode();
    const stored = await loadFromStorage();
    if (stored && stored.data && stored.fields) {
        excelData = stored.data;
        selectedFields = stored.fields;
        columnSection.style.display = 'none';
        searchSection.style.display = '';
        renderCards(excelData, selectedFields);
    }
});

// Optional: Register service worker for offline usability (if supported)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}
