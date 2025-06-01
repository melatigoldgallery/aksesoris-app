// Import Firebase modules
import { firestore } from './configFirebase.js';
import { 
    collection, doc, getDoc, getDocs, setDoc, updateDoc, 
    query, where, orderBy, limit, Timestamp, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

// Define stock categories and item types
const categories = ['brankas', 'admin', 'barang-rusak', 'posting', 'batu-lepas'];
const itemTypes = ['KALUNG', 'LIONTIN', 'ANTING', 'CINCIN', 'HALA', 'GELANG', 'GIWANG'];

// Cache management variables
let stockData = {};
let lastFetchTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const CACHE_KEY = 'stockDataCache';
const HISTORY_RETENTION_DAYS = 7; // Hanya simpan riwayat 7 hari
const MAX_HISTORY_RECORDS = 10; // Maksimal 10 riwayat per item

// Initialize cache from localStorage
function initializeCache() {
    try {
        const cachedData = localStorage.getItem(CACHE_KEY);
        if (cachedData) {
            const parsedData = JSON.parse(cachedData);
            stockData = parsedData.data || {};
            lastFetchTime = parsedData.timestamp || null;
        }
    } catch (error) {
        console.error('Error initializing cache:', error);
        // If cache is corrupted, reset it
        localStorage.removeItem(CACHE_KEY);
    }
}

// Update cache in localStorage
function updateCache() {
    try {
        const cacheData = {
            timestamp: Date.now(),
            data: stockData
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
        console.error('Error updating cache:', error);
    }
}

// Check if cache is valid
function isCacheValid() {
    return lastFetchTime && (Date.now() - lastFetchTime < CACHE_DURATION);
}

// Function to clean and limit history
function cleanAndLimitHistory(data) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - HISTORY_RETENTION_DAYS);
    const cutoffTime = cutoffDate.getTime();
    
    // Process each category and item
    Object.keys(data).forEach(category => {
        Object.keys(data[category]).forEach(type => {
            if (data[category][type].history && Array.isArray(data[category][type].history)) {
                // First, filter out history entries older than cutoff date
                let filteredHistory = data[category][type].history.filter(entry => {
                    const entryDate = new Date(entry.date).getTime();
                    return entryDate >= cutoffTime;
                });
                
                // Sort by date (newest first) to ensure we keep the most recent entries
                filteredHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                // Limit to maximum number of records
                if (filteredHistory.length > MAX_HISTORY_RECORDS) {
                    filteredHistory = filteredHistory.slice(0, MAX_HISTORY_RECORDS);
                }
                
                // Update the history array
                data[category][type].history = filteredHistory;
            }
        });
    });
    
    return data;
}

// Function to add history entry with automatic cleanup
function addHistoryEntry(item, historyEntry) {
    // Initialize history array if it doesn't exist
    if (!item.history) {
        item.history = [];
    }
    
    // Add new entry at the beginning
    item.history.unshift(historyEntry);
    
    // Sort by date (newest first) to ensure proper ordering
    item.history.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Apply time-based filtering
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - HISTORY_RETENTION_DAYS);
    const cutoffTime = cutoffDate.getTime();
    
    item.history = item.history.filter(entry => {
        const entryDate = new Date(entry.date).getTime();
        return entryDate >= cutoffTime;
    });
    
    // Limit to maximum number of records (keep only the most recent)
    if (item.history.length > MAX_HISTORY_RECORDS) {
        item.history = item.history.slice(0, MAX_HISTORY_RECORDS);
    }
    
    return item.history;
}

