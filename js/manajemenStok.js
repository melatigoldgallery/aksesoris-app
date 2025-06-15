// Import Firebase modules
import { firestore } from './configFirebase.js';
import { 
    collection, doc, getDoc, getDocs, setDoc, updateDoc, 
    query, where, orderBy, limit, Timestamp, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js';

// Define stock categories and item types
const categories = ['brankas', 'admin', 'barang-rusak', 'posting', 'batu-lepas'];
const itemTypes = ['KALUNG', 'LIONTIN', 'ANTING', 'CINCIN', 'HALA', 'GELANG', 'GIWANG'];
const colorTypes = ['PINK', 'KUNING', 'HIJAU', 'BIRU', 'PUTIH'];

// Cache management variables
let stockData = {};
const CACHE_KEY = 'stockDataCache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_HISTORY_RECORDS = 10;

// Current modal category
let currentModalCategory = '';

// Initialize cache from localStorage
function initializeCache() {
    try {
        const cachedData = localStorage.getItem(CACHE_KEY);
        if (cachedData) {
            const parsedData = JSON.parse(cachedData);
            if (Date.now() - parsedData.timestamp < CACHE_TTL) {
                stockData = parsedData.data || {};
                return true;
            }
        }
    } catch (error) {
        console.error('Error initializing cache:', error);
        localStorage.removeItem(CACHE_KEY);
    }
    return false;
}

// Update cache in localStorage
function updateCache() {
    try {
        const cacheData = {
            timestamp: Date.now(),
            data: stockData
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
        
        // Trigger UI update setelah cache update - PERBAIKAN
        if (document.readyState === 'complete') {
            updateSummaryTotals();
        }
    } catch (error) {
        console.error('Error updating cache:', error);
    }
}

// Initialize Firestore with default data structure
async function initializeFirestoreData() {
    try {
        const initPromises = categories.map(async (category) => {
            const categoryData = {};
            
            itemTypes.forEach(type => {
                categoryData[type] = {};
                colorTypes.forEach(color => {
                    categoryData[type][color] = {
                        quantity: 0,
                        lastUpdated: null,
                        history: []
                    };
                });
            });
            
            await setDoc(doc(firestore, 'stocks', category), categoryData);
            stockData[category] = categoryData;
        });
        
        await Promise.all(initPromises);
        updateCache();
    } catch (error) {
        console.error('Error initializing Firestore data:', error);
    }
}

// Fetch stock data from Firestore or cache
async function fetchStockData(forceRefresh = false) {
    try {
        if (!forceRefresh && initializeCache()) {
            console.log('Using cached stock data');
            return stockData;
        }

        console.log('Fetching fresh stock data from Firestore');
        
        const fetchPromises = categories.map(async (category) => {
            const categoryRef = doc(firestore, 'stocks', category);
            const categoryDoc = await getDoc(categoryRef);
            
            if (categoryDoc.exists()) {
                stockData[category] = categoryDoc.data();
            } else {
                // Initialize if doesn't exist
                const initialData = {};
                itemTypes.forEach(type => {
                    initialData[type] = {};
                    colorTypes.forEach(color => {
                        initialData[type][color] = {
                            quantity: 0,
                            lastUpdated: null,
                            history: []
                        };
                    });
                });
                
                await setDoc(categoryRef, initialData);
                stockData[category] = initialData;
            }
        });

        await Promise.all(fetchPromises);
        updateCache();
        return stockData;
    } catch (error) {
        console.error('Error fetching stock data:', error);
        throw error;
    }
}

// Save data to Firestore
async function saveData(category, type, color) {
    try {
        const categoryRef = doc(firestore, 'stocks', category);
        const updateData = {};
        updateData[`${type}.${color}`] = stockData[category][type][color];
        
        await updateDoc(categoryRef, updateData);
        updateCache();
        console.log(`Successfully saved ${type}-${color} in ${category}`);
    } catch (error) {
        console.error('Error saving data to Firestore:', error);
        // Try to create document if it doesn't exist
        try {
            await setDoc(categoryRef, stockData[category]);
            updateCache();
        } catch (createError) {
            console.error('Error creating document:', createError);
            alert('Terjadi kesalahan saat menyimpan data. Silakan coba lagi.');
        }
    }
}

function formatDate(date) {
    if (!date) return '-';
    const d = new Date(date);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// Get color badge HTML
function getColorBadge(color) {
    return `<span class="color-badge color-${color.toLowerCase()}"></span>${color}`;
}

// Add history entry with automatic cleanup
function addHistoryEntry(item, historyEntry) {
    if (!item.history) {
        item.history = [];
    }
    
    item.history.unshift(historyEntry);
    item.history.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Hapus riwayat yang lebih dari 10, bukan hanya batasi tampilan
    if (item.history.length > 10) {
        item.history = item.history.slice(0, 10);
        console.log(`History trimmed to 10 records for better performance`);
    }
    
    return item.history;
}

// Populate tables with stock data
async function populateTables() {
    try {
        await fetchStockData();
        
        categories.forEach(category => {
            const tableBody = document.getElementById(`${category}-table-body`);
            if (!tableBody) return;
            
            tableBody.innerHTML = '';
            
            if (!stockData[category]) {
                console.warn(`No data found for category: ${category}`);
                return;
            }
            
            let index = 1;
            itemTypes.forEach(type => {
                if (!stockData[category][type]) return;
                
                // Calculate total quantity for this item type
                let totalQuantity = 0;
                let lastUpdated = null;
                let availableColors = 0;
                
                colorTypes.forEach(color => {
                    if (stockData[category][type][color]) {
                        totalQuantity += stockData[category][type][color].quantity;
                        if (stockData[category][type][color].quantity > 0) {
                            availableColors++;
                        }
                        if (stockData[category][type][color].lastUpdated) {
                            const itemDate = new Date(stockData[category][type][color].lastUpdated);
                            if (!lastUpdated || itemDate > lastUpdated) {
                                lastUpdated = itemDate;
                            }
                        }
                    }
                });
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${index}</td>
                    <td>
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <span class="fw-bold text-dark">${type}</span>
                                ${availableColors > 0 ? 
                                    `<small class="text-muted d-block">${availableColors} warna tersedia</small>` : 
                                    `<small class="text-danger d-block">Tidak ada stok</small>`
                                }
                            </div>
                            ${totalQuantity > 0 ? 
                                `<button class="btn btn-sm btn-outline-primary detail-color-btn" 
                                        data-category="${category}" 
                                        data-type="${type}"
                                        title="Lihat detail per warna"
                                        style="border-radius: 20px; font-size: 0.75rem; padding: 4px 12px;">
                                    <i class="fas fa-palette me-1"></i>
                                    <span class="d-none d-md-inline">Detail</span>
                                </button>` :
                                `<button class="btn btn-sm btn-outline-secondary detail-color-btn" 
                                        data-category="${category}" 
                                        data-type="${type}"
                                        title="Lihat detail per warna"
                                        disabled
                                        style="border-radius: 20px; font-size: 0.75rem; padding: 4px 12px;">
                                    <i class="fas fa-palette me-1"></i>
                                    <span class="d-none d-md-inline">Detail</span>
                                </button>`
                            }
                        </div>
                    </td>
                    <td>
                        <span class="badge ${totalQuantity > 0 ? 'bg-success' : 'bg-secondary'} fs-6">
                            ${totalQuantity}
                        </span>
                    </td>
                    <td>
                        <small class="text-muted">
                            ${lastUpdated ? formatDate(lastUpdated) : '-'}
                        </small>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-info view-history" 
                                data-category="${category}" 
                                data-type="${type}"
                                style="border-radius: 20px;">
                            <i class="fas fa-history me-1"></i>
                            <span class="d-none d-lg-inline">Riwayat</span>
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
        
        // Add event listeners to detail color buttons - DIPERBAIKI dengan hover effect
        document.querySelectorAll('.detail-color-btn').forEach(button => {
            button.addEventListener('click', function() {
                if (!this.disabled) {
                    const category = this.getAttribute('data-category');
                    const type = this.getAttribute('data-type');
                    
                    // Add loading state
                    const originalHTML = this.innerHTML;
                    this.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i><span class="d-none d-md-inline">Loading...</span>';
                    this.disabled = true;
                    
                    // Show modal with slight delay for better UX
                    setTimeout(() => {
                        showDetailColorStock(category, type);
                        // Restore button state
                        this.innerHTML = originalHTML;
                        this.disabled = false;
                    }, 300);
                }
            });
            
            // Add hover effect
            button.addEventListener('mouseenter', function() {
                if (!this.disabled) {
                    this.style.transform = 'translateY(-1px)';
                    this.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                }
            });
            
            button.addEventListener('mouseleave', function() {
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = 'none';
            });
        });
        
        updateSummaryTotals();
        
    } catch (error) {
        console.error('Error populating tables:', error);
        alert('Terjadi kesalahan saat memuat data. Silakan refresh halaman.');
    }
}

// Show detail color stock modal - FUNGSI BARU
function showDetailColorStock(category, type) {
    const detailTitle = document.getElementById('detail-color-title');
    const detailTableBody = document.getElementById('detail-color-table-body');
    
    detailTitle.innerHTML = `
        <span class="text-light">${type}</span> 
        <i class="fas fa-arrow-right mx-2 text-light"></i> 
        <span class="text-light">${category.toUpperCase()}</span>
    `;
    detailTableBody.innerHTML = '';
    
    if (!stockData[category] || !stockData[category][type]) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="3" class="text-center py-4">
                <i class="fas fa-exclamation-circle text-warning me-2"></i>
                <span class="text-muted">Tidak ada data tersedia</span>
            </td>
        `;
        detailTableBody.appendChild(row);
        return;
    }
    
    let hasStock = false;
    let totalStock = 0;
    
    colorTypes.forEach(color => {
        if (stockData[category][type][color]) {
            const item = stockData[category][type][color];
            totalStock += item.quantity;
            
            if (item.quantity > 0) {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>
                        <div class="d-flex align-items-center">
                            ${getColorBadge(color)}
                        </div>
                    </td>
                    <td>
                        <span class="badge bg-success fs-6">${item.quantity}</span>
                    </td>
                    <td>
                        <small class="text-muted">${formatDate(item.lastUpdated)}</small>
                    </td>
                `;
                row.style.animation = 'fadeInUp 0.3s ease-out';
                detailTableBody.appendChild(row);
                hasStock = true;
            }
        }
    });
    
    if (!hasStock) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="3" class="text-center py-4">
                <div class="text-muted">
                    <i class="fas fa-inbox fa-2x mb-2 d-block"></i>
                    <span>Tidak ada stok tersedia untuk ${type}</span>
                </div>
            </td>
        `;
        detailTableBody.appendChild(row);
    } else {
        // Add summary row
        const summaryRow = document.createElement('tr');
        summaryRow.className = 'table-info';
        summaryRow.innerHTML = `
            <td class="fw-bold">
                <i class="fas fa-calculator me-2"></i>Total
            </td>
            <td>
                <span class="badge bg-primary fs-6">${totalStock}</span>
            </td>
            <td>
                <small class="text-muted">${hasStock ? colorTypes.filter(color => 
                    stockData[category][type][color] && stockData[category][type][color].quantity > 0
                ).length : 0} warna</small>
            </td>
        `;
        detailTableBody.appendChild(summaryRow);
    }
    
    const detailColorModal = new bootstrap.Modal(document.getElementById('detailColorModal'));
    detailColorModal.show();
}

// Update summary totals
function updateSummaryTotals() {
    itemTypes.forEach(type => {
        let total = 0;
        categories.forEach(category => {
            if (stockData[category] && stockData[category][type]) {
                colorTypes.forEach(color => {
                    if (stockData[category][type][color]) {
                        total += stockData[category][type][color].quantity;
                    }
                });
            }
        });
        
        const totalElement = document.getElementById(`total-${type.toLowerCase()}`);
        if (totalElement) {
            totalElement.textContent = total;
        }
    });
}

// Show history in modal
function showHistory(category, type) {
    const historyTitle = document.getElementById('history-title');
    const historyTableBody = document.getElementById('history-table-body');
    
    historyTitle.textContent = `${type} (${category.toUpperCase()})`;
    historyTableBody.innerHTML = '';
    
    // Collect all history from all colors
    let allHistory = [];
    
    colorTypes.forEach(color => {
        if (stockData[category][type][color] && stockData[category][type][color].history) {
            stockData[category][type][color].history.forEach(record => {
                allHistory.push({
                    ...record,
                    color: color
                });
            });
        }
    });
    
    if (allHistory.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="6" class="text-center">Tidak ada riwayat</td>';
        historyTableBody.appendChild(row);
    } else {
        // Sort by date descending and limit to 10 records
        allHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
        const limitedHistory = allHistory.slice(0, 10); // Batasi hanya 10 riwayat
        
        limitedHistory.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatDate(record.date)}</td>
                <td>${type}</td>
                <td>${getColorBadge(record.color)}</td>
                <td>${record.quantity}</td>
                <td>${record.action === 'Tambah' ? record.adder : record.reducer}</td>
                <td>${record.action === 'Tambah' ? record.receiver : record.notes}</td>
            `;
            historyTableBody.appendChild(row);
        });
        
        // Tampilkan info jika ada lebih dari 10 riwayat
        if (allHistory.length > 10) {
            const infoRow = document.createElement('tr');
            infoRow.className = 'table-info';
            infoRow.innerHTML = `
                <td colspan="6" class="text-center">
                    <small class="text-muted">
                        <i class="fas fa-info-circle me-1"></i>
                        Menampilkan 10 riwayat terbaru dari ${allHistory.length} total riwayat
                    </small>
                </td>
            `;
            historyTableBody.appendChild(infoRow);
        }
    }
    
    const historyModal = new bootstrap.Modal(document.getElementById('historyModal'));
    historyModal.show();
}

