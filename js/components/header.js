/**
 * Date and time functionality module
 * Handles date and time display in the header
 */

// Update date and time display
function updateDateTime() {
    const now = new Date();
    const dateElement = document.getElementById("current-date");
    const timeElement = document.getElementById("current-time");
  
    if (dateElement) {
      dateElement.textContent = now.toLocaleDateString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  
    if (timeElement) {
      timeElement.textContent = now.toLocaleTimeString("id-ID");
    }
  }
  
  // Initialize date and time functionality
  export function initializeDateTime() {
    updateDateTime();
    setInterval(updateDateTime, 1000);
  }
  