// Initialize page
document.addEventListener("DOMContentLoaded", () => {
  // Initialize buyback form
  setupBuybackForm();
});
// Tambahkan event listener untuk tombol print
const printButton = document.getElementById("printModalButton");
if (printButton) {
  printButton.addEventListener("click", printModal);
}

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
    <td>
      <select name="asalToko" class="form-select form-select-sm" required>
        <option value="" disabled selected>Pilih</option>
        <option value="Toko Melati">Toko Melati</option>
        <option value="Luar Toko">Luar Toko</option>
      </select>
    </td>
    <td><input type="text" name="namaBarang" class="form-control form-control-sm" placeholder="Nama Barang" required></td>
    <td>
      <select name="kondisiBarang" class="form-select form-select-sm" required>
        <option value="" disabled selected>Pilih</option>
        <option value="1">K1</option>
        <option value="2">K2</option>
        <option value="3">K3</option>
      </select>
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
    const asalToko = row.querySelector("[name='asalToko']").value;
    const namaBarang = row.querySelector("[name='namaBarang']")?.value || "";
    const kondisiBarang = row.querySelector("[name='kondisiBarang']").value;
    const hargaBeli = parseFloat(row.querySelector("[name='hargaBeli']").value);
    const hargaHariIni = parseFloat(row.querySelector("[name='hargaHariIni']").value);

    if (!kadar || !asalToko || !kondisiBarang || isNaN(hargaBeli) || isNaN(hargaHariIni)) {
      isValid = false;
      return;
    }

    items.push({
      kadar,
      asalToko,
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

    // Bandingkan harga per gram saat beli dengan harga per gram saat ini
    const hargaPerGramBeli = item.hargaBeli; // Asumsikan ini sudah dalam format per gram
    const hargaPerGramHariIni = item.hargaHariIni; // Asumsikan ini sudah dalam format per gram

    if (hargaPerGramBeli <= hargaPerGramHariIni) {
      // Kasus 1: Harga beli lebih rendah dari harga hari ini
      // Gunakan logika perhitungan yang sudah ada berdasarkan kondisi dan asal toko
      if (item.asalToko === "Toko Melati") {
        // For items from Melati store, use the calculateMelatiPersentase function
        const persentaseBeli = (item.hargaBeli / item.hargaHariIni) * 100;
        buybackPercentage = calculateMelatiPersentase(item.kondisiBarang, persentaseBeli);
      } else {
        // For items from other stores, use the calculateLuarTokoPersentase function
        buybackPercentage = calculateLuarTokoPersentase(item.kondisiBarang);
      }

      // Calculate buyback price based on current price and percentage
      buybackPrice = (item.hargaHariIni * buybackPercentage) / 100;

      // Terapkan aturan pembulatan
      buybackPrice = roundBuybackPrice(buybackPrice);

      // Jika harga penerimaan setelah dihitung lebih rendah dari harga beli,
      // maka gunakan harga beli
      if (buybackPrice < item.hargaBeli) {
        buybackPrice = item.hargaBeli;
      }
    } else {
      // Kasus 2: Harga beli lebih tinggi dari harga hari ini
      // Gunakan harga hari ini tanpa pembulatan
      buybackPrice = item.hargaHariIni;
    }

    // Calculate price difference
    const priceDifference = buybackPrice - item.hargaBeli;
    const percentageDifference = ((priceDifference / item.hargaBeli) * 100).toFixed(2);

    results.push({
      ...item,
      buybackPercentage: parseFloat(buybackPercentage.toFixed(2)), // Format to 2 decimal places
      buybackPrice,
      priceDifference,
      percentageDifference,
      isHigherPurchasePrice: hargaPerGramBeli > hargaPerGramHariIni, // Flag untuk UI
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
function calculateMelatiPersentase(kondisiBarang, persentaseBeli) {
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

function calculateLuarTokoPersentase(kondisiBarang) {
  const persentaseMap = {
    1: 72,
    2: 70,
    3: 65,
  };
  return persentaseMap[kondisiBarang] || 60;
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

    const priceStatus = result.priceDifference >= 0 ? "text-success" : "text-danger";
    const priceIcon = result.priceDifference >= 0 ? "fa-arrow-up" : "fa-arrow-down";

    // Tambahkan notifikasi khusus jika harga beli lebih tinggi
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
      <h5 class="fw-bold mb-3">Item #${index + 1}: Perhiasan </h5>
      ${specialNotice}
      <div class="row mb-2">
        <div class="col-md-6">
          <p class="mb-1"><strong>Nama Barang:</strong> ${namaBarang}</p>
          <p class="mb-1"><strong>Kadar:</strong> ${result.kadar}</p>
        </div>
        <div class="col-md-6">
          <p class="mb-1"><strong>Asal Toko:</strong> ${result.asalToko}</p>
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

  // Add timestamp
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

  // Show modal
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
