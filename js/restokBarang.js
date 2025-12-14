import app, { firestore } from "./configFirebase.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// DOM refs
const form = document.getElementById("barangForm");
const tanggalInput = document.getElementById("tanggal");
const btnAddRow = document.getElementById("btnAddRow");
const btnSave = document.getElementById("btnSave");
const inputTbody = document.querySelector("#inputTable tbody");

const filterBulan = document.getElementById("filterBulan");
const filterBulanSudah = document.getElementById("filterBulanSudah");
const dataTablePerlu = document.querySelector("#dataTablePerlu tbody");
const dataTableSudah = document.querySelector("#dataTableSudah tbody");
const btnSendWA = document.getElementById("btnSendWA");

// Modal refs
const editStatusModal = document.getElementById("editStatusModal");
const statusSelect = document.getElementById("statusSelect");
const saveStatusBtn = document.getElementById("saveStatusBtn");
const inputBarangModal = document.getElementById("inputBarangModal");
const btnTambahBarang = document.getElementById("btnTambahBarang");

// WhatsApp Setting Modal refs
const settingWAModal = document.getElementById("settingWAModal");
const btnSettingWA = document.getElementById("btnSettingWA");
const supplierPhoneInput = document.getElementById("supplierPhoneInput");
const savePhoneBtn = document.getElementById("savePhoneBtn");
const phoneError = document.getElementById("phoneError");

// Chart refs
const chartBulan = document.getElementById("chartBulan");
const btnUpdateChart = document.getElementById("btnUpdateChart");
const chartSummary = document.getElementById("chartSummary");

const collRef = collection(firestore, "restokBarang");
let SUPPLIER_PHONE = null;
let currentEditId = null;
let jenisChart = null;

async function loadSupplierPhone() {
  try {
    const candidates = [
      { col: "settings", docId: "whatsapp", fields: ["supplierPhone", "phone", "suplierphone"] },
      { col: "setting", docId: "whatsapp", fields: ["suplierphone", "supplierPhone", "phone"] },
    ];

    for (const c of candidates) {
      try {
        const ref = doc(firestore, c.col, c.docId);
        const snap = await getDoc(ref);
        if (!snap.exists()) continue;
        const data = snap.data() || {};
        let raw = "";
        for (const f of c.fields) {
          if (data[f]) {
            raw = data[f];
            break;
          }
        }
        if (raw) {
          const cleaned = String(raw).replace(/[^+\d]/g, "");
          SUPPLIER_PHONE = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
          return true;
        }
      } catch (_) {
        /* continue to next candidate */
      }
    }
    console.warn("Supplier phone settings not found. Checked: settings/whatsapp and setting/whatsapp");
    return false;
  } catch (err) {
    console.error("Failed to load supplier phone:", err);
    return false;
  }
}

// WhatsApp Setting Functions
function openWhatsAppSettingModal() {
  if (supplierPhoneInput) {
    // Display current phone number
    const displayPhone = SUPPLIER_PHONE
      ? SUPPLIER_PHONE.startsWith("62")
        ? `0${SUPPLIER_PHONE.slice(2)}`
        : SUPPLIER_PHONE
      : "";
    supplierPhoneInput.value = displayPhone;
    supplierPhoneInput.classList.remove("is-invalid");
  }
  new bootstrap.Modal(settingWAModal).show();
}

function validatePhoneNumber(phone) {
  // Remove all non-digit characters except +
  const cleaned = phone.replace(/[^+\d]/g, "");

  // Check if empty
  if (!cleaned) {
    return { valid: false, message: "Nomor telepon tidak boleh kosong" };
  }

  // Check valid formats: 08xxx (min 10 digits) or +628xxx (min 12 digits)
  if (cleaned.startsWith("08") && cleaned.length >= 10) {
    return { valid: true, formatted: "62" + cleaned.slice(1) };
  } else if (cleaned.startsWith("+628") && cleaned.length >= 13) {
    return { valid: true, formatted: cleaned.slice(1) };
  } else if (cleaned.startsWith("628") && cleaned.length >= 12) {
    return { valid: true, formatted: cleaned };
  } else {
    return { valid: false, message: "Format nomor tidak valid. Gunakan 08xxx atau +628xxx" };
  }
}

async function saveSupplierPhone() {
  const phone = supplierPhoneInput.value.trim();
  const validation = validatePhoneNumber(phone);

  if (!validation.valid) {
    supplierPhoneInput.classList.add("is-invalid");
    phoneError.textContent = validation.message;
    return;
  }

  supplierPhoneInput.classList.remove("is-invalid");
  savePhoneBtn.disabled = true;

  try {
    // Save to settings/whatsapp with field supplierPhone
    const ref = doc(firestore, "settings", "whatsapp");
    await updateDoc(ref, {
      supplierPhone: validation.formatted,
      updatedAt: Date.now(),
    }).catch(async (err) => {
      // If document doesn't exist, create it
      if (err.code === "not-found") {
        await setDoc(ref, {
          supplierPhone: validation.formatted,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      } else {
        throw err;
      }
    });

    // Update global variable
    SUPPLIER_PHONE = validation.formatted;

    bootstrap.Modal.getInstance(settingWAModal).hide();
    toastSuccess("Nomor WhatsApp supplier berhasil disimpan");
  } catch (err) {
    console.error("Gagal menyimpan nomor:", err);
    alert("Gagal menyimpan nomor WhatsApp");
  } finally {
    savePhoneBtn.disabled = false;
  }
}

function toastSuccess(title = "Berhasil") {
  if (window.Swal) {
    const Toast = Swal.mixin({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 1500,
      timerProgressBar: true,
    });
    Toast.fire({ icon: "success", title });
  } else {
    alert(title);
  }
}

async function confirmDelete(text = "Hapus data ini?") {
  if (window.Swal) {
    const res = await Swal.fire({
      icon: "warning",
      title: "Yakin?",
      text,
      showCancelButton: true,
      confirmButtonText: "Ya, hapus",
      cancelButtonText: "Batal",
    });
    return res.isConfirmed;
  }
  return confirm(text);
}

// Helpers
function pad(n) {
  return n.toString().padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function getMonthRange(monthStr) {
  // monthStr format: "2025-10"
  const [year, month] = monthStr.split("-");
  const startDate = `${year}-${month}-01`;

  // Get last day of month
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const endDate = `${year}-${month}-${pad(lastDay)}`;

  return { startDate, endDate };
}

function setDefaultDates() {
  const t = todayStr();
  const m = currentMonthStr();
  if (tanggalInput) tanggalInput.value = t;
  if (filterBulan) filterBulan.value = m;
  if (filterBulanSudah) filterBulanSudah.value = m;
}

// Input rows
function makeRow() {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <select class="form-select form-select-sm" required>
        <option value="">Pilih Jenis</option>
        <option value="KALUNG">KALUNG</option>
        <option value="LIONTIN">LIONTIN</option>
        <option value="ANTING">ANTING</option>
        <option value="CINCIN">CINCIN</option>
        <option value="GELANG">GELANG</option>
        <option value="GIWANG">GIWANG</option>
      </select>
    </td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Nama barang" required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Kadar" required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Berat (gr)"></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Panjang (cm)"></td>
    <td class="actions-cell"><button type="button" class="btn btn-danger btn-sm btn-remove">Hapus</button></td>
  `;
  tr.querySelector(".btn-remove").addEventListener("click", () => {
    tr.remove();
    toggleSaveState();
  });
  inputTbody.appendChild(tr);
  toggleSaveState();
}

function getInputRowsData() {
  const rows = Array.from(inputTbody.querySelectorAll("tr"));
  return rows.map((tr) => {
    const select = tr.querySelector("select");
    const inputs = tr.querySelectorAll("input");
    const jenis = select.value.trim();
    const [nama, kadar, berat, panjang] = Array.from(inputs).map((i) => i.value.trim());
    // berat dan panjang disimpan sebagai string (opsional, bisa range "2 - 3", dlsb)
    return { jenis, nama, kadar, berat, panjang };
  });
}

function validateInputForm() {
  let ok = true;
  if (!tanggalInput.value) {
    tanggalInput.classList.add("is-invalid");
    ok = false;
  } else {
    tanggalInput.classList.remove("is-invalid");
  }
  const trs = Array.from(inputTbody.querySelectorAll("tr"));
  if (trs.length === 0) ok = false;
  trs.forEach((tr) => {
    const select = tr.querySelector("select");
    const inputs = tr.querySelectorAll("input");

    // Validasi dropdown jenis (wajib)
    const jenisValid = select.value.trim() !== "";
    select.classList.toggle("is-invalid", !jenisValid);
    if (!jenisValid) ok = false;

    inputs.forEach((inp, idx) => {
      const val = inp.value.trim();
      // Wajib untuk kolom 0: nama, 1: kadar
      let valid = idx < 2 ? val !== "" : true;
      inp.classList.toggle("is-invalid", !valid);
      if (!valid) ok = false;
    });
  });
  return ok;
}

function toggleSaveState() {
  if (btnSave) btnSave.disabled = inputTbody.children.length === 0;
}

// Save batch to Firestore
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateInputForm()) return;
    btnSave.disabled = true;
    const tanggal = tanggalInput.value;
    const rows = getInputRowsData();
    try {
      for (const item of rows) {
        await addDoc(collRef, {
          tanggal,
          jenis: item.jenis,
          nama: item.nama,
          kadar: item.kadar,
          // berat & panjang disimpan apa adanya (string), bisa kosong atau range
          berat: item.berat,
          panjang: item.panjang,
          status: "perlu", // default status
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      // Close modal
      const modalInstance = bootstrap.Modal.getInstance(inputBarangModal);
      if (modalInstance) modalInstance.hide();
      // reset
      inputTbody.innerHTML = "";
      makeRow();
      toastSuccess("Data berhasil disimpan");
      // refresh listing for selected filter month if includes tanggal
      const inputMonth = tanggal.substring(0, 7); // Get YYYY-MM from YYYY-MM-DD
      if (filterBulan && filterBulan.value === inputMonth) {
        await fetchAndRenderPerlu();
      }
      // Update chart
      updateChart();
    } catch (err) {
      console.error("Gagal menyimpan:", err);
      alert("Gagal menyimpan data");
    } finally {
      btnSave.disabled = false;
    }
  });
}

if (btnAddRow) {
  btnAddRow.addEventListener("click", () => makeRow());
}

// Listing
async function fetchByMonthAndStatus(monthStr, status) {
  try {
    const { startDate, endDate } = getMonthRange(monthStr);
    const q = query(
      collRef,
      where("tanggal", ">=", startDate),
      where("tanggal", "<=", endDate),
      where("status", "==", status)
    );
    const snap = await getDocs(q);
    const items = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      items.push({ id: docSnap.id, ...data });
    });
    items.sort((a, b) => {
      // Sort by jenis first (alphabetical)
      const jenisA = (a.jenis || "").toUpperCase();
      const jenisB = (b.jenis || "").toUpperCase();
      if (jenisA !== jenisB) {
        return jenisA.localeCompare(jenisB);
      }

      // Then by date within same jenis
      const dateA = a.tanggal || "";
      const dateB = b.tanggal || "";
      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }

      // Finally by createdAt
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    return items;
  } catch (err) {
    console.error("Gagal mengambil data:", err);
    return [];
  }
}

function renderRowsPerlu(items, tbody) {
  tbody.innerHTML = items
    .map(
      (x) => `
    <tr data-id="${x.id}">
      <td>${x.tanggal || ""}</td>
      <td>${x.jenis || ""}</td>
      <td>${x.nama || ""}</td>
      <td>${x.kadar || ""}</td>
      <td>${x.berat ?? ""}</td>
      <td>${x.panjang ?? ""}</td>
      <td class="status-cell">
        <button type="button" class="btn btn-warning btn-sm btn-edit-status" data-status="perlu" title="Edit Status">
          <i class="fa-solid fa-edit me-1"></i>Edit Status
        </button>
      </td>
      <td class="actions-cell">
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-outline-primary btn-edit" title="Edit Data">
            <i class="fa-solid fa-edit"></i>
          </button>
          <button type="button" class="btn btn-danger btn-delete" title="Hapus">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  // Bind actions
  tbody.querySelectorAll(".btn-edit-status").forEach((btn) => {
    btn.addEventListener("click", () => openEditStatusModal(btn.closest("tr")));
  });
  tbody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => enterEditMode(btn.closest("tr"), "perlu"));
  });
  tbody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteRow(btn.closest("tr")));
  });
}

