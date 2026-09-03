import Field from '../models/Field.js';
import RiskScore from '../models/RiskScore.js';
import { HealthLevel } from '../services/riskService.js';

// Map health levels to the dashboard's severity convention
const LEVEL_TO_SEVERITY = {
  [HealthLevel.HEALTHY]: 'low',
  [HealthLevel.WATCH]: 'medium',
  [HealthLevel.ELEVATED]: 'high',
  [HealthLevel.HIGH]: 'high',
};

/**
 * GET /api/dashboard/health
 * Returns per-field composite health scores for the authenticated user's farms.
 *
 * compositeScore is now a 0-100 HEALTH score (higher = healthier),
 * aligned with risk_fusion.py. Components are 0-1 stress values (1 = max stress).
 */
export async function getDashboardHealth(req, res) {
  try {
    const userId = req.user._id;

    // Get all active farms for this user
    const farms = await Field.find({ userId, status: 'active' }).lean();

    if (farms.length === 0) {
      return res.json({
        success: true,
        data: {
          fields: [],
          averageScore: 0,
          totalFields: 0,
          alertCount: 0,
        },
      });
    }

    // Fetch each farm's latest risk score (and the one before it) with two
    // aggregate queries instead of two sequential queries per farm (N+1).
    const farmIds = farms.map(f => f._id);

    const latestRows = await RiskScore.aggregate([
      { $match: { farmId: { $in: farmIds } } },
      { $sort: { computedAt: -1 } },
      { $group: { _id: '$farmId', doc: { $first: '$$ROOT' } } },
    ]);
    const latestById = new Map(latestRows.map(r => [String(r._id), r.doc]));

    let prevById = new Map();
    if (latestRows.length > 0) {
      const latestIds = latestRows.map(r => r.doc._id);
      const prevRows = await RiskScore.aggregate([
        { $match: { farmId: { $in: farmIds }, _id: { $nin: latestIds } } },
        { $sort: { computedAt: -1 } },
        { $group: { _id: '$farmId', doc: { $first: '$$ROOT' } } },
      ]);
      prevById = new Map(prevRows.map(r => [String(r._id), r.doc]));
    }

    const fields = [];
    let totalScore = 0;
    let alertCount = 0;

    for (const farm of farms) {
      const latest = latestById.get(String(farm._id)) || null;
      const previous = latest ? (prevById.get(String(farm._id)) || null) : null;

      if (latest) {
        // compositeScore should be 0-100 health score from riskService.
        // Detect old 0-1 risk scores in the database and convert them.
        let score = latest.compositeScore;
        let prevScore = previous ? previous.compositeScore : null;
        if (score !== null && score !== undefined && score <= 1 && latest.healthLevel == null) {
          score = Math.round(score * 100);
          if (prevScore !== null && prevScore !== undefined && prevScore <= 1) {
            prevScore = Math.round(prevScore * 100);
          }
        }

        let trend = 'new';
        if (prevScore !== null) {
          if (score > prevScore + 2) trend = 'up';
          else if (score < prevScore - 2) trend = 'down';
          else trend = 'stable';
        }

        // Use healthLevel from the RiskScore document (computed by riskService)
        const severity = LEVEL_TO_SEVERITY[latest.healthLevel] || 'unknown';

        fields.push({
          farmId: farm._id,
          farmName: farm.name || 'Unnamed Field',
          cropType: farm.cropType,
          areaHectares: farm.areaInHectares,
          compositeScore: score,  // 0-100 health score
          severity,
          components: {
            weather: Math.round((latest.weatherComponent || 0) * 100),  // stress → display %
            ndvi: Math.round((latest.ndviComponent || 0) * 100),
            thermal: Math.round((latest.thermalComponent || 0) * 100),
            pestHistory: Math.round((latest.pestHistoryComponent || 0) * 100),
          },
          triggeredAlert: latest.triggeredAlert || false,
          diseaseHypothesis: latest.diseaseHypothesis || null,
          staleSignals: latest.staleSignals || [],
          weightsUsed: latest.weightsUsed || null,
          computedAt: latest.computedAt,
          previousScore: prevScore,
          trend,
        });

        totalScore += score;
        if (latest.triggeredAlert) alertCount++;
      } else {
        // No risk score yet — show field with no data
        fields.push({
          farmId: farm._id,
          farmName: farm.name || 'Unnamed Field',
          cropType: farm.cropType,
          areaHectares: farm.areaInHectares,
          compositeScore: null,
          severity: 'unknown',
          components: { weather: null, ndvi: null, thermal: null, pestHistory: null },
          triggeredAlert: false,
          diseaseHypothesis: null,
          staleSignals: [],
          weightsUsed: null,
          computedAt: null,
          previousScore: null,
          trend: 'new',
        });
      }
    }

    const scoredFields = fields.filter(f => f.compositeScore !== null);
    const averageScore = scoredFields.length > 0
      ? Math.round(totalScore / scoredFields.length)
      : 0;

    return res.json({
      success: true,
      data: {
        fields,
        averageScore,
        totalFields: farms.length,
        alertCount,
      },
    });
  } catch (err) {
    console.error('Error fetching dashboard health:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard health data' });
  }
}
