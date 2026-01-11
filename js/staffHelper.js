/**
 * Staff Helper - Mengelola daftar nama staff untuk dropdown
 * @file staffHelper.js
 */

// Daftar nama staff (sorted alphabetically)
const STAFF_NAMES = [
  "ADE INDRA",
  "ADITYA",
  "AGUN",
  "AGUSTINI",
  "ALICIA",
  "ALIM",
  "ANDARI",
  "ARISKA",
  "ASTRY",
  "AYU A.",
  "AYU J",
  "AYU P.",
  "CANDRA",
  "DEBBY",
  "DENY",
  "DESI",
  "DEWI",
  "DIAH",
  "DWIK",
  "ECI",
  "EMI",
  "FARINA",
  "FENDI",
  "FIRA",
  "FITRI",
  "GEK YUNI",
  "GUNG ANIK",
  "HANDY",
  "HAPPY",
  "IKA",
  "KRISNA",
  "LIA",
  "LINDA",
  "MANIK",
  "MARTA",
  "MAY",
  "MAYA",
  "MELIA",
  "MIZZI",
  "NADIA",
  "NANTA",
  "NOVITA",
  "NUEL",
  "PIPIT",
  "PUSPA",
  "RABEL",
  "RACHA",
  "RACHEL",
  "RAMA",
  "RATNA",
  "REYKE",
  "RIZKY",
  "RUSTIA",
  "SANTI",
  "SARAS",
  "SARI",
  "SARI KM",
  "SATYA",
  "SRI",
  "TALIA",
  "TIARA",
  "TRIADI",
  "TU ADE",
  "TYAS",
  "VANA",
  "VEREN",
  "WIDI",
  "WIDIA",
  "WIGUNA",
  "WIRA",
  "WULAN",
  "YOGA",
  "YOHAN",
  "YULI",
];

/**
 * Populate select element dengan daftar nama staff
 * @param {string|HTMLSelectElement} selectElementOrId - ID atau elemen select
 */
function populateStaffDropdown(selectElementOrId) {
  const selectElement =
    typeof selectElementOrId === "string" ? document.getElementById(selectElementOrId) : selectElementOrId;

  if (!selectElement) {
    // Silently return if element doesn't exist (expected on pages that don't use all dropdowns)
    return;
  }

  // Clear existing options (except placeholder if exists)
  selectElement.innerHTML = "";

  // Add placeholder option
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = "-- Pilih Nama Staff --";
  selectElement.appendChild(placeholderOption);

  // Add staff names
  STAFF_NAMES.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    selectElement.appendChild(option);
  });
}

/**
 * Initialize semua staff dropdown pada halaman
 */
function initializeAllStaffDropdowns() {
  // Daftar ID dropdown yang perlu diisi
  const staffDropdownIds = [
    "updateKomputerWarnaNama",
    "updateKomputerNama",
    "penambahStok",
    "penambahStokKalungBulk",
    "pengurangStokKalungBulk",
    "petugasUpdateStokKalungBulk",
    "penambahStokHalaBulk",
    "pengurangStokHalaBulk",
    "penambahStokLiontinBulk",
    "pengurangStokLiontinBulk",
    "petugasUpdateStokLiontinBulk",
    "petugasUpdateStokHalaBulk",
    "pengurangStok",
    "updateStokPetugas",
  ];

  staffDropdownIds.forEach((id) => {
    populateStaffDropdown(id);
  });
}

// Auto-initialize saat DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAllStaffDropdowns);
} else {
  initializeAllStaffDropdowns();
}

// Export untuk digunakan di file lain jika diperlukan
if (typeof module !== "undefined" && module.exports) {
  module.exports = { STAFF_NAMES, populateStaffDropdown, initializeAllStaffDropdowns };
}
