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
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// DOM refs
const btnTambah = document.getElementById("btnTambah");
const btnTampilkan = document.getElementById("btnTampilkan");
const filterBulan = document.getElementById("filterBulan");
const inputModal = document.getElementById("inputModal");
const inputForm = document.getElementById("inputForm");
const tanggalInput = document.getElementById("tanggal");
const btnAddRow = document.getElementById("btnAddRow");
const btnSave = document.getElementById("btnSave");
const inputTbody = document.querySelector("#inputTable tbody");

// Tab Pending
const searchKodePending = document.getElementById("searchKodePending");
const btnCariKodePending = document.getElementById("btnCariKodePending");
const tablePending = document.querySelector("#tablePending tbody");
const checkAllPending = document.getElementById("checkAllPending");
const btnHapusKodeTerpilih = document.getElementById("btnHapusKodeTerpilih");

// Tab Processed
const searchKodeProcessed = document.getElementById("searchKodeProcessed");
const btnCariKodeProcessed = document.getElementById("btnCariKodeProcessed");
const tableProcessed = document.querySelector("#tableProcessed tbody");
const checkAllProcessed = document.getElementById("checkAllProcessed");
const btnKembalikanTerpilih = document.getElementById("btnKembalikanTerpilih");
const btnHapusTerpilih = document.getElementById("btnHapusTerpilih");
const btnExportExcel = document.getElementById("btnExportExcel");

// Badges
const badgePending = document.getElementById("badgePending");
const badgeProcessed = document.getElementById("badgeProcessed");

// Modals
const konfirmasiHapusKodeModal = document.getElementById("konfirmasiHapusKodeModal");
const editPenerimaModal = document.getElementById("editPenerimaModal");
const infoDetailModal = document.getElementById("infoDetailModal");

const collRef = collection(firestore, "hapusKode");
let currentFilterMonth = null;
let selectedPendingIds = [];
let selectedProcessedIds = [];
let pendingData = [];
let processedData = [];
let currentEditId = null;

// Helpers
function pad(n) {
  return n.toString().padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function getMonthRange(monthStr) {
  const [year, month] = monthStr.split("-");
  const startDate = `${year}-${month}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const endDate = `${year}-${month}-${pad(lastDay)}`;
  return { startDate, endDate };
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

// Modal Functions
function openInputModal() {
  inputTbody.innerHTML = "";
  makeRow();
  if (tanggalInput) tanggalInput.value = todayStr();
  new bootstrap.Modal(inputModal).show();
}

function makeRow() {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="form-control form-control-sm" placeholder="Nama sales..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Kode barcode..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Nama barang..." required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="0.00" required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Contoh: 750" required></td>
    <td><input type="text" class="form-control form-control-sm" placeholder="Keterangan..." required></td>
    <td class="text-center"><button type="button" class="btn btn-danger btn-sm btn-remove"><i class="fas fa-trash"></i></button></td>
  `;
  tr.querySelector(".btn-remove").addEventListener("click", () => {
    tr.remove();
    toggleSaveState();
  });
  inputTbody.appendChild(tr);
  toggleSaveState();

  const firstInput = tr.querySelector("input");
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 100);
  }
}

function toggleSaveState() {
  if (btnSave) btnSave.disabled = inputTbody.children.length === 0;
}

function getInputRowsData() {
  const rows = Array.from(inputTbody.querySelectorAll("tr"));
  return rows.map((tr) => {
    const inputs = tr.querySelectorAll("input");
    const [sales, barcode, namaBarang, berat, kadar, keterangan] = Array.from(inputs).map((i) => i.value.trim());
    return { sales, barcode, namaBarang, berat, kadar, keterangan };
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
    const inputs = tr.querySelectorAll("input");
    inputs.forEach((inp) => {
      const val = inp.value.trim();
      const valid = val !== "";
      inp.classList.toggle("is-invalid", !valid);
      if (!valid) ok = false;
    });
  });
  return ok;
}

// Save Data
if (btnSave) {
  btnSave.addEventListener("click", async () => {
    if (!validateInputForm()) return;
    btnSave.disabled = true;
    const tanggal = tanggalInput.value;
    const jam = currentTime();
    const rows = getInputRowsData();
    try {
      for (const item of rows) {
        await addDoc(collRef, {
          tanggal,
          jam,
          sales: item.sales,
          barcode: item.barcode,
          namaBarang: item.namaBarang,
          berat: item.berat,
          kadar: item.kadar,
          keterangan: item.keterangan,
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      const modalInstance = bootstrap.Modal.getInstance(inputModal);
      if (modalInstance) modalInstance.hide();
      inputTbody.innerHTML = "";
      makeRow();
      toastSuccess("Data berhasil disimpan");
      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth);
      }
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

if (btnTambah) {
  btnTambah.addEventListener("click", openInputModal);
}

// Fetch and Render Data
async function fetchAndRender(monthStr) {
  if (!monthStr) {
    renderPendingTable([]);
    renderProcessedTable([]);
    return;
  }

  try {
    const { startDate, endDate } = getMonthRange(monthStr);

    // Query pending
    const qPending = query(
      collRef,
      where("tanggal", ">=", startDate),
      where("tanggal", "<=", endDate),
      where("status", "==", "pending"),
      orderBy("tanggal", "desc")
    );
    const snapPending = await getDocs(qPending);
    pendingData = [];
    snapPending.forEach((docSnap) => {
      pendingData.push({ id: docSnap.id, ...docSnap.data() });
    });
    pendingData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Query processed
    const qProcessed = query(
      collRef,
      where("tanggal", ">=", startDate),
      where("tanggal", "<=", endDate),
      where("status", "==", "processed"),
      orderBy("tanggal", "desc")
    );
    const snapProcessed = await getDocs(qProcessed);
    processedData = [];
    snapProcessed.forEach((docSnap) => {
      processedData.push({ id: docSnap.id, ...docSnap.data() });
    });
    processedData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Filter by search
    const filterPending = searchKodePending?.value?.trim().toLowerCase() || "";
    const filterProcessed = searchKodeProcessed?.value?.trim().toLowerCase() || "";

    const filteredPending = filterPending
      ? pendingData.filter((x) => (x.barcode || "").toLowerCase().includes(filterPending))
      : pendingData;

    const filteredProcessed = filterProcessed
      ? processedData.filter((x) => (x.barcode || "").toLowerCase().includes(filterProcessed))
      : processedData;

    renderPendingTable(filteredPending);
    renderProcessedTable(filteredProcessed);

    // Update badges
    if (badgePending) badgePending.textContent = pendingData.length;
    if (badgeProcessed) badgeProcessed.textContent = processedData.length;

    // Clear selections
    selectedPendingIds = [];
    selectedProcessedIds = [];
    updateBulkButtons();
  } catch (err) {
    console.error("Gagal mengambil data:", err);
    alert("Gagal mengambil data");
  }
}

function renderPendingTable(items) {
  if (!currentFilterMonth) {
    tablePending.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-muted py-5">
          <i class="fas fa-calendar-alt fa-2x mb-3 opacity-50"></i>
          <div class="h6">Pilih bulan dan klik "Tampilkan" untuk melihat data</div>
        </td>
      </tr>
    `;
    return;
  }

  if (items.length === 0) {
    tablePending.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-muted py-4">
          <i class="fas fa-inbox fa-2x mb-2"></i>
          <div>Data tidak ditemukan</div>
        </td>
      </tr>
    `;
    return;
  }

  tablePending.innerHTML = items
    .map(
      (x, idx) => `
    <tr data-id="${x.id}">
      <td><input type="checkbox" class="form-check-input checkbox-pending" data-id="${x.id}"></td>
      <td>${idx + 1}</td>
      <td>${x.tanggal || ""}</td>
      <td>${x.jam || ""}</td>
      <td>${x.sales || ""}</td>
      <td>${x.barcode || ""}</td>
      <td>${x.namaBarang || ""}</td>
      <td>${x.berat || ""}</td>
      <td>${x.kadar || ""}</td>
      <td>${x.keterangan || ""}</td>
      <td>
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-outline-primary btn-edit-pending" title="Edit">
            <i class="fas fa-edit"></i>
          </button>
          <button type="button" class="btn btn-danger btn-delete-pending" title="Hapus">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  tablePending.querySelectorAll(".checkbox-pending").forEach((cb) => {
    cb.addEventListener("change", handlePendingCheckboxChange);
  });

  tablePending.querySelectorAll(".btn-edit-pending").forEach((btn) => {
    btn.addEventListener("click", () => enterEditModePending(btn.closest("tr")));
  });

  tablePending.querySelectorAll(".btn-delete-pending").forEach((btn) => {
    btn.addEventListener("click", () => deleteRowPending(btn.closest("tr")));
  });
}

function renderProcessedTable(items) {
  if (!currentFilterMonth) {
    tableProcessed.innerHTML = `
      <tr>
        <td colspan="12" class="text-center text-muted py-5">
          <i class="fas fa-calendar-alt fa-2x mb-3 opacity-50"></i>
          <div class="h6">Pilih bulan dan klik "Tampilkan" untuk melihat data</div>
        </td>
      </tr>
    `;
    return;
  }

  if (items.length === 0) {
    tableProcessed.innerHTML = `
      <tr>
        <td colspan="12" class="text-center text-muted py-4">
          <i class="fas fa-inbox fa-2x mb-2"></i>
          <div>Data tidak ditemukan</div>
        </td>
      </tr>
    `;
    return;
  }

  tableProcessed.innerHTML = items
    .map(
      (x, idx) => `
    <tr data-id="${x.id}">
      <td><input type="checkbox" class="form-check-input checkbox-processed" data-id="${x.id}"></td>
      <td>${idx + 1}</td>
      <td>${x.tanggal || ""}</td>
      <td>${x.jam || ""}</td>
      <td>${x.sales || ""}</td>
      <td>${x.barcode || ""}</td>
      <td>${x.namaBarang || ""}</td>
      <td>${x.berat || ""}</td>
      <td>${x.kadar || ""}</td>
      <td>${x.keterangan || ""}</td>
      <td>${x.penerima || '<span class="text-muted">-</span>'}</td>
      <td>
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-outline-primary btn-edit-penerima" title="Edit Penerima">
            <i class="fas fa-edit"></i>
          </button>
          <button type="button" class="btn btn-outline-info btn-info-detail" title="Info Detail">
            <i class="fas fa-info-circle"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");

  tableProcessed.querySelectorAll(".checkbox-processed").forEach((cb) => {
    cb.addEventListener("change", handleProcessedCheckboxChange);
  });

  tableProcessed.querySelectorAll(".btn-edit-penerima").forEach((btn) => {
    btn.addEventListener("click", () => openEditPenerimaModal(btn.closest("tr")));
  });

  tableProcessed.querySelectorAll(".btn-info-detail").forEach((btn) => {
    btn.addEventListener("click", () => openInfoDetailModal(btn.closest("tr")));
  });
}

// Checkbox Management
function handlePendingCheckboxChange(e) {
  const id = e.target.dataset.id;
  if (e.target.checked) {
    if (!selectedPendingIds.includes(id)) selectedPendingIds.push(id);
  } else {
    selectedPendingIds = selectedPendingIds.filter((x) => x !== id);
  }
  updateBulkButtons();
  updateCheckAllPending();
}

function handleProcessedCheckboxChange(e) {
  const id = e.target.dataset.id;
  if (e.target.checked) {
    if (!selectedProcessedIds.includes(id)) selectedProcessedIds.push(id);
  } else {
    selectedProcessedIds = selectedProcessedIds.filter((x) => x !== id);
  }
  updateBulkButtons();
  updateCheckAllProcessed();
}

function updateBulkButtons() {
  if (btnHapusKodeTerpilih) btnHapusKodeTerpilih.disabled = selectedPendingIds.length === 0;
  if (btnKembalikanTerpilih) btnKembalikanTerpilih.disabled = selectedProcessedIds.length === 0;
  if (btnHapusTerpilih) btnHapusTerpilih.disabled = selectedProcessedIds.length === 0;
}

function updateCheckAllPending() {
  if (!checkAllPending) return;
  const allCheckboxes = tablePending.querySelectorAll(".checkbox-pending");
  const checkedCount = Array.from(allCheckboxes).filter((cb) => cb.checked).length;
  checkAllPending.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
  checkAllPending.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
}

function updateCheckAllProcessed() {
  if (!checkAllProcessed) return;
  const allCheckboxes = tableProcessed.querySelectorAll(".checkbox-processed");
  const checkedCount = Array.from(allCheckboxes).filter((cb) => cb.checked).length;
  checkAllProcessed.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
  checkAllProcessed.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
}

if (checkAllPending) {
  checkAllPending.addEventListener("change", (e) => {
    const checkboxes = tablePending.querySelectorAll(".checkbox-pending");
    checkboxes.forEach((cb) => {
      cb.checked = e.target.checked;
      const id = cb.dataset.id;
      if (e.target.checked) {
        if (!selectedPendingIds.includes(id)) selectedPendingIds.push(id);
      } else {
        selectedPendingIds = selectedPendingIds.filter((x) => x !== id);
      }
    });
    updateBulkButtons();
  });
}

if (checkAllProcessed) {
  checkAllProcessed.addEventListener("change", (e) => {
    const checkboxes = tableProcessed.querySelectorAll(".checkbox-processed");
    checkboxes.forEach((cb) => {
      cb.checked = e.target.checked;
      const id = cb.dataset.id;
      if (e.target.checked) {
        if (!selectedProcessedIds.includes(id)) selectedProcessedIds.push(id);
      } else {
        selectedProcessedIds = selectedProcessedIds.filter((x) => x !== id);
      }
    });
    updateBulkButtons();
  });
}

// Bulk Actions - Hapus Kode Terpilih
if (btnHapusKodeTerpilih) {
  btnHapusKodeTerpilih.addEventListener("click", () => {
    if (selectedPendingIds.length === 0) return;

    const selectedItems = pendingData.filter((x) => selectedPendingIds.includes(x.id));
    const barcodes = selectedItems.map((x) => x.barcode).join("\n");

    document.getElementById("tglHapusKode").value = todayStr();
    document.getElementById("jamHapusKode").value = currentTime();
    document.getElementById("salesMutasi").value = "";
    document.getElementById("salesMutasi").classList.remove("is-invalid");
    document.getElementById("kodeYangDihapus").value = barcodes;

    new bootstrap.Modal(konfirmasiHapusKodeModal).show();
  });
}

// Konfirmasi Hapus Kode
if (document.getElementById("btnKonfirmasiHapusKode")) {
  document.getElementById("btnKonfirmasiHapusKode").addEventListener("click", async () => {
    const salesMutasi = document.getElementById("salesMutasi").value.trim();
    if (!salesMutasi) {
      document.getElementById("salesMutasi").classList.add("is-invalid");
      return;
    }

    const btn = document.getElementById("btnKonfirmasiHapusKode");
    btn.disabled = true;

    try {
      const tglHapusKode = document.getElementById("tglHapusKode").value;
      const jamHapusKode = document.getElementById("jamHapusKode").value;

      for (const id of selectedPendingIds) {
        await updateDoc(doc(firestore, "hapusKode", id), {
          status: "processed",
          tglHapusKode,
          jamHapusKode,
          salesMutasi,
          penerima: "",
          updatedAt: Date.now(),
        });
      }

      const modalInstance = bootstrap.Modal.getInstance(konfirmasiHapusKodeModal);
      if (modalInstance) modalInstance.hide();

      toastSuccess(`${selectedPendingIds.length} data berhasil di-hapus kode`);

      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth);
      }
    } catch (err) {
      console.error("Gagal proses hapus kode:", err);
      alert("Gagal memproses hapus kode");
    } finally {
      btn.disabled = false;
    }
  });
}

// Bulk Actions - Kembalikan Terpilih
if (btnKembalikanTerpilih) {
  btnKembalikanTerpilih.addEventListener("click", async () => {
    if (selectedProcessedIds.length === 0) return;

    const ok = await confirmDelete(`Kembalikan ${selectedProcessedIds.length} data ke status pending?`);
    if (!ok) return;

    try {
      for (const id of selectedProcessedIds) {
        await updateDoc(doc(firestore, "hapusKode", id), {
          status: "pending",
          tglHapusKode: "",
          jamHapusKode: "",
          salesMutasi: "",
          penerima: "",
          updatedAt: Date.now(),
        });
      }

      toastSuccess(`${selectedProcessedIds.length} data berhasil dikembalikan`);

      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth);
      }
    } catch (err) {
      console.error("Gagal kembalikan data:", err);
      alert("Gagal mengembalikan data");
    }
  });
}

// Bulk Actions - Hapus Terpilih
if (btnHapusTerpilih) {
  btnHapusTerpilih.addEventListener("click", async () => {
    if (selectedProcessedIds.length === 0) return;

    const ok = await confirmDelete(`Hapus permanen ${selectedProcessedIds.length} data dari database?`);
    if (!ok) return;

    try {
      for (const id of selectedProcessedIds) {
        await deleteDoc(doc(firestore, "hapusKode", id));
      }

      toastSuccess(`${selectedProcessedIds.length} data berhasil dihapus permanen`);

      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth);
      }
    } catch (err) {
      console.error("Gagal hapus data:", err);
      alert("Gagal menghapus data");
    }
  });
}

// Export Excel
if (btnExportExcel) {
  btnExportExcel.addEventListener("click", () => {
    if (!window.XLSX) {
      alert("Library Excel belum dimuat");
      return;
    }

    if (processedData.length === 0) {
      alert("Tidak ada data untuk di-export");
      return;
    }

    const exportData = processedData.map((x, idx) => ({
      No: idx + 1,
      Tanggal: x.tanggal || "",
      Jam: x.jam || "",
      Sales: x.sales || "",
      Barcode: x.barcode || "",
      "Nama Barang": x.namaBarang || "",
      Berat: x.berat || "",
      Kadar: x.kadar || "",
      Keterangan: x.keterangan || "",
      "Tgl Hapus Kode": x.tglHapusKode || "",
      "Jam Hapus Kode": x.jamHapusKode || "",
      "Sales Mutasi": x.salesMutasi || "",
      Penerima: x.penerima || "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sudah Hapus Kode");

    const filename = `HapusKode_${currentFilterMonth || todayStr()}.xlsx`;
    XLSX.writeFile(wb, filename);

    toastSuccess("Data berhasil di-export");
  });
}

// Edit Mode Pending
function enterEditModePending(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  const tds = tr.children;
  const no = tds[1].textContent.trim();
  const tanggal = tds[2].textContent.trim();
  const jam = tds[3].textContent.trim();
  const sales = tds[4].textContent.trim();
  const barcode = tds[5].textContent.trim();
  const namaBarang = tds[6].textContent.trim();
  const berat = tds[7].textContent.trim();
  const kadar = tds[8].textContent.trim();
  const keterangan = tds[9].textContent.trim();

  tr.innerHTML = `
    <td><input type="checkbox" class="form-check-input" disabled></td>
    <td>${no}</td>
    <td>${tanggal}</td>
    <td>${jam}</td>
    <td><input type="text" class="form-control form-control-sm" value="${sales}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${barcode}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${namaBarang}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${berat}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${kadar}"></td>
    <td><input type="text" class="form-control form-control-sm" value="${keterangan}"></td>
    <td>
      <div class="btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-success btn-save">Simpan</button>
        <button type="button" class="btn btn-secondary btn-cancel">Batal</button>
      </div>
    </td>
  `;
  tr.dataset.id = id;

  tr.querySelector(".btn-save").addEventListener("click", async () => {
    const inputs = Array.from(tr.querySelectorAll("input[type='text']"));
    const [newSales, newBarcode, newNamaBarang, newBerat, newKadar, newKeterangan] = inputs.map((i) => i.value.trim());
    if (!newSales || !newBarcode || !newNamaBarang || !newBerat || !newKadar) {
      alert("Field Sales, Barcode, Nama Barang, Berat, dan Kadar wajib diisi");
      return;
    }
    try {
      await updateDoc(doc(firestore, "hapusKode", id), {
        sales: newSales,
        barcode: newBarcode,
        namaBarang: newNamaBarang,
        berat: newBerat,
        kadar: newKadar,
        keterangan: newKeterangan,
        updatedAt: Date.now(),
      });
      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth);
      }
      toastSuccess("Perubahan disimpan");
    } catch (err) {
      console.error("Gagal mengubah data:", err);
      alert("Gagal mengubah data");
    }
  });

  tr.querySelector(".btn-cancel").addEventListener("click", async () => {
    if (currentFilterMonth) {
      await fetchAndRender(currentFilterMonth);
    }
  });
}

