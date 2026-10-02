export interface RadarEvidence {
  conceptId: string;
  masteryScore: number;
  masteryState: string;
  evidenceCount: number;
  confidenceScore?: number;
  assessedStudentCount?: number;
}
export interface RadarContent {
  id: string;
  label: string;
}
export interface RadarAxis extends RadarContent {
  score: number | null;
  evidenceCount: number;
  confidence: number | null;
  assessedStudentCount?: number;
}

export interface CourseMasterySummary {
  studentCount: number;
  assessedStudentCount: number;
  records: RadarEvidence[];
}

/** Each assessed student has equal weight; missing evidence never lowers the mean. */
export function aggregateRadarEvidence(students: RadarEvidence[][]): CourseMasterySummary {
  const totals = new Map<string, { score: number; count: number; evidence: number }>();
  let assessedStudentCount = 0;
  for (const records of students) {
    const unique = new Map(records.map((item) => [item.conceptId, item]));
    let assessed = false;
    for (const item of unique.values()) {
      if (!hasEvidence(item)) continue;
      assessed = true;
      const total = totals.get(item.conceptId) ?? { score: 0, count: 0, evidence: 0 };
      total.score += item.masteryScore;
      total.count++;
      total.evidence += item.evidenceCount;
      totals.set(item.conceptId, total);
    }
    if (assessed) assessedStudentCount++;
  }
  return {
    studentCount: students.length,
    assessedStudentCount,
    records: [...totals].map(([conceptId, total]) => ({
      conceptId,
      masteryScore: Math.round((total.score / total.count) * 10) / 10,
      masteryState: "AGGREGATED",
      evidenceCount: total.evidence,
      assessedStudentCount: total.count,
    })),
  };
}

function hasEvidence(item: RadarEvidence): boolean {
  return (
    item.masteryState !== "NOT_OBSERVED" &&
    Number.isInteger(item.evidenceCount) &&
    item.evidenceCount > 0 &&
    Number.isFinite(item.masteryScore) &&
    item.masteryScore >= 0 &&
    item.masteryScore <= 100
  );
}

/** Missing evidence is unknown, including NOT_OBSERVED records with a stored zero. */
export function radarAxes(contents: RadarContent[], records: RadarEvidence[]): RadarAxis[] {
  const names = new Map(contents.map((item) => [item.id, item.label]));
  const evidence = new Map(records.map((item) => [item.conceptId, item]));
  for (const item of records) {
    if (!names.has(item.conceptId))
      names.set(item.conceptId, `Nội dung đã ghi nhận ${String(names.size + 1)}`);
  }
  return [...names].map(([id, label]) => {
    const item = evidence.get(id);
    const observed = item && hasEvidence(item);
    return {
      id,
      label,
      score: observed ? Math.round(item.masteryScore * 10) / 10 : null,
      evidenceCount: observed ? item.evidenceCount : 0,
      confidence: observed && typeof item.confidenceScore === "number" ? item.confidenceScore : null,
      ...(item?.assessedStudentCount === undefined
        ? {}
        : { assessedStudentCount: item.assessedStudentCount }),
    };
  });
}

/** Groups stay within eight axes and avoid a trailing group with only one or two axes. */
export function radarGroups(axes: RadarAxis[]): RadarAxis[][] {
  const groups: RadarAxis[][] = [];
  for (let start = 0; start < axes.length;) {
    const remaining = axes.length - start;
    const size = remaining === 7 || remaining === 8 ? remaining : Math.min(6, remaining);
    groups.push(axes.slice(start, start + size));
    start += size;
  }
  return groups;
}
export function radarPoint(index: number, count: number, percent = 100) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const radius = (106 * percent) / 100;
  return { x: 160 + Math.cos(angle) * radius, y: 160 + Math.sin(angle) * radius };
}

/** Draw only edges backed by two measured values; unknown axes never become zero scores. */
export function radarEdges(axes: RadarAxis[]) {
  return axes.flatMap((axis, index) => {
    const next = axes[(index + 1) % axes.length];
    return axis.score !== null && next?.score !== null && next
      ? [
          {
            from: radarPoint(index, axes.length, axis.score),
            to: radarPoint((index + 1) % axes.length, axes.length, next.score),
          },
        ]
      : [];
  });
}
