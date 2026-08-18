// The projection engine. Deterministic arithmetic over the curated CMF table
// and the corner's own crash counts. No model, no fitting, no cleverness.
//
// The honesty rails, enforced in code rather than remembered:
//
//   1. CMFs never multiply. Stacking factors assumes independence nobody has
//      demonstrated, so the combined view shows the single most conservative
//      factor and says exactly that.
//   2. Ranges, never points. Every published factor here carries a standard
//      error; the projection is the count against CMF +/- one SE, rounded
//      outward, so the range is honest about the uncertainty the study itself
//      reported.
//   3. An intervention without a high-quality factor projects nothing. The row
//      renders its reason instead, because "no good evidence isolates this
//      treatment" is a finding, not a gap to paper over.
//   4. Every projection is labeled a projection from published national
//      research, not a promise about this corner. The label is part of the
//      payload so no renderer can forget it.

export const IMPACT_VERSION = "v1";

export const IMPACT_LABEL =
  "Projections from published national research (FHWA CMF Clearinghouse). Not a promise about this corner.";

export const NO_MULTIPLY_SENTENCE =
  "Factors are never multiplied together: combining them assumes independence no study has demonstrated, so the combined view shows only the single most conservative factor.";

// Which of the corner's counted crash subsets a factor applies to. The only
// crash type in the current table is vehicle/pedestrian, which maps to the
// score's pedestrian-involved count (ped_action recorded, within 80m, 5y).
function basisFor(crashType, counts) {
  if (crashType === "vehicle/pedestrian") {
    return {
      count: counts?.ped ?? 0,
      text: `${counts?.ped ?? 0} pedestrian-involved collisions within 80m in 5 years`,
    };
  }
  return null;
}

const round1 = (n) => Math.round(n * 10) / 10;

export function projectImpact(counts, cmfTable) {
  const rows = [];
  for (const item of cmfTable?.interventions || []) {
    if (item.cmf == null) {
      rows.push({
        intervention: item.intervention,
        hasFactor: false,
        reason: item.notes || "No high-quality published factor.",
        cmfUrl: item.sourceUrl,
      });
      continue;
    }
    const basis = basisFor(item.crashTypesApplied, counts);
    if (!basis) {
      rows.push({
        intervention: item.intervention,
        hasFactor: false,
        reason: `The published factor applies to ${item.crashTypesApplied} crashes, which this corner's counts do not isolate.`,
        cmfUrl: item.sourceUrl,
      });
      continue;
    }
    const se = item.standardError ?? 0;
    // CMF +/- one SE, reduction = count * (1 - cmf). Low end of the CMF is the
    // high end of the reduction; both rounded outward to one decimal.
    const lo = round1(basis.count * (1 - Math.min(1, item.cmf + se)));
    const hi = round1(basis.count * (1 - Math.max(0, item.cmf - se)));
    rows.push({
      intervention: item.intervention,
      hasFactor: true,
      basis: basis.text,
      basisCount: basis.count,
      cmf: item.cmf,
      starRating: item.starRating,
      factorText: `CMF ${item.cmf} (${item.starRating} star${item.starRating === 1 ? "" : "s"}, id ${item.cmfClearinghouseId})`,
      projectedRange:
        basis.count === 0
          ? "no applicable collisions recorded, so nothing to project"
          : `roughly ${Math.max(0, lo)} to ${hi} fewer ${item.crashTypesApplied} collisions over a comparable 5 years`,
      cmfUrl: item.sourceUrl,
      notes: item.notes || "",
    });
  }

  // The combined view: the single most conservative factor (highest CMF, i.e.
  // the smallest claimed reduction) among those that actually projected.
  const withFactor = rows.filter((r) => r.hasFactor && r.basisCount > 0);
  const conservative = withFactor.length
    ? withFactor.reduce((a, b) => (a.cmf > b.cmf ? a : b))
    : null;

  return {
    source: "live",
    version: IMPACT_VERSION,
    label: IMPACT_LABEL,
    noMultiply: NO_MULTIPLY_SENTENCE,
    lastReviewed: cmfTable?.lastReviewed || null,
    rows,
    combined: conservative
      ? {
          intervention: conservative.intervention,
          projectedRange: conservative.projectedRange,
          factorText: conservative.factorText,
          sentence:
            `Taken together, the honest combined claim is the most conservative single factor, ` +
            `${conservative.intervention} (${conservative.factorText}): ${conservative.projectedRange}. ` +
            NO_MULTIPLY_SENTENCE,
        }
      : null,
  };
}
