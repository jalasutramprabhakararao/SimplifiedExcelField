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
const searchFieldSelect = document.getElementById('search-field');

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
    selectedFields = [];
    columnForm.innerHTML = '';
    
    columns.forEach((column, index) => {
        const fieldId = `col-${index}`;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = fieldId;
        checkbox.value = column;
        checkbox.checked = true;
        
        const label = document.createElement('label');
        label.htmlFor = fieldId;
        label.textContent = column;
        
        const div = document.createElement('div');
        div.className = 'checkbox-container';
        div.appendChild(checkbox);
        div.appendChild(label);
        
        columnForm.appendChild(div);
        selectedFields.push(column);
    });
    
    // Update search fields dropdown
    updateSearchFields(columns);
    
    columnSection.style.display = 'block';
    searchSection.style.display = 'block';
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

// --- Search Functionality ---
let availableFields = [];

// Update available fields when columns are selected
function updateSearchFields(fields) {
    availableFields = fields;
    const searchField = document.getElementById('search-field');
    
    // Save current selection
    const currentValue = searchField.value;
    
    // Clear existing options except the first one ("All Fields")
    while (searchField.options.length > 1) {
        searchField.remove(1);
    }
    
    // Add new field options
    fields.forEach(field => {
        const option = document.createElement('option');
        option.value = field;
        option.textContent = field;
        searchField.appendChild(option);
    });
    
    // Restore selection if it still exists
    if (fields.includes(currentValue)) {
        searchField.value = currentValue;
    }
}

// Enhanced search function with field selection
function searchData(data, searchTerm, searchField = 'all') {
    if (!searchTerm.trim()) return data;
    
    const searchTermLower = searchTerm.toLowerCase();
    
    return data.filter(item => {
        if (searchField === 'all') {
            // Search in all selected fields
            return selectedFields.some(field => {
                const value = String(item[field] || '').toLowerCase();
                return value.includes(searchTermLower);
            });
        } else {
            // Search in specific field
            const value = String(item[searchField] || '').toLowerCase();
            return value.includes(searchTermLower);
        }
    });
}

// Update the search event listener
let searchDebounceTimer = null;
searchInput.addEventListener('input', function(e) {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    
    searchDebounceTimer = setTimeout(() => {
        const searchTerm = e.target.value.trim();
        const selectedField = searchFieldSelect.value;
        
        if (searchTerm) {
            const filteredData = searchData(excelData, searchTerm, selectedField);
            lastMatches = filteredData;
            lastFields = selectedFields;
            renderCards(filteredData, selectedFields, searchTerm);
        } else {
            lastMatches = excelData;
            lastFields = selectedFields;
            renderCards(excelData, selectedFields);
        }
        
        // Show/hide no matches message
        noMatches.style.display = searchTerm && lastMatches.length === 0 ? 'block' : 'none';
    }, 200); // Slightly reduced debounce time for better responsiveness
});

// Handle field selection change
searchFieldSelect.addEventListener('change', function() {
    const searchTerm = searchInput.value.trim();
    if (searchTerm) {
        const filteredData = searchData(excelData, searchTerm, this.value);
        lastMatches = filteredData;
        renderCards(filteredData, selectedFields, searchTerm);
        noMatches.style.display = filteredData.length === 0 ? 'block' : 'none';
    }
});

// --- Debounced Search ---
// searchInput.addEventListener('input', function(e) {
//     const term = e.target.value;
//     renderCards(excelData, selectedFields, term);
// });

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

// --- Permission Checks ---
const permissionsModal = document.getElementById('permissions-modal');
const permissionList = document.getElementById('permission-list');
const checkAgainBtn = document.getElementById('check-permissions-again');
const continueAnywayBtn = document.getElementById('continue-anyway');

function getPermissionStatus() {
    const permissions = [];
    
    // Check File API
    permissions.push({
        id: 'file-api',
        title: 'File Upload',
        description: 'Required to upload Excel files',
        granted: !!(window.File && window.FileReader && window.FileList && window.Blob),
        action: 'This is built into your browser. Try updating your browser if not supported.'
    });
    
    // Check localStorage
    let localStorageGranted = true;
    try {
        const testKey = '__test_storage__';
        localStorage.setItem(testKey, 'test');
        localStorage.removeItem(testKey);
    } catch (e) {
        localStorageGranted = false;
    }
    
    permissions.push({
        id: 'local-storage',
        title: 'Local Storage',
        description: 'Required to save your preferences and settings',
        granted: localStorageGranted,
        action: 'Enable cookies and site data in your browser settings'
    });
    
    // Check IndexedDB
    permissions.push({
        id: 'indexeddb',
        title: 'Database Storage',
        description: 'Required to store large Excel files locally',
        granted: !!window.indexedDB,
        action: 'Enable database storage in your browser settings'
    });
    
    return permissions;
}

