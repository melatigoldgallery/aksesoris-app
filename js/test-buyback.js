// Initialize page
document.addEventListener("DOMContentLoaded", () => {
  // Initialize buyback form
  setupBuybackForm();
  // Initialize Firebase functions
  initializeFirebaseFunctions();
});

// Tambahkan event listener untuk tombol print
const printButton = document.getElementById("printModalButton");
if (printButton) {
  printButton.addEventListener("click", printModal);
}

// Global variables for condition visual
let currentCondition = '1';
let isEditMode = false;
let pendingChanges = {};

// Setup buyback form
function setupBuybackForm() {
  // Add row button
  document.getElementById("btnTambahPenerimaan").addEventListener("click", addNewRow);

  // Form submission
  document.getElementById("penerimaanForm").addEventListener("submit", calculateBuyback);

  // Enable the first delete button
  setupDeleteButtons();
}

// Add new row to the table
function addNewRow() {
  const tbody = document.querySelector("#tablePenerimaan tbody");
  const rowCount = tbody.querySelectorAll("tr").length + 1;

  const newRow = document.createElement("tr");
  newRow.innerHTML = `
    <td>${rowCount}</td>
    <td>
      <select name="kadar" class="form-select form-select-sm" required>
        <option value="" disabled selected>Pilih</option>
        <option value="8K">8K</option>
        <option value="9K">9K</option>
        <option value="16K">16K</option>
        <option value="17K">17K</option>
        <option value="18K">18K</option>
        <option value="22K">22K</option>
      </select>
    </td>
    <td><input type="text" name="namaBarang" class="form-control form-control-sm" placeholder="Nama Barang" required></td>
    <td>
      <div class="d-flex align-items-center">
        <select name="kondisiBarang" class="form-select form-select-sm" required>
          <option value="" disabled selected>Pilih</option>
          <option value="1">K1</option>
          <option value="2">K2</option>
          <option value="3">K3</option>
        </select>
        <button type="button" class="btn btn-outline-info condition-visual-btn" onclick="showConditionVisual('1')">
          <i class="fas fa-eye"></i>
        </button>
      </div>
    </td>
    <td>
      <input
        name="hargaBeli"
        class="form-control form-control-sm"
        placeholder="Harga beli"
        type="number"
        required
        min="0"
      />
    </td>
    <td>
      <input
        name="hargaHariIni"
        class="form-control form-control-sm"
        placeholder="Harga hari ini"
        type="number"
        required
        min="0"
      />
    </td>
    <td>
      <button type="button" class="btn btn-danger btn-sm hapus-baris">
        <i class="fas fa-trash"></i>
      </button>
    </td>
  `;

  tbody.appendChild(newRow);
  setupDeleteButtons();
}

// Setup delete buttons
function setupDeleteButtons() {
  const deleteButtons = document.querySelectorAll(".hapus-baris");

  // Enable all delete buttons if there's more than one row
  const rows = document.querySelectorAll("#tablePenerimaan tbody tr");
  if (rows.length > 1) {
    deleteButtons.forEach((btn) => {
      btn.disabled = false;
      btn.addEventListener("click", deleteRow);
    });
  } else {
    // Disable the only delete button
    deleteButtons[0].disabled = true;
  }
}

// Delete row
function deleteRow(e) {
  const button = e.currentTarget;
  const row = button.closest("tr");
  row.remove();

  // Renumber rows
  const rows = document.querySelectorAll("#tablePenerimaan tbody tr");
  rows.forEach((row, index) => {
    row.cells[0].textContent = index + 1;
  });

  // Update delete buttons
  setupDeleteButtons();
}

// Calculate buyback
function calculateBuyback(e) {
  e.preventDefault();

  // Get all rows
  const rows = document.querySelectorAll("#tablePenerimaan tbody tr");
  const items = [];

  // Validate form
  let isValid = true;

  rows.forEach((row) => {
    const namaBarangInput = row.querySelector('input[name="namaBarang"]');
    const kadar = row.querySelector("[name='kadar']").value;
    const namaBarang = row.querySelector("[name='namaBarang']")?.value || "";
    const kondisiBarang = row.querySelector("[name='kondisiBarang']").value;
    const hargaBeli = parseFloat(row.querySelector("[name='hargaBeli']").value);
    const hargaHariIni = parseFloat(row.querySelector("[name='hargaHariIni']").value);

    if (!kadar || !kondisiBarang || isNaN(hargaBeli) || isNaN(hargaHariIni)) {
      isValid = false;
      return;
    }

    items.push({
      kadar,
      namaBarang,
      kondisiBarang,
      hargaBeli,
      hargaHariIni,
    });
  });

  if (!isValid) {
    showAlert("Mohon lengkapi semua field yang diperlukan", "danger");
    return;
  }

  // Calculate buyback price
  const results = calculateBuybackPrice(items);

  // Show results
  showResults(results);
}

/// Calculate buyback price
function calculateBuybackPrice(items) {
  const results = [];

  items.forEach((item) => {
    let buybackPercentage = 0;
    let buybackPrice = 0;

    if (item.hargaBeli <= item.hargaHariIni) {
      // Hitung persentase beli terhadap harga hari ini
      const persentaseBeli = (item.hargaBeli / item.hargaHariIni) * 100;
      
      // Gunakan helper function calculatePersentase
      buybackPercentage = calculatePersentase(parseInt(item.kondisiBarang), persentaseBeli);
      buybackPrice = (item.hargaHariIni * buybackPercentage) / 100;
      buybackPrice = roundBuybackPrice(buybackPrice);

      if (buybackPrice < item.hargaBeli) {
        buybackPrice = item.hargaBeli;
      }
    } else {
      buybackPrice = item.hargaHariIni;
    }

    const priceDifference = buybackPrice - item.hargaBeli;
    const percentageDifference = ((priceDifference / item.hargaBeli) * 100).toFixed(2);

    results.push({
      ...item,
      buybackPercentage: parseFloat(buybackPercentage.toFixed(2)),
      buybackPrice,
      priceDifference,
      percentageDifference,
      isHigherPurchasePrice: item.hargaBeli > item.hargaHariIni,
    });
  });

  return results;
}

// Fungsi untuk membulatkan harga buyback sesuai ketentuan
function roundBuybackPrice(price) {
  // Ekstrak ribuan terakhir dari harga
  const lastThousand = Math.floor((price % 10000) / 1000);

  if (lastThousand < 5) {
    // Jika ribuan terakhir < 5, bulatkan ke 5 ribu
    return Math.floor(price / 10000) * 10000 + 5000;
  } else {
    // Jika ribuan terakhir >= 5, bulatkan ke puluhan ribu berikutnya
    return Math.ceil(price / 10000) * 10000;
  }
}

// New helper functions for calculating percentages
function calculatePersentase(kondisiBarang, persentaseBeli) {
  if (persentaseBeli >= 95) {
    const persentaseMap = {
      1: 98,
      2: 97,
      3: 96,
    };
    return persentaseMap[kondisiBarang];
  } else if (persentaseBeli >= 90) {
    const persentaseMap = {
      1: 97,
      2: 95,
      3: 94,
    };
    return persentaseMap[kondisiBarang];
  } else if (persentaseBeli >= 85) {
    const persentaseMap = {
      1: 95,
      2: 93,
      3: 92,
    };
    return persentaseMap[kondisiBarang];
  } else if (persentaseBeli >= 80) {
    const persentaseMap = {
      1: 93,
      2: 90,
      3: 88,
    };
    return persentaseMap[kondisiBarang];
  } else if (persentaseBeli >= 75) {
    const persentaseMap = {
      1: 90,
      2: 87,
      3: 80,
    };
    return persentaseMap[kondisiBarang];
  } else {
    const persentaseMap = {
      1: 90,
      2: 83,
      3: 77,
    };
    return persentaseMap[kondisiBarang];
  }
}

