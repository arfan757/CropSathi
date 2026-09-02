const API = window.CROPSATHI_API_URL || 'http://localhost:5000';
let currentLang = localStorage.getItem('preferredLang') || 'en';
let allAdvisories = [];

// Severity config
const SEVERITY_CONFIG = {
  low: { bg: 'bg-[#006038]/10', text: 'text-[#006038]', label: { en: 'Low', hi: 'कम', mr: 'कमी' } },
  medium: { bg: 'bg-[#933302]/10', text: 'text-[#933302]', label: { en: 'Medium', hi: 'मध्यम', mr: 'मध्यम' } },
  high: { bg: 'bg-[#933302]/20', text: 'text-[#933302]', label: { en: 'High', hi: 'उच्च', mr: 'उच्च' } },
  critical: { bg: 'bg-[#ba1a1a]/10', text: 'text-[#ba1a1a]', label: { en: 'Critical', hi: 'गंभीर', mr: 'गंभीर' } },
};

// Action type configs
const ACTION_TYPES = {
  cultural: {
    icon: 'sprout',
    label: { en: 'Field Actions', hi: 'खेत के कार्य', mr: 'शेत क्रिया' },
    color: 'bg-[#006038]/10 text-[#006038]',
  },
  biological: {
    icon: 'bug',
    label: { en: 'Biological Control', hi: 'जैव नियंत्रण', mr: 'जैविक नियंत्रण' },
    color: 'bg-[#006038]/10 text-[#006038]',
  },
  chemical: {
    icon: 'flask-conical',
    label: { en: 'Chemical Treatment', hi: 'रासायनिक उपचार', mr: 'रासायनिक उपचार' },
    color: 'bg-[#933302]/10 text-[#933302]',
  },
  prevention: {
    icon: 'shield-check',
    label: { en: 'Prevention (Next Season)', hi: 'रोकथाम (अगला मौसम)', mr: 'प्रतिबंध (पुढचा हंगाम)' },
    color: 'bg-[#6f7a71]/10 text-[#6f7a71]',
  },
};

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initLanguageToggle();
  loadAdvisories();
});

// --- Language Toggle ---
function initLanguageToggle() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    if (btn.dataset.lang === currentLang) {
      btn.classList.add('bg-[#006038]', 'text-white');
      btn.classList.remove('text-[#3f4941]');
    }
    btn.addEventListener('click', () => {
      currentLang = btn.dataset.lang;
      localStorage.setItem('preferredLang', currentLang);
      document.querySelectorAll('.lang-btn').forEach(b => {
        b.classList.remove('bg-[#006038]', 'text-white');
        b.classList.add('text-[#3f4941]');
      });
      btn.classList.add('bg-[#006038]', 'text-white');
      btn.classList.remove('text-[#3f4941]');
      renderAdvisories();
    });
  });
}

// --- Load Advisories ---
async function loadAdvisories() {
  showLoading(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API}/api/advisory/latest`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    allAdvisories = data.advisories || [];
    renderAdvisories();
  } catch (err) {
    console.error('Error loading advisories:', err);
    showLoading(false);
    document.getElementById('empty-state').classList.remove('hidden');
  }
}

// --- Render ---
function renderAdvisories() {
  showLoading(false);
  const container = document.getElementById('advisories-container');
  const emptyState = document.getElementById('empty-state');

  if (allAdvisories.length === 0) {
    container.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  container.classList.remove('hidden');
  container.innerHTML = allAdvisories.map(a => renderAdvisoryCard(a)).join('');
  lucide.createIcons();
}

function renderAdvisoryCard(advisory) {
  const c = advisory.case || {};
  const severity = c.finalSeverity || advisory.severity || 'medium';
  const sevConfig = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.medium;
  const diseaseName = formatDiseaseName(c.finalDiseaseCode || advisory.diseaseCode || 'unknown');
  const cropName = (c.cropType || 'crop').charAt(0).toUpperCase() + (c.cropType || 'crop').slice(1);
  const date = new Date(c.createdAt || advisory.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const confidence = c.confidence ? Math.round(c.confidence * 100) : null;

  // Get checkboxes state from localStorage
  const checkboxKey = `advisory_${c._id}`;
  const checked = JSON.parse(localStorage.getItem(checkboxKey) || '{}');

  // Gemini result summary if available
  const geminiResult = c.geminiResult;
  const symptoms = geminiResult?.symptomsObserved || [];

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-[#e4e2e1] overflow-hidden tactile-card">
      <!-- Header -->
      <div class="p-5 border-b border-[#e4e2e1] bg-[#f6f3f2]">
        <div class="flex items-start justify-between">
          <div class="flex items-start gap-3">
            <div class="w-11 h-11 rounded-full bg-[#006038]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <i data-lucide="wheat" class="w-5 h-5 text-[#006038]"></i>
            </div>
            <div>
              <h3 class="font-headline font-semibold text-[#1b1c1c]">${cropName} — ${c.fieldName || 'Field'}</h3>
              <p class="text-sm text-[#3f4941] mt-0.5">Disease: <span class="font-semibold text-[#1b1c1c]">${diseaseName}</span></p>
              ${confidence ? `<p class="text-xs text-[#6f7a71] mt-0.5">Confidence: ${confidence}%</p>` : ''}
            </div>
          </div>
          <div class="text-right flex-shrink-0">
            <span class="inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${sevConfig.bg} ${sevConfig.text}">${sevConfig.label[currentLang] || sevConfig.label.en}</span>
            <p class="text-xs text-[#6f7a71] mt-1.5">${date}</p>
          </div>
        </div>
        ${symptoms.length > 0 ? `
          <div class="mt-3 flex flex-wrap gap-1.5">
            ${symptoms.slice(0, 3).map(s => `<span class="inline-block px-2 py-0.5 bg-[#eae8e7] text-[#3f4941] text-xs rounded-lg">${s.length > 40 ? s.substring(0, 40) + '...' : s}</span>`).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Actions -->
      <div class="p-5 space-y-5">
        ${renderActionSection('cultural', advisory.ipmCulturalActions, checked, c._id)}
        ${renderActionSection('biological', advisory.ipmBiologicalActions, checked, c._id)}
        ${renderChemicalSection(advisory.chemicalRecommendation, checked, c._id)}
        ${renderPreventionSection(checked, c._id)}
      </div>
    </div>
  `;
}

function renderActionSection(type, actions, checked, caseId) {
  if (!actions || actions.length === 0) return '';
  const config = ACTION_TYPES[type];
  const label = config.label[currentLang] || config.label.en;

  return `
    <div>
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-lg ${config.color} flex items-center justify-center flex-shrink-0">
          <i data-lucide="${config.icon}" class="w-4 h-4"></i>
        </div>
        <h4 class="font-headline font-semibold text-sm text-[#1b1c1c]">${label}</h4>
      </div>
      <div class="ml-10 space-y-2">
        ${actions.map((action, i) => {
          const text = action.text || action.en || action[currentLang] || '';
          const key = `${type}_${i}`;
          const isChecked = checked[key] || false;
          return `
            <label class="flex items-start gap-3 cursor-pointer group p-2 -mx-2 rounded-lg hover:bg-[#f6f3f2] transition">
              <input type="checkbox" class="advisory-check mt-0.5 rounded border-[#bec9bf] text-[#006038] focus:ring-[#006038] w-4 h-4"
                data-case="${caseId}" data-key="${key}" ${isChecked ? 'checked' : ''}>
              <span class="text-sm text-[#3f4941] group-hover:text-[#1b1c1c] transition ${isChecked ? 'line-through text-[#bec9bf]' : ''}">${text}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderChemicalSection(chemical, checked, caseId) {
  if (!chemical) return '';
  const config = ACTION_TYPES.chemical;
  const label = config.label[currentLang] || config.label.en;
  const key = `chemical_0`;
  const isChecked = checked[key] || false;

  return `
    <div>
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-lg ${config.color} flex items-center justify-center flex-shrink-0">
          <i data-lucide="${config.icon}" class="w-4 h-4"></i>
        </div>
        <h4 class="font-headline font-semibold text-sm text-[#1b1c1c]">${label}</h4>
      </div>
      <div class="ml-10">
        <label class="flex items-start gap-3 cursor-pointer group p-2 -mx-2 rounded-lg hover:bg-[#f6f3f2] transition">
          <input type="checkbox" class="advisory-check mt-0.5 rounded border-[#bec9bf] text-[#006038] focus:ring-[#006038] w-4 h-4"
            data-case="${caseId}" data-key="${key}" ${isChecked ? 'checked' : ''}>
          <div class="text-sm ${isChecked ? 'line-through text-[#bec9bf]' : ''}">
            <p class="font-semibold text-[#1b1c1c]">${chemical.productClass || 'Chemical treatment'}</p>
            <div class="text-[#3f4941] text-xs mt-1.5 space-y-0.5">
              ${chemical.dosage ? `<p>Dosage: ${chemical.dosage} ${chemical.unit || ''}</p>` : ''}
              ${chemical.frequency ? `<p>Frequency: ${chemical.frequency}</p>` : ''}
              ${chemical.applicationTiming ? `<p>Timing: ${chemical.applicationTiming}</p>` : ''}
            </div>
            ${chemical.preHarvestIntervalDays ? `
              <div class="mt-3 p-3 bg-[#933302]/5 border border-[#933302]/20 rounded-xl">
                <div class="flex items-center gap-2">
                  <i data-lucide="alert-triangle" class="w-4 h-4 text-[#933302] flex-shrink-0"></i>
                  <p class="text-[#933302] text-xs font-semibold">
                    Wait ${chemical.preHarvestIntervalDays} days before harvest after application
                  </p>
                </div>
              </div>
            ` : ''}
          </div>
        </label>
      </div>
    </div>
  `;
}

function renderPreventionSection(checked, caseId) {
  const preventionTips = [
    { text: { en: 'Maintain proper plant spacing for air circulation', hi: 'हवा के संचार के लिए उचित पौध दूरी बनाए रखें', mr: 'हवा वाहून येण्यासाठी योग्य रोप अंतर ठेवा' } },
    { text: { en: 'Scout field regularly for early symptoms', hi: 'शीघ्र लक्षणों के लिए नियमित रूप से खेत की जांच करें', mr: 'लवकर लक्षणांसाठी नियमितपणे शेत तपासा' } },
    { text: { en: 'Remove crop debris after harvest', hi: 'फसल की कटाई के बाद फसल अवशेष हटाएं', mr: 'पिक कापणीनंतर पिक अवशेष काढून टाका' } },
    { text: { en: 'Practice crop rotation with non-host crops', hi: 'गैर-मेजबान फसलों के साथ फसल चक्र का अभ्यास करें', mr: 'गैर-यजमान पिकांसह पिक फेरबदल करा' } },
    { text: { en: 'Use certified disease-free seeds', hi: 'प्रमाणित रोग-मुक्त बीज का उपयोग करें', mr: 'प्रमाणित रोगमुक्त बियाणे वापरा' } },
  ];

  const config = ACTION_TYPES.prevention;
  const label = config.label[currentLang] || config.label.en;

  return `
    <div>
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-lg ${config.color} flex items-center justify-center flex-shrink-0">
          <i data-lucide="${config.icon}" class="w-4 h-4"></i>
        </div>
        <h4 class="font-headline font-semibold text-sm text-[#1b1c1c]">${label}</h4>
      </div>
      <div class="ml-10 space-y-2">
        ${preventionTips.map((tip, i) => {
          const text = tip.text[currentLang] || tip.text.en;
          const key = `prevention_${i}`;
          const isChecked = checked[key] || false;
          return `
            <label class="flex items-start gap-3 cursor-pointer group p-2 -mx-2 rounded-lg hover:bg-[#f6f3f2] transition">
              <input type="checkbox" class="advisory-check mt-0.5 rounded border-[#bec9bf] text-[#006038] focus:ring-[#006038] w-4 h-4"
                data-case="${caseId}" data-key="${key}" ${isChecked ? 'checked' : ''}>
              <span class="text-sm text-[#3f4941] group-hover:text-[#1b1c1c] transition ${isChecked ? 'line-through text-[#bec9bf]' : ''}">${text}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// --- Checkbox Handler ---
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('advisory-check')) {
    const caseId = e.target.dataset.case;
    const key = e.target.dataset.key;
    const checkboxKey = `advisory_${caseId}`;
    const checked = JSON.parse(localStorage.getItem(checkboxKey) || '{}');
    checked[key] = e.target.checked;
    localStorage.setItem(checkboxKey, JSON.stringify(checked));

    const label = e.target.closest('label');
    const text = label.querySelector('span, div');
    if (e.target.checked) {
      text.classList.add('line-through', 'text-[#bec9bf]');
    } else {
      text.classList.remove('line-through', 'text-[#bec9bf]');
    }
  }
});

// --- Helpers ---
function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

function formatDiseaseName(code) {
  if (!code || code === 'unknown') return 'Unknown';
  return code.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
