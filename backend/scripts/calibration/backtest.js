/**
 * Backtest Engine for CropSathi Calibration (F-03, F-21)
 *
 * Replays historical/stored risk scores against ground truth field observations
 * and computes false-positive rate (FPR), false-negative rate (FNR), and lead time.
 */

/**
 * Run backtest comparing stored risk scores against ground-truth field observations.
 *
 * @param {Array<object>} observations Array of validated ground truth records
 * @param {Array<object>} riskScores Array of stored RiskScore records
 * @param {object} [options]
 * @param {number} [options.maxLeadDays=14] Maximum lookback window in days
 * @param {number} [options.alertThreshold=60] Health score below which an alert is considered triggered
 * @returns {object} Backtest evaluation metrics
 */
export function runBacktest(observations, riskScores, options = {}) {
  const maxLeadDays = options.maxLeadDays ?? 14;
  const alertThreshold = options.alertThreshold ?? 60;

  let tp = 0; // True Positive
  let fp = 0; // False Positive
  let fn = 0; // False Negative
  let tn = 0; // True Negative
  let unmatchedCount = 0;
  const leadTimesDays = [];

  const details = [];

  for (const obs of observations) {
    const obsDate = new Date(obs.date);
    if (isNaN(obsDate.getTime())) continue;

    // Filter candidate scores for this farm before or on the observation date
    const candidates = riskScores.filter(score => {
      const farmMatch = String(score.farmId || score.farm_id) === String(obs.farmId);
      if (!farmMatch) return false;

      const scoreDate = new Date(score.computedAt || score.computed_at);
      if (isNaN(scoreDate.getTime())) return false;

      const diffDays = (obsDate.getTime() - scoreDate.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= maxLeadDays;
    });

    if (candidates.length === 0) {
      unmatchedCount++;
      details.push({
        observation: obs,
        matchedScore: null,
        status: 'no_satellite_score_in_window',
      });
      continue;
    }

    // Pick closest score prior to observation date
    candidates.sort((a, b) => {
      const da = new Date(a.computedAt || a.computed_at).getTime();
      const db = new Date(b.computedAt || b.computed_at).getTime();
      return db - da; // newest first
    });
    const bestScore = candidates[0];
    const scoreDate = new Date(bestScore.computedAt || bestScore.computed_at);
    const leadTime = Math.max(0, (obsDate.getTime() - scoreDate.getTime()) / (1000 * 60 * 60 * 24));

    // Determine predicted alert state
    const compScore = bestScore.compositeScore ?? bestScore.composite_score;
    const triggered = bestScore.triggeredAlert ?? bestScore.triggered_alert ?? (compScore !== null && compScore < alertThreshold);

    // Determine ground truth state
    const outcome = (obs.observedOutcome || '').toLowerCase();
    const isGroundTruthPositive = outcome === 'confirmed_stress' || outcome === 'confirmed_disease';
    const isGroundTruthNegative = outcome === 'healthy' || outcome === 'false_alarm';

    let classification = 'unknown';

    if (triggered && isGroundTruthPositive) {
      tp++;
      leadTimesDays.push(leadTime);
      classification = 'TP';
    } else if (triggered && isGroundTruthNegative) {
      fp++;
      classification = 'FP';
    } else if (!triggered && isGroundTruthPositive) {
      fn++;
      classification = 'FN';
    } else if (!triggered && isGroundTruthNegative) {
      tn++;
      classification = 'TN';
    }

    details.push({
      observation: obs,
      matchedScoreId: bestScore._id || bestScore.id,
      scoreValue: compScore,
      triggered,
      leadTimeDays: Math.round(leadTime * 10) / 10,
      classification,
    });
  }

  const evaluated = tp + fp + fn + tn;
  const fpr = (fp + tn > 0) ? fp / (fp + tn) : 0;
  const fnr = (fn + tp > 0) ? fn / (fn + tp) : 0;
  const precision = (tp + fp > 0) ? tp / (tp + fp) : 0;
  const recall = (tp + fn > 0) ? tp / (tp + fn) : 0;
  const avgLeadTime = leadTimesDays.length > 0
    ? leadTimesDays.reduce((a, b) => a + b, 0) / leadTimesDays.length
    : 0;

  return {
    summary: {
      totalObservations: observations.length,
      evaluatedObservations: evaluated,
      unmatchedObservations: unmatchedCount,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      trueNegatives: tn,
      falsePositiveRate: Math.round(fpr * 1000) / 1000,
      falseNegativeRate: Math.round(fnr * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      averageLeadTimeDays: Math.round(avgLeadTime * 10) / 10,
    },
    details,
  };
}
