import type {
  DiagnosticMetric,
  DiagnosticResult,
} from "../contracts/diagnostics";

const palettes = ["#7542b0", "#aa85d5", "#d59b43", "#c05f7f", "#9395a7"];
const seriesByCategory = {
  industry_ranking: ["mention", "recommend", "top3", "top5"],
  competitor_comparison: ["subject", "competitor", "balanced", "unspecified"],
  reputation: ["positive", "neutral", "negative", "mixed", "unknown"],
  product_scenario: ["coverage", "supported"],
};
const chartTitles = {
  industry_ranking: "各平台的提及与推荐",
  competitor_comparison: "回答明确偏好分布",
  reputation: "本轮口碑表达分布",
  product_scenario: "各平台的知识表达",
};

export function DiagnosticCharts({
  result,
  onDrilldown,
}: {
  result: DiagnosticResult;
  onDrilldown: (id: string) => void;
}) {
  const category = result.assessment.category;
  const series = seriesByCategory[category];
  const isDistribution =
    category === "reputation" || category === "competitor_comparison";
  const metrics = result.metrics.filter((metric) => series.includes(metric.id));
  const valueLabel = (metric: DiagnosticMetric) =>
    metric.value === null
      ? "暂无数据"
      : `${metric.value}%${metric.numerator !== undefined ? ` · ${metric.numerator}/${metric.denominator}` : ""}`;
  return (
    <section className="bd-chart-panel" aria-label={chartTitles[category]}>
      <header>
        <h4>{chartTitles[category]}</h4>
        <p>点击图形查看对应回答，平台明细列于下表。</p>
      </header>
      {isDistribution && (
        <>
          <div
            className="bd-stacked-chart"
            role="group"
            aria-label="全部有效回答分布"
          >
            {metrics
              .filter((metric) => metric.value !== null && metric.value > 0)
              .map((metric) => (
                <button
                  key={metric.id}
                  onClick={() => onDrilldown(metric.id)}
                  aria-label={`${metric.label} ${valueLabel(metric)}`}
                  style={{
                    flex: metric.value!,
                    background: palettes[series.indexOf(metric.id)],
                  }}
                >
                  {metric.value! >= 10 ? `${metric.value}%` : ""}
                </button>
              ))}
            {!result.samples && <span>暂无有效回答</span>}
          </div>
          <div className="bd-chart-legend">
            {metrics.map((metric) => (
              <button key={metric.id} onClick={() => onDrilldown(metric.id)}>
                <i
                  style={{ background: palettes[series.indexOf(metric.id)] }}
                />
                {metric.label}
                <strong>{valueLabel(metric)}</strong>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="bd-platform-charts">
        {result.breakdown.platforms.map((platform) => (
          <div key={platform.id} className="bd-platform-chart">
            <h5>
              {platform.label}
              <small>有效回答 {platform.samples} 份</small>
            </h5>
            {platform.metrics
              .filter((metric) =>
                series.some((id) => metric.id.endsWith(`:${id}`)),
              )
              .map((metric) => {
                const index = series.findIndex((id) =>
                  metric.id.endsWith(`:${id}`),
                );
                return (
                  <button
                    key={metric.id}
                    onClick={() => onDrilldown(metric.id)}
                    aria-label={`${platform.label} ${metric.label} ${valueLabel(metric)}`}
                  >
                    <span>{metric.label}</span>
                    <strong>{valueLabel(metric)}</strong>
                    <span className="bd-chart-track">
                      <i
                        style={{
                          width: `${metric.value ?? 0}%`,
                          background: palettes[index],
                        }}
                      />
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </section>
  );
}