// Function to fetch data from Firestore
async function fetchStockData() {
    try {
        // If cache is valid, use cached data
        if (isCacheValid()) {
            console.log('Using cached data');
            return stockData;
        }

        console.log('Fetching fresh data from Firestore');
        const stocksRef = collection(firestore, 'stocks');
        const snapshot = await getDocs(stocksRef);
        
        // Initialize data structure if no data exists
        if (snapshot.empty) {
            await initializeFirestoreData();
            return stockData;
        }

        // Process Firestore data
        stockData = {};
        snapshot.forEach(doc => {
            const categoryData = doc.data();
            stockData[doc.id] = categoryData;
        });
        
        // Clean and limit history entries
        stockData = cleanAndLimitHistory(stockData);
        
        // Update Firestore with cleaned data
        await updateFirestoreWithCleanedData();
        
        // Update cache timestamp and save to localStorage
        lastFetchTime = Date.now();
        updateCache();
        
        return stockData;
    } catch (error) {
        console.error('Error fetching stock data:', error);
        // If fetch fails, use cached data if available
        return stockData;
    }
}

// Update Firestore with cleaned data
async function updateFirestoreWithCleanedData() {
    try {
        // Only update if we have data
        if (Object.keys(stockData).length === 0) return;
        
        // Update each category
        for (const category of Object.keys(stockData)) {
            const categoryRef = doc(firestore, 'stocks', category);
            await updateDoc(categoryRef, stockData[category]);
        }
        
        console.log('Cleaned and limited history entries in Firestore');
    } catch (error) {
        console.error('Error updating Firestore with cleaned data:', error);
    }
}

// Initialize Firestore with default data structure
async function initializeFirestoreData() {
    try {
        // Create initial data structure
        categories.forEach(async (category) => {
            const categoryData = {};
            
            itemTypes.forEach(type => {
                categoryData[type] = {
                    quantity: 0,
                    lastUpdated: null,
                    history: []
                };
            });
            
            // Save to Firestore
            await setDoc(doc(firestore, 'stocks', category), categoryData);
            stockData[category] = categoryData;
        });
        
        // Update cache
        lastFetchTime = Date.now();
        updateCache();
    } catch (error) {
        console.error('Error initializing Firestore data:', error);
    }
}

// Function to save data to Firestore
async function saveData(category, type) {
    try {
        // Only update the specific category document
        const categoryRef = doc(firestore, 'stocks', category);
        
        // Get current data to ensure we're not overwriting other changes
        const currentDoc = await getDoc(categoryRef);
        
        if (currentDoc.exists()) {
            // Update only the changed item type
            const updateData = {};
            updateData[type] = stockData[category][type];
            
            await updateDoc(categoryRef, updateData);
        } else {
            // If document doesn't exist, create it
            await setDoc(categoryRef, stockData[category]);
        }
        
        // Update cache
        updateCache();
    } catch (error) {
        console.error('Error saving data to Firestore:', error);
        // Show error to user
        alert('Terjadi kesalahan saat menyimpan data. Silakan coba lagi.');
    }
}