// Show results in modal
function showResults(results) {
  const modalBody = document.getElementById("modalMessage");
  let content = `
    <div class="alert alert-info mb-4">
      <i class="fas fa-info-circle me-2"></i>
      Berikut adalah hasil perhitungan buyback perhiasan.
    </div>
  `;

  results.forEach((result, index) => {
    const conditionText =
      result.kondisiBarang === "1" ? "(K1)" : result.kondisiBarang === "2" ? "(K2)" : "(K3)";

    let specialNotice = "";
    if (result.isHigherPurchasePrice) {
      specialNotice = `
        <div class="alert alert-warning mb-3">
          <i class="fas fa-exclamation-triangle me-2"></i>
          <strong>Perhatian:</strong> Harga beli lebih tinggi dari harga hari ini. 
          Harga penerimaan menggunakan 100% dari harga hari ini.
        </div>
      `;
    }
    
    const namaBarang = result.namaBarang || "Perhiasan";
    content += `
    <div class="result-item">
      <h5 class="fw-bold mb-3">Item #${index + 1}: ${namaBarang}</h5>
      ${specialNotice}
      <div class="row mb-2">
        <div class="col-md-6">
          <p class="mb-1"><strong>Kadar:</strong> ${result.kadar}</p>
          <p class="mb-1"><strong>Kondisi:</strong> ${conditionText}</p>
        </div>
        <div class="col-md-6">
          <p class="mb-1"><strong>Persentase Buyback:</strong> ${result.buybackPercentage}%</p>
        </div>
      </div>
      <div class="alert ${result.priceDifference >= 0 ? "alert-success" : "alert-danger"} mb-0">
        <div class="row">
          <div class="col-md-6">
            <h5 class="mb-0">Harga Buyback: Rp ${formatNumber(result.buybackPrice)}</h5>
          </div>
        </div>
      </div>
    </div>
  `;
  });

  const now = new Date();
  content += `
  <div class="text-end text-muted mt-3">
    <small>Dihitung pada: ${now.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}</small>
  </div>
`;

  modalBody.innerHTML = content;
  const resultModal = new bootstrap.Modal(document.getElementById("resultModal"));
  resultModal.show();
}

// Format number to currency format
function formatNumber(number) {
  return number.toLocaleString("id-ID");
}

// Show alert message
function showAlert(message, type = "warning") {
  // Create alert element
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
  alertDiv.innerHTML = `
    <i class="fas fa-${type === "danger" ? "exclamation-circle" : "exclamation-triangle"} me-2"></i>
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;

  // Insert at the top of the form
  const form = document.getElementById("penerimaanForm");
  form.parentNode.insertBefore(alertDiv, form);

  // Auto dismiss after 5 seconds
  setTimeout(() => {
    const bsAlert = new bootstrap.Alert(alertDiv);
    bsAlert.close();
  }, 5000);
}

// Pastikan fungsi printModal tersedia secara global
window.printModal = printModal;

// Print modal content - simplified and direct approach
function printModal() {
  const modalContent = document.getElementById("modalMessage").innerHTML;

  // Create a simplified print window with direct content
  const printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Print</title>
      <style>
        @page {
          size: 75mm auto;  /* Width fixed, height auto */
          margin: 7mm;
        }
        body { 
          font-family: Arial, sans-serif;
          width: 70mm;
          font-size: 9pt;
          line-height: 1.2;
          margin: 0;
          padding: 2mm;
        }
        .header {
          text-align: center;
          font-weight: bold;
          font-size: 10pt;
          margin-bottom: 3mm;
        }
        .divider {
          border-top: 1px dashed #000;
          margin: 2mm 0;
        }
        .result-item {
          margin-bottom: 3mm;
          border-bottom: 1px dashed #000;
          padding-bottom: 2mm;
        }
        .result-item h5 {
          font-size: 9pt;
          margin: 1mm 0;
          font-weight: bold;
        }
        .result-item p {
          margin: 1mm 0;
          font-size: 8pt;
        }
        .alert {
          margin-top: 2mm;
          padding: 1mm;
        }
        .alert h5 {
          font-weight: bold;
          margin: 1mm 0;
        }
        .footer {
          text-align: center;
          font-size: 8pt;
          margin-top: 3mm;
        }
        /* Simplify the layout */
        .row::after {
          content: "";
          display: table;
          clear: both;
        }
        .col-md-6 {
          width: 100%;
        }
        /* Remove background colors and borders */
        .alert-success, .alert-danger, .alert-info {
          background: none !important;
          border: none !important;
        }
        /* Remove icons */
        .fas {
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="header">
        Melati Gold Shop
      </div>
      <div class="header">
        Perhitungan Buyback Perhiasan
      </div>
      <div class="divider"></div>
      
      <!-- Insert modal content directly -->
      ${modalContent}
      
      <div class="divider"></div>
    </body>
    </html>
  `;

  // Open a new window with the content
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();

  // Print immediately when loaded
  printWindow.onload = function () {
    // Short delay to ensure content is rendered
    setTimeout(() => {
      printWindow.print();
      printWindow.onafterprint = function () {
        printWindow.close();
      };
    }, 500);
  };
}

// ==================== CONDITION VISUAL FUNCTIONS ====================

// Initialize Firebase functions
function initializeFirebaseFunctions() {
  // Setup edit mode button
  document.getElementById('editModeBtn').addEventListener('click', toggleEditMode);
  
  // Setup save button
  document.getElementById('saveMediaBtn').addEventListener('click', saveAllChanges);
}

// Show condition visual modal
function showConditionVisual(condition) {
  currentCondition = condition;
  
  // Update modal title
  const conditionNames = {
    '1': 'Kondisi Sangat Baik (K1)',
    '2': 'Kondisi Sedang (K2)', 
    '3': 'Kondisi Kurang (K3)'
  };
  
  document.getElementById('conditionTitle').textContent = conditionNames[condition];
  
  // Show loading
  document.getElementById('loadingSpinner').style.display = 'block';
  document.getElementById('conditionVisualContent').style.display = 'none';
  
  // Show modal
  const modal = new bootstrap.Modal(document.getElementById('conditionVisualModal'));
  modal.show();
  
  // Load media from Firebase
  loadConditionMedia(condition);
}

// Load condition media from Firebase
async function loadConditionMedia(condition) {
  try {
    const mediaRef = database.ref(`conditionMedia/K${condition}`);
    const snapshot = await mediaRef.once('value');
    const mediaData = snapshot.val() || {};
    
    // Load photos
    for (let i = 0; i < 6; i++) {
      const photoData = mediaData.photos?.[i];
      const mediaItem = document.querySelector(`[data-type="photo"][data-index="${i}"]`);
      
      if (photoData && photoData.url) {
        displayMedia(mediaItem, photoData.url, 'photo');
      } else {
        resetMediaItem(mediaItem, 'photo', i + 1);
      }
    }
    
    // Load video
    const videoData = mediaData.video;
    const videoItem = document.querySelector(`[data-type="video"][data-index="0"]`);
    
    if (videoData && videoData.url) {
      displayMedia(videoItem, videoData.url, 'video');
    } else {
      resetMediaItem(videoItem, 'video', 'Video');
    }
    
    // Hide loading, show content
    document.getElementById('loadingSpinner').style.display = 'none';
    document.getElementById('conditionVisualContent').style.display = 'block';
    
  } catch (error) {
    console.error('Error loading media:', error);
    showAlert('Gagal memuat media: ' + error.message, 'danger');
    
    // Hide loading, show content anyway
    document.getElementById('loadingSpinner').style.display = 'none';
    document.getElementById('conditionVisualContent').style.display = 'block';
  }
}

// Display media in item
function displayMedia(mediaItem, url, type) {
  const placeholder = mediaItem.querySelector('.upload-placeholder');
  const controls = mediaItem.querySelector('.media-controls');
  
  // Clear placeholder
  placeholder.innerHTML = '';
  
  if (type === 'photo') {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'media-preview';
    img.alt = 'Kondisi barang';
    placeholder.appendChild(img);
  } else if (type === 'video') {
    const video = document.createElement('video');
    video.src = url;
    video.className = 'media-preview';
    video.controls = true;
    video.muted = true;
    placeholder.appendChild(video);
  }
  
  // Mark as has content
  mediaItem.classList.add('has-content');
  
  // Show delete button if in edit mode
  if (isEditMode) {
    const deleteBtn = controls.querySelector('.btn-danger');
    if (deleteBtn) deleteBtn.style.display = 'inline-block';
  }
}

// Reset media item to placeholder
function resetMediaItem(mediaItem, type, label) {
  const placeholder = mediaItem.querySelector('.upload-placeholder');
  const controls = mediaItem.querySelector('.media-controls');
  
  // Reset placeholder
  const icon = type === 'photo' ? 'fa-camera' : 'fa-video';
  placeholder.innerHTML = `
    <i class="fas ${icon} fa-2x mb-2"></i>
    <p>${type === 'photo' ? 'Foto ' + label : label}</p>
  `;
  
  // Remove has-content class
  mediaItem.classList.remove('has-content');
  
  // Hide delete button
  const deleteBtn = controls.querySelector('.btn-danger');
  if (deleteBtn) deleteBtn.style.display = 'none';
}

// Toggle edit mode
function toggleEditMode() {
  isEditMode = !isEditMode;
  const editBtn = document.getElementById('editModeBtn');
  const saveBtn = document.getElementById('saveMediaBtn');
  const controls = document.querySelectorAll('.media-controls');
  
  if (isEditMode) {
    editBtn.innerHTML = '<i class="fas fa-eye me-1"></i>Mode Lihat';
    editBtn.className = 'btn btn-sm btn-secondary';
    saveBtn.style.display = 'inline-block';
    
    // Show all controls
    controls.forEach(control => {
      control.style.display = 'flex';
    });
    
    // Show delete buttons for items with content
    document.querySelectorAll('.media-item.has-content .btn-danger').forEach(btn => {
      btn.style.display = 'inline-block';
    });
    
  } else {
    editBtn.innerHTML = '<i class="fas fa-edit me-1"></i>Mode Edit';
    editBtn.className = 'btn btn-sm btn-warning';
    saveBtn.style.display = 'none';
    
    // Hide all controls
    controls.forEach(control => {
      control.style.display = 'none';
    });
  }
}

// Handle file upload
async function handleFileUpload(input, index, type) {
  const file = input.files[0];
  if (!file) return;
  
  // Validate file
  const maxSize = type === 'photo' ? 5 * 1024 * 1024 : 50 * 1024 * 1024; // 5MB for photos, 50MB for videos
  if (file.size > maxSize) {
    showAlert(`Ukuran file terlalu besar. Maksimal ${type === 'photo' ? '5MB' : '50MB'}`, 'danger');
    return;
  }
  
  // Show loading on the media item
  const mediaItem = input.closest('.media-item');
  const placeholder = mediaItem.querySelector('.upload-placeholder');
  const originalContent = placeholder.innerHTML;
  
  placeholder.innerHTML = `
    <div class="spinner-border spinner-border-sm" role="status">
      <span class="visually-hidden">Uploading...</span>
    </div>
    <p class="mt-2">Uploading...</p>
  `;
  
  try {
    // Create storage reference
    const fileName = `K${currentCondition}_${type}_${index}_${Date.now()}.${file.name.split('.').pop()}`;
    const storageRef = storage.ref(`conditionMedia/${fileName}`);
    
    // Upload file
    const uploadTask = storageRef.put(file);
    
    // Wait for upload to complete
    await uploadTask;
    
    // Get download URL
    const downloadURL = await storageRef.getDownloadURL();
    
    // Store in pending changes
    if (!pendingChanges[currentCondition]) {
      pendingChanges[currentCondition] = {};
    }
    
    if (type === 'photo') {
      if (!pendingChanges[currentCondition].photos) {
        pendingChanges[currentCondition].photos = {};
      }
      pendingChanges[currentCondition].photos[index] = {
        url: downloadURL,
        fileName: fileName,
        uploadedAt: Date.now()
      };
    } else {
      pendingChanges[currentCondition].video = {
        url: downloadURL,
        fileName: fileName,
        uploadedAt: Date.now()
      };
    }
    
    // Display the media
    displayMedia(mediaItem, downloadURL, type);
    
    // Show save button
    document.getElementById('saveMediaBtn').style.display = 'inline-block';
    
    showAlert('File berhasil diupload. Klik "Simpan Perubahan" untuk menyimpan.', 'success');
    
  } catch (error) {
    console.error('Upload error:', error);
    showAlert('Gagal mengupload file: ' + error.message, 'danger');
    
    // Restore original content
    placeholder.innerHTML = originalContent;
  }
  
  // Clear input
  input.value = '';
}

