/** Fixed bar thickness for every analytics pill bar chart (matches Tracking Status Breakdown). */
export const ANALYTICS_BAR_SIZE = 28;

/** Vertical chart height for standard column / status breakdown charts. */
export const ANALYTICS_VERTICAL_CHART_HEIGHT = 250;

/** Per-row pitch for horizontal bar charts (28px bar + padding). */
export const ANALYTICS_HORIZONTAL_ROW_PITCH = 48;

/** Minimum height for horizontal bar chart containers. */
export const ANALYTICS_HORIZONTAL_CHART_MIN_HEIGHT = 120;

export function analyticsHorizontalChartHeight(rowCount: number): number {
  return Math.max(
    ANALYTICS_HORIZONTAL_CHART_MIN_HEIGHT,
    rowCount * ANALYTICS_HORIZONTAL_ROW_PITCH,
  );
}