function renderRowsSudah(items, tbody) {
  tbody.innerHTML = items
    .map(
      (x) => `
    <tr data-id="${x.id}">
      <td>${x.tanggal || ""}</td>
      <td>${x.jenis || ""}</td>
      <td>${x.nama || ""}</td>
      <td>${x.kadar || ""}</td>
      <td>${x.berat ?? ""}</td>
      <td>${x.panjang ?? ""}</td>
      <td class="text-center">${x.tanggalRestok || "-"}</td>
      <td class="actions-cell">
        <button type="button" class="btn btn-danger btn-sm btn-delete" title="Hapus">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `
    )
    .join("");

  // Bind actions
  tbody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteRow(btn.closest("tr")));
  });
}

async function fetchAndRenderPerlu() {
  const monthStr = filterBulan?.value || currentMonthStr();
  const items = await fetchByMonthAndStatus(monthStr, "perlu");
  renderRowsPerlu(items, dataTablePerlu);
}

async function fetchAndRenderSudah() {
  const monthStr = filterBulanSudah?.value || currentMonthStr();
  const items = await fetchByMonthAndStatus(monthStr, "sudah");
  renderRowsSudah(items, dataTableSudah);
}

// Modal functions
function openEditStatusModal(tr) {
  if (!tr) return;
  currentEditId = tr.dataset.id;
  const currentStatus = tr.querySelector(".btn-edit-status").dataset.status;
  statusSelect.value = currentStatus;
  new bootstrap.Modal(editStatusModal).show();
}

async function saveStatus() {
  if (!currentEditId) return;
  const newStatus = statusSelect.value;
  try {
    const updateData = {
      status: newStatus,
      updatedAt: Date.now(),
    };

    // Simpan tanggal restok saat status diubah ke "sudah"
    if (newStatus === "sudah") {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      updateData.tanggalRestok = `${yyyy}-${mm}-${dd}`;
    }

    await updateDoc(doc(firestore, "restokBarang", currentEditId), updateData);
    // Refresh both tabs
    await fetchAndRenderPerlu();
    await fetchAndRenderSudah();
    bootstrap.Modal.getInstance(editStatusModal).hide();
    toastSuccess("Status berhasil diubah");
    // Update chart
    updateChart();
  } catch (err) {
    console.error("Gagal mengubah status:", err);
    alert("Gagal mengubah status");
  }
}

async function fetchAndRender() {
  // Refresh untuk tab yang active saja untuk performa
  await fetchAndRenderPerlu();
}

function enterEditMode(tr, currentStatus) {
  if (!tr) return;
  const id = tr.dataset.id;
  const tds = tr.children;
  const tanggal = tds[0].textContent.trim();
  const jenis = tds[1].textContent.trim();
  const nama = tds[2].textContent.trim();
  const kadar = tds[3].textContent.trim();
  const berat = tds[4].textContent.trim();
  const panjang = tds[5].textContent.trim();

  const statusColumn =
    currentStatus === "perlu"
      ? `<td class="status-cell">
        <span class="badge bg-warning text-dark mb-1">Perlu Restok</span>
        <br>
        <small class="text-muted">Status tidak bisa diubah saat edit</small>
      </td>`
      : `<td class="text-center">${tds[6].textContent.trim()}</td>`;

  tr.innerHTML = `
    <td>${tanggal}</td>
    <td>
      <select class="form-select form-select-sm">
        <option value="">Pilih Jenis...</option>
        <option value="KALUNG" ${jenis === "KALUNG" ? "selected" : ""}>Kalung</option>
        <option value="LIONTIN" ${jenis === "LIONTIN" ? "selected" : ""}>Liontin</option>
        <option value="ANTING" ${jenis === "ANTING" ? "selected" : ""}>Anting</option>
        <option value="CINCIN" ${jenis === "CINCIN" ? "selected" : ""}>Cincin</option>
        <option value="GELANG" ${jenis === "GELANG" ? "selected" : ""}>Gelang</option>
        <option value="GIWANG" ${jenis === "GIWANG" ? "selected" : ""}>Giwang</option>
      </select>
    </td>
    <td><input type="text" class="form-control form-control-sm" value="${nama}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${kadar}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${berat}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${panjang}"></td>
    ${statusColumn}
    <td class="actions-cell">
      <div class="btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-success btn-save">Simpan</button>
        <button type="button" class="btn btn-secondary btn-cancel">Batal</button>
      </div>
    </td>
  `;
  tr.dataset.id = id;

  tr.querySelector(".btn-save").addEventListener("click", async () => {
    const select = tr.querySelector("select");
    const [namaI, kadarI, beratI, panjangI] = Array.from(tr.querySelectorAll("input"));
    const newJenis = select.value.trim();
    const newNama = namaI.value.trim();
    const newKadar = kadarI.value.trim();
    const newBerat = beratI.value.trim();
    const newPanjang = panjangI.value.trim();
    if (!newJenis || !newNama || !newKadar) {
      alert("Jenis, nama dan kadar wajib diisi");
      return;
    }
    try {
      await updateDoc(doc(firestore, "restokBarang", id), {
        jenis: newJenis,
        nama: newNama,
        kadar: newKadar,
        // berat & panjang disimpan sebagai string (opsional)
        berat: newBerat,
        panjang: newPanjang,
        updatedAt: Date.now(),
      });
      await fetchAndRenderPerlu();
      await fetchAndRenderSudah();
      toastSuccess("Perubahan disimpan");
      // Update chart
      updateChart();
    } catch (err) {
      console.error("Gagal mengubah data:", err);
      alert("Gagal mengubah data");
    }
  });

  tr.querySelector(".btn-cancel").addEventListener("click", async () => {
    await fetchAndRenderPerlu();
    await fetchAndRenderSudah();
  });
}

async function deleteRow(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  if (!id) return;
  const ok = await confirmDelete("Hapus data ini?");
  if (!ok) return;
  try {
    await deleteDoc(doc(firestore, "restokBarang", id));
    tr.remove();
    toastSuccess("Data dihapus");
    // Update chart
    updateChart();
  } catch (err) {
    console.error("Gagal menghapus data:", err);
    alert("Gagal menghapus data");
  }
}

// WhatsApp send untuk data perlu restok saja dengan PDF
if (btnSendWA) {
  btnSendWA.addEventListener("click", async () => {
    const rows = Array.from(dataTablePerlu.querySelectorAll("tr"));
    if (rows.length === 0) {
      alert("Tidak ada data perlu restok untuk dikirim");
      return;
    }
    if (!SUPPLIER_PHONE) {
      alert("Nomor WhatsApp pemasok belum tersedia");
      return;
    }

    try {
      btnSendWA.disabled = true;
      btnSendWA.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i>Membuat PDF...';

      await generateAndSendPDF(rows);
    } catch (err) {
      console.error("Gagal membuat PDF:", err);
      alert("Gagal membuat PDF");
    } finally {
      btnSendWA.disabled = false;
      btnSendWA.innerHTML = '<i class="fa-brands fa-whatsapp me-2"></i>Kirim Data Perlu Restok';
    }
  });
}

async function generateAndSendPDF(rows) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Load logo as base64
  const logoImg = new Image();
  logoImg.src = "img/logo.png";

  await new Promise((resolve, reject) => {
    logoImg.onload = resolve;
    logoImg.onerror = () => {
      console.warn("Logo tidak ditemukan, lanjut tanpa logo");
      resolve();
    };
    setTimeout(resolve, 2000); // Fallback timeout
  });

  // Header with logo
  const pageWidth = doc.internal.pageSize.getWidth();

  // Add logo if loaded
  if (logoImg.complete && logoImg.naturalHeight !== 0) {
    try {
      doc.addImage(logoImg, "PNG", pageWidth / 2 - 15, 10, 30, 30);
    } catch (e) {
      console.warn("Gagal menambahkan logo");
    }
  }

  // Title
  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text("MELATI GOLD SHOP", pageWidth / 2, 45, { align: "center" });

  doc.setFontSize(14);
  doc.text("Daftar Barang Perlu Restok", pageWidth / 2, 55, { align: "center" });

  // Date
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  const today = new Date();
  const dateStr = `${pad(today.getDate())}-${pad(today.getMonth() + 1)}-${today.getFullYear()}`;
  doc.text(`Tanggal: ${dateStr}`, 14, 65);

  // Prepare table data
  const tableData = [];
  rows.forEach((tr, idx) => {
    const [tgl, jenis, nama, kadar, berat, panjang] = Array.from(tr.children)
      .slice(0, 6)
      .map((td) => td.textContent.trim());
    tableData.push([idx + 1, tgl, jenis, nama, kadar, berat, panjang]);
  });

  // Table
  doc.autoTable({
    startY: 72,
    head: [["No", "Tanggal", "Jenis", "Nama Barang", "Kadar", "Berat", "Panjang"]],
    body: tableData,
    theme: "grid",
    headStyles: {
      fillColor: [212, 175, 55], // Gold color
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 50 },
      4: { cellWidth: 20, halign: "center" },
      5: { cellWidth: 20, halign: "center" },
      6: { cellWidth: 20, halign: "center" },
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
  });

  // Footer - Total items
  const finalY = doc.lastAutoTable.finalY || 72;
  doc.setFontSize(11);
  doc.setFont(undefined, "bold");
  doc.text(`Total: ${rows.length} items`, 14, finalY + 10);

  // Generate blob for WhatsApp
  const pdfBlob = doc.output("blob");
  const pdfFile = new File([pdfBlob], `Restok_${dateStr}.pdf`, { type: "application/pdf" });

  // Check if Web Share API with files is supported
  if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
    try {
      await navigator.share({
        files: [pdfFile],
        title: "Daftar Barang Perlu Restok",
        text: `Data Perlu Restok - ${dateStr}`,
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Share error:", err);
        fallbackPDFDownload(doc, dateStr);
      }
    }
  } else {
    // Fallback: Download PDF + open WhatsApp
    fallbackPDFDownload(doc, dateStr);
  }
}

function fallbackPDFDownload(doc, dateStr) {
  // Download PDF
  doc.save(`Restok_${dateStr}.pdf`);

  // Open WhatsApp with text message
  const message = encodeURIComponent(
    `Halo, terlampir daftar barang perlu restok tanggal ${dateStr}.\n\nSilakan cek file PDF yang saya kirim.`
  );
  const url = `https://wa.me/${SUPPLIER_PHONE}?text=${message}`;

  // Show instruction
  if (window.Swal) {
    Swal.fire({
      icon: "info",
      title: "PDF Berhasil Diunduh",
      html: "Silakan attach file PDF yang sudah didownload ke WhatsApp yang akan terbuka.",
      confirmButtonText: "Buka WhatsApp",
      timer: 5000,
    }).then(() => {
      window.open(url, "_blank");
    });
  } else {
    alert("PDF berhasil diunduh. Silakan attach ke WhatsApp.");
    window.open(url, "_blank");
  }
}

