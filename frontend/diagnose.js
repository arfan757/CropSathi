// diagnose.js - AI-Powered Diagnosis Page
if (!localStorage.token) location.href = "login.html";
lucide.createIcons();
var API = CropSathiPrefs.api;
var farms = [], uploadedFiles = [], uploadedPreviews = [];
var pendingDeleteId = null, alertFarmId = null, pollTimer = null;

function init() { loadFarms().then(function() { checkAlerts(); loadActiveCases(); loadCaseHistory(); }); }
function loadFarms() {
  return fetch(API+"/api/fields",{headers:{Authorization:"Bearer "+localStorage.token}})
  .then(function(r){return r.json()}).then(function(d){
    if(d.success){farms=d.data;var s=document.getElementById("uploadFarmSelect");
    s.innerHTML='<option value="">Select a field...</option>';
    farms.forEach(function(f){var o=document.createElement("option");o.value=f._id;
    o.textContent=f.name+" ("+f.cropType+")";s.appendChild(o);});}
  }).catch(function(e){console.error("loadFarms:",e);});
}
function checkAlerts() {
  fetch(API+"/api/dashboard/health",{headers:{Authorization:"Bearer "+localStorage.token}})
  .then(function(r){return r.json()}).then(function(d){
    if(d.success){var a=d.data.fields.filter(function(f){return f.triggeredAlert;});
    if(a.length>0){document.getElementById("alertBanner").classList.remove("hidden");
    alertFarmId=a[0].farmId;document.getElementById("alertText").textContent=
    a.length+" field(s) elevated: "+a.map(function(f){return f.farmName;}).join(", ");}}
  }).catch(function(){});
}
function loadActiveCases() {
  var el=document.getElementById("activeCases");
  var promises=farms.map(function(f){
    return fetch(API+"/api/diagnosis/farms/"+f._id+"/cases",{
      headers:{Authorization:"Bearer "+localStorage.token}})
    .then(function(r){return r.json()}).then(function(d){return d.success?d.data:[];})
    .catch(function(){return [];});
  });
  Promise.all(promises).then(function(results){
    var all=[].concat.apply([],results);
    var active=all.filter(function(c){
      return c.status==="awaiting_photo"||c.status==="diagnosing"||c.status==="retry_failed";});
    el.innerHTML=active.length?active.map(renderCaseCard).join(""):
      '<div class="text-center py-8 text-sm text-[#6f7a71]">No active cases</div>';
    lucide.createIcons();startPollingIfNeeded(active);});
}
function loadCaseHistory() {
  var el=document.getElementById("caseHistory");
  var promises=farms.map(function(f){
    return fetch(API+"/api/diagnosis/farms/"+f._id+"/cases?limit=10",{
      headers:{Authorization:"Bearer "+localStorage.token}})
    .then(function(r){return r.json()}).then(function(d){return d.success?d.data:[];})
    .catch(function(){return [];});
  });
  Promise.all(promises).then(function(results){
    var all=[].concat.apply([],results);
    var hist=all.filter(function(c){return c.status==="report_ready";});
    el.innerHTML=hist.length?hist.map(renderCaseCard).join(""):
      '<div class="text-center py-8 text-sm text-[#6f7a71]">No case history yet</div>';
    lucide.createIcons();});
}
function startPollingIfNeeded(ac){
  var has=ac.some(function(c){return c.status==="diagnosing";});
  if(has&&!pollTimer){pollTimer=setInterval(function(){loadActiveCases();loadCaseHistory();},3000);}
  else if(!has&&pollTimer){clearInterval(pollTimer);pollTimer=null;}
}
function renderCaseCard(c) {
  var fm=farms.find(function(f){return f._id===(typeof c.farmId==="object"?c.farmId._id:c.farmId);});
  var farmName=fm?fm.name:"Unknown", disease=(c.finalDiseaseCode||"").replace(/_/g," ");
  var badge=getStatusBadge(c), icon=getStatusIcon(c), bottom=getBottomInfo(c);
  var id=c._id;
  return '<div class="bg-white border border-[#e4e2e1] rounded-xl p-4 tactile-card relative group">'+
    '<div class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">'+
    '<button onclick="event.stopPropagation();showDeleteModal(\''+id+'\')" class="w-7 h-7 rounded-full bg-[#f0eded] flex items-center justify-center hover:bg-[#ba1a1a]/10 transition" title="Delete">'+
    '<i data-lucide="trash-2" class="w-3.5 h-3.5 text-[#ba1a1a]"></i></button></div>'+
    '<div class="cursor-pointer" onclick="openCaseDetail(\''+id+'\')">'+
    '<div class="flex items-start gap-3"><div class="w-10 h-10 rounded-xl bg-[#f6f3f2] flex items-center justify-center flex-shrink-0">'+icon+'</div>'+
    '<div class="flex-1 min-w-0"><div class="flex items-center gap-2"><h4 class="font-bold text-sm truncate">'+farmName+'</h4>'+badge+'</div>'+
    '<p class="text-xs text-[#3f4941] mt-0.5">'+(disease||c.triggeredBy.replace(/_/g," "))+'</p></div></div>'+
    '<div class="flex items-center gap-4 mt-3 text-xs text-[#6f7a71]">'+bottom+'</div></div></div>';
}
function getStatusBadge(c) {
  if(c.status==="diagnosing") return '<span class="text-[10px] font-bold bg-[#e8efe5] text-[#006038] px-2 py-0.5 rounded animate-pulse">Diagnosing...</span>';
  if(c.status==="retry_failed") return '<span class="text-[10px] font-bold bg-[#ba1a1a]/10 text-[#ba1a1a] px-2 py-0.5 rounded">Retry</span>';
  if(c.status==="report_ready"){
    if(c.outcome==="confirmed") return '<span class="text-[10px] font-bold bg-[#933302]/10 text-[#933302] px-2 py-0.5 rounded">Report Ready</span>';
    if(c.outcome==="false_alarm") return '<span class="text-[10px] font-bold bg-[#e8efe5] text-[#006038] px-2 py-0.5 rounded">Healthy</span>';
    if(c.outcome==="expert_review") return '<span class="text-[10px] font-bold bg-[#fae8d5] text-[#c05621] px-2 py-0.5 rounded">Expert Review</span>';
    return '<span class="text-[10px] font-bold bg-[#e8efe5] text-[#006038] px-2 py-0.5 rounded">Report Ready</span>';
  }
  if(c.status==="awaiting_photo") return '<span class="text-[10px] font-bold bg-[#f0eded] text-[#6f7a71] px-2 py-0.5 rounded">Awaiting</span>';
  return "";
}
function getStatusIcon(c) {
  if(c.status==="diagnosing") return '<i data-lucide="loader-2" class="w-5 h-5 text-[#006038] animate-spin"></i>';
  if(c.status==="retry_failed") return '<i data-lucide="refresh-cw" class="w-5 h-5 text-[#ba1a1a]"></i>';
  if(c.outcome==="confirmed") return '<i data-lucide="alert-triangle" class="w-5 h-5 text-[#933302]"></i>';
  if(c.outcome==="false_alarm") return '<i data-lucide="check-circle" class="w-5 h-5 text-[#006038]"></i>';
  if(c.outcome==="expert_review") return '<i data-lucide="help-circle" class="w-5 h-5 text-[#c05621]"></i>';
  return '<i data-lucide="camera" class="w-5 h-5 text-[#6f7a71]"></i>';
}
function getBottomInfo(c) {
  var parts=["<span>"+new Date(c.createdAt).toLocaleDateString()+"</span>"];
  if(c.confidence) parts.push("<span>Confidence: "+Math.round(c.confidence*100)+"%</span>");
  if(c.requiresExpertReview) parts.push('<span class="text-[#933302] font-semibold">Expert Review</span>');
  if(c.status==="retry_failed") parts.push('<button onclick="event.stopPropagation();retryCase(\''+c._id+'\')" class="text-[#ba1a1a] font-semibold hover:underline">Tap to retry</button>');
  return parts.join("");
}
function showDeleteModal(caseId) { pendingDeleteId=caseId; document.getElementById("deleteModal").classList.remove("hidden"); lucide.createIcons(); }
function closeDeleteModal() { pendingDeleteId=null; document.getElementById("deleteModal").classList.add("hidden"); }
function confirmDelete() {
  if(!pendingDeleteId) return;
  fetch(API+"/api/diagnosis/cases/"+pendingDeleteId,{method:"DELETE",headers:{Authorization:"Bearer "+localStorage.token}})
  .then(function(r){return r.json()}).then(function(d){closeDeleteModal();if(d.success){loadActiveCases();loadCaseHistory();}})
  .catch(function(){closeDeleteModal();});
}
function retryCase(caseId) {
  fetch(API+"/api/diagnosis/cases/"+caseId,{headers:{Authorization:"Bearer "+localStorage.token}})
  .then(function(r){return r.json()}).then(function(d){
    if(d.success){var fmId=typeof d.data.farmId==="object"?d.data.farmId._id:d.data.farmId;showUploadModal(fmId);}
  });
}
function showUploadModal(preselectedFarmId) {
  uploadedFiles=[]; uploadedPreviews=[];
  document.getElementById("uploadStep1").classList.remove("hidden");
  document.getElementById("uploadStep2").classList.add("hidden");
  document.getElementById("uploadStep3").classList.add("hidden");
  document.getElementById("thumbStrip").classList.add("hidden");
  document.getElementById("thumbStrip").innerHTML="";
  document.getElementById("diagnoseBtn").disabled=true;
  document.getElementById("dropZoneText").textContent="Tap to take photo or upload";
  document.getElementById("dropZoneHint").textContent="Up to 5 images";
  document.getElementById("uploadModal").classList.remove("hidden");
  if(preselectedFarmId) document.getElementById("uploadFarmSelect").value=preselectedFarmId;
  lucide.createIcons();
}
function showUploadModalFromAlert() { showUploadModal(alertFarmId); }
function closeUploadModal() { document.getElementById("uploadModal").classList.add("hidden"); uploadedFiles=[]; uploadedPreviews=[]; }
document.getElementById("photoDropZone").addEventListener("click",function(){document.getElementById("photoInput").click();});
document.getElementById("photoInput").addEventListener("change",function(e){
  var newFiles=Array.from(e.target.files);
  newFiles.forEach(function(file){
    if(uploadedFiles.length>=5) return;
    uploadedFiles.push(file);
    var reader=new FileReader();
    reader.onload=function(ev){uploadedPreviews.push(ev.target.result);updateThumbStrip();};
    reader.readAsDataURL(file);
  });
  e.target.value="";
});
function updateThumbStrip() {
  var strip=document.getElementById("thumbStrip");
  if(uploadedFiles.length===0){strip.classList.add("hidden");strip.innerHTML="";
    document.getElementById("dropZoneText").textContent="Tap to take photo or upload";
    document.getElementById("dropZoneHint").textContent="Up to 5 images";
    document.getElementById("diagnoseBtn").disabled=true;return;}
  strip.classList.remove("hidden");
  strip.innerHTML=uploadedPreviews.map(function(src,i){
    return '<div class="relative flex-shrink-0"><img src="'+src+'" class="w-14 h-14 object-cover rounded-lg border border-[#e4e2e1]">'+
    '<button onclick="removePhoto('+i+')" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#ba1a1a] text-white flex items-center justify-center text-[10px] font-bold hover:bg-[#9a1515]">&times;</button></div>';
  }).join("");
  if(uploadedFiles.length<5){document.getElementById("dropZoneText").textContent="Add More Images";
    document.getElementById("dropZoneHint").textContent=uploadedFiles.length+" of 5 added";}
  else{document.getElementById("dropZoneText").textContent="Maximum 5 images";document.getElementById("dropZoneHint").textContent="";}
  document.getElementById("diagnoseBtn").disabled=false;lucide.createIcons();
}
function removePhoto(index){uploadedFiles.splice(index,1);uploadedPreviews.splice(index,1);updateThumbStrip();}
function submitForDiagnosis() {
  var farmId=document.getElementById("uploadFarmSelect").value;
  if(!farmId||uploadedFiles.length===0) return;
  document.getElementById("uploadStep1").classList.add("hidden");
  document.getElementById("uploadStep2").classList.remove("hidden");
  fetch(API+"/api/diagnosis/cases",{method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+localStorage.token},
    body:JSON.stringify({farmId:farmId,triggeredBy:"farmer_initiated"})
  }).then(function(r){return r.json()}).then(function(caseData){
    if(!caseData.success) throw new Error(caseData.message);
    var fd=new FormData();
    uploadedFiles.forEach(function(f){fd.append("photos",f);});
    return fetch(API+"/api/diagnosis/cases/"+caseData.data._id+"/photos",{
      method:"POST",headers:{Authorization:"Bearer "+localStorage.token},body:fd
    }).then(function(r){return r.json()});
  }).then(function(pd){
    if(!pd.success) throw new Error(pd.message);
    var res=pd.data.diagnosisCase;
    document.getElementById("uploadStep2").classList.add("hidden");
    document.getElementById("uploadStep3").classList.remove("hidden");
    if(res.status==="diagnosing"){
      document.getElementById("resultIcon").innerHTML='<i data-lucide="loader-2" class="w-8 h-8 text-[#006038] animate-spin"></i>';
      document.getElementById("resultIcon").className="w-16 h-16 rounded-full bg-[#006038]/10 flex items-center justify-center mx-auto mb-4";
      document.getElementById("resultTitle").textContent="Diagnosing...";
      document.getElementById("resultText").textContent="AI is analyzing your photos. Results will appear on the case card.";
    } else if(res.status==="report_ready"){showReportResult(res);}
    else if(res.status==="retry_failed"){
      document.getElementById("resultIcon").innerHTML='<i data-lucide="refresh-cw" class="w-8 h-8 text-[#ba1a1a]"></i>';
      document.getElementById("resultIcon").className="w-16 h-16 rounded-full bg-[#ba1a1a]/10 flex items-center justify-center mx-auto mb-4";
      document.getElementById("resultTitle").textContent="Retry Needed";
      document.getElementById("resultText").textContent="Image quality was too poor. Please try again with a clearer photo.";
    }
    lucide.createIcons();loadActiveCases();loadCaseHistory();
  }).catch(function(err){console.error("submitForDiagnosis:",err);
    document.getElementById("uploadStep2").classList.add("hidden");
    document.getElementById("uploadStep1").classList.remove("hidden");alert("Error: "+err.message);});
}
function showReportResult(res) {
  var disease=(res.finalDiseaseCode||"").replace(/_/g," ");
  var conf=res.confidence?Math.round(res.confidence*100)+"%":"";
  if(res.outcome==="confirmed"){
    document.getElementById("resultIcon").innerHTML='<i data-lucide="alert-triangle" class="w-8 h-8 text-[#933302]"></i>';
    document.getElementById("resultIcon").className="w-16 h-16 rounded-full bg-[#933302]/10 flex items-center justify-center mx-auto mb-4";
    document.getElementById("resultTitle").textContent="Report Ready";
    document.getElementById("resultText").textContent=disease+(conf?" ("+conf+")":"");
  } else if(res.outcome==="false_alarm"){
    document.getElementById("resultIcon").innerHTML='<i data-lucide="check-circle" class="w-8 h-8 text-[#006038]"></i>';
    document.getElementById("resultIcon").className="w-16 h-16 rounded-full bg-[#e8efe5] flex items-center justify-center mx-auto mb-4";
    document.getElementById("resultTitle").textContent="Healthy";
    document.getElementById("resultText").textContent="No disease detected. Your crop looks healthy!";
  } else if(res.outcome==="expert_review"){
    document.getElementById("resultIcon").innerHTML='<i data-lucide="help-circle" class="w-8 h-8 text-[#c05621]"></i>';
    document.getElementById("resultIcon").className="w-16 h-16 rounded-full bg-[#fae8d5] flex items-center justify-center mx-auto mb-4";
    document.getElementById("resultTitle").textContent="Expert Review Needed";
    document.getElementById("resultText").textContent="The AI is uncertain. An expert will review your case.";
  }
}
function openCaseDetail(caseId) {
  document.getElementById("caseDetailModal").classList.remove("hidden");
  document.getElementById("caseDetailContent").innerHTML='<div class="text-center py-8 text-sm text-[#6f7a71]">Loading...</div>';
  lucide.createIcons();
  fetch(API+"/api/diagnosis/cases/"+caseId,{headers:{Authorization:"Bearer "+localStorage.token}})
  .then(function(r){return r.json()}).then(function(d){
    if(!d.success) throw new Error(d.message);
    var c=d.data;
    var fm=farms.find(function(f){return f._id===(typeof c.farmId==="object"?c.farmId._id:c.farmId);});
    var farmName=fm?fm.name:"Unknown";
    var cropType=(fm&&fm.cropType)||(c.geminiResult&&c.geminiResult.cropIdentified)||"Unknown";
    var cropStage=(fm&&fm.cropStage)||"";
    var area=fm&&fm.areaInHectares?fm.areaInHectares.toFixed(1)+" Ha":"";
    var disease=(c.finalDiseaseCode||"").replace(/_/g," ");
    var confidence=c.confidence?Math.round(c.confidence*100)+"%":"N/A";
    var severity=c.finalSeverity||"N/A";
    var outcome=c.outcome||"";
    var photosHtml="";
    if(c.photos&&c.photos.length>0){
      photosHtml='<div class="mt-4"><h4 class="font-bold text-xs text-[#6f7a71] uppercase tracking-wide mb-2">Photos</h4>'+
        '<div class="flex gap-2 thumb-strip overflow-x-auto pb-1">'+
        c.photos.map(function(p){
          return '<img src="'+API+'/uploads/'+p.storageKey+'" onclick="openImageViewer(\''+API+'/uploads/'+p.storageKey+'\')" class="w-16 h-16 object-cover rounded-lg border border-[#e4e2e1] cursor-pointer hover:border-[#006038] transition flex-shrink-0" onerror="this.style.display=\'none\'">';
        }).join("")+'</div></div>';
    }
    var symptomsHtml="";
    var symptoms=(c.geminiResult&&c.geminiResult.symptomsObserved)||[];
    if(symptoms.length>0){
      symptomsHtml='<div class="mt-3"><h4 class="font-bold text-xs text-[#6f7a71] uppercase tracking-wide mb-1">Symptoms</h4>'+
        '<ul class="text-sm text-[#3f4941] space-y-0.5">'+
        symptoms.map(function(s){return "<li>"+s+"</li>";}).join("")+'</ul></div>';
    }
    var notesHtml="";
    var notes=(c.geminiResult&&c.geminiResult.notes)||"";
    if(notes) notesHtml='<div class="mt-3 bg-[#fae8d5]/50 rounded-xl p-3 text-xs text-[#c05621]">'+notes+'</div>';
    var nextStepsHtml="";
    if(outcome==="confirmed"||outcome==="expert_review"){
      nextStepsHtml='<button onclick="closeCaseDetail()" class="mt-5 w-full px-4 py-3 bg-[#006038] text-white font-semibold rounded-full hover:bg-[#1a7a4c] transition flex items-center justify-center gap-2">Next Steps <i data-lucide="arrow-right" class="w-4 h-4"></i></button>';
    }
    var expertHtml=c.requiresExpertReview?'<div class="mt-3 bg-[#933302]/10 rounded-xl p-3 text-xs text-[#933302] font-semibold flex items-center gap-2"><i data-lucide="alert-circle" class="w-4 h-4"></i> Requires Expert Review</div>':"";
    document.getElementById("caseDetailContent").innerHTML=
      '<div class="space-y-2">'+
      '<div class="flex items-center gap-3 pb-3 border-b border-[#e4e2e1]">'+
      '<div class="w-10 h-10 rounded-xl bg-[#006038]/10 flex items-center justify-center"><i data-lucide="map-pin" class="w-5 h-5 text-[#006038]"></i></div>'+
      '<div><h4 class="font-bold text-sm">'+farmName+'</h4>'+
      '<p class="text-xs text-[#6f7a71]">'+cropType+(cropStage?" \u00B7 "+cropStage:"")+(area?" \u00B7 "+area:"")+'</p></div></div>'+
      (disease?'<div class="flex items-center justify-between"><span class="text-xs text-[#6f7a71]">Disease</span><span class="text-sm font-bold">'+disease+'</span></div>':"")+
      '<div class="flex items-center justify-between"><span class="text-xs text-[#6f7a71]">Confidence</span><span class="text-sm font-medium">'+confidence+'</span></div>'+
      '<div class="flex items-center justify-between"><span class="text-xs text-[#6f7a71]">Severity</span><span class="text-sm font-medium capitalize">'+severity+'</span></div>'+
      '<div class="flex items-center justify-between"><span class="text-xs text-[#6f7a71]">Status</span><span class="text-sm font-medium capitalize">'+(outcome||c.status.replace(/_/g," "))+'</span></div>'+
      photosHtml+symptomsHtml+notesHtml+expertHtml+nextStepsHtml+'</div>';
    lucide.createIcons();
  }).catch(function(err){
    document.getElementById("caseDetailContent").innerHTML='<div class="text-center py-8 text-sm text-[#ba1a1a]">Error: '+err.message+'</div>';
  });
}
function closeCaseDetail(){document.getElementById("caseDetailModal").classList.add("hidden");}
function openImageViewer(src){document.getElementById("viewerImg").src=src;document.getElementById("imageViewer").classList.remove("hidden");}
function closeImageViewer(){document.getElementById("imageViewer").classList.add("hidden");}
document.addEventListener("DOMContentLoaded",init);