function renderPermissionModal(permissions) {
    permissionList.innerHTML = '';
    
    permissions.forEach(perm => {
        const item = document.createElement('div');
        item.className = `permission-item ${perm.granted ? 'granted' : ''}`;
        
        item.innerHTML = `
            <div class="permission-info">
                <div class="permission-title">${perm.title}</div>
                <div class="permission-desc">${perm.description}</div>
            </div>
            <button class="permission-btn" ${perm.granted ? 'disabled' : ''} 
                    onclick="handlePermissionAction('${perm.id}', '${perm.action}')">
                ${perm.granted ? 'Enabled' : 'Enable'}
            </button>
        `;
        
        permissionList.appendChild(item);
    });
}

function handlePermissionAction(permId, action) {
    switch(permId) {
        case 'local-storage':
            openStorageSettings();
            break;
        case 'indexeddb':
            openStorageSettings();
            break;
        case 'file-api':
            alert(`File API support depends on your browser version.\n\n${action}\n\nAfter updating, click "Check Again" to verify.`);
            break;
        default:
            alert(`To enable ${permId}:\n\n${action}\n\nAfter making changes, click "Check Again" to verify.`);
    }
}

function openStorageSettings() {
    const userAgent = navigator.userAgent.toLowerCase();
    let settingsUrl = '';
    
    if (userAgent.includes('chrome') && !userAgent.includes('edg')) {
        // Chrome
        settingsUrl = 'chrome://settings/content/cookies';
    } else if (userAgent.includes('firefox')) {
        // Firefox
        settingsUrl = 'about:preferences#privacy';
    } else if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
        // Safari
        alert('To enable storage in Safari:\n\n1. Open Safari menu > Preferences\n2. Go to Privacy tab\n3. Uncheck "Prevent cross-site tracking"\n4. Under "Cookies and website data" select "Allow from websites I visit"\n\nAfter making changes, click "Check Again" to verify.');
        return;
    } else if (userAgent.includes('edg')) {
        // Edge
        settingsUrl = 'edge://settings/content/cookies';
    } else {
        // Generic instructions for unknown browsers
        alert('To enable storage permissions:\n\n1. Open your browser settings\n2. Look for Privacy or Content settings\n3. Find Cookies or Site Data settings\n4. Allow cookies and site data for this website\n5. Ensure JavaScript is enabled\n\nAfter making changes, click "Check Again" to verify.');
        return;
    }
    
    try {
        // Try to open the settings page
        window.open(settingsUrl, '_blank');
        
        // Show additional instructions
        setTimeout(() => {
            alert('Browser settings opened in a new tab.\n\nLook for:\n• Cookies and site data settings\n• Allow cookies for this site\n• Enable JavaScript\n\nAfter making changes, return here and click "Check Again".');
        }, 500);
    } catch (error) {
        // Fallback if opening settings fails
        alert('Unable to open browser settings automatically.\n\nPlease manually:\n1. Open your browser settings\n2. Go to Privacy/Content settings\n3. Allow cookies and site data\n4. Enable JavaScript\n\nAfter making changes, click "Check Again" to verify.');
    }
}

function checkRequiredPermissions() {
    const permissions = getPermissionStatus();
    const hasIssues = permissions.some(p => !p.granted);
    
    if (hasIssues) {
        renderPermissionModal(permissions);
        permissionsModal.style.display = 'flex';
        return false;
    }
    
    return true;
}

function hidePermissionsModal() {
    permissionsModal.style.display = 'none';
}

// Permission modal event listeners
if (checkAgainBtn) {
    checkAgainBtn.addEventListener('click', () => {
        const permissions = getPermissionStatus();
        const hasIssues = permissions.some(p => !p.granted);
        
        if (!hasIssues) {
            hidePermissionsModal();
            initializeApp();
        } else {
            renderPermissionModal(permissions);
        }
    });
}

if (continueAnywayBtn) {
    continueAnywayBtn.addEventListener('click', () => {
        hidePermissionsModal();
        initializeApp();
    });
}

function initializeApp() {
    restoreDarkMode();
    loadFromStorage().then(stored => {
        if (stored && stored.data && stored.fields) {
            excelData = stored.data;
            selectedFields = stored.fields;
            columnSection.style.display = 'none';
            searchSection.style.display = '';
            renderCards(excelData, selectedFields);
        }
    });
}

// On load: check permissions, then initialize app
window.addEventListener('DOMContentLoaded', () => {
    // Check required permissions first
    if (checkRequiredPermissions()) {
        // All permissions granted, initialize app immediately
        initializeApp();
    }
    // If permissions are missing, modal will be shown and user can check again
});

// Optional: Register service worker for offline usability (if supported)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}