// Remove media
async function removeMedia(index, type) {
  if (!confirm('Apakah Anda yakin ingin menghapus media ini?')) {
    return;
  }
  
  try {
    // Get current media data
    const mediaRef = database.ref(`conditionMedia/K${currentCondition}`);
    const snapshot = await mediaRef.once('value');
    const mediaData = snapshot.val() || {};
    
    let fileToDelete = null;
    
    if (type === 'photo' && mediaData.photos?.[index]) {
      fileToDelete = mediaData.photos[index].fileName;
    } else if (type === 'video' && mediaData.video) {
      fileToDelete = mediaData.video.fileName;
    }
    
    // Delete from storage if file exists
    if (fileToDelete) {
      try {
        const fileRef = storage.ref(`conditionMedia/${fileToDelete}`);
        await fileRef.delete();
      } catch (storageError) {
        console.warn('File not found in storage:', storageError);
      }
    }
    
    // Update database
    if (type === 'photo') {
      await database.ref(`conditionMedia/K${currentCondition}/photos/${index}`).remove();
    } else {
      await database.ref(`conditionMedia/K${currentCondition}/video`).remove();
    }
    
    // Update pending changes
    if (pendingChanges[currentCondition]) {
      if (type === 'photo' && pendingChanges[currentCondition].photos) {
        delete pendingChanges[currentCondition].photos[index];
      } else if (type === 'video') {
        delete pendingChanges[currentCondition].video;
      }
    }
    
    // Reset media item
    const mediaItem = document.querySelector(`[data-type="${type}"][data-index="${index}"]`);
    const label = type === 'photo' ? parseInt(index) + 1 : 'Video';
    resetMediaItem(mediaItem, type, label);
    
    showAlert('Media berhasil dihapus', 'success');
    
  } catch (error) {
    console.error('Error removing media:', error);
    showAlert('Gagal menghapus media: ' + error.message, 'danger');
  }
}

// Save all changes
async function saveAllChanges() {
  if (Object.keys(pendingChanges).length === 0) {
    showAlert('Tidak ada perubahan untuk disimpan', 'info');
    return;
  }
  
  const saveBtn = document.getElementById('saveMediaBtn');
  const originalText = saveBtn.innerHTML;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Menyimpan...';
  saveBtn.disabled = true;
  
  try {
    // Save to Firebase Realtime Database
    for (const condition in pendingChanges) {
      const conditionRef = database.ref(`conditionMedia/K${condition}`);
      await conditionRef.update(pendingChanges[condition]);
    }
    
    // Clear pending changes
    pendingChanges = {};
    
    // Hide save button
    saveBtn.style.display = 'none';
    
    showAlert('Semua perubahan berhasil disimpan', 'success');
    
  } catch (error) {
    console.error('Error saving changes:', error);
    showAlert('Gagal menyimpan perubahan: ' + error.message, 'danger');
  } finally {
    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
  }
}

// Make functions globally available
window.showConditionVisual = showConditionVisual;
window.handleFileUpload = handleFileUpload;
window.removeMedia = removeMedia;


