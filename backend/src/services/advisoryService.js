import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Advisory from '../models/Advisory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let advisoryRules = null;

function loadRules() {
  if (advisoryRules) return advisoryRules;
  try {
    const rulesPath = join(__dirname, '../config/advisoryRules.json');
    const raw = readFileSync(rulesPath, 'utf-8');
    advisoryRules = JSON.parse(raw);
    const count = Object.keys(advisoryRules.rules).length;
    console.log(`📋 Loaded advisory rules v${advisoryRules.version} (${count} diseases)`);
    return advisoryRules;
  } catch (err) {
    console.error('⚠️  Failed to load advisory rules:', err.message);
    advisoryRules = { rules: {} };
    return advisoryRules;
  }
}

loadRules();

/**
 * Generate an IPM advisory for a given disease, severity, and crop stage.
 *
 * @param {string} diseaseCode - e.g. "rice_blast", "cotton_bollworm"
 * @param {string} severity - "low" | "medium" | "high" | "critical"
 * @param {string} cropStage - "sowing" | "vegetative" | "flowering" | "fruiting" | "maturity" | "harvested"
 * @returns {{ cultural: Array, biological: Array, chemical: Object|null, diseaseCode: string, severity: string }}
 */
export function generateAdvisoryContent(diseaseCode, severity, cropStage = 'vegetative') {
  const rules = loadRules();
  const diseaseRules = rules.rules[diseaseCode];

  if (!diseaseRules) {
    // No rules for this disease — return generic advice
    return {
      cultural: [
        { actionKey: 'general_monitor', en: 'Continue regular field monitoring', 'hi': 'नियमित क्षेत्र निगरानी जारी रखें', 'mr': 'नियमित शेत देखरेख चालू ठेवा' },
        { actionKey: 'consult_expert', en: 'Consult your local agriculture officer', 'hi': 'अपने स्थानीय कृषि अधिकारी से परामर्श करें', 'mr': 'तुमच्या स्थानिक कृषी अधिकाऱ्याशा सल्ला करा' },
      ],
      biological: [],
      chemical: null,
      diseaseCode,
      severity,
      cropStage,
      isGeneric: true,
    };
  }

  // Determine which severity tier to use
  // "critical" uses "high" rules, "low"/"medium"/"high" map directly
  const severityKey = severity === 'critical' ? 'high' : severity;
  const tierRules = diseaseRules[severityKey] || diseaseRules.low || {};

  return {
    cultural: tierRules.cultural || [],
    biological: tierRules.biological || [],
    chemical: tierRules.chemical || null,
    diseaseCode,
    severity,
    cropStage,
    isGeneric: false,
  };
}

/**
 * Generate and persist an advisory document for a diagnosis case.
 *
 * @param {string} caseId - ObjectId of the DiagnosisCase
 * @param {string} diseaseCode
 * @param {string} severity
 * @param {string} cropStage
 * @returns {Promise<Advisory>}
 */
export async function generateAndSaveAdvisory(caseId, diseaseCode, severity, cropStage = 'vegetative') {
  const content = generateAdvisoryContent(diseaseCode, severity, cropStage);

  // Check if advisory already exists for this case
  const existing = await Advisory.findOne({ caseId }).sort({ version: -1 });
  const version = existing ? existing.version + 1 : 1;

  const advisory = await Advisory.create({
    caseId,
    version,
    diseaseCode,
    severity,
    cropStage,
    ipmCulturalActions: content.cultural,
    ipmBiologicalActions: content.biological,
    chemicalRecommendation: content.chemical,
    generatedAt: new Date(),
  });

  return advisory;
}

/**
 * Get latest advisory for a case.
 */
export async function getAdvisoryForCase(caseId) {
  return Advisory.findOne({ caseId }).sort({ version: -1 }).lean();
}

/**
 * Get advisory in a specific language.
 */
export function localizeAdvisory(advisory, lang = 'en') {
  if (!advisory) return null;

  const localizeActions = (actions) =>
    actions.map(a => ({
      actionKey: a.actionKey,
      text: a[lang] || a.en || '',
    }));

  return {
    ...advisory,
    ipmCulturalActions: localizeActions(advisory.ipmCulturalActions || []),
    ipmBiologicalActions: localizeActions(advisory.ipmBiologicalActions || []),
  };
}
