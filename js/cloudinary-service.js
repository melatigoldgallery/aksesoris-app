// Konfigurasi Cloudinary
const CLOUDINARY_CLOUD_NAME = "ds3krgrze"; // Ganti dengan cloud name Anda
const CLOUDINARY_UPLOAD_PRESET = "melati_gold_medical"; // Ganti dengan unsigned upload preset Anda
const CLOUDINARY_API_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;

// Kunci untuk menyimpan file sementara di localStorage
const TEMP_FILES_KEY = "cloudinary_temp_files";

/**
 * Mengunggah file ke Cloudinary
 * @param {File} file - File yang akan diunggah
 * @param {string} folder - Folder tujuan di Cloudinary
 * @returns {Promise<Object>} - Informasi file yang diunggah
 */
export async function uploadFile(file, folder = "") {
  try {
    // Periksa koneksi internet
    const isOnline = navigator.onLine;
    
    if (!isOnline) {
      // Jika offline, simpan file sementara
      const tempFileInfo = await saveTemporaryFile(file, folder);
      return {
        ...tempFileInfo,
        isOffline: true,
        isTemporary: true
      };
    }
    
    // Siapkan form data untuk upload
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    
    // Tambahkan folder jika ada
    if (folder) {
      formData.append("folder", folder);
    }
    
    // Tambahkan timestamp dan unique identifier untuk mencegah caching
    formData.append("timestamp", Date.now().toString());
    
    // Upload ke Cloudinary
    const response = await fetch(CLOUDINARY_API_URL, {
      method: "POST",
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Upload gagal: ${errorData.error?.message || "Unknown error"}`);
    }
    
    const data = await response.json();
    
    // Return informasi file yang diunggah
    return {
      publicId: data.public_id,
      url: data.secure_url,
      format: data.format,
      width: data.width,
      height: data.height,
      size: data.bytes,
      resourceType: data.resource_type,
      createdAt: data.created_at
    };
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    
    // Jika gagal upload karena masalah jaringan, simpan file sementara
    if (error.message.includes("network") || error.message.includes("Failed to fetch") || !navigator.onLine) {
      const tempFileInfo = await saveTemporaryFile(file, folder);
      return {
        ...tempFileInfo,
        isOffline: true,
        isTemporary: true
      };
    }
    
    throw error;
  }
}

/**
 * Menyimpan file sementara di localStorage
 * @param {File} file - File yang akan disimpan
 * @param {string} path - Path folder
 * @returns {Promise<Object>} - Informasi file sementara
 */
async function saveTemporaryFile(file, path) {
  return new Promise((resolve, reject) => {
    try {
      // Konversi file ke Data URL
      const reader = new FileReader();
      
      reader.onload = function() {
        const dataUrl = reader.result;
        
        // Buat informasi file sementara
        const tempFileInfo = {
          id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: dataUrl,
          path: path,
          timestamp: Date.now()
        };
        
        // Simpan ke localStorage
        const tempFiles = JSON.parse(localStorage.getItem(TEMP_FILES_KEY) || "[]");
        tempFiles.push(tempFileInfo);
        
        // Batasi jumlah file sementara (maksimal 10)
        if (tempFiles.length > 10) {
          tempFiles.shift(); // Hapus file tertua
        }
        
        localStorage.setItem(TEMP_FILES_KEY, JSON.stringify(tempFiles));
        
        // Return informasi file sementara
        resolve({
          id: tempFileInfo.id,
          name: file.name,
          url: dataUrl, // Gunakan data URL sebagai URL sementara
          size: file.size,
          type: file.type,
          path: path
        });
      };
      
      reader.onerror = function() {
        reject(new Error("Gagal membaca file"));
      };
      
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Memeriksa file sementara yang belum diunggah
 * @returns {Array} - Daftar file sementara
 */
export function checkTemporaryFiles() {
  try {
    const tempFiles = JSON.parse(localStorage.getItem(TEMP_FILES_KEY) || "[]");
    return tempFiles;
  } catch (error) {
    console.error("Error checking temporary files:", error);
    return [];
  }
}

/**
 * Menghapus file sementara dari localStorage
 * @param {string} fileId - ID file yang akan dihapus
 * @returns {boolean} - Status keberhasilan
 */
export function removeTemporaryFile(fileId) {
  try {
    const tempFiles = JSON.parse(localStorage.getItem(TEMP_FILES_KEY) || "[]");
    const updatedFiles = tempFiles.filter(file => file.id !== fileId);
    localStorage.setItem(TEMP_FILES_KEY, JSON.stringify(updatedFiles));
    return true;
  } catch (error) {
    console.error("Error removing temporary file:", error);
    return false;
  }
}

/**
 * Mengunggah semua file sementara
 * @returns {Promise<Object>} - Hasil upload
 */
export async function uploadAllTemporaryFiles() {
  const tempFiles = checkTemporaryFiles();
  
  if (tempFiles.length === 0) {
    return { success: 0, failed: 0 };
  }
  
  let successCount = 0;
  let failedCount = 0;
  
  for (const tempFile of tempFiles) {
    try {
      // Konversi data URL kembali ke File
      const response = await fetch(tempFile.dataUrl);
      const blob = await response.blob();
      const file = new File([blob], tempFile.name, { type: tempFile.type });
      
      // Upload file
      await uploadFile(file, tempFile.path);
      
      // Hapus file sementara jika berhasil
      removeTemporaryFile(tempFile.id);
      
      successCount++;
    } catch (error) {
      console.error("Error uploading temporary file:", error);
      failedCount++;
    }
  }
  
  return {
    success: successCount,
    failed: failedCount
  };
}

/**
 * Mendapatkan URL untuk file di Cloudinary
 * @param {string} publicId - Public ID file di Cloudinary
 * @param {Object} options - Opsi transformasi
 * @returns {string} - URL file
 */
export function getCloudinaryUrl(publicId, options = {}) {
  if (!publicId) return null;
  
  let transformations = "";
  
  // Tambahkan transformasi jika ada
  if (options.width) transformations += `w_${options.width},`;
  if (options.height) transformations += `h_${options.height},`;
  if (options.crop) transformations += `c_${options.crop},`;
  if (options.quality) transformations += `q_${options.quality},`;
  
  // Hapus koma terakhir jika ada
  if (transformations.endsWith(",")) {
    transformations = transformations.slice(0, -1);
  }
  
  // Format URL
  const transformationPath = transformations ? `${transformations}/` : "";
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${transformationPath}${publicId}`;
}

/**
 * Memeriksa kuota Cloudinary
 * @returns {Promise<Object>} - Informasi kuota
 */
export async function checkCloudinaryQuota() {
  // Catatan: Ini seharusnya dilakukan di backend untuk keamanan
  // Ini hanya contoh implementasi
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/usage`, {
      headers: {
        'Authorization': 'Basic ' + btoa('YOUR_API_KEY:YOUR_API_SECRET')
      }
    });
    
    if (!response.ok) {
      throw new Error('Gagal memeriksa kuota');
    }
    
    const data = await response.json();
    return {
      used: data.credits.usage,
      limit: data.credits.limit,
      percentUsed: (data.credits.usage / data.credits.limit) * 100
    };
  } catch (error) {
    console.error('Error checking quota:', error);
    return null;
  }
}
