import { pool } from "./db.js";
import { callAi } from "./aiClient.js";

export async function runDriftCheck(symbol: string, strategyVersion: string) {
  const result = await pool.query(
    `
    WITH recent AS (
      SELECT *
      FROM trade_exits
      WHERE symbol = $1
        AND strategy_version = $2
        AND test_type IN ('FORWARD', 'LIVE')
      ORDER BY exit_time DESC
      LIMIT 60
    ),

    w30 AS (
      SELECT
        COUNT(*) AS trades_30,
        ROUND(
          COUNT(*) FILTER (WHERE profit > 0)::numeric / NULLIF(COUNT(*),0) * 100,
          2
        ) AS winrate_30
      FROM (
        SELECT *
        FROM recent
        ORDER BY exit_time DESC
        LIMIT 30
      ) x
    ),

    w60 AS (
      SELECT
        COUNT(*) AS trades_60,
        ROUND(
          COUNT(*) FILTER (WHERE profit > 0)::numeric / NULLIF(COUNT(*),0) * 100,
          2
        ) AS winrate_60
      FROM recent
    )

    INSERT INTO drift_alerts (
      symbol,
      strategy_version,
      trades_30,
      winrate_30,
      trades_60,
      winrate_60,
      drift_level,
      change_required,
      reason
    )
    SELECT
      $1,
      $2,
      w30.trades_30,
      w30.winrate_30,
      w60.trades_60,
      w60.winrate_60,

      CASE
        WHEN w30.trades_30 < 30 THEN 'NOT_ENOUGH_DATA'
        WHEN w30.winrate_30 < 35 AND w60.winrate_60 < 40 THEN 'CRITICAL'
        WHEN w30.winrate_30 < 40 AND w60.winrate_60 < 45 THEN 'HIGH'
        WHEN w30.winrate_30 < 45 THEN 'MEDIUM'
        ELSE 'LOW'
      END AS drift_level,

      CASE
        WHEN w30.trades_30 >= 30
         AND w30.winrate_30 < 40
         AND w60.winrate_60 < 45
        THEN true
        ELSE false
      END AS change_required,

      CASE
        WHEN w30.trades_30 < 30 THEN 'Not enough forward trades yet.'
        WHEN w30.winrate_30 < 35 AND w60.winrate_60 < 40 THEN 'Critical winrate decay over 30 and 60 trades.'
        WHEN w30.winrate_30 < 40 AND w60.winrate_60 < 45 THEN 'Sustained winrate below acceptable threshold.'
        WHEN w30.winrate_30 < 45 THEN 'Short-term winrate weakness detected.'
        ELSE 'No active drift detected.'
      END AS reason

    FROM w30, w60
    RETURNING *;
    `,
    [symbol, strategyVersion]
  );

  return result.rows[0];
}

export async function getDriftAiContext(symbol: string, strategyVersion: string, driftAlertId: number) {
  const driftAlert = await pool.query(
    `
    SELECT *
    FROM drift_alerts
    WHERE id = $1
    `,
    [driftAlertId]
  );

  const last100Trades = await pool.query(
    `
    SELECT *
    FROM trade_exits
    WHERE symbol = $1
      AND strategy_version = $2
      AND test_type IN ('FORWARD', 'LIVE')
    ORDER BY exit_time DESC
    LIMIT 100
    `,
    [symbol, strategyVersion]
  );

  const currentForwardProfile = await pool.query(
    `
    SELECT *
    FROM market_phase_profiles
    WHERE symbol = $1
      AND strategy_version = $2
      AND test_type IN ('FORWARD', 'LIVE')
    ORDER BY profile_end DESC
    LIMIT 1
    `,
    [symbol, strategyVersion]
  );

  const similarBacktests = await pool.query(
    `
    WITH current_forward AS (
      SELECT *
      FROM market_phase_profiles
      WHERE symbol = $1
        AND strategy_version = $2
        AND test_type IN ('FORWARD', 'LIVE')
      ORDER BY profile_end DESC
      LIMIT 1
    ),
    backtest_profiles AS (
      SELECT *
      FROM market_phase_profiles
      WHERE symbol = $1
        AND strategy_version = $2
        AND test_type = 'BACKTEST'
    )
    SELECT
      b.profile_start,
      b.profile_end,
      b.phase_label,
      b.trades,
      b.winrate,
      b.profit_factor,
      b.total_profit,
      b.avg_profit_r,

      SQRT(
        POWER(b.trend_ratio - f.trend_ratio, 2) +
        POWER(b.range_ratio - f.range_ratio, 2) +
        POWER(b.high_vol_ratio - f.high_vol_ratio, 2) +
        POWER(b.low_vol_ratio - f.low_vol_ratio, 2) +
        POWER(b.breakout_ratio - f.breakout_ratio, 2) +
        POWER(b.avg_atr_ratio - f.avg_atr_ratio, 2) +
        POWER(b.avg_trend_strength - f.avg_trend_strength, 2) +
        POWER(b.avg_volume_ratio - f.avg_volume_ratio, 2)
      ) AS similarity_distance
    FROM backtest_profiles b
    CROSS JOIN current_forward f
    ORDER BY similarity_distance ASC
    LIMIT 10
    `,
    [symbol, strategyVersion]
  );

  const sessionBreakdown = await pool.query(
    `
    SELECT
      s.session,
      COUNT(*)::int AS trades,
      AVG(e.profit_r) AS avg_profit_r,
      SUM(e.profit) AS total_profit,
      ROUND(
        COUNT(*) FILTER (WHERE e.profit > 0)::numeric / NULLIF(COUNT(*),0) * 100,
        2
      ) AS winrate
    FROM trade_exits e
    LEFT JOIN trade_analyzer_setups s ON s.ticket = e.ticket
    WHERE e.symbol = $1
      AND e.strategy_version = $2
      AND e.test_type IN ('FORWARD', 'LIVE')
    GROUP BY s.session
    ORDER BY avg_profit_r ASC
    `,
    [symbol, strategyVersion]
  );

  const regimeBreakdown = await pool.query(
    `
    SELECT
      r.is_trend,
      r.is_range,
      r.is_high_vol,
      r.is_low_vol,
      r.is_breakout,
      r.is_pullback,
      COUNT(*)::int AS trades,
      AVG(e.profit_r) AS avg_profit_r,
      SUM(e.profit) AS total_profit,
      ROUND(
        COUNT(*) FILTER (WHERE e.profit > 0)::numeric / NULLIF(COUNT(*),0) * 100,
        2
      ) AS winrate
    FROM trade_exits e
    LEFT JOIN market_regime_snapshots r ON r.ticket = e.ticket
    WHERE e.symbol = $1
      AND e.strategy_version = $2
      AND e.test_type IN ('FORWARD', 'LIVE')
    GROUP BY
      r.is_trend,
      r.is_range,
      r.is_high_vol,
      r.is_low_vol,
      r.is_breakout,
      r.is_pullback
    ORDER BY avg_profit_r ASC
    LIMIT 20
    `,
    [symbol, strategyVersion]
  );

  const exitBreakdown = await pool.query(
    `
    SELECT
      exit_reason,
      COUNT(*)::int AS trades,
      AVG(profit_r) AS avg_profit_r,
      SUM(profit) AS total_profit,
      ROUND(
        COUNT(*) FILTER (WHERE profit > 0)::numeric / NULLIF(COUNT(*),0) * 100,
        2
      ) AS winrate
    FROM trade_exits
    WHERE symbol = $1
      AND strategy_version = $2
      AND test_type IN ('FORWARD', 'LIVE')
    GROUP BY exit_reason
    ORDER BY avg_profit_r ASC
    `,
    [symbol, strategyVersion]
  );

  return {
    symbol,
    strategyVersion,
    driftAlert: driftAlert.rows[0],
    currentForwardProfile: currentForwardProfile.rows[0] ?? null,
    similarBacktestProfiles: similarBacktests.rows,
    sessionBreakdown: sessionBreakdown.rows,
    regimeBreakdown: regimeBreakdown.rows,
    exitBreakdown: exitBreakdown.rows,
    last100Trades: last100Trades.rows,
  };
}

export async function runAiDriftReview(symbol: string, strategyVersion: string, driftAlertId: number) {
  const context = await getDriftAiContext(symbol, strategyVersion, driftAlertId);

  const prompt = `
You are analyzing an automated MT4 trading strategy.

The system has already detected possible active strategy drift using winrate rules.
Your job is NOT to decide whether drift exists.
Your job is to diagnose likely causes and propose cautious actions.

Use only the evidence provided.
Do not invent missing data.
If the evidence is weak, set confidence LOW.

Return JSON only:

{
  "diagnosis": string,
  "mainCause": string,
  "urgency": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "suggestedActions": [
    {
      "action": string,
      "why": string,
      "risk": string,
      "priority": "LOW" | "MEDIUM" | "HIGH"
    }
  ],
  "reasoningSummary": string
}

DATA:
${JSON.stringify(context, null, 2)}
`;

  const aiText = await callAi(prompt);

  let parsed: any;

  try {
    parsed = JSON.parse(aiText);
  } catch {
    parsed = {
      diagnosis: "AI response could not be parsed.",
      mainCause: "UNKNOWN",
      urgency: "MEDIUM",
      confidence: "LOW",
      suggestedActions: [],
      reasoningSummary: aiText.slice(0, 1500),
    };
  }

  await pool.query(
    `
    INSERT INTO ai_drift_reviews (
      symbol,
      strategy_version,
      drift_alert_id,
      diagnosis,
      main_cause,
      urgency,
      confidence,
      suggested_actions,
      reasoning_summary,
      raw_response
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      symbol,
      strategyVersion,
      driftAlertId,
      parsed.diagnosis ?? "",
      parsed.mainCause ?? "",
      parsed.urgency ?? "MEDIUM",
      parsed.confidence ?? "LOW",
      JSON.stringify(parsed.suggestedActions ?? []),
      parsed.reasoningSummary ?? "",
      JSON.stringify(parsed),
    ]
  );

  return parsed;
}

export async function runAutomatedDriftSystem(symbol: string, strategyVersion: string) {
  const alert = await runDriftCheck(symbol, strategyVersion);

  if (!alert.change_required) {
    return {
      driftAlert: alert,
      aiReview: null,
      message: "No urgent setup change required.",
    };
  }

  const aiReview = await runAiDriftReview(symbol, strategyVersion, alert.id);

  return {
    driftAlert: alert,
    aiReview,
    message: "Setup change required. AI drift review generated.",
  };
}