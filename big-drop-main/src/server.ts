import fs from "fs";
import path from "path";
import express from "express";
import { Pool } from "pg";
import dotenv from "dotenv";
import { z } from "zod";
import cron from "node-cron";
import { analyzeTradingSystem } from "./aiAnalyst";
import { reviewStrategyWithAi } from "./aiStrategyReviewer.js";


const envpath = "C:/Users/janba/OneDrive/Desktop/Schule/ATS/mt4-trade-api/.env";

console.log("CURRENT WORKING DIR:", process.cwd());
console.log("SERVER FILE:", import.meta.url);
console.log("ENV PATH EXISTS:", fs.existsSync(envpath));
console.log("ENV FILE CONTENT:");
console.log(fs.readFileSync(envpath, "utf8"));

console.log("SERVER API KEY:", process.env.API_KEY);

dotenv.config({
  path: envpath,
  override: true
});

console.log("API_KEY actually used:", process.env.API_KEY);
console.log("OPENAI_API_KEY actually used:", process.env.OPENAI_API_KEY);
console.log("PORT actually used:", process.env.PORT);
console.log("DATABASE_URL loaded:", !!process.env.DATABASE_URL);



const PORT = process.env.PORT;
const API_KEY = process.env.API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  console.log("REQUEST HIT:", req.method, req.url);
  next();
});

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// API Key validation middleware
function checkApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  console.log("---- API KEY CHECK ----");

  console.log("HEADERS:", req.headers);

  const apiKey = req.header("x-api-key");
  const expectedKey = API_KEY;

  console.log("Received:", JSON.stringify(apiKey), "Length:", apiKey?.length);
  console.log("Expected:", JSON.stringify(expectedKey), "Length:", expectedKey?.length);

  if (apiKey !== expectedKey) {
    console.log("❌ UNAUTHORIZED");
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("✅ AUTHORIZED");
  next();
}

const tradeEventSchema = z.object({
  ticket: z.number().int().positive(),
  eventType: z.enum(["OPEN", "CLOSE"]),
  symbol: z.string().min(1),
  orderType: z.enum(["BUY", "SELL", "BUY_LIMIT", "SELL_LIMIT", "BUY_STOP", "SELL_STOP"]),
  lots: z.number().positive(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().optional(),
  stopLoss: z.number().nonnegative(),
  takeProfit: z.number().nonnegative(),
  profit: z.number(),
  reason: z.string().min(1),
  eventTime: z.string().datetime(),
  testType: z.enum(["BACKTEST", "FORWARD", "LIVE", "UNKNOWN"]),
strategyVersion: z.string().min(1),
});

app.post("/trade-event", checkApiKey, async (req, res) => {
  const result = tradeEventSchema.safeParse(req.body);

  if (!result.success) {
    console.log("REJECTED_TRADE_EVENT", {
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten(),
      payload: req.body
    });

    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const data = result.data;

  if (data.eventType === "OPEN" && data.exitPrice && data.exitPrice > 0) {
    console.log("REJECTED_TRADE_EVENT", {
      reason: "OPEN_TRADE_HAS_EXIT_PRICE",
      payload: data
    });

    return res.status(400).json({
      ok: false,
      reason: "OPEN_TRADE_HAS_EXIT_PRICE"
    });
  }

  await pool.query(
    `INSERT INTO trade_events (ticket, event_type, symbol, order_type, lots, entry_price, exit_price, stop_loss, take_profit, profit, reason, event_time, test_type, strategy_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [data.ticket, data.eventType, data.symbol, data.orderType, data.lots, data.entryPrice, data.exitPrice, data.stopLoss, data.takeProfit, data.profit, data.reason, data.eventTime, data.testType, data.strategyVersion]
  );

  console.log("ACCEPTED_TRADE_EVENT", data);

  return res.json({ ok: true });
});

const marketSnapshotSchema = z.object({
  ticket: z.number().int().positive(),
  symbol: z.string().min(1),
  spread: z.number().positive(),
  atr: z.number().positive(),
  trendStatus: z.enum(["UP", "DOWN", "FLAT"]),
  session: z.enum(["ASIA", "LONDON", "NEW_YORK", "OFF_HOURS"]),
  candleRange: z.number().nonnegative(),
  secondsSinceLastMove: z.number().int(),
  snapshotTime: z.string(),
  testType: z.enum(["BACKTEST", "FORWARD", "LIVE", "UNKNOWN"]),
  strategyVersion: z.string().min(1),
});

app.post("/market-snapshot", checkApiKey, async (req, res) => {
  const result = marketSnapshotSchema.safeParse(req.body);

  if (!result.success) {
    console.log("REJECTED_MARKET_SNAPSHOT", {
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten(),
      payload: req.body
    });

    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const data = result.data;

  if (data.spread <= 0) {
    console.log("REJECTED_MARKET_SNAPSHOT", {
      reason: "INVALID_SPREAD",
      payload: data
    });

    return res.status(400).json({
      ok: false,
      reason: "INVALID_SPREAD"
    });
  }

  await pool.query(
    `INSERT INTO market_snapshots (ticket, symbol, spread, atr, trend_status, session, candle_range, seconds_since_last_move, snapshot_time, test_type, strategy_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [data.ticket, data.symbol, data.spread, data.atr, data.trendStatus, data.session, data.candleRange, data.secondsSinceLastMove, data.snapshotTime, data.testType, data.strategyVersion]
  );

  console.log("ACCEPTED_MARKET_SNAPSHOT", data);

  return res.json({ ok: true });
});

app.get("/debug/api-key", (req, res) => {
  res.json({
    apiKey: process.env.API_KEY,
    apiKeyLength: process.env.API_KEY?.length
  });
});

app.get("/debug/identity", (req, res) => {
  res.json({
    runningFile: import.meta.url,
    currentFolder: process.cwd(),
    envPath: envpath,
    envExists: fs.existsSync(envpath),
    port: process.env.PORT,
    apiKey: process.env.API_KEY,
    databaseUrl: process.env.DATABASE_URL
  });
});

app.get("/routes", (req, res) => {
  res.send("Server is THIS file");
});

const analyzerDataSchema = z.object({
  ticket: z.number().int(),
  symbol: z.string().min(1),
  direction: z.enum(["BUY", "SELL", "UNKNOWN"]),

  setupTime: z.string().datetime(),

  volumePass: z.boolean(),
  volumeValue: z.number().nonnegative(),
  volumeAverage: z.number().nonnegative(),
  volumeRatio: z.number().nonnegative(),

  htfAligned: z.boolean(),
  m15Aligned: z.boolean(),
  bosPass: z.boolean(),
  atrPass: z.boolean(),
  rangingMarket: z.boolean(),

  atrValue: z.number().nonnegative(),
  atrMultiplier: z.number().nonnegative(),
  riskDistance: z.number().nonnegative(),
  riskAtrRatio: z.number().nonnegative(),

  spread: z.number().nonnegative(),
  candleRange: z.number().nonnegative(),

  momentumValue: z.number(),
  maDistance: z.number().nonnegative(),
  maDistanceAtrRatio: z.number().nonnegative(),

  session: z.enum(["ASIA", "LONDON", "NEW_YORK", "OFF_HOURS"]),
  hour: z.number().int().min(0).max(23),
  dayOfWeek: z.number().int().min(0).max(6),

  entryPrice: z.number().nonnegative(),
  stopLoss: z.number().nonnegative(),
  takeProfit: z.number().nonnegative(),
  rrRatio: z.number().nonnegative(),

  setupAllowed: z.boolean(),
  rejectReason: z.string(),

  testType: z.enum(["BACKTEST", "FORWARD", "LIVE", "UNKNOWN"]),
strategyVersion: z.string().min(1),
});

app.post("/analyzer-data", checkApiKey, async (req, res) => {
  const result = analyzerDataSchema.safeParse(req.body);

  if (!result.success) {
    console.log("REJECTED_ANALYZER_DATA", {
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten(),
      payload: req.body
    });

    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const data = result.data;

  if (data.setupAllowed === false && data.rejectReason.length === 0) {
    return res.status(400).json({
      ok: false,
      reason: "REJECTED_SETUP_NEEDS_REJECT_REASON"
    });
  }

  try {
    await pool.query(
      `
      INSERT INTO trade_analyzer_setups (
        ticket,
        symbol,
        direction,
        setup_time,

        volume_pass,
        volume_value,
        volume_average,
        volume_ratio,

        htf_aligned,
        m15_aligned,
        bos_pass,
        atr_pass,
        ranging_market,

        atr_value,
        atr_multiplier,
        risk_distance,
        risk_atr_ratio,

        spread,
        candle_range,

        momentum_value,
        ma_distance,
        ma_distance_atr_ratio,

        session,
        hour,
        day_of_week,

        entry_price,
        stop_loss,
        take_profit,
        rr_ratio,

        setup_allowed,
        reject_reason,

        test_type,
        strategy_version
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19,
        $20, $21, $22,
        $23, $24, $25,
        $26, $27, $28, $29,
        $30, $31
      )
      ON CONFLICT DO NOTHING
      `,
      [
        data.ticket === -1 ? null : data.ticket,
        data.symbol,
        data.direction,
        data.setupTime,

        data.volumePass,
        data.volumeValue,
        data.volumeAverage,
        data.volumeRatio,

        data.htfAligned,
        data.m15Aligned,
        data.bosPass,
        data.atrPass,
        data.rangingMarket,

        data.atrValue,
        data.atrMultiplier,
        data.riskDistance,
        data.riskAtrRatio,

        data.spread,
        data.candleRange,

        data.momentumValue,
        data.maDistance,
        data.maDistanceAtrRatio,

        data.session,
        data.hour,
        data.dayOfWeek,

        data.entryPrice,
        data.stopLoss,
        data.takeProfit,
        data.rrRatio,

        data.setupAllowed,
        data.rejectReason,

        data.testType,
        data.strategyVersion  
      ]
    );

    console.log("ACCEPTED_ANALYZER_DATA", {
      ticket: data.ticket,
      symbol: data.symbol,
      direction: data.direction,
      setupAllowed: data.setupAllowed,
      rejectReason: data.rejectReason
    });

    return res.json({
      ok: true,
      message: "Analyzer data saved"
    });

  } catch (err) {
    console.error("DB_ERROR_ANALYZER_DATA", err);

    return res.status(500).json({
      ok: false,
      reason: "DB_ERROR"
    });
  }
});

const tradeExitSchema = z.object({
  ticket: z.number().int().positive(),
  symbol: z.string().min(1),
  direction: z.enum(["BUY", "SELL", "UNKNOWN"]),
  exitTime: z.string().datetime(),
  exitPrice: z.number().positive(),
  profit: z.number(),
  profitR: z.number(),
  exitReason: z.string().min(1),
  hitTp: z.boolean(),
  hitSl: z.boolean(),
  closedByExitLogic: z.boolean(),
  closedByOppositeBos: z.boolean(),
  testType: z.enum(["BACKTEST", "FORWARD", "LIVE", "UNKNOWN"]),
strategyVersion: z.string().min(1),
});

app.post("/trade-exit", checkApiKey, async (req, res) => {
  const result = tradeExitSchema.safeParse(req.body);

  if (!result.success) {
    console.log("REJECTED_TRADE_EXIT", {
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten(),
      payload: req.body
    });

    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const data = result.data;

  try {
    await pool.query(
      `
      INSERT INTO trade_exits (
        ticket,
        symbol,
        direction,
        exit_time,
        exit_price,
        profit,
        profit_r,
        exit_reason,
        hit_tp,
        hit_sl,
        closed_by_exit_logic,
        closed_by_opposite_bos,
        test_type,
        strategy_version
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (ticket) DO NOTHING
      `,
      [
        data.ticket,
        data.symbol,
        data.direction,
        data.exitTime,
        data.exitPrice,
        data.profit,
        data.profitR,
        data.exitReason,
        data.hitTp,
        data.hitSl,
        data.closedByExitLogic,
        data.closedByOppositeBos,
        data.testType,
        data.strategyVersion
      ]
    );

    console.log("ACCEPTED_TRADE_EXIT", data.ticket);

    return res.json({
      ok: true,
      message: "Trade exit saved"
    });
  } catch (err) {
    console.error("DB_ERROR_TRADE_EXIT", err);

    return res.status(500).json({
      ok: false,
      reason: "DB_ERROR"
    });
  }
});

const managementEventSchema = z.object({
  ticket: z.number().int().positive(),
  eventTime: z.string().datetime(),
  eventType: z.enum([
    "MOVE_TO_BREAKEVEN",
    "STRUCTURE_TRAILING",
    "MANUAL_MODIFICATION",
    "OTHER"
  ]),
  oldSl: z.number().nonnegative(),
  newSl: z.number().nonnegative(),
  oldTp: z.number().nonnegative(),
  newTp: z.number().nonnegative(),
  priceAtEvent: z.number().nonnegative(),
  reason: z.string().min(1),
  testType: z.enum(["BACKTEST", "FORWARD", "LIVE", "UNKNOWN"]),
strategyVersion: z.string().min(1),
});

app.post("/management-event", checkApiKey, async (req, res) => {
  const result = managementEventSchema.safeParse(req.body);

  if (!result.success) {
    console.log("REJECTED_MANAGEMENT_EVENT", {
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten(),
      payload: req.body
    });

    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const data = result.data;

  try {
    await pool.query(
      `
      INSERT INTO trade_management_events (
        ticket,
        event_time,
        event_type,
        old_sl,
        new_sl,
        old_tp,
        new_tp,
        price_at_event,
        reason,
        test_type,
        strategy_version
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        data.ticket,
        data.eventTime,
        data.eventType,
        data.oldSl,
        data.newSl,
        data.oldTp,
        data.newTp,
        data.priceAtEvent,
        data.reason,
        data.testType,
        data.strategyVersion
      ]
    );

    console.log("ACCEPTED_MANAGEMENT_EVENT", {
      ticket: data.ticket,
      eventType: data.eventType
    });

    return res.json({
      ok: true,
      message: "Management event saved"
    });
  } catch (err) {
    console.error("DB_ERROR_MANAGEMENT_EVENT", err);

    return res.status(500).json({
      ok: false,
      reason: "DB_ERROR"
    });
  }
});

const executionDiagnosticsSchema = z.object({
  ticket: z.number().int(),
  symbol: z.string().min(1),
  eventType: z.enum([
    "ORDER_SEND",
    "ORDER_MODIFY",
    "ORDER_CLOSE",
    "ENTRY_CHECK"
  ]),

  orderType: z.enum(["BUY", "SELL", "UNKNOWN"]),

  requestedPrice: z.number().nonnegative(),
  executedPrice: z.number().nonnegative(),
  slippagePoints: z.number(),
  slippagePips: z.number(),

  spreadPips: z.number().nonnegative(),
  spreadSpike: z.boolean(),

  stopLoss: z.number().nonnegative(),
  takeProfit: z.number().nonnegative(),
  stopDistancePips: z.number().nonnegative(),
  stopTooClose: z.boolean(),

  entryProblem: z.boolean(),
  entryProblemReason: z.string(),

  executionProblem: z.boolean(),
  executionErrorCode: z.number().int(),
  executionErrorMessage: z.string(),

  atrValue: z.number().nonnegative(),
  stopAtrRatio: z.number().nonnegative(),

  session: z.enum(["ASIA", "LONDON", "NEW_YORK", "OFF_HOURS"]),
  diagnosticTime: z.string().datetime(),

  testType: z.enum(["BACKTEST", "FORWARD", "LIVE", "UNKNOWN"]),
strategyVersion: z.string().min(1),
});

app.post("/execution-diagnostics", checkApiKey, async (req, res) => {
  const result = executionDiagnosticsSchema.safeParse(req.body);

  if (!result.success) {
    console.log("REJECTED_EXECUTION_DIAGNOSTICS", {
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten(),
      payload: req.body
    });

    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const data = result.data;

  try {
    await pool.query(
      `
      INSERT INTO execution_diagnostics (
        ticket,
        symbol,
        event_type,

        order_type,
        requested_price,
        executed_price,
        slippage_points,
        slippage_pips,

        spread_pips,
        spread_spike,

        stop_loss,
        take_profit,
        stop_distance_pips,
        stop_too_close,

        entry_problem,
        entry_problem_reason,

        execution_problem,
        execution_error_code,
        execution_error_message,

        atr_value,
        stop_atr_ratio,

        session,
        diagnostic_time

        test_type,
        strategy_version
      )
      VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,$8,
        $9,$10,
        $11,$12,$13,$14,
        $15,$16,
        $17,$18,$19,
        $20,$21,
        $22,$23
      )
      `,
      [
        data.ticket,
        data.symbol,
        data.eventType,

        data.orderType,
        data.requestedPrice,
        data.executedPrice,
        data.slippagePoints,
        data.slippagePips,

        data.spreadPips,
        data.spreadSpike,

        data.stopLoss,
        data.takeProfit,
        data.stopDistancePips,
        data.stopTooClose,

        data.entryProblem,
        data.entryProblemReason,

        data.executionProblem,
        data.executionErrorCode,
        data.executionErrorMessage,

        data.atrValue,
        data.stopAtrRatio,

        data.session,
        data.diagnosticTime,

        data.testType,
        data.strategyVersion
      ]
    );

    console.log("ACCEPTED_EXECUTION_DIAGNOSTICS", {
      ticket: data.ticket,
      symbol: data.symbol,
      eventType: data.eventType,
      executionProblem: data.executionProblem,
      entryProblem: data.entryProblem
    });

    return res.json({
      ok: true,
      message: "Execution diagnostics saved"
    });

  } catch (err) {
    console.error("DB_ERROR_EXECUTION_DIAGNOSTICS", err);

    return res.status(500).json({
      ok: false,
      reason: "DB_ERROR"
    });
  }
});

const marketRegimeSchema = z.object({
  ticket: z.number().int(),
  symbol: z.string().min(1),
  direction: z.enum(["BUY", "SELL", "UNKNOWN"]),

  regimeTime: z.string().datetime(),

  isTrend: z.boolean(),
  isStrongTrend: z.boolean(),
  isWeakTrend: z.boolean(),
  isRange: z.boolean(),
  isChop: z.boolean(),

  isHighVol: z.boolean(),
  isLowVol: z.boolean(),
  isNormalVol: z.boolean(),

  isBreakout: z.boolean(),
  isPullback: z.boolean(),

  isSpreadStress: z.boolean(),

  trendDirection: z.enum(["UP", "DOWN", "FLAT"]),

  atrValue: z.number().nonnegative(),
  atrAverage: z.number().nonnegative(),
  atrRatio: z.number().nonnegative(),

  maFast: z.number(),
  maSlow: z.number(),
  maDistance: z.number().nonnegative(),
  maDistanceAtrRatio: z.number().nonnegative(),

  candleRange: z.number().nonnegative(),
  candleRangeAtrRatio: z.number().nonnegative(),

  spreadPips: z.number().nonnegative(),

  session: z.enum(["ASIA", "LONDON", "NEW_YORK", "OFF_HOURS"]),
  hour: z.number().int().min(0).max(23),
  dayOfWeek: z.number().int().min(0).max(6),

  testType: z.enum(["BACKTEST", "FORWARD", "LIVE", "UNKNOWN"]),
strategyVersion: z.string().min(1),
});

app.post("/market-regime", checkApiKey, async (req, res) => {
  const result = marketRegimeSchema.safeParse(req.body);

  if (!result.success) {
    console.log("REJECTED_MARKET_REGIME", {
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten(),
      payload: req.body
    });

    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const data = result.data;

  try {
    await pool.query(
      `
      INSERT INTO market_regime_snapshots (
        ticket,
        symbol,
        direction,
        regime_time,

        is_trend,
        is_strong_trend,
        is_weak_trend,
        is_range,
        is_chop,

        is_high_vol,
        is_low_vol,
        is_normal_vol,

        is_breakout,
        is_pullback,

        is_spread_stress,

        trend_direction,

        atr_value,
        atr_average,
        atr_ratio,

        ma_fast,
        ma_slow,
        ma_distance,
        ma_distance_atr_ratio,

        candle_range,
        candle_range_atr_ratio,

        spread_pips,

        session,
        hour,
        day_of_week,

        test_type,
        strategy_version
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,$9,
        $10,$11,$12,
        $13,$14,
        $15,
        $16,
        $17,$18,$19,
        $20,$21,$22,$23,
        $24,$25,
        $26,
        $27,$28,$29
      )
      `,
      [
        data.ticket === -1 ? null : data.ticket,
        data.symbol,
        data.direction,
        data.regimeTime,

        data.isTrend,
        data.isStrongTrend,
        data.isWeakTrend,
        data.isRange,
        data.isChop,

        data.isHighVol,
        data.isLowVol,
        data.isNormalVol,

        data.isBreakout,
        data.isPullback,

        data.isSpreadStress,

        data.trendDirection,

        data.atrValue,
        data.atrAverage,
        data.atrRatio,

        data.maFast,
        data.maSlow,
        data.maDistance,
        data.maDistanceAtrRatio,

        data.candleRange,
        data.candleRangeAtrRatio,

        data.spreadPips,

        data.session,
        data.hour,
        data.dayOfWeek,

        data.testType,
        data.strategyVersion
      ]
    );

    console.log("ACCEPTED_MARKET_REGIME", {
      ticket: data.ticket,
      symbol: data.symbol,
      trendDirection: data.trendDirection,
      isTrend: data.isTrend,
      isRange: data.isRange,
      isHighVol: data.isHighVol
    });

    return res.json({
      ok: true,
      message: "Market regime saved"
    });

  } catch (err) {
    console.error("DB_ERROR_MARKET_REGIME", err);

    return res.status(500).json({
      ok: false,
      reason: "DB_ERROR"
    });
  }
});

const dailyReportRequestSchema = z.object({
  symbol: z.string().min(1),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

app.post("/daily-report", checkApiKey, async (req, res) => {
  const result = dailyReportRequestSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const { symbol, reportDate } = result.data;

  try {
    const report = await pool.query(
      `
      WITH closed_trades AS (
        SELECT *
        FROM trade_exits
        WHERE symbol = $1
          AND exit_time::date = $2::date
      ),

      profit_stats AS (
        SELECT
          COUNT(*)::int AS total_trades,
          COUNT(*) FILTER (WHERE profit > 0)::int AS winning_trades,
          COUNT(*) FILTER (WHERE profit < 0)::int AS losing_trades,

          COALESCE(SUM(profit), 0) AS total_profit,
          COALESCE(AVG(profit), 0) AS avg_profit,
          COALESCE(AVG(profit_r), 0) AS avg_profit_r,
          COALESCE(MIN(profit), 0) AS max_loss,
          COALESCE(MAX(profit), 0) AS max_win,

          CASE 
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(
              (COUNT(*) FILTER (WHERE profit > 0)::numeric / COUNT(*)::numeric) * 100,
              2
            )
          END AS winrate,

          CASE
            WHEN ABS(SUM(profit) FILTER (WHERE profit < 0)) > 0
            THEN SUM(profit) FILTER (WHERE profit > 0) / ABS(SUM(profit) FILTER (WHERE profit < 0))
            ELSE 0
          END AS profit_factor
        FROM closed_trades
      ),

      exit_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE exit_reason = 'TAKE_PROFIT')::int AS tp_count,
          COUNT(*) FILTER (WHERE exit_reason = 'STOP_LOSS')::int AS sl_count,
          COUNT(*) FILTER (WHERE closed_by_exit_logic = true)::int AS exit_logic_count,
          COUNT(*) FILTER (
            WHERE exit_reason NOT IN ('TAKE_PROFIT', 'STOP_LOSS')
              AND closed_by_exit_logic = false
          )::int AS manual_or_other_count
        FROM closed_trades
      ),

      execution_stats AS (
        SELECT
          COALESCE(AVG(spread_pips), 0) AS avg_spread,
          COALESCE(MAX(spread_pips), 0) AS max_spread,
          COUNT(*) FILTER (WHERE spread_spike = true)::int AS spread_spike_count,

          COALESCE(AVG(slippage_pips), 0) AS avg_slippage_pips,
          COALESCE(MAX(slippage_pips), 0) AS max_slippage_pips,

          COUNT(*) FILTER (WHERE event_type = 'ORDER_SEND' AND execution_problem = true)::int AS order_send_errors,
          COUNT(*) FILTER (WHERE event_type = 'ORDER_MODIFY' AND execution_problem = true)::int AS order_modify_errors,
          COUNT(*) FILTER (WHERE event_type = 'ORDER_CLOSE' AND execution_problem = true)::int AS order_close_errors,

          COUNT(*) FILTER (WHERE execution_error_code = 130)::int AS invalid_stops_count,
          COUNT(*) FILTER (WHERE execution_error_code = 138)::int AS requote_count,
          COUNT(*) FILTER (WHERE execution_error_code = 136)::int AS off_quotes_count
        FROM execution_diagnostics
        WHERE symbol = $1
          AND diagnostic_time::date = $2::date
      ),

      management_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'MOVE_TO_BREAKEVEN')::int AS breakeven_moves,
          COUNT(*) FILTER (WHERE event_type = 'STRUCTURE_TRAILING')::int AS structure_trailing_moves
        FROM trade_management_events m
        JOIN closed_trades c ON c.ticket = m.ticket
      ),

      regime_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE r.is_trend = true)::int AS trend_trades,
          COUNT(*) FILTER (WHERE r.is_range = true)::int AS range_trades,
          COUNT(*) FILTER (WHERE r.is_high_vol = true)::int AS high_vol_trades,
          COUNT(*) FILTER (WHERE r.is_low_vol = true)::int AS low_vol_trades
        FROM market_regime_snapshots r
        JOIN closed_trades c ON c.ticket = r.ticket
      ),

      session_profit AS (
        SELECT
          s.session,
          SUM(c.profit) AS session_profit
        FROM trade_analyzer_setups s
        JOIN closed_trades c ON c.ticket = s.ticket
        GROUP BY s.session
      ),

      best_session AS (
        SELECT session
        FROM session_profit
        ORDER BY session_profit DESC
        LIMIT 1
      ),

      worst_session AS (
        SELECT session
        FROM session_profit
        ORDER BY session_profit ASC
        LIMIT 1
      ),

      regime_profit AS (
        SELECT 'TREND' AS regime, SUM(c.profit) AS profit
        FROM market_regime_snapshots r
        JOIN closed_trades c ON c.ticket = r.ticket
        WHERE r.is_trend = true

        UNION ALL

        SELECT 'RANGE' AS regime, SUM(c.profit) AS profit
        FROM market_regime_snapshots r
        JOIN closed_trades c ON c.ticket = r.ticket
        WHERE r.is_range = true

        UNION ALL

        SELECT 'HIGH_VOL' AS regime, SUM(c.profit) AS profit
        FROM market_regime_snapshots r
        JOIN closed_trades c ON c.ticket = r.ticket
        WHERE r.is_high_vol = true

        UNION ALL

        SELECT 'LOW_VOL' AS regime, SUM(c.profit) AS profit
        FROM market_regime_snapshots r
        JOIN closed_trades c ON c.ticket = r.ticket
        WHERE r.is_low_vol = true
      ),

      best_regime AS (
        SELECT regime
        FROM regime_profit
        WHERE profit IS NOT NULL
        ORDER BY profit DESC
        LIMIT 1
      ),

      worst_regime AS (
        SELECT regime
        FROM regime_profit
        WHERE profit IS NOT NULL
        ORDER BY profit ASC
        LIMIT 1
      )

      INSERT INTO daily_reports (
        report_date,
        symbol,

        total_trades,
        winning_trades,
        losing_trades,

        winrate,
        total_profit,
        avg_profit,
        profit_factor,

        avg_profit_r,
        max_loss,
        max_win,

        tp_count,
        sl_count,
        exit_logic_count,
        manual_or_other_count,

        avg_spread,
        max_spread,
        spread_spike_count,

        avg_slippage_pips,
        max_slippage_pips,

        order_send_errors,
        order_modify_errors,
        order_close_errors,
        invalid_stops_count,
        requote_count,
        off_quotes_count,

        breakeven_moves,
        structure_trailing_moves,

        trend_trades,
        range_trades,
        high_vol_trades,
        low_vol_trades,

        best_session,
        worst_session,
        best_regime,
        worst_regime,

        notes
      )
      SELECT
        $2::date,
        $1,

        p.total_trades,
        p.winning_trades,
        p.losing_trades,

        p.winrate,
        p.total_profit,
        p.avg_profit,
        p.profit_factor,

        p.avg_profit_r,
        p.max_loss,
        p.max_win,

        e.tp_count,
        e.sl_count,
        e.exit_logic_count,
        e.manual_or_other_count,

        x.avg_spread,
        x.max_spread,
        x.spread_spike_count,

        x.avg_slippage_pips,
        x.max_slippage_pips,

        x.order_send_errors,
        x.order_modify_errors,
        x.order_close_errors,
        x.invalid_stops_count,
        x.requote_count,
        x.off_quotes_count,

        m.breakeven_moves,
        m.structure_trailing_moves,

        r.trend_trades,
        r.range_trades,
        r.high_vol_trades,
        r.low_vol_trades,

        COALESCE((SELECT session FROM best_session), 'NONE'),
        COALESCE((SELECT session FROM worst_session), 'NONE'),
        COALESCE((SELECT regime FROM best_regime), 'NONE'),
        COALESCE((SELECT regime FROM worst_regime), 'NONE'),

        ''
      FROM profit_stats p
      CROSS JOIN exit_stats e
      CROSS JOIN execution_stats x
      CROSS JOIN management_stats m
      CROSS JOIN regime_stats r

      ON CONFLICT (report_date, symbol)
      DO UPDATE SET
        total_trades = EXCLUDED.total_trades,
        winning_trades = EXCLUDED.winning_trades,
        losing_trades = EXCLUDED.losing_trades,
        winrate = EXCLUDED.winrate,
        total_profit = EXCLUDED.total_profit,
        avg_profit = EXCLUDED.avg_profit,
        profit_factor = EXCLUDED.profit_factor,
        avg_profit_r = EXCLUDED.avg_profit_r,
        max_loss = EXCLUDED.max_loss,
        max_win = EXCLUDED.max_win,
        tp_count = EXCLUDED.tp_count,
        sl_count = EXCLUDED.sl_count,
        exit_logic_count = EXCLUDED.exit_logic_count,
        manual_or_other_count = EXCLUDED.manual_or_other_count,
        avg_spread = EXCLUDED.avg_spread,
        max_spread = EXCLUDED.max_spread,
        spread_spike_count = EXCLUDED.spread_spike_count,
        avg_slippage_pips = EXCLUDED.avg_slippage_pips,
        max_slippage_pips = EXCLUDED.max_slippage_pips,
        order_send_errors = EXCLUDED.order_send_errors,
        order_modify_errors = EXCLUDED.order_modify_errors,
        order_close_errors = EXCLUDED.order_close_errors,
        invalid_stops_count = EXCLUDED.invalid_stops_count,
        requote_count = EXCLUDED.requote_count,
        off_quotes_count = EXCLUDED.off_quotes_count,
        breakeven_moves = EXCLUDED.breakeven_moves,
        structure_trailing_moves = EXCLUDED.structure_trailing_moves,
        trend_trades = EXCLUDED.trend_trades,
        range_trades = EXCLUDED.range_trades,
        high_vol_trades = EXCLUDED.high_vol_trades,
        low_vol_trades = EXCLUDED.low_vol_trades,
        best_session = EXCLUDED.best_session,
        worst_session = EXCLUDED.worst_session,
        best_regime = EXCLUDED.best_regime,
        worst_regime = EXCLUDED.worst_regime,
        created_at = NOW()

      RETURNING *;
  `,
      [symbol, reportDate]
    );

    await pool.query(
      `
      DELETE FROM daily_execution_reason_rankings
      WHERE report_date = $2::date
        AND symbol = $1;
  `,
      [symbol, reportDate]
    );

    await pool.query(
      `
      WITH closed_trades AS (
        SELECT *
        FROM trade_exits
        WHERE symbol = $1
          AND exit_time::date = $2::date
      ),

      execution_groups AS (
        SELECT
          CASE
            WHEN x.spread_spike = true THEN 'SPREAD_SPIKE'
            WHEN x.slippage_pips >= 1.0 THEN 'HIGH_SLIPPAGE'
            WHEN x.stop_too_close = true THEN 'STOP_TOO_CLOSE'
            WHEN x.execution_problem = true THEN x.execution_error_message
            ELSE 'NORMAL_EXECUTION'
          END AS execution_reason,

          c.ticket,
          c.profit
        FROM closed_trades c
        JOIN execution_diagnostics x ON x.ticket = c.ticket
      ),

      grouped AS (
        SELECT
          execution_reason,
          COUNT(DISTINCT ticket)::int AS trades,
          SUM(profit) AS total_profit,
          AVG(profit) AS avg_profit,

          CASE 
            WHEN COUNT(DISTINCT ticket) = 0 THEN 0
            ELSE ROUND(
              (COUNT(DISTINCT ticket) FILTER (WHERE profit > 0)::numeric 
              / COUNT(DISTINCT ticket)::numeric) * 100,
              2
            )
          END AS winrate,

          CASE
            WHEN ABS(SUM(profit) FILTER (WHERE profit < 0)) > 0
            THEN SUM(profit) FILTER (WHERE profit > 0) 
                 / ABS(SUM(profit) FILTER (WHERE profit < 0))
            ELSE 0
          END AS profit_factor
        FROM execution_groups
        GROUP BY execution_reason
      ),

      scored AS (
        SELECT
          *,
          (
            COALESCE(avg_profit, 0)
            * COALESCE(profit_factor, 0)
            * (COALESCE(winrate, 0) / 100.0)
            * LN(trades + 1)
          ) AS effectiveness_score
        FROM grouped
      ),

      ranked AS (
        SELECT
          *,
          RANK() OVER (ORDER BY effectiveness_score DESC) AS rank
        FROM scored
      )

      INSERT INTO daily_execution_reason_rankings (
        report_date,
        symbol,
        execution_reason,
        trades,
        total_profit,
        avg_profit,
        winrate,
        profit_factor,
        effectiveness_score,
        rank
      )
      SELECT
        $2::date,
        $1,
        execution_reason,
        trades,
        COALESCE(total_profit, 0),
        COALESCE(avg_profit, 0),
        COALESCE(winrate, 0),
        COALESCE(profit_factor, 0),
        COALESCE(effectiveness_score, 0),
        rank
      FROM ranked;
  `,
      [symbol, reportDate]
    );

    return res.json({
      ok: true,
      message: "Daily report generated",
      report: report.rows[0]
    });

  } catch (err) {
  console.error("DB_ERROR_DAILY_REPORT FULL:", err);

  return res.status(500).json({
    ok: false,
    reason: "DB_ERROR",
    message: err.message,
    detail: err.detail,
    table: err.table,
    column: err.column
  });
}
});

const WeeklyTradeRankingSchema = z.object({
  symbol: z.string().min(1),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

app.post("/weekly-winner", checkApiKey, async (req, res) => {
  const result = WeeklyTradeRankingSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const { symbol, reportDate } = result.data;

  try {
    await pool.query("BEGIN");

    await pool.query(
      `
      DELETE FROM weekly_pattern_rankings
      WHERE symbol = $1
        AND report_date = $2::date;

      DELETE FROM weekly_trade_examples
      WHERE symbol = $1
        AND report_date = $2::date;
      `,
      [symbol, reportDate]
    );

    await pool.query(
      `
      WITH closed_trades AS (
        SELECT *
        FROM trade_exits
        WHERE symbol = $1
          AND exit_time::date >= ($2::date - INTERVAL '6 days')
          AND exit_time::date <= $2::date
      ),

      confluence_patterns AS (
        SELECT
          'CONFLUENCE_COMBO' AS analysis_type,
          CONCAT(
            'volume=', s.volume_pass,
            ', htf=', s.htf_aligned,
            ', m15=', s.m15_aligned,
            ', bos=', s.bos_pass,
            ', atr=', s.atr_pass,
            ', ranging=', s.ranging_market
          ) AS pattern_name,
          NULL::text AS pattern_value,

          COUNT(*)::int AS trades,
          COUNT(*) FILTER (WHERE e.profit > 0)::int AS winners,
          COUNT(*) FILTER (WHERE e.profit < 0)::int AS losers,

          COALESCE(SUM(e.profit), 0) AS total_profit,
          COALESCE(AVG(e.profit), 0) AS avg_profit,
          COALESCE(AVG(e.profit_r), 0) AS avg_profit_r,

          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(
              COUNT(*) FILTER (WHERE e.profit > 0)::numeric / COUNT(*)::numeric * 100,
              2
            )
          END AS winrate
        FROM closed_trades e
        JOIN trade_analyzer_setups s ON s.ticket = e.ticket
        GROUP BY
          s.volume_pass,
          s.htf_aligned,
          s.m15_aligned,
          s.bos_pass,
          s.atr_pass,
          s.ranging_market
        HAVING COUNT(*) >= 1
      ),

      session_patterns AS (
        SELECT
          'SESSION' AS analysis_type,
          s.session AS pattern_name,
          NULL::text AS pattern_value,

          COUNT(*)::int AS trades,
          COUNT(*) FILTER (WHERE e.profit > 0)::int AS winners,
          COUNT(*) FILTER (WHERE e.profit < 0)::int AS losers,

          COALESCE(SUM(e.profit), 0) AS total_profit,
          COALESCE(AVG(e.profit), 0) AS avg_profit,
          COALESCE(AVG(e.profit_r), 0) AS avg_profit_r,

          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(
              COUNT(*) FILTER (WHERE e.profit > 0)::numeric / COUNT(*)::numeric * 100,
              2
            )
          END AS winrate
        FROM closed_trades e
        JOIN trade_analyzer_setups s ON s.ticket = e.ticket
        GROUP BY s.session
      ),

      hour_patterns AS (
        SELECT
          'HOUR' AS analysis_type,
          s.hour::text AS pattern_name,
          NULL::text AS pattern_value,

          COUNT(*)::int AS trades,
          COUNT(*) FILTER (WHERE e.profit > 0)::int AS winners,
          COUNT(*) FILTER (WHERE e.profit < 0)::int AS losers,

          COALESCE(SUM(e.profit), 0) AS total_profit,
          COALESCE(AVG(e.profit), 0) AS avg_profit,
          COALESCE(AVG(e.profit_r), 0) AS avg_profit_r,

          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(
              COUNT(*) FILTER (WHERE e.profit > 0)::numeric / COUNT(*)::numeric * 100,
              2
            )
          END AS winrate
        FROM closed_trades e
        JOIN trade_analyzer_setups s ON s.ticket = e.ticket
        GROUP BY s.hour
      ),

      regime_patterns AS (
        SELECT
          'REGIME' AS analysis_type,
          CONCAT(
            'trend=', r.is_trend,
            ', range=', r.is_range,
            ', high_vol=', r.is_high_vol,
            ', low_vol=', r.is_low_vol,
            ', breakout=', r.is_breakout,
            ', pullback=', r.is_pullback
          ) AS pattern_name,
          NULL::text AS pattern_value,

          COUNT(*)::int AS trades,
          COUNT(*) FILTER (WHERE e.profit > 0)::int AS winners,
          COUNT(*) FILTER (WHERE e.profit < 0)::int AS losers,

          COALESCE(SUM(e.profit), 0) AS total_profit,
          COALESCE(AVG(e.profit), 0) AS avg_profit,
          COALESCE(AVG(e.profit_r), 0) AS avg_profit_r,

          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(
              COUNT(*) FILTER (WHERE e.profit > 0)::numeric / COUNT(*)::numeric * 100,
              2
            )
          END AS winrate
        FROM closed_trades e
        JOIN market_regime_snapshots r ON r.ticket = e.ticket
        GROUP BY
          r.is_trend,
          r.is_range,
          r.is_high_vol,
          r.is_low_vol,
          r.is_breakout,
          r.is_pullback
      ),

      execution_patterns AS (
        SELECT
          'EXECUTION' AS analysis_type,
          CASE
            WHEN x.spread_spike = true THEN 'SPREAD_SPIKE'
            WHEN x.slippage_pips >= 1.0 THEN 'HIGH_SLIPPAGE'
            WHEN x.stop_too_close = true THEN 'STOP_TOO_CLOSE'
            WHEN x.execution_problem = true THEN x.execution_error_message
            ELSE 'NORMAL_EXECUTION'
          END AS pattern_name,
          NULL::text AS pattern_value,

          COUNT(DISTINCT e.ticket)::int AS trades,
          COUNT(DISTINCT e.ticket) FILTER (WHERE e.profit > 0)::int AS winners,
          COUNT(DISTINCT e.ticket) FILTER (WHERE e.profit < 0)::int AS losers,

          COALESCE(SUM(e.profit), 0) AS total_profit,
          COALESCE(AVG(e.profit), 0) AS avg_profit,
          COALESCE(AVG(e.profit_r), 0) AS avg_profit_r,

          CASE
            WHEN COUNT(DISTINCT e.ticket) = 0 THEN 0
            ELSE ROUND(
              COUNT(DISTINCT e.ticket) FILTER (WHERE e.profit > 0)::numeric
              / COUNT(DISTINCT e.ticket)::numeric * 100,
              2
            )
          END AS winrate
        FROM closed_trades e
        JOIN execution_diagnostics x ON x.ticket = e.ticket
        GROUP BY pattern_name
      ),

      all_patterns AS (
        SELECT * FROM confluence_patterns
        UNION ALL
        SELECT * FROM session_patterns
        UNION ALL
        SELECT * FROM hour_patterns
        UNION ALL
        SELECT * FROM regime_patterns
        UNION ALL
        SELECT * FROM execution_patterns
      ),

      ranked AS (
        SELECT
          *,
          RANK() OVER (
            PARTITION BY analysis_type
            ORDER BY total_profit DESC, winrate DESC, trades DESC
          ) AS rank
        FROM all_patterns
      )

      INSERT INTO weekly_pattern_rankings (
        report_date,
        symbol,
        analysis_type,
        pattern_name,
        pattern_value,
        trades,
        winners,
        losers,
        total_profit,
        avg_profit,
        avg_profit_r,
        winrate,
        rank
      )
      SELECT
        $2::date,
        $1,
        analysis_type,
        pattern_name,
        pattern_value,
        trades,
        winners,
        losers,
        total_profit,
        avg_profit,
        avg_profit_r,
        winrate,
        rank
      FROM ranked

      ON CONFLICT (report_date, symbol, analysis_type, pattern_name, pattern_value)
      DO UPDATE SET
        trades = EXCLUDED.trades,
        winners = EXCLUDED.winners,
        losers = EXCLUDED.losers,
        total_profit = EXCLUDED.total_profit,
        avg_profit = EXCLUDED.avg_profit,
        avg_profit_r = EXCLUDED.avg_profit_r,
        winrate = EXCLUDED.winrate,
        rank = EXCLUDED.rank,
        created_at = NOW();
      `,
      [symbol, reportDate]
    );

    await pool.query(
      `
      WITH closed_trades AS (
        SELECT *
        FROM trade_exits
        WHERE symbol = $1
          AND exit_time::date >= ($2::date - INTERVAL '6 days')
          AND exit_time::date <= $2::date
      ),

      enriched AS (
        SELECT
          e.ticket,
          e.symbol,
          e.direction,
          e.profit,
          e.profit_r,
          e.exit_reason,

          s.volume_ratio,
          s.htf_aligned,
          s.m15_aligned,
          s.bos_pass,
          s.atr_pass,
          s.ranging_market,
          s.session,
          s.hour,

          r.is_trend,
          r.is_range,
          r.is_high_vol,
          r.is_low_vol,
          r.is_breakout,

          x.spread_pips,
          x.slippage_pips,
          x.execution_problem,
          x.execution_error_message
        FROM closed_trades e
        LEFT JOIN trade_analyzer_setups s ON s.ticket = e.ticket
        LEFT JOIN market_regime_snapshots r ON r.ticket = e.ticket
        LEFT JOIN execution_diagnostics x ON x.ticket = e.ticket
      ),

      winners AS (
        SELECT *
        FROM enriched
        WHERE profit > 0
        ORDER BY profit DESC
        LIMIT 20
      ),

      losers AS (
        SELECT *
        FROM enriched
        WHERE profit < 0
        ORDER BY profit ASC
        LIMIT 20
      ),

      combined AS (
        SELECT 'WINNER' AS trade_group, *
        FROM winners

        UNION ALL

        SELECT 'LOSER' AS trade_group, *
        FROM losers
      )

      INSERT INTO weekly_trade_examples (
        report_date,
        symbol,
        trade_group,

        ticket,
        direction,
        profit,
        profit_r,
        exit_reason,

        volume_ratio,
        htf_aligned,
        m15_aligned,
        bos_pass,
        atr_pass,
        ranging_market,

        session,
        hour,

        is_trend,
        is_range,
        is_high_vol,
        is_low_vol,
        is_breakout,

        spread_pips,
        slippage_pips,
        execution_problem,
        execution_error_message
      )
      SELECT
        $2::date,
        $1,
        trade_group,

        ticket,
        direction,
        profit,
        profit_r,
        exit_reason,

        volume_ratio,
        htf_aligned,
        m15_aligned,
        bos_pass,
        atr_pass,
        ranging_market,

        session,
        hour,

        is_trend,
        is_range,
        is_high_vol,
        is_low_vol,
        is_breakout,

        spread_pips,
        slippage_pips,
        execution_problem,
        execution_error_message
      FROM combined

      ON CONFLICT (report_date, symbol, trade_group, ticket)
      DO UPDATE SET
        direction = EXCLUDED.direction,
        profit = EXCLUDED.profit,
        profit_r = EXCLUDED.profit_r,
        exit_reason = EXCLUDED.exit_reason,
        volume_ratio = EXCLUDED.volume_ratio,
        htf_aligned = EXCLUDED.htf_aligned,
        m15_aligned = EXCLUDED.m15_aligned,
        bos_pass = EXCLUDED.bos_pass,
        atr_pass = EXCLUDED.atr_pass,
        ranging_market = EXCLUDED.ranging_market,
        session = EXCLUDED.session,
        hour = EXCLUDED.hour,
        is_trend = EXCLUDED.is_trend,
        is_range = EXCLUDED.is_range,
        is_high_vol = EXCLUDED.is_high_vol,
        is_low_vol = EXCLUDED.is_low_vol,
        is_breakout = EXCLUDED.is_breakout,
        spread_pips = EXCLUDED.spread_pips,
        slippage_pips = EXCLUDED.slippage_pips,
        execution_problem = EXCLUDED.execution_problem,
        execution_error_message = EXCLUDED.execution_error_message,
        created_at = NOW();
      `,
      [symbol, reportDate]
    );

    await pool.query("COMMIT");

    return res.json({
      ok: true,
      message: "Weekly winner/loser ranking generated"
    });

  } catch (err: any) {
    await pool.query("ROLLBACK");

    console.error("DB_ERROR_WEEKLY_TRADE_RANKING FULL:", err);

    return res.status(500).json({
      ok: false,
      reason: "DB_ERROR",
      message: err.message,
      detail: err.detail,
      table: err.table,
      column: err.column
    });
  }
});

cron.schedule("0 0 * * *", async () => {
  await pool.query("SELECT generate_daily_report(...)");
});

const marketPhaseProfileSchema = z.object({
  symbol: z.string().min(1),
  profileStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  profileEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  testType: z.enum(["BACKTEST", "FORWARD", "LIVE"]),
  strategyVersion: z.string().min(1)
});

app.post("/market-phase-profile", checkApiKey, async (req, res) => {
  const result = marketPhaseProfileSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten()
    });
  }

  const {
    symbol,
    profileStart,
    profileEnd,
    testType,
    strategyVersion
  } = result.data;

  try {
    const report = await pool.query(
      `
      WITH closed_trades AS (
        SELECT *
        FROM trade_exits
        WHERE symbol = $1
          AND test_type = $4
          AND strategy_version = $5
          AND exit_time::date >= $2::date
          AND exit_time::date <= $3::date
      ),

      base AS (
        SELECT
          e.ticket,
          e.profit,
          e.profit_r,

          r.is_trend,
          r.is_range,
          r.is_high_vol,
          r.is_low_vol,
          r.is_breakout,
          r.is_pullback,
          r.atr_ratio,
          r.ma_distance_atr_ratio,

          s.volume_ratio,

          x.spread_pips,
          x.slippage_pips

        FROM closed_trades e
        LEFT JOIN market_regime_snapshots r ON r.ticket = e.ticket
        LEFT JOIN trade_analyzer_setups s ON s.ticket = e.ticket
        LEFT JOIN execution_diagnostics x ON x.ticket = e.ticket
      ),

      stats AS (
        SELECT
          COUNT(DISTINCT ticket)::int AS trades,

          COALESCE(AVG(CASE WHEN is_trend THEN 1 ELSE 0 END), 0) AS trend_ratio,
          COALESCE(AVG(CASE WHEN is_range THEN 1 ELSE 0 END), 0) AS range_ratio,
          COALESCE(AVG(CASE WHEN is_high_vol THEN 1 ELSE 0 END), 0) AS high_vol_ratio,
          COALESCE(AVG(CASE WHEN is_low_vol THEN 1 ELSE 0 END), 0) AS low_vol_ratio,
          COALESCE(AVG(CASE WHEN is_breakout THEN 1 ELSE 0 END), 0) AS breakout_ratio,
          COALESCE(AVG(CASE WHEN is_pullback THEN 1 ELSE 0 END), 0) AS pullback_ratio,

          COALESCE(AVG(atr_ratio), 0) AS avg_atr_ratio,
          COALESCE(AVG(ma_distance_atr_ratio), 0) AS avg_trend_strength,
          COALESCE(AVG(volume_ratio), 0) AS avg_volume_ratio,
          COALESCE(AVG(spread_pips), 0) AS avg_spread,
          COALESCE(AVG(slippage_pips), 0) AS avg_slippage,

          COALESCE(SUM(profit), 0) AS total_profit,
          COALESCE(AVG(profit), 0) AS avg_profit,
          COALESCE(AVG(profit_r), 0) AS avg_profit_r,

          CASE
            WHEN COUNT(DISTINCT ticket) = 0 THEN 0
            ELSE ROUND(
              COUNT(DISTINCT ticket) FILTER (WHERE profit > 0)::numeric
              / COUNT(DISTINCT ticket)::numeric * 100,
              2
            )
          END AS winrate,

          CASE
            WHEN ABS(SUM(profit) FILTER (WHERE profit < 0)) > 0
            THEN SUM(profit) FILTER (WHERE profit > 0)
                 / ABS(SUM(profit) FILTER (WHERE profit < 0))
            ELSE 0
          END AS profit_factor
        FROM base
      ),

      labeled AS (
        SELECT
          *,
          CASE
            WHEN high_vol_ratio >= 0.6 AND trend_ratio >= 0.5 THEN 'TREND_HIGH_VOL'
            WHEN low_vol_ratio >= 0.6 AND range_ratio >= 0.5 THEN 'RANGE_LOW_VOL'
            WHEN range_ratio >= 0.6 THEN 'RANGE'
            WHEN trend_ratio >= 0.6 THEN 'TREND'
            WHEN high_vol_ratio >= 0.6 THEN 'HIGH_VOL'
            WHEN low_vol_ratio >= 0.6 THEN 'LOW_VOL'
            WHEN breakout_ratio >= 0.4 THEN 'BREAKOUT'
            ELSE 'MIXED'
          END AS phase_label
        FROM stats
      )

      INSERT INTO market_phase_profiles (
        profile_start,
        profile_end,
        symbol,
        test_type,
        strategy_version,

        trades,

        trend_ratio,
        range_ratio,
        high_vol_ratio,
        low_vol_ratio,
        breakout_ratio,
        pullback_ratio,

        avg_atr_ratio,
        avg_trend_strength,
        avg_volume_ratio,
        avg_spread,
        avg_slippage,

        winrate,
        profit_factor,
        total_profit,
        avg_profit,
        avg_profit_r,

        phase_label
      )
      SELECT
        $2::date,
        $3::date,
        $1,
        $4,
        $5,

        trades,

        trend_ratio,
        range_ratio,
        high_vol_ratio,
        low_vol_ratio,
        breakout_ratio,
        pullback_ratio,

        avg_atr_ratio,
        avg_trend_strength,
        avg_volume_ratio,
        avg_spread,
        avg_slippage,

        winrate,
        profit_factor,
        total_profit,
        avg_profit,
        avg_profit_r,

        phase_label
      FROM labeled

      ON CONFLICT (profile_start, profile_end, symbol, test_type, strategy_version)
      DO UPDATE SET
        trades = EXCLUDED.trades,

        trend_ratio = EXCLUDED.trend_ratio,
        range_ratio = EXCLUDED.range_ratio,
        high_vol_ratio = EXCLUDED.high_vol_ratio,
        low_vol_ratio = EXCLUDED.low_vol_ratio,
        breakout_ratio = EXCLUDED.breakout_ratio,
        pullback_ratio = EXCLUDED.pullback_ratio,

        avg_atr_ratio = EXCLUDED.avg_atr_ratio,
        avg_trend_strength = EXCLUDED.avg_trend_strength,
        avg_volume_ratio = EXCLUDED.avg_volume_ratio,
        avg_spread = EXCLUDED.avg_spread,
        avg_slippage = EXCLUDED.avg_slippage,

        winrate = EXCLUDED.winrate,
        profit_factor = EXCLUDED.profit_factor,
        total_profit = EXCLUDED.total_profit,
        avg_profit = EXCLUDED.avg_profit,
        avg_profit_r = EXCLUDED.avg_profit_r,

        phase_label = EXCLUDED.phase_label,
        created_at = NOW()

      RETURNING *;
      `,
      [symbol, profileStart, profileEnd, testType, strategyVersion]
    );

    return res.json({
      ok: true,
      message: "Market phase profile generated",
      profile: report.rows[0]
    });

  } catch (err: any) {
    console.error("DB_ERROR_MARKET_PHASE_PROFILE:", err);

    return res.status(500).json({
      ok: false,
      reason: "DB_ERROR",
      message: err.message,
      detail: err.detail,
      table: err.table,
      column: err.column
    });
  }
});

app.post("/ai/analyze", async (req, res) => {
  const { symbol } = req.body;

  if (!symbol) {
    return res.status(400).json({
      ok: false,
      reason: "symbol required"
    });
  }

  try {
    const analysis = await analyzeTradingSystem(symbol);

    return res.json({
      ok: true,
      analysis
    });
  } catch (err: any) {
    console.error("AI_ANALYSIS_ERROR:", err);

    return res.status(500).json({
      ok: false,
      reason: "AI_ERROR",
      message: err.message
    });
  }
});

const strategyReviewSchema = z.object({
  symbol: z.string().min(1),
  strategyVersion: z.string().min(1),
});

app.post("/ai/strategy-review", checkApiKey, async (req, res) => {
  const result = strategyReviewSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      ok: false,
      reason: "VALIDATION_FAILED",
      errors: result.error.flatten(),
    });
  }

  const { symbol, strategyVersion } = result.data;

  try {
    const review = await reviewStrategyWithAi(symbol, strategyVersion);

    return res.json({
      ok: true,
      review,
    });
  } catch (err: any) {
    console.error("AI strategy review failed:", err);

    return res.status(500).json({
      ok: false,
      reason: "AI_STRATEGY_REVIEW_FAILED",
      error: err.message,
    });
  }
});

cron.schedule("0 0 * * *", async () => {
  const analysis = await analyzeTradingSystem("SILVER");
  console.log("Daily AI analysis:", analysis);
});

cron.schedule("5 0 * * *", async () => {
  try {
    const symbol = "SILVER";
    const strategyVersion = "v1.0";
    const testType = "FORWARD";

    const profileEnd = new Date();
    const profileStart = new Date();

    profileStart.setDate(profileEnd.getDate() - 30);

    const formatDate = (d: Date) => d.toISOString().slice(0, 10);

    const body = {
      symbol,
      profileStart: formatDate(profileStart),
      profileEnd: formatDate(profileEnd),
      testType,
      strategyVersion,
    };

    const response = await fetch("http://127.0.0.1:3000/market-phase-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.API_KEY!,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    console.log("Forward market phase profile generated:", result);
  } catch (err) {
    console.error("Forward market phase profile cron failed:", err);
  }
});

app.listen(process.env.PORT, () => {
  console.log(`API läuft auf Port ${process.env.PORT}`);
});