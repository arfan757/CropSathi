// diagnose.js - AI-Powered Diagnosis Page
if (!localStorage.token) location.replace(window.LANDING_PAGE_URL || '/');
lucide.createIcons();
var API = (typeof CropSathiPrefs !== 'undefined' && CropSathiPrefs.api) || window.CROPSATHI_API_URL || 'http://localhost:5000';
var farms = [], uploadedFiles = [], uploadedPreviews = [];
var pendingDeleteId = null, alertFarmId = null, pollTimer = null, activePollCaseId = null;

function init() {
  loadFarms().then(function() {
    checkAlerts();
    loadActiveCases();
    loadCaseHistory();
  });
}

function loadFarms() {
  return fetch(API + "/api/fields", {
    headers: { Authorization: "Bearer " + localStorage.token }
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.success) {
      farms = d.data || [];
      var s = document.getElementById("uploadFarmSelect");
      s.innerHTML = '<option value="">Select a field...</option>';
      farms.forEach(function(f) {
        var o = document.createElement("option");
        var fid = f._id || f.id;
        o.value = fid;
        o.textContent = f.name + " (" + (f.cropType || "Crop") + ")";
        s.appendChild(o);
      });
      // If user has only 1 field, preselect it
      if (farms.length === 1) {
        s.value = farms[0]._id || farms[0].id;
      }
    }
  })
  .catch(function(e) { console.error("loadFarms error:", e); });
}

function checkAlerts() {
  fetch(API + "/api/dashboard/health", {
    headers: { Authorization: "Bearer " + localStorage.token }
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.success && d.data && d.data.fields) {
      var a = d.data.fields.filter(function(f) { return f.triggeredAlert; });
      if (a.length > 0) {
        document.getElementById("alertBanner").classList.remove("hidden");
        alertFarmId = a[0].farmId;
        document.getElementById("alertText").textContent =
          a.length + " field(s) elevated: " + a.map(function(f) { return f.farmName; }).join(", ");
      }
    }
  })
  .catch(function() {});
}

function loadActiveCases() {
  var el = document.getElementById("activeCases");
  if (!farms || farms.length === 0) {
    el.innerHTML = '<div class="text-center py-8 text-xs text-forest-400 bg-offwhite-50 rounded-2xl border border-offwhite-300 p-6 shadow-card">No fields available. Please add a field first.</div>';
    return;
  }
  var promises = farms.map(function(f) {
    var fid = f._id || f.id;
    return fetch(API + "/api/diagnosis/farms/" + fid + "/cases", {
      headers: { Authorization: "Bearer " + localStorage.token }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) { return d.success && Array.isArray(d.data) ? d.data : []; })
    .catch(function() { return []; });
  });

  Promise.all(promises).then(function(results) {
    var all = [].concat.apply([], results);
    var active = all.filter(function(c) {
      return c.status === "awaiting_photo" || c.status === "diagnosing" || c.status === "retry_failed";
    });
    el.innerHTML = active.length
      ? active.map(renderCaseCard).join("")
      : '<div class="text-center py-8 text-xs text-forest-400 bg-offwhite-50 rounded-2xl border border-offwhite-300 p-6 shadow-card">No active cases in progress</div>';
    lucide.createIcons();
    startPollingIfNeeded(active);
  });
}

function loadCaseHistory() {
  var el = document.getElementById("caseHistory");
  if (!farms || farms.length === 0) {
    el.innerHTML = '<div class="text-center py-8 text-xs text-forest-400 bg-offwhite-50 rounded-2xl border border-offwhite-300 p-6 shadow-card">No case history yet</div>';
    return;
  }
  var promises = farms.map(function(f) {
    var fid = f._id || f.id;
    return fetch(API + "/api/diagnosis/farms/" + fid + "/cases?limit=20", {
      headers: { Authorization: "Bearer " + localStorage.token }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) { return d.success && Array.isArray(d.data) ? d.data : []; })
    .catch(function() { return []; });
  });

  Promise.all(promises).then(function(results) {
    var all = [].concat.apply([], results);
    var hist = all.filter(function(c) {
      return c.status === "report_ready";
    });
    // Sort descending by created date
    hist.sort(function(a, b) {
      return new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at);
    });

    el.innerHTML = hist.length
      ? hist.map(renderCaseCard).join("")
      : '<div class="text-center py-8 text-xs text-forest-400 bg-offwhite-50 rounded-2xl border border-offwhite-300 p-6 shadow-card">No case history yet</div>';
    lucide.createIcons();
  });
}

function startPollingIfNeeded(ac) {
  var has = ac.some(function(c) { return c.status === "diagnosing"; });
  if (has && !pollTimer) {
    pollTimer = setInterval(function() {
      loadActiveCases();
      loadCaseHistory();
    }, 2500);
  } else if (!has && pollTimer && !activePollCaseId) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function renderCaseCard(c) {
  var cFarmId = typeof c.farmId === "object" ? (c.farmId._id || c.farmId.id) : c.farmId;
  var fm = farms.find(function(f) { return (f._id || f.id) === cFarmId; });
  var farmName = fm ? fm.name : (c.farmId && c.farmId.name ? c.farmId.name : "Field");
  var cropName = fm ? fm.cropType : (c.farmId && c.farmId.cropType ? c.farmId.cropType : "");
  var disease = (c.finalDiseaseCode || "").replace(/_/g, " ");
  var badge = getStatusBadge(c);
  var icon = getStatusIcon(c);
  var bottom = getBottomInfo(c);
  var id = c._id || c.id;

  return '<div class="bg-offwhite-50 border border-offwhite-300 rounded-2xl p-4 shadow-card hover:border-forest-200 transition-all relative group">' +
    '<div class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">' +
    '<button onclick="event.stopPropagation();showDeleteModal(\'' + id + '\')" class="w-8 h-8 rounded-full bg-offwhite-200 flex items-center justify-center hover:bg-terracotta-50 text-forest-500 hover:text-terracotta-500 transition-colors" title="Delete Case">' +
    '<i data-lucide="trash-2" class="w-4 h-4 text-risk-red"></i></button></div>' +
    '<div class="cursor-pointer" onclick="openCaseDetail(\'' + id + '\')">' +
    '<div class="flex items-start gap-3.5"><div class="w-11 h-11 rounded-2xl bg-forest-50 flex items-center justify-center flex-shrink-0 shadow-sm">' + icon + '</div>' +
    '<div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-0.5"><h4 class="font-heading font-bold text-sm text-forest-700 truncate">' + farmName + '</h4>' + badge + '</div>' +
    '<p class="text-xs text-forest-600 font-medium capitalize">' + (disease ? disease : (c.triggeredBy ? c.triggeredBy.replace(/_/g, " ") : "Crop Scan")) + (cropName ? ' · <span class="text-forest-400 font-normal">' + cropName + '</span>' : '') + '</p></div></div>' +
    '<div class="flex items-center gap-4 mt-3 pt-2.5 border-t border-offwhite-200 text-xs text-forest-400">' + bottom + '</div></div></div>';
}

function getStatusBadge(c) {
  if (c.status === "diagnosing") return '<span class="text-[10px] font-heading font-bold bg-forest-50 text-forest-600 px-2.5 py-0.5 rounded-full border border-forest-200 animate-pulse">Diagnosing...</span>';
  if (c.status === "retry_failed") return '<span class="text-[10px] font-heading font-bold bg-red-50 text-risk-red px-2.5 py-0.5 rounded-full border border-red-200">Retry Needed</span>';
  if (c.status === "report_ready") {
    if (c.outcome === "confirmed") return '<span class="text-[10px] font-heading font-bold bg-amber-50 text-terracotta-500 px-2.5 py-0.5 rounded-full border border-amber-200">Report Ready</span>';
    if (c.outcome === "false_alarm") return '<span class="text-[10px] font-heading font-bold bg-forest-50 text-forest-600 px-2.5 py-0.5 rounded-full border border-forest-200">Healthy</span>';
    if (c.outcome === "expert_review") return '<span class="text-[10px] font-heading font-bold bg-orange-50 text-orange-700 px-2.5 py-0.5 rounded-full border border-orange-200">Expert Review</span>';
    return '<span class="text-[10px] font-heading font-bold bg-forest-50 text-forest-600 px-2.5 py-0.5 rounded-full border border-forest-200">Report Ready</span>';
  }
  if (c.status === "awaiting_photo") return '<span class="text-[10px] font-heading font-bold bg-offwhite-200 text-forest-400 px-2.5 py-0.5 rounded-full">Awaiting Photo</span>';
  return "";
}

function getStatusIcon(c) {
  if (c.status === "diagnosing") return '<i data-lucide="loader-2" class="w-5 h-5 text-forest-500 animate-spin"></i>';
  if (c.status === "retry_failed") return '<i data-lucide="refresh-cw" class="w-5 h-5 text-risk-red"></i>';
  if (c.outcome === "confirmed") return '<i data-lucide="alert-triangle" class="w-5 h-5 text-terracotta-500"></i>';
  if (c.outcome === "false_alarm") return '<i data-lucide="check-circle" class="w-5 h-5 text-forest-500"></i>';
  if (c.outcome === "expert_review") return '<i data-lucide="help-circle" class="w-5 h-5 text-orange-600"></i>';
  return '<i data-lucide="camera" class="w-5 h-5 text-forest-400"></i>';
}

function getBottomInfo(c) {
  var parts = ["<span>" + new Date(c.createdAt || c.created_at).toLocaleDateString() + "</span>"];
  if (c.confidence) parts.push("<span>Confidence: " + Math.round(c.confidence * 100) + "%</span>");
  if (c.finalSeverity && c.finalSeverity !== 'none') parts.push("<span class='capitalize font-medium text-forest-500'>Severity: " + c.finalSeverity + "</span>");
  if (c.requiresExpertReview) parts.push('<span class="text-terracotta-500 font-semibold">Expert Review</span>');
  if (c.status === "retry_failed") parts.push('<button onclick="event.stopPropagation();retryCase(\'' + (c._id || c.id) + '\')" class="text-risk-red font-semibold hover:underline">Tap to retry</button>');
  return parts.join("");
}

function showDeleteModal(caseId) {
  pendingDeleteId = caseId;
  document.getElementById("deleteModal").classList.remove("hidden");
  lucide.createIcons();
}

function closeDeleteModal() {
  pendingDeleteId = null;
  document.getElementById("deleteModal").classList.add("hidden");
}

function confirmDelete() {
  if (!pendingDeleteId) return;
  fetch(API + "/api/diagnosis/cases/" + pendingDeleteId, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + localStorage.token }
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    closeDeleteModal();
    if (d.success) {
      loadActiveCases();
      loadCaseHistory();
    }
  })
  .catch(function() { closeDeleteModal(); });
}

function retryCase(caseId) {
  fetch(API + "/api/diagnosis/cases/" + caseId, {
    headers: { Authorization: "Bearer " + localStorage.token }
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.success) {
      var fmId = typeof d.data.farmId === "object" ? (d.data.farmId._id || d.data.farmId.id) : d.data.farmId;
      showUploadModal(fmId);
    }
  });
}

function showUploadModal(preselectedFarmId) {
  uploadedFiles = [];
  uploadedPreviews = [];
  document.getElementById("uploadStep1").classList.remove("hidden");
  document.getElementById("uploadStep2").classList.add("hidden");
  document.getElementById("uploadStep3").classList.add("hidden");
  document.getElementById("thumbStrip").classList.add("hidden");
  document.getElementById("thumbStrip").innerHTML = "";
  document.getElementById("diagnoseBtn").disabled = true;
  document.getElementById("dropZoneText").textContent = "Tap to take photo or upload";
  document.getElementById("dropZoneHint").textContent = "Up to 5 images";
  document.getElementById("uploadModal").classList.remove("hidden");

  if (preselectedFarmId) {
    document.getElementById("uploadFarmSelect").value = preselectedFarmId;
  } else if (farms.length === 1) {
    document.getElementById("uploadFarmSelect").value = farms[0]._id || farms[0].id;
  }
  lucide.createIcons();
}

function showUploadModalFromAlert() {
  showUploadModal(alertFarmId);
}

function closeUploadModal() {
  document.getElementById("uploadModal").classList.add("hidden");
  uploadedFiles = [];
  uploadedPreviews = [];
  activePollCaseId = null;
  loadActiveCases();
  loadCaseHistory();
}

document.getElementById("photoDropZone").addEventListener("click", function() {
  document.getElementById("photoInput").click();
});

document.getElementById("photoInput").addEventListener("change", function(e) {
  var newFiles = Array.from(e.target.files);
  newFiles.forEach(function(file) {
    if (uploadedFiles.length >= 5) return;
    uploadedFiles.push(file);
    var reader = new FileReader();
    reader.onload = function(ev) {
      uploadedPreviews.push(ev.target.result);
      updateThumbStrip();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = "";
});

function updateThumbStrip() {
  var strip = document.getElementById("thumbStrip");
  if (uploadedFiles.length === 0) {
    strip.classList.add("hidden");
    strip.innerHTML = "";
    document.getElementById("dropZoneText").textContent = "Tap to take photo or upload";
    document.getElementById("dropZoneHint").textContent = "Up to 5 images";
    document.getElementById("diagnoseBtn").disabled = true;
    return;
  }
  strip.classList.remove("hidden");
  strip.innerHTML = uploadedPreviews.map(function(src, i) {
    return '<div class="relative flex-shrink-0"><img src="' + src + '" class="w-14 h-14 object-cover rounded-xl border border-offwhite-300">' +
      '<button onclick="removePhoto(' + i + ')" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-risk-red text-white flex items-center justify-center text-[10px] font-bold hover:bg-red-700 shadow-sm">&times;</button></div>';
  }).join("");

  if (uploadedFiles.length < 5) {
    document.getElementById("dropZoneText").textContent = "Add More Images";
    document.getElementById("dropZoneHint").textContent = uploadedFiles.length + " of 5 added";
  } else {
    document.getElementById("dropZoneText").textContent = "Maximum 5 images";
    document.getElementById("dropZoneHint").textContent = "";
  }
  document.getElementById("diagnoseBtn").disabled = false;
  lucide.createIcons();
}

function removePhoto(index) {
  uploadedFiles.splice(index, 1);
  uploadedPreviews.splice(index, 1);
  updateThumbStrip();
}

function submitForDiagnosis() {
  var farmId = document.getElementById("uploadFarmSelect").value;
  if (!farmId || uploadedFiles.length === 0) return;

  document.getElementById("uploadStep1").classList.add("hidden");
  document.getElementById("uploadStep2").classList.remove("hidden");

  fetch(API + "/api/diagnosis/cases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + localStorage.token
    },
    body: JSON.stringify({ farmId: farmId, triggeredBy: "farmer_initiated" })
  })
  .then(function(r) { return r.json(); })
  .then(function(caseData) {
    if (!caseData.success) throw new Error(caseData.message || "Failed to create diagnosis case");
    var caseId = caseData.data._id || caseData.data.id;
    activePollCaseId = caseId;

    var fd = new FormData();
    uploadedFiles.forEach(function(f) { fd.append("photos", f); });

    return fetch(API + "/api/diagnosis/cases/" + caseId + "/photos", {
      method: "POST",
      headers: { Authorization: "Bearer " + localStorage.token },
      body: fd
    }).then(function(r) { return r.json(); });
  })
  .then(function(pd) {
    if (!pd.success) throw new Error(pd.message || "Failed to upload photos");
    var res = pd.data.diagnosisCase;
    var caseId = res._id || res.id;

    document.getElementById("uploadStep2").classList.add("hidden");
    document.getElementById("uploadStep3").classList.remove("hidden");

    if (res.status === "diagnosing") {
      document.getElementById("resultIcon").innerHTML = '<i data-lucide="loader-2" class="w-8 h-8 text-forest-500 animate-spin"></i>';
      document.getElementById("resultIcon").className = "w-16 h-16 rounded-2xl bg-forest-50 flex items-center justify-center mx-auto mb-3 shadow-sm";
      document.getElementById("resultTitle").textContent = "AI Analysis Running...";
      document.getElementById("resultText").textContent = "Our neural network is inspecting plant canopies for pathology. Results will appear shortly.";
      pollCaseUntilFinished(caseId);
    } else if (res.status === "report_ready") {
      showReportResult(res);
    } else if (res.status === "retry_failed") {
      var notes = (res.geminiResult && res.geminiResult.notes) || "";
      var isBlurry = /blur|dark|quality|resolution/i.test(notes);
      document.getElementById("resultIcon").innerHTML = '<i data-lucide="refresh-cw" class="w-8 h-8 text-risk-red"></i>';
      document.getElementById("resultIcon").className = "w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3 shadow-sm";
      document.getElementById("resultTitle").textContent = "Retry Needed";
      document.getElementById("resultText").textContent = isBlurry
        ? "Photo appears blurry or unclear. Please upload a sharp, well-lit photo of the affected leaves."
        : "Automated analysis could not be completed. Tap below to retry with another photo.";
    }

    lucide.createIcons();
    loadActiveCases();
    loadCaseHistory();
  })
  .catch(function(err) {
    console.error("submitForDiagnosis error:", err);
    document.getElementById("uploadStep2").classList.add("hidden");
    document.getElementById("uploadStep1").classList.remove("hidden");
    alert("Error: " + err.message);
  });
}

function pollCaseUntilFinished(caseId) {
  var attempts = 0;
  var maxAttempts = 25;
  var interval = setInterval(function() {
    attempts++;
    fetch(API + "/api/diagnosis/cases/" + caseId, {
      headers: { Authorization: "Bearer " + localStorage.token }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success && d.data) {
        var c = d.data;
        if (c.status === "report_ready") {
          clearInterval(interval);
          activePollCaseId = null;
          showReportResult(c);
          loadActiveCases();
          loadCaseHistory();
        } else if (c.status === "retry_failed") {
          clearInterval(interval);
          activePollCaseId = null;
          var notes = (c.geminiResult && c.geminiResult.notes) || "";
          var isBlurry = /blur|dark|quality|resolution/i.test(notes);
          document.getElementById("resultIcon").innerHTML = '<i data-lucide="refresh-cw" class="w-8 h-8 text-risk-red"></i>';
          document.getElementById("resultIcon").className = "w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3 shadow-sm";
          document.getElementById("resultTitle").textContent = "Retry Needed";
          document.getElementById("resultText").textContent = isBlurry
            ? "Photo appears blurry or unclear. Please upload a sharp, well-lit photo of the affected leaves."
            : "Automated analysis could not be completed. Tap below to retry with another photo.";
          lucide.createIcons();
          loadActiveCases();
          loadCaseHistory();
        }
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        activePollCaseId = null;
        loadActiveCases();
        loadCaseHistory();
      }
    })
    .catch(function() {
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        activePollCaseId = null;
      }
    });
  }, 1800);
}

function showReportResult(res) {
  var disease = (res.finalDiseaseCode || "").replace(/_/g, " ");
  var conf = res.confidence ? Math.round(res.confidence * 100) + "%" : "";
  if (res.outcome === "confirmed") {
    document.getElementById("resultIcon").innerHTML = '<i data-lucide="alert-triangle" class="w-8 h-8 text-terracotta-500"></i>';
    document.getElementById("resultIcon").className = "w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-3 shadow-sm";
    document.getElementById("resultTitle").textContent = "Report Ready: " + disease;
    document.getElementById("resultText").textContent = "Identified pathology with " + conf + " confidence. An actionable advisory has been created.";
  } else if (res.outcome === "false_alarm") {
    document.getElementById("resultIcon").innerHTML = '<i data-lucide="check-circle" class="w-8 h-8 text-forest-500"></i>';
    document.getElementById("resultIcon").className = "w-16 h-16 rounded-2xl bg-forest-50 flex items-center justify-center mx-auto mb-3 shadow-sm";
    document.getElementById("resultTitle").textContent = "Crop Healthy";
    document.getElementById("resultText").textContent = "No disease detected. Your crop canopy appears healthy!";
  } else if (res.outcome === "expert_review") {
    document.getElementById("resultIcon").innerHTML = '<i data-lucide="help-circle" class="w-8 h-8 text-orange-600"></i>';
    document.getElementById("resultIcon").className = "w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mx-auto mb-3 shadow-sm";
    document.getElementById("resultTitle").textContent = "Expert Review Needed";
    document.getElementById("resultText").textContent = "The diagnosis has been flagged for expert agronomist validation.";
  }
  lucide.createIcons();
}

