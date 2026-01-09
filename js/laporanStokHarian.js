import { firestore } from "./configFirebase.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  updateDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

const mainCategories = [
  "KALUNG",
  "LIONTIN",
  "ANTING",
  "CINCIN",
  "HALA",
  "GELANG",
  "GIWANG",
  "KENDARI",
  "BERLIAN",
  "SDW",
  "EMAS_BALI",
];
const colorTypes = ["HIJAU", "BIRU", "PUTIH", "PINK", "KUNING"];
const colorMapping = { HIJAU: "Hijau", BIRU: "Biru", PUTIH: "Putih", PINK: "Pink", KUNING: "Kuning" };

// Jenis perhiasan khusus untuk HALA
const halaJewelryTypes = ["KA", "LA", "AN", "CA", "SA", "GA"];
const halaJewelryMapping = {
  KA: "Kalung",
  LA: "Liontin",
  AN: "Anting",
  CA: "Cincin",
  SA: "Giwang",
  GA: "Gelang",
};

const summaryCategories = [
  "brankas",
  "posting",
  "barang-display",
  "barang-rusak",
  "batu-lepas",
  "manual",
  "admin",
  "contoh-custom",
  "DP",
];

// Mapping terbalik untuk display nama kategori
const reverseCategoryMapping = {
  brankas: "Stok Brankas",
  posting: "Belum Posting",
  "barang-display": "Display",
  "barang-rusak": "Rusak",
  "batu-lepas": "Batu Lepas",
  manual: "Manual",
  admin: "Admin",
  DP: "DP",
  "contoh-custom": "Contoh Custom",
};

let stockDataSnapshot = {};
let lastStockFetchAt = 0;
let stockFetchPromise = null;
const STOCK_SNAPSHOT_TTL = 60000;

// Cache untuk menyimpan data snapshot per tanggal
window.dailyDataCache = {};

async function getStockSnapshot({ force = false } = {}) {
  const now = Date.now();
  const hasCache = Object.keys(stockDataSnapshot).length > 0;
  if (!force && hasCache && now - lastStockFetchAt < STOCK_SNAPSHOT_TTL) {
    return stockDataSnapshot;
  }
  if (stockFetchPromise) return stockFetchPromise;

  stockFetchPromise = (async () => {
    try {
      const stocksCol = collection(firestore, "stocks");
      const snap = await getDocs(stocksCol);
      const needed = new Set([...summaryCategories, "stok-komputer"]);
      const data = {};
      snap.forEach((docSnap) => {
        const id = docSnap.id;
        if (needed.has(id)) {
          data[id] = docSnap.data() || {};
        }
      });
      needed.forEach((id) => {
        if (!data[id]) data[id] = {};
      });
      stockDataSnapshot = data;
      lastStockFetchAt = Date.now();
      return stockDataSnapshot;
    } catch (err) {
      console.error("Error fetching stocks collection", err);
      // Gagal fetch: tetap kembalikan cache lama jika ada
      return stockDataSnapshot;
    } finally {
      stockFetchPromise = null;
    }
  })();

  return stockFetchPromise;
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
  const snapshot = { items: {}, breakdown: {} };

  mainCategories.forEach((mainCat) => {
    const categoryBreakdown = {};
    let totalAcrossAllDocs = 0;

    summaryCategories.forEach((cat) => {
      const node = stockDataSnapshot[cat] && stockDataSnapshot[cat][mainCat];
      if (!node) {
        categoryBreakdown[cat] = { total: 0 };
        return;
      }

      // Handle KALUNG, LIONTIN with color details
      if ((mainCat === "KALUNG" || mainCat === "LIONTIN") && node.details) {
        const colorBreakdown = {};
        let catTotal = 0;
        colorTypes.forEach((color) => {
          const qty = parseInt(node.details[color]) || 0;
          colorBreakdown[color] = qty;
          catTotal += qty;
        });
        categoryBreakdown[cat] = { total: catTotal, details: colorBreakdown };
        totalAcrossAllDocs += catTotal;
      }
      // Handle HALA with jewelry type details
      else if (mainCat === "HALA" && node.details) {
        const halaBreakdown = {};
        let catTotal = 0;
        halaJewelryTypes.forEach((type) => {
          const qty = parseInt(node.details[type]) || 0;
          halaBreakdown[type] = qty;
          catTotal += qty;
        });
        categoryBreakdown[cat] = { total: catTotal, details: halaBreakdown };
        totalAcrossAllDocs += catTotal;
      }
      // Handle other categories (simple quantity)
      else {
        const qty = parseInt(node.quantity) || 0;
        categoryBreakdown[cat] = { total: qty };
        totalAcrossAllDocs += qty;
      }
    });

    snapshot.breakdown[mainCat] = categoryBreakdown;

    // Compute komputer and status
    let komputer = 0;
    if (stockDataSnapshot["stok-komputer"] && stockDataSnapshot["stok-komputer"][mainCat]) {
      komputer = parseInt(stockDataSnapshot["stok-komputer"][mainCat].quantity) || 0;
    }

    let status;
    if (totalAcrossAllDocs === komputer) status = "Klop";
    else if (totalAcrossAllDocs < komputer) status = `Kurang ${komputer - totalAcrossAllDocs}`;
    else status = `Lebih ${totalAcrossAllDocs - komputer}`;

    snapshot.items[mainCat] = { total: totalAcrossAllDocs, komputer, status };
  });

  return snapshot;
}

async function saveDailyStockSnapshot(selectedDate) {
  const dateKey = formatDateKey(selectedDate);
  if (!dateKey) throw new Error("Tanggal tidak valid");
  await getStockSnapshot();
  const snapshotData = computeCurrentSummarySnapshot();
  const docRef = doc(firestore, "daily_stock_reports", dateKey);
  const existing = await getDoc(docRef);
  const payload = {
    date: dateKey,
    createdAt: new Date().toISOString(),
    items: snapshotData.items,
    breakdown: snapshotData.breakdown,
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
  const nowWita = getNowInWita();
  const todayKey = formatDateKey(nowWita);
  const yesterday = new Date(getNowInWita().getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = formatDateKey(yesterday);
  const ref = doc(firestore, "daily_stock_reports", yesterdayKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await getStockSnapshot();
    const snapshotData = computeCurrentSummarySnapshot();
    await setDoc(
      ref,
      {
        date: yesterdayKey,
        createdAt: new Date().toISOString(),
        items: snapshotData.items,
        breakdown: snapshotData.breakdown,
        backfilled: true,
      },
      { merge: true }
    );
    showToast("Snapshot kemarin (backfill) dibuat dengan breakdown lengkap", "success");
  }
  return { todayKey, yesterdayKey };
}

function renderDailyReportTable(dataObj) {
  const tbody = document.getElementById("daily-report-table-body");
  const table = document.getElementById("daily-report-table");
  const meta = document.getElementById("dailyReportMeta");
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="6" class="text-center py-4"><i class="fas fa-spinner fa-spin me-2"></i>Memuat data...</td></tr>';

  setTimeout(() => {
    tbody.innerHTML = "";
    if (!dataObj || !dataObj.items) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted py-4">
            <i class="fas fa-inbox fa-2x mb-2 d-block text-muted"></i>
            <span>Tidak ada data untuk tanggal ini</span>
          </td>
        </tr>`;
      if (meta) meta.textContent = "";
      return;
    }

    const items = dataObj.items;
    let i = 1;

    // Simpan ke cache dengan dateKey
    const dateKey = dataObj.date || formatDateKey(new Date());
    window.dailyDataCache[dateKey] = dataObj;
    window.latestDailyData = dataObj;

    mainCategories.forEach((mainCat) => {
      const rowData = (window.latestDailyData &&
        window.latestDailyData.items &&
        window.latestDailyData.items[mainCat]) ||
        items[mainCat] || { total: 0, komputer: 0, status: "-" };
      let statusClass = "text-primary";
      let statusIcon = "fas fa-info-circle";

      if (rowData.status.startsWith("Kurang")) {
        statusClass = "status-kurang";
      } else if (rowData.status.startsWith("Lebih")) {
        statusClass = "status-lebih";
      } else if (rowData.status.toLowerCase().includes("klop")) {
        statusClass = "status-klop";
        statusIcon = "fas fa-check-circle";
      }

      const tr = document.createElement("tr");
      tr.style.height = "auto";
      tr.innerHTML = `
        <td class="text-center fw-bold text-muted">${i++}</td>
        <td class="fw-semibold">${mainCat}</td>
        <td class="text-center">
          <button class="btn btn-outline-primary btn-sm lihat-detail-btn" data-main="${mainCat}">
            <i class="fas fa-eye"></i>
          </button>
        </td>
        <td class="text-center">
          <span class="badge bg-success position-relative">
            ${rowData.total}
            <i class="fas fa-cube ms-1" style="font-size: 0.7rem;"></i>
          </span>
        </td>
        <td class="text-center">
          <span class="badge bg-primary position-relative">
            ${rowData.komputer}
            <i class="fas fa-desktop ms-1" style="font-size: 0.7rem;"></i>
          </span>
        </td>
        <td class="text-center ${statusClass}">
          <i class="${statusIcon} me-1"></i>
          <strong>${rowData.status}</strong>
        </td>`;
      tbody.appendChild(tr);
    });

    table.classList.add("table-animate");
    setTimeout(() => table.classList.remove("table-animate"), 500);

    if (meta) {
      const createdDate = dataObj.createdAt ? formatDate(dataObj.createdAt) : "-";
      meta.innerHTML = `<i class="fas fa-clock me-1"></i>Snapshot: ${createdDate}`;
    }
  }, 300);
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

function getNowInWita() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 60 * 60000);
}

function millisUntilNextSnapshot() {
  const nowWita = getNowInWita();
  const target = new Date(nowWita);
  target.setHours(23, 0, 0, 0);
  if (nowWita > target) {
    target.setDate(target.getDate() + 1);
  }
  return target - nowWita;
}

async function ensureTodaySnapshotIfPassed() {
  const nowWita = getNowInWita();
  const dateKey = formatDateKey(nowWita);
  const cutOff = new Date(nowWita);
  cutOff.setHours(23, 0, 0, 0);
  if (nowWita >= cutOff) {
    const existing = await loadDailyStockSnapshot(nowWita);
    if (!existing) {
      await saveDailyStockSnapshot(nowWita);
      showToast("Snapshot otomatis dibuat dengan breakdown lengkap", "success");
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
      scheduleAutoSnapshot();
    }
  }, delay);
}

function initDailyReportPage() {
  const dateInput = document.getElementById("dailyReportDate");
  if (!dateInput) return;
  const showBtn = document.getElementById("dailyReportShowBtn");
  const exportBtn = document.getElementById("dailyReportExportBtn");
  const statusInfo = document.getElementById("dailyReportStatusInfo");
  const todayKey = formatDateKey(new Date());
  dateInput.value = todayKey;
  const todayISO = todayKey;
  dateInput.setAttribute("max", todayISO);

  ensureYesterdaySnapshotIfMissing();

  if (showBtn) {
    showBtn.addEventListener("click", async () => {
      const val = dateInput.value;
      if (!val) {
        dateInput.focus();
        dateInput.style.borderColor = "#dc3545";
        setTimeout(() => {
          dateInput.style.borderColor = "";
        }, 2000);
        showToast("Silakan pilih tanggal terlebih dahulu", "error");
        return;
      }

      showBtn.disabled = true;
      const original = showBtn.innerHTML;
      showBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Memuat data...';

      try {
        const data = await loadDailyStockSnapshot(val);
        if (data) {
          renderDailyReportTable(data);
        } else {
          await getStockSnapshot();
          const current = computeCurrentSummarySnapshot();
          current.createdAt = null;
          renderDailyReportTable(current);
        }
        showToast("Data berhasil dimuat", "success");
      } catch (e) {
        console.error(e);
        showToast("Gagal memuat laporan. Silakan coba lagi.", "error");
      } finally {
        showBtn.disabled = false;
        showBtn.innerHTML = original;
      }
    });
  } else {
    console.warn("dailyReportShowBtn not found in DOM");
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", exportTableToCSV);
  } else {
    // export button is optional in the page; no-op if missing
  }

  ensureTodaySnapshotIfPassed();
  scheduleAutoSnapshot();

  getStockSnapshot().catch(() => {});

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".lihat-detail-btn");
    if (!btn) return;
    const mainCat = btn.dataset.main;
    const dateInput = document.getElementById("dailyReportDate");
    const dateVal = dateInput ? dateInput.value : null;
    if (!dateVal) return;

    const modalEl = document.getElementById("modalDetailJenis");
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);
    document.getElementById("modalDetailJenisLabel").textContent = `Detail ${mainCat}`;
    const jenisTitle = document.getElementById("detailJenisTitle");
    const jenisTanggal = document.getElementById("detailJenisTanggal");
    if (jenisTitle) jenisTitle.textContent = mainCat;
    if (jenisTanggal) jenisTanggal.textContent = dateVal || "-";

    const thead = document.getElementById("detailJenisThead");
    const tfoot = document.getElementById("detailJenisTfoot");
    const tbody = document.getElementById("detailJenisTableBody");
    if (thead) thead.innerHTML = "";
    if (tfoot) tfoot.innerHTML = "";
    if (tbody) tbody.innerHTML = "";

    const cats = [
      "brankas",
      "posting",
      "barang-display",
      "barang-rusak",
      "batu-lepas",
      "manual",
      "admin",
      "contoh-custom",
      "DP",
    ];

    let totalFisik = 0;

    const isKalungLiontinHala = mainCat === "KALUNG" || mainCat === "LIONTIN" || mainCat === "HALA";
    const todayKey2 = formatDateKey(new Date());
    const isToday = (dateVal || todayKey2) === todayKey2;
    const showDetailEye = isKalungLiontinHala;
    const showEditAction = !isToday;
    if (thead) {
      thead.innerHTML = `
        <th>Kategori</th>
        <th class="text-center" style="width:120px">Jumlah</th>
        ${showDetailEye ? '<th class="text-center" style="width:120px">Detail</th>' : ""}
        ${showEditAction ? '<th class="text-center" style="width:120px">Edit</th>' : ""}
      `;
    }

    if (tbody) {
      const baseCols = 2 + (showDetailEye ? 1 : 0) + (showEditAction ? 1 : 0);
      const colspan = baseCols;
      tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-3 text-muted"><i class=\"fas fa-spinner fa-spin me-2\"></i>Memuat detail...</td></tr>`;
    }

    modal.show();

    // Reload data snapshot berdasarkan tanggal yang dipilih
    let snapshotData = window.dailyDataCache[dateVal];
    if (!snapshotData) {
      snapshotData = await loadDailyStockSnapshot(dateVal);
      if (snapshotData) {
        window.dailyDataCache[dateVal] = snapshotData;
      } else {
        // Jika tidak ada snapshot (hari ini), gunakan live data
        await getStockSnapshot();
        snapshotData = { items: computeCurrentSummarySnapshot(), breakdown: null };
      }
    }
    window.latestDailyData = snapshotData;

    if (tbody) tbody.innerHTML = "";
    totalFisik = 0;
    cats.forEach((cat) => {
      const breakdown = snapshotData && snapshotData.breakdown && snapshotData.breakdown[mainCat];
      let qty = 0;
      if (breakdown && breakdown[cat] && typeof breakdown[cat].total !== "undefined") {
        qty = parseInt(breakdown[cat].total) || 0;
      } else if (isToday) {
        // Hanya untuk hari ini, jika breakdown belum ada, gunakan live data
        const node = stockDataSnapshot[cat] && stockDataSnapshot[cat][mainCat];
        if (node) {
          const isKalungLiontin = mainCat === "KALUNG" || mainCat === "LIONTIN";
          const isHala = mainCat === "HALA";
          if (isKalungLiontin && node.details) {
            qty = colorTypes.reduce((sum, color) => sum + (parseInt(node.details[color]) || 0), 0);
          } else if (isHala && node.details) {
            qty = halaJewelryTypes.reduce((sum, type) => sum + (parseInt(node.details[type]) || 0), 0);
          } else {
            qty = parseInt(node.quantity) || 0;
          }
        }
      }
      // Untuk tanggal lama tanpa breakdown: qty = 0 (data tidak tersedia)
      totalFisik += qty;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${reverseCategoryMapping[cat] || cat}</td>
        <td class="text-center qty-cell" data-cat="${cat}">${qty}</td>
        ${
          showDetailEye
            ? `<td class="text-center"><button class="btn btn-outline-secondary btn-sm lihat-warna-btn" data-main="${mainCat}" data-cat="${cat}"><i class="fas fa-eye"></i></button></td>`
            : ""
        }
        ${
          showEditAction
            ? `<td class="text-center"><button class="btn btn-outline-primary btn-sm edit-kategori-btn" data-main="${mainCat}" data-cat="${cat}"><i class="fas fa-pen"></i></button></td>`
            : ""
        }
      `;
      tbody.appendChild(tr);
    });

    if (tfoot) {
      const extraEmptyCols = (showDetailEye ? 1 : 0) + (showEditAction ? 1 : 0);
      tfoot.innerHTML = `
        <th>Total</th>
        <th class="text-center" id="detailJenisTotal">${totalFisik}</th>
        ${extraEmptyCols ? `<th colspan="${extraEmptyCols}"></th>` : ""}
      `;
    }

    // Simpan edit snapshot
    const saveBtn = document.getElementById("btnSimpanEdit");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        if (isToday) return; // guard
        const dateKey = dateVal || todayKey;
        const docRef = doc(firestore, "daily_stock_reports", dateKey);
        const total = Math.max(0, parseInt((jumlahEl && jumlahEl.value) || "0", 10) || 0);
        const komputer = Math.max(0, parseInt((komputerEl && komputerEl.value) || "0", 10) || 0);
        let status = "Klop";
        if (total > komputer) status = `Lebih ${total - komputer}`;
        else if (total < komputer) status = `Kurang ${komputer - total}`;
        try {
          await updateDoc(docRef, {
            [`items.${mainCat}`]: { total, komputer, status },
            createdAt: new Date().toISOString(),
          }).catch(async (e) => {
            // Jika dokumen belum ada, buat baru
            await setDoc(
              docRef,
              { date: dateKey, createdAt: new Date().toISOString(), items: { [mainCat]: { total, komputer, status } } },
              { merge: true }
            );
          });
          // Update cache tampilan
          if (!window.latestDailyData) window.latestDailyData = { items: {} };
          if (!window.latestDailyData.items) window.latestDailyData.items = {};
          window.latestDailyData.items[mainCat] = { total, komputer, status };
          renderDailyReportTable(window.latestDailyData);
          showToast("Perubahan tersimpan", "success");
        } catch (err) {
          console.error(err);
          showToast("Gagal menyimpan perubahan", "error");
        }
      };
    }
  });

  // Delegasi klik: tombol detail warna
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".lihat-warna-btn");
    if (!btn) return;
    const mainCat = btn.dataset.main;
    const cat = btn.dataset.cat;
    const dateInput = document.getElementById("dailyReportDate");
    const dateVal = dateInput ? dateInput.value : formatDateKey(new Date());
    const modalEl = document.getElementById("modalDetailWarna");
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);
    const snapshotData = window.dailyDataCache[dateVal] || window.latestDailyData;
    renderWarnaModal({ mainCat, cat, editable: false, snapshotData });
    modal.show();
  });

  // Delegasi klik: tombol edit kategori (non-today)
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".edit-kategori-btn");
    if (!btn) return;
    const mainCat = btn.dataset.main;
    const cat = btn.dataset.cat;
    const dateInput = document.getElementById("dailyReportDate");
    const dateVal = dateInput ? dateInput.value : null;
    const todayKey = formatDateKey(new Date());
    const isToday = (dateVal || todayKey) === todayKey;
    if (isToday) return; // safety guard
    await getStockSnapshot();
    const modalEl = document.getElementById("modalDetailWarna");
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);
    const row = btn.closest("tr");
    const qtyCellEl = row ? row.querySelector("td:nth-child(2)") : null;
    const footerQtyEl = document.querySelector("#detailJenisTfoot th.text-center");
    let prevCatTotal = 0;
    const snapshotData = window.dailyDataCache[dateVal] || window.latestDailyData;
    const breakdown = snapshotData && snapshotData.breakdown && snapshotData.breakdown[mainCat];
    if (breakdown && breakdown[cat] && typeof breakdown[cat].total !== "undefined") {
      prevCatTotal = parseInt(breakdown[cat].total) || 0;
    } else {
      prevCatTotal = qtyCellEl ? parseInt(qtyCellEl.textContent) || 0 : 0;
    }
    renderWarnaModal({
      mainCat,
      cat,
      editable: true,
      dateKey: dateVal || todayKey,
      prevCatTotal,
      qtyCellEl,
      footerQtyEl,
      snapshotData,
    });
    modal.show();
  });
}

function renderWarnaModal({
  mainCat,
  cat,
  editable = false,
  dateKey = null,
  prevCatTotal = 0,
  qtyCellEl = null,
  footerQtyEl = null,
  snapshotData = null,
}) {
  const tbody = document.getElementById("warnaDetailTableBody");
  const totalFisikEl = document.getElementById("warnaDetailTotalFisik");
  if (!tbody) return;
  tbody.innerHTML = "";
  let totalF = 0;
  const isKalungLiontin = mainCat === "KALUNG" || mainCat === "LIONTIN";
  const isHala = mainCat === "HALA";

  let details = {};
  let existingTotal = 0;
  let hasBreakdownData = false;

  try {
    const useData = snapshotData || window.latestDailyData;
    const breakdown = useData && useData.breakdown && useData.breakdown[mainCat];
    const bnode = breakdown && breakdown[cat];
    if (bnode) {
      existingTotal = parseInt(bnode.total) || 0;
      details = { ...(bnode.details || {}) };
      hasBreakdownData = true;
    }
  } catch {}

  // Cek apakah ini data hari ini
  const todayKey = formatDateKey(new Date());
  const isToday = (dateKey || todayKey) === todayKey;

  // Untuk hari ini, jika tidak ada breakdown, gunakan live data
  const liveNode = stockDataSnapshot[cat] && stockDataSnapshot[cat][mainCat];
  const liveDetails = (liveNode && liveNode.details) || {};

  // Show message jika tidak ada data historical
  if (!hasBreakdownData && !isToday) {
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="2" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>Data rincian tidak tersedia untuk tanggal ini.<br><small>Breakdown detail mulai tersimpan dari snapshot terbaru.</small></td></tr>';
    }
    if (totalFisikEl) totalFisikEl.textContent = "0";
    ensureWarnaModalFooter(editable, null);
    return;
  }

  if (isKalungLiontin) {
    colorTypes.forEach((t) => {
      // Gunakan details dari breakdown, fallback ke live hanya jika hari ini
      const fis = parseInt(details[t] ?? (isToday && !hasBreakdownData ? liveDetails[t] : 0) ?? 0) || 0;
      totalF += fis;
      const tr = document.createElement("tr");
      tr.innerHTML = editable
        ? `<td>${colorMapping[t]}</td><td class="text-center"><input type="number" min="0" class="form-control form-control-sm warna-input" data-key="${t}" value="${fis}"></td>`
        : `<td>${colorMapping[t]}</td><td class="text-center">${fis}</td>`;
      tbody.appendChild(tr);
    });
  } else if (isHala) {
    halaJewelryTypes.forEach((t) => {
      // Gunakan details dari breakdown, fallback ke live hanya jika hari ini
      const fis = parseInt(details[t] ?? (isToday && !hasBreakdownData ? liveDetails[t] : 0) ?? 0) || 0;
      totalF += fis;
      const tr = document.createElement("tr");
      tr.innerHTML = editable
        ? `<td>${halaJewelryMapping[t]}</td><td class="text-center"><input type="number" min="0" class="form-control form-control-sm warna-input" data-key="${t}" value="${fis}"></td>`
        : `<td>${halaJewelryMapping[t]}</td><td class="text-center">${fis}</td>`;
      tbody.appendChild(tr);
    });
  } else {
    // Untuk kategori non-detail (CINCIN, ANTING, dll)
    // Gunakan existingTotal dari breakdown, fallback ke live hanya jika hari ini
    const fis =
      existingTotal || (isToday && !hasBreakdownData ? parseInt((liveNode && liveNode.quantity) || 0) || 0 : 0);
    totalF = fis;
    const tr = document.createElement("tr");
    tr.innerHTML = editable
      ? `<td>Total</td><td class="text-center"><input type="number" min="0" class="form-control form-control-sm" id="kategori-total-input" value="${fis}"></td>`
      : `<td>Total</td><td class="text-center">${fis}</td>`;
    tbody.appendChild(tr);
  }
  if (totalFisikEl) totalFisikEl.textContent = totalF;

  ensureWarnaModalFooter(editable, async () => {
    try {
      const targetDateKey = dateKey || formatDateKey(new Date());
      const docRef = doc(firestore, "daily_stock_reports", targetDateKey);
      let payload = { total: 0 };
      if (isKalungLiontin || isHala) {
        const inputs = Array.from(document.querySelectorAll("#modalDetailWarna .warna-input"));
        const det = {};
        let sum = 0;
        inputs.forEach((inp) => {
          const k = inp.dataset.key;
          const v = Math.max(0, parseInt(inp.value || "0", 10) || 0);
          det[k] = v;
          sum += v;
        });
        payload = { total: sum, details: det };
      } else {
        const input = document.getElementById("kategori-total-input");
        const sum = Math.max(0, parseInt((input && input.value) || "0", 10) || 0);
        payload = { total: sum };
      }

      const newTotalCat = Math.max(0, parseInt(payload.total || 0) || 0);

      if (!window.latestDailyData) window.latestDailyData = { items: {}, breakdown: {} };
      if (!window.latestDailyData.items) window.latestDailyData.items = {};
      const prevItem = window.latestDailyData.items[mainCat] || { total: 0, komputer: 0, status: "-" };
      let komputer = typeof prevItem.komputer === "number" ? prevItem.komputer : 0;
      if (!komputer) {
        const komputerNode = stockDataSnapshot["stok-komputer"] && stockDataSnapshot["stok-komputer"][mainCat];
        komputer = komputerNode ? parseInt(komputerNode.quantity) || 0 : 0;
      }

      if (!window.latestDailyData.breakdown) window.latestDailyData.breakdown = {};
      if (!window.latestDailyData.breakdown[mainCat]) window.latestDailyData.breakdown[mainCat] = {};
      window.latestDailyData.breakdown[mainCat][cat] = payload;

      if (qtyCellEl) qtyCellEl.textContent = String(newTotalCat);
      const allQtyCells = document.querySelectorAll("#modalDetailJenis .qty-cell");
      const newJenisTotal = Array.from(allQtyCells).reduce((sum, cell) => sum + (parseInt(cell.textContent) || 0), 0);
      const footerTotalEl = document.getElementById("detailJenisTotal");
      if (footerTotalEl) footerTotalEl.textContent = String(newJenisTotal);

      let status = "Klop";
      if (newJenisTotal > komputer) status = `Lebih ${newJenisTotal - komputer}`;
      else if (newJenisTotal < komputer) status = `Kurang ${komputer - newJenisTotal}`;

      await setDoc(
        docRef,
        {
          date: targetDateKey,
          createdAt: new Date().toISOString(),
          breakdown: { [mainCat]: { [cat]: payload } },
          items: { [mainCat]: { total: newJenisTotal, komputer, status } },
        },
        { merge: true }
      );

      window.latestDailyData.items[mainCat] = { total: newJenisTotal, komputer, status };
      renderDailyReportTable(window.latestDailyData);
      showToast("Perubahan tersimpan", "success");
    } catch (err) {
      console.error(err);
      showToast("Gagal menyimpan perubahan", "error");
    }
  });
}

function ensureWarnaModalFooter(editable, onSave) {
  const modalEl = document.getElementById("modalDetailWarna");
  if (!modalEl) return;
  let footer = modalEl.querySelector(".modal-footer");
  if (!footer) {
    footer = document.createElement("div");
    footer.className = "modal-footer";
    modalEl.querySelector(".modal-content").appendChild(footer);
  }
  footer.innerHTML = "";
  if (editable) {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.innerHTML = '<i class="fas fa-save me-2"></i>Simpan';
    btn.onclick = onSave;
    footer.appendChild(btn);
  }
}

async function recomputeAggregateForMainCat(docRef, mainCat) {
  const snap = await getDoc(docRef);
  const data = snap.exists() ? snap.data() : {};
  const breakdown = (data.breakdown && data.breakdown[mainCat]) || {};
  let total = 0;
  Object.values(breakdown).forEach((node) => {
    total += Math.max(0, parseInt((node && node.total) || 0) || 0);
  });
  let komputer = 0;
  const existingItem = data.items && data.items[mainCat];
  if (existingItem && typeof existingItem.komputer === "number") {
    komputer = existingItem.komputer;
  } else {
    const komputerNode = stockDataSnapshot["stok-komputer"] && stockDataSnapshot["stok-komputer"][mainCat];
    komputer = komputerNode ? parseInt(komputerNode.quantity) || 0 : 0;
  }
  let status = "Klop";
  if (total > komputer) status = `Lebih ${total - komputer}`;
  else if (total < komputer) status = `Kurang ${komputer - total}`;

  await setDoc(
    docRef,
    { items: { [mainCat]: { total, komputer, status } }, createdAt: new Date().toISOString() },
    { merge: true }
  );
  return { total, komputer, status };
}

function showToast(message, type = "success") {
  const existingToasts = document.querySelectorAll(".custom-toast");
  existingToasts.forEach((toast) => toast.remove());

  let toast = document.createElement("div");
  toast.className = `custom-toast position-fixed top-0 end-0 m-3 px-4 py-3 rounded-3 shadow-lg text-white`;
  toast.style.zIndex = 9999;
  toast.style.minWidth = "300px";
  toast.style.transform = "translateX(100%)";
  toast.style.transition = "all 0.3s ease";

  const bgClass = type === "success" ? "bg-success" : "bg-danger";
  const icon = type === "success" ? "fas fa-check-circle" : "fas fa-exclamation-triangle";

  toast.classList.add(bgClass);
  toast.innerHTML = `
    <div class="d-flex align-items-center">
      <i class="${icon} me-2 fs-5"></i>
      <span class="fw-semibold">${message}</span>
      <button class="btn-close btn-close-white ms-auto" onclick="this.parentElement.parentElement.remove()"></button>
    </div>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transform = "translateX(0)";
  }, 10);

  setTimeout(() => {
    toast.style.transform = "translateX(100%)";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, 4000);
}

document.addEventListener("DOMContentLoaded", initDailyReportPage);