// Show detail stock modal
function showDetailStock(category) {
    const detailTitle = document.getElementById('detail-category-title');
    const detailTableBody = document.getElementById('detail-stock-table-body');
    
    detailTitle.textContent = category.toUpperCase();
    detailTableBody.innerHTML = '';
    
    if (!stockData[category]) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="4" class="text-center">Tidak ada data</td>';
        detailTableBody.appendChild(row);
        return;
    }
    
    itemTypes.forEach(type => {
        if (!stockData[category][type]) return;
        
        colorTypes.forEach(color => {
            if (stockData[category][type][color] && stockData[category][type][color].quantity > 0) {
                const item = stockData[category][type][color];
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${type}</td>
                    <td>${getColorBadge(color)}</td>
                    <td>${item.quantity}</td>
                    <td>${formatDate(item.lastUpdated)}</td>
                `;
                detailTableBody.appendChild(row);
            }
        });
    });
    
    if (detailTableBody.children.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="4" class="text-center">Tidak ada stok</td>';
        detailTableBody.appendChild(row);
    }
}

// Populate color options for reduce stock based on available stock
function populateColorOptions(category, type) {
    const colorSelect = document.getElementById('warna-barcode-kurang');
    const stokTersediaSpan = document.getElementById('stok-tersedia');
    
    colorSelect.innerHTML = '<option value="">Pilih Warna Barcode</option>';
    stokTersediaSpan.textContent = '0';
    
    if (!stockData[category] || !stockData[category][type]) return;
    
    colorTypes.forEach(color => {
        if (stockData[category][type][color] && stockData[category][type][color].quantity > 0) {
            const option = document.createElement('option');
            option.value = color;
            option.textContent = `${color} (${stockData[category][type][color].quantity})`;
            colorSelect.appendChild(option);
        }
    });
}

// Update available stock display
function updateAvailableStock(category, type, color) {
    const stokTersediaSpan = document.getElementById('stok-tersedia');
    
    if (stockData[category] && stockData[category][type] && stockData[category][type][color]) {
        stokTersediaSpan.textContent = stockData[category][type][color].quantity;
    } else {
        stokTersediaSpan.textContent = '0';
    }
}

// Add stock function
async function addStock(category, type, color, quantity, adder, receiver) {
    try {
        await fetchStockData();
        
        if (!stockData[category]) stockData[category] = {};
        if (!stockData[category][type]) stockData[category][type] = {};
        if (!stockData[category][type][color]) {
            stockData[category][type][color] = {
                quantity: 0,
                lastUpdated: null,
                history: []
            };
        }
        
        const item = stockData[category][type][color];
        
        // Update quantity
        item.quantity += parseInt(quantity);
        item.lastUpdated = new Date().toISOString();
        
        // Add to history
        const historyEntry = {
            date: item.lastUpdated,
            action: 'Tambah',
            quantity: quantity,
            adder: adder,
            receiver: receiver
        };
        
        addHistoryEntry(item, historyEntry);
        
        // Save to Firestore
        await saveData(category, type, color);
        
        // Update UI LANGSUNG - PERBAIKAN
        updateSummaryTotals();
        await populateTables();
        
        // Show success message
        Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: `Stok ${type} ${color} berhasil ditambahkan`,
            timer: 2000,
            showConfirmButton: false
        });
        
    } catch (error) {
        console.error('Error adding stock:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error!',
            text: 'Terjadi kesalahan saat menambah stok'
        });
    }
}

// Reduce stock function
async function reduceStock(category, type, color, quantity, reducer, notes) {
    try {
        await fetchStockData();
        
        if (!stockData[category] || !stockData[category][type] || !stockData[category][type][color]) {
            Swal.fire({
                icon: 'error',
                title: 'Error!',
                text: 'Stok tidak ditemukan'
            });
            return false;
        }
        
        const item = stockData[category][type][color];
        
        // Check if there's enough stock
        if (item.quantity < quantity) {
            Swal.fire({
                icon: 'error',
                title: 'Stok Tidak Cukup!',
                text: `Stok ${type} ${color} tidak mencukupi. Stok saat ini: ${item.quantity}`
            });
            return false;
        }
        
        // Update quantity
        item.quantity -= parseInt(quantity);
        item.lastUpdated = new Date().toISOString();
        
        // Add to history
        const historyEntry = {
            date: item.lastUpdated,
            action: 'Kurang',
            quantity: quantity,
            reducer: reducer,
            notes: notes
        };
        
        addHistoryEntry(item, historyEntry);
        
        // Save to Firestore
        await saveData(category, type, color);
        
        // Update UI LANGSUNG - PERBAIKAN
        updateSummaryTotals();
        await populateTables();
        
        // Show success message
        Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: `Stok ${type} ${color} berhasil dikurangi`,
            timer: 2000,
            showConfirmButton: false
        });
        
        return true;
        
    } catch (error) {
        console.error('Error reducing stock:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error!',
            text: 'Terjadi kesalahan saat mengurangi stok'
        });
        return false;
    }
}

// Event listeners setup
function setupEventListeners() {
    // Add stock modal buttons
    document.querySelectorAll('[data-bs-target="#tambahStokModal"]').forEach(button => {
        button.addEventListener('click', function() {
            currentModalCategory = this.getAttribute('data-category');
            document.getElementById('tambah-category-title').textContent = currentModalCategory.toUpperCase();
        });
    });
    
    // Reduce stock modal buttons
    document.querySelectorAll('[data-bs-target="#kurangiStokModal"]').forEach(button => {
        button.addEventListener('click', function() {
            currentModalCategory = this.getAttribute('data-category');
            document.getElementById('kurang-category-title').textContent = currentModalCategory.toUpperCase();
        });
    });
    
    // Item type change for reduce stock
    document.getElementById('jenis-barang-kurang')?.addEventListener('change', function() {
        if (this.value && currentModalCategory) {
            populateColorOptions(currentModalCategory, this.value);
        }
    });
    
    // Color change for reduce stock
    document.getElementById('warna-barcode-kurang')?.addEventListener('change', function() {
        const type = document.getElementById('jenis-barang-kurang').value;
        if (this.value && type && currentModalCategory) {
            updateAvailableStock(currentModalCategory, type, this.value);
        }
    });
    
    // Save add stock
    document.getElementById('simpan-tambah-stok')?.addEventListener('click', async function() {
        const type = document.getElementById('jenis-barang-tambah').value;
        const color = document.getElementById('warna-barcode-tambah').value;
        const quantity = document.getElementById('jumlah-tambah').value;
        const adder = document.getElementById('penambah-stok').value;
        const receiver = document.getElementById('penerima-stok').value;
        
        if (!type || !color || !quantity || !adder || !receiver) {
            Swal.fire({
                icon: 'warning',
                title: 'Peringatan!',
                text: 'Semua field harus diisi!'
            });
            return;
        }
        
        // Disable button sementara
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Menyimpan...';
        
        try {
            await addStock(currentModalCategory, type, color, quantity, adder, receiver);
            
            // Reset form and close modal
            document.getElementById('tambahStokForm').reset();
            bootstrap.Modal.getInstance(document.getElementById('tambahStokModal')).hide();
        } finally {
            // Re-enable button
            this.disabled = false;
            this.innerHTML = '<i class="fas fa-save me-2"></i>Simpan';
        }
    });
    
    // Save reduce stock
    document.getElementById('simpan-kurang-stok')?.addEventListener('click', async function() {
        const type = document.getElementById('jenis-barang-kurang').value;
        const color = document.getElementById('warna-barcode-kurang').value;
        const quantity = document.getElementById('jumlah-kurang').value;
        const reducer = document.getElementById('pengurang-stok').value;
        const notes = document.getElementById('keterangan-stok').value;
        
        if (!type || !color || !quantity || !reducer || !notes) {
            Swal.fire({
                icon: 'warning',
                title: 'Peringatan!',
                text: 'Semua field harus diisi!'
            });
            return;
        }
        
        // Disable button sementara
        this.disabled = true;
        this.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Menyimpan...';
        
        try {
            const success = await reduceStock(currentModalCategory, type, color, quantity, reducer, notes);
            
            if (success) {
                // Reset form and close modal
                document.getElementById('kurangiStokForm').reset();
                bootstrap.Modal.getInstance(document.getElementById('kurangiStokModal')).hide();
            }
        } finally {
            // Re-enable button
            this.disabled = false;
            this.innerHTML = '<i class="fas fa-save me-2"></i>Simpan';
        }
    });
}

// Setup real-time listener
function setupRealtimeListener() {
    const stocksRef = collection(firestore, 'stocks');
    
    const unsubscribe = onSnapshot(stocksRef, (snapshot) => {
        let hasChanges = false;
        
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'modified') {
                const categoryId = change.doc.id;
                const categoryData = change.doc.data();
                
                if (stockData[categoryId]) {
                    stockData[categoryId] = categoryData;
                    hasChanges = true;
                }
            }
        });
        
        if (hasChanges) {
            console.log('Real-time update detected, refreshing UI');
            // Update UI LANGSUNG - PERBAIKAN
            updateSummaryTotals();
            updateCache();
            
            const tableContainer = document.querySelector('.table-container');
            if (tableContainer) {
                populateTables();
            }
        }
    }, (error) => {
        console.error('Error in real-time listener:', error);
    });
    
    window.addEventListener('beforeunload', () => {
        unsubscribe();
    });
}

// Force refresh function
async function forceRefreshData() {
    try {
        console.log('Force refreshing stock data...');
        
        // Clear cache
        localStorage.removeItem(CACHE_KEY);
        stockData = {};
        
        // Fetch fresh data
        await fetchStockData(true);
        
        // Update UI LANGSUNG - PERBAIKAN
        updateSummaryTotals();
        await populateTables();
        
        Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: 'Data stok berhasil diperbarui dari server',
            timer: 2000,
            showConfirmButton: false
        });
    } catch (error) {
        console.error('Error force refreshing data:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error!',
            text: 'Terjadi kesalahan saat memperbarui data'
        });
    }
}

// Schedule daily cleanup of old history
function scheduleHistoryCleanup() {
    const lastCleanup = localStorage.getItem('lastHistoryCleanup');
    const today = new Date().toDateString();
    
    if (lastCleanup !== today) {
        console.log('Running scheduled history cleanup');
        
        // Add safer check for stockData
        if (stockData && typeof stockData === 'object' && Object.keys(stockData).length > 0) {
            try {
                cleanHistoryData();
                localStorage.setItem('lastHistoryCleanup', today);
                console.log(`History cleanup completed. Limited to ${MAX_HISTORY_RECORDS} records per item.`);
            } catch (error) {
                console.error('Error during history cleanup:', error);
                // Don't let cleanup errors break the app
            }
        }
    }
}

// Clean history data
function cleanHistoryData() {
    Object.keys(stockData).forEach(category => {
        if (!stockData[category]) return;
        
        Object.keys(stockData[category]).forEach(type => {
            if (!stockData[category][type]) return;
            
            Object.keys(stockData[category][type]).forEach(color => {
                const item = stockData[category][type][color];
                
                if (!item || typeof item !== 'object') return;
                
                if (!item.history) {
                    item.history = [];
                    return;
                }
                
                if (Array.isArray(item.history)) {
                    item.history.sort((a, b) => new Date(b.date) - new Date(a.date));
                    
                    // Hapus permanen riwayat yang lebih dari 10
                    if (item.history.length > 10) {
                        const deletedCount = item.history.length - 10;
                        item.history = item.history.slice(0, 10);
                        console.log(`Deleted ${deletedCount} old history records for ${category}-${type}-${color}`);
                    }
                } else {
                    item.history = [];
                }
            });
        });
    });
    
    updateCache();
}

// Handle logout
function handleLogout() {
    window.location.href = 'index.html';
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Show loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'stockLoadingIndicator';
        loadingIndicator.className = 'text-center my-3';
        loadingIndicator.innerHTML = `
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2">Memuat data stok...</p>
        `;
        
        const mainContainer = document.querySelector('.content-wrapper');
        if (mainContainer) {
            mainContainer.insertBefore(loadingIndicator, mainContainer.firstChild);
        }
        
        // Initialize data
        await fetchStockData();
        
        // Populate tables
        await populateTables();
        
        // Setup event listeners
        setupEventListeners();
        
        // Setup real-time listener
        setupRealtimeListener();
        
        // Schedule cleanup
        scheduleHistoryCleanup();
        
        // Remove loading indicator
        const indicator = document.getElementById('stockLoadingIndicator');
        if (indicator) {
            indicator.remove();
        }
        
        // Add refresh button functionality
        const refreshBtn = document.getElementById('refresh-stock-data');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Memperbarui...';
                refreshBtn.disabled = true;
                
                try {
                    await forceRefreshData();
                } finally {
                    refreshBtn.innerHTML = '<i class="fas fa-sync-alt me-2"></i>Refresh Data';
                    refreshBtn.disabled = false;
                }
            });
        }
        
        console.log('Stock management initialized successfully');
        
    } catch (error) {
        console.error('Error initializing stock management:', error);
        
        // Remove loading indicator
        const indicator = document.getElementById('stockLoadingIndicator');
        if (indicator) {
            indicator.remove();
        }
        
        // Show error message
        Swal.fire({
            icon: 'error',
            title: 'Error!',
            text: 'Terjadi kesalahan saat memuat data stok',
            confirmButtonText: 'Coba Lagi',
            allowOutsideClick: false
        }).then((result) => {
            if (result.isConfirmed) {
                location.reload();
            }
        });
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    updateCache();
});

// Periodic cache cleanup (every 30 minutes)
setInterval(() => {
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            if (Date.now() - parsedData.timestamp > CACHE_TTL * 2) {
                localStorage.removeItem(CACHE_KEY);
                console.log('Expired cache cleaned up');
            }
        } catch (error) {
            localStorage.removeItem(CACHE_KEY);
        }
    }
}, 30 * 60 * 1000); // 30 minutes

// Export functions for testing or external use
export { 
    fetchStockData, 
    addStock, 
    reduceStock, 
    populateTables,
    forceRefreshData,
    showDetailColorStock,
    showHistory
};

// Make handleLogout available globally
window.handleLogout = handleLogout;
