// Import modules
import {
  uploadFile,
  checkTemporaryFiles,
  uploadAllTemporaryFiles,
  getCloudinaryUrl,
  removeTemporaryFile,
} from "./cloudinary-service.js";

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
  collection,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

import { firestore } from "./configFirebase.js"; // Pindahkan import ke sini

// Global variables
let currentCondition = "1";
let isEditMode = false;
let pendingChanges = {};
let mediaGallery = [];
let currentMediaIndex = 0;
let persentaseMap = { 1: 97, 2: 92, 3: 85, 4: 70 };

// Initialize page
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Remove setTimeout and check firestore directly
    if (!firestore) {
      throw new Error("Firestore not initialized");
    }

    // Load persentase settings from Firestore
    await loadPersentaseSettings();

    // Initialize all required functions
    await setupBuybackForm();
    initializeFirebaseFunctions();
    setupImageViewer();
    setupSettingsButton();

    console.log("Buyback page initialized successfully");
  } catch (error) {
    console.error("Initialization error:", error);
    showAlert("Terjadi kesalahan saat inisialisasi: " + error.message, "danger");
  }
});

// Setup buyback form
function setupBuybackForm() {
  const btnTambah = document.getElementById("btnTambahPenerimaan");
  if (btnTambah) {
    btnTambah.addEventListener("click", addNewRow);
  }

  const form = document.getElementById("penerimaanForm");
  if (form) {
    form.addEventListener("submit", calculateBuyback);
  }

  const printButton = document.getElementById("printModalButton");
  if (printButton) {
    printButton.addEventListener("click", printModal);
  }

  setupDeleteButtons();
  setupConditionVisualButtons();
  setupOfflineMonitoring();
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
          <option value="4">K4</option>
        </select>
      </div>
    </td>
    <td>
      <input name="hargaBeli" class="form-control form-control-sm" placeholder="Harga beli" type="number" required min="0" />
    </td>
    <td>
      <input name="hargaHariIni" class="form-control form-control-sm" placeholder="Harga hari ini" type="number" required min="0" />
    </td>
    <td>
      <button type="button" class="btn btn-danger btn-sm hapus-baris">
        <i class="fas fa-trash"></i>
      </button>
    </td>
  `;

  tbody.appendChild(newRow);
  setupDeleteButtons();
  setupConditionVisualButtons();
}

// Setup delete buttons
function setupDeleteButtons() {
  const deleteButtons = document.querySelectorAll(".hapus-baris");
  const rows = document.querySelectorAll("#tablePenerimaan tbody tr");

  if (rows.length > 1) {
    deleteButtons.forEach((btn) => {
      btn.disabled = false;
      btn.removeEventListener("click", deleteRow);
      btn.addEventListener("click", deleteRow);
    });
  } else {
    deleteButtons[0].disabled = true;
  }
}

// Setup condition visual buttons
function setupConditionVisualButtons() {
  document.querySelectorAll(".condition-visual-btn").forEach((button) => {
    button.removeEventListener("click", handleConditionVisualClick);
    button.addEventListener("click", handleConditionVisualClick);
  });
}

// Handle condition visual click
function handleConditionVisualClick() {
  const condition = this.getAttribute("data-condition") || "1";
  showConditionVisual(condition);
}

// Delete row
function deleteRow(e) {
  const button = e.currentTarget;
  const row = button.closest("tr");
  row.remove();

  const rows = document.querySelectorAll("#tablePenerimaan tbody tr");
  rows.forEach((row, index) => {
    row.cells[0].textContent = index + 1;
  });

  setupDeleteButtons();
}

// Calculate buyback
function calculateBuyback(e) {
  e.preventDefault();

  const rows = document.querySelectorAll("#tablePenerimaan tbody tr");
  const items = [];
  let isValid = true;

  rows.forEach((row) => {
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

  const results = calculateBuybackPrice(items);
  showResults(results);
}

// Calculate buyback price
function calculateBuybackPrice(items) {
  const results = [];

  items.forEach((item) => {
    let buybackPercentage = 0;
    let buybackPrice = 0;

    if (item.hargaBeli <= item.hargaHariIni) {
      const persentaseBeli = (item.hargaBeli / item.hargaHariIni) * 100;
      buybackPercentage = calculatePersentase(parseInt(item.kondisiBarang), persentaseBeli);

      // Pastikan buybackPercentage valid number
      if (isNaN(buybackPercentage)) buybackPercentage = 0;

      buybackPrice = (item.hargaHariIni * buybackPercentage) / 100;
      buybackPrice = roundBuybackPrice(buybackPrice);

      if (buybackPrice < item.hargaBeli) {
        buybackPrice = item.hargaBeli;
      }
    } else {
      buybackPrice = item.hargaHariIni;
    }

    let percentageDifference;
    if (isNaN(buybackPrice) || isNaN(item.hargaBeli)) {
      percentageDifference = "0.00";
    } else {
      const priceDifference = buybackPrice - item.hargaBeli;
      percentageDifference = ((priceDifference / item.hargaBeli) * 100).toFixed(2);
    }

    results.push({
      ...item,
      buybackPercentage: parseFloat((buybackPercentage || 0).toFixed(2)),
      buybackPrice,
      priceDifference: buybackPrice - item.hargaBeli,
      percentageDifference,
      isHigherPurchasePrice: item.hargaBeli > item.hargaHariIni,
    });
  });

  return results;
}

// Round buyback price
function roundBuybackPrice(price) {
  const lastThousand = Math.floor((price % 10000) / 1000);
  if (lastThousand < 5) {
    return Math.floor(price / 10000) * 10000 + 5000;
  } else {
    return Math.ceil(price / 10000) * 10000;
  }
}

// Calculate percentage
function calculatePersentase(kondisiBarang, persentaseBeli) {
  return persentaseMap[kondisiBarang] || 0;
}

// Show results in modal
// Modifikasi fungsi showResults untuk menampilkan persentase potongan yang dinamis
function showResults(results) {
  const modalBody = document.getElementById("modalMessage");
  let content = `
    <div class="alert alert-info mb-1 d-none">
      <i class="fas fa-info-circle me-2"></i>
    </div>
  `;

  results.forEach((result, index) => {
    const conditionText =
      result.kondisiBarang === "1"
        ? "Mengkilap / Mulus / Model Bagus"
        : result.kondisiBarang === "2"
        ? "Sedikit Kusam / Sedikit Baret"
        : result.kondisiBarang === "3"
        ? "Kusam / Banyak Baret"
        : "Ada Reject / Butterfly Hilang / Lock Rusak)";

    // Tentukan persentase potongan berdasarkan kondisi
    const getDiscountPercentage = (kondisi) => {
      switch (kondisi) {
        case "1":
        case "2":
        case "3":
          return "10% / 15%";
        case "4":
          return "15% / 20%";
        default:
          return "10% / 15%";
      }
    };

    const discountPercentage = getDiscountPercentage(result.kondisiBarang);

    let specialNotice = "";

    if (result.isHigherPurchasePrice) {
      specialNotice = `
        <div class="alert alert-warning mb-3">
          <i class="fas fa-exclamation-triangle me-2"></i>
          <strong>Perhatian:</strong> Harga per gram saat beli lebih tinggi dari harga per gram hari ini. 
          Harga penerimaan menggunakan 100% dari harga hari ini.
        </div>
      `;
    }

    // Tambahkan notifikasi khusus untuk kondisi K4 dengan class "no-print"
    if (result.kondisiBarang === "4") {
      specialNotice += `
        <div class="alert alert-info mb-3 no-print">
          <i class="fas fa-info-circle me-2"></i>
          <strong>Informasi:</strong> Untuk kondisi K4 (Tidak Sempurna), potongan yang diterapkan adalah 15% / 20%.
        </div>
      `;
    }

    const namaBarang = result.namaBarang || "Perhiasan";
    content += `
    <div class="result-item">
      <h4 class="mb-3"><strong>Item ${index + 1}:</strong> ${namaBarang}</h4>
      ${specialNotice}
      <div class="row mb-2">
        <div class="col-md-12">
          <p class="mb-1"><strong>Kadar:</strong> ${result.kadar}</p>
          <p class="mb-1"><strong>Kondisi:</strong> ${conditionText}</p>
        </div>
      </div>
      <div class="alert ${result.priceDifference >= 0 ? "alert-success" : "alert-danger"} mb-0">
        <div class="row">
          <div class="col-md-12">
            <p class="mb-0 fs-6 fw-bold">Harga Buyback Per Gram Sebelum Potongan ${discountPercentage}: \n <strong>Rp ${formatNumber(
      result.buybackPrice
    )}</strong></p>
          </div>
        </div>
      </div>
      <div class="alert alert-warning my-2">
        <i class="fas fa-info-circle me-2"></i>
        Note: Harga buyback per gram bisa berubah sesuai dengan kondisi barang
      </div>
    </div>
  `;
  });

  const now = new Date();
  content += `
  <div class="text-end text-muted mt-3">
    Dihitung pada: ${now.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}
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
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
  alertDiv.innerHTML = `
    <i class="fas fa-${type === "danger" ? "exclamation-circle" : "exclamation-triangle"} me-2"></i>
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;

  const form = document.getElementById("penerimaanForm");
  form.parentNode.insertBefore(alertDiv, form);

  setTimeout(() => {
    const bsAlert = new bootstrap.Alert(alertDiv);
    bsAlert.close();
  }, 5000);
}

// Print modal content
function printModal() {
  const modalContent = document.getElementById("modalMessage").innerHTML;
  const printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Print</title>
      <style>
        @page { size: 75mm auto; margin: 7mm; }
        body { 
          font-family: consolas;
          width: 70mm;
          font-size: 9pt;
          line-height: 1.2;
          margin: 0;
          padding: 2mm;
          margin-left: 4mm;
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
        .result-item h4 {
          font-size: 10pt;
          margin: 1mm 0;
          font-weight: bold;
        }
        .result-item p {
          margin: 1mm 0;
          font-size: 10pt;
        }
        .alert {
          margin-top: 2mm;
          padding: 1mm;
        }
        .alert h5 {
          font-weight: bold;
          margin: 1mm 0;
        }
        .row::after {
          content: "";
          display: table;
          clear: both;
        }
        .col-md-6 {
          width: 100%;
        }
        .alert-success, .alert-danger, .alert-info {
          background: none !important;
          border: none !important;
        }
        .fas {
          display: none;
        }
        /* CSS untuk menyembunyikan elemen dengan class no-print saat print */
        .no-print {
          display: none !important;
        }
      </style>
    </head>
    <body>
      <div class="header">Melati Gold Shop</div>
      <div class="header">Perhitungan Buyback Perhiasan</div>
      <div class="divider"></div>
      ${modalContent}
      <div class="divider"></div>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();

  printWindow.onload = function () {
    setTimeout(() => {
      printWindow.print();
      printWindow.onafterprint = function () {
        printWindow.close();
      };
    }, 500);
  };
}

// ==================== SETTINGS FUNCTIONS ====================

// Load persentase settings from Firestore
async function loadPersentaseSettings() {
  try {
    const settingsDocRef = doc(firestore, "setting_buyback", "default");
    const settingsDoc = await getDoc(settingsDocRef);

    if (settingsDoc.exists()) {
      const data = settingsDoc.data();
      persentaseMap = {
        1: data.K1,
        2: data.K2,
        3: data.K3,
        4: data.K4,
      };
    }
  } catch (error) {
    console.error("Error loading persentase settings:", error);
  }
}

// Setup settings button and modals
function setupSettingsButton() {
  const btnSetting = document.getElementById("btnSetting");
  const settingsPasswordModal = new bootstrap.Modal(document.getElementById("settingsPasswordModal"));
  const buybackSettingsModal = new bootstrap.Modal(document.getElementById("buybackSettingsModal"));
  const verifyPasswordBtn = document.getElementById("verifyPasswordBtn");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");

  // Show password modal when settings button is clicked
  btnSetting.addEventListener("click", () => {
    document.getElementById("settingsPassword").value = "";
    settingsPasswordModal.show();
  });

  // Verify password
  verifyPasswordBtn.addEventListener("click", () => {
    const password = document.getElementById("settingsPassword").value;
    if (password === "smlt116") {
      settingsPasswordModal.hide();
      showBuybackSettings();
      buybackSettingsModal.show();
    } else {
      alert("Password salah!");
    }
  });

  // Save settings
  saveSettingsBtn.addEventListener("click", savePersentaseSettings);
}

// Show buyback settings
function showBuybackSettings() {
  document.getElementById("persentaseK1").value = persentaseMap["1"];
  document.getElementById("persentaseK2").value = persentaseMap["2"];
  document.getElementById("persentaseK3").value = persentaseMap["3"];
  document.getElementById("persentaseK4").value = persentaseMap["4"];
}

// Save persentase settings
async function savePersentaseSettings() {
  const k1 = parseFloat(document.getElementById("persentaseK1").value);
  const k2 = parseFloat(document.getElementById("persentaseK2").value);
  const k3 = parseFloat(document.getElementById("persentaseK3").value);
  const k4 = parseFloat(document.getElementById("persentaseK4").value);

  // Validate input
  if ([k1, k2, k3, k4].some((val) => isNaN(val) || val < 0 || val > 100)) {
    alert("Semua nilai harus berupa angka antara 0-100!");
    return;
  }

  try {
    // Update Firestore
    const settingsDocRef = doc(firestore, "setting_buyback", "default");
    await setDoc(settingsDocRef, {
      K1: k1,
      K2: k2,
      K3: k3,
      K4: k4,
    });

    // Update local persentaseMap
    persentaseMap = {
      1: k1,
      2: k2,
      3: k3,
      4: k4,
    };

    const modal = bootstrap.Modal.getInstance(document.getElementById("buybackSettingsModal"));
    modal.hide();

    showAlert("Pengaturan berhasil disimpan", "success");
  } catch (error) {
    console.error("Error saving persentase settings:", error);
    showAlert("Gagal menyimpan pengaturan: " + error.message, "danger");
  }
}

// ==================== CONDITION VISUAL FUNCTIONS ====================

// Initialize Firebase functions
function initializeFirebaseFunctions() {
  document.getElementById("editModeBtn")?.addEventListener("click", toggleEditMode);
  document.getElementById("saveMediaBtn")?.addEventListener("click", saveAllChanges);
  setupFileUploadListeners();
}

// Show condition visual modal
function showConditionVisual(condition) {
  currentCondition = condition;

  const conditionNames = {
    1: "Kondisi Sangat Baik (K1)",
    2: "Kondisi Sedang (K2)",
    3: "Kondisi Kurang (K3)",
    4: "Kondisi Tidak Sempurna (K4)",
  };

  document.getElementById("conditionTitle").textContent = conditionNames[condition];
  document.getElementById("loadingSpinner").style.display = "block";
  document.getElementById("conditionVisualContent").style.display = "none";

  const modal = new bootstrap.Modal(document.getElementById("conditionVisualModal"));
  modal.show();

  loadConditionMedia(condition);
}

// Load condition media from Firestore
async function loadConditionMedia(condition) {
  try {
    if (!firestore) {
      throw new Error("Firestore tidak tersedia");
    }

    await checkAndUploadPendingFiles();

    const docRef = doc(firestore, "conditionMedia", `K${condition}`);
    const docSnap = await getDoc(docRef);
    const mediaData = docSnap.exists() ? docSnap.data() : {};

    // Reset media gallery
    mediaGallery = [];

    // Load photos
    for (let i = 0; i < 6; i++) {
      const photoData = mediaData.photos?.[i];
      const mediaItem = document.querySelector(`[data-type="photo"][data-index="${i}"]`);

      if (mediaItem) {
        if (photoData && photoData.url) {
          const displayUrl = photoData.publicId
            ? getCloudinaryUrl(
                photoData.publicId,
                {
                  width: 300,
                  height: 300,
                  crop: "fill",
                  quality: "auto",
                },
                "image"
              )
            : photoData.url; // Tambahkan 'image' sebagai resource type

          displayMedia(mediaItem, displayUrl, "photo");

          // Add to gallery
          mediaGallery.push({
            type: "photo",
            url: photoData.publicId
              ? getCloudinaryUrl(photoData.publicId, { quality: "auto" }, "image")
              : photoData.url,
            title: `Foto ${i + 1}`,
            index: i,
          });
        } else {
          resetMediaItem(mediaItem, "photo", i + 1);
        }
      }
    }

    // Load video
    const videoData = mediaData.video;
    const videoItem = document.querySelector(`[data-type="video"][data-index="0"]`);

    if (videoItem) {
      if (videoData && videoData.url) {
        const displayUrl = videoData.publicId
          ? getCloudinaryUrl(videoData.publicId, { quality: "auto" }, "video") // Gunakan 'video' sebagai resource type
          : videoData.url;

        displayMedia(videoItem, displayUrl, "video");

        // Add to gallery
        mediaGallery.push({
          type: "video",
          url: displayUrl,
          title: "Video",
          index: 0,
        });
      } else {
        resetMediaItem(videoItem, "video", "Video");
      }
    }

    document.getElementById("loadingSpinner").style.display = "none";
    document.getElementById("conditionVisualContent").style.display = "block";
  } catch (error) {
    console.error("Error loading media:", error);
    showAlert("Gagal memuat media: " + error.message, "danger");
    document.getElementById("loadingSpinner").style.display = "none";
    document.getElementById("conditionVisualContent").style.display = "block";
  }
}

// Check and upload pending files
async function checkAndUploadPendingFiles() {
  if (!navigator.onLine) return;

  try {
    const result = await uploadAllTemporaryFiles();
    if (result.success > 0) {
      showAlert(`${result.success} file berhasil diupload dari penyimpanan sementara`, "success");
    }
  } catch (error) {
    console.error("Error uploading pending files:", error);
  }
}

// Setup offline monitoring
function setupOfflineMonitoring() {
  const offlineIndicator = document.getElementById("offlineIndicator");

  window.addEventListener("online", async () => {
    offlineIndicator.classList.remove("show");
    showAlert("Koneksi kembali online. Mengupload file tertunda...", "info");
    await checkAndUploadPendingFiles();
  });

  window.addEventListener("offline", () => {
    offlineIndicator.classList.add("show");
    showAlert("Koneksi offline. File akan disimpan sementara.", "warning");
  });

  // Check initial status
  if (!navigator.onLine) {
    offlineIndicator.classList.add("show");
  }
}

// Display media in item
function displayMedia(mediaItem, url, type) {
  const placeholder = mediaItem.querySelector(".upload-placeholder");
  const controls = mediaItem.querySelector(".media-controls");

  placeholder.innerHTML = "";

  if (type === "photo") {
    const img = document.createElement("img");
    img.src = url;
    img.className = "media-preview";
    img.alt = "Kondisi barang";
    img.addEventListener("click", () => openImageViewer(url, type));
    placeholder.appendChild(img);
  } else if (type === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.className = "media-preview";
    video.controls = true;
    video.muted = true;
    video.addEventListener("click", () => openImageViewer(url, type));
    placeholder.appendChild(video);
  }

  mediaItem.classList.add("has-content");

  if (isEditMode) {
    const deleteBtn = controls.querySelector(".btn-danger");
    if (deleteBtn) deleteBtn.style.display = "inline-block";
  }
}

// Reset media item
function resetMediaItem(mediaItem, type, label) {
  const placeholder = mediaItem.querySelector(".upload-placeholder");
  const controls = mediaItem.querySelector(".media-controls");

  const icon = type === "photo" ? "fa-camera" : "fa-video";
  placeholder.innerHTML = `
    <i class="fas ${icon} fa-2x mb-2"></i>
    <p>${type === "photo" ? "Foto " + label : label}</p>
  `;

  mediaItem.classList.remove("has-content");

  const deleteBtn = controls.querySelector(".btn-danger");
  if (deleteBtn) deleteBtn.style.display = "none";
}

// Toggle edit mode
function toggleEditMode() {
  isEditMode = !isEditMode;
  const editBtn = document.getElementById("editModeBtn");
  const saveBtn = document.getElementById("saveMediaBtn");
  const controls = document.querySelectorAll(".media-controls");

  if (isEditMode) {
    editBtn.innerHTML = '<i class="fas fa-eye me-1"></i>Mode Lihat';
    editBtn.className = "btn btn-sm btn-secondary";
    saveBtn.style.display = "inline-block";

    controls.forEach((control) => {
      control.style.display = "flex";
    });

    document.querySelectorAll(".media-item.has-content .btn-danger").forEach((btn) => {
      btn.style.display = "inline-block";
    });
  } else {
    editBtn.innerHTML = '<i class="fas fa-edit me-1"></i>Mode Edit';
    editBtn.className = "btn btn-sm btn-warning";
    saveBtn.style.display = "none";

    controls.forEach((control) => {
      control.style.display = "none";
    });
  }
}

// Setup file upload listeners
function setupFileUploadListeners() {
  document.querySelectorAll(".upload-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const mediaItem = this.closest(".media-item");
      const fileInput = mediaItem.querySelector(".file-upload");
      fileInput.click();
    });
  });

  document.querySelectorAll(".file-upload").forEach((input) => {
    input.addEventListener("change", function () {
      const index = this.getAttribute("data-index");
      const type = this.getAttribute("data-type");
      handleFileUpload(this, index, type);
    });
  });

  document.querySelectorAll(".remove-media-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const index = this.getAttribute("data-index");
      const type = this.getAttribute("data-type");
      removeMedia(index, type);
    });
  });
}

// Handle file upload with progress
async function handleFileUpload(input, index, type) {
  const file = input.files[0];
  if (!file) return;

  const maxSize = type === "photo" ? 5 * 1024 * 1024 : 50 * 1024 * 1024;
  if (file.size > maxSize) {
    showAlert(`Ukuran file terlalu besar. Maksimal ${type === "photo" ? "5MB" : "50MB"}`, "danger");
    return;
  }

  const mediaItem = input.closest(".media-item");
  const placeholder = mediaItem.querySelector(".upload-placeholder");
  const progressContainer = mediaItem.querySelector(".upload-progress");
  const progressBar = mediaItem.querySelector(".upload-progress-bar");
  const originalContent = placeholder.innerHTML;

  // Show progress
  progressContainer.style.display = "block";
  progressBar.style.width = "0%";

  placeholder.innerHTML = `
    <div class="spinner-border spinner-border-sm" role="status">
      <span class="visually-hidden">Uploading...</span>
    </div>
    <p class="mt-2">Uploading...</p>
  `;

  try {
    const folder = `buyback/conditions/K${currentCondition}`;

    // Simulate progress for better UX
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 30;
      if (progress > 90) progress = 90;
      progressBar.style.width = progress + "%";
    }, 200);

    const uploadResult = await uploadFile(file, folder);

    // Complete progress
    clearInterval(progressInterval);
    progressBar.style.width = "100%";

    // Store in pending changes
    if (!pendingChanges[currentCondition]) {
      pendingChanges[currentCondition] = {};
    }

    const mediaData = {
      url: uploadResult.url,
      publicId: uploadResult.publicId,
      resourceType: uploadResult.resourceType || (type === "photo" ? "image" : "video"), // Simpan resource type
      uploadedAt: Date.now(),
      isTemporary: uploadResult.isTemporary || false,
    };

    if (type === "photo") {
      if (!pendingChanges[currentCondition].photos) {
        pendingChanges[currentCondition].photos = {};
      }
      pendingChanges[currentCondition].photos[index] = mediaData;
    } else {
      pendingChanges[currentCondition].video = mediaData;
    }

    // Display the media with optimization
    const resourceType = type === "photo" ? "image" : "video";
    const optimizedUrl = uploadResult.isTemporary
      ? uploadResult.url
      : getCloudinaryUrl(
          uploadResult.publicId,
          {
            width: type === "photo" ? 300 : undefined,
            height: type === "photo" ? 300 : undefined,
            crop: type === "photo" ? "fill" : undefined,
            quality: "auto",
          },
          resourceType
        );

    displayMedia(mediaItem, optimizedUrl, type);

    // Add to gallery
    const galleryItem = {
      type: type,
      url: uploadResult.isTemporary
        ? uploadResult.url
        : getCloudinaryUrl(uploadResult.publicId, { quality: "auto" }, resourceType),
      title: type === "photo" ? `Foto ${parseInt(index) + 1}` : "Video",
      index: parseInt(index),
    };

    // Update gallery
    const existingIndex = mediaGallery.findIndex((item) => item.type === type && item.index === parseInt(index));

    if (existingIndex >= 0) {
      mediaGallery[existingIndex] = galleryItem;
    } else {
      mediaGallery.push(galleryItem);
    }

    const message = uploadResult.isTemporary
      ? "File disimpan sementara (offline). Akan diupload saat online."
      : 'File berhasil diupload. Klik "Simpan Perubahan" untuk menyimpan.';

    showAlert(message, uploadResult.isTemporary ? "warning" : "success");
    document.getElementById("saveMediaBtn").style.display = "inline-block";
  } catch (error) {
    console.error("Upload error:", error);
    showAlert("Gagal mengupload file: " + error.message, "danger");
    placeholder.innerHTML = originalContent;
  } finally {
    // Hide progress
    setTimeout(() => {
      progressContainer.style.display = "none";
      progressBar.style.width = "0%";
    }, 1000);
  }

  input.value = "";
}

// Remove media
async function removeMedia(index, type) {
  if (!confirm("Apakah Anda yakin ingin menghapus media ini?")) {
    return;
  }

  try {
    const docRef = doc(firestore, "conditionMedia", `K${currentCondition}`);
    const docSnap = await getDoc(docRef);
    const mediaData = docSnap.exists() ? docSnap.data() : {};

    // Update database
    if (type === "photo") {
      await updateDoc(docRef, {
        [`photos.${index}`]: deleteField(),
      });
    } else {
      await updateDoc(docRef, {
        video: deleteField(),
      });
    }

    // Update pending changes
    if (pendingChanges[currentCondition]) {
      if (type === "photo" && pendingChanges[currentCondition].photos) {
        delete pendingChanges[currentCondition].photos[index];
      } else if (type === "video") {
        delete pendingChanges[currentCondition].video;
      }
    }

    // Remove from gallery
    mediaGallery = mediaGallery.filter((item) => !(item.type === type && item.index === parseInt(index)));

    // Reset media item
    const mediaItem = document.querySelector(`[data-type="${type}"][data-index="${index}"]`);
    const label = type === "photo" ? parseInt(index) + 1 : "Video";
    resetMediaItem(mediaItem, type, label);

    showAlert("Media berhasil dihapus", "success");
  } catch (error) {
    console.error("Error removing media:", error);
    showAlert("Gagal menghapus media: " + error.message, "danger");
  }
}

// Save all changes
async function saveAllChanges() {
  if (Object.keys(pendingChanges).length === 0) {
    showAlert("Tidak ada perubahan untuk disimpan", "info");
    return;
  }

  const saveBtn = document.getElementById("saveMediaBtn");
  const originalText = saveBtn.innerHTML;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Menyimpan...';
  saveBtn.disabled = true;

  try {
    for (const condition in pendingChanges) {
      const docRef = doc(firestore, "conditionMedia", `K${condition}`);
      const updateData = {
        ...pendingChanges[condition],
        updatedAt: serverTimestamp(),
      };

      await setDoc(docRef, updateData, { merge: true });
    }

    pendingChanges = {};
    saveBtn.style.display = "none";
    showAlert("Semua perubahan berhasil disimpan", "success");
  } catch (error) {
    console.error("Error saving changes:", error);
    showAlert("Gagal menyimpan perubahan: " + error.message, "danger");
  } finally {
    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
  }
}

// ==================== IMAGE VIEWER FUNCTIONS ====================

// Setup image viewer
function setupImageViewer() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const downloadBtn = document.getElementById("downloadBtn");

  prevBtn?.addEventListener("click", showPreviousMedia);
  nextBtn?.addEventListener("click", showNextMedia);
  fullscreenBtn?.addEventListener("click", toggleFullscreen);
  downloadBtn?.addEventListener("click", downloadCurrentMedia);

  // Keyboard navigation
  document.addEventListener("keydown", handleKeyboardNavigation);
}

// Open image viewer
function openImageViewer(url, type, startIndex = 0) {
  if (mediaGallery.length === 0) {
    showAlert("Tidak ada media untuk ditampilkan", "info");
    return;
  }

  // Find the index of the clicked media
  const clickedIndex = mediaGallery.findIndex((item) => item.url === url);
  currentMediaIndex = clickedIndex >= 0 ? clickedIndex : startIndex;

  const modal = new bootstrap.Modal(document.getElementById("imageViewerModal"));
  modal.show();

  displayCurrentMedia();
}

// Display current media in viewer
function displayCurrentMedia() {
  if (mediaGallery.length === 0) return;

  const currentMedia = mediaGallery[currentMediaIndex];
  const viewerImage = document.getElementById("viewerImage");
  const viewerVideo = document.getElementById("viewerVideo");
  const viewerLoading = document.getElementById("viewerLoading");
  const mediaTitle = document.getElementById("mediaTitle");
  const mediaCounter = document.getElementById("mediaCounter");

  // Show loading
  viewerLoading.style.display = "block";
  viewerImage.style.display = "none";
  viewerVideo.style.display = "none";

  // Update title and counter
  mediaTitle.textContent = currentMedia.title;
  mediaCounter.textContent = `${currentMediaIndex + 1} / ${mediaGallery.length}`;

  if (currentMedia.type === "photo") {
    viewerImage.onload = () => {
      viewerLoading.style.display = "none";
      viewerImage.style.display = "block";
    };
    viewerImage.onerror = () => {
      viewerLoading.style.display = "none";
      showAlert("Gagal memuat gambar", "danger");
    };
    viewerImage.src = currentMedia.url;
  } else if (currentMedia.type === "video") {
    viewerVideo.onloadeddata = () => {
      viewerLoading.style.display = "none";
      viewerVideo.style.display = "block";
    };
    viewerVideo.onerror = () => {
      viewerLoading.style.display = "none";
      showAlert("Gagal memuat video", "danger");
    };
    viewerVideo.src = currentMedia.url;
  }

  // Update navigation buttons
  updateNavigationButtons();
}

// Update navigation buttons
function updateNavigationButtons() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  if (mediaGallery.length <= 1) {
    prevBtn.style.display = "none";
    nextBtn.style.display = "none";
  } else {
    prevBtn.style.display = "block";
    nextBtn.style.display = "block";

    prevBtn.disabled = currentMediaIndex === 0;
    nextBtn.disabled = currentMediaIndex === mediaGallery.length - 1;
  }
}

// Show previous media
function showPreviousMedia() {
  if (currentMediaIndex > 0) {
    currentMediaIndex--;
    displayCurrentMedia();
  }
}

// Show next media
function showNextMedia() {
  if (currentMediaIndex < mediaGallery.length - 1) {
    currentMediaIndex++;
    displayCurrentMedia();
  }
}

// Handle keyboard navigation
function handleKeyboardNavigation(e) {
  const modal = document.getElementById("imageViewerModal");
  if (!modal.classList.contains("show")) return;

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      showPreviousMedia();
      break;
    case "ArrowRight":
      e.preventDefault();
      showNextMedia();
      break;
    case "Escape":
      e.preventDefault();
      bootstrap.Modal.getInstance(modal)?.hide();
      break;
  }
}

// Download current media
function downloadCurrentMedia() {
  if (mediaGallery.length === 0) return;

  const currentMedia = mediaGallery[currentMediaIndex];
  const link = document.createElement("a");
  link.href = currentMedia.url;
  link.download = `${currentMedia.title}_K${currentCondition}`;
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Make functions available globally
window.showConditionVisual = showConditionVisual;
window.printModal = printModal;