// Function to format date
function formatDate(date) {
    if (!date) return '-';
    
    const d = new Date(date);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// Function to populate tables
async function populateTables() {
    // Fetch latest data (or use cache if valid)
    await fetchStockData();
    
    categories.forEach(category => {
        const tableBody = document.getElementById(`${category}-table-body`);
        if (!tableBody) return; // Skip if table body doesn't exist
        
        tableBody.innerHTML = '';
        
        if (!stockData[category]) {
            console.warn(`No data found for category: ${category}`);
            return;
        }
        
        let index = 1;
        itemTypes.forEach(type => {
            const item = stockData[category][type];
            if (!item) return; // Skip if item doesn't exist
            
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td>${index}</td>
                <td>${type}</td>
                <td>${item.quantity}</td>
                <td>${item.lastUpdated ? formatDate(item.lastUpdated) : '-'}</td>
                <td>
                    <button class="btn btn-sm btn-info view-history" 
                            data-category="${category}" 
                            data-type="${type}">
                        <i class="fas fa-history"></i> Lihat
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
            index++;
        });
    });
    
    // Add event listeners to history buttons
    document.querySelectorAll('.view-history').forEach(button => {
        button.addEventListener('click', function() {
            const category = this.getAttribute('data-category');
            const type = this.getAttribute('data-type');
            showHistory(category, type);
        });
    });
    
    // Update summary totals
    updateSummaryTotals();
}

// Function to update summary totals
function updateSummaryTotals() {
    itemTypes.forEach(type => {
        let total = 0;
        categories.forEach(category => {
            if (stockData[category] && stockData[category][type]) {
                total += stockData[category][type].quantity;
            }
        });
        
        const totalElement = document.getElementById(`total-${type.toLowerCase()}`);
        if (totalElement) {
            totalElement.textContent = total;
        }
    });
}

// Function to show history in modal
function showHistory(category, type) {
    const historyTitle = document.getElementById('history-title');
    const historyTableBody = document.getElementById('history-table-body');
    
    historyTitle.textContent = `${type} (${category.toUpperCase()})`;
    historyTableBody.innerHTML = '';
    
    const history = stockData[category][type].history;
    
    if (!history || history.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="5" class="text-center">Tidak ada riwayat</td>';
        historyTableBody.appendChild(row);
    } else {
        // Sort history by date (newest first) before displaying
        const sortedHistory = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        sortedHistory.forEach((record, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatDate(record.date)}</td>
                <td>${record.action}</td>
                <td>${record.quantity}</td>
                <td>${record.action === 'Tambah' ? record.adder : record.reducer}</td>
                <td>${record.action === 'Tambah' ? record.receiver : record.notes}</td>
            `;
            historyTableBody.appendChild(row);
        });
        
        // Add info about history limit
        if (history.length >= MAX_HISTORY_RECORDS) {
            const infoRow = document.createElement('tr');
            infoRow.innerHTML = `
                <td colspan="5" class="text-center text-muted small">
                    <i class="fas fa-info-circle me-1"></i>
                    Menampilkan ${MAX_HISTORY_RECORDS} riwayat terbaru
                </td>
            `;
            historyTableBody.appendChild(infoRow);
        }
    }
    
    const historyModal = new bootstrap.Modal(document.getElementById('historyModal'));
    historyModal.show();
}

// Function to add stock
async function addStock(category, type, quantity, adder, receiver) {
    // Ensure we have the latest data
    await fetchStockData();
    
    if (!stockData[category] || !stockData[category][type]) {
        alert('Kategori atau jenis barang tidak ditemukan.');
        return;
    }
    
    const item = stockData[category][type];
    
    // Update quantity
    item.quantity += parseInt(quantity);
    item.lastUpdated = new Date().toISOString();
    
    // Add to history using the new function
    const historyEntry = {
        date: item.lastUpdated,
        action: 'Tambah',
        quantity: quantity,
        adder: adder,
        receiver: receiver
    };
    
    addHistoryEntry(item, historyEntry);
    
    // Save to Firestore
    await saveData(category, type);
    
    // Update UI
    populateTables();
}

// Function to reduce stock
async function reduceStock(category, type, quantity, reducer, notes) {
    // Ensure we have the latest data
    await fetchStockData();
    
    if (!stockData[category] || !stockData[category][type]) {
        alert('Kategori atau jenis barang tidak ditemukan.');
        return false;
    }
    
    const item = stockData[category][type];
    
    // Check if there's enough stock
    if (item.quantity < quantity) {
        alert(`Stok ${type} tidak mencukupi. Stok saat ini: ${item.quantity}`);
        return false;
    }
    
    // Update quantity
    item.quantity -= parseInt(quantity);
    item.lastUpdated = new Date().toISOString();
    
    // Add to history using the new function
    const historyEntry = {
        date: item.lastUpdated,
        action: 'Kurang',
        quantity: quantity,
        reducer: reducer,
        notes: notes
    };
    
    addHistoryEntry(item, historyEntry);
    
    // Save to Firestore
    await saveData(category, type);
    
    // Update UI
    populateTables();
    return true;
}

// Event listeners for add stock forms
document.getElementById('simpan-tambah-brankas').addEventListener('click', function() {
    const type = document.getElementById('jenis-barang-brankas-tambah').value;
    const quantity = document.getElementById('jumlah-brankas-tambah').value;
    const adder = document.getElementById('penambah-brankas').value;
    const receiver = document.getElementById('penerima-brankas').value;
    
    if (!type || !quantity || !adder || !receiver) {
        alert('Semua field harus diisi!');
        return;
    }
    
    addStock('brankas', type, quantity, adder, receiver);
    
    // Reset form and close modal
    document.getElementById('tambahStokBrankasForm').reset();
    bootstrap.Modal.getInstance(document.getElementById('tambahStokBrankasModal')).hide();
});

document.getElementById('simpan-tambah-admin').addEventListener('click', function() {
    const type = document.getElementById('jenis-barang-admin-tambah').value;
    const quantity = document.getElementById('jumlah-admin-tambah').value;
    const adder = document.getElementById('penambah-admin').value;
    const receiver = document.getElementById('penerima-admin').value;
    
    if (!type || !quantity || !adder || !receiver) {
        alert('Semua field harus diisi!');
        return;
    }
    
    addStock('admin', type, quantity, adder, receiver);
    
    // Reset form and close modal
    document.getElementById('tambahStokAdminForm').reset();
    bootstrap.Modal.getInstance(document.getElementById('tambahStokAdminModal')).hide();
});

document.getElementById('simpan-tambah-rusak').addEventListener('click', function() {
    const type = document.getElementById('jenis-barang-rusak-tambah').value;
    const quantity = document.getElementById('jumlah-rusak-tambah').value;
    const adder = document.getElementById('penambah-rusak').value;
    const receiver = document.getElementById('penerima-rusak').value;
    
    if (!type || !quantity || !adder || !receiver) {
        alert('Semua field harus diisi!');
        return;
    }
    
    addStock('barang-rusak', type, quantity, adder, receiver);
    
    // Reset form and close modal
    document.getElementById('tambahStokBarangRusakForm').reset();
    bootstrap.Modal.getInstance(document.getElementById('tambahStokBarangRusakModal')).hide();
});

document.getElementById('simpan-tambah-posting').addEventListener('click', function() {
    const type = document.getElementById('jenis-barang-posting-tambah').value;
    const quantity = document.getElementById('jumlah-posting-tambah').value;
    const adder = document.getElementById('penambah-posting').value;
    const receiver = document.getElementById('penerima-posting').value;
    
    if (!type || !quantity || !adder || !receiver) {
        alert('Semua field harus diisi!');
        return;
    }
    
    addStock('posting', type, quantity, adder, receiver);
    
    // Reset form and close modal
    document.getElementById('tambahStokPostingForm').reset();
    bootstrap.Modal.getInstance(document.getElementById('tambahStokPostingModal')).hide();
});

// Add event listener for Batu Lepas add stock
document.getElementById('simpan-tambah-batu').addEventListener('click', function() {
    const type = document.getElementById('jenis-batu-tambah').value;
    const quantity = document.getElementById('jumlah-batu-tambah').value;
    const adder = document.getElementById('penambah-batu').value;
    const receiver = document.getElementById('penerima-batu').value;
    
    if (!type || !quantity || !adder || !receiver) {
        alert('Semua field harus diisi!');
        return;
    }
    
    // Handle custom stone type
    let stoneType = type;
    if (type === 'LAINNYA') {
        stoneType = document.getElementById('jenis-batu-lainnya').value;
        if (!stoneType) {
            alert('Silakan isi jenis batu lainnya!');
            return;
        }
    }
    
    addStock('batu-lepas', stoneType, quantity, adder, receiver);
    
    // Reset form and close modal
    document.getElementById('tambahStokBatuLepasForm').reset();
    bootstrap.Modal.getInstance(document.getElementById('tambahStokBatuLepasModal')).hide();
});

// Event listeners for reduce stock forms
document.getElementById('simpan-kurang-brankas').addEventListener('click', function() {
    const type = document.getElementById('jenis-barang-brankas-kurang').value;
    const quantity = document.getElementById('jumlah-brankas-kurang').value;
    const reducer = document.getElementById('pengurang-brankas').value;
    const notes = document.getElementById('keterangan-brankas').value;
    
    if (!type || !quantity || !reducer || !notes) {
        alert('Semua field harus diisi!');
        return;
    }
    
    reduceStock('brankas', type, quantity, reducer, notes).then(success => {
        if (success) {
            // Reset form and close modal
            document.getElementById('kurangiStokBrankasForm').reset();
            bootstrap.Modal.getInstance(document.getElementById('kurangiStokBrankasModal')).hide();
        }
    });
});

document.getElementById('simpan-kurang-admin').addEventListener('click', function() {
    const type = document.getElementById('jenis-barang-admin-kurang').value;
    const quantity = document.getElementById('jumlah-admin-kurang').value;
    const reducer = document.getElementById('pengurang-admin').value;
    const notes = document.getElementById('keterangan-admin').value;
    
    if (!type || !quantity || !reducer || !notes) {
        alert('Semua field harus diisi!');
        return;
    }
    
    reduceStock('admin', type, quantity, reducer, notes).then(success => {
        if (success) {
            // Reset form and close modal
            document.getElementById('kurangiStokAdminForm').reset();
            bootstrap.Modal.getInstance(document.getElementById('kurangiStokAdminModal')).hide();
        }
    });
});

document.getElementById('simpan-kurang-rusak').addEventListener('click', function() {
    const type = document.getElementById('jenis-barang-rusak-kurang').value;
    const quantity = document.getElementById('jumlah-rusak-kurang').value;
    const reducer = document.getElementById('pengurang-rusak').value;
    const notes = document.getElementById('keterangan-rusak').value;
    
    if (!type || !quantity || !reducer || !notes) {
        alert('Semua field harus diisi!');
        return;
    }
    
    reduceStock('barang-rusak', type, quantity, reducer, notes).then(success => {
        if (success) {
            // Reset form and close modal
            document.getElementById('kurangiStokBarangRusakForm').reset();
            bootstrap.Modal.getInstance(document.getElementById('kurangiStokBarangRusakModal')).hide();
        }
    });
});

document.getElementById('simpan-kurang-posting').addEventListener('click', function() {
    const type = document.getElementById('jenis-barang-posting-kurang').value;
    const quantity = document.getElementById('jumlah-posting-kurang').value;
    const reducer = document.getElementById('pengurang-posting').value;
    const notes = document.getElementById('keterangan-posting').value;
    
    if (!type || !quantity || !reducer || !notes) {
        alert('Semua field harus diisi!');
        return;
    }
    
    reduceStock('posting', type, quantity, reducer, notes).then(success => {
        if (success) {
            // Reset form and close modal
            document.getElementById('kurangiStokPostingForm').reset();
            bootstrap.Modal.getInstance(document.getElementById('kurangiStokPostingModal')).hide();
        }
    });
});

// Add event listener for Batu Lepas reduce stock
document.getElementById('simpan-kurang-batu').addEventListener('click', function() {
    const type = document.getElementById('jenis-batu-kurang').value;
    const quantity = document.getElementById('jumlah-batu-kurang').value;
    const reducer = document.getElementById('pengurang-batu').value;
    const notes = document.getElementById('keterangan-batu').value;
    
    if (!type || !quantity || !reducer || !notes) {
        alert('Semua field harus diisi!');
        return;
    }
    
    reduceStock('batu-lepas', type, quantity, reducer, notes).then(success => {
        if (success) {
            // Reset form and close modal
            document.getElementById('kurangiStokBatuLepasForm').reset();
            bootstrap.Modal.getInstance(document.getElementById('kurangiStokBatuLepasModal')).hide();
        }
    });
});

// Function to handle logout
function handleLogout() {
    // Clear session or perform logout actions
    window.location.href = 'index.html';
}

// Setup real-time listener for critical updates
function setupRealtimeListener() {
    // Only set up listener for active sessions
    const stocksRef = collection(firestore, 'stocks');
    
    // Use onSnapshot to listen for changes
    const unsubscribe = onSnapshot(stocksRef, (snapshot) => {
        let hasChanges = false;
        
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'modified') {
                // Update our local cache with the new data
                const categoryId = change.doc.id;
                const categoryData = change.doc.data();
                
                // Only update if we have this category in our cache
                if (stockData[categoryId]) {
                    stockData[categoryId] = categoryData;
                    hasChanges = true;
                }
            }
        });
        
        // If we detected changes, update the UI and cache
        if (hasChanges) {
            console.log('Real-time update detected, refreshing UI');
            lastFetchTime = Date.now();
            updateCache();
            updateSummaryTotals();
            
            // Only update the tables if we're on the stock management page
            const tableContainer = document.querySelector('.table-container');
            if (tableContainer) {
                populateTables();
            }
        }
    }, (error) => {
        console.error('Error in real-time listener:', error);
    });
    
    // Store the unsubscribe function to clean up when needed
    window.addEventListener('beforeunload', () => {
        unsubscribe();
    });
}

// Handle "Lainnya" option for batu lepas
document.getElementById('jenis-batu-tambah')?.addEventListener('change', function() {
    const lainnyaContainer = document.getElementById('jenis-batu-lainnya-container');
    if (this.value === 'LAINNYA') {
        lainnyaContainer.style.display = 'block';
    } else {
        lainnyaContainer.style.display = 'none';
    }
});

// Populate batu lepas dropdown for reduce stock
async function populateBatuLepasDropdown() {
    const dropdown = document.getElementById('jenis-batu-kurang');
    if (!dropdown) return;
    
    // Clear existing options except the first one
    while (dropdown.options.length > 1) {
        dropdown.remove(1);
    }
    
    // Ensure we have the latest data
    await fetchStockData();
    
    if (stockData['batu-lepas']) {
        // Get all stone types with quantity > 0
        const stoneTypes = Object.keys(stockData['batu-lepas'])
            .filter(type => stockData['batu-lepas'][type].quantity > 0);
        
        // Add options to dropdown
        stoneTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = `${type} (${stockData['batu-lepas'][type].quantity})`;
            dropdown.appendChild(option);
        });
    }
}

// Schedule daily cleanup of old history with improved logic
function scheduleHistoryCleanup() {
    // Check if we already ran cleanup today
    const lastCleanup = localStorage.getItem('lastHistoryCleanup');
    const today = new Date().toDateString();
    
    if (lastCleanup !== today) {
        console.log('Running scheduled history cleanup');
        
        // Clean and limit history in all data
        if (Object.keys(stockData).length > 0) {
            cleanAndLimitHistory(stockData);
            updateFirestoreWithCleanedData();
            
            // Mark as completed for today
            localStorage.setItem('lastHistoryCleanup', today);
            
            console.log(`History cleanup completed. Limited to ${MAX_HISTORY_RECORDS} records per item.`);
        }
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Initialize cache from localStorage
        initializeCache();
        
        // Populate tables with data (from cache or Firestore)
        await populateTables();
        
        // Populate batu lepas dropdown
        await populateBatuLepasDropdown();
        
        // Setup real-time listener for collaborative editing
        setupRealtimeListener();
        
        // Schedule cleanup of old history
        scheduleHistoryCleanup();
        
        // Add event listener for refresh button if it exists
        const refreshBtn = document.getElementById('refresh-stock-data');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                // Force refresh from Firestore
                lastFetchTime = null;
                await populateTables();
                await populateBatuLepasDropdown();
                alert('Data stok berhasil diperbarui.');
            });
        }
        
        // Add info about history limits to the UI
        console.log(`Stock management initialized. History limited to ${MAX_HISTORY_RECORDS} records per item.`);
    } catch (error) {
        console.error('Error initializing stock management:', error);
        alert('Terjadi kesalahan saat memuat data. Silakan refresh halaman.');
    }
});

// Export functions for testing or external use
export { 
    fetchStockData, 
    addStock, 
    reduceStock, 
    populateTables,
    cleanAndLimitHistory,
    addHistoryEntry
};
