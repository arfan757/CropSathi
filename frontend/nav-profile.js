/**
 * Shared nav profile photo module.
 * Provides applyProfilePhoto() to update #navProfilePhoto / #navAvatarInitial.
 * Auto-applies the cached photo from localStorage on load to prevent flicker.
 */
function applyProfilePhoto(photoData) {
  const container = document.getElementById('navProfilePhoto');
  const initial = document.getElementById('navAvatarInitial');
  if (!container) return;

  const existingImg = container.querySelector('img');
  if (existingImg) existingImg.remove();

  if (photoData) {
    if (initial) initial.style.display = 'none';
    const img = document.createElement('img');
    img.src = photoData;
    img.alt = 'Profile';
    img.className = 'w-full h-full object-cover';
    container.appendChild(img);
  } else {
    if (initial) initial.style.display = '';
  }
}

// Apply cached photo immediately to prevent flicker on load
(function () {
  const cachedPhoto = localStorage.getItem('cropsathi_profile_photo');
  if (cachedPhoto) {
    applyProfilePhoto(cachedPhoto);
  }
})();
//[cite: 2]

/**
 * Shared Auto-Location Updater
 * Fetches GPS coordinates, reverse-geocodes to a readable name, 
 * updates the UI if applicable, and syncs to the backend.
 */
async function autoUpdateLocation() {
  if (!("geolocation" in navigator)) return;

  navigator.geolocation.getCurrentPosition(async (position) => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    // 1. Only run fetchWeatherData if the current page (like the dashboard) has it
    if (typeof fetchWeatherData === 'function') {
      fetchWeatherData(lat, lng);
    }

    try {
      // 2. Reverse-geocode to get a readable location name
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const geoData = await geoRes.json();
      
      const address = geoData.address || {};
      const placeName = address.village || address.town || address.city || address.county || 'Current Location';
      
      // Update the UI if the element exists on the current page
      const locationElem = document.getElementById('userLocation');
      if (locationElem) locationElem.textContent = placeName;

      // 3. Silently sync the new coordinates to your backend
      const token = localStorage.getItem('token');
      if (token && typeof CropSathiPrefs !== 'undefined') {
        await fetch(`${CropSathiPrefs.api}/api/user/profile`, { 
          method: 'PUT', // Adjust based on your API requirements (PUT/PATCH/POST)
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            farmDetails: { latitude: lat, longitude: lng, village: placeName } 
          })
        });
      }
    } catch (err) {
      console.error("Auto-location update failed:", err);
    }
  }, (error) => {
    console.warn("Geolocation permission denied or failed:", error.message);
  }, {
    enableHighAccuracy: false,
    timeout: 10000
  });
}

// Trigger location update automatically when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  autoUpdateLocation();
});