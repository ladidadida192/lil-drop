import { pool } from "./db";

export async function getMarketContext(symbol: string) {
  const result = await pool.query(
    `
    WITH recent_trades AS (
      SELECT *
      FROM trade_exits
      WHERE symbol = $1
      ORDER BY exit_time DESC
      LIMIT 50
    ),

    perf AS (
      SELECT
        COUNT(*)::int AS trades,
        COALESCE(SUM(profit), 0) AS total_profit,
        COALESCE(AVG(profit), 0) AS avg_profit,
        COALESCE(AVG(profit_r), 0) AS avg_profit_r,
        COALESCE(
          ROUND(
            COUNT(*) FILTER (WHERE profit > 0)::numeric 
            / NULLIF(COUNT(*)::numeric, 0) * 100,
            2
          ),
          0
        ) AS winrate
      FROM recent_trades
    ),

    latest_regime AS (
      SELECT *
      FROM market_phase_profiles
      WHERE symbol = $1
      ORDER BY profile_end DESC
      LIMIT 1
    ),

    latest_daily AS (
      SELECT *
      FROM daily_reports
      WHERE symbol = $1
      ORDER BY report_date DESC
      LIMIT 1
    ),

    execution AS (
      SELECT
        COALESCE(AVG(spread_pips), 0) AS avg_spread,
        COALESCE(MAX(spread_pips), 0) AS max_spread,
        COUNT(*) FILTER (WHERE spread_spike = true)::int AS spread_spikes,
        COUNT(*) FILTER (WHERE execution_problem = true)::int AS execution_errors
      FROM execution_diagnostics
      WHERE symbol = $1
        AND diagnostic_time > NOW() - INTERVAL '7 days'
    )

    SELECT
      row_to_json(perf) AS performance,
      row_to_json(latest_regime) AS regime,
      row_to_json(latest_daily) AS daily_report,
      row_to_json(execution) AS execution
    FROM perf, latest_regime, latest_daily, execution;
    `,
    [symbol]
  );

  return result.rows[0];
}