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
