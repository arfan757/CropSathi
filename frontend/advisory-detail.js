/**
 * Advisory Detail — /advisory.html?caseId=<id>
 * Fetches the detail payload and renders the full advisory page:
 *   header banner, escalation banner, remedy cards, where-to-buy,
 *   follow-up widget, health sparkline, status footer.
 */

const API = window.CROPSATHI_API_URL || 'http://localhost:5000';
let currentLang = (typeof CropSathiPrefs !== 'undefined' && CropSathiPrefs.getPrefs().language) || 'en';

const SEVERITY = {
  mild:     { cls: 'severity-mild',     label: { en: 'Mild',     hi: 'हल्का', mr: 'हलका' } },
  moderate: { cls: 'severity-moderate', label: { en: 'Moderate', hi: 'मध्यम', mr: 'मध्यम' } },
  severe:   { cls: 'severity-severe',   label: { en: 'Severe',   hi: 'गंभीर', mr: 'गंभीर' } },
};

const PMKSK_DATA = {
  'Pune': [
    { name: 'PMKSK Pune Central', distance: '3.2 km' },
    { name: 'Krishi Seva Kendra Hadapsar', distance: '7.1 km' },
  ],
  'Nagpur': [
    { name: 'PMKSK Sitabuldi', distance: '2.8 km' },
    { name: 'Krishi Seva Kendra Wardhaman Nagar', distance: '5.4 km' },
  ],
  'Satara': [
    { name: 'PMKSK Satara Main', distance: '1.5 km' },
    { name: 'Krishi Seva Kendra Karad', distance: '27 km' },
  ],
  'Nashik': [
    { name: 'PMKSK Deolali', distance: '4.6 km' },
    { name: 'Krishi Seva Kendra Panchavati', distance: '6.2 km' },
  ],
};

// ── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const caseId = params.get('caseId');
  if (!caseId) {
    showError();
    return;
  }
  loadAdvisory(caseId);
});

// ── Data fetch ──────────────────────────────────────────────────────────────
async function loadAdvisory(caseId) {
  const token = localStorage.getItem('token');
  if (!token) { window.location.href = 'login.html'; return; }

  try {
    const res = await fetch(`${API}/api/advisory/case/${caseId}/detail?lang=${currentLang}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Not found');
    const data = await res.json();
    showContent();
    renderAll(data);
  } catch (e) {
    console.error('Advisory load error:', e);
    showError();
  }
}

// ── Visibility helpers ──────────────────────────────────────────────────────
function showLoading() {
  document.getElementById('loading-state').classList.remove('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('advisory-content').classList.add('hidden');
}
function showContent() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('advisory-content').classList.remove('hidden');
}
function showError() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
  document.getElementById('advisory-content').classList.add('hidden');
}

// ── Master render ───────────────────────────────────────────────────────────
function renderAll(data) {
  const a = data.advisory;
  const reminders = data.reminders || [];
  const followUps = data.follow_ups || [];
  const trend = data.health_score_trend || [];

  renderHeader(a);
  renderEscalation(a);
  renderClosedBanner(a);
  renderAboutDisease(a);
  renderRemedyPlan(a, reminders, a.escalateToCropsap, a.status);
  renderWhereToBuy(a);
  renderFollowUp(followUps);
  renderHealthTrend(trend);
  renderStatusFooter(a.status);
  lucide.createIcons();
}

// ── 2. Header banner ────────────────────────────────────────────────────────
function renderHeader(a) {
  const crop = (a.crop || 'Unknown').charAt(0).toUpperCase() + (a.crop || 'Unknown').slice(1);
  const disease = formatDisease(a.diseaseOrPest);
  const sev = SEVERITY[a.severity] || SEVERITY.moderate;
  const confPct = a.confidence ? Math.round(a.confidence * 100) : null;
  const dateStr = new Date(a.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  document.getElementById('hdr-crop').textContent = `${crop} — ${a.fieldName || 'Field'}`;
  document.getElementById('hdr-disease').textContent = `Disease: ${disease}`;

  const sevEl = document.getElementById('hdr-severity');
  sevEl.className = `shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide ${sev.cls}`;
  sevEl.textContent = sev.label[currentLang] || sev.label.en;

  document.getElementById('hdr-confidence').textContent = confPct !== null ? `Confidence: ${confPct}%` : '';
  document.getElementById('hdr-date').textContent = dateStr;
  document.getElementById('hdr-summary').textContent = a.summary || '';
}

// ── 3. Escalation banner ────────────────────────────────────────────────────
function renderEscalation(a) {
  const el = document.getElementById('escalation-banner');
  if (!a.escalateToCropsap) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  document.getElementById('escalation-reason').textContent = a.escalationReason || 'An extension officer will follow up.';
}

// ── 4. Closed banner ────────────────────────────────────────────────────────
function renderClosedBanner(a) {
  const el = document.getElementById('closed-banner');
  if (a.status !== 'closed') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  document.getElementById('closed-date').textContent = 'This case has been resolved.';
}

// ── 4b. About this disease (pathogen + symptoms, above remedy cards) ──────
function renderAboutDisease(a) {
  const el = document.getElementById('disease-about');
  if (!el) return;
  const pathogen = (a.pathogenName || '').trim();
  const symptoms = (a.symptoms || '').trim();
  if (!pathogen && !symptoms) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const pathogenEl = document.getElementById('disease-pathogen');
  const symptomsEl = document.getElementById('disease-symptoms');
  if (pathogenEl) {
    pathogenEl.textContent = pathogen;
    pathogenEl.classList.toggle('hidden', !pathogen);
  }
  if (symptomsEl) {
    symptomsEl.textContent = symptoms;
    symptomsEl.classList.toggle('hidden', !symptoms);
  }
}

// ── 5. IPM remedy cards ─────────────────────────────────────────────────────
function renderRemedyPlan(a, reminders, escalated, status) {
  const container = document.getElementById('remedy-plan-container');
  const plan = a.remedyPlan || [];
  if (plan.length === 0) { container.classList.add('hidden'); return; }

  const tierIcons = { cultural: 'sprout', physical: 'brush', biological: 'bug', chemical: 'flask-conical' };
  const tierColors = {
    cultural: 'bg-[#006038]/10 text-[#006038]',
    physical: 'bg-[#006038]/10 text-[#006038]',
    biological: 'bg-[#006038]/10 text-[#006038]',
    chemical: 'bg-[#933302]/10 text-[#933302]',
  };

  // Sort: cultural, then physical, then biological, chemical last
  const order = { cultural: 0, physical: 1, biological: 2, chemical: 3 };
  const sorted = [...plan].sort((x, y) => (order[x.tier] ?? 9) - (order[y.tier] ?? 9));

  container.innerHTML = sorted.map(tier => {
    const icon = tierIcons[tier.tier] || 'circle';
    const color = tierColors[tier.tier] || 'bg-[#6f7a71]/10 text-[#6f7a71]';
    const isChemical = tier.tier === 'chemical';
    const isLastResort = isChemical;
    const wrapperClass = isLastResort ? 'opacity-80 text-sm' : '';

    const itemsHtml = tier.items.map(item => {
      const hasRichDetail = item.productName || item.dosage || item.frequency || item.timing;
      if (isChemical) {
        const safetyNote = item.safetyNotes
          ? `<div class="mt-3 p-3 bg-[#933302]/5 border border-[#933302]/20 rounded-xl">
               <div class="flex items-center gap-2">
                 <i data-lucide="alert-triangle" class="w-4 h-4 text-[#933302] shrink-0"></i>
                 <p class="text-[#933302] text-xs font-semibold">${escHtml(item.safetyNotes)}</p>
               </div>
             </div>`
          : '';
        return `
          <div class="p-3 bg-[#f6f3f2] rounded-xl">
            <p class="font-semibold text-sm text-[#1b1c1c]">${escHtml(item.productClass || item.productName || item.action)}</p>
            ${item.action && (item.productClass || item.productName) && item.action !== (item.productClass || item.productName) ? `<p class="text-xs text-[#3f4941] mt-1">${escHtml(item.action)}</p>` : ''}
            <div class="text-xs text-[#3f4941] mt-1.5 space-y-0.5">
              ${item.dosage ? `<p>Dosage: ${escHtml(item.dosage)}${item.unit ? ` ${escHtml(item.unit)}` : ''}</p>` : ''}
              ${item.frequency ? `<p>Frequency: ${escHtml(item.frequency)}</p>` : ''}
              ${item.timing ? `<p>Timing: ${escHtml(item.timing)}</p>` : ''}
            </div>
            ${safetyNote}
          </div>`;
      }
      if (hasRichDetail) {
        return `
          <div class="p-3 bg-[#f6f3f2] rounded-xl">
            <p class="font-semibold text-sm text-[#1b1c1c]">${escHtml(item.action || item.text || '')}</p>
            <div class="text-xs text-[#3f4941] mt-1.5 space-y-0.5">
              ${item.productName ? `<p>Product: ${escHtml(item.productName)}</p>` : ''}
              ${item.dosage ? `<p>Dosage: ${escHtml(item.dosage)}</p>` : ''}
              ${item.frequency ? `<p>Frequency: ${escHtml(item.frequency)}</p>` : ''}
              ${item.timing ? `<p>Timing: ${escHtml(item.timing)}</p>` : ''}
              ${item.safetyNotes ? `<p class="font-semibold">Note: ${escHtml(item.safetyNotes)}</p>` : ''}
            </div>
          </div>`;
      }
      return `
        <div class="p-3 bg-[#f6f3f2] rounded-xl text-sm text-[#3f4941]">
          ${escHtml(item.text || item.action || '')}
        </div>`;
    }).join('');

    // Find linked reminder for "Mark as applied"
    const reminderMap = { application: 'remedy_reminder', reapplication: 'reapplication_reminder', harvest_wait: 'harvest_safety_wait' };
    const rType = tier.tier === 'chemical' ? 'harvest_wait' : (tier.tier === 'biological' ? 'reapplication' : 'application');
    const linkedReminder = reminders.find(r => r.reminderType === rType && r.status === 'pending');
    const markAppliedBtn = linkedReminder && !escalated && status !== 'closed'
      ? `<button data-reminder-id="${linkedReminder.id}" class="mark-applied-btn mt-3 w-full text-center text-xs font-semibold py-2 px-3 rounded-xl bg-[#006038] text-white hover:bg-[#1a7a4c] transition">
           Mark as applied
         </button>`
      : '';

    // Extension officer message if escalated
    const officerMsg = escalated
      ? `<p class="mt-3 text-xs text-[#6f7a71] italic">An extension officer will follow up</p>`
      : '';

    return `
      <div class="bg-white border border-[#e4e2e1] rounded-2xl p-5 advisory-card ${wrapperClass}">
        <div class="flex items-center gap-2.5 mb-3">
          <div class="w-8 h-8 rounded-lg ${color} flex items-center justify-center shrink-0">
            <i data-lucide="${icon}" class="w-4 h-4"></i>
          </div>
          <h3 class="font-headline font-semibold text-sm text-[#1b1c1c]">${escHtml(tier.label)}</h3>
        </div>
        <div class="space-y-2 ml-[42px]">${itemsHtml}</div>
        ${officerMsg}
        ${markAppliedBtn}
      </div>`;
  }).join('');

  // Wire up mark-applied buttons
  container.querySelectorAll('.mark-applied-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rid = btn.dataset.reminderId;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await markReminderComplete(rid);
        btn.textContent = '✓ Applied';
        btn.classList.remove('bg-[#006038]', 'hover:bg-[#1a7a4c]');
        btn.classList.add('bg-[#6f7a71]', 'cursor-default');
      } catch (e) {
        console.error('Mark applied error:', e);
        btn.textContent = 'Retry';
        btn.disabled = false;
      }
    });
  });
}

async function markReminderComplete(reminderId) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API}/api/advisory/reminders/${reminderId}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('Failed');
}

// ── 6. Where to buy ─────────────────────────────────────────────────────────
function renderWhereToBuy(a) {
  const el = document.getElementById('where-to-buy');
  const list = document.getElementById('pmksk-list');

  // Stub: look up PMKSK by farm name hint (real app would use geolocation)
  const farmHint = (a.fieldName || '').toLowerCase();
  let locations = [];
  for (const [district, locs] of Object.entries(PMKSK_DATA)) {
    if (farmHint.includes(district.toLowerCase())) {
      locations = locs;
      break;
    }
  }
  // Fallback: show a generic message
  if (locations.length === 0) {
    locations = [{ name: 'Contact your District Agriculture Office', distance: '' }];
  }

  el.classList.remove('hidden');
  list.innerHTML = locations.map(loc => `
    <div class="flex items-center justify-between p-3 bg-[#f6f3f2] rounded-xl">
      <div class="flex items-center gap-2">
        <i data-lucide="map-pin" class="w-4 h-4 text-[#6f7a71] shrink-0"></i>
        <span class="text-sm text-[#1b1c1c]">${escHtml(loc.name)}</span>
      </div>
      ${loc.distance ? `<span class="text-xs text-[#6f7a71] shrink-0">${escHtml(loc.distance)}</span>` : ''}
    </div>`).join('');
}

// ── 7. Follow-up widget ─────────────────────────────────────────────────────
function renderFollowUp(followUps) {
  const el = document.getElementById('followup-widget');
  const content = document.getElementById('followup-content');

  const pending = followUps.find(f => f.status === 'pending');
  const completed = followUps.filter(f => f.status.startsWith('completed_'));
  const latestCompleted = completed[0];

  if (pending) {
    el.classList.remove('hidden');
    const dueDate = new Date(pending.scheduledAt);
    const dueStr = dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = dueDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    content.innerHTML = `
      <div class="p-3 bg-[#f6f3f2] rounded-xl">
        <p class="text-xs text-[#6f7a71] mb-1">Next follow-up</p>
        <p class="text-sm font-semibold text-[#1b1c1c]">${dueStr} at ${timeStr}</p>
      </div>
      <div id="followup-form" class="mt-3 space-y-3">
        <p class="text-xs text-[#6f7a71]">How does your crop look?</p>
        <div class="flex gap-2">
          <button data-condition="better" class="followup-btn flex-1 py-2 px-3 rounded-xl text-xs font-semibold border border-[#006038]/30 bg-[#006038]/5 text-[#006038] hover:bg-[#006038]/10 transition">Better</button>
          <button data-condition="same" class="followup-btn flex-1 py-2 px-3 rounded-xl text-xs font-semibold border border-[#6f7a71]/30 bg-[#6f7a71]/5 text-[#6f7a71] hover:bg-[#6f7a71]/10 transition">Same</button>
          <button data-condition="worse" class="followup-btn flex-1 py-2 px-3 rounded-xl text-xs font-semibold border border-[#ba1a1a]/30 bg-[#ba1a1a]/5 text-[#ba1a1a] hover:bg-[#ba1a1a]/10 transition">Worse</button>
        </div>
        <button data-remedy="true" class="followup-applied-btn w-full py-2 px-3 rounded-xl text-xs font-semibold border border-[#e4e2e1] bg-white text-[#3f4941] hover:bg-[#f6f3f2] transition">Did you apply the remedy?</button>
      </div>`;

    // Wire follow-up buttons
    let selectedCondition = null;
    let applied = false;
    content.querySelectorAll('.followup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCondition = btn.dataset.condition;
        content.querySelectorAll('.followup-btn').forEach(b => b.classList.remove('ring-2', 'ring-[#006038]'));
        btn.classList.add('ring-2', 'ring-[#006038]');
        if (selectedCondition) submitFollowUp(pending.id, selectedCondition, applied);
      });
    });
    content.querySelectorAll('.followup-applied-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        applied = !applied;
        btn.classList.toggle('bg-[#006038]/10', applied);
        btn.classList.toggle('text-[#006038]', applied);
        btn.textContent = applied ? '✓ Remedy applied' : 'Did you apply the remedy?';
      });
    });

  } else if (latestCompleted) {
    el.classList.remove('hidden');
    const cond = latestCompleted.farmerResponse?.cropCondition || 'same';
    const condLabel = { better: 'Improving', same: 'No change yet', worse: 'Getting worse' };
    const nextPending = followUps.find(f => f.status === 'pending');
    const nextDate = nextPending
      ? new Date(nextPending.scheduledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : null;

    content.innerHTML = `
      <div class="p-3 bg-[#f6f3f2] rounded-xl">
        <p class="text-xs text-[#6f7a71]">Last follow-up</p>
        <p class="text-sm font-semibold text-[#1b1c1c] mt-0.5">Crop: ${condLabel[cond] || cond}</p>
        ${nextDate ? `<p class="text-xs text-[#6f7a71] mt-1">Next: ${nextDate}</p>` : ''}
      </div>`;

  } else {
    el.classList.add('hidden');
  }
}

async function submitFollowUp(followUpId, condition, applied) {
  const token = localStorage.getItem('token');
  try {
    await fetch(`${API}/api/followup/${followUpId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedRemedy: applied, cropCondition: condition })
    });
    // Show confirmation
    const form = document.getElementById('followup-form');
    if (form) {
      form.innerHTML = `<div class="p-3 bg-[#006038]/5 border border-[#006038]/20 rounded-xl text-center text-sm text-[#006038] font-semibold">Response recorded. Thank you!</div>`;
    }
  } catch (e) {
    console.error('Follow-up submit error:', e);
  }
}

// ── 8. Health score sparkline ───────────────────────────────────────────────
function renderHealthTrend(trend) {
  const el = document.getElementById('health-trend-card');
  if (trend.length < 2) { el.classList.add('hidden'); return; }

  el.classList.remove('hidden');
  const sparkline = document.getElementById('sparkline');
  const maxScore = Math.max(...trend.map(t => t.score || 0), 100);
  const scores = trend.map(t => t.score ?? 0);

  sparkline.innerHTML = scores.map(score => {
    const h = Math.max(4, (score / maxScore) * 48);
    const color = score >= 70 ? '#006038' : score >= 40 ? '#933302' : '#ba1a1a';
    return `<div class="sparkline-bar" style="height:${h}px;background:${color}" title="${score}/100"></div>`;
  }).join('');

  // Trend label
  const first = scores[0];
  const last = scores[scores.length - 1];
  const diff = last - first;
  const trendLabel = document.getElementById('trend-label');
  const trendSub = document.getElementById('trend-sub');

  if (diff > 5) {
    trendLabel.textContent = 'Improving';
    trendLabel.className = 'text-sm font-semibold text-[#006038]';
  } else if (diff < -5) {
    trendLabel.textContent = 'Getting worse';
    trendLabel.className = 'text-sm font-semibold text-[#ba1a1a]';
  } else {
    trendLabel.textContent = 'No change yet';
    trendLabel.className = 'text-sm font-semibold text-[#6f7a71]';
  }
  trendSub.textContent = `Score: ${last}/100`;
}

// ── 9. Status footer ────────────────────────────────────────────────────────
function renderStatusFooter(status) {
  const el = document.getElementById('status-footer');
  const labels = {
    active: 'Monitoring in progress',
    recovering: 'Health score improving — keep following the plan',
    closed: 'Case resolved',
    escalated: 'An extension officer will follow up',
  };
  el.textContent = labels[status] || '';
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatDisease(code) {
  if (!code || code === 'unknown') return 'Unknown';
  return code.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function escHtml(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}