// Chart Functions
async function updateChart() {
  const monthStr = chartBulan?.value || currentMonthStr();

  try {
    const perluItems = await fetchByMonthAndStatus(monthStr, "perlu");

    const jenisCount = {};
    const jenisTypes = ["KALUNG", "LIONTIN", "ANTING", "CINCIN", "GELANG", "GIWANG"];

    jenisTypes.forEach((jenis) => (jenisCount[jenis] = 0));
    perluItems.forEach((item) => {
      const jenis = item.jenis?.toUpperCase();
      if (jenisCount.hasOwnProperty(jenis)) jenisCount[jenis]++;
    });

    const labels = [];
    const data = [];

    // Define base colors for gradients
    const baseColors = [
      { start: "#00ff3cff", end: "#003a0aff" },
      { start: "#ff0000ff", end: "#570000ff" },
      { start: "#ffe202ff", end: "#d1b900ff" },
      { start: "#00ffffff", end: "#008f81ff" },
      { start: "#5300f8ff", end: "#35008aff" },
      { start: "#d400ffff", end: "#680091ff" },
    ];

    jenisTypes.forEach((jenis) => {
      if (jenisCount[jenis] > 0) {
        labels.push(jenis);
        data.push(jenisCount[jenis]);
      }
    });

    // Render Chart
    const ctx = document.getElementById("jenisChart").getContext("2d");
    if (jenisChart) jenisChart.destroy();

    if (data.length > 0) {
      // Create gradients for Chart.js
      const gradients = [];
      for (let i = 0; i < labels.length; i++) {
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, baseColors[i].start);
        gradient.addColorStop(1, baseColors[i].end);
        gradients.push(gradient);
      }

      jenisChart = new Chart(ctx, {
        type: "pie",
        data: {
          labels: labels,
          datasets: [
            {
              data: data,
              backgroundColor: gradients,
            },
          ],
        },
        options: {
          responsive: false,
          plugins: {
            legend: { position: "bottom" },
          },
        },
      });
    }

    // Render Summary
    const total = data.reduce((sum, count) => sum + count, 0);
    let summaryHtml = `<h6>Total: ${total} item</h6><ul class="list-unstyled">`;

    labels.forEach((label, index) => {
      const percentage = total > 0 ? ((data[index] / total) * 100).toFixed(1) : 0;
      const color = baseColors[index] ? baseColors[index].start : "#333";
      summaryHtml += `<li><span style="color:${color}">●</span> ${label}: ${data[index]} (${percentage}%)</li>`;
    });

    summaryHtml += "</ul>";
    chartSummary.innerHTML = summaryHtml;
  } catch (error) {
    console.error("Error updating chart:", error);
  }
}

// Modal Input Barang Functions
function openInputBarangModal() {
  // Reset form to clean state
  inputTbody.innerHTML = "";
  makeRow();
  if (tanggalInput) tanggalInput.value = todayStr();
  new bootstrap.Modal(inputBarangModal).show();
}

// Event listeners
if (btnTambahBarang) {
  btnTambahBarang.addEventListener("click", openInputBarangModal);
}

// WhatsApp Setting Event Listeners
if (btnSettingWA) {
  btnSettingWA.addEventListener("click", openWhatsAppSettingModal);
}

if (savePhoneBtn) {
  savePhoneBtn.addEventListener("click", saveSupplierPhone);
}

// Handle Enter key in phone input
if (supplierPhoneInput) {
  supplierPhoneInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveSupplierPhone();
    }
  });
}

// Auto-refresh when month filter changes
if (filterBulan) {
  filterBulan.addEventListener("change", fetchAndRenderPerlu);
}

if (filterBulanSudah) {
  filterBulanSudah.addEventListener("change", fetchAndRenderSudah);
}

if (saveStatusBtn) {
  saveStatusBtn.addEventListener("click", saveStatus);
}

if (btnUpdateChart) {
  btnUpdateChart.addEventListener("click", updateChart);
}

// Tab switching
document.addEventListener("shown.bs.tab", (e) => {
  if (e.target.getAttribute("href") === "#sudahRestok") {
    fetchAndRenderSudah();
  }
});

// Init
document.addEventListener("DOMContentLoaded", () => {
  // Load supplier phone on start
  loadSupplierPhone();
  setDefaultDates();
  if (inputTbody && inputTbody.children.length === 0) {
    makeRow();
  }
  fetchAndRenderPerlu(); // Load default tab

  // Initialize chart
  if (chartBulan) {
    chartBulan.value = currentMonthStr();
    updateChart();
  }
});