// Delete Row Pending
async function deleteRowPending(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  if (!id) return;
  const ok = await confirmDelete("Hapus data ini?");
  if (!ok) return;
  try {
    await deleteDoc(doc(firestore, "hapusKode", id));
    if (currentFilterMonth) {
      await fetchAndRender(currentFilterMonth);
    }
    toastSuccess("Data dihapus");
  } catch (err) {
    console.error("Gagal menghapus data:", err);
    alert("Gagal menghapus data");
  }
}

// Edit Penerima Modal
function openEditPenerimaModal(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  const item = processedData.find((x) => x.id === id);
  if (!item) return;

  currentEditId = id;
  document.getElementById("namaPenerima").value = item.penerima || "";
  document.getElementById("namaPenerima").classList.remove("is-invalid");

  new bootstrap.Modal(editPenerimaModal).show();
}

if (document.getElementById("btnSimpanPenerima")) {
  document.getElementById("btnSimpanPenerima").addEventListener("click", async () => {
    const penerima = document.getElementById("namaPenerima").value.trim();
    if (!penerima) {
      document.getElementById("namaPenerima").classList.add("is-invalid");
      return;
    }

    if (!currentEditId) return;

    const btn = document.getElementById("btnSimpanPenerima");
    btn.disabled = true;

    try {
      await updateDoc(doc(firestore, "hapusKode", currentEditId), {
        penerima,
        updatedAt: Date.now(),
      });

      const modalInstance = bootstrap.Modal.getInstance(editPenerimaModal);
      if (modalInstance) modalInstance.hide();

      toastSuccess("Penerima berhasil disimpan");

      if (currentFilterMonth) {
        await fetchAndRender(currentFilterMonth);
      }
    } catch (err) {
      console.error("Gagal simpan penerima:", err);
      alert("Gagal menyimpan penerima");
    } finally {
      btn.disabled = false;
      currentEditId = null;
    }
  });
}

// Info Detail Modal
function openInfoDetailModal(tr) {
  if (!tr) return;
  const id = tr.dataset.id;
  const item = processedData.find((x) => x.id === id);
  if (!item) return;

  document.getElementById("infoTanggal").textContent = item.tanggal || "-";
  document.getElementById("infoJam").textContent = item.jam || "-";
  document.getElementById("infoSales").textContent = item.sales || "-";
  document.getElementById("infoBarcode").textContent = item.barcode || "-";
  document.getElementById("infoNamaBarang").textContent = item.namaBarang || "-";
  document.getElementById("infoBerat").textContent = item.berat || "-";
  document.getElementById("infoKadar").textContent = item.kadar || "-";
  document.getElementById("infoKeterangan").textContent = item.keterangan || "-";
  document.getElementById("infoTglHapusKode").textContent = item.tglHapusKode || "-";
  document.getElementById("infoJamHapusKode").textContent = item.jamHapusKode || "-";
  document.getElementById("infoSalesMutasi").textContent = item.salesMutasi || "-";

  const penerimaEl = document.getElementById("infoPenerima");
  if (item.penerima) {
    penerimaEl.innerHTML = item.penerima;
  } else {
    penerimaEl.innerHTML = '<span class="text-muted">Belum diisi</span>';
  }

  new bootstrap.Modal(infoDetailModal).show();
}

// Filter Bulan - Button Tampilkan
if (btnTampilkan) {
  btnTampilkan.addEventListener("click", () => {
    const monthStr = filterBulan?.value;
    if (!monthStr) {
      alert("Pilih bulan terlebih dahulu");
      return;
    }
    currentFilterMonth = monthStr;
    fetchAndRender(monthStr);
  });
}

// Search Pending
if (btnCariKodePending) {
  btnCariKodePending.addEventListener("click", () => {
    if (!currentFilterMonth) {
      alert("Pilih bulan terlebih dahulu");
      return;
    }
    fetchAndRender(currentFilterMonth);
  });
}

if (searchKodePending) {
  searchKodePending.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnCariKodePending?.click();
    }
  });
}

// Search Processed
if (btnCariKodeProcessed) {
  btnCariKodeProcessed.addEventListener("click", () => {
    if (!currentFilterMonth) {
      alert("Pilih bulan terlebih dahulu");
      return;
    }
    fetchAndRender(currentFilterMonth);
  });
}

if (searchKodeProcessed) {
  searchKodeProcessed.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnCariKodeProcessed?.click();
    }
  });
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  if (filterBulan) {
    filterBulan.value = currentMonthStr();
  }
  renderPendingTable([]);
  renderProcessedTable([]);
});
