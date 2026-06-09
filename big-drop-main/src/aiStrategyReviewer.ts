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

const similarBacktestPatterns = await pool.query(
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

const stats = similarBacktestPatterns.rows[0];

const tradesAnalyzed =
  Number(stats.trades_analyzed);

const winnerAtr =
  Number(stats.winners_avg_atr_ratio);

const loserAtr =
  Number(stats.losers_avg_atr_ratio);

const atrEffect =
  Number(stats.atr_effect_percent);


const confidence =
  Math.round(
    Math.min(
      95,
      (
        Math.min(tradesAnalyzed, 1000) / 1000
      ) * 70
      +
      Math.min(
        Math.abs(atrEffect),
        50
      ) / 50 * 25
    )
  );

  similar_backtests AS (
    SELECT
      b.*,
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
    FROM market_phase_profiles b
    CROSS JOIN current_forward f
    WHERE b.symbol = $1
      AND b.strategy_version = $2
      AND b.test_type = 'BACKTEST'
    ORDER BY similarity_distance ASC
    LIMIT 10
  ),

  trades_in_similar_phases AS (
    SELECT
      e.ticket,
      e.symbol,
      e.profit,
      e.profit_r,

      r.atr_ratio,
      r.ma_distance_atr_ratio,
      r.is_trend,
      r.is_range,
      r.is_high_vol,
      r.is_low_vol,
      r.is_breakout,
      r.is_pullback,
      r.spread_pips,
      r.session,
      r.hour,

      s.volume_ratio,
      s.htf_aligned,
      s.m15_aligned,
      s.bos_pass,
      s.atr_pass,
      s.ranging_market,
      s.rr_ratio
    FROM trade_exits e
    JOIN similar_backtests p
      ON e.symbol = p.symbol
     AND e.test_type = 'BACKTEST'
     AND e.strategy_version = p.strategy_version
     AND e.exit_time::date >= p.profile_start
     AND e.exit_time::date <= p.profile_end
    LEFT JOIN market_regime_snapshots r
      ON r.ticket = e.ticket
     AND r.symbol = e.symbol
     AND r.test_type = e.test_type
     AND r.strategy_version = e.strategy_version
    LEFT JOIN trade_analyzer_setups s
      ON s.ticket = e.ticket
     AND s.symbol = e.symbol
     AND s.test_type = e.test_type
     AND s.strategy_version = e.strategy_version
  )

  SELECT
    COUNT(*) AS trades,

    AVG(atr_ratio) FILTER (WHERE profit > 0) AS winners_avg_atr_ratio,
    AVG(atr_ratio) FILTER (WHERE profit < 0) AS losers_avg_atr_ratio,

    AVG(volume_ratio) FILTER (WHERE profit > 0) AS winners_avg_volume_ratio,
    AVG(volume_ratio) FILTER (WHERE profit < 0) AS losers_avg_volume_ratio,

    AVG(ma_distance_atr_ratio) FILTER (WHERE profit > 0) AS winners_avg_trend_strength,
    AVG(ma_distance_atr_ratio) FILTER (WHERE profit < 0) AS losers_avg_trend_strength,

    AVG(spread_pips) FILTER (WHERE profit > 0) AS winners_avg_spread,
    AVG(spread_pips) FILTER (WHERE profit < 0) AS losers_avg_spread,

    AVG(rr_ratio) FILTER (WHERE profit > 0) AS winners_avg_rr,
    AVG(rr_ratio) FILTER (WHERE profit < 0) AS losers_avg_rr,

    COUNT(*) FILTER (WHERE profit > 0 AND is_trend = true) AS winning_trend_trades,
    COUNT(*) FILTER (WHERE profit < 0 AND is_trend = true) AS losing_trend_trades,

    COUNT(*) FILTER (WHERE profit > 0 AND is_range = true) AS winning_range_trades,
    COUNT(*) FILTER (WHERE profit < 0 AND is_range = true) AS losing_range_trades,

    COUNT(*) FILTER (WHERE profit > 0 AND is_high_vol = true) AS winning_high_vol_trades,
    COUNT(*) FILTER (WHERE profit < 0 AND is_high_vol = true) AS losing_high_vol_trades,

    COUNT(*) FILTER (WHERE profit > 0 AND session = 'LONDON') AS winning_london_trades,
    COUNT(*) FILTER (WHERE profit < 0 AND session = 'LONDON') AS losing_london_trades,

    COUNT(*) FILTER (WHERE profit > 0 AND session = 'NEW_YORK') AS winning_ny_trades,
    COUNT(*) FILTER (WHERE profit < 0 AND session = 'NEW_YORK') AS losing_ny_trades
  FROM trades_in_similar_phases;

SELECT

  COUNT(*) AS trades_analyzed,

  AVG(atr_ratio) FILTER (WHERE profit > 0)
    AS winners_avg_atr_ratio,

  AVG(atr_ratio) FILTER (WHERE profit < 0)
    AS losers_avg_atr_ratio,

  AVG(volume_ratio) FILTER (WHERE profit > 0)
    AS winners_avg_volume_ratio,

  AVG(volume_ratio) FILTER (WHERE profit < 0)
    AS losers_avg_volume_ratio,

  AVG(ma_distance_atr_ratio) FILTER (WHERE profit > 0)
    AS winners_avg_trend_strength,

  AVG(ma_distance_atr_ratio) FILTER (WHERE profit < 0)
    AS losers_avg_trend_strength,

  AVG(spread_pips) FILTER (WHERE profit > 0)
    AS winners_avg_spread,

  AVG(spread_pips) FILTER (WHERE profit < 0)
    AS losers_avg_spread,

  AVG(rr_ratio) FILTER (WHERE profit > 0)
    AS winners_avg_rr,

  AVG(rr_ratio) FILTER (WHERE profit < 0)
    AS losers_avg_rr,

  COUNT(*) FILTER (WHERE profit > 0)
    AS winning_trades,

  COUNT(*) FILTER (WHERE profit <= 0)
    AS losing_trades,

  (
    (
      AVG(atr_ratio) FILTER (WHERE profit > 0)
      -
      AVG(atr_ratio) FILTER (WHERE profit < 0)
    )
    /
    NULLIF(
      AVG(atr_ratio) FILTER (WHERE profit < 0),
      0
    )
  ) * 100

  AS atr_effect_percent

FROM trades_in_similar_phases;
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

Current forward market phase:
${JSON.stringify(currentForward.rows[0], null, 2)}

Most similar backtest phases:
${JSON.stringify(similarBacktests.rows, null, 2)}

Winner vs loser characteristics inside the most similar backtest phases:
${JSON.stringify(similarBacktestPatterns.rows[0], null, 2)}

Winner vs loser statistics:
${JSON.stringify(stats, null, 2)}

Reliability metrics:

Confidence = ${confidence}%

Trades analyzed = ${tradesAnalyzed}

Winner ATR = ${winnerAtr}

Loser ATR = ${loserAtr}

ATR Effect Size = ${atrEffect.toFixed(1)}%

Use these metrics when making recommendations.

Do not suggest changing a parameter unless:
- confidence > 70
- at least 100 trades analyzed
- effect size > 15%

Explain:
1. Which backtest phases are most similar to the current forward phase.
2. Which market characteristics made winners different from losers.
3. Which filters should be tightened or loosened.
4. Which parameters should be changed and why.
5. Give concrete values if the data supports it.


Use only the provided database-derived evidence.
Do not invent patterns.
If evidence is weak, say confidence LOW.

Return ONLY valid JSON.
No markdown.
Do not wrap the answer in a code block.

Example shape:
{
  "marketRegime": "UNKNOWN",
  "keyPatterns": [],
  "detectedErrors": [],
  "confidence": 82,
  "trades_analyzed": 740,

  "similar_backtest_phase": "Phase 17",
  "similarity_score": 0.91,

  "winner_atr_ratio": 1.38,
  "loser_atr_ratio": 0.95,
  "atr_effect_percent": 45.3,

  "winner_volume_ratio": 1.62,
  "loser_volume_ratio": 1.11,
  "volume_effect_percent": 45.9,

  "winner_trend_strength": 1.43,
  "loser_trend_strength": 0.88,
  "trend_effect_percent": 62.5,

  "winner_spread": 0.9,
  "loser_spread": 2.1,
  "spread_effect_percent": -57.1,

  "winning_london_trades": 241,
  "losing_london_trades": 102,

  "winning_newyork_trades": 193,
  "losing_newyork_trades": 171,

  "recommended_changes": [
    {
      "parameter": "ATR_FILTER",
      "current": 1.0,
      "recommended": 1.2,
      "confidence": 84,
      "reason": "Winner ATR ratio significantly higher than loser ATR ratio."
    },
    {
      "parameter": "VOLUME_FILTER",
      "current": 1.1,
      "recommended": 1.4,
      "confidence": 81,
      "reason": "Winning trades occurred in higher relative volume environments."
    }
  ],

  "market_explanation": "...",
  "strategy_summary": "...",
  "risk_level": "MEDIUM"
}

Allowed marketRegime values:
TREND, RANGE, HIGH_VOL, LOW_VOL, BREAKOUT, MIXED, UNKNOWN

Allowed riskLevel values:
LOW, MEDIUM, HIGH

Allowed confidence values:
LOW, MEDIUM, HIGH

DATA:
${JSON.stringify(context, null, 2)}
`;

function cleanAiJson(text: string) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

const aiResponse = await callAi(prompt);

let parsed: any;

try {
  parsed = JSON.parse(cleanAiJson(aiResponse));
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