function openCaseDetail(caseId) {
  document.getElementById("caseDetailModal").classList.remove("hidden");
  document.getElementById("caseDetailContent").innerHTML = '<div class="text-center py-8 text-xs text-forest-400">Loading case details...</div>';
  lucide.createIcons();

  fetch(API + "/api/diagnosis/cases/" + caseId, {
    headers: { Authorization: "Bearer " + localStorage.token }
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (!d.success) throw new Error(d.message || "Failed to load case");
    var c = d.data;
    var cFarmId = typeof c.farmId === "object" ? (c.farmId._id || c.farmId.id) : c.farmId;
    var fm = farms.find(function(f) { return (f._id || f.id) === cFarmId; });
    var farmName = fm ? fm.name : (c.farmId && c.farmId.name ? c.farmId.name : "Field");
    var cropType = (fm && fm.cropType) || (c.farmId && c.farmId.cropType) || (c.geminiResult && c.geminiResult.cropIdentified) || "Crop";
    var cropStage = (fm && fm.cropStage) || (c.farmId && c.farmId.cropStage) || "";
    var area = (fm && fm.areaInHectares) ? fm.areaInHectares.toFixed(1) + " Ha" : (c.farmId && c.farmId.areaInHectares ? c.farmId.areaInHectares.toFixed(1) + " Ha" : "");
    var disease = (c.finalDiseaseCode || "").replace(/_/g, " ");
    var confidence = c.confidence ? Math.round(c.confidence * 100) + "%" : "N/A";
    var severity = c.finalSeverity || "N/A";
    var outcome = c.outcome || "";

    var photosHtml = "";
    if (c.photos && c.photos.length > 0) {
      photosHtml = '<div class="mt-4"><h4 class="font-heading font-bold text-xs text-forest-400 uppercase tracking-wide mb-2">Uploaded Photos</h4>' +
        '<div class="flex gap-2 thumb-strip overflow-x-auto pb-1">' +
        c.photos.map(function(p) {
          var imgUrl = API + '/uploads/' + p.storageKey;
          return '<img src="' + imgUrl + '" onclick="openImageViewer(\'' + imgUrl + '\')" class="w-16 h-16 object-cover rounded-xl border border-offwhite-300 cursor-pointer hover:border-forest-400 transition-colors flex-shrink-0 shadow-sm" onerror="this.style.display=\'none\'">';
        }).join("") + '</div></div>';
    }

    var symptomsHtml = "";
    var rawSymptoms = (c.geminiResult && (c.geminiResult.symptomsObserved || c.geminiResult.symptoms_observed)) || [];
    // Guard: Gemini sometimes returns a string instead of an array
    var symptoms = Array.isArray(rawSymptoms)
      ? rawSymptoms
      : (typeof rawSymptoms === 'string' ? rawSymptoms.split(/\.\s+|\n+/).map(function(s){ return s.trim(); }).filter(Boolean) : []);
    if (symptoms.length > 0) {
      symptomsHtml = '<div class="mt-4"><h4 class="font-heading font-bold text-xs text-forest-400 uppercase tracking-wide mb-1.5">Observed Symptoms</h4>' +
        '<ul class="text-xs text-forest-600 space-y-1 list-disc list-inside">' +
        symptoms.map(function(s) { return "<li>" + s + "</li>"; }).join("") + '</ul></div>';
    }

    var notesHtml = "";
    var notes = (c.geminiResult && c.geminiResult.notes) || "";
    if (notes) {
      notesHtml = '<div class="mt-4 bg-offwhite-200/60 rounded-xl p-3 text-xs text-forest-600 border border-offwhite-300"><span class="font-bold text-forest-700">Diagnosis Notes:</span> ' + notes + '</div>';
    }

    var nextStepsHtml = "";
    if (outcome === "confirmed" || outcome === "expert_review" || c.status === "report_ready") {
      nextStepsHtml = '<button onclick="window.location.href=\'advisory.html?caseId=' + (c._id || c.id) + '\'" class="mt-5 w-full px-4 py-2.5 bg-forest-500 text-offwhite-50 font-heading text-xs font-semibold rounded-xl hover:bg-forest-600 transition-colors shadow-card flex items-center justify-center gap-2">View Field Advisory <i data-lucide="arrow-right" class="w-4 h-4"></i></button>';
    }

    var expertHtml = c.requiresExpertReview
      ? '<div class="mt-3 bg-amber-50 rounded-xl p-3 text-xs text-terracotta-500 font-semibold border border-amber-200 flex items-center gap-2"><i data-lucide="alert-circle" class="w-4 h-4"></i> Requires Expert Agronomist Review</div>'
      : "";

    document.getElementById("caseDetailContent").innerHTML =
      '<div class="space-y-3">' +
      '<div class="flex items-center gap-3 pb-3 border-b border-offwhite-200">' +
      '<div class="w-10 h-10 rounded-xl bg-forest-50 text-forest-500 flex items-center justify-center shadow-sm"><i data-lucide="map-pin" class="w-5 h-5"></i></div>' +
      '<div><h4 class="font-heading font-bold text-sm text-forest-700">' + farmName + '</h4>' +
      '<p class="text-xs text-forest-400 capitalize">' + cropType + (cropStage ? " · " + cropStage : "") + (area ? " · " + area : "") + '</p></div></div>' +
      (disease ? '<div class="flex items-center justify-between py-1 border-b border-offwhite-200/60"><span class="text-xs text-forest-400">Diagnosis</span><span class="text-xs font-heading font-bold text-forest-700 capitalize">' + disease + '</span></div>' : "") +
      '<div class="flex items-center justify-between py-1 border-b border-offwhite-200/60"><span class="text-xs text-forest-400">Confidence</span><span class="text-xs font-heading font-medium text-forest-700">' + confidence + '</span></div>' +
      '<div class="flex items-center justify-between py-1 border-b border-offwhite-200/60"><span class="text-xs text-forest-400">Severity</span><span class="text-xs font-heading font-medium text-forest-700 capitalize">' + severity + '</span></div>' +
      '<div class="flex items-center justify-between py-1"><span class="text-xs text-forest-400">Status</span><span class="text-xs font-heading font-medium text-forest-700 capitalize">' + (outcome || c.status.replace(/_/g, " ")) + '</span></div>' +
      photosHtml + symptomsHtml + notesHtml + expertHtml + nextStepsHtml + '</div>';

    lucide.createIcons();
  })
  .catch(function(err) {
    document.getElementById("caseDetailContent").innerHTML = '<div class="text-center py-8 text-xs text-risk-red">Error: ' + err.message + '</div>';
  });
}

function closeCaseDetail() {
  document.getElementById("caseDetailModal").classList.add("hidden");
}

function openImageViewer(src) {
  document.getElementById("viewerImg").src = src;
  document.getElementById("imageViewer").classList.remove("hidden");
}

function closeImageViewer() {
  document.getElementById("imageViewer").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", init);
