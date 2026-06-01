import { pool } from "./db.js";
import { callAi } from "./aiClient.js";

export async function getAiDecisionContext(symbol: string, strategyVersion: string) {
  const recentTrades = await pool.query(
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
        COUNT(*) FILTER (WHERE e.profit > 0)::numeric / NULLIF(COUNT(*), 0) * 100,
        2
      ) AS winrate
    FROM trade_exits e
    LEFT JOIN trade_analyzer_setups s ON s.ticket = e.ticket
    WHERE e.symbol = $1
      AND e.strategy_version = $2
      AND e.test_type IN ('FORWARD', 'LIVE')
    GROUP BY s.session
    ORDER BY avg_profit_r DESC
    `,
    [symbol, strategyVersion]
  );

  const exitReasonBreakdown = await pool.query(
    `
    SELECT
      exit_reason,
      COUNT(*)::int AS trades,
      AVG(profit_r) AS avg_profit_r,
      SUM(profit) AS total_profit,
      ROUND(
        COUNT(*) FILTER (WHERE profit > 0)::numeric / NULLIF(COUNT(*), 0) * 100,
        2
      ) AS winrate
    FROM trade_exits
    WHERE symbol = $1
      AND strategy_version = $2
      AND test_type IN ('FORWARD', 'LIVE')
    GROUP BY exit_reason
    ORDER BY avg_profit_r DESC
    `,
    [symbol, strategyVersion]
  );

  const executionProblems = await pool.query(
    `
    SELECT
      event_type,
      execution_problem,
      entry_problem,
      execution_error_message,
      COUNT(*)::int AS count,
      AVG(spread_pips) AS avg_spread,
      AVG(slippage_pips) AS avg_slippage
    FROM execution_diagnostics
    WHERE symbol = $1
      AND strategy_version = $2
      AND test_type IN ('FORWARD', 'LIVE')
    GROUP BY event_type, execution_problem, entry_problem, execution_error_message
    ORDER BY count DESC
    LIMIT 20
    `,
    [symbol, strategyVersion]
  );

  return {
    symbol,
    strategyVersion,
    recentTrades: recentTrades.rows,
    currentForwardProfile: currentForwardProfile.rows[0] ?? null,
    similarBacktestProfiles: similarBacktests.rows,
    sessionBreakdown: sessionBreakdown.rows,
    exitReasonBreakdown: exitReasonBreakdown.rows,
    executionProblems: executionProblems.rows,
  };
}

export async function reviewStrategyWithAi(symbol: string, strategyVersion: string) {
  const context = await getAiDecisionContext(symbol, strategyVersion);

  const prompt = `
You are analyzing an automated MT4 trading strategy.

Use only the provided database-derived evidence.
Do not invent patterns.
If evidence is weak, say confidence LOW.

Return JSON only:

{
  "marketRegime": "TREND" | "RANGE" | "HIGH_VOL" | "LOW_VOL" | "BREAKOUT" | "MIXED" | "UNKNOWN",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "keyPatterns": [
    {
      "pattern": string,
      "evidence": string,
      "importance": "LOW" | "MEDIUM" | "HIGH"
    }
  ],
  "detectedErrors": [
    {
      "error": string,
      "evidence": string,
      "severity": "LOW" | "MEDIUM" | "HIGH"
    }
  ],
  "suggestedChanges": [
    {
      "parameterOrRule": string,
      "suggestedChange": string,
      "why": string,
      "expectedEffect": string,
      "risk": string
    }
  ],
  "reasoningSummary": string
}

DATA:
${JSON.stringify(context, null, 2)}
`;

  const aiResponse = await callAi(prompt);

  let parsed: any;

  try {
    parsed = JSON.parse(aiResponse);
  } catch {
    parsed = {
      marketRegime: "UNKNOWN",
      riskLevel: "HIGH",
      confidence: "LOW",
      keyPatterns: [],
      detectedErrors: [
        {
          error: "AI_RESPONSE_NOT_VALID_JSON",
          evidence: aiResponse.slice(0, 1000),
          severity: "HIGH",
        },
      ],
      suggestedChanges: [],
      reasoningSummary: "AI response could not be parsed as JSON.",
    };
  }

  await pool.query(
    `
    INSERT INTO ai_strategy_reviews (
      symbol,
      strategy_version,
      market_regime,
      risk_level,
      confidence,
      key_patterns,
      detected_errors,
      suggested_changes,
      reasoning_summary,
      raw_response
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      symbol,
      strategyVersion,
      parsed.marketRegime,
      parsed.riskLevel,
      parsed.confidence,
      JSON.stringify(parsed.keyPatterns ?? []),
      JSON.stringify(parsed.detectedErrors ?? []),
      JSON.stringify(parsed.suggestedChanges ?? []),
      parsed.reasoningSummary ?? "",
      JSON.stringify(parsed),
    ]
  );

  return parsed;
}