// Laporan Stok Harian
import { firestore } from "./configFirebase.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// Copy subset constants (pastikan sinkron dengan manajemenStok.js)
const mainCategories = ["KALUNG", "LIONTIN", "ANTING", "CINCIN", "HALA", "GELANG", "GIWANG"];
const summaryCategories = ["brankas", "posting", "barang-display", "barang-rusak", "batu-lepas", "manual", "admin"];

// Cache ringan untuk stok agar tidak fetch berulang via window.stockData jika halaman ini dibuka terpisah
let stockDataSnapshot = {};

async function fetchStockSnapshot() {
  // Ambil dokumen-dokumen kategori di koleksi 'stocks'
  for (const cat of [...summaryCategories, "stok-komputer"]) {
    const ref = doc(firestore, "stocks", cat);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      stockDataSnapshot[cat] = snap.data();
    } else {
      stockDataSnapshot[cat] = {};
    }
  }
  return stockDataSnapshot;
}

function formatDate(date) {
  if (!date) return "-";
  const d = new Date(date);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function formatDateKey(date) {
  const d = new Date(date);
  if (isNaN(d)) return null;
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function computeCurrentSummarySnapshot() {
  const snapshot = {};
  mainCategories.forEach((mainCat) => {
    let total = 0;
    summaryCategories.forEach((cat) => {
      if (stockDataSnapshot[cat] && stockDataSnapshot[cat][mainCat]) {
        total += parseInt(stockDataSnapshot[cat][mainCat].quantity) || 0;
      }
    });
    let komputer = 0;
    if (stockDataSnapshot["stok-komputer"] && stockDataSnapshot["stok-komputer"][mainCat]) {
      komputer = parseInt(stockDataSnapshot["stok-komputer"][mainCat].quantity) || 0;
    }
    let status;
    if (total === komputer) status = "Sesuai / Klop";
    else if (total < komputer) status = `Kurang ${komputer - total}`;
    else status = `Lebih ${total - komputer}`;
    snapshot[mainCat] = { total, komputer, status };
  });
  return snapshot;
}

async function saveDailyStockSnapshot(selectedDate) {
  const dateKey = formatDateKey(selectedDate);
  if (!dateKey) throw new Error("Tanggal tidak valid");
  await fetchStockSnapshot();
  const data = computeCurrentSummarySnapshot();
  const docRef = doc(firestore, "daily_stock_reports", dateKey);
  const existing = await getDoc(docRef);
  const payload = {
    date: dateKey,
    createdAt: new Date().toISOString(),
    items: data,
  };
  await setDoc(docRef, payload, { merge: true });
  return { overwritten: existing.exists(), payload };
}

async function loadDailyStockSnapshot(selectedDate) {
  const dateKey = formatDateKey(selectedDate);
  if (!dateKey) throw new Error("Tanggal tidak valid");
  const ref = doc(firestore, "daily_stock_reports", dateKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}

async function ensureYesterdaySnapshotIfMissing() {
  // Dipanggil saat halaman dibuka: jika hari ini (WITA) belum lewat 23:00, cek apakah kemarin tidak ada snapshot dan buatkan.
  const nowWita = getNowInWita();
  const todayKey = formatDateKey(nowWita);
  // Dapatkan tanggal kemarin (WITA)
  const yesterday = new Date(getNowInWita().getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = formatDateKey(yesterday);
  // Jika snapshot kemarin tidak ada, buat.
  const ref = doc(firestore, "daily_stock_reports", yesterdayKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // Ambil data live untuk kemarin TIDAK bisa persis (karena tidak punya histori). Jadi fallback: dibuat saat ini sebagai penutup gap.
    // Tandai dengan flag backfilled true.
    await fetchStockSnapshot();
    const data = computeCurrentSummarySnapshot();
    await setDoc(
      ref,
      { date: yesterdayKey, createdAt: new Date().toISOString(), items: data, backfilled: true },
      { merge: true }
    );
    showToast("Snapshot kemarin (backfill) dibuat", "success");
  }
  return { todayKey, yesterdayKey };
}

function renderDailyReportTable(dataObj) {
  const tbody = document.getElementById("daily-report-table-body");
  const meta = document.getElementById("dailyReportMeta");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!dataObj || !dataObj.items) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Tidak ada data untuk tanggal ini</td></tr>';
    if (meta) meta.textContent = "";
    return;
  }
  const items = dataObj.items;
  let i = 1;
  mainCategories.forEach((mainCat) => {
    const rowData = items[mainCat] || { total: 0, komputer: 0, status: "-" };
    let statusClass = "text-primary";
    if (rowData.status.startsWith("Kurang")) statusClass = "text-danger";
    else if (rowData.status.startsWith("Lebih")) statusClass = "text-warning";
    else if (rowData.status.toLowerCase().includes("klop")) statusClass = "text-success";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i++}</td>
      <td>${mainCat}</td>
      <td class="text-center"><span class="badge bg-primary">${rowData.total}</span></td>
      <td class="text-center"><span class="badge bg-dark">${rowData.komputer}</span></td>
      <td class="text-center ${statusClass}"><strong>${rowData.status}</strong></td>
    `;
    tbody.appendChild(tr);
  });
  if (meta) meta.textContent = `Snapshot tersimpan: ${dataObj.createdAt ? formatDate(dataObj.createdAt) : "-"}`;
}

function exportTableToCSV() {
  const rows = Array.from(document.querySelectorAll("#daily-report-table tr"));
  const csv = rows
    .map((r) =>
      Array.from(r.querySelectorAll("th,td"))
        .map((c) => '"' + c.innerText.replace(/"/g, '""') + '"')
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `laporan-stok-harian-${document.getElementById("dailyReportDate").value || "export"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Convert current local time to WITA (UTC+8). Browser local assumed maybe different timezone.
function getNowInWita() {
  const now = new Date();
  // Get UTC ms then add 8 hours
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 60 * 60000);
}

function millisUntilNextSnapshot() {
  const nowWita = getNowInWita();
  const target = new Date(nowWita);
  target.setHours(23, 0, 0, 0); // 23:00:00 WITA
  if (nowWita > target) {
    target.setDate(target.getDate() + 1); // tomorrow
  }
  return target - nowWita;
}

async function ensureTodaySnapshotIfPassed() {
  // Jika sudah lewat 23:00 WITA hari ini dan snapshot belum ada, buat.
  const nowWita = getNowInWita();
  const dateKey = formatDateKey(nowWita);
  const cutOff = new Date(nowWita);
  cutOff.setHours(23, 0, 0, 0);
  if (nowWita >= cutOff) {
    const existing = await loadDailyStockSnapshot(nowWita);
    if (!existing) {
      await saveDailyStockSnapshot(nowWita);
      showToast("Snapshot otomatis dibuat", "success");
    }
  }
}

function scheduleAutoSnapshot() {
  const delay = millisUntilNextSnapshot();
  setTimeout(async () => {
    try {
      const nowWita = getNowInWita();
      await saveDailyStockSnapshot(nowWita);
      showToast("Snapshot otomatis terekam 23:00 WITA", "success");
    } catch (e) {
      console.error(e);
      showToast("Gagal snapshot otomatis", "error");
    } finally {
      scheduleAutoSnapshot(); // schedule next day
    }
  }, delay);
}

function initDailyReportPage() {
  const dateInput = document.getElementById("dailyReportDate");
  const showBtn = document.getElementById("dailyReportShowBtn");
  const exportBtn = document.getElementById("dailyReportExportBtn");
  const statusInfo = document.getElementById("dailyReportStatusInfo");
  if (!dateInput) return;
  const todayKey = formatDateKey(new Date());
  dateInput.value = todayKey;
  // Disable future dates
  const todayISO = todayKey; // already yyyy-mm-dd
  dateInput.setAttribute("max", todayISO);

  // Pastikan snapshot kemarin jika terlewat
  ensureYesterdaySnapshotIfMissing();

  showBtn.addEventListener("click", async () => {
    const val = dateInput.value;
    if (!val) return alert("Pilih tanggal");
    showBtn.disabled = true;
    const original = showBtn.innerHTML;
    showBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memuat...';
    try {
      const data = await loadDailyStockSnapshot(val);
      if (data) {
        renderDailyReportTable(data);
        statusInfo.textContent = "Data snapshot";
      } else {
        await fetchStockSnapshot();
        const current = { items: computeCurrentSummarySnapshot(), createdAt: null };
        renderDailyReportTable(current);
      }
    } catch (e) {
      console.error(e);
      alert("Gagal memuat laporan");
    } finally {
      showBtn.disabled = false;
      showBtn.innerHTML = original;
    }
  });

  exportBtn.addEventListener("click", exportTableToCSV);

  // Jalankan pengecekan apakah sudah lewat jam 23:00 dan snapshot belum ada.
  ensureTodaySnapshotIfPassed();
  // Jadwalkan snapshot otomatis berikutnya.
  scheduleAutoSnapshot();
}

function showToast(message, type = "success") {
  let toast = document.createElement("div");
  toast.className = `position-fixed top-0 end-0 m-3 px-3 py-2 rounded shadow text-white bg-${
    type === "success" ? "success" : "danger"
  }`;
  toast.style.zIndex = 9999;
  toast.innerHTML = `<small>${message}</small>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

document.addEventListener("DOMContentLoaded", initDailyReportPage);
