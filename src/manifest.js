// The run manifest: what each tool actually did on this corner.
//
// Every number in here is a real count taken from a payload the pipeline
// produced. Nothing is estimated, and a stage that did not run says so with a
// reason rather than reporting a zero that reads like a result. That rule is
// what makes the replay worth watching: a log that invents its own numbers is
// an animation, and an animation proves nothing.
//
// The manifest is assembled from lanes that have already been computed and
// cached, so writing one costs no upstream calls beyond what the page already
// made. The single exception is Apify, which is never called at request time:
// its counts are backfilled offline from the stored datasets and read from KV.

export const MANIFEST_VERSION = "v1";

// Triggers a caller may claim. "cron" is deliberately absent: it is the only
// label that makes a claim about the product rather than about a corner, and
// letting a query parameter set it would let anyone forge an autonomous run.
// The scheduled handler passes it directly, in process, and nothing else can.
export const PUBLIC_TRIGGERS = new Set(["user", "precompute"]);

const int = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function buildManifest({ slug, trigger, stats, news, timeline, voices, apify, hazards, score, letterRun, supervisor }) {
  const stages = {};

  stages.stats = stats
    ? {
        ran: true,
        collisions5y: int(stats.crashes),
        fatal: int(stats.fatal),
        reports311Filtered: int(stats.reports311),
        // The unfiltered figure is the one this product got wrong in public
        // once, so the manifest carries both and the difference is visible.
        // Null rather than zero when it was not measured on this run.
        reports311Raw: stats.reports311Raw ?? null,
        district: stats.district ?? null,
        source: stats.source || null,
      }
    : { ran: false, reason: "stats lane unavailable" };

  if (news && !news.failed) {
    const items = news.items || [];
    const dates = items.map((i) => i.date).filter(Boolean).sort();
    stages.exa = {
      ran: true,
      queried: true,
      // What Exa returned before this product touched it, carried on the news
      // payload itself so it survives caching. Null on a sample payload, where
      // no search happened and a number would be a fiction.
      found: news.found ?? null,
      afterFilters: news.afterFilters ?? null,
      kept: items.length,
      cornerLevel: items.filter((i) => i.corner).length,
      officialSources: items.filter((i) => i.official).length,
      precise: Boolean(news.precise),
      newestDate: dates[dates.length - 1] || null,
      oldestDate: dates[0] || null,
      source: news.source || null,
    };
  } else {
    stages.exa = { ran: false, reason: news?.failed || "press lane unavailable" };
  }

  // The year strip, read from storage. Phrased as coverage-we-can-find at every
  // layer including this one, because Exa recall is not ground truth and a
  // manifest that hardened it into "first reported" would be the place the
  // overclaim entered the product.
  stages.timeline = timeline?.years
    ? {
        ran: true,
        searches: timeline.calls ?? timeline.years.length,
        from: timeline.from,
        to: timeline.to,
        firstFoundYear: timeline.firstReportedYear ?? null,
        yearsCovered: timeline.yearsReported ?? null,
        totalHeadlines: int(timeline.totalHeadlines),
        failedYears: timeline.failedYears || [],
      }
    : { ran: false, reason: "no press history has been built for this corner" };

  // Apify is the one stage that cannot be recomputed cheaply, so an absent
  // backfill is reported as absent. Guessing here would be the exact failure
  // this whole file exists to prevent.
  if (apify && !apify.countsUnavailable) {
    stages.apify = {
      ran: true,
      itemsRead: int(apify.itemsRead),
      // Two separate narrowings, because collapsing them hides which one is
      // doing the work. A Reddit search for a street name returns comments from
      // Santa Barbara and Astoria that use the word crosswalk, so "read" and
      // "about this corner" are very different numbers and the gap is the story.
      aboutCorner: int(apify.aboutCorner),
      streetRelevant: int(apify.streetRelevant),
      kept: int(apify.kept ?? (voices?.items || []).length),
      themes: apify.themes || {},
      datasets: apify.datasets || [],
      collected: apify.collected || null,
      ...(apify.partial ? { partial: true, reason: apify.reason } : {}),
    };
  } else if (apify?.countsUnavailable) {
    stages.apify = {
      ran: true,
      countsUnavailable: true,
      reason: apify.reason || "the stored Apify datasets are no longer retrievable",
      kept: (voices?.items || []).length,
    };
  } else {
    stages.apify = {
      ran: false,
      reason: voices?.source === "empty"
        ? "no scrape exists for this corner"
        : "no Apify counts have been backfilled for this corner",
      kept: (voices?.items || []).length,
    };
  }

  stages.vision = hazards?.skipped
    ? { ran: false, reason: hazards.skipped }
    : hazards
    ? {
        ran: true,
        audited: Boolean(hazards.audited),
        zonesFlagged: (hazards.items || []).filter((i) => i.verdict !== "REPORTED").length,
        labels: (hazards.items || []).map((i) => i.label),
        confirmed: int(hazards.confirmed),
        candidate: int(hazards.candidates),
        reported: int(hazards.reported),
      }
    : { ran: false, reason: "visual audit unavailable" };

  stages.index = score
    ? {
        ran: true,
        points: score.points,
        collisionPoints: score.collisionPoints ?? null,
        maintenanceSignal: score.maintenanceSignal ?? null,
        percentile: score.index,
        grade: score.grade,
        sampleSize: score.sampleSize ?? null,
      }
    : { ran: false, reason: "index unavailable" };

  // Recorded when the letter was actually drafted, listing the lanes that
  // genuinely reached the prompt rather than the lanes that happened to exist.
  // A letter written without press coverage must not claim press as an input.
  stages.letter = letterRun?.generatedAt
    ? {
        ran: true,
        inputs: letterRun.inputs || [],
        supervisor: letterRun.supervisor || supervisor || null,
        model: letterRun.model || null,
        generatedAt: letterRun.generatedAt,
      }
    : { ran: false, reason: "no letter has been drafted for this corner yet", inputs: [] };

  return { version: MANIFEST_VERSION, slug, ranAt: new Date().toISOString(), trigger, stages };
}
