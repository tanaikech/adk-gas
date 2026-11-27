/**
 * GeminiDecisionsRouter
 * Author: Kanshi Tanaike
 * Version: 2.1.1
 * Description: Zero-dependency, data-driven Gemini Decisions API (gemini-decision-1)
 * dynamic model & thinkingLevel router for GASADK and standalone Gemini GAS libraries.
 * Supports 6-model default pool (gemini-3.5-flash-lite, gemini-3.8-flash,
 * gemini-4-hydrogen, gemini-4-neon, gemini-4-argon, gemini-4-carbon),
 * external future-model customization, JSON comparison export, GAS 6-min timeout
 * guardrails, Free-Tier auto-fallback, and per-generation routing logs.
 */
var GeminiDecisionsRouter =
  typeof GeminiDecisionsRouter !== "undefined"
    ? GeminiDecisionsRouter
    : class GeminiDecisionsRouter {
        static get VERSION() {
          return "2.1.1";
        }

        static get DECISIONS_ENDPOINT() {
          return "https://generativelanguage.googleapis.com/v1beta/decisions";
        }

        static _deepClone(obj) {
          if (obj === null || typeof obj !== "object") return obj;
          return JSON.parse(JSON.stringify(obj));
        }

        static _deepMerge(target, source) {
          const out = GeminiDecisionsRouter._deepClone(target || {});
          if (!source || typeof source !== "object") return out;
          Object.keys(source).forEach((key) => {
            const val = source[key];
            if (
              val &&
              typeof val === "object" &&
              !Array.isArray(val) &&
              out[key] &&
              typeof out[key] === "object" &&
              !Array.isArray(out[key])
            ) {
              out[key] = GeminiDecisionsRouter._deepMerge(out[key], val);
            } else if (val !== undefined) {
              out[key] = GeminiDecisionsRouter._deepClone(val);
            }
          });
          return out;
        }

        static normalizeModelName(model) {
          const s = String(model || "").trim();
          if (!s) return "models/gemini-4-hydrogen";
          return s.startsWith("models/") ? s : `models/${s}`;
        }

        static _getBaseModelCatalog() {
          return {
            "models/gemini-3.5-flash-lite": {
              tier: "lite",
              supportedThinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"],
              defaultThinkingLevel: "MEDIUM",
              supportsThinkingBudget: false,
              paidOnly: false,
              notes: "Ultra-low-cost, high-volume Flash-Lite model ($0.30/$2.50 per 1M).",
            },
            "models/gemini-3.8-flash": {
              tier: "fast",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
              defaultThinkingLevel: "MEDIUM",
              supportsThinkingBudget: false,
              paidOnly: false,
              notes: "High-speed Flash workhorse ($0.75/$3.75 thru 2026-12-31, $1.50/$7.50 from 2027-01-01).",
            },
            "models/gemini-4-hydrogen": {
              tier: "workhorse",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"],
              defaultThinkingLevel: "HIGH",
              supportsThinkingBudget: false,
              paidOnly: false,
              notes: "Fast, cost-efficient Gemini 4 workhorse ($1.50/$7.50 per 1M, Free tier available).",
            },
            "models/gemini-4-neon": {
              tier: "premium",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"],
              defaultThinkingLevel: "HIGH",
              supportsThinkingBudget: false,
              paidOnly: true,
              notes: "Balanced high-efficiency frontier model ($3.00/$15.00 per 1M, Paid only).",
            },
            "models/gemini-4-argon": {
              tier: "frontierFast",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
              defaultThinkingLevel: "MEDIUM",
              supportsThinkingBudget: false,
              paidOnly: true,
              notes: "Fast, lower-thinking-token frontier reasoning model ($4.00/$20.00 from 2026-12-01, Paid only, no XHIGH).",
            },
            "models/gemini-4-carbon": {
              tier: "frontierMax",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
              defaultThinkingLevel: "MEDIUM",
              supportsThinkingBudget: false,
              paidOnly: true,
              notes: "Flagship strongest frontier reasoning model ($4.00/$20.00 from 2026-12-01, Paid only, no XHIGH).",
            },
          };
        }

        static _getBaseModelPool() {
          return {
            lite: "models/gemini-3.5-flash-lite",
            fast: "models/gemini-3.8-flash",
            workhorse: "models/gemini-4-hydrogen",
            premium: "models/gemini-4-neon",
            frontierFast: "models/gemini-4-argon",
            frontierMax: "models/gemini-4-carbon",
          };
        }

        static _getBaseRoutingMatrix() {
          return {
            efficient: {
              trivial: {
                default: { tier: "lite", thinkingLevel: "MINIMAL" },
                withTools: { tier: "lite", thinkingLevel: "LOW" },
                synthesizer: { tier: "lite", thinkingLevel: "MINIMAL" },
              },
              standard: {
                default: { tier: "lite", thinkingLevel: "LOW" },
                withTools: { tier: "fast", thinkingLevel: "LOW" },
                synthesizer: { tier: "lite", thinkingLevel: "LOW" },
                deep: { tier: "workhorse", thinkingLevel: "LOW" },
              },
              complex: {
                default: { tier: "workhorse", thinkingLevel: "LOW" },
                withTools: { tier: "workhorse", thinkingLevel: "LOW" },
                synthesizer: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                deep: { tier: "workhorse", thinkingLevel: "MEDIUM" },
              },
              frontier: {
                default: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                withTools: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "frontierFast", thinkingLevel: "HIGH" },
                direct: { tier: "frontierFast", thinkingLevel: "HIGH" },
              },
              max_capability_override: {
                default: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                withTools: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "frontierMax", thinkingLevel: "HIGH" },
                direct: { tier: "frontierMax", thinkingLevel: "HIGH" },
              },
            },
            quality: {
              trivial: {
                default: { tier: "workhorse", thinkingLevel: "LOW" },
                withTools: { tier: "workhorse", thinkingLevel: "LOW" },
                synthesizer: { tier: "workhorse", thinkingLevel: "MEDIUM" },
              },
              standard: {
                default: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                withTools: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "premium", thinkingLevel: "MEDIUM" },
                direct: { tier: "premium", thinkingLevel: "MEDIUM" },
              },
              complex: {
                default: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                withTools: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "premium", thinkingLevel: "HIGH" },
                direct: { tier: "frontierFast", thinkingLevel: "HIGH" },
              },
              frontier: {
                default: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                withTools: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "frontierMax", thinkingLevel: "HIGH" },
                direct: { tier: "frontierMax", thinkingLevel: "HIGH" },
              },
              max_capability_override: {
                default: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                withTools: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "frontierMax", thinkingLevel: "HIGH" },
                direct: { tier: "frontierMax", thinkingLevel: "HIGH" },
              },
            },
          };
        }

        static _getBaseDefaults() {
          return {
            mode: "efficient",
            billingTier: "auto",
            decisionModel: "gemini-decision-1",
            maxInputChars: 3000,
            allowXHighInGas: false,
            respectExplicitThinkingConfig: true,
            allowClientRoutingHints: false,
            cacheEnabled: true,
            logRouting: true,
            maxCapabilityThreshold: 0.65,
            deepThinkingThreshold: 0.65,
          };
        }

        static _ensureRegistry() {
          if (!GeminiDecisionsRouter._registry) {
            GeminiDecisionsRouter._registry = {
              defaults: GeminiDecisionsRouter._getBaseDefaults(),
              modelCatalog: GeminiDecisionsRouter._getBaseModelCatalog(),
              modelPool: GeminiDecisionsRouter._getBaseModelPool(),
              routingMatrix: GeminiDecisionsRouter._getBaseRoutingMatrix(),
            };
          }
          if (!GeminiDecisionsRouter._cache) {
            GeminiDecisionsRouter._cache = new Map();
          }
          if (!GeminiDecisionsRouter._unavailablePaidModels) {
            GeminiDecisionsRouter._unavailablePaidModels = new Set();
          }
          if (GeminiDecisionsRouter._decisionsCircuitOpen === undefined) {
            GeminiDecisionsRouter._decisionsCircuitOpen = false;
          }
        }

        /**
         * Globally registers or updates custom model capability definitions for future models.
         * @param {Object<string, Object>} modelsMap
         */
        static registerModels(modelsMap = {}) {
          GeminiDecisionsRouter._ensureRegistry();
          if (!modelsMap || typeof modelsMap !== "object") return;
          Object.keys(modelsMap).forEach((rawKey) => {
            const normKey = GeminiDecisionsRouter.normalizeModelName(rawKey);
            GeminiDecisionsRouter._registry.modelCatalog[normKey] =
              GeminiDecisionsRouter._deepMerge(
                GeminiDecisionsRouter._registry.modelCatalog[normKey] || {},
                modelsMap[rawKey],
              );
          });
        }

        /**
         * Globally customizes default routing settings, modelCatalog, modelPool, and/or routingMatrix.
         * Accepts the same JSON schema exported by getRoutingConfigSummary().
         * @param {Object} customConfig
         */
        static configureDefaults(customConfig = {}) {
          GeminiDecisionsRouter._ensureRegistry();
          if (!customConfig || typeof customConfig !== "object") return;
          const reg = GeminiDecisionsRouter._registry;
          if (customConfig.modelCatalog) {
            GeminiDecisionsRouter.registerModels(customConfig.modelCatalog);
          }
          if (customConfig.modelPool) {
            Object.keys(customConfig.modelPool).forEach((tier) => {
              if (customConfig.modelPool[tier]) {
                reg.modelPool[tier] = GeminiDecisionsRouter.normalizeModelName(
                  customConfig.modelPool[tier],
                );
              }
            });
          }
          if (customConfig.routingMatrix) {
            reg.routingMatrix = GeminiDecisionsRouter._deepMerge(
              reg.routingMatrix,
              customConfig.routingMatrix,
            );
          }
          const scalarKeys = Object.keys(GeminiDecisionsRouter._getBaseDefaults());
          scalarKeys.forEach((k) => {
            if (customConfig[k] !== undefined) {
              reg.defaults[k] = customConfig[k];
            }
          });
          if (customConfig.activeMode && !customConfig.mode) {
            reg.defaults.mode = customConfig.activeMode;
          }
          GeminiDecisionsRouter._cache.clear();
        }

        /**
         * Resets global registry, cache, and circuit breakers back to built-in defaults.
         */
        static resetDefaults() {
          GeminiDecisionsRouter._registry = null;
          GeminiDecisionsRouter._cache = new Map();
          GeminiDecisionsRouter._unavailablePaidModels = new Set();
          GeminiDecisionsRouter._decisionsCircuitOpen = false;
          GeminiDecisionsRouter._ensureRegistry();
        }

        static markPaidModelUnavailable(model) {
          GeminiDecisionsRouter._ensureRegistry();
          GeminiDecisionsRouter._unavailablePaidModels.add(
            GeminiDecisionsRouter.normalizeModelName(model),
          );
        }

        static isPaidOnlyModel(model, catalog) {
          const norm = GeminiDecisionsRouter.normalizeModelName(model);
          const entry = catalog && catalog[norm];
          return Boolean(entry && entry.paidOnly);
        }

        static normalizeRoutingConfig(rawConfig) {
          GeminiDecisionsRouter._ensureRegistry();
          const reg = GeminiDecisionsRouter._registry;
          const base = {
            ...GeminiDecisionsRouter._deepClone(reg.defaults),
            modelCatalog: GeminiDecisionsRouter._deepClone(reg.modelCatalog),
            modelPool: GeminiDecisionsRouter._deepClone(reg.modelPool),
            routingMatrix: GeminiDecisionsRouter._deepClone(reg.routingMatrix),
          };
          if (rawConfig === undefined || rawConfig === null) {
            return base;
          }
          if (typeof rawConfig === "string") {
            const m = rawConfig.trim().toLowerCase();
            if (m === "fixed" || m === "efficient" || m === "efficiency" || m === "quality" || m === "max_quality") {
              base.mode = m === "efficiency" ? "efficient" : m === "max_quality" ? "quality" : m;
            }
            return base;
          }
          if (typeof rawConfig === "object") {
            const modeRaw = rawConfig.mode || rawConfig.activeMode;
            if (typeof modeRaw === "string") {
              const m = modeRaw.trim().toLowerCase();
              if (m === "fixed" || m === "efficient" || m === "efficiency" || m === "quality" || m === "max_quality") {
                base.mode = m === "efficiency" ? "efficient" : m === "max_quality" ? "quality" : m;
              }
            }
            Object.keys(reg.defaults).forEach((k) => {
              if (k !== "mode" && rawConfig[k] !== undefined) {
                base[k] = rawConfig[k];
              }
            });
            if (rawConfig.modelCatalog && typeof rawConfig.modelCatalog === "object") {
              Object.keys(rawConfig.modelCatalog).forEach((mk) => {
                const normKey = GeminiDecisionsRouter.normalizeModelName(mk);
                base.modelCatalog[normKey] = GeminiDecisionsRouter._deepMerge(
                  base.modelCatalog[normKey] || {},
                  rawConfig.modelCatalog[mk],
                );
              });
            }
            if (rawConfig.modelPool && typeof rawConfig.modelPool === "object") {
              Object.keys(rawConfig.modelPool).forEach((tk) => {
                if (rawConfig.modelPool[tk]) {
                  base.modelPool[tk] = GeminiDecisionsRouter.normalizeModelName(
                    rawConfig.modelPool[tk],
                  );
                }
              });
            }
            if (rawConfig.routingMatrix && typeof rawConfig.routingMatrix === "object") {
              base.routingMatrix = GeminiDecisionsRouter._deepMerge(
                base.routingMatrix,
                rawConfig.routingMatrix,
              );
            }
          }
          return base;
        }

        static getModelCapabilities(model, catalog) {
          const norm = GeminiDecisionsRouter.normalizeModelName(model);
          if (catalog && catalog[norm]) {
            return { ...catalog[norm], registered: true };
          }
          if (/(?:^|\/)gemini-2\.5/i.test(norm)) {
            return {
              tier: "legacy",
              supportedThinkingLevels: [],
              defaultThinkingLevel: null,
              supportsThinkingBudget: true,
              paidOnly: false,
              registered: false,
            };
          }
          if (/(?:^|\/)gemini-(?:2\.0|1\.5|1\.0)/i.test(norm)) {
            return {
              tier: "legacy",
              supportedThinkingLevels: [],
              defaultThinkingLevel: null,
              supportsThinkingBudget: false,
              paidOnly: false,
              registered: false,
            };
          }
          // Safe heuristic for unregistered future Gemini 3/4/5+ models
          return {
            tier: "custom",
            supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
            defaultThinkingLevel: "MEDIUM",
            supportsThinkingBudget: false,
            paidOnly: false,
            registered: false,
          };
        }

        /**
         * Normalizes & clamps thinkingConfig for the target model to prevent HTTP 400 errors.
         */
        static normalizeThinkingConfig(model, desiredLevel, existingGenConfig, catalog, options = {}) {
          const normModel = GeminiDecisionsRouter.normalizeModelName(model);
          const caps = GeminiDecisionsRouter.getModelCapabilities(normModel, catalog);
          const genConfig = existingGenConfig ? GeminiDecisionsRouter._deepClone(existingGenConfig) : {};
          const allowXHighInGas = Boolean(options.allowXHighInGas);

          // Strip Gemini 4+ unsupported generationConfig parameters
          if (/(?:^|\/)gemini-[4-9](?:[-.]|$)/i.test(normModel)) {
            delete genConfig.frequencyPenalty;
            delete genConfig.frequency_penalty;
            delete genConfig.presencePenalty;
            delete genConfig.presence_penalty;
            delete genConfig.candidateCount;
            delete genConfig.candidate_count;
          }

          let level = desiredLevel ? String(desiredLevel).toUpperCase() : null;
          if (!level && genConfig.thinkingConfig && genConfig.thinkingConfig.thinkingLevel) {
            level = String(genConfig.thinkingConfig.thinkingLevel).toUpperCase();
          }

          // Handle models supporting thinkingLevel (Gemini 3 / 3.5 / 3.8 / 4 / future)
          if (caps.supportedThinkingLevels && caps.supportedThinkingLevels.length > 0) {
            const supported = caps.supportedThinkingLevels.map((l) => String(l).toUpperCase());
            if (genConfig.thinkingConfig && genConfig.thinkingConfig.thinkingBudget !== undefined) {
              const oldBudget = genConfig.thinkingConfig.thinkingBudget;
              delete genConfig.thinkingConfig.thinkingBudget;
              if (!level && oldBudget === 0) level = "LOW";
            }
            if (level) {
              if (level === "XHIGH" && !allowXHighInGas) {
                level = "HIGH";
              }
              if (!supported.includes(level)) {
                const order = ["MINIMAL", "LOW", "MEDIUM", "HIGH", "XHIGH"];
                const idx = order.indexOf(level);
                if (idx !== -1) {
                  // Clamp down first, then up if lower not supported (e.g. MINIMAL -> LOW)
                  let resolved = null;
                  for (let i = idx - 1; i >= 0; i--) {
                    if (supported.includes(order[i])) {
                      resolved = order[i];
                      break;
                    }
                  }
                  if (!resolved) {
                    for (let i = idx + 1; i < order.length; i++) {
                      if (supported.includes(order[i])) {
                        resolved = order[i];
                        break;
                      }
                    }
                  }
                  level = resolved || caps.defaultThinkingLevel || supported[0];
                } else {
                  level = caps.defaultThinkingLevel || supported[0];
                }
              }
              genConfig.thinkingConfig = {
                ...(genConfig.thinkingConfig || {}),
                thinkingLevel: level,
              };
            }
            return { generationConfig: genConfig, resolvedThinkingLevel: level || caps.defaultThinkingLevel || null };
          }

          // Handle Gemini 2.5 models (thinkingBudget only)
          if (caps.supportsThinkingBudget) {
            const budgetMap = { MINIMAL: 0, LOW: 1024, MEDIUM: 8192, HIGH: 16384, XHIGH: 24576 };
            if (genConfig.thinkingConfig && genConfig.thinkingConfig.thinkingLevel) {
              delete genConfig.thinkingConfig.thinkingLevel;
            }
            if (level && budgetMap[level] !== undefined) {
              genConfig.thinkingConfig = {
                ...(genConfig.thinkingConfig || {}),
                thinkingBudget: budgetMap[level],
              };
              return { generationConfig: genConfig, resolvedThinkingLevel: `budget:${budgetMap[level]}` };
            }
            return { generationConfig: genConfig, resolvedThinkingLevel: null };
          }

          // Older models without thinkingConfig
          delete genConfig.thinkingConfig;
          return { generationConfig: genConfig, resolvedThinkingLevel: null };
        }

        static _resolveMatrixSlot(matrixForMode, complexity, role, hasTools, deepThinking) {
          const compEntry = (matrixForMode && matrixForMode[complexity]) || (matrixForMode && matrixForMode.standard) || {};
          const roleNorm = String(role || "default").toLowerCase();
          if (roleNorm === "synthesizer" || roleNorm === "a2a_synthesizer" || roleNorm === "mcp_summarizer") {
            if (compEntry.synthesizer) return compEntry.synthesizer;
          }
          if (roleNorm === "direct" && compEntry.direct) {
            return compEntry.direct;
          }
          if (deepThinking && compEntry.deep) {
            return compEntry.deep;
          }
          if (hasTools && compEntry.withTools) {
            return compEntry.withTools;
          }
          return compEntry.default || { tier: "workhorse", thinkingLevel: "LOW" };
        }

        static _applyBillingAndTimeGuards(targetModel, targetLevel, cfg, remainingMs) {
          let model = GeminiDecisionsRouter.normalizeModelName(targetModel);
          let level = targetLevel;
          let guardReason = null;
          const workhorse = GeminiDecisionsRouter.normalizeModelName(
            cfg.modelPool.workhorse || "models/gemini-4-hydrogen",
          );

          // Free-tier or runtime-detected Paid-only downgrade
          const isPaid = GeminiDecisionsRouter.isPaidOnlyModel(model, cfg.modelCatalog);
          if (
            isPaid &&
            (cfg.billingTier === "free" ||
              (cfg.billingTier === "auto" &&
                GeminiDecisionsRouter._unavailablePaidModels.has(model)))
          ) {
            model = workhorse;
            level = level === "MEDIUM" || level === "HIGH" || level === "XHIGH" ? "HIGH" : level;
            guardReason = "free_tier_fallback";
          }

          // GAS 6-minute remaining-time guard (null/NaN safe)
          if (typeof remainingMs === "number" && Number.isFinite(remainingMs) && remainingMs > 0) {
            if (remainingMs < 45000) {
              if (GeminiDecisionsRouter.isPaidOnlyModel(model, cfg.modelCatalog)) {
                model = workhorse;
              }
              if (level === "XHIGH" || level === "HIGH" || level === "MEDIUM") {
                level = "LOW";
              }
              guardReason = guardReason ? `${guardReason}+gas_time_guard_45s` : "gas_time_guard_45s";
            } else if (remainingMs < 90000) {
              if (model === GeminiDecisionsRouter.normalizeModelName(cfg.modelPool.frontierMax)) {
                model = GeminiDecisionsRouter.normalizeModelName(
                  cfg.modelPool.frontierFast || workhorse,
                );
                level = "MEDIUM";
                guardReason = guardReason ? `${guardReason}+gas_time_guard_90s` : "gas_time_guard_90s";
              } else if (level === "XHIGH") {
                level = "HIGH";
                guardReason = guardReason ? `${guardReason}+gas_time_guard_90s` : "gas_time_guard_90s";
              }
            }
          }

          return { model, level, guardReason };
        }

        static buildBoundedInput(prompt, maxInputChars = 3000) {
          const cap = Math.max(256, Number(maxInputChars) || 3000);
          let raw = "";
          if (typeof prompt === "string") {
            raw = prompt;
          } else if (prompt !== null && prompt !== undefined) {
            try {
              raw = JSON.stringify(prompt);
            } catch (_) {
              raw = String(prompt);
            }
          }
          // Strip inline base64 data URIs or long base64 blobs
          raw = raw.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]{100,}/g, "[BASE64_OMITTED]");
          raw = raw.replace(/[A-Za-z0-9+/]{512,}={0,2}/g, "[LARGE_BLOB_OMITTED]");
          raw = raw.trim();

          if (raw.length <= cap) {
            return raw || "(empty prompt)";
          }
          const headLen = Math.floor(cap * 0.65);
          const tailLen = Math.max(32, cap - headLen - 20);
          return (
            raw.slice(0, headLen) +
            "\n...[TRUNCATED]...\n" +
            raw.slice(raw.length - tailLen)
          );
        }

        static _buildDecisionsQuestions() {
          return {
            max_capability_override: {
              type: "noul",
              instructions:
                "Does the user prompt explicitly request maximum AI capability, highest possible quality, or deepest thinking (in any language, e.g., 'use maximum capability', 'think as deeply as possible', 'best possible model', '最大の能力で実行', '全力で考えて', '最高精度で')?",
            },
            task_complexity: {
              type: "choice",
              instructions:
                "Classify the reasoning and execution complexity required to answer this prompt accurately.",
              criteria: {
                trivial:
                  "Simple greeting, trivial factual lookup, basic formatting, or single-step extraction.",
                standard:
                  "Routine Q&A, summarization, standard Google Workspace MCP/tool call, or straightforward email/text drafting.",
                complex:
                  "Multi-step analysis, non-trivial coding/debugging, comparative evaluation, or multi-tool orchestration.",
                frontier:
                  "Deep mathematical proof, complex software architecture, security/legal audit, or frontier scientific reasoning.",
              },
            },
            requires_deep_thinking: {
              type: "noul",
              instructions:
                "Does solving this task reliably require multi-step internal reasoning or self-verification?",
            },
          };
        }

        static _normalizeAnswer(raw) {
          const ans = raw || {};
          const noul =
            typeof ans.noul === "number"
              ? ans.noul
              : typeof ans.probability === "number"
                ? ans.probability
                : null;
          const choice =
            typeof ans.choice === "string"
              ? ans.choice
              : typeof ans.selected === "string"
                ? ans.selected
                : typeof ans.value === "string"
                  ? ans.value
                  : null;
          return { noul, choice, confidence: typeof ans.confidence === "number" ? ans.confidence : null };
        }

        static _callDecisionsApi(apiKey, sharedInput, decisionModel) {
          if (typeof UrlFetchApp === "undefined") {
            throw new Error("UrlFetchApp is unavailable in this environment.");
          }
          const payload = {
            model: decisionModel || "gemini-decision-1",
            input: sharedInput,
            questions: GeminiDecisionsRouter._buildDecisionsQuestions(),
          };
          const t0 = Date.now();
          const res = UrlFetchApp.fetch(GeminiDecisionsRouter.DECISIONS_ENDPOINT, {
            method: "post",
            contentType: "application/json",
            headers: { "x-goog-api-key": apiKey },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true,
          });
          const latencyMs = Date.now() - t0;
          const code = res.getResponseCode();
          const rawText = res.getContentText();
          if (code < 200 || code >= 300) {
            const err = new Error(`Decisions API HTTP ${code}: ${String(rawText || "").slice(0, 300)}`);
            err.statusCode = code;
            throw err;
          }
          const body = JSON.parse(rawText);
          const rawAnswers = body.answers || body.decisions || {};
          const usage = body.usage || body.usageMetadata || {};
          const inputTokens =
            typeof usage.totalInputTokens === "number"
              ? usage.totalInputTokens
              : typeof usage.total_input_tokens === "number"
                ? usage.total_input_tokens
                : typeof usage.promptTokenCount === "number"
                  ? usage.promptTokenCount
                  : 0;
          return {
            answers: {
              max_capability_override: GeminiDecisionsRouter._normalizeAnswer(
                rawAnswers.max_capability_override,
              ),
              task_complexity: GeminiDecisionsRouter._normalizeAnswer(
                rawAnswers.task_complexity,
              ),
              requires_deep_thinking: GeminiDecisionsRouter._normalizeAnswer(
                rawAnswers.requires_deep_thinking,
              ),
            },
            inputTokens,
            latencyMs,
          };
        }

        static _hashString(str) {
          let h = 2166136261;
          for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return (h >>> 0).toString(16);
        }

        static formatLogMessage(decision) {
          const d = decision || {};
          const agentPart = d.agent ? `agent=${d.agent} | ` : "";
          const thinkLabel = d.thinkingLevel || "default";
          const msPart =
            typeof d.decisionsLatencyMs === "number" && d.decisionsLatencyMs >= 0
              ? ` (decisions=${d.decisionsLatencyMs}ms)`
              : "";
          return `[ModelRouting] ${agentPart}role=${d.role || "default"} | mode=${d.mode || "fixed"} | model=${d.model} | thinking=${thinkLabel} | reason=${d.reason || "configured"}${msPart}`;
        }

        /**
         * Resolves model & thinkingConfig for a generation call.
         * Always fails open to configuredModel on any auth/network/API error.
         */
        static route(params = {}) {
          GeminiDecisionsRouter._ensureRegistry();
          const cfg = GeminiDecisionsRouter.normalizeRoutingConfig(params.modelRouting);
          const agentName = params.agentName || null;
          const role = params.role || "default";
          const hasTools = Boolean(params.hasTools);
          const configuredModel = GeminiDecisionsRouter.normalizeModelName(
            params.configuredModel || "models/gemini-4-hydrogen",
          );
          const existingGenConfig = params.configuredGenerationConfig || null;
          const hasExplicitThinking = Boolean(
            existingGenConfig &&
              existingGenConfig.thinkingConfig &&
              (existingGenConfig.thinkingConfig.thinkingLevel !== undefined ||
                existingGenConfig.thinkingConfig.thinkingBudget !== undefined),
          );

          const emitAndReturn = (model, generationConfig, decision) => {
            if (cfg.logRouting !== false) {
              const msg = GeminiDecisionsRouter.formatLogMessage(decision);
              if (typeof params.onLog === "function") {
                params.onLog(msg, decision);
              } else if (params.consoleLogFallback && typeof console !== "undefined") {
                console.log(msg);
              }
            }
            return { model, generationConfig, routingDecision: decision };
          };

          // Mode: fixed -> zero Decisions API calls
          if (cfg.mode === "fixed") {
            const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
              configuredModel,
              null,
              existingGenConfig,
              cfg.modelCatalog,
              { allowXHighInGas: cfg.allowXHighInGas },
            );
            return emitAndReturn(configuredModel, norm.generationConfig, {
              agent: agentName,
              role,
              mode: "fixed",
              model: configuredModel,
              thinkingLevel: norm.resolvedThinkingLevel,
              thinkingConfig: norm.generationConfig.thinkingConfig || null,
              complexity: null,
              maxCapabilityOverride: false,
              decisionsLatencyMs: null,
              decisionsInputTokens: 0,
              reason: "fixed_mode",
              fallbackReason: null,
            });
          }

          // Fail-open if apiKey absent (OAuth-only) or circuit breaker tripped
          if (!params.apiKey || GeminiDecisionsRouter._decisionsCircuitOpen) {
            const fallbackReason = !params.apiKey ? "missing_api_key_oauth_only" : "decisions_circuit_open";
            const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
              configuredModel,
              null,
              existingGenConfig,
              cfg.modelCatalog,
              { allowXHighInGas: cfg.allowXHighInGas },
            );
            return emitAndReturn(configuredModel, norm.generationConfig, {
              agent: agentName,
              role,
              mode: cfg.mode,
              model: configuredModel,
              thinkingLevel: norm.resolvedThinkingLevel,
              thinkingConfig: norm.generationConfig.thinkingConfig || null,
              complexity: null,
              maxCapabilityOverride: Boolean(params.forceMaxCapability),
              decisionsLatencyMs: null,
              decisionsInputTokens: 0,
              reason: `fallback:${fallbackReason}`,
              fallbackReason,
            });
          }

          const boundedInput = GeminiDecisionsRouter.buildBoundedInput(
            params.prompt,
            cfg.maxInputChars,
          );
          // Key Decisions evaluation cache strictly by (decisionModel, promptHash) so
          // Planner -> Synthesizer and previewModelRouting() reuse a single Decisions API call.
          const cacheKey = `${cfg.decisionModel}|${GeminiDecisionsRouter._hashString(boundedInput)}`;

          let evalResult = null;
          let cacheHit = false;
          if (cfg.cacheEnabled && GeminiDecisionsRouter._cache.has(cacheKey)) {
            evalResult = GeminiDecisionsRouter._cache.get(cacheKey);
            cacheHit = true;
          } else {
            try {
              evalResult = GeminiDecisionsRouter._callDecisionsApi(
                params.apiKey,
                boundedInput,
                cfg.decisionModel,
              );
              if (cfg.cacheEnabled) {
                GeminiDecisionsRouter._cache.set(cacheKey, evalResult);
              }
            } catch (err) {
              if (err && (err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 404)) {
                GeminiDecisionsRouter._decisionsCircuitOpen = true;
              }
              const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
                configuredModel,
                null,
                existingGenConfig,
                cfg.modelCatalog,
                { allowXHighInGas: cfg.allowXHighInGas },
              );
              return emitAndReturn(configuredModel, norm.generationConfig, {
                agent: agentName,
                role,
                mode: cfg.mode,
                model: configuredModel,
                thinkingLevel: norm.resolvedThinkingLevel,
                thinkingConfig: norm.generationConfig.thinkingConfig || null,
                complexity: null,
                maxCapabilityOverride: Boolean(params.forceMaxCapability),
                decisionsLatencyMs: null,
                decisionsInputTokens: 0,
                reason: "fallback:decisions_api_error",
                fallbackReason: err.message,
              });
            }
          }

          const maxCapProb = evalResult.answers.max_capability_override.noul || 0;
          const deepProb = evalResult.answers.requires_deep_thinking.noul || 0;
          const maxCapOverride =
            Boolean(params.forceMaxCapability) || maxCapProb >= cfg.maxCapabilityThreshold;
          const rawComplexity = evalResult.answers.task_complexity.choice || "standard";
          const effectiveComplexity = maxCapOverride ? "max_capability_override" : rawComplexity;
          const deepThinking = deepProb >= cfg.deepThinkingThreshold;

          const matrixForMode = cfg.routingMatrix[cfg.mode] || cfg.routingMatrix.efficient;
          const slot = GeminiDecisionsRouter._resolveMatrixSlot(
            matrixForMode,
            effectiveComplexity,
            role,
            hasTools,
            deepThinking,
          );
          const pooledModel =
            (slot.model && GeminiDecisionsRouter.normalizeModelName(slot.model)) ||
            cfg.modelPool[slot.tier] ||
            configuredModel;

          const guarded = GeminiDecisionsRouter._applyBillingAndTimeGuards(
            pooledModel,
            slot.thinkingLevel,
            cfg,
            params.remainingMs,
          );

          const desiredLevel =
            hasExplicitThinking && cfg.respectExplicitThinkingConfig && !maxCapOverride
              ? null
              : guarded.level;

          const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
            guarded.model,
            desiredLevel,
            existingGenConfig,
            cfg.modelCatalog,
            { allowXHighInGas: cfg.allowXHighInGas },
          );

          let reason = maxCapOverride
            ? "max_capability_override"
            : `task_complexity:${rawComplexity}${deepThinking ? "+deep" : ""}`;
          if (guarded.guardReason) reason += ` (${guarded.guardReason})`;
          if (cacheHit) reason += " [cached]";

          return emitAndReturn(guarded.model, norm.generationConfig, {
            agent: agentName,
            role,
            mode: cfg.mode,
            model: guarded.model,
            thinkingLevel: norm.resolvedThinkingLevel,
            thinkingConfig: norm.generationConfig.thinkingConfig || null,
            complexity: rawComplexity,
            maxCapabilityOverride: maxCapOverride,
            decisionsLatencyMs: cacheHit ? 0 : evalResult.latencyMs,
            decisionsInputTokens: cacheHit ? 0 : evalResult.inputTokens,
            reason,
            fallbackReason: null,
          });
        }

        /**
         * Exports a clean, zero-secret JSON comparison of current routing settings
         * across fixed, efficient, and quality modes (0 API calls).
         */
        static getRoutingConfigSummary(customConfig = null, context = {}) {
          const cfg = GeminiDecisionsRouter.normalizeRoutingConfig(customConfig);
          const configuredModel = GeminiDecisionsRouter.normalizeModelName(
            context.configuredModel || "models/gemini-4-hydrogen",
          );
          const configuredGenConfig = context.configuredGenerationConfig || null;
          const warnings = [];
          const complexities = [
            "trivial",
            "standard",
            "complex",
            "frontier",
            "max_capability_override",
          ];
          const roles = ["default", "withTools", "synthesizer", "direct"];

          // Validate modelPool against modelCatalog
          Object.keys(cfg.modelPool).forEach((tier) => {
            const m = GeminiDecisionsRouter.normalizeModelName(cfg.modelPool[tier]);
            if (!cfg.modelCatalog[m]) {
              warnings.push(`Unregistered model '${m}' in modelPool.${tier}; heuristic thinking rules will apply.`);
            }
          });

          const fixedNorm = GeminiDecisionsRouter.normalizeThinkingConfig(
            configuredModel,
            null,
            configuredGenConfig,
            cfg.modelCatalog,
            { allowXHighInGas: cfg.allowXHighInGas },
          );

          const buildModeTable = (modeName) => {
            if (modeName === "fixed") {
              return {
                usesDecisionsApi: false,
                model: configuredModel,
                thinkingLevel: fixedNorm.resolvedThinkingLevel,
                thinkingConfig: fixedNorm.generationConfig.thinkingConfig || null,
              };
            }
            const table = { usesDecisionsApi: true, decisionModel: cfg.decisionModel, routes: {} };
            const mat = cfg.routingMatrix[modeName] || {};
            complexities.forEach((comp) => {
              table.routes[comp] = {};
              roles.forEach((r) => {
                const slot = GeminiDecisionsRouter._resolveMatrixSlot(
                  mat,
                  comp,
                  r === "withTools" ? "default" : r,
                  r === "withTools",
                  false,
                );
                const rawModel =
                  (slot.model && GeminiDecisionsRouter.normalizeModelName(slot.model)) ||
                  cfg.modelPool[slot.tier] ||
                  configuredModel;
                const guarded = GeminiDecisionsRouter._applyBillingAndTimeGuards(
                  rawModel,
                  slot.thinkingLevel,
                  cfg,
                  null,
                );
                const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
                  guarded.model,
                  guarded.level,
                  null,
                  cfg.modelCatalog,
                  { allowXHighInGas: cfg.allowXHighInGas },
                );
                if (slot.thinkingLevel && norm.resolvedThinkingLevel && String(slot.thinkingLevel).toUpperCase() !== String(norm.resolvedThinkingLevel).toUpperCase()) {
                  warnings.push(
                    `${modeName}.${comp}.${r}: clamped thinkingLevel '${slot.thinkingLevel}' -> '${norm.resolvedThinkingLevel}' for ${guarded.model}`,
                  );
                }
                table.routes[comp][r] = {
                  tier: slot.tier || "custom",
                  model: guarded.model,
                  thinkingLevel: norm.resolvedThinkingLevel,
                  paidOnly: GeminiDecisionsRouter.isPaidOnlyModel(guarded.model, cfg.modelCatalog),
                };
              });
            });
            return table;
          };

          return {
            version: GeminiDecisionsRouter.VERSION,
            activeMode: cfg.mode,
            configuredModel,
            configuredGenerationConfig: configuredGenConfig
              ? GeminiDecisionsRouter._deepClone(configuredGenConfig)
              : null,
            billingTier: cfg.billingTier,
            decisionModel: cfg.decisionModel,
            allowXHighInGas: cfg.allowXHighInGas,
            maxInputChars: cfg.maxInputChars,
            respectExplicitThinkingConfig: cfg.respectExplicitThinkingConfig,
            logRouting: cfg.logRouting,
            modelPool: GeminiDecisionsRouter._deepClone(cfg.modelPool),
            modelCatalog: GeminiDecisionsRouter._deepClone(cfg.modelCatalog),
            routingMatrix: GeminiDecisionsRouter._deepClone(cfg.routingMatrix),
            modeComparison: {
              fixed: buildModeTable("fixed"),
              efficient: buildModeTable("efficient"),
              quality: buildModeTable("quality"),
            },
            warnings: Array.from(new Set(warnings)),
          };
        }

        /**
         * Dry-run preview: calls Decisions API once for a prompt and compares what
         * fixed, efficient, and quality modes would choose without executing generateContent.
         */
        static previewRouting(params = {}) {
          const baseCfg = GeminiDecisionsRouter.normalizeRoutingConfig(params.modelRouting);
          const role = params.role || "direct";
          const hasTools = Boolean(params.hasTools);
          const configuredModel = GeminiDecisionsRouter.normalizeModelName(
            params.configuredModel || "models/gemini-4-hydrogen",
          );

          const fixedRes = GeminiDecisionsRouter.route({
            ...params,
            modelRouting: { ...baseCfg, mode: "fixed", logRouting: false },
          });
          const effRes = GeminiDecisionsRouter.route({
            ...params,
            modelRouting: { ...baseCfg, mode: "efficient", logRouting: false },
          });
          const qualRes = GeminiDecisionsRouter.route({
            ...params,
            modelRouting: { ...baseCfg, mode: "quality", logRouting: false },
          });

          return {
            version: GeminiDecisionsRouter.VERSION,
            role,
            hasTools,
            configuredModel,
            activeMode: baseCfg.mode,
            comparison: {
              fixed: fixedRes.routingDecision,
              efficient: effRes.routingDecision,
              quality: qualRes.routingDecision,
            },
          };
        }
      };


var gasGlobalContext = this;

/**
 * GasHookManager.js
 * [Production Release v1.4.3]
 *
 * @description
 * A robust, extensible Hooks System engine for GASADK to register, match, execute,
 * and merge lifecycle hooks under Google Apps Script constraints.
 * Resolves functions in the injected global context, local script scope, and globalThis.
 * All logs, error messages, and comments are written in English.
 */
var GasHookManager = class GasHookManager {
  /**
   * @param {Object|Array} hooksConfig - The hooks configuration.
   */
  constructor(hooksConfig = {}) {
    this.hooks = [];
    this.globalContext = null;
    // Generate a unique session ID for the hook context
    this.sessionId = "session_" + (typeof Utilities !== "undefined" ? Utilities.getUuid() : Math.random().toString(36).substring(2));
    this._parseHooksConfig(hooksConfig);
  }

  /**
   * Sets the user's runtime global context scope (to resolve hooks defined in the caller project).
   *
   * @param {Object} context - The runtime global scope (usually 'this' from the calling script).
   */
  setGlobalContext(context) {
    this.globalContext = context;
  }

  /**
   * Parses the hooks configuration object/array into an internalized flat array of hooks.
   * Supports both nested format (Format A) and flat format (Format B).
   *
   * @param {Object|Array} hooksConfig - The hooks configuration.
   * @private
   */
  _parseHooksConfig(hooksConfig) {
    if (!hooksConfig) return;

    if (Array.isArray(hooksConfig)) {
      this.hooks = hooksConfig;
      return;
    }

    if (typeof hooksConfig === 'object') {
      for (const event in hooksConfig) {
        if (!Object.prototype.hasOwnProperty.call(hooksConfig, event)) continue;
        const items = hooksConfig[event];
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          // Format A: Nested hooks array
          if (item && Array.isArray(item.hooks)) {
            for (const nestedHook of item.hooks) {
              this.hooks.push({
                name: nestedHook.name || `${event}_hook`,
                description: nestedHook.description || item.description || "",
                event: event,
                type: nestedHook.type,
                functionName: nestedHook.functionName,
                url: nestedHook.url,
                command: nestedHook.command,
                matcher: item.matcher || nestedHook.matcher || "*",
                timeout: nestedHook.timeout || item.timeout || 10000,
                sequential: nestedHook.sequential !== undefined ? nestedHook.sequential : (item.sequential || false)
              });
            }
          } else if (item && typeof item === 'object') {
            // Format B: Flat hook object directly inside the event array
            this.hooks.push({
              name: item.name || `${event}_hook`,
              description: item.description || "",
              event: event,
              type: item.type,
              functionName: item.functionName,
              url: item.url,
              command: item.command,
              matcher: item.matcher || "*",
              timeout: item.timeout || 10000,
              sequential: item.sequential || false
            });
          }
        }
      }
    }
  }

  /**
   * Dynamically resolves a global function by string name (supporting dot notation)
   * across multiple scoped contexts.
   *
   * @param {string} functionName - Name of the global function (e.g. "myHook" or "MyNamespace.myHook").
   * @returns {Function|null} The resolved function, or null if not found.
   * @private
   */
  _resolveGlobalFunction(functionName) {
    if (!functionName) return null;

    // 1. Search in user-injected runtime globalContext
    if (this.globalContext) {
      const func = this._resolveInScope(this.globalContext, functionName);
      if (func) return func;
    }

    // 2. Fall back to script-level top-level context (captured at initialization)
    if (typeof gasGlobalContext !== 'undefined' && gasGlobalContext) {
      const func = this._resolveInScope(gasGlobalContext, functionName);
      if (func) return func;
    }

    // 3. Fall back to globalThis
    return this._resolveInScope(globalThis, functionName);
  }

  /**
   * Helper to resolve a dotted path string function within a specific scope object.
   *
   * @param {Object} scope - The parent scope object.
   * @param {string} path - Dotted path string.
   * @returns {Function|null} Resolved function or null.
   * @private
   */
  _resolveInScope(scope, path) {
    if (!scope) return null;
    const parts = path.split('.');
    let current = scope;
    for (const part of parts) {
      if (current[part] === undefined) {
        return null;
      }
      current = current[part];
    }
    return typeof current === 'function' ? current : null;
  }

  /**
   * Performs wildcard or RegExp matching against tool/capability names.
   * Supports regex expressions and wildcard symbols as defined in Gemini CLI hooks specs.
   *
   * @param {string|RegExp} matcher - RegExp or wildcard string pattern.
   * @param {string} toolName - The tool or capability name to match.
   * @returns {boolean} True if matched, false otherwise.
   * @private
   */
  _isMatch(matcher, toolName) {
    if (!matcher) return true;
    if (matcher === "*") return true;
    if (matcher instanceof RegExp) {
      return matcher.test(toolName);
    }
    if (typeof matcher === "string") {
      // Check if it's a regex literal string representation e.g. "/^tool_/i"
      if (matcher.startsWith("/") && matcher.lastIndexOf("/") > 0) {
        const lastSlashIdx = matcher.lastIndexOf("/");
        const pattern = matcher.substring(1, lastSlashIdx);
        const flags = matcher.substring(lastSlashIdx + 1);
        try {
          const regex = new RegExp(pattern, flags);
          return regex.test(toolName);
        } catch (e) {
          // Fall back
        }
      }
      // Gemini CLI BeforeTool/AfterTool matcher allows regex strings (like "write_.*" or "write_file|replace")
      // If the string contains regex metacharacters, compile as a RegExp
      try {
        let pattern = matcher;
        // Map wildcard "*" to ".*" if it is just a simple wildcard string, e.g., "write_*"
        if (pattern.includes("*") && !pattern.includes(".*")) {
          pattern = pattern.replace(/\*/g, ".*");
        }
        // Build regex to support piping (e.g. "write_file|replace") and other regex structures
        const regex = new RegExp("^(" + pattern + ")$", "i");
        return regex.test(toolName);
      } catch (e) {
        // Fall back to direct case-insensitive match
      }
      return matcher.toLowerCase() === toolName.toLowerCase();
    }
    return false;
  }

  /**
   * Executes a single hook configuration with the provided input payload.
   *
   * @param {Object} hook - The hook configuration object.
   * @param {Object} input - The input payload for the hook.
   * @returns {Object} The result returned by the hook function or webhook fetch.
   * @private
   */
  _executeSingleHook(hook, input) {
    if (hook.type === 'function' || typeof hook.handler === 'function') {
      const fn = hook.handler || hook.function;
      if (typeof fn !== 'function') {
        throw new Error(`CRITICAL: Inline function hook '${hook.name}' is missing a callable 'handler' or 'function'.`);
      }
      return fn(input);
    } else if (hook.type === 'gas_function') {
      const func = this._resolveGlobalFunction(hook.functionName);
      if (!func) {
        throw new Error(`CRITICAL: Global function '${hook.functionName}' for hook '${hook.name}' was not found in the global scope.`);
      }
      return func(input);
    } else if (hook.type === 'webhook') {
      const fetchOptions = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(input),
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(hook.url, fetchOptions);
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error(`CRITICAL: Webhook '${hook.name}' failed with HTTP Status ${code}: ${response.getContentText()}`);
      }
      try {
        return JSON.parse(response.getContentText());
      } catch (e) {
        throw new Error(`CRITICAL: Webhook '${hook.name}' returned invalid JSON: ${response.getContentText()}`);
      }
    } else if (hook.type === 'command') {
      console.log(`[Command Hook executed] Bypassing command execution ('${hook.command}') in Google Apps Script. Input event: ${input.event}`);
      return { decision: "allow" };
    } else {
      throw new Error(`CRITICAL: Unsupported hook type '${hook.type}' for hook '${hook.name}'.`);
    }
  }

  /**
   * Merges fields from a hook result back into the current input for sequential chaining.
   * Support both Gemini CLI hookSpecificOutput namespaces and top-level fields.
   *
   * @param {Object} currentInput - The existing input state.
   * @param {Object} hookResult - The result returned from the hook execution.
   * @returns {Object} The updated input state.
   * @private
   */
  _mergeSequentialInput(currentInput, hookResult) {
    if (!hookResult || typeof hookResult !== 'object') {
      return currentInput;
    }
    const updated = { ...currentInput };

    // 1. Unwrap hookSpecificOutput (Gemini CLI namespace structure)
    if (hookResult.hookSpecificOutput && typeof hookResult.hookSpecificOutput === 'object') {
      const hso = hookResult.hookSpecificOutput;
      
      // BeforeTool.hookSpecificOutput.tool_input
      if (hso.tool_input !== undefined) {
        updated.tool_input = hso.tool_input;
        if (typeof hso.tool_input === 'object' && hso.tool_input.execution_prompt !== undefined) {
          updated.executionPrompt = hso.tool_input.execution_prompt;
        } else if (typeof hso.tool_input === 'string') {
          updated.executionPrompt = hso.tool_input;
        }
      }

      // BeforeModel.hookSpecificOutput.llm_request
      if (hso.llm_request !== undefined) {
        updated.llm_request = hso.llm_request;
        if (hso.llm_request.config !== undefined) updated.config = hso.llm_request.config;
        if (hso.llm_request.prompt !== undefined) updated.query = hso.llm_request.prompt;
      }

      // BeforeModel / AfterModel.hookSpecificOutput.llm_response
      if (hso.llm_response !== undefined) {
        updated.llm_response = hso.llm_response;
        if (hso.llm_response.text !== undefined) updated.text = hso.llm_response.text;
      }

      // BeforeToolSelection.hookSpecificOutput.toolConfig
      if (hso.toolConfig !== undefined) {
        updated.toolConfig = hso.toolConfig;
        if (Array.isArray(hso.toolConfig.allowedFunctionNames)) {
          if (updated.capabilities) {
            updated.capabilities = updated.capabilities.filter(c => 
              hso.toolConfig.allowedFunctionNames.includes(c.name) || 
              hso.toolConfig.allowedFunctionNames.includes(c.id)
            );
          }
        }
      }

      // SessionStart / BeforeAgent / AfterTool.hookSpecificOutput.additionalContext
      if (hso.additionalContext !== undefined) {
        updated.additionalContext = hso.additionalContext;
      }
    }

    // 2. Propagate top-level fields
    const checkFields = [
      'prompt',
      'capabilities',
      'config',
      'query',
      'text',
      'executionPrompt',
      'result',
      'finalAnswer',
      'decision',
      'reason',
      'continue',
      'clearContext',
      'systemMessage',
      'retry',
      'retryPrompt',
      'tool_input',
      'tool_response',
      'llm_request',
      'llm_response'
    ];
    for (const field of checkFields) {
      if (hookResult[field] !== undefined) {
        updated[field] = hookResult[field];
      }
    }

    // Direct mappings for Gemini CLI compatibility:
    // If continue is false, treat it as decision: "deny"
    if (hookResult.continue === false) {
      updated.decision = "deny";
      updated.reason = hookResult.reason || "Execution stopped by hook continue=false";
    } else if (hookResult.decision === "suspend") {
      updated.decision = "suspend";
      updated.reason = hookResult.reason || "Execution suspended for human approval.";
    }

    return updated;
  }

  /**
   * Executes all matching hooks for a specific lifecycle event.
   * Auto-injects standard environment and session metadata to align with Gemini CLI specs.
   *
   * @param {string} event - The lifecycle event name.
   * @param {Object} initialInput - The initial HookInput payload.
   * @returns {Object} The aggregated output/result of hook execution.
   */
  execute(event, initialInput) {
    if (!this.hooks || this.hooks.length === 0) {
      return initialInput || {};
    }

    // Construct normalized Gemini CLI payload containing the mandatory common properties
    const input = {
      session_id: initialInput.session_id || this.sessionId,
      transcript_path: initialInput.transcript_path || "/mock/transcript.jsonl",
      cwd: initialInput.cwd || "/mock/cwd",
      hook_event_name: event,
      timestamp: new Date().toISOString(),
      ...initialInput,
      event // Keep camelCase compatibility field
    };

    // Normalize event-specific payloads (mappings to standard Gemini CLI snake_case fields)
    if (event === "BeforeTool" || event === "AfterTool") {
      input.tool_name = input.tool_name || input.toolName || "";
      if (input.tool_input === undefined) {
        input.tool_input = {
          execution_prompt: input.executionPrompt || input.prompt || "",
          task: input.task || {}
        };
      }
      if (event === "AfterTool" && input.tool_response === undefined) {
        input.tool_response = {
          result: input.result || "",
          success: !input.error,
          error: input.error || null
        };
      }
    } else if (event === "BeforeModel" || event === "AfterModel") {
      if (input.llm_request === undefined) {
        input.llm_request = {
          model: input.config?.model || "",
          messages: input.history || [],
          config: input.config || {}
        };
      }
      if (event === "AfterModel" && input.llm_response === undefined) {
        input.llm_response = {
          text: input.text || ""
        };
      }
    } else if (event === "BeforeToolSelection") {
      if (input.llm_request === undefined) {
        input.llm_request = {
          capabilities: input.capabilities || []
        };
      }
    } else if (event === "AfterAgent") {
      input.prompt_response = input.prompt_response || input.finalAnswer || "";
      input.stop_hook_active = input.stop_hook_active !== undefined ? input.stop_hook_active : false;
    }

    // Find all hooks that target this lifecycle event
    const matchingHooks = this.hooks.filter(h => {
      const eventMatches = Array.isArray(h.event) ? h.event.includes(event) : (h.event === event);
      if (!eventMatches) return false;

      // Matcher filter (mostly used for BeforeTool, AfterTool, Notification matching)
      if (h.matcher) {
        const toolName = input.tool_name || input.toolName || input.capabilityId || "";
        if (!this._isMatch(h.matcher, toolName)) {
          return false;
        }
      }
      return true;
    });

    if (matchingHooks.length === 0) {
      return input;
    }

    let currentInput = { ...input };
    let decisions = [];
    let reasons = [];
    let contexts = [];
    
    for (const hook of matchingHooks) {
      // If sequential, pass the latest state; otherwise, pass the original input state.
      const hookInput = hook.sequential ? currentInput : { ...input };
      
      let result = null;
      try {
        result = this._executeSingleHook(hook, hookInput);
      } catch (err) {
        console.error(`[HookManager Error] Failed executing hook '${hook.name}': ${err.message}`);
        result = { decision: "deny", reason: `Execution failure in hook '${hook.name}': ${err.message}` };
      }

      if (!result) continue;

      if (result.decision) {
        decisions.push(result.decision);
      }
      if (result.reason) {
        reasons.push(result.reason);
      }
      
      // Keep namespace or top-level additionalContext / systemMessage
      const contextVal = result.hookSpecificOutput?.additionalContext || result.additionalContext;
      if (contextVal) {
        contexts.push(contextVal);
      }
      const sysMsg = result.systemMessage;
      if (sysMsg) {
        contexts.push(sysMsg);
      }

      // Propagate modified fields
      currentInput = this._mergeSequentialInput(currentInput, result);
    }

    // Merge & Aggregate:
    // - OR Decision: If any hook returns decision: "deny" or decision: "block", reject immediately. Combine reason strings.
    // - Concat Context: Concatenate additionalContext or systemMessage strings using newlines (\n).
    const finalResult = { ...currentInput };
    
    const hasDeny = decisions.some(d => d === "deny" || d === "block");
    const hasSuspend = decisions.some(d => d === "suspend");
    if (hasDeny) {
      finalResult.decision = "deny";
      finalResult.reason = reasons.filter(r => r).join("\n");
    } else if (hasSuspend) {
      finalResult.decision = "suspend";
      finalResult.reason = reasons.filter(r => r).join("\n");
    } else if (decisions.length > 0) {
      finalResult.decision = "allow";
    }

    if (contexts.length > 0) {
      finalResult.additionalContext = contexts.filter(c => c).join("\n");
    }

    return finalResult;
  }
};


/**
 * LlmAgent.js
 * [Production Release v2.1.1] - Gemini Decisions API Dynamic Model & Thinking Router Edition
 *
 * @description
 * An elite, highly optimized autonomous orchestrator agent designed specifically for
 * the rigorous execution limits of Google Apps Script (GAS).
 *
 * [Core Capabilities]:
 * - **Custom Server Name Routing**: Intelligently parses user-defined custom server names
 *   from MCP and A2A configurations, injecting them into the LLM's context to guarantee
 *   flawless tool selection when users reference specific servers by their custom aliases.
 * - **One-Pass Fast-Track**: Radically reduces latency and token costs. If a prompt requires
 *   no external tools, the Planner generates the final answer directly, bypassing the
 *   execution and synthesis loops entirely.
 * - **Schema Interception**: Intelligently intercepts Fast-Tracked conversational responses
 *   and routes them through the Synthesis engine ONLY if a strict JSON `outputSchema` is demanded.
 * - **Payload Bulletproofing**: Defends against context-limit crashes (e.g., HTTP 400) by
 *   safely truncating massive raw tool outputs (HTML/JSON dumps) at `maxResultLength`.
 * - **Dynamic Re-Planning (ReAct)**: If a capability fails decisively, the agent discards
 *   the current DAG queue and dynamically regenerates an alternative execution plan to achieve the goal.
 * - **Temporal Context Anchoring**: Injects the exact system time into the global context,
 *   completely resolving 'Planner Context Blindness' for relative temporal queries (e.g., "tomorrow").
 * - **Seamless Chat Context**: Maintains and propagates conversation history dynamically to
 *   sub-agents, MCP servers, and A2A remote servers without polluting the core logic history.
 * - **Local JSON Bypass (v1.3.1)**: Allows feeding pre-fetched Agent Card JSON objects directly
 *   to bypass redundant HTTP requests, slashing network latency for A2A protocols.
 * - **Multi-Channel Log Propagation (v1.3.3)**: Supports explicit log propagation from
 *   the orchestrator down to sub-clients, storing logs inside multi-channel Sheets dynamically.
 * - **Global Scope Initialization Fix (v1.3.4)**: Resolves compilation ReferenceError by removing
 *   unbound properties from global context, using runtime shadow cloning for context safety.
 *
 * @usage
 * const agent = new LlmAgent({
 *   apiKey: "YOUR_GEMINI_API_KEY",
 *   name: "OrchestratorPrime",
 *   logSpreadsheetId: "YOUR_LOG_SPREADSHEET_ID",
 *   a2aServerAgentCardURLs: [
 *     "https://script.google.com/macros/s/{deploymentID}/exec"
 *   ],
 *   a2aServerAgentCardJSONs: [
 *     {
 *       "server local-cache-agent": {
 *         name: "CachedAgent",
 *         url: "https://script.google.com/macros/s/{deploymentID}/exec",
 *         description: "Bypasses HTTP fetch.",
 *         skills: [...]
 *       }
 *     }
 *   ]
 * });
 * agent.setServices({ lock: LockService.getScriptLock() });
 */
var gasGlobalContext = this;

var LlmAgent = class LlmAgent {
  constructor(config = {}) {
    this.apiKey = config.apiKey;
    if (!this.apiKey)
      throw new Error(
        "CRITICAL: apiKey is explicitly required to instantiate LlmAgent.",
      );

    this.name = config.name || "Agent";
    this.description = config.description || "";
    this.model = config.model || "models/gemini-4-hydrogen";
    this.instruction = config.instruction || "";
    this.state = config.state || {};

    // Limits and Safeguards
    this.maxReplans = config.maxReplans !== undefined ? config.maxReplans : 2;
    this.timeoutMs = config.timeoutMs || 280000; // 280 seconds (GAS safe limit)
    this.maxResultLength = config.maxResultLength || 20000; // Bulletproofing threshold
    this.startTime = null;

    // vNext Opt-In Modernization Controls (100% Backward-Compatible Defaults)
    this.executionMode = config.executionMode || "planner"; // "planner" | "direct" | "auto"
    this.parallelExecution = Boolean(config.parallelExecution);
    this.discoveryCacheTtlSec = Number(config.discoveryCacheTtlSec || 0);
    this.maxHistoryChars = Number(config.maxHistoryChars || 0);
    this.guardDestructiveMcpTools = Boolean(config.guardDestructiveMcpTools);
    this.useParametersJsonSchema = Boolean(config.useParametersJsonSchema);

    // v2.1.1 Gemini Decisions API Dynamic Model & Thinking Router (default: "efficient")
    this._explicitModelRouting = config.modelRouting !== undefined;
    this.modelRouting = config.modelRouting !== undefined ? config.modelRouting : "efficient";
    this.routingHistory = [];
    this._turnMaxCapabilityOverride = false;
    this._activeLogFn = null;

    // Capabilities configuration
    this.tools = config.tools || [];
    this.mcpServers = config.mcpServers || [];
    this.a2aServerAgentCardURLs = config.a2aServerAgentCardURLs || [];
    this.a2aServerAgentCardJSONs = config.a2aServerAgentCardJSONs || [];
    this.subAgents = config.subAgents || [];
    this.skillFolderId = config.skillFolderId || "";

    // Built-in integrations
    this.codeExecutor = config.codeExecutor || null;
    this.googleSearch = config.googleSearch || null;
    this.urlContext = config.urlContext || null;
    this.fileSearch = config.fileSearch || null;

    // Advanced config
    this.generateContentConfig = config.generateContentConfig || null;
    this.outputSchema = config.outputSchema || null;
    this.logSpreadsheetId = config.logSpreadsheetId || ""; // Propagated down to MCPApp and A2AApp in v1.3.3
    this.maxTokensPerSession = config.maxTokensPerSession || null;

    // Hooks System
    this.hookManager = new GasHookManager(config.hooks || []);
    this.sessionId = "session_" + (typeof Utilities !== "undefined" ? Utilities.getUuid() : Math.random().toString(36).substring(2));

    // Internal state
    this.history = [];
    this.logs = [];
    this.services = null;
    this.capabilities = [];
    this.accumulatedTokens = 0;
    this.llmCallCount = 0;
    this._capabilitiesInitialized = false;
  }

  /**
   * Convenience helper to build official Google Workspace MCP Server configurations.
   * Supports: "drive", "gmail", "docs", "sheets", "slides", "calendar", "chat".
   *
   * @param {string[]} [services=["drive"]] - Workspace service identifiers.
   * @param {Object} [options={}] - { mode: "v1" | "v1self", token: string }
   * @returns {Object[]} Array compatible with `LlmAgent({ mcpServers })`.
   */
  static createWorkspaceMcpServers(services = ["drive"], options = {}) {
    const endpointMap = {
      drive: "https://drivemcp.googleapis.com/mcp",
      gmail: "https://gmailmcp.googleapis.com/mcp",
      docs: "https://docsmcp.googleapis.com/mcp",
      sheets: "https://sheetsmcp.googleapis.com/mcp",
      slides: "https://slidesmcp.googleapis.com/mcp",
      calendar: "https://calendarmcp.googleapis.com/mcp",
      chat: "https://chatmcp.googleapis.com/mcp",
    };
    const mode = options.mode === "v1self" ? "v1self" : "v1";
    const token =
      options.token ||
      (typeof ScriptApp !== "undefined" ? ScriptApp.getOAuthToken() : "");

    return (Array.isArray(services) ? services : [services])
      .map((svc) => String(svc).toLowerCase().trim())
      .filter((svc) => endpointMap[svc])
      .map((svc) => ({
        [`${svc}_mcp`]: {
          httpUrl: `${endpointMap[svc]}/${mode}`,
          headers: token ? { authorization: `Bearer ${token}` } : {},
        },
      }));
  }

  /**
   * Unified logger helper with Notification hook propagation.
   * @private
   */
  _createLogger(logCallback = null) {
    return (message, data = null) => {
      const entry = { timestamp: new Date().toISOString(), message, data };
      this.logs.push(entry);
      const notifyRes = this.hookManager.execute("Notification", {
        message,
        data,
        toolName: data?.capability_id || "",
        notification_type: "Log",
        details: data,
      });
      if (notifyRes.systemMessage && typeof logCallback === "function") {
        logCallback({
          timestamp: new Date().toISOString(),
          message: `[Hook Notification Message] ${notifyRes.systemMessage}`,
          data,
        });
      }
      if (typeof logCallback === "function") logCallback(entry);
    };
  }

  /**
   * Exports current model & thinking routing configuration across fixed/efficient/quality modes as JSON (0 API calls).
   * @returns {Object}
   */
  getModelRoutingConfig() {
    if (typeof GeminiDecisionsRouter !== "function") {
      return {
        version: "2.1.1",
        activeMode: "fixed",
        configuredModel: this.model,
        warnings: ["GeminiDecisionsRouter is not loaded; running in fixed mode."],
      };
    }
    return GeminiDecisionsRouter.getRoutingConfigSummary(this.modelRouting, {
      configuredModel: this.model,
      configuredGenerationConfig: this.generateContentConfig,
    });
  }

  /**
   * Dry-run preview: calls Decisions API once for a prompt and compares fixed/efficient/quality modes as JSON.
   * @param {string} prompt
   * @param {Object} [options={}]
   * @returns {Object}
   */
  previewModelRouting(prompt, options = {}) {
    if (typeof GeminiDecisionsRouter !== "function") {
      throw new Error("GeminiDecisionsRouter is required for previewModelRouting().");
    }
    return GeminiDecisionsRouter.previewRouting({
      apiKey: this.apiKey,
      prompt,
      role: options.role || "direct",
      hasTools: options.hasTools !== undefined ? Boolean(options.hasTools) : this.capabilities.length > 0,
      configuredModel: this.model,
      configuredGenerationConfig: this.generateContentConfig,
      modelRouting: this.modelRouting,
      remainingMs: this._getRemainingMs(),
    });
  }

  /**
   * Returns structured routing decisions logged during this agent's execution.
   * @returns {Object[]}
   */
  getRoutingHistory() {
    return JSON.parse(JSON.stringify(this.routingHistory || []));
  }

  static getModelRoutingPresets(customConfig = null, context = {}) {
    if (typeof GeminiDecisionsRouter !== "function") return null;
    return GeminiDecisionsRouter.getRoutingConfigSummary(customConfig, context);
  }

  static configureModelRouting(customConfig = {}) {
    if (typeof GeminiDecisionsRouter === "function") {
      GeminiDecisionsRouter.configureDefaults(customConfig);
    }
  }

  static registerModels(modelsMap = {}) {
    if (typeof GeminiDecisionsRouter === "function") {
      GeminiDecisionsRouter.registerModels(modelsMap);
    }
  }

  static resetModelRoutingDefaults() {
    if (typeof GeminiDecisionsRouter === "function") {
      GeminiDecisionsRouter.resetDefaults();
    }
  }

  _getRemainingMs() {
    if (!this.startTime || !this.timeoutMs) return null;
    return Math.max(0, this.timeoutMs - (Date.now() - this.startTime));
  }

  _recordRoutingLog(msg, decision) {
    if (decision) {
      this.routingHistory.push(decision);
    }
    if (typeof this._activeLogFn === "function") {
      this._activeLogFn(msg, decision);
    } else if (typeof console !== "undefined") {
      console.log(msg);
    }
  }

  /**
   * Helper to execute prompt against model, wrapped with Decisions API routing, BeforeModel, and AfterModel hooks.
   *
   * @param {Object} config - Gemini configuration object.
   * @param {string} query - The prompt query.
   * @returns {string} The output text.
   * @private
   */
  _generateContent(config, query) {
    let routedConfig = { ...config };
    let routingDecision = null;
    const role = config._routingRole || "default";
    const promptForRouting = config._routingPrompt || query;
    delete routedConfig._routingRole;
    delete routedConfig._routingPrompt;

    const hasTools = Boolean(
      (routedConfig.functions &&
        routedConfig.functions.params_ &&
        Object.keys(routedConfig.functions.params_).length > 0) ||
        (routedConfig.tools && routedConfig.tools.length > 0),
    );

    if (typeof GeminiDecisionsRouter === "function") {
      const routed = GeminiDecisionsRouter.route({
        apiKey: routedConfig.apiKey || this.apiKey,
        agentName: this.name,
        prompt: promptForRouting,
        role,
        configuredModel: routedConfig.model || this.model,
        configuredGenerationConfig: routedConfig.generationConfig || null,
        hasTools,
        modelRouting: this.modelRouting,
        remainingMs: this._getRemainingMs(),
        forceMaxCapability: this._turnMaxCapabilityOverride,
        onLog: (msg, dec) => this._recordRoutingLog(msg, dec),
      });
      routedConfig.model = routed.model;
      if (routed.generationConfig && Object.keys(routed.generationConfig).length > 0) {
        routedConfig.generationConfig = routed.generationConfig;
      }
      routingDecision = routed.routingDecision;
      if (routingDecision?.maxCapabilityOverride) {
        this._turnMaxCapabilityOverride = true;
      }
      if (routingDecision?.decisionsInputTokens) {
        this.accumulatedTokens =
          (this.accumulatedTokens || 0) + routingDecision.decisionsInputTokens;
        if (this.maxTokensPerSession && this.accumulatedTokens > this.maxTokensPerSession) {
          throw new Error(
            `CRITICAL: Session aborted. Accumulated token count (${this.accumulatedTokens}) exceeded limit (${this.maxTokensPerSession}).`,
          );
        }
      }
    }

    const resolvedModel = routedConfig.model || this.model;

    // Construct request metadata to pass to BeforeModel
    const beforeResult = this.hookManager.execute("BeforeModel", {
      config: routedConfig,
      query,
      history: this.history || [],
      model: resolvedModel,
      routingDecision,
    });

    if (beforeResult.decision === "deny") {
      throw new Error(`Model request blocked by BeforeModel hook.`);
    }

    const activeConfig = beforeResult.config || routedConfig;
    const activeQuery = beforeResult.query || query;
    const finalModel = activeConfig.model || resolvedModel;

    let text;
    // Check if the hook returned a mocked llm_response (allowing API call skip)
    const mockedResponse = beforeResult.hookSpecificOutput?.llm_response || beforeResult.llm_response;
    if (mockedResponse && mockedResponse.text !== undefined) {
      text = mockedResponse.text;
    } else {
      // Force exportTotalTokens to capture token consumption; mark _routingResolved to avoid double routing
      const clientConfig = {
        ...activeConfig,
        exportTotalTokens: true,
        modelRouting: this.modelRouting,
        _routingResolved: true,
        onRoutingLog: (msg, dec) => this._recordRoutingLog(msg, dec),
        ...(this.useParametersJsonSchema &&
        activeConfig.useParametersJsonSchema === undefined
          ? { useParametersJsonSchema: true }
          : {}),
      };
      const rawRes = new GeminiWithFiles(clientConfig).generateContent({ q: activeQuery });
      
      if (rawRes && typeof rawRes === 'object' && rawRes.returnValue !== undefined) {
        text = typeof rawRes.returnValue === 'string' ? rawRes.returnValue : JSON.stringify(rawRes.returnValue);
        const tokens = rawRes.totalTokenCount || 0;
        this.accumulatedTokens = (this.accumulatedTokens || 0) + tokens;
        this.llmCallCount = (this.llmCallCount || 0) + (rawRes.llmCallCount || 1);
        
        // Quota Safeguard check
        if (this.maxTokensPerSession && this.accumulatedTokens > this.maxTokensPerSession) {
          throw new Error(`CRITICAL: Session aborted. Accumulated token count (${this.accumulatedTokens}) exceeded limit (${this.maxTokensPerSession}).`);
        }
      } else {
        this.llmCallCount = (this.llmCallCount || 0) + 1;
        text = rawRes;
      }
    }

    // Call AfterModel with request and response details
    const afterResult = this.hookManager.execute("AfterModel", {
      config: activeConfig,
      query: activeQuery,
      history: this.history || [],
      model: finalModel,
      routingDecision,
      text: text
    });

    if (afterResult.decision === "deny") {
      throw new Error(`Model response blocked and discarded by AfterModel hook.`);
    }

    const modifiedResponse = afterResult.hookSpecificOutput?.llm_response || afterResult.llm_response;
    if (modifiedResponse && modifiedResponse.text !== undefined) {
      return modifiedResponse.text;
    }
    return afterResult.text !== undefined ? afterResult.text : text;
  }

  setServices(services = {}) {
    this.services = services;
    if (this.services.globalContext && this.hookManager) {
      this.hookManager.setGlobalContext(this.services.globalContext);
    }
    this._initializeCapabilities();
    return this;
  }

  /**
   * Sets the conversation history for the agent.
   * This allows the agent to maintain context across multiple interactions in a chat environment.
   * The history format is fully compatible with GeminiWithFiles.
   *
   * @param {Array<Object>} history - An array of history objects containing 'role' and 'parts'.
   * @returns {LlmAgent} This agent instance for chaining.
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      throw new Error(
        "CRITICAL: History must be an array of objects compatible with GeminiWithFiles.",
      );
    }
    this.history = history;
    return this;
  }

  /**
   * Retrieves the current conversation history.
   *
   * @returns {Array<Object>} The current history array.
   */
  getHistory() {
    return this.history;
  }

  _requireLockService() {
    if (!this.services || !this.services.lock) {
      throw new Error(
        "CRITICAL FAILURE: LockService is strictly required for LlmAgent but was not provided.",
      );
    }
  }

  getAgentInf() {
    if (!this._capabilitiesInitialized) this._initializeCapabilities();
    return this.capabilities;
  }

  getLogs() {
    return this.logs;
  }

  /**
   * Robust JSON extraction helper to handle markdown wrappers and raw text.
   * @param {string} text - Raw string output from LLM.
   * @returns {Object|Array} Parsed JSON.
   */
  _extractJson(text) {
    if (typeof text !== "string") return text;
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    try {
      return match ? JSON.parse(match[1]) : JSON.parse(text);
    } catch (e) {
      const fallbackMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (fallbackMatch) {
        try {
          return JSON.parse(fallbackMatch[1]);
        } catch (err) {
          /* cascade to throw */
        }
      }
      throw new Error(
        "Invalid JSON structure returned by model: " + text.substring(0, 150),
      );
    }
  }

  /**
   * Extracts the custom user-defined server name from a configuration array item.
   * Matches objects like: { "custom_name": { httpUrl: "..." } }
   *
   * @param {string|Object} item - The configuration item from mcpServers or a2aServerAgentCardURLs/JSONs.
   * @returns {string|null} The custom server name, or null if not applicable.
   */
  _extractCustomName(item) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const keys = Object.keys(item);
      // Ensure the object has exactly one key acting as the custom name alias
      if (keys.length === 1 && typeof item[keys[0]] === "object") {
        return keys[0];
      }
    }
    return null;
  }

  _initializeCapabilities(logCallback = null) {
    this._requireLockService();
    if (this._capabilitiesInitialized) return;

    const log = (message, data = null) => {
      const entry = { timestamp: new Date().toISOString(), message, data };
      this.logs.push(entry);
      this.hookManager.execute("Notification", { message, data, toolName: data?.capability_id || "" });
      if (logCallback) logCallback(entry);
    };

    log("Initiating capabilities pre-fetch sequence...");
    this.capabilities = [];

    // 1. Native Tools
    if (this.tools?.length > 0) {
      this.tools.forEach((t) => {
        this.capabilities.push({
          id: `tool_${t.name}`,
          type: "Native Tool",
          name: t.name,
          description: {
            description: t.description || "Native function execution.",
            parameters: t.parameters?.properties
              ? Object.keys(t.parameters.properties)
              : [],
          },
          _tool: t,
        });
      });
    }

    // 2. MCP Servers
    if (this.mcpServers?.length > 0) {
      try {
        const mcpConfig = { model: this.model };
        if (this.logSpreadsheetId) {
          mcpConfig.log = true;
          mcpConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const mcpApp = new MCPApp(mcpConfig).setServices(this.services);
        const initClient = mcpApp.client({
          apiKey: this.apiKey,
          prompt: "system_initialization",
          mcpServerUrls: this.mcpServers,
          batchProcess: true,
          history: [],
        });

        if (initClient?.mcpServerObj?.length > 0) {
          initClient.mcpServerObj.forEach((obj, idx) => {
            const originalUrlOrObj = obj.original || this.mcpServers[idx];
            const customName = this._extractCustomName(this.mcpServers[idx]);
            const sInfo = obj.initialize?.result?.serverInfo || {
              name: `MCPServer_${idx}`,
              version: "unknown",
            };

            let rawTools = [];
            if (obj["tools/list"]?.result?.tools)
              rawTools = obj["tools/list"].result.tools;
            else if (obj["tools/list"]?.tools)
              rawTools = obj["tools/list"].tools;
            else if (Array.isArray(obj["tools/list"]))
              rawTools = obj["tools/list"];

            const toolDescriptions = rawTools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: Object.keys(t.inputSchema?.properties || {}),
              required_parameters: t.inputSchema?.required || [],
            }));

            // Override display name if user provided a custom name
            const displayName = customName || sInfo.name;

            this.capabilities.push({
              id: `mcp_${idx}`,
              type: "MCP Server",
              name: displayName,
              description: {
                custom_server_name: customName || undefined,
                server_name: sInfo.name,
                version: sInfo.version,
                tools: toolDescriptions,
              },
              URL: originalUrlOrObj, // Kept intact for downward GASADK compat
              _cachedMcpServerObj: obj, // Reuse handshake & tool discovery within session
            });
          });
        }
      } catch (e) {
        log("MCP Server initialization failed", { error: e.message });
      }
    }

    // 3. A2A Servers (URL and Direct JSON Bypass Integration)
    if (
      this.a2aServerAgentCardURLs?.length > 0 ||
      this.a2aServerAgentCardJSONs?.length > 0
    ) {
      try {
        const combinedA2AConfigs = [];
        const a2aConfig = { model: this.model };
        if (this.logSpreadsheetId) {
          a2aConfig.log = true;
          a2aConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const a2aApp = new A2AApp(a2aConfig).setServices(this.services);

        // 3a. Process Remote URLs
        if (this.a2aServerAgentCardURLs?.length > 0) {
          try {
            const agentCards = [].concat(
              a2aApp.getAgentCards(this.a2aServerAgentCardURLs) || [],
            );
            agentCards.forEach((card, idx) => {
              if (card?.url) {
                combinedA2AConfigs.push({
                  card: card,
                  sourceConfig: this.a2aServerAgentCardURLs[idx],
                });
              }
            });
          } catch (fetchErr) {
            log("A2A Server URL retrieval failed", { error: fetchErr.message });
          }
        }

        // 3b. Process Local Direct JSON Bypass
        if (this.a2aServerAgentCardJSONs?.length > 0) {
          this.a2aServerAgentCardJSONs.forEach((jsonConfig) => {
            let card = jsonConfig;
            const customName = this._extractCustomName(jsonConfig);
            // If the JSON is wrapped with a custom name alias, unwrap it to get the raw card
            if (
              customName &&
              typeof jsonConfig[customName] === "object" &&
              !Array.isArray(jsonConfig[customName])
            ) {
              card = jsonConfig[customName];
            }
            if (card) {
              combinedA2AConfigs.push({
                card: card,
                sourceConfig: jsonConfig,
              });
            }
          });
        }

        // 3c. Capability Registration
        combinedA2AConfigs.forEach(({ card, sourceConfig }, idx) => {
          if (card?.url || card?.name) {
            // Fallback validation for edge cases
            const customName = this._extractCustomName(sourceConfig);
            const displayName = customName || card.name || `A2AServer_${idx}`;
            const safeCardInfo = {
              custom_server_name: customName || undefined,
              original_card_name: card.name,
              description: card.description,
              skills: (card.skills || []).map((s) => ({
                name: s.name,
                description: s.description,
              })),
            };
            this.capabilities.push({
              id: `a2a_${idx}`,
              type: "A2A Server",
              name: displayName,
              description: safeCardInfo,
              URL: card.url || `local_json_bypass_${idx}`,
              _card: card, // Downward injected cleanly into A2AApp context
            });
          }
        });
      } catch (e) {
        log("A2A Server initialization failed", { error: e.message });
      }
    }

    // 4. SubAgents
    if (this.subAgents?.length > 0) {
      this.subAgents.forEach((sa) => {
        this.capabilities.push({
          id: `subagent_${sa.name}`,
          type: "SubAgent",
          name: sa.name,
          description: sa.description || "Hierarchical sub-agent.",
          instruction: sa.instruction || "",
          _agent: sa,
        });
      });
    }

    // 5. Agent Skills
    if (this.skillFolderId) {
      try {
        const folder = DriveApp.getFolderById(this.skillFolderId);
        const subFolders = folder.getFolders();
        while (subFolders.hasNext()) {
          const subF = subFolders.next();
          const folderId = subF.getId();
          const files = subF.getFiles();
          while (files.hasNext()) {
            const file = files.next();
            const fname = file.getName();
            if (fname === "SKILL.md" || fname.endsWith(".md")) {
              const content = file.getBlob().getDataAsString();
              const nameMatch = content.match(/name:\s*([^\r\n]+)/);
              const descMatch = content.match(/description:\s*([^\r\n]+)/);
              const skillName = nameMatch
                ? nameMatch[1].trim()
                : subF.getName();
              const skillDesc = descMatch
                ? descMatch[1].trim()
                : "Agent skill definition.";
              this.capabilities.push({
                id: `skill_${skillName}`,
                type: "Agent Skill",
                name: skillName,
                description: skillDesc,
                content: content,
                folderId: folderId,
              });
            }
          }
        }
      } catch (e) {
        log("Agent Skills initialization failed", { error: e.message });
      }
    }

    // 6. Built-ins
    if (this.googleSearch)
      this.capabilities.push({
        id: `builtin_googleSearch`,
        type: "Built-in Tool",
        name: "GoogleSearch",
        description: "Search the web via Google for current information.",
        _tool: { googleSearch: this.googleSearch },
      });
    if (this.codeExecutor)
      this.capabilities.push({
        id: `builtin_codeExecutor`,
        type: "Built-in Tool",
        name: "CodeExecutor",
        description: "Execute Python code for math or logic.",
        _tool: { codeExecution: this.codeExecutor },
      });
    if (this.fileSearch)
      this.capabilities.push({
        id: `builtin_fileSearch`,
        type: "Built-in Tool",
        name: "FileSearch",
        description: "Search files.",
        _tool: { fileSearch: this.fileSearch },
      });
    if (this.urlContext)
      this.capabilities.push({
        id: `builtin_urlContext`,
        type: "Built-in Tool",
        name: "UrlContext",
        description: "Fetch context from URLs.",
        _tool: { urlContext: this.urlContext },
      });

    this._capabilitiesInitialized = true;
    log("Capabilities pre-fetch complete.", {
      loadedCapabilities: this.capabilities.length,
    });
  }

  _executeTask(cap, executionPrompt, task = null) {
    if (!cap) {
      const config = {
        apiKey: this.apiKey,
        model: this.model,
        history: [...this.history],
      };
      return this._generateContent(config, executionPrompt);
    }

    switch (cap.type) {
      case "Native Tool": {
        const self = this;
        const funcs = {
          params_: {
            [cap.name]: {
              description: cap.description?.description || "",
              parameters: cap._tool.parameters,
            },
          },
        };
        
        // Wrap the native function with BeforeTool/AfterTool hook handlers to catch actual arguments
        funcs[cap.name] = function(args) {
          // 1. EXECUTE BeforeTool Hook with actual LLM-generated arguments
          const beforeToolRes = self.hookManager.execute("BeforeTool", {
            prompt: self.currentPrompt || "",
            toolName: cap.name,
            tool_name: cap.name,
            tool_input: args,
            capabilityId: cap.id,
            capability: cap
          });
          
          if (beforeToolRes.decision === "deny" || beforeToolRes.continue === false) {
            throw new Error(`Execution blocked by BeforeTool hook: ${beforeToolRes.reason || "Denied tool execution"}`);
          } else if (beforeToolRes.decision === "suspend") {
            // Save state to PropertiesService for Human-in-the-Loop recovery
            self.suspendedTask = {
              task: task,
              args: args,
              capabilityId: cap.id,
              toolName: cap.name,
              executionPrompt: beforeToolRes.executionPrompt || executionPrompt
            };
            self.saveState();
            throw new Error(`SUSPENDED: Execution suspended for human approval. SessionId: ${self.sessionId}`);
          }
          
          // Apply modified arguments if hook returned them
          const activeArgs = beforeToolRes.hookSpecificOutput?.tool_input || beforeToolRes.tool_input || args;
          
          // Run the original function
          const nativeHandler = cap._tool.function || cap._tool.func;
          let result = nativeHandler(activeArgs);
          
          // 2. EXECUTE AfterTool Hook with execution result
          const afterToolRes = self.hookManager.execute("AfterTool", {
            prompt: self.currentPrompt || "",
            toolName: cap.name,
            tool_name: cap.name,
            tool_input: activeArgs,
            tool_response: { result: result },
            result: result,
            capability: cap
          });
          
          if (afterToolRes.decision === "deny" || afterToolRes.continue === false) {
            return `[Interception Blocked/Redacted] ${afterToolRes.reason || "Tool output was hidden by hook policy."}`;
          }
          
          let finalResult = afterToolRes.result !== undefined ? afterToolRes.result : result;
          const additionalToolContext = afterToolRes.hookSpecificOutput?.additionalContext || afterToolRes.additionalContext;
          if (additionalToolContext) {
            finalResult = finalResult + "\n\n[Hook Context]:\n" + additionalToolContext;
          }
          return finalResult;
        };

        const config = {
          apiKey: this.apiKey,
          model: this.model,
          functions: funcs,
          history: [...this.history],
          _routingRole: "executor",
          _routingPrompt: executionPrompt,
          ...(this.generateContentConfig ? { generationConfig: { ...this.generateContentConfig } } : {}),
        };
        return this._generateContent(config, executionPrompt);
      }
      case "MCP Server": {
        const mcpConfig = {
          model: this.model,
          modelRouting: this.modelRouting,
          remainingMs: this._getRemainingMs(),
          forceMaxCapability: this._turnMaxCapabilityOverride,
          onRoutingLog: (msg, dec) => this._recordRoutingLog(msg, dec),
        };
        if (this.logSpreadsheetId) {
          mcpConfig.log = true;
          mcpConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const mcpApp = new MCPApp(mcpConfig).setServices(this.services);
        if (typeof mcpApp.setHookManager === "function" && this.hookManager) {
          mcpApp.setHookManager(this.hookManager);
        }
        const clientOpts = {
          apiKey: this.apiKey,
          prompt: executionPrompt,
          mcpServerUrls: [cap.URL],
          batchProcess: true,
          skipFinalSummary: true,
          history: [...this.history],
        };
        if (cap._cachedMcpServerObj) {
          clientOpts.cachedMcpServerObj = [cap._cachedMcpServerObj];
        }
        const tempClient = mcpApp.client(clientOpts);
        const res = tempClient.callMCPServers();
        if (res?.totalTokenCount) {
          this.accumulatedTokens = (this.accumulatedTokens || 0) + res.totalTokenCount;
        }
        if (res?.llmCallCount) {
          this.llmCallCount = (this.llmCallCount || 0) + res.llmCallCount;
        }
        if (this.maxTokensPerSession && this.accumulatedTokens > this.maxTokensPerSession) {
          throw new Error(
            `CRITICAL: Session aborted. Accumulated token count (${this.accumulatedTokens}) exceeded limit (${this.maxTokensPerSession}).`,
          );
        }
        if (res?.error)
          throw new Error(`MCP Error: ${JSON.stringify(res.error)}`);
        return res?.result || res;
      }
      case "A2A Server": {
        // [Optimization v1.3.1]: Pass LlmAgent model & routing settings to A2AApp context natively
        const a2aConfig = {
          model: this.model,
          modelRouting: this.modelRouting,
          remainingMs: this._getRemainingMs(),
          forceMaxCapability: this._turnMaxCapabilityOverride,
          onRoutingLog: (msg, dec) => this._recordRoutingLog(msg, dec),
        };
        if (this.logSpreadsheetId) {
          a2aConfig.log = true;
          a2aConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const a2aApp = new A2AApp(a2aConfig).setServices(this.services);
        // By passing agentCards directly, A2AApp guarantees a zero-latency HTTP bypass for card fetching.
        // By passing directRouting: true, we cleanly bypass A2AApp's internal local double-planning (Phase 3-7).
        const res = a2aApp.client({
          apiKey: this.apiKey,
          prompt: executionPrompt,
          agentCards: [cap._card],
          history: [...this.history],
          directRouting: true,
        });
        if (res?.error)
          throw new Error(`A2A Error: ${JSON.stringify(res.error)}`);
        return res?.result || res;
      }
      case "SubAgent":
        if (typeof cap._agent.setHistory === "function") {
          cap._agent.setHistory([...this.history]);
        }
        // Inherit parent hooks security context, routing policy, and limits
        if (cap._agent) {
          if (this.hookManager) {
            cap._agent.hookManager = this.hookManager;
            cap._agent.sessionId = this.sessionId;
          }
          if (!cap._agent._explicitModelRouting) {
            cap._agent.modelRouting = this.modelRouting;
          }
          if (this._turnMaxCapabilityOverride) {
            cap._agent._turnMaxCapabilityOverride = true;
          }
          cap._agent.maxTokensPerSession = this.maxTokensPerSession;
          cap._agent.accumulatedTokens = this.accumulatedTokens;
        }
        try {
          const subRes = cap._agent.run(executionPrompt, this._activeRawLogCallback || null);
          if (cap._agent) {
            this.accumulatedTokens = cap._agent.accumulatedTokens;
            if (Array.isArray(cap._agent.routingHistory) && cap._agent.routingHistory.length > 0) {
              this.routingHistory.push(...cap._agent.routingHistory);
            }
          }
          return subRes;
        } catch (err) {
          if (cap._agent) {
            this.accumulatedTokens = cap._agent.accumulatedTokens;
          }
          throw err;
        }
      case "Agent Skill": {
        const config = {
          apiKey: this.apiKey,
          model: this.model,
          systemInstruction: {
            parts: [{ text: `Strictly apply this skill:\n\n${cap.content}` }],
          },
          history: [...this.history],
          _routingRole: "executor",
          _routingPrompt: executionPrompt,
          ...(this.generateContentConfig ? { generationConfig: { ...this.generateContentConfig } } : {}),
        };
        return this._generateContent(config, executionPrompt);
      }
      case "Built-in Tool": {
        const config = {
          apiKey: this.apiKey,
          model: this.model,
          tools: [cap._tool],
          history: [...this.history],
          _routingRole: "executor",
          _routingPrompt: executionPrompt,
          ...(this.generateContentConfig ? { generationConfig: { ...this.generateContentConfig } } : {}),
        };
        return this._generateContent(config, executionPrompt);
      }
      default:
        throw new Error(`Unknown capability: ${cap.type}`);
    }
  }

  run(prompt, logCallback = null) {
    try {
      this.startTime = Date.now();
      this.currentPrompt = prompt;

      // Sync sessionId to hookManager
      if (this.hookManager) {
        this.hookManager.sessionId = this.sessionId || this.hookManager.sessionId;
      }

      // EXECUTE SessionStart Hook
      const sessionStartRes = this.hookManager.execute("SessionStart", { prompt, source: "startup" });
      prompt = sessionStartRes.prompt || prompt;
      const sessionContext = sessionStartRes.hookSpecificOutput?.additionalContext || sessionStartRes.additionalContext;
      if (sessionContext) {
        prompt = prompt + "\n\n[Session Start Context]:\n" + sessionContext;
      }

      const log = this._createLogger(logCallback);

      if (sessionStartRes.systemMessage) {
        log(`[SessionStart Hook Message] ${sessionStartRes.systemMessage}`);
      }

      if (!this._capabilitiesInitialized) this._initializeCapabilities(log);
      log("Agent run sequence initiated", { prompt });

      // EXECUTE PreCompress Hook & optional sliding-window history compression
      const historyChars = JSON.stringify(this.history || []).length;
      const preCompressRes = this.hookManager.execute("PreCompress", {
        trigger: "auto",
        historyChars,
        maxHistoryChars: this.maxHistoryChars,
      });
      if (preCompressRes.systemMessage) {
        log(`[PreCompress Hook Message] ${preCompressRes.systemMessage}`);
      }
      if (
        this.maxHistoryChars > 0 &&
        historyChars > this.maxHistoryChars &&
        this.history.length > 2
      ) {
        while (
          this.history.length > 2 &&
          JSON.stringify(this.history).length > this.maxHistoryChars
        ) {
          this.history.shift();
          if (this.history.length > 2 && this.history[0]?.role === "model") {
            this.history.shift();
          }
        }
        log("[History Compression] Trimmed oldest history turns to fit maxHistoryChars.", {
          remainingTurns: this.history.length,
        });
      }

      // EXECUTE BeforeAgent Hook
      const beforeAgentRes = this.hookManager.execute("BeforeAgent", { prompt });
      if (beforeAgentRes.decision === "deny" || beforeAgentRes.continue === false) {
        throw new Error(`Execution blocked by BeforeAgent hook: ${beforeAgentRes.reason || "Denied"}`);
      }
      
      const agentContext = beforeAgentRes.hookSpecificOutput?.additionalContext || beforeAgentRes.additionalContext;
      if (agentContext) {
        prompt = prompt + "\n\n[Additional Context]:\n" + agentContext;
      } else if (beforeAgentRes.prompt) {
        prompt = beforeAgentRes.prompt;
      }

      // Global Context Hoisting
      const temporalContext = `\n[System Time Anchor]: Current system date/time is ${new Date().toString()}. Use this as the baseline for relative time references.`;

      let globalInstruction = `You are an autonomous orchestrator agent. Designation: "${this.name}".${temporalContext}\n`;
      let baseInstruction = this.instruction;
      if (this.state && typeof baseInstruction === "string") {
        baseInstruction = baseInstruction.replace(/{(\w+)}/g, (match, key) =>
          this.state[key] !== undefined ? this.state[key] : match,
        );
      }
      if (baseInstruction)
        globalInstruction += `User Persona & Core Instructions: ${typeof baseInstruction === "string" ? baseInstruction : JSON.stringify(baseInstruction)}\n`;

      // Capability Compaction
      const plannerCapabilities = this.capabilities.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        description: c.description,
      }));

      // EXECUTE BeforeToolSelection Hook
      const beforeToolSelectionRes = this.hookManager.execute("BeforeToolSelection", { capabilities: plannerCapabilities });
      let activeCapabilities = beforeToolSelectionRes.capabilities || plannerCapabilities;
      
      const toolConfig = beforeToolSelectionRes.hookSpecificOutput?.toolConfig || beforeToolSelectionRes.toolConfig;
      if (toolConfig) {
        if (toolConfig.mode === "NONE") {
          activeCapabilities = [];
        } else if (Array.isArray(toolConfig.allowedFunctionNames)) {
          activeCapabilities = activeCapabilities.filter(c => 
            toolConfig.allowedFunctionNames.includes(c.name) || 
            toolConfig.allowedFunctionNames.includes(c.id)
          );
        }
      }
      const capabilityIds = activeCapabilities.map((c) => c.id);

      // vNext Hybrid Direct Mode (Single-Loop ReAct: 6 LLM calls -> 2 LLM calls)
      if (this._shouldUseDirectMode(activeCapabilities)) {
        return this._runDirectMode(prompt, globalInstruction, activeCapabilities, log, logCallback);
      }

      // Unified Schema Definitions
      const taskArraySchema = {
        type: "array",
        items: {
          type: "object",
          properties: {
            task_id: { type: "number" },
            description: { type: "string" },
            capability_id: { type: "string", enum: capabilityIds },
            execution_prompt: { type: "string" },
            depends_on: {
              type: "array",
              items: { type: "number" },
              description: "Task IDs this task depends on.",
            },
          },
          required: [
            "task_id",
            "description",
            "capability_id",
            "execution_prompt",
            "depends_on",
          ],
        },
      };

      const plannerSchema = {
        type: "object",
        properties: {
          requires_capabilities: {
            type: "boolean",
            description: "True ONLY if external tools are strictly required.",
          },
          direct_answer: {
            type: "string",
            description:
              "If requires_capabilities is false, provide the final comprehensive answer here directly to the user.",
          },
          plan: taskArraySchema,
        },
        required: ["requires_capabilities"],
      };

      const plannerPromptStr = `
Objective: Decompose the user's prompt into tasks and assign MINIMAL necessary capabilities.

User Prompt: "${prompt}"

Available Capabilities:
${JSON.stringify(activeCapabilities, null, 2)}

Instructions:
1. Decompose the prompt into sequential tasks. Select exactly ONE capability per task by its "id".
   *CRITICAL*: If the user explicitly mentions a custom server name in their prompt, you MUST tightly match it against the "custom_server_name" or "name" fields in the capabilities list to ensure accurate tool routing.
2. Selective Context Passing (depends_on): Evaluate dependencies. Include previous "task_id" in "depends_on" if strictly required.
3. SUB-AGENT PROMPT STYLING (CRITICAL): Delegate to 'MCP Server' or 'A2A Server' using natural language queries, not robotic instructions.
4. ONE-PASS FAST-TRACK (CRITICAL): If NO capabilities are required to answer the prompt entirely, set "requires_capabilities" to false, and write your complete response in "direct_answer". You MUST append "\n\nExecution Summary: NO capabilities were used." at the end of "direct_answer". Leave "plan" empty.
5. BAN ON SYNTHESIS TASKS (CRITICAL): Do NOT create tasks for compiling, summarizing, formatting, or synthesizing the final answer. The system automatically executes a final synthesis phase using all gathered data. Create tasks ONLY for actively executing tools or fetching data.
6. CONSOLIDATE SAME-SERVER MCP CALLS (CRITICAL): Do NOT split related requests or list-size/pagination parameters targeting the SAME 'MCP Server' capability into multiple repeated identical tasks. Consolidate them into a SINGLE task targeting that 'MCP Server' unless strictly distinct phases are required.
`;

      log("Planning phase initiated.");
      this._activeLogFn = log;
      this._activeRawLogCallback = logCallback;
      const isFixedRouting =
        typeof GeminiDecisionsRouter !== "function" ||
        GeminiDecisionsRouter.normalizeRoutingConfig(this.modelRouting).mode === "fixed";
      const isThinkingLevelModel = /(?:^|\/)gemini-[34](?:[-.]|$)/i.test(this.model);
      const plannerGenConfig = this.generateContentConfig
        ? { ...this.generateContentConfig }
        : {};
      if (isFixedRouting && isThinkingLevelModel && !plannerGenConfig.thinkingConfig) {
        plannerGenConfig.thinkingConfig = { thinkingLevel: "LOW" };
      }
      // When no capabilities exist, Planner is the sole final answer generator (One-Pass Fast-Track),
      // so route with role="direct" (enabling frontierMax / gemini-4-carbon HIGH on max_capability_override).
      const plannerRoutingRole =
        activeCapabilities && activeCapabilities.length > 0 ? "planner" : "direct";
      const plannerConfig = {
        apiKey: this.apiKey,
        model: this.model,
        history: this.history,
        systemInstruction: { parts: [{ text: globalInstruction }] },
        responseSchema: plannerSchema,
        _routingRole: plannerRoutingRole,
        _routingPrompt: prompt,
        ...(Object.keys(plannerGenConfig).length > 0
          ? { generationConfig: plannerGenConfig }
          : {}),
      };

      let planResultText;
      try {
        planResultText = this._generateContent(plannerConfig, plannerPromptStr);
      } catch (e) {
        throw new Error(`Initial Planning Phase Error: ${e.message}`);
      }

      let planResult;
      try {
        planResult = this._extractJson(planResultText);
      } catch (e) {
        throw new Error(
          `Invalid JSON returned from Planner: ${e.message}\nRaw Output: ${planResultText}`,
        );
      }

      this.planQueue = [];
      this.taskResults = [];
      this.replanCount = 0;
      this.highestTaskId = 0;
      this.suspendedTask = null;

      // ==========================================
      // ZERO-SYNTHESIS BYPASS & SCHEMA INTERCEPTION
      // ==========================================
      if (planResult.requires_capabilities === false) {
        const directAns =
          planResult.direct_answer || "No capabilities required to answer.";

        // Intercept bypass if outputSchema is demanded to ensure strict formatting
        if (this.outputSchema) {
          log(
            "One-Pass Fast-Track intercepted: 'outputSchema' is defined. Routing to Synthesis for strict formatting.",
          );
          this.taskResults.push({
            task_id: 0,
            capability_used: "None",
            capability_type: "None",
            prompt: prompt,
            result: directAns,
            duration_ms: 0,
          });
          // planQueue remains empty, dropping immediately into the final Synthesis loop
        } else {
          log(
            "One-Pass Fast-Track Triggered: Bypassing execution and synthesis entirely.",
          );
          
          let agentResult = directAns;

          // EXECUTE AfterAgent Hook
          const afterAgentRes = this.hookManager.execute("AfterAgent", {
            finalAnswer: agentResult,
            prompt_response: agentResult,
            prompt: prompt,
            stop_hook_active: false
          });
          
          let forceRetry = (afterAgentRes.decision === "deny" || afterAgentRes.continue === false || afterAgentRes.retry === true);
          let retryPrompt = afterAgentRes.reason || afterAgentRes.retryPrompt || prompt;
          agentResult = afterAgentRes.prompt_response || afterAgentRes.finalAnswer || agentResult;

          if (afterAgentRes.clearContext === true) {
            log("AfterAgent hook requested clearContext: clearing history.");
            this.history = [];
          }

          this.history.push({ role: "user", parts: [{ text: prompt }] });
          this.history.push({ role: "model", parts: [{ text: agentResult }] });

          // EXECUTE SessionEnd Hook
          const sessionEndRes = this.hookManager.execute("SessionEnd", { 
            finalAnswer: agentResult, 
            error: null, 
            prompt: prompt,
            reason: "exit"
          });
          if (sessionEndRes.systemMessage) {
            log(`[SessionEnd Hook Message] ${sessionEndRes.systemMessage}`);
          }

          if (forceRetry && (!this._retryCount || this._retryCount < 2)) {
            this._retryCount = (this._retryCount || 0) + 1;
            log(`AfterAgent hook requested retry (decision: deny/retry). Initiating retry ${this._retryCount} with prompt/reason: ${retryPrompt}`);
            const retryResult = this.run(retryPrompt, logCallback);
            this._retryCount = 0; // reset
            return retryResult;
          }

          return agentResult;
        }
      } else {
        this.planQueue = planResult.plan || [];
        const planSummary = this.planQueue
          .map((t) => `Task [${t.task_id}]: '${t.capability_id}'`)
          .join("\n");
        log("Execution Plan Generated:\n" + planSummary, { plan: this.planQueue });
      }

      this.highestTaskId = Math.max(...this.planQueue.map((t) => t.task_id), 0);

      return this._runRemainingQueueAndSynthesize(logCallback);
    } catch (err) {
      if (err.message && err.message.startsWith("SUSPENDED")) {
        throw err;
      }
      // EXECUTE SessionEnd Hook on error
      try {
        const sessionEndRes = this.hookManager.execute("SessionEnd", { 
          finalAnswer: null, 
          error: err.message, 
          prompt: prompt,
          reason: "error"
        });
        if (sessionEndRes.systemMessage) {
          console.log(`[SessionEnd Hook Message on Error] ${sessionEndRes.systemMessage}`);
        }
      } catch (endErr) {
        console.error(`[HookManager Error] Failed executing SessionEnd hook on error: ${endErr.message}`);
      }
      throw err;
    }
  }

  /**
   * Determines whether Hybrid Direct Mode (Single-Loop ReAct) can safely execute this request.
   * Default `executionMode: "planner"` never enters direct mode (100% backward compatible).
   * @private
   */
  _shouldUseDirectMode(activeCapabilities) {
    if (this.executionMode !== "direct" && this.executionMode !== "auto") {
      return false;
    }
    if (!Array.isArray(activeCapabilities) || activeCapabilities.length === 0) {
      return false;
    }
    // Avoid combining strict outputSchema with function declarations in a single turn
    if (this.outputSchema) {
      return false;
    }
    const allowedTypes = new Set(["Native Tool", "MCP Server"]);
    return activeCapabilities.every((c) => allowedTypes.has(c.type));
  }

  /**
   * Executes Native Tools and discovered MCP Server tools directly inside a single
   * GeminiWithFiles ReAct loop (reducing 1-tool MCP execution from 6 -> 2 LLM calls).
   * @private
   */
  _runDirectMode(prompt, globalInstruction, activeCapabilities, log, logCallback = null) {
    log("[Direct Mode] Binding Native/MCP tools directly into single-loop ReAct executor.");
    const boundFunctions = { params_: {} };
    const usedNames = new Set();

    const registerTool = (rawName, schemaMeta, handlerFn, metaInfo) => {
      let safeName = String(rawName).replace(/[^a-zA-Z0-9_-]/g, "_");
      if (usedNames.has(safeName)) {
        safeName = `${metaInfo.capId}_${safeName}`;
      }
      usedNames.add(safeName);
      boundFunctions.params_[safeName] = schemaMeta;
      boundFunctions[safeName] = (args) => {
        const callArgs = args && typeof args === "object" ? args : {};
        if (
          this.guardDestructiveMcpTools &&
          metaInfo.annotations &&
          (metaInfo.annotations.destructiveHint === true ||
            metaInfo.annotations.readOnlyHint === false)
        ) {
          throw new Error(
            `[Destructive Tool Guard] Execution of '${safeName}' blocked by guardDestructiveMcpTools (annotations: ${JSON.stringify(metaInfo.annotations)}).`,
          );
        }
        const beforeRes = this.hookManager.execute("BeforeTool", {
          prompt,
          toolName: safeName,
          capabilityId: metaInfo.capId,
          arguments: callArgs,
          source: metaInfo.source,
        });
        if (beforeRes.decision === "deny") {
          throw new Error(
            `Execution blocked by BeforeTool hook: ${beforeRes.reason || "Denied"}`,
          );
        }
        const activeArgs =
          beforeRes.arguments !== undefined ? beforeRes.arguments : callArgs;
        let out = handlerFn(activeArgs);
        let outStr = typeof out === "object" ? JSON.stringify(out) : String(out);
        if (outStr.length > this.maxResultLength) {
          outStr =
            outStr.substring(0, this.maxResultLength) +
            "\n\n...[TRUNCATED: Exceeds context limit]";
        }
        const afterRes = this.hookManager.execute("AfterTool", {
          prompt,
          toolName: safeName,
          capabilityId: metaInfo.capId,
          result: outStr,
          source: metaInfo.source,
        });
        if (afterRes.decision === "deny" || afterRes.continue === false) {
          return `[Interception Blocked/Redacted] ${afterRes.reason || "Hidden by hook policy."}`;
        }
        return afterRes.result !== undefined ? afterRes.result : outStr;
      };
    };

    for (const activeCap of activeCapabilities) {
      const cap = this.capabilities.find((c) => c.id === activeCap.id);
      if (!cap) continue;
      if (cap.type === "Native Tool") {
        const nativeDesc =
          typeof cap.description === "string"
            ? cap.description
            : cap.description?.description || cap._tool?.description || "";
        const nativeParams = cap._tool?.parameters || cap.parameters;
        const nativeFn = cap._tool?.function || cap._tool?.func || cap.func;
        if (typeof nativeFn !== "function") {
          throw new Error(
            `Native Tool '${cap.name}' is missing executable 'function' handler.`,
          );
        }
        registerTool(
          cap.name,
          {
            description: nativeDesc,
            parameters: nativeParams,
          },
          (args) => nativeFn(args),
          { capId: cap.id, source: "native_tool", annotations: null },
        );
      } else if (cap.type === "MCP Server") {
        const mcpConfig = { model: this.model };
        if (this.logSpreadsheetId) {
          mcpConfig.log = true;
          mcpConfig.spreadsheetId = this.logSpreadsheetId;
        }
        const mcpApp = new MCPApp(mcpConfig).setServices(this.services);
        const clientOpts = {
          apiKey: this.apiKey,
          prompt,
          mcpServerUrls: [cap.URL],
          batchProcess: true,
          history: [],
          ...(cap._cachedMcpServerObj
            ? { cachedMcpServerObj: [cap._cachedMcpServerObj] }
            : {}),
        };
        const tempClient = mcpApp.client(clientOpts);
        const mcpFuncs = tempClient.functions || { params_: {} };
        Object.keys(mcpFuncs.params_ || {}).forEach((toolKey) => {
          if (toolKey === "without_function" || toolKey === "check_process") {
            return;
          }
          if (typeof mcpFuncs[toolKey] !== "function") return;
          const meta = mcpFuncs.params_[toolKey];
          registerTool(
            toolKey,
            {
              description: meta.description || "",
              parameters: meta.parameters,
            },
            (args) => mcpFuncs[toolKey](args),
            {
              capId: cap.id,
              source: "mcp_server",
              annotations: meta.annotations || null,
            },
          );
        });
      }
    }

    this._activeLogFn = log;
    const isFixedDirect =
      typeof GeminiDecisionsRouter !== "function" ||
      GeminiDecisionsRouter.normalizeRoutingConfig(this.modelRouting).mode === "fixed";
    const directGenConfig = this.generateContentConfig
      ? { ...this.generateContentConfig }
      : {};
    if (
      isFixedDirect &&
      /(?:^|\/)gemini-[34](?:[-.]|$)/i.test(this.model) &&
      !directGenConfig.thinkingConfig
    ) {
      directGenConfig.thinkingConfig = { thinkingLevel: "LOW" };
    }

    const directConfig = {
      apiKey: this.apiKey,
      model: this.model,
      functions: boundFunctions,
      history: [...this.history],
      systemInstruction: { parts: [{ text: globalInstruction }] },
      _routingRole: "direct",
      _routingPrompt: prompt,
      ...(Object.keys(directGenConfig).length > 0
        ? { generationConfig: directGenConfig }
        : {}),
    };

    const answer = this._generateContent(directConfig, prompt);
    log("[Direct Mode] Execution complete.");

    const afterAgentRes = this.hookManager.execute("AfterAgent", {
      finalAnswer: answer,
      prompt_response: answer,
      prompt,
      stop_hook_active: false,
    });
    const finalAnswer =
      afterAgentRes.prompt_response || afterAgentRes.finalAnswer || answer;

    if (afterAgentRes.clearContext === true) {
      this.history = [];
    }
    this.history.push({ role: "user", parts: [{ text: prompt }] });
    this.history.push({
      role: "model",
      parts: [
        {
          text:
            typeof finalAnswer === "string"
              ? finalAnswer
              : JSON.stringify(finalAnswer),
        },
      ],
    });

    this.hookManager.execute("SessionEnd", {
      finalAnswer,
      error: null,
      prompt,
      reason: "exit",
    });
    return finalAnswer;
  }

  _getUtf8ByteLength_(str) {
    if (typeof Utilities !== "undefined" && typeof Utilities.newBlob === "function") {
      return Utilities.newBlob(str, "application/json").getBytes().length;
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.byteLength(str, "utf8");
    }
    return str.length * 3;
  }

  deleteState(sessionId) {
    if (!this.services || !this.services.properties) return;
    const props = this.services.properties;
    const metaKey = "HITL_STATE_" + sessionId;
    const existing = props.getProperty(metaKey);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed && parsed._chunked && Number(parsed.chunks) > 0) {
          for (let i = 0; i < parsed.chunks; i++) {
            props.deleteProperty(`${metaKey}_${i}`);
          }
        }
      } catch (e) {
        // Ignore parse error on non-meta legacy values
      }
      props.deleteProperty(metaKey);
    }
  }

  saveState() {
    const stateData = {
      sessionId: this.sessionId,
      currentPrompt: this.currentPrompt,
      history: this.history,
      accumulatedTokens: this.accumulatedTokens,
      logs: this.logs,
      planQueue: this.planQueue || [],
      taskResults: this.taskResults || [],
      highestTaskId: this.highestTaskId || 0,
      replanCount: this.replanCount || 0,
      suspendedTask: this.suspendedTask || null,
      routingSessionState: {
        maxCapabilityOverride: Boolean(this._turnMaxCapabilityOverride),
      },
    };
    if (this.services && this.services.properties) {
      const props = this.services.properties;
      const metaKey = "HITL_STATE_" + this.sessionId;
      const jsonStr = JSON.stringify(stateData);
      const byteLen = this._getUtf8ByteLength_(jsonStr);
      const MAX_PROP_BYTES = 8000; // Safe margin under GAS 9KB (9,216 byte) limit

      // Clean any prior chunks before writing
      this.deleteState(this.sessionId);

      if (byteLen <= MAX_PROP_BYTES) {
        props.setProperty(metaKey, jsonStr);
      } else {
        let encoded = jsonStr;
        let compressed = false;
        if (
          typeof Utilities !== "undefined" &&
          typeof Utilities.gzip === "function" &&
          typeof Utilities.base64Encode === "function"
        ) {
          const gzBlob = Utilities.gzip(
            Utilities.newBlob(jsonStr, "application/json", "state.json"),
          );
          encoded = Utilities.base64Encode(gzBlob.getBytes());
          compressed = true;
        }
        const chunkSize = 7500;
        const chunks = [];
        for (let i = 0; i < encoded.length; i += chunkSize) {
          chunks.push(encoded.slice(i, i + chunkSize));
        }
        const batch = {};
        chunks.forEach((c, idx) => {
          batch[`${metaKey}_${idx}`] = c;
        });
        batch[metaKey] = JSON.stringify({
          _chunked: true,
          compressed,
          chunks: chunks.length,
          savedAt: new Date().toISOString(),
        });
        if (typeof props.setProperties === "function") {
          props.setProperties(batch, false);
        } else {
          Object.entries(batch).forEach(([k, v]) => props.setProperty(k, v));
        }
      }
    }
    return stateData;
  }

  loadState(sessionId) {
    let stateData = null;
    if (this.services && this.services.properties) {
      const props = this.services.properties;
      const metaKey = "HITL_STATE_" + sessionId;
      const dataStr = props.getProperty(metaKey);
      if (dataStr) {
        const parsed = JSON.parse(dataStr);
        if (parsed && parsed._chunked && Number(parsed.chunks) > 0) {
          let assembled = "";
          for (let i = 0; i < parsed.chunks; i++) {
            const part = props.getProperty(`${metaKey}_${i}`);
            if (part === null || part === undefined) {
              throw new Error(
                `Corrupted chunked state for sessionId ${sessionId}: missing chunk ${i}`,
              );
            }
            assembled += part;
          }
          if (parsed.compressed) {
            const rawBlob = Utilities.newBlob(
              Utilities.base64Decode(assembled),
              "application/x-gzip",
            );
            const unzipped = Utilities.ungzip(rawBlob).getDataAsString("UTF-8");
            stateData = JSON.parse(unzipped);
          } else {
            stateData = JSON.parse(assembled);
          }
        } else {
          stateData = parsed;
        }
      }
    }
    if (!stateData && this.sessionId === sessionId) {
      stateData = {
        sessionId: this.sessionId,
        currentPrompt: this.currentPrompt,
        history: this.history,
        accumulatedTokens: this.accumulatedTokens,
        logs: this.logs,
        planQueue: this.planQueue,
        taskResults: this.taskResults,
        highestTaskId: this.highestTaskId,
        replanCount: this.replanCount,
        suspendedTask: this.suspendedTask,
      };
    }
    return stateData;
  }

  resume(sessionId, approvalDecision, approvedArgs = null, logCallback = null) {
    const stateData = this.loadState(sessionId);
    if (!stateData) {
      throw new Error(`CRITICAL: No suspended state found for sessionId: ${sessionId}`);
    }

    this.sessionId = stateData.sessionId;
    this.currentPrompt = stateData.currentPrompt;
    this.history = stateData.history || [];
    this.accumulatedTokens = stateData.accumulatedTokens || 0;
    this.logs = stateData.logs || [];
    this.planQueue = stateData.planQueue || [];
    this.taskResults = stateData.taskResults || [];
    this.highestTaskId = stateData.highestTaskId || 0;
    this.replanCount = stateData.replanCount || 0;
    this.suspendedTask = stateData.suspendedTask || null;
    this._turnMaxCapabilityOverride = Boolean(
      stateData.routingSessionState && stateData.routingSessionState.maxCapabilityOverride,
    );

    if (this.hookManager) {
      this.hookManager.sessionId = this.sessionId;
    }

    const log = this._createLogger(logCallback);
    this._activeLogFn = log;

    log(`Resuming execution for session ${sessionId} with decision: ${approvalDecision}`);

    if (this.suspendedTask) {
      const susp = this.suspendedTask;
      this.suspendedTask = null;

      this.deleteState(sessionId);

      if (approvalDecision === "allow" || approvalDecision === "approve") {
        log(`Task [${susp.task ? susp.task.task_id : "unknown"}] approved by human. Executing...`);
        let finalArgs = approvedArgs !== null ? approvedArgs : susp.args;
        
        let rawResultData;
        let taskError = null;
        const taskStartTime = Date.now();
        const cap = this.capabilities.find((c) => c.id === susp.capabilityId);

        try {
          if (cap && cap.type === "Native Tool") {
            let result = cap._tool.function(finalArgs);
            const afterToolRes = this.hookManager.execute("AfterTool", {
              prompt: this.currentPrompt,
              toolName: cap.name,
              tool_name: cap.name,
              tool_input: finalArgs,
              tool_response: { result: result },
              result: result,
              capability: cap
            });
            
            if (afterToolRes.decision === "deny" || afterToolRes.continue === false) {
              rawResultData = `[Interception Blocked/Redacted] ${afterToolRes.reason || "Tool output was hidden by hook policy."}`;
            } else {
              rawResultData = afterToolRes.result !== undefined ? afterToolRes.result : result;
              const additionalToolContext = afterToolRes.hookSpecificOutput?.additionalContext || afterToolRes.additionalContext;
              if (additionalToolContext) {
                rawResultData = rawResultData + "\n\n[Hook Context]:\n" + additionalToolContext;
              }
            }
          } else {
            rawResultData = this._executeTask(cap, susp.executionPrompt, susp.task);
            const afterToolRes = this.hookManager.execute("AfterTool", {
              prompt: this.currentPrompt,
              toolName: cap ? cap.name : susp.capabilityId,
              capabilityId: susp.capabilityId,
              result: rawResultData,
              task: susp.task,
              capability: cap
            });
            
            if (afterToolRes.decision === "deny" || afterToolRes.continue === false) {
              rawResultData = `[Interception Blocked/Redacted] ${afterToolRes.reason || "Tool output was hidden by hook policy."}`;
            } else {
              rawResultData = afterToolRes.result !== undefined ? afterToolRes.result : rawResultData;
              const additionalToolContext = afterToolRes.hookSpecificOutput?.additionalContext || afterToolRes.additionalContext;
              if (additionalToolContext) {
                rawResultData = rawResultData + "\n\n[Hook Context]:\n" + additionalToolContext;
              }
            }
          }
        } catch (err) {
          taskError = err.message;
        }

        const durationMs = Date.now() - taskStartTime;

        if (!taskError) {
          let resultStr = typeof rawResultData === "object" ? JSON.stringify(rawResultData) : String(rawResultData);
          if (resultStr.length > this.maxResultLength) {
            log(`[PAYLOAD WARNING] Task result length exceeded limit. Truncating.`);
            resultStr = resultStr.substring(0, this.maxResultLength) + "\n\n...[TRUNCATED: Exceeds context limit]";
          }
          this.taskResults.push({
            task_id: susp.task ? susp.task.task_id : 0,
            capability_used: susp.capabilityId,
            capability_type: cap ? cap.type : "Unknown",
            prompt: susp.task ? susp.task.execution_prompt : susp.executionPrompt,
            result: resultStr,
            duration_ms: durationMs,
          });
          log(`Task completed successfully in resume phase.`);
        } else {
          this.taskResults.push({
            task_id: susp.task ? susp.task.task_id : 0,
            capability_used: susp.capabilityId,
            capability_type: cap ? cap.type : "Unknown",
            prompt: susp.task ? susp.task.execution_prompt : susp.executionPrompt,
            error: taskError,
            duration_ms: durationMs,
          });
          log(`Task failed in resume phase: ${taskError}`);
          
          if (this.replanCount < this.maxReplans) {
            this.replanCount++;
            log(`[DYNAMIC RE-PLANNING] Re-planning in resume phase...`);
            this.planQueue.length = 0;
            const activeCapabilities = this.capabilities.map((c) => ({
              id: c.id,
              type: c.type,
              name: c.name,
              description: c.description,
            }));
            const replanPromptStr = `
[SYSTEM PRIORITY OVERRIDE] Re-plan remaining steps due to failure.
Original Prompt: "${this.currentPrompt}"
Capabilities: ${JSON.stringify(activeCapabilities, null, 2)}
Successful Tasks: ${JSON.stringify(this.taskResults.filter((t) => !t.error), null, 2)}

FAILURE REPORT:
Failed Capability: ${susp.capabilityId}
Error: ${taskError}

Instructions:
1. Bypass the error. Do NOT use the exact same capability/prompt combination.
2. Decompose remaining work into sequential tasks strictly starting from task_id: ${this.highestTaskId + 1}.
`;
            try {
              const taskArraySchema = {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    task_id: { type: "number" },
                    description: { type: "string" },
                    capability_id: { type: "string" },
                    execution_prompt: { type: "string" },
                    depends_on: { type: "array", items: { type: "number" } },
                  },
                  required: ["task_id", "description", "capability_id", "execution_prompt", "depends_on"],
                }
              };
              const replanConfig = {
                apiKey: this.apiKey,
                model: this.model,
                history: this.history,
                responseSchema: taskArraySchema,
              };
              const replanResText = this._generateContent(replanConfig, replanPromptStr);
              const newPlan = this._extractJson(replanResText);
              this.planQueue.push(...newPlan);
              this.highestTaskId = Math.max(this.highestTaskId, ...newPlan.map((t) => t.task_id));
            } catch (replanErr) {
              log(`Re-planning failed in resume phase: ${replanErr.message}`);
            }
          }
        }
      } else {
        log(`Task approved decision denied: ${approvalDecision}`);
        this.taskResults.push({
          task_id: susp.task ? susp.task.task_id : 0,
          capability_used: susp.capabilityId,
          capability_type: "Unknown",
          prompt: susp.task ? susp.task.execution_prompt : susp.executionPrompt,
          error: `Execution denied by human decision: ${approvalDecision}`,
          duration_ms: 0
        });

        if (this.replanCount < this.maxReplans) {
          this.replanCount++;
          log(`[DYNAMIC RE-PLANNING] Re-planning after human denial...`);
          this.planQueue.length = 0;
          const activeCapabilities = this.capabilities.map((c) => ({
            id: c.id,
            type: c.type,
            name: c.name,
            description: c.description,
          }));
          const replanPromptStr = `
[SYSTEM PRIORITY OVERRIDE] Re-plan remaining steps due to human execution denial.
Original Prompt: "${this.currentPrompt}"
Capabilities: ${JSON.stringify(activeCapabilities, null, 2)}
Successful Tasks: ${JSON.stringify(this.taskResults.filter((t) => !t.error), null, 2)}

FAILURE REPORT:
Failed Capability: ${susp.capabilityId}
Error: Execution denied by human.

Instructions:
1. Do NOT use the denied capability/prompt combination. Try to find alternative capabilities.
2. Decompose remaining work into sequential tasks strictly starting from task_id: ${this.highestTaskId + 1}.
`;
          try {
            const taskArraySchema = {
              type: "array",
              items: {
                type: "object",
                properties: {
                  task_id: { type: "number" },
                  description: { type: "string" },
                  capability_id: { type: "string" },
                  execution_prompt: { type: "string" },
                  depends_on: { type: "array", items: { type: "number" } },
                },
                required: ["task_id", "description", "capability_id", "execution_prompt", "depends_on"],
              }
            };
            const replanConfig = {
              apiKey: this.apiKey,
              model: this.model,
              history: this.history,
              responseSchema: taskArraySchema,
            };
            const replanResText = this._generateContent(replanConfig, replanPromptStr);
            const newPlan = this._extractJson(replanResText);
            this.planQueue.push(...newPlan);
            this.highestTaskId = Math.max(this.highestTaskId, ...newPlan.map((t) => t.task_id));
          } catch (replanErr) {
            log(`Re-planning failed in resume phase after denial: ${replanErr.message}`);
          }
        }
      }
    }

    return this._runRemainingQueueAndSynthesize(logCallback);
  }

  _runRemainingQueueAndSynthesize(logCallback = null) {
    const log = this._createLogger(logCallback);

    const prompt = this.currentPrompt;
    if (!this.startTime) this.startTime = Date.now();

    try {
      while (this.planQueue.length > 0) {
        const timeElapsed = Date.now() - this.startTime;
        if (timeElapsed > this.timeoutMs) {
          log(`[TIMEOUT PREVENTION] Safe abort triggered. Elapsed: ${timeElapsed}ms exceeds ${this.timeoutMs}ms limit.`);
          break;
        }

        const task = this.planQueue.shift();
        log(`Executing Task [${task.task_id}] via [${task.capability_id}]`, {
          description: task.description,
        });

        const cap = this.capabilities.find((c) => c.id === task.capability_id);

        let contextStr = "";
        if (task.depends_on && task.depends_on.length > 0) {
          const dependentResults = this.taskResults
            .filter((tr) => task.depends_on.includes(tr.task_id) && !tr.error)
            .map((tr) => ({
              task_id: tr.task_id,
              capability_used: tr.capability_used,
              result: tr.result,
            }));
          if (dependentResults.length > 0) {
            let serializedDeps = JSON.stringify(dependentResults);
            const maxDepLen = Math.min(this.maxResultLength, 8000);
            if (serializedDeps.length > maxDepLen) {
              serializedDeps =
                serializedDeps.substring(0, maxDepLen) +
                "...[TRUNCATED: Dependent context exceeded limit]";
            }
            contextStr = `\n\n[Context from dependent tasks]:\n${serializedDeps}`;
          }
        }

        const finalExecutionPrompt = task.execution_prompt + contextStr;

        let rawResultData;
        let taskError = null;
        let retries = 1;
        const taskStartTime = Date.now();

        // EXECUTE BeforeTool Hook (Skip for Native Tools to avoid early verification with missing args)
        const isNativeTool = cap && cap.type === "Native Tool";
        const beforeToolRes = isNativeTool ? { decision: "allow" } : this.hookManager.execute("BeforeTool", {
          prompt: prompt,
          toolName: cap ? cap.name : task.capability_id,
          capabilityId: task.capability_id,
          executionPrompt: finalExecutionPrompt,
          task: task,
          capability: cap
        });

        if (beforeToolRes.decision === "deny") {
          taskError = `Execution blocked by BeforeTool hook: ${beforeToolRes.reason || "Denied tool execution"}`;
          retries = -1; // Prevent retry loop
        } else if (beforeToolRes.decision === "suspend") {
          this.suspendedTask = {
            task: task,
            args: null,
            capabilityId: task.capability_id,
            executionPrompt: beforeToolRes.executionPrompt || finalExecutionPrompt
          };
          this.saveState();
          throw new Error(`SUSPENDED: Execution suspended for human approval. SessionId: ${this.sessionId}`);
        } else {
          const activeExecutionPrompt = beforeToolRes.executionPrompt || finalExecutionPrompt;

          while (retries >= 0) {
            const innerElapsed = Date.now() - this.startTime;
            if (innerElapsed > this.timeoutMs) {
              taskError = `Execution aborted by timeout safeguard (${innerElapsed}ms > ${this.timeoutMs}ms).`;
              break;
            }
            try {
              rawResultData = this._executeTask(cap, activeExecutionPrompt, task);
              if (this.suspendedTask) {
                throw new Error(`SUSPENDED: Execution suspended for human approval. SessionId: ${this.sessionId}`);
              }
              taskError = null;
              break;
            } catch (err) {
              if (err.message && err.message.startsWith("SUSPENDED")) {
                throw err;
              }
              const errMsg = err?.message || String(err);
              if (retries <= 0) {
                taskError = errMsg;
                break;
              } else {
                log(`Task [${task.task_id}] failed, retrying... Error: ${errMsg}`, {
                  error: errMsg,
                });
                Utilities.sleep(2000);
                retries--;
              }
            }
          }
        }

        const durationMs = Date.now() - taskStartTime;

        // Result Payload Truncation (Bulletproofing against 400 Payload Too Large)
        let finalResultData = null;
        if (!taskError) {
          let resultStr =
            typeof rawResultData === "object"
              ? JSON.stringify(rawResultData)
              : String(rawResultData);
          if (resultStr.length > this.maxResultLength) {
            log(
              `[PAYLOAD WARNING] Task [${task.task_id}] result length (${resultStr.length}) exceeded limit. Truncating to ${this.maxResultLength} chars.`,
            );
            resultStr =
              resultStr.substring(0, this.maxResultLength) +
              "\n\n...[TRUNCATED: Exceeds context limit]";
          }
          finalResultData = resultStr;

          // EXECUTE AfterTool Hook (Skip for Native Tools to avoid double-firing)
          const afterToolRes = isNativeTool ? { result: finalResultData } : this.hookManager.execute("AfterTool", {
            prompt: prompt,
            toolName: cap ? cap.name : task.capability_id,
            capabilityId: task.capability_id,
            result: finalResultData,
            task: task,
            capability: cap
          });
          
          if (afterToolRes.decision === "deny" || afterToolRes.continue === false) {
            finalResultData = `[Interception Blocked/Redacted] ${afterToolRes.reason || "Tool output was hidden by hook policy."}`;
          } else {
            finalResultData = afterToolRes.result !== undefined ? afterToolRes.result : finalResultData;
            const additionalToolContext = afterToolRes.hookSpecificOutput?.additionalContext || afterToolRes.additionalContext;
            if (additionalToolContext) {
              finalResultData = finalResultData + "\n\n[Hook Context]:\n" + additionalToolContext;
            }
          }
        }

        if (!taskError) {
          this.taskResults.push({
            task_id: task.task_id,
            capability_used: task.capability_id,
            capability_type: cap ? cap.type : "Unknown",
            prompt: task.execution_prompt,
            result: finalResultData,
            duration_ms: durationMs,
          });
          log(
            `Task [${task.task_id}] completed successfully in ${durationMs}ms.`,
          );
        } else {
          this.taskResults.push({
            task_id: task.task_id,
            capability_used: task.capability_id,
            capability_type: cap ? cap.type : "Unknown",
            prompt: task.execution_prompt,
            error: taskError,
            duration_ms: durationMs,
          });
          log(`Task [${task.task_id}] failed definitively in ${durationMs}ms. Error: ${taskError}`, {
            error: taskError,
          });

          // Dynamic Re-Planning Trigger
          if (this.replanCount < this.maxReplans) {
            this.replanCount++;
            log(
              `[DYNAMIC RE-PLANNING] Attempt ${this.replanCount}/${this.maxReplans}. Discarding remaining queue and regenerating DAG...`,
            );
            this.planQueue.length = 0;

            const activeCapabilities = this.capabilities.map((c) => ({
              id: c.id,
              type: c.type,
              name: c.name,
              description: c.description,
            }));
            const replanPromptStr = `
[SYSTEM PRIORITY OVERRIDE] Re-plan remaining steps due to failure.
Original Prompt: "${prompt}"
Capabilities: ${JSON.stringify(activeCapabilities, null, 2)}
Successful Tasks: ${JSON.stringify(
              this.taskResults.filter((t) => !t.error),
              null,
              2,
            )}

FAILURE REPORT:
Failed Capability: ${task.capability_id}
Error: ${taskError}

Instructions:
1. Bypass the error. Do NOT use the exact same capability/prompt combination.
2. Decompose remaining work into sequential tasks strictly starting from task_id: ${this.highestTaskId + 1}.
`;
            try {
              const taskArraySchema = {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    task_id: { type: "number" },
                    description: { type: "string" },
                    capability_id: { type: "string" },
                    execution_prompt: { type: "string" },
                    depends_on: {
                      type: "array",
                      items: { type: "number" },
                    },
                  },
                  required: [
                    "task_id",
                    "description",
                    "capability_id",
                    "execution_prompt",
                    "depends_on",
                  ],
                },
              };
              const replanConfig = {
                apiKey: this.apiKey,
                model: this.model,
                history: this.history,
                responseSchema: taskArraySchema,
              };
              const replanResText = this._generateContent(replanConfig, replanPromptStr);
              const newPlan = this._extractJson(replanResText);
              this.planQueue.push(...newPlan);
              this.highestTaskId = Math.max(
                this.highestTaskId,
                ...newPlan.map((t) => t.task_id),
              );
              log("Re-planning successful. Appended new tasks to queue.", {
                newPlan,
              });
            } catch (replanErr) {
              log("Re-planning failed. Forcing synthesis.", {
                error: replanErr.message,
              });
              break;
            }
          } else {
            log(
              "Maximum re-planning limits reached. Continuing with failure state.",
            );
          }
        }
      }

      log("Execution phase complete. Initiating final synthesis.");

      let timeWarning = "";
      if (Date.now() - this.startTime > this.timeoutMs) {
        timeWarning =
          "\n[CRITICAL SYSTEM WARNING]: Execution was preemptively interrupted to prevent a system timeout. Answer based ONLY on the partial results gathered so far.";
      }

      const synthesizePrompt = `
[SYSTEM: FINAL SYNTHESIS]
Original User Prompt: "${prompt}"

Gathered Execution Data:
${JSON.stringify(this.taskResults, null, 2)}
${timeWarning}

Objective:
1. Formulate a comprehensive, natural response to the user based exclusively on the gathered data.
2. If tasks partially failed, transparently state what succeeded and what could not be completed.
3. CRITICAL: Append an "Execution Summary" at the very end of your response detailing the capabilities used, execution order, duration (ms), and prompts. If no capabilities were used, explicitly state "NO capabilities were used".
`;

      const temporalContext = `\n[System Time Anchor]: Current system date/time is ${new Date().toString()}. Use this as the baseline for relative time references.`;
      let globalInstruction = `You are an autonomous orchestrator agent. Designation: "${this.name}".${temporalContext}\n`;
      let baseInstruction = this.instruction;
      if (this.state && typeof baseInstruction === "string") {
        baseInstruction = baseInstruction.replace(/{(\w+)}/g, (match, key) =>
          this.state[key] !== undefined ? this.state[key] : match,
        );
      }
      if (baseInstruction)
        globalInstruction += `User Persona & Core Instructions: ${typeof baseInstruction === "string" ? baseInstruction : JSON.stringify(baseInstruction)}\n`;

      const synthConfig = {
        apiKey: this.apiKey,
        model: this.model,
        history: this.history,
        systemInstruction: { parts: [{ text: globalInstruction }] },
        _routingRole: "synthesizer",
        _routingPrompt: prompt,
      };
      if (this.outputSchema) synthConfig.responseSchema = this.outputSchema;
      if (this.generateContentConfig)
        synthConfig.generationConfig = this.generateContentConfig;

      const finalAnswer = this._generateContent(synthConfig, synthesizePrompt);

      log("Final synthesis complete.");

      let agentResult = finalAnswer;

      // EXECUTE AfterAgent Hook
      const afterAgentRes = this.hookManager.execute("AfterAgent", {
        finalAnswer: agentResult,
        prompt_response: agentResult,
        prompt: prompt,
        stop_hook_active: false
      });
      
      let forceRetry = (afterAgentRes.decision === "deny" || afterAgentRes.continue === false || afterAgentRes.retry === true);
      let retryPrompt = afterAgentRes.reason || afterAgentRes.retryPrompt || prompt;
      agentResult = afterAgentRes.prompt_response || afterAgentRes.finalAnswer || agentResult;

      if (afterAgentRes.clearContext === true) {
        log("AfterAgent hook requested clearContext: clearing history.");
        this.history = [];
      }

      this.history.push({ role: "user", parts: [{ text: prompt }] });
      this.history.push({
        role: "model",
        parts: [
          {
            text:
              typeof agentResult === "string"
                ? agentResult
                : JSON.stringify(agentResult),
          },
        ],
      });

      // EXECUTE SessionEnd Hook
      const sessionEndRes = this.hookManager.execute("SessionEnd", { 
        finalAnswer: agentResult, 
        error: null, 
        prompt: prompt,
        reason: "exit"
      });
      if (sessionEndRes.systemMessage) {
        log(`[SessionEnd Hook Message] ${sessionEndRes.systemMessage}`);
      }

      if (forceRetry && (!this._retryCount || this._retryCount < 2)) {
        this._retryCount = (this._retryCount || 0) + 1;
        log(`AfterAgent hook requested retry (decision: deny/retry). Initiating retry ${this._retryCount} with prompt/reason: ${retryPrompt}`);
        const retryResult = this.run(retryPrompt, logCallback);
        this._retryCount = 0; // reset
        return retryResult;
      }

      return agentResult;
    } catch (err) {
      if (err.message && err.message.startsWith("SUSPENDED")) {
        throw err;
      }
      // EXECUTE SessionEnd Hook on error
      try {
        const sessionEndRes = this.hookManager.execute("SessionEnd", { 
          finalAnswer: null, 
          error: err.message, 
          prompt: prompt,
          reason: "error"
        });
        if (sessionEndRes.systemMessage) {
          console.log(`[SessionEnd Hook Message on Error] ${sessionEndRes.systemMessage}`);
        }
      } catch (endErr) {
        console.error(`[HookManager Error] Failed executing SessionEnd hook on error: ${endErr.message}`);
      }
      throw err;
    }
  }
};


/**
 * GeminiWithFiles
 * Author: Kanshi Tanaike
 * Version: 2.1.1
 * GitHub: https://github.com/tanaikech/GeminiWithFiles
 * @class
 */
var GeminiWithFiles = class GeminiWithFiles {
  constructor(object = {}) {
    const {
      apiKey,
      accessToken,
      model,
      version,
      doCountToken,
      history,
      functions,
      response_mime_type,
      responseMimeType,
      response_schema = null,
      responseSchema = null,
      response_json_schema = null,
      responseJsonSchema = null,
      temperature = null,
      systemInstruction,
      exportTotalTokens,
      exportRawData,
      toolConfig,
      tools,
      propertiesService,
      resumableUploadAsNewUpload = false,
      generationConfig = {},
      skillFolderId,
      useParametersJsonSchema = false,
      modelRouting,
      routingRole = "default",
      routingPrompt = null,
      remainingMs = null,
      forceMaxCapability = false,
      onRoutingLog = null,
      _routingResolved = false,
    } = object;

    // Updated default model to models/gemini-4-hydrogen
    this.model = model || "models/gemini-4-hydrogen";
    this.version = version || "v1beta";
    this.useParametersJsonSchema = Boolean(useParametersJsonSchema);
    this._lastModelParts = [];
    this.modelRouting = modelRouting !== undefined ? modelRouting : "efficient";
    this.routingRole = routingRole || "default";
    this.routingPrompt = routingPrompt || null;
    this.remainingMs = remainingMs;
    this.forceMaxCapability = Boolean(forceMaxCapability);
    this.onRoutingLog = typeof onRoutingLog === "function" ? onRoutingLog : null;
    this._routingResolved = Boolean(_routingResolved);
    this._lastRoutingDecision = null;

    const baseUrl = "https://generativelanguage.googleapis.com";
    this.baseUrl = baseUrl;
    this.urlGenerateContent = `${baseUrl}/${this.version}/${this.model}:generateContent`;
    this.urlBatchGenerateContent = `${baseUrl}/${this.version}/${this.model}:batchGenerateContent`;
    this.urlUploadFile = `${baseUrl}/upload/${this.version}/files`;
    this.urlGetFileList = `${baseUrl}/${this.version}/files`;
    this.urlDeleteFile = `${baseUrl}/${this.version}/`;
    this.urlCountToken = `${baseUrl}/${this.version}/${this.model}:countTokens`;

    this.doCountToken = doCountToken || false;
    this.exportTotalTokens = exportTotalTokens || false;
    this.exportRawData = exportRawData || false;

    this.queryParameters = apiKey ? { key: apiKey } : {};
    this.accessToken = accessToken || ScriptApp.getOAuthToken();
    this.headers = { authorization: `Bearer ${this.accessToken}` };

    this.fileIds = [];
    this.asImage = false;
    this.blobs = [];
    this.resumableUploads = [];
    this.fileList = [];

    this.skillFolderId = skillFolderId || null;

    this.response_mime_type = response_mime_type || responseMimeType || "";
    this.response_schema = response_schema || responseSchema || null;
    this.response_json_schema =
      response_json_schema || responseJsonSchema || null;
    this.temperature = temperature ?? null;

    this.functions = functions?.params_ ? functions : {};
    if (this.functions && !this.functions.params_) this.functions.params_ = {};

    if (this.skillFolderId) {
      this.functions.params_.activate_skill = {
        description:
          "Activate a specific skill and get detailed instructions and a list of resources. Call this first if you need a skill for the task.",
        parameters: {
          type: "object",
          properties: { skillName: { type: "string" } },
          required: ["skillName"],
        },
      };
      this.functions.activate_skill = (args) =>
        this._activateSkill(args.skillName);

      this.functions.params_.read_skill_resource = {
        description:
          "Read the contents of a resource file (e.g., template) in a skill.",
        parameters: {
          type: "object",
          properties: {
            skillName: { type: "string" },
            fileName: { type: "string" },
          },
          required: ["skillName", "fileName"],
        },
      };
      this.functions.read_skill_resource = (args) =>
        this._readSkillResource(args.skillName, args.fileName);

      this.functions.params_.run_dynamic_script = {
        description:
          "Executes a dynamic JavaScript file from the skill resources.",
        parameters: {
          type: "object",
          properties: {
            skillName: { type: "string" },
            scriptName: { type: "string" },
            argsJSON: { type: "string" },
          },
          required: ["skillName", "scriptName", "argsJSON"],
        },
      };
      this.functions.run_dynamic_script = (args) =>
        this._runDynamicScript(args.skillName, args.scriptName, args.argsJSON);

      this.functions.params_.invoke_agent = {
        description: "Delegates a sub-task to a specialized subagent.",
        parameters: {
          type: "object",
          properties: {
            agent_name: { type: "string" },
            prompt: { type: "string" },
          },
          required: ["agent_name", "prompt"],
        },
      };
      this.functions.invoke_agent = (args) =>
        this._invokeAgent(args.agent_name, args.prompt);

      let systemInstructionText = "";
      if (systemInstruction) {
        if (typeof systemInstruction === "string") {
          systemInstructionText = systemInstruction + "\n\n";
        } else if (
          systemInstruction.parts &&
          Array.isArray(systemInstruction.parts)
        ) {
          systemInstructionText =
            systemInstruction.parts.map((p) => p.text || "").join("\n") +
            "\n\n";
        }
      }

      const skills = this._discoverSkills();
      const skillList = Object.values(skills)
        .map((s) => `- ${s.name}: ${s.description}`)
        .join("\n");
      systemInstructionText += `You are a highly capable AI agent. To solve the user's request, the following skills are available.\n\n[Available Skills]\n${skillList}\n\nCall 'activate_skill' if necessary to reveal detailed instructions for a skill. You can also use 'invoke_agent' to delegate sub-tasks to specialized subagents. Respond directly to the user after using tools.`;

      this.systemInstruction = {
        parts: [{ text: systemInstructionText.trim() }],
      };
    } else {
      this.systemInstruction = systemInstruction || null;
    }

    this.toolConfig = toolConfig ? JSON.parse(JSON.stringify(toolConfig)) : {};
    this.history = history || [];
    this.tools = tools || [];
    this.propertiesService = propertiesService;
    this.resumableUploadAsNewUpload = resumableUploadAsNewUpload;
    this.generationConfig = generationConfig || {};
  }

  setFileIds(fileIds, asImage = false) {
    this.fileIds.push(...fileIds);
    this.asImage = asImage;
    return this;
  }

  setBlobs(blobs) {
    this.blobs.push(...blobs);
    return this;
  }

  setFileIdsOrUrlsWithResumableUpload(array) {
    this.resumableUploads.push(...array);
    return this;
  }

  /**
   * Helper method to extract the original filename from a Gemini File API displayName.
   * Removes 'fileId@' or 'blobName@' prefixes and '$page@X$maxPage@Y' suffixes safely.
   */
  _extractOriginalFilename(displayName) {
    if (!displayName) return "unknown_file";
    const match = displayName.match(
      /^(?:fileId|blobName)@(.+?)(?:\$page@\d+\$maxPage@\d+)?$/,
    );
    return match && match[1] ? match[1] : displayName;
  }

  withUploadedFilesByGenerateContent(fileList = [], retry = 3) {
    if (!fileList.length) throw new Error("Given fileList is empty.");
    const checkState = fileList.filter(({ state }) => state === "PROCESSING");
    if (checkState.length > 0) {
      if (retry > 0) {
        Utilities.sleep(10000);
        const tempSet = new Set(fileList.map(({ name }) => name));
        const tempList = this.getFileList().filter(({ name }) =>
          tempSet.has(name),
        );
        return this.withUploadedFilesByGenerateContent(tempList, retry - 1);
      }
    }
    const obj = new Map();
    for (const e of fileList) {
      let k = this._extractOriginalFilename(e.displayName);
      if (obj.has(k)) obj.get(k).push(e);
      else obj.set(k, [e]);
    }
    this.fileList = Array.from(obj.values()).map((files) => {
      // Only sort if there are multiple parts matching the PDF page convention
      if (
        files.length > 1 &&
        files[0].displayName.match(/\$page@\d+\$maxPage@\d+$/)
      ) {
        files.sort((a, b) => {
          const getPage = (name) => {
            const m = name.match(/\$page@(\d+)/);
            return m ? Number(m[1]) : 0;
          };
          return getPage(a.displayName) - getPage(b.displayName);
        });
      }
      return { files };
    });
    return this;
  }

  uploadFiles(n = 50) {
    if (this.resumableUploads.length > 0)
      return this.resumableUploads.map((e) => this.uploadApp_(e));
    throw new Error("No upload items.");
  }

  getFileList() {
    const fileList = [];
    const q = { ...this.queryParameters, pageSize: 100 };
    let pageToken = "";
    do {
      if (pageToken) q.pageToken = pageToken;
      const url = this.addQueryParameters_(this.urlGetFileList, q);
      const res = this.fetch_({
        url,
        ...(this.queryParameters.key ? {} : { headers: this.headers }),
      });
      const obj = JSON.parse(res.getContentText());
      pageToken = obj.nextPageToken || "";
      if (obj.files && obj.files.length > 0) fileList.push(...obj.files);
    } while (pageToken);
    return fileList;
  }

  deleteFiles(names, n = 50) {
    if (!names.length) return [];
    const requests = names.map((name) => ({
      url:
        `${this.urlDeleteFile}${name}` +
        (this.queryParameters.key ? `?key=${this.queryParameters.key}` : ""),
      method: "delete",
      ...(this.queryParameters.key ? {} : { headers: this.headers }),
      muteHttpExceptions: true,
    }));
    const results = [];
    for (let i = 0; i < Math.ceil(requests.length / n); i++) {
      UrlFetchApp.fetchAll(requests.slice(i * n, (i + 1) * n)).forEach(
        (r) =>
          r.getContentText() && results.push(JSON.parse(r.getContentText())),
      );
    }
    return results;
  }

  generateContentInternal(object, retry) {
    if (!object || typeof object !== "object")
      throw new Error("Please set object including question.");
    if (retry === undefined) retry = this.skillFolderId ? 15 : 5;

    let { q, jsonSchema, parts } = object;
    if (!q && !jsonSchema && (!parts || !Array.isArray(parts)))
      throw new Error("Please set a question.");
    if (!q && jsonSchema && !parts)
      q = `Follow JSON schema.<JSONSchema>${JSON.stringify(jsonSchema)}</JSONSchema>`;

    // Build function_declarations: use parametersJsonSchema when opted in on v1beta,
    // otherwise recursively sanitize parameters for universal OpenAPI 3.0 Schema compatibility.
    const function_declarations = Object.entries(this.functions).reduce(
      (acc, [k, v]) => {
        if (k !== "params_") {
          const rawParameters = this.functions.params_[k]?.parameters;
          const decl = {
            name: k,
            description: this.functions.params_[k]?.description,
          };
          if (this.useParametersJsonSchema && this.version === "v1beta") {
            if (rawParameters && typeof rawParameters === "object") {
              const isEmptyObj =
                String(rawParameters.type || "").toLowerCase() === "object" &&
                (!rawParameters.properties ||
                  Object.keys(rawParameters.properties).length === 0);
              if (!isEmptyObj) {
                decl.parametersJsonSchema = rawParameters;
              }
            }
          } else {
            const sanitizedParameters = this._sanitizeToolParameters(
              rawParameters,
              true,
            );
            if (sanitizedParameters !== undefined) {
              decl.parameters = sanitizedParameters;
            }
          }
          acc.push(decl);
        }
        return acc;
      },
      [],
    );

    const files = this.fileList.flatMap(({ files, mimeType, uri, name }) => {
      if (files && Array.isArray(files)) {
        let fileName = this._extractOriginalFilename(files[0].displayName);
        return [
          {
            text: `[Filename of the following file is ${fileName}. Total pages are ${files.length}.]`,
          },
          ...files.map((f) => ({
            fileData: { fileUri: f.uri, mimeType: f.mimeType },
          })),
        ];
      }
      return [
        {
          text: `[Filename of the following file is ${name}. Total pages are 1.]`,
        },
        { fileData: { fileUri: uri, mimeType } },
      ];
    });

    const contents = [...this.history];
    if (!q && !jsonSchema && parts)
      contents.push({ parts: [...parts, ...files], role: "user" });
    else contents.push({ parts: [{ text: q }, ...files], role: "user" });

    let check = [];
    let usageMetadataObj;
    let cumulativeInputTokens = 0;
    let cumulativeOutputTokens = 0;
    let cumulativeTotalTokens = 0;
    let decisionsTokenCount = 0;
    let llmCallCount = 0;
    let results = [];
    let lastPartsAr = [];
    let rawResult = {};
    let multipleResults = false;
    let continueLoop = false;
    let toolCallHistory = new Set();
    let forceHaltResult = null;

    // Resolve dynamic model & thinkingConfig ONCE per generateContent call (never mutate this.model)
    let activeModel = object._pinnedModel || this.model;
    let activeGenConfig = object._pinnedGenConfig
      ? { ...object._pinnedGenConfig }
      : { ...this.generationConfig };
    let routingDecision = object._pinnedRoutingDecision || null;
    const hasToolsForRouting =
      function_declarations.length > 0 || (this.tools && this.tools.length > 0);
    const shouldRoute =
      !this._routingResolved &&
      !object._routingResolved &&
      typeof GeminiDecisionsRouter === "function";

    if (shouldRoute) {
      const promptForRouting =
        this.routingPrompt ||
        q ||
        (Array.isArray(parts)
          ? parts
              .filter((p) => p && typeof p.text === "string")
              .map((p) => p.text)
              .join("\n")
          : "");
      const routed = GeminiDecisionsRouter.route({
        apiKey: this.queryParameters.key || null,
        prompt: promptForRouting,
        role: this.routingRole,
        configuredModel: this.model,
        configuredGenerationConfig: this.generationConfig,
        hasTools: hasToolsForRouting,
        modelRouting: this.modelRouting,
        remainingMs: this.remainingMs,
        forceMaxCapability: this.forceMaxCapability,
        onLog: this.onRoutingLog,
        consoleLogFallback: !this.onRoutingLog,
      });
      activeModel = routed.model;
      activeGenConfig = routed.generationConfig || {};
      routingDecision = routed.routingDecision;
      decisionsTokenCount = routingDecision?.decisionsInputTokens || 0;
      cumulativeInputTokens += decisionsTokenCount;
      cumulativeTotalTokens += decisionsTokenCount;
    }
    this._lastRoutingDecision = routingDecision;

    const normActiveModel = activeModel.startsWith("models/")
      ? activeModel
      : `models/${activeModel}`;
    const isGemini4 = /(?:^|\/)gemini-4(?:[-.]|$)/i.test(normActiveModel);

    const activeBaseUrl = this.baseUrl || "https://generativelanguage.googleapis.com";
    const activeGenerateUrl = `${activeBaseUrl}/${this.version}/${normActiveModel}:generateContent`;
    const url = this.addQueryParameters_(
      activeGenerateUrl,
      this.queryParameters,
    );
    const requestHeaders = this.queryParameters.key
      ? {}
      : { headers: this.headers };

    const formatReturnValue = (val) => {
      if (!this.exportTotalTokens) return val;
      return {
        returnValue: val,
        usageMetadata: usageMetadataObj,
        inputTokenCount: cumulativeInputTokens,
        outputTokenCount: cumulativeOutputTokens,
        totalTokenCount: cumulativeTotalTokens,
        decisionsTokenCount,
        llmCallCount,
        routingDecision,
      };
    };

    do {
      retry--;
      const payload = { contents };
      const toolsArray = [];

      if (function_declarations.length > 0)
        toolsArray.push({ function_declarations });
      if (this.tools && this.tools.length > 0) toolsArray.push(...this.tools);
      if (toolsArray.length > 0) payload.tools = toolsArray;

      payload.generationConfig = { ...activeGenConfig };
      if (payload.generationConfig.thinkingConfig) {
        payload.generationConfig.thinkingConfig = {
          ...payload.generationConfig.thinkingConfig,
        };
      }
      if (this.response_mime_type)
        payload.generationConfig.response_mime_type = this.response_mime_type;
      if (this.response_schema) {
        delete payload.generationConfig.responseJsonSchema;
        delete payload.generationConfig.response_json_schema;
        payload.generationConfig.response_schema = this.response_schema;
        payload.generationConfig.response_mime_type = "application/json";
      } else if (this.response_json_schema) {
        delete payload.generationConfig.response_schema;
        delete payload.generationConfig.responseSchema;
        payload.generationConfig.responseJsonSchema = this.response_json_schema;
        if (
          !payload.generationConfig.response_mime_type &&
          !payload.generationConfig.responseMimeType
        ) {
          payload.generationConfig.response_mime_type = "application/json";
        }
      }
      if (this.temperature !== null)
        payload.generationConfig.temperature = this.temperature;

      // Universal model-generation thinkingConfig & parameter compatibility guard
      if (typeof GeminiDecisionsRouter === "function") {
        const cfgForGuard = GeminiDecisionsRouter.normalizeRoutingConfig(this.modelRouting);
        const normGuard = GeminiDecisionsRouter.normalizeThinkingConfig(
          normActiveModel,
          null,
          payload.generationConfig,
          cfgForGuard.modelCatalog,
          { allowXHighInGas: cfgForGuard.allowXHighInGas },
        );
        payload.generationConfig = normGuard.generationConfig;
      } else if (isGemini4) {
        delete payload.generationConfig.frequencyPenalty;
        delete payload.generationConfig.frequency_penalty;
        delete payload.generationConfig.presencePenalty;
        delete payload.generationConfig.presence_penalty;
        delete payload.generationConfig.candidateCount;
        delete payload.generationConfig.candidate_count;
        if (payload.generationConfig.thinkingConfig) {
          const tc = payload.generationConfig.thinkingConfig;
          if (tc.thinkingBudget !== undefined) {
            const oldBudget = tc.thinkingBudget;
            delete tc.thinkingBudget;
            if (oldBudget === 0 && !tc.thinkingLevel) {
              tc.thinkingLevel = "LOW";
            }
          }
          if (tc.thinkingLevel) {
            const normLevel = String(tc.thinkingLevel).toUpperCase();
            tc.thinkingLevel = normLevel === "MINIMAL" ? "LOW" : normLevel;
          }
        }
      }

      if (this.systemInstruction)
        payload.systemInstruction = this.systemInstruction;

      let currentToolConfig = { ...this.toolConfig };
      if (
        function_declarations.length > 0 ||
        (this.tools && this.tools.length > 0)
      ) {
        currentToolConfig.functionCallingConfig =
          currentToolConfig.functionCallingConfig
            ? { ...currentToolConfig.functionCallingConfig }
            : { mode: "AUTO" };
        if (currentToolConfig.functionCallingConfig.mode) {
          currentToolConfig.functionCallingConfig.mode = String(
            currentToolConfig.functionCallingConfig.mode,
          ).toUpperCase();
        }
        if (
          function_declarations.length > 0 &&
          this.tools &&
          this.tools.length > 0
        ) {
          currentToolConfig.includeServerSideToolInvocations = true;
        }
      }
      if (Object.keys(currentToolConfig).length > 0)
        payload.toolConfig = currentToolConfig;

      const res = this.fetch_(
        {
          url,
          method: "post",
          payload: JSON.stringify(payload),
          contentType: "application/json",
          ...requestHeaders,
          muteHttpExceptions: true,
        },
        false,
      );
      const code = res.getResponseCode();

      // Paid-only model Free-Tier auto-fallback (billingTier: "auto")
      if (
        [403, 404, 429].includes(code) &&
        !object._paidFallbackAttempted &&
        typeof GeminiDecisionsRouter === "function"
      ) {
        const cfgCheck = GeminiDecisionsRouter.normalizeRoutingConfig(this.modelRouting);
        if (
          cfgCheck.mode !== "fixed" &&
          cfgCheck.billingTier === "auto" &&
          GeminiDecisionsRouter.isPaidOnlyModel(normActiveModel, cfgCheck.modelCatalog)
        ) {
          GeminiDecisionsRouter.markPaidModelUnavailable(normActiveModel);
          const fallbackModel = GeminiDecisionsRouter.normalizeModelName(
            cfgCheck.modelPool.workhorse || "models/gemini-4-hydrogen",
          );
          const normFallback = GeminiDecisionsRouter.normalizeThinkingConfig(
            fallbackModel,
            "HIGH",
            activeGenConfig,
            cfgCheck.modelCatalog,
            { allowXHighInGas: cfgCheck.allowXHighInGas },
          );
          const fbDecision = {
            ...(routingDecision || {}),
            model: fallbackModel,
            thinkingLevel: normFallback.resolvedThinkingLevel,
            thinkingConfig: normFallback.generationConfig.thinkingConfig || null,
            reason: `paid_tier_auto_fallback(${normActiveModel}->${fallbackModel}, HTTP ${code})`,
            fallbackReason: `HTTP ${code} on paid-only model ${normActiveModel}`,
          };
          if (cfgCheck.logRouting !== false) {
            const msg = GeminiDecisionsRouter.formatLogMessage(fbDecision);
            if (typeof this.onRoutingLog === "function") this.onRoutingLog(msg, fbDecision);
            else console.log(msg);
          }
          return this.generateContentInternal(
            {
              q,
              jsonSchema,
              parts,
              _routingResolved: true,
              _paidFallbackAttempted: true,
              _pinnedModel: fallbackModel,
              _pinnedGenConfig: normFallback.generationConfig,
              _pinnedRoutingDecision: fbDecision,
            },
            retry,
          );
        }
      }

      if ([500, 502, 503, 429].includes(code) && retry > 0) {
        console.warn(
          `[GeminiWithFiles] Caught HTTP ${code}. Retrying in 3 seconds...`,
        );
        Utilities.sleep(3000);
        return this.generateContent(
          {
            q,
            jsonSchema,
            parts,
            _routingResolved: true,
            _pinnedModel: normActiveModel,
            _pinnedGenConfig: activeGenConfig,
            _pinnedRoutingDecision: routingDecision,
          },
          retry,
        );
      } else if (code !== 200) {
        throw new Error(`[Gemini API Error] ${res.getContentText()}`);
      }

      const raw = JSON.parse(res.getContentText());
      rawResult = raw;
      const { candidates, usageMetadata } = raw;
      usageMetadataObj = usageMetadata;
      llmCallCount++;
      if (usageMetadata) {
        cumulativeInputTokens += usageMetadata.promptTokenCount || 0;
        cumulativeOutputTokens +=
          (usageMetadata.candidatesTokenCount || 0) +
          (usageMetadata.thoughtsTokenCount || 0);
        cumulativeTotalTokens += usageMetadata.totalTokenCount || 0;
      }

      if (!candidates || candidates.length === 0) break;
      const candidate = candidates[0];

      // === SMART RECOVERY & HALLUCINATION PREVENTION ===
      if (
        candidate.finishReason === "MALFORMED_FUNCTION_CALL" &&
        candidate.finishMessage
      ) {
        const msg = candidate.finishMessage;
        const match = msg.match(/([A-Za-z0-9_]+)\s*(\{(?:.|\n)*\})/);
        if (match) {
          let fnName = match[1];
          let argStr = match[2];
          argStr = argStr.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
          argStr = argStr.replace(/'/g, '"');

          try {
            const argsObj = JSON.parse(argStr);
            console.warn(
              `[GeminiWithFiles] Recovered from MALFORMED_FUNCTION_CALL. Attempting implicit execution of ${fnName}...`,
            );

            if (fnName.startsWith("google_interpreter_"))
              fnName = fnName.replace("google_interpreter_", "");
            const sig = `${fnName}::${JSON.stringify(argsObj)}`;
            let res2;

            if (toolCallHistory.has(sig)) {
              res2 = `[System Intervention] You have already executed '${fnName}' with these exact arguments. Do not repeat. Provide your final answer.`;
            } else if (typeof this.functions[fnName] !== "function") {
              const available = Object.keys(this.functions)
                .filter((k) => k !== "params_")
                .join(", ");
              res2 = `[System Intervention] The tool '${fnName}' does not exist. Available tools are: [${available}]. DO NOT hallucinate or invent function names. Please select a valid tool from the list or respond directly if no tool is applicable.`;
            } else {
              toolCallHistory.add(sig);
              try {
                res2 = this.functions[fnName](argsObj);
              } catch (err) {
                res2 = `[System Intervention] Error: ${err.message}`;
              }
            }

            contents.push({
              parts: [
                {
                  text: `[System Recovery] Attempted to implicitly execute function '${fnName}'. Result:\n${res2}`,
                },
              ],
              role: "user",
            });
            this.history = contents;
            continueLoop = true;

            if (
              this.toolConfig?.functionCallingConfig?.mode?.toUpperCase() ===
              "ANY"
            ) {
              this.toolConfig.functionCallingConfig.mode = "AUTO";
              delete this.toolConfig.functionCallingConfig.allowedFunctionNames;
            }
            continue;
          } catch (e) {
            console.warn(
              `[GeminiWithFiles] Failed to recover malformed arguments: ${e.message}`,
            );
          }
        }
      }

      if (!candidate.content?.parts) {
        results.push(candidate);
        break;
      }

      const partsAr = candidate.content.parts;
      lastPartsAr = partsAr;
      this._lastModelParts = partsAr;
      results.push(...partsAr);
      contents.push({ parts: [...partsAr], role: "model" });

      check = partsAr.filter((pp) => pp.functionCall?.name);
      continueLoop = false;
      let hasCodeExecutionResult = partsAr.some((pp) => pp.codeExecutionResult);
      let hasText = partsAr.some((pp) => pp.text && !pp.thought);

      if (check.length > 0) {
        if (check.length > 1) multipleResults = true;

        let hallucinationOccurred = false;
        for (const chk of check) {
          let functionName = chk.functionCall.name;
          if (functionName.includes(":"))
            functionName = functionName.split(":").pop();
          if (functionName.startsWith("google_interpreter_"))
            functionName = functionName.replace("google_interpreter_", "");

          if (typeof this.functions[functionName] !== "function") {
            hallucinationOccurred = true;
          }
        }

        if (hallucinationOccurred) {
          console.warn(
            "[GeminiWithFiles] Hallucination detected. A requested function does not exist.",
          );
          const available = Object.keys(this.functions)
            .filter((k) => k !== "params_")
            .join(", ");

          const lastModelMsg = contents[contents.length - 1];
          if (lastModelMsg && lastModelMsg.role === "model") {
            lastModelMsg.parts = lastModelMsg.parts.map((p) => {
              if (p.functionCall) {
                let fName = p.functionCall.name;
                if (fName.includes(":")) fName = fName.split(":").pop();
                if (fName.startsWith("google_interpreter_"))
                  fName = fName.replace("google_interpreter_", "");
                if (typeof this.functions[fName] !== "function") {
                  return {
                    text: `[Model attempted to call non-existent function: ${fName}]`,
                  };
                }
              }
              return p;
            });
          }

          contents.push({
            role: "user",
            parts: [
              {
                text: `[System Intervention] You attempted to use a function that does not exist. Available tools are: [${available}]. DO NOT hallucinate or invent function names. Try again.`,
              },
            ],
          });

          this.history = contents;
          continueLoop = true;

          if (
            this.toolConfig?.functionCallingConfig?.mode?.toUpperCase() ===
            "ANY"
          ) {
            this.toolConfig.functionCallingConfig.mode = "AUTO";
            delete this.toolConfig.functionCallingConfig.allowedFunctionNames;
          }
          continue;
        }

        const partss = [];
        for (const chk of check) {
          let functionName = chk.functionCall.name;
          if (functionName.includes(":"))
            functionName = functionName.split(":").pop();
          if (functionName.startsWith("google_interpreter_"))
            functionName = functionName.replace("google_interpreter_", "");

          const argsObj = chk.functionCall.args || {};
          const sig = `${functionName}::${JSON.stringify(argsObj)}`;
          let res2;

          if (toolCallHistory.has(sig)) {
            console.warn(
              `[GeminiWithFiles] Loop detected. Prevented duplicate call to '${functionName}'.`,
            );
            res2 = `[System Intervention] You have already executed '${functionName}' with these exact arguments. Do not repeat this action. Please synthesize and provide your final answer immediately.`;
          } else {
            toolCallHistory.add(sig);
            try {
              res2 = this.functions[functionName](argsObj);
            } catch (err) {
              res2 = `[System Intervention] The tool '${functionName}' encountered an execution error: ${err.message}.`;
            }
          }

          // === DYNAMIC HALT SIGNAL ===
          if (res2 && typeof res2 === "object" && res2._gemini_halt) {
            forceHaltResult = res2;
            partss.push({
              functionResponse: {
                name: functionName,
                response: { name: functionName, content: res2 },
                ...(chk.functionCall.id ? { id: chk.functionCall.id } : {}),
              },
            });
            break;
          }

          if (
            functionName.startsWith("customType_") &&
            typeof this.functions[functionName] === "function"
          ) {
            if (res2?.items && Object.keys(res2).length === 1)
              return res2.items;
            if (
              Array.isArray(res2) &&
              res2.every((e) => e?.items && Object.keys(e).length === 1)
            )
              return res2.map((e) => e.items);
            return res2;
          }

          partss.push({
            functionResponse: {
              name: functionName,
              response: { name: functionName, content: res2 },
              ...(chk.functionCall.id ? { id: chk.functionCall.id } : {}),
            },
          });
        }

        contents.push({ parts: partss, role: "user" });
        this.history = contents;

        if (forceHaltResult) {
          continueLoop = false;
        } else {
          continueLoop = true;
          if (
            this.toolConfig?.functionCallingConfig?.mode?.toUpperCase() ===
            "ANY"
          ) {
            this.toolConfig.functionCallingConfig.mode = "AUTO";
            delete this.toolConfig.functionCallingConfig.allowedFunctionNames;
          }
        }
      } else if (hasCodeExecutionResult && !hasText) {
        this.history = contents;
        contents.push({
          role: "user",
          parts: [
            {
              text: "Please provide the final answer based on the code execution result.",
            },
          ],
        });
        continueLoop = true;
      } else {
        this.history = contents;
        continueLoop = false;
      }
    } while (continueLoop && retry > 0);

    if (this.exportRawData) return rawResult;
    if (continueLoop && retry <= 0)
      throw new Error(
        "[GeminiWithFiles Error] Maximum retry limit exceeded. The model got stuck in an unresolvable loop.",
      );

    if (forceHaltResult) {
      return formatReturnValue(forceHaltResult);
    }

    const nonThoughtTextParts = (lastPartsAr || []).filter(
      (p) => p && typeof p.text === "string" && !p.thought,
    );
    const nonThoughtParts = (lastPartsAr || []).filter((p) => p && !p.thought);
    const output =
      nonThoughtParts[nonThoughtParts.length - 1] ||
      results[results.length - 1];

    if (
      !output ||
      (output.finishReason &&
        ["OTHER", "RECITATION"].includes(output.finishReason))
    )
      return formatReturnValue("No values.");

    let returnValue =
      nonThoughtTextParts.length > 0
        ? nonThoughtTextParts.map((p) => p.text).join("").trim()
        : output.text && !output.thought
          ? output.text.trim()
          : output;

    let parsedReturnValue;
    try {
      parsedReturnValue = JSON.parse(returnValue);
    } catch (stack) {
      parsedReturnValue = returnValue;
    }

    return formatReturnValue(parsedReturnValue);
  }

  chat(obj, options = {}) {
    this.exportRawData = true;
    for (const [k, v] of Object.entries(options)) {
      if (this[k] !== undefined) this[k] = v;
    }
    return this.generateContent(obj);
  }

  _discoverSkills() {
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get(`agent_skills_${this.skillFolderId}`);
    if (cachedData) return JSON.parse(cachedData);
    const folder = DriveApp.getFolderById(this.skillFolderId);
    const folders = folder.getFolders();
    const skills = {};
    while (folders.hasNext()) {
      const subFolder = folders.next();
      const files = subFolder.getFilesByName("SKILL.md");
      if (files.hasNext()) {
        const content = files.next().getBlob().getDataAsString();
        const parsed = this._parseSkillMd(content);
        if (parsed)
          skills[parsed.name] = {
            name: parsed.name,
            description: parsed.description,
            instructions: parsed.instructions,
            folderId: subFolder.getId(),
          };
      }
    }
    const txtFiles = folder.getFilesByType(MimeType.PLAIN_TEXT);
    while (txtFiles.hasNext()) {
      const txtFile = txtFiles.next();
      if (txtFile.getName().endsWith(".txt")) {
        const name = txtFile.getName().replace(".txt", "");
        const content = txtFile.getBlob().getDataAsString();
        skills[name] = {
          name: name,
          description: content.substring(0, 150),
          instructions: content,
          folderId: folder.getId(),
        };
      }
    }
    cache.put(
      `agent_skills_${this.skillFolderId}`,
      JSON.stringify(skills),
      3600,
    );
    return skills;
  }

  _activateSkill(skillName) {
    const skills = this._discoverSkills();
    const skill = skills[skillName];
    if (!skill) return `[Error] Skill '${skillName}' not found.`;
    const files = DriveApp.getFolderById(skill.folderId).getFiles();
    const fileNames = [];
    while (files.hasNext()) fileNames.push(files.next().getName());
    return `[System: Skill Activated]\nInstructions:\n${skill.instructions}\n\nAvailable Resources (Files):\n${fileNames.join(", ")}`;
  }

  _readSkillResource(skillName, fileName) {
    const skills = this._discoverSkills();
    const skill = skills[skillName];
    if (!skill) return `[Error] Skill '${skillName}' not found.`;
    const files = DriveApp.getFolderById(skill.folderId).getFilesByName(
      fileName,
    );
    if (!files.hasNext())
      return `[Error] File '${fileName}' not found in skill '${skillName}'.`;
    return files.next().getBlob().getDataAsString();
  }

  _runDynamicScript(skillName, scriptName, argsJSON) {
    const scriptContent = this._readSkillResource(skillName, scriptName);
    if (scriptContent.startsWith("[Error]")) return scriptContent;
    try {
      const parsedArgs =
        typeof argsJSON === "string" ? JSON.parse(argsJSON) : argsJSON;
      const executableFunc = new Function("args", scriptContent);
      return executableFunc(parsedArgs);
    } catch (e) {
      return `Script Execution Error: ${e.message}`;
    }
  }

  _invokeAgent(agentName, prompt) {
    const skills = this._discoverSkills();
    const subSkill = skills[agentName];
    if (!subSkill) return `[Error] Subagent skill '${agentName}' not found.`;
    try {
      const subagentSystemInstruction = `[SUBAGENT ROLE: ${agentName}]\nInstructions for this role:\n${subSkill.instructions}\n\n`;
      const options = {
        model: this.model,
        version: this.version,
        systemInstruction: subagentSystemInstruction,
        skillFolderId: this.skillFolderId,
        propertiesService: this.propertiesService,
        temperature: this.temperature,
        generationConfig: this.generationConfig,
        modelRouting: this.modelRouting,
        routingRole: "subagent",
        remainingMs: this.remainingMs,
        forceMaxCapability: this.forceMaxCapability,
        onRoutingLog: this.onRoutingLog,
      };
      if (this.queryParameters.key) options.apiKey = this.queryParameters.key;
      if (this.accessToken && !this.queryParameters.key)
        options.accessToken = this.accessToken;
      const subagent = new GeminiWithFiles(options);
      const res = subagent.generateContent({ q: prompt });
      return typeof res === "string" ? res : JSON.stringify(res);
    } catch (e) {
      return `[Error] Subagent execution failed: ${e.message}`;
    }
  }

  _parseSkillMd(content) {
    const normalized = content.replace(/\r\n/g, "\n");
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;
    const yaml = match[1];
    const nameMatch = yaml.match(/name:\s*(.+)/);
    const descMatch = yaml.match(/description:\s*(.+)/);
    return {
      name: nameMatch ? nameMatch[1].trim() : "unknown",
      description: descMatch ? descMatch[1].trim() : "",
      instructions: match[2].trim(),
    };
  }

  /**
   * Recursively sanitizes JSON Schema / MCP inputSchema objects for Gemini
   * FunctionDeclaration.parameters (OpenAPI 3.0 Schema protobuf) using a strict
   * whitelist so unknown JSON Schema or vendor keywords (e.g., `deprecated`,
   * `x-google-enum-descriptions`, `$schema`, `additionalProperties`, `default`)
   * can never trigger HTTP 400 INVALID_ARGUMENT.
   */
  _sanitizeToolParameters(schema, isRoot = false) {
    if (!schema || typeof schema !== "object") return undefined;

    const allowedKeys = new Set([
      "type",
      "format",
      "description",
      "nullable",
      "enum",
      "items",
      "maxItems",
      "minItems",
      "properties",
      "required",
      "anyOf",
      "minimum",
      "maximum",
      "pattern",
    ]);

    const cleaned = {};
    for (const [k, v] of Object.entries(schema)) {
      if (!allowedKeys.has(k) || v === undefined) continue;

      if (k === "type") {
        if (Array.isArray(v)) {
          const nonNull = v.find((t) => String(t).toLowerCase() !== "null");
          if (nonNull) cleaned.type = nonNull;
          if (v.some((t) => String(t).toLowerCase() === "null")) {
            cleaned.nullable = true;
          }
        } else {
          cleaned.type = v;
        }
      } else if (k === "required") {
        if (Array.isArray(v) && v.length > 0) {
          cleaned.required = v;
        }
      } else if (k === "properties" && v && typeof v === "object") {
        const cleanedProps = {};
        for (const [pk, pv] of Object.entries(v)) {
          const sanitizedProp = this._sanitizeToolParameters(pv, false);
          if (sanitizedProp !== undefined) {
            cleanedProps[pk] = sanitizedProp;
          }
        }
        if (Object.keys(cleanedProps).length > 0) {
          cleaned.properties = cleanedProps;
        }
      } else if (k === "items" && v && typeof v === "object") {
        const itemSchema = Array.isArray(v) ? v[0] : v;
        const sanitizedItems = this._sanitizeToolParameters(itemSchema, false);
        if (sanitizedItems !== undefined) {
          cleaned.items = sanitizedItems;
        }
      } else if (k === "anyOf" && Array.isArray(v)) {
        const sanitizedAnyOf = v
          .map((item) => this._sanitizeToolParameters(item, false))
          .filter((item) => item !== undefined);
        if (sanitizedAnyOf.length > 0) {
          cleaned.anyOf = sanitizedAnyOf;
        }
      } else {
        cleaned[k] = v;
      }
    }

    if (cleaned.required && cleaned.properties) {
      cleaned.required = cleaned.required.filter(
        (rk) => Object.prototype.hasOwnProperty.call(cleaned.properties, rk),
      );
      if (cleaned.required.length === 0) delete cleaned.required;
    }

    if (
      String(cleaned.type || "").toLowerCase() === "object" &&
      (!cleaned.properties || Object.keys(cleaned.properties).length === 0)
    ) {
      return isRoot ? undefined : cleaned;
    }

    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }

  addQueryParameters_(url, obj) {
    if (!url) return "";
    const params = Object.entries(obj)
      .flatMap(([k, v]) =>
        Array.isArray(v)
          ? v.map((e) => `${k}=${encodeURIComponent(e)}`)
          : `${k}=${encodeURIComponent(v)}`,
      )
      .join("&");
    return params ? `${url}?${params}` : url;
  }

  setHookManager(hookManager) {
    this.hookManager = hookManager;
    return this;
  }

  generateContent(object, retry) {
    if (this.hookManager) {
      const beforeResult = this.hookManager.execute("BeforeModel", {
        config: this,
        query: (object && object.q) || "",
        history: this.history || [],
        model: this.model
      });

      if (beforeResult.decision === "deny") {
        throw new Error("Model request blocked by GeminiWithFiles BeforeModel hook.");
      }

      if (beforeResult.query && object) {
        object.q = beforeResult.query;
      }

      const mockedResponse = beforeResult.hookSpecificOutput?.llm_response || beforeResult.llm_response;
      if (mockedResponse && mockedResponse.text !== undefined) {
        return { returnValue: mockedResponse.text, totalTokenCount: 0 };
      }
    }

    const rawRes = this.generateContentInternal(object, retry);

    if (this.hookManager) {
      const textVal = typeof rawRes === 'string' ? rawRes : (rawRes.returnValue || "");
      const afterResult = this.hookManager.execute("AfterModel", {
        text: textVal,
        response: rawRes,
        model: this._lastRoutingDecision?.model || this.model,
        routingDecision: this._lastRoutingDecision || null,
      });

      if (afterResult.decision === "deny") {
        throw new Error("Model response blocked and discarded by AfterModel hook.");
      }

      const modifiedResponse = afterResult.hookSpecificOutput?.llm_response || afterResult.llm_response;
      if (modifiedResponse && modifiedResponse.text !== undefined) {
        return { returnValue: modifiedResponse.text, totalTokenCount: rawRes.totalTokenCount || 0 };
      }
    }

    return rawRes;
  }

  /**
   * Exports current model & thinking routing configuration across fixed/efficient/quality modes as JSON (0 API calls).
   * @returns {Object}
   */
  getModelRoutingConfig() {
    if (typeof GeminiDecisionsRouter !== "function") {
      return {
        version: "2.1.1",
        activeMode: "fixed",
        configuredModel: this.model,
        warnings: ["GeminiDecisionsRouter is not loaded; running in fixed mode."],
      };
    }
    return GeminiDecisionsRouter.getRoutingConfigSummary(this.modelRouting, {
      configuredModel: this.model,
      configuredGenerationConfig: this.generationConfig,
    });
  }

  /**
   * Dry-run preview: calls Decisions API once for a prompt and compares fixed/efficient/quality modes.
   * @param {string} prompt
   * @param {Object} [options={}]
   * @returns {Object}
   */
  previewModelRouting(prompt, options = {}) {
    if (typeof GeminiDecisionsRouter !== "function") {
      throw new Error("GeminiDecisionsRouter is required for previewModelRouting().");
    }
    return GeminiDecisionsRouter.previewRouting({
      apiKey: this.queryParameters.key || null,
      prompt,
      role: options.role || this.routingRole || "direct",
      hasTools: Boolean(options.hasTools),
      configuredModel: this.model,
      configuredGenerationConfig: this.generationConfig,
      modelRouting: this.modelRouting,
      remainingMs: this.remainingMs,
    });
  }

  static getModelRoutingPresets(customConfig = null, context = {}) {
    if (typeof GeminiDecisionsRouter !== "function") return null;
    return GeminiDecisionsRouter.getRoutingConfigSummary(customConfig, context);
  }

  static configureModelRouting(customConfig = {}) {
    if (typeof GeminiDecisionsRouter === "function") {
      GeminiDecisionsRouter.configureDefaults(customConfig);
    }
  }

  static resetModelRoutingDefaults() {
    if (typeof GeminiDecisionsRouter === "function") {
      GeminiDecisionsRouter.resetDefaults();
    }
  }

  fetch_(obj, checkError = true) {
    obj.muteHttpExceptions = true;
    const res = UrlFetchApp.fetchAll([obj])[0];
    if (checkError && res.getResponseCode() !== 200) {
      throw new Error(res.getContentText());
    }
    return res;
  }
};

/**
 * GeminiDecisionsRouter
 * Author: Kanshi Tanaike
 * Version: 2.1.1
 * Description: Zero-dependency, data-driven Gemini Decisions API (gemini-decision-1)
 * dynamic model & thinkingLevel router for GASADK and standalone Gemini GAS libraries.
 * Supports 6-model default pool (gemini-3.5-flash-lite, gemini-3.8-flash,
 * gemini-4-hydrogen, gemini-4-neon, gemini-4-argon, gemini-4-carbon),
 * external future-model customization, JSON comparison export, GAS 6-min timeout
 * guardrails, Free-Tier auto-fallback, and per-generation routing logs.
 */
var GeminiDecisionsRouter =
  typeof GeminiDecisionsRouter !== "undefined"
    ? GeminiDecisionsRouter
    : class GeminiDecisionsRouter {
        static get VERSION() {
          return "2.1.1";
        }

        static get DECISIONS_ENDPOINT() {
          return "https://generativelanguage.googleapis.com/v1beta/decisions";
        }

        static _deepClone(obj) {
          if (obj === null || typeof obj !== "object") return obj;
          return JSON.parse(JSON.stringify(obj));
        }

        static _deepMerge(target, source) {
          const out = GeminiDecisionsRouter._deepClone(target || {});
          if (!source || typeof source !== "object") return out;
          Object.keys(source).forEach((key) => {
            const val = source[key];
            if (
              val &&
              typeof val === "object" &&
              !Array.isArray(val) &&
              out[key] &&
              typeof out[key] === "object" &&
              !Array.isArray(out[key])
            ) {
              out[key] = GeminiDecisionsRouter._deepMerge(out[key], val);
            } else if (val !== undefined) {
              out[key] = GeminiDecisionsRouter._deepClone(val);
            }
          });
          return out;
        }

        static normalizeModelName(model) {
          const s = String(model || "").trim();
          if (!s) return "models/gemini-4-hydrogen";
          return s.startsWith("models/") ? s : `models/${s}`;
        }

        static _getBaseModelCatalog() {
          return {
            "models/gemini-3.5-flash-lite": {
              tier: "lite",
              supportedThinkingLevels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"],
              defaultThinkingLevel: "MEDIUM",
              supportsThinkingBudget: false,
              paidOnly: false,
              notes: "Ultra-low-cost, high-volume Flash-Lite model ($0.30/$2.50 per 1M).",
            },
            "models/gemini-3.8-flash": {
              tier: "fast",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
              defaultThinkingLevel: "MEDIUM",
              supportsThinkingBudget: false,
              paidOnly: false,
              notes: "High-speed Flash workhorse ($0.75/$3.75 thru 2026-12-31, $1.50/$7.50 from 2027-01-01).",
            },
            "models/gemini-4-hydrogen": {
              tier: "workhorse",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"],
              defaultThinkingLevel: "HIGH",
              supportsThinkingBudget: false,
              paidOnly: false,
              notes: "Fast, cost-efficient Gemini 4 workhorse ($1.50/$7.50 per 1M, Free tier available).",
            },
            "models/gemini-4-neon": {
              tier: "premium",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH", "XHIGH"],
              defaultThinkingLevel: "HIGH",
              supportsThinkingBudget: false,
              paidOnly: true,
              notes: "Balanced high-efficiency frontier model ($3.00/$15.00 per 1M, Paid only).",
            },
            "models/gemini-4-argon": {
              tier: "frontierFast",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
              defaultThinkingLevel: "MEDIUM",
              supportsThinkingBudget: false,
              paidOnly: true,
              notes: "Fast, lower-thinking-token frontier reasoning model ($4.00/$20.00 from 2026-12-01, Paid only, no XHIGH).",
            },
            "models/gemini-4-carbon": {
              tier: "frontierMax",
              supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
              defaultThinkingLevel: "MEDIUM",
              supportsThinkingBudget: false,
              paidOnly: true,
              notes: "Flagship strongest frontier reasoning model ($4.00/$20.00 from 2026-12-01, Paid only, no XHIGH).",
            },
          };
        }

        static _getBaseModelPool() {
          return {
            lite: "models/gemini-3.5-flash-lite",
            fast: "models/gemini-3.8-flash",
            workhorse: "models/gemini-4-hydrogen",
            premium: "models/gemini-4-neon",
            frontierFast: "models/gemini-4-argon",
            frontierMax: "models/gemini-4-carbon",
          };
        }

        static _getBaseRoutingMatrix() {
          return {
            efficient: {
              trivial: {
                default: { tier: "lite", thinkingLevel: "MINIMAL" },
                withTools: { tier: "lite", thinkingLevel: "LOW" },
                synthesizer: { tier: "lite", thinkingLevel: "MINIMAL" },
              },
              standard: {
                default: { tier: "lite", thinkingLevel: "LOW" },
                withTools: { tier: "fast", thinkingLevel: "LOW" },
                synthesizer: { tier: "lite", thinkingLevel: "LOW" },
                deep: { tier: "workhorse", thinkingLevel: "LOW" },
              },
              complex: {
                default: { tier: "workhorse", thinkingLevel: "LOW" },
                withTools: { tier: "workhorse", thinkingLevel: "LOW" },
                synthesizer: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                deep: { tier: "workhorse", thinkingLevel: "MEDIUM" },
              },
              frontier: {
                default: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                withTools: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "frontierFast", thinkingLevel: "HIGH" },
                direct: { tier: "frontierFast", thinkingLevel: "HIGH" },
              },
              max_capability_override: {
                default: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                withTools: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "frontierMax", thinkingLevel: "HIGH" },
                direct: { tier: "frontierMax", thinkingLevel: "HIGH" },
              },
            },
            quality: {
              trivial: {
                default: { tier: "workhorse", thinkingLevel: "LOW" },
                withTools: { tier: "workhorse", thinkingLevel: "LOW" },
                synthesizer: { tier: "workhorse", thinkingLevel: "MEDIUM" },
              },
              standard: {
                default: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                withTools: { tier: "workhorse", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "premium", thinkingLevel: "MEDIUM" },
                direct: { tier: "premium", thinkingLevel: "MEDIUM" },
              },
              complex: {
                default: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                withTools: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "premium", thinkingLevel: "HIGH" },
                direct: { tier: "frontierFast", thinkingLevel: "HIGH" },
              },
              frontier: {
                default: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                withTools: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "frontierMax", thinkingLevel: "HIGH" },
                direct: { tier: "frontierMax", thinkingLevel: "HIGH" },
              },
              max_capability_override: {
                default: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                withTools: { tier: "frontierFast", thinkingLevel: "MEDIUM" },
                synthesizer: { tier: "frontierMax", thinkingLevel: "HIGH" },
                direct: { tier: "frontierMax", thinkingLevel: "HIGH" },
              },
            },
          };
        }

        static _getBaseDefaults() {
          return {
            mode: "efficient",
            billingTier: "auto",
            decisionModel: "gemini-decision-1",
            maxInputChars: 3000,
            allowXHighInGas: false,
            respectExplicitThinkingConfig: true,
            allowClientRoutingHints: false,
            cacheEnabled: true,
            logRouting: true,
            maxCapabilityThreshold: 0.65,
            deepThinkingThreshold: 0.65,
          };
        }

        static _ensureRegistry() {
          if (!GeminiDecisionsRouter._registry) {
            GeminiDecisionsRouter._registry = {
              defaults: GeminiDecisionsRouter._getBaseDefaults(),
              modelCatalog: GeminiDecisionsRouter._getBaseModelCatalog(),
              modelPool: GeminiDecisionsRouter._getBaseModelPool(),
              routingMatrix: GeminiDecisionsRouter._getBaseRoutingMatrix(),
            };
          }
          if (!GeminiDecisionsRouter._cache) {
            GeminiDecisionsRouter._cache = new Map();
          }
          if (!GeminiDecisionsRouter._unavailablePaidModels) {
            GeminiDecisionsRouter._unavailablePaidModels = new Set();
          }
          if (GeminiDecisionsRouter._decisionsCircuitOpen === undefined) {
            GeminiDecisionsRouter._decisionsCircuitOpen = false;
          }
        }

        /**
         * Globally registers or updates custom model capability definitions for future models.
         * @param {Object<string, Object>} modelsMap
         */
        static registerModels(modelsMap = {}) {
          GeminiDecisionsRouter._ensureRegistry();
          if (!modelsMap || typeof modelsMap !== "object") return;
          Object.keys(modelsMap).forEach((rawKey) => {
            const normKey = GeminiDecisionsRouter.normalizeModelName(rawKey);
            GeminiDecisionsRouter._registry.modelCatalog[normKey] =
              GeminiDecisionsRouter._deepMerge(
                GeminiDecisionsRouter._registry.modelCatalog[normKey] || {},
                modelsMap[rawKey],
              );
          });
        }

        /**
         * Globally customizes default routing settings, modelCatalog, modelPool, and/or routingMatrix.
         * Accepts the same JSON schema exported by getRoutingConfigSummary().
         * @param {Object} customConfig
         */
        static configureDefaults(customConfig = {}) {
          GeminiDecisionsRouter._ensureRegistry();
          if (!customConfig || typeof customConfig !== "object") return;
          const reg = GeminiDecisionsRouter._registry;
          if (customConfig.modelCatalog) {
            GeminiDecisionsRouter.registerModels(customConfig.modelCatalog);
          }
          if (customConfig.modelPool) {
            Object.keys(customConfig.modelPool).forEach((tier) => {
              if (customConfig.modelPool[tier]) {
                reg.modelPool[tier] = GeminiDecisionsRouter.normalizeModelName(
                  customConfig.modelPool[tier],
                );
              }
            });
          }
          if (customConfig.routingMatrix) {
            reg.routingMatrix = GeminiDecisionsRouter._deepMerge(
              reg.routingMatrix,
              customConfig.routingMatrix,
            );
          }
          const scalarKeys = Object.keys(GeminiDecisionsRouter._getBaseDefaults());
          scalarKeys.forEach((k) => {
            if (customConfig[k] !== undefined) {
              reg.defaults[k] = customConfig[k];
            }
          });
          if (customConfig.activeMode && !customConfig.mode) {
            reg.defaults.mode = customConfig.activeMode;
          }
          GeminiDecisionsRouter._cache.clear();
        }

        /**
         * Resets global registry, cache, and circuit breakers back to built-in defaults.
         */
        static resetDefaults() {
          GeminiDecisionsRouter._registry = null;
          GeminiDecisionsRouter._cache = new Map();
          GeminiDecisionsRouter._unavailablePaidModels = new Set();
          GeminiDecisionsRouter._decisionsCircuitOpen = false;
          GeminiDecisionsRouter._ensureRegistry();
        }

        static markPaidModelUnavailable(model) {
          GeminiDecisionsRouter._ensureRegistry();
          GeminiDecisionsRouter._unavailablePaidModels.add(
            GeminiDecisionsRouter.normalizeModelName(model),
          );
        }

        static isPaidOnlyModel(model, catalog) {
          const norm = GeminiDecisionsRouter.normalizeModelName(model);
          const entry = catalog && catalog[norm];
          return Boolean(entry && entry.paidOnly);
        }

        static normalizeRoutingConfig(rawConfig) {
          GeminiDecisionsRouter._ensureRegistry();
          const reg = GeminiDecisionsRouter._registry;
          const base = {
            ...GeminiDecisionsRouter._deepClone(reg.defaults),
            modelCatalog: GeminiDecisionsRouter._deepClone(reg.modelCatalog),
            modelPool: GeminiDecisionsRouter._deepClone(reg.modelPool),
            routingMatrix: GeminiDecisionsRouter._deepClone(reg.routingMatrix),
          };
          if (rawConfig === undefined || rawConfig === null) {
            return base;
          }
          if (typeof rawConfig === "string") {
            const m = rawConfig.trim().toLowerCase();
            if (m === "fixed" || m === "efficient" || m === "efficiency" || m === "quality" || m === "max_quality") {
              base.mode = m === "efficiency" ? "efficient" : m === "max_quality" ? "quality" : m;
            }
            return base;
          }
          if (typeof rawConfig === "object") {
            const modeRaw = rawConfig.mode || rawConfig.activeMode;
            if (typeof modeRaw === "string") {
              const m = modeRaw.trim().toLowerCase();
              if (m === "fixed" || m === "efficient" || m === "efficiency" || m === "quality" || m === "max_quality") {
                base.mode = m === "efficiency" ? "efficient" : m === "max_quality" ? "quality" : m;
              }
            }
            Object.keys(reg.defaults).forEach((k) => {
              if (k !== "mode" && rawConfig[k] !== undefined) {
                base[k] = rawConfig[k];
              }
            });
            if (rawConfig.modelCatalog && typeof rawConfig.modelCatalog === "object") {
              Object.keys(rawConfig.modelCatalog).forEach((mk) => {
                const normKey = GeminiDecisionsRouter.normalizeModelName(mk);
                base.modelCatalog[normKey] = GeminiDecisionsRouter._deepMerge(
                  base.modelCatalog[normKey] || {},
                  rawConfig.modelCatalog[mk],
                );
              });
            }
            if (rawConfig.modelPool && typeof rawConfig.modelPool === "object") {
              Object.keys(rawConfig.modelPool).forEach((tk) => {
                if (rawConfig.modelPool[tk]) {
                  base.modelPool[tk] = GeminiDecisionsRouter.normalizeModelName(
                    rawConfig.modelPool[tk],
                  );
                }
              });
            }
            if (rawConfig.routingMatrix && typeof rawConfig.routingMatrix === "object") {
              base.routingMatrix = GeminiDecisionsRouter._deepMerge(
                base.routingMatrix,
                rawConfig.routingMatrix,
              );
            }
          }
          return base;
        }

        static getModelCapabilities(model, catalog) {
          const norm = GeminiDecisionsRouter.normalizeModelName(model);
          if (catalog && catalog[norm]) {
            return { ...catalog[norm], registered: true };
          }
          if (/(?:^|\/)gemini-2\.5/i.test(norm)) {
            return {
              tier: "legacy",
              supportedThinkingLevels: [],
              defaultThinkingLevel: null,
              supportsThinkingBudget: true,
              paidOnly: false,
              registered: false,
            };
          }
          if (/(?:^|\/)gemini-(?:2\.0|1\.5|1\.0)/i.test(norm)) {
            return {
              tier: "legacy",
              supportedThinkingLevels: [],
              defaultThinkingLevel: null,
              supportsThinkingBudget: false,
              paidOnly: false,
              registered: false,
            };
          }
          // Safe heuristic for unregistered future Gemini 3/4/5+ models
          return {
            tier: "custom",
            supportedThinkingLevels: ["LOW", "MEDIUM", "HIGH"],
            defaultThinkingLevel: "MEDIUM",
            supportsThinkingBudget: false,
            paidOnly: false,
            registered: false,
          };
        }

        /**
         * Normalizes & clamps thinkingConfig for the target model to prevent HTTP 400 errors.
         */
        static normalizeThinkingConfig(model, desiredLevel, existingGenConfig, catalog, options = {}) {
          const normModel = GeminiDecisionsRouter.normalizeModelName(model);
          const caps = GeminiDecisionsRouter.getModelCapabilities(normModel, catalog);
          const genConfig = existingGenConfig ? GeminiDecisionsRouter._deepClone(existingGenConfig) : {};
          const allowXHighInGas = Boolean(options.allowXHighInGas);

          // Strip Gemini 4+ unsupported generationConfig parameters
          if (/(?:^|\/)gemini-[4-9](?:[-.]|$)/i.test(normModel)) {
            delete genConfig.frequencyPenalty;
            delete genConfig.frequency_penalty;
            delete genConfig.presencePenalty;
            delete genConfig.presence_penalty;
            delete genConfig.candidateCount;
            delete genConfig.candidate_count;
          }

          let level = desiredLevel ? String(desiredLevel).toUpperCase() : null;
          if (!level && genConfig.thinkingConfig && genConfig.thinkingConfig.thinkingLevel) {
            level = String(genConfig.thinkingConfig.thinkingLevel).toUpperCase();
          }

          // Handle models supporting thinkingLevel (Gemini 3 / 3.5 / 3.8 / 4 / future)
          if (caps.supportedThinkingLevels && caps.supportedThinkingLevels.length > 0) {
            const supported = caps.supportedThinkingLevels.map((l) => String(l).toUpperCase());
            if (genConfig.thinkingConfig && genConfig.thinkingConfig.thinkingBudget !== undefined) {
              const oldBudget = genConfig.thinkingConfig.thinkingBudget;
              delete genConfig.thinkingConfig.thinkingBudget;
              if (!level && oldBudget === 0) level = "LOW";
            }
            if (level) {
              if (level === "XHIGH" && !allowXHighInGas) {
                level = "HIGH";
              }
              if (!supported.includes(level)) {
                const order = ["MINIMAL", "LOW", "MEDIUM", "HIGH", "XHIGH"];
                const idx = order.indexOf(level);
                if (idx !== -1) {
                  // Clamp down first, then up if lower not supported (e.g. MINIMAL -> LOW)
                  let resolved = null;
                  for (let i = idx - 1; i >= 0; i--) {
                    if (supported.includes(order[i])) {
                      resolved = order[i];
                      break;
                    }
                  }
                  if (!resolved) {
                    for (let i = idx + 1; i < order.length; i++) {
                      if (supported.includes(order[i])) {
                        resolved = order[i];
                        break;
                      }
                    }
                  }
                  level = resolved || caps.defaultThinkingLevel || supported[0];
                } else {
                  level = caps.defaultThinkingLevel || supported[0];
                }
              }
              genConfig.thinkingConfig = {
                ...(genConfig.thinkingConfig || {}),
                thinkingLevel: level,
              };
            }
            return { generationConfig: genConfig, resolvedThinkingLevel: level || caps.defaultThinkingLevel || null };
          }

          // Handle Gemini 2.5 models (thinkingBudget only)
          if (caps.supportsThinkingBudget) {
            const budgetMap = { MINIMAL: 0, LOW: 1024, MEDIUM: 8192, HIGH: 16384, XHIGH: 24576 };
            if (genConfig.thinkingConfig && genConfig.thinkingConfig.thinkingLevel) {
              delete genConfig.thinkingConfig.thinkingLevel;
            }
            if (level && budgetMap[level] !== undefined) {
              genConfig.thinkingConfig = {
                ...(genConfig.thinkingConfig || {}),
                thinkingBudget: budgetMap[level],
              };
              return { generationConfig: genConfig, resolvedThinkingLevel: `budget:${budgetMap[level]}` };
            }
            return { generationConfig: genConfig, resolvedThinkingLevel: null };
          }

          // Older models without thinkingConfig
          delete genConfig.thinkingConfig;
          return { generationConfig: genConfig, resolvedThinkingLevel: null };
        }

        static _resolveMatrixSlot(matrixForMode, complexity, role, hasTools, deepThinking) {
          const compEntry = (matrixForMode && matrixForMode[complexity]) || (matrixForMode && matrixForMode.standard) || {};
          const roleNorm = String(role || "default").toLowerCase();
          if (roleNorm === "synthesizer" || roleNorm === "a2a_synthesizer" || roleNorm === "mcp_summarizer") {
            if (compEntry.synthesizer) return compEntry.synthesizer;
          }
          if (roleNorm === "direct" && compEntry.direct) {
            return compEntry.direct;
          }
          if (deepThinking && compEntry.deep) {
            return compEntry.deep;
          }
          if (hasTools && compEntry.withTools) {
            return compEntry.withTools;
          }
          return compEntry.default || { tier: "workhorse", thinkingLevel: "LOW" };
        }

        static _applyBillingAndTimeGuards(targetModel, targetLevel, cfg, remainingMs) {
          let model = GeminiDecisionsRouter.normalizeModelName(targetModel);
          let level = targetLevel;
          let guardReason = null;
          const workhorse = GeminiDecisionsRouter.normalizeModelName(
            cfg.modelPool.workhorse || "models/gemini-4-hydrogen",
          );

          // Free-tier or runtime-detected Paid-only downgrade
          const isPaid = GeminiDecisionsRouter.isPaidOnlyModel(model, cfg.modelCatalog);
          if (
            isPaid &&
            (cfg.billingTier === "free" ||
              (cfg.billingTier === "auto" &&
                GeminiDecisionsRouter._unavailablePaidModels.has(model)))
          ) {
            model = workhorse;
            level = level === "MEDIUM" || level === "HIGH" || level === "XHIGH" ? "HIGH" : level;
            guardReason = "free_tier_fallback";
          }

          // GAS 6-minute remaining-time guard (null/NaN safe)
          if (typeof remainingMs === "number" && Number.isFinite(remainingMs) && remainingMs > 0) {
            if (remainingMs < 45000) {
              if (GeminiDecisionsRouter.isPaidOnlyModel(model, cfg.modelCatalog)) {
                model = workhorse;
              }
              if (level === "XHIGH" || level === "HIGH" || level === "MEDIUM") {
                level = "LOW";
              }
              guardReason = guardReason ? `${guardReason}+gas_time_guard_45s` : "gas_time_guard_45s";
            } else if (remainingMs < 90000) {
              if (model === GeminiDecisionsRouter.normalizeModelName(cfg.modelPool.frontierMax)) {
                model = GeminiDecisionsRouter.normalizeModelName(
                  cfg.modelPool.frontierFast || workhorse,
                );
                level = "MEDIUM";
                guardReason = guardReason ? `${guardReason}+gas_time_guard_90s` : "gas_time_guard_90s";
              } else if (level === "XHIGH") {
                level = "HIGH";
                guardReason = guardReason ? `${guardReason}+gas_time_guard_90s` : "gas_time_guard_90s";
              }
            }
          }

          return { model, level, guardReason };
        }

        static buildBoundedInput(prompt, maxInputChars = 3000) {
          const cap = Math.max(256, Number(maxInputChars) || 3000);
          let raw = "";
          if (typeof prompt === "string") {
            raw = prompt;
          } else if (prompt !== null && prompt !== undefined) {
            try {
              raw = JSON.stringify(prompt);
            } catch (_) {
              raw = String(prompt);
            }
          }
          // Strip inline base64 data URIs or long base64 blobs
          raw = raw.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]{100,}/g, "[BASE64_OMITTED]");
          raw = raw.replace(/[A-Za-z0-9+/]{512,}={0,2}/g, "[LARGE_BLOB_OMITTED]");
          raw = raw.trim();

          if (raw.length <= cap) {
            return raw || "(empty prompt)";
          }
          const headLen = Math.floor(cap * 0.65);
          const tailLen = Math.max(32, cap - headLen - 20);
          return (
            raw.slice(0, headLen) +
            "\n...[TRUNCATED]...\n" +
            raw.slice(raw.length - tailLen)
          );
        }

        static _buildDecisionsQuestions() {
          return {
            max_capability_override: {
              type: "noul",
              instructions:
                "Does the user prompt explicitly request maximum AI capability, highest possible quality, or deepest thinking (in any language, e.g., 'use maximum capability', 'think as deeply as possible', 'best possible model', '最大の能力で実行', '全力で考えて', '最高精度で')?",
            },
            task_complexity: {
              type: "choice",
              instructions:
                "Classify the reasoning and execution complexity required to answer this prompt accurately.",
              criteria: {
                trivial:
                  "Simple greeting, trivial factual lookup, basic formatting, or single-step extraction.",
                standard:
                  "Routine Q&A, summarization, standard Google Workspace MCP/tool call, or straightforward email/text drafting.",
                complex:
                  "Multi-step analysis, non-trivial coding/debugging, comparative evaluation, or multi-tool orchestration.",
                frontier:
                  "Deep mathematical proof, complex software architecture, security/legal audit, or frontier scientific reasoning.",
              },
            },
            requires_deep_thinking: {
              type: "noul",
              instructions:
                "Does solving this task reliably require multi-step internal reasoning or self-verification?",
            },
          };
        }

        static _normalizeAnswer(raw) {
          const ans = raw || {};
          const noul =
            typeof ans.noul === "number"
              ? ans.noul
              : typeof ans.probability === "number"
                ? ans.probability
                : null;
          const choice =
            typeof ans.choice === "string"
              ? ans.choice
              : typeof ans.selected === "string"
                ? ans.selected
                : typeof ans.value === "string"
                  ? ans.value
                  : null;
          return { noul, choice, confidence: typeof ans.confidence === "number" ? ans.confidence : null };
        }

        static _callDecisionsApi(apiKey, sharedInput, decisionModel) {
          if (typeof UrlFetchApp === "undefined") {
            throw new Error("UrlFetchApp is unavailable in this environment.");
          }
          const payload = {
            model: decisionModel || "gemini-decision-1",
            input: sharedInput,
            questions: GeminiDecisionsRouter._buildDecisionsQuestions(),
          };
          const t0 = Date.now();
          const res = UrlFetchApp.fetch(GeminiDecisionsRouter.DECISIONS_ENDPOINT, {
            method: "post",
            contentType: "application/json",
            headers: { "x-goog-api-key": apiKey },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true,
          });
          const latencyMs = Date.now() - t0;
          const code = res.getResponseCode();
          const rawText = res.getContentText();
          if (code < 200 || code >= 300) {
            const err = new Error(`Decisions API HTTP ${code}: ${String(rawText || "").slice(0, 300)}`);
            err.statusCode = code;
            throw err;
          }
          const body = JSON.parse(rawText);
          const rawAnswers = body.answers || body.decisions || {};
          const usage = body.usage || body.usageMetadata || {};
          const inputTokens =
            typeof usage.totalInputTokens === "number"
              ? usage.totalInputTokens
              : typeof usage.total_input_tokens === "number"
                ? usage.total_input_tokens
                : typeof usage.promptTokenCount === "number"
                  ? usage.promptTokenCount
                  : 0;
          return {
            answers: {
              max_capability_override: GeminiDecisionsRouter._normalizeAnswer(
                rawAnswers.max_capability_override,
              ),
              task_complexity: GeminiDecisionsRouter._normalizeAnswer(
                rawAnswers.task_complexity,
              ),
              requires_deep_thinking: GeminiDecisionsRouter._normalizeAnswer(
                rawAnswers.requires_deep_thinking,
              ),
            },
            inputTokens,
            latencyMs,
          };
        }

        static _hashString(str) {
          let h = 2166136261;
          for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return (h >>> 0).toString(16);
        }

        static formatLogMessage(decision) {
          const d = decision || {};
          const agentPart = d.agent ? `agent=${d.agent} | ` : "";
          const thinkLabel = d.thinkingLevel || "default";
          const msPart =
            typeof d.decisionsLatencyMs === "number" && d.decisionsLatencyMs >= 0
              ? ` (decisions=${d.decisionsLatencyMs}ms)`
              : "";
          return `[ModelRouting] ${agentPart}role=${d.role || "default"} | mode=${d.mode || "fixed"} | model=${d.model} | thinking=${thinkLabel} | reason=${d.reason || "configured"}${msPart}`;
        }

        /**
         * Resolves model & thinkingConfig for a generation call.
         * Always fails open to configuredModel on any auth/network/API error.
         */
        static route(params = {}) {
          GeminiDecisionsRouter._ensureRegistry();
          const cfg = GeminiDecisionsRouter.normalizeRoutingConfig(params.modelRouting);
          const agentName = params.agentName || null;
          const role = params.role || "default";
          const hasTools = Boolean(params.hasTools);
          const configuredModel = GeminiDecisionsRouter.normalizeModelName(
            params.configuredModel || "models/gemini-4-hydrogen",
          );
          const existingGenConfig = params.configuredGenerationConfig || null;
          const hasExplicitThinking = Boolean(
            existingGenConfig &&
              existingGenConfig.thinkingConfig &&
              (existingGenConfig.thinkingConfig.thinkingLevel !== undefined ||
                existingGenConfig.thinkingConfig.thinkingBudget !== undefined),
          );

          const emitAndReturn = (model, generationConfig, decision) => {
            if (cfg.logRouting !== false) {
              const msg = GeminiDecisionsRouter.formatLogMessage(decision);
              if (typeof params.onLog === "function") {
                params.onLog(msg, decision);
              } else if (params.consoleLogFallback && typeof console !== "undefined") {
                console.log(msg);
              }
            }
            return { model, generationConfig, routingDecision: decision };
          };

          // Mode: fixed -> zero Decisions API calls
          if (cfg.mode === "fixed") {
            const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
              configuredModel,
              null,
              existingGenConfig,
              cfg.modelCatalog,
              { allowXHighInGas: cfg.allowXHighInGas },
            );
            return emitAndReturn(configuredModel, norm.generationConfig, {
              agent: agentName,
              role,
              mode: "fixed",
              model: configuredModel,
              thinkingLevel: norm.resolvedThinkingLevel,
              thinkingConfig: norm.generationConfig.thinkingConfig || null,
              complexity: null,
              maxCapabilityOverride: false,
              decisionsLatencyMs: null,
              decisionsInputTokens: 0,
              reason: "fixed_mode",
              fallbackReason: null,
            });
          }

          // Fail-open if apiKey absent (OAuth-only) or circuit breaker tripped
          if (!params.apiKey || GeminiDecisionsRouter._decisionsCircuitOpen) {
            const fallbackReason = !params.apiKey ? "missing_api_key_oauth_only" : "decisions_circuit_open";
            const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
              configuredModel,
              null,
              existingGenConfig,
              cfg.modelCatalog,
              { allowXHighInGas: cfg.allowXHighInGas },
            );
            return emitAndReturn(configuredModel, norm.generationConfig, {
              agent: agentName,
              role,
              mode: cfg.mode,
              model: configuredModel,
              thinkingLevel: norm.resolvedThinkingLevel,
              thinkingConfig: norm.generationConfig.thinkingConfig || null,
              complexity: null,
              maxCapabilityOverride: Boolean(params.forceMaxCapability),
              decisionsLatencyMs: null,
              decisionsInputTokens: 0,
              reason: `fallback:${fallbackReason}`,
              fallbackReason,
            });
          }

          const boundedInput = GeminiDecisionsRouter.buildBoundedInput(
            params.prompt,
            cfg.maxInputChars,
          );
          // Key Decisions evaluation cache strictly by (decisionModel, promptHash) so
          // Planner -> Synthesizer and previewModelRouting() reuse a single Decisions API call.
          const cacheKey = `${cfg.decisionModel}|${GeminiDecisionsRouter._hashString(boundedInput)}`;

          let evalResult = null;
          let cacheHit = false;
          if (cfg.cacheEnabled && GeminiDecisionsRouter._cache.has(cacheKey)) {
            evalResult = GeminiDecisionsRouter._cache.get(cacheKey);
            cacheHit = true;
          } else {
            try {
              evalResult = GeminiDecisionsRouter._callDecisionsApi(
                params.apiKey,
                boundedInput,
                cfg.decisionModel,
              );
              if (cfg.cacheEnabled) {
                GeminiDecisionsRouter._cache.set(cacheKey, evalResult);
              }
            } catch (err) {
              if (err && (err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 404)) {
                GeminiDecisionsRouter._decisionsCircuitOpen = true;
              }
              const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
                configuredModel,
                null,
                existingGenConfig,
                cfg.modelCatalog,
                { allowXHighInGas: cfg.allowXHighInGas },
              );
              return emitAndReturn(configuredModel, norm.generationConfig, {
                agent: agentName,
                role,
                mode: cfg.mode,
                model: configuredModel,
                thinkingLevel: norm.resolvedThinkingLevel,
                thinkingConfig: norm.generationConfig.thinkingConfig || null,
                complexity: null,
                maxCapabilityOverride: Boolean(params.forceMaxCapability),
                decisionsLatencyMs: null,
                decisionsInputTokens: 0,
                reason: "fallback:decisions_api_error",
                fallbackReason: err.message,
              });
            }
          }

          const maxCapProb = evalResult.answers.max_capability_override.noul || 0;
          const deepProb = evalResult.answers.requires_deep_thinking.noul || 0;
          const maxCapOverride =
            Boolean(params.forceMaxCapability) || maxCapProb >= cfg.maxCapabilityThreshold;
          const rawComplexity = evalResult.answers.task_complexity.choice || "standard";
          const effectiveComplexity = maxCapOverride ? "max_capability_override" : rawComplexity;
          const deepThinking = deepProb >= cfg.deepThinkingThreshold;

          const matrixForMode = cfg.routingMatrix[cfg.mode] || cfg.routingMatrix.efficient;
          const slot = GeminiDecisionsRouter._resolveMatrixSlot(
            matrixForMode,
            effectiveComplexity,
            role,
            hasTools,
            deepThinking,
          );
          const pooledModel =
            (slot.model && GeminiDecisionsRouter.normalizeModelName(slot.model)) ||
            cfg.modelPool[slot.tier] ||
            configuredModel;

          const guarded = GeminiDecisionsRouter._applyBillingAndTimeGuards(
            pooledModel,
            slot.thinkingLevel,
            cfg,
            params.remainingMs,
          );

          const desiredLevel =
            hasExplicitThinking && cfg.respectExplicitThinkingConfig && !maxCapOverride
              ? null
              : guarded.level;

          const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
            guarded.model,
            desiredLevel,
            existingGenConfig,
            cfg.modelCatalog,
            { allowXHighInGas: cfg.allowXHighInGas },
          );

          let reason = maxCapOverride
            ? "max_capability_override"
            : `task_complexity:${rawComplexity}${deepThinking ? "+deep" : ""}`;
          if (guarded.guardReason) reason += ` (${guarded.guardReason})`;
          if (cacheHit) reason += " [cached]";

          return emitAndReturn(guarded.model, norm.generationConfig, {
            agent: agentName,
            role,
            mode: cfg.mode,
            model: guarded.model,
            thinkingLevel: norm.resolvedThinkingLevel,
            thinkingConfig: norm.generationConfig.thinkingConfig || null,
            complexity: rawComplexity,
            maxCapabilityOverride: maxCapOverride,
            decisionsLatencyMs: cacheHit ? 0 : evalResult.latencyMs,
            decisionsInputTokens: cacheHit ? 0 : evalResult.inputTokens,
            reason,
            fallbackReason: null,
          });
        }

        /**
         * Exports a clean, zero-secret JSON comparison of current routing settings
         * across fixed, efficient, and quality modes (0 API calls).
         */
        static getRoutingConfigSummary(customConfig = null, context = {}) {
          const cfg = GeminiDecisionsRouter.normalizeRoutingConfig(customConfig);
          const configuredModel = GeminiDecisionsRouter.normalizeModelName(
            context.configuredModel || "models/gemini-4-hydrogen",
          );
          const configuredGenConfig = context.configuredGenerationConfig || null;
          const warnings = [];
          const complexities = [
            "trivial",
            "standard",
            "complex",
            "frontier",
            "max_capability_override",
          ];
          const roles = ["default", "withTools", "synthesizer", "direct"];

          // Validate modelPool against modelCatalog
          Object.keys(cfg.modelPool).forEach((tier) => {
            const m = GeminiDecisionsRouter.normalizeModelName(cfg.modelPool[tier]);
            if (!cfg.modelCatalog[m]) {
              warnings.push(`Unregistered model '${m}' in modelPool.${tier}; heuristic thinking rules will apply.`);
            }
          });

          const fixedNorm = GeminiDecisionsRouter.normalizeThinkingConfig(
            configuredModel,
            null,
            configuredGenConfig,
            cfg.modelCatalog,
            { allowXHighInGas: cfg.allowXHighInGas },
          );

          const buildModeTable = (modeName) => {
            if (modeName === "fixed") {
              return {
                usesDecisionsApi: false,
                model: configuredModel,
                thinkingLevel: fixedNorm.resolvedThinkingLevel,
                thinkingConfig: fixedNorm.generationConfig.thinkingConfig || null,
              };
            }
            const table = { usesDecisionsApi: true, decisionModel: cfg.decisionModel, routes: {} };
            const mat = cfg.routingMatrix[modeName] || {};
            complexities.forEach((comp) => {
              table.routes[comp] = {};
              roles.forEach((r) => {
                const slot = GeminiDecisionsRouter._resolveMatrixSlot(
                  mat,
                  comp,
                  r === "withTools" ? "default" : r,
                  r === "withTools",
                  false,
                );
                const rawModel =
                  (slot.model && GeminiDecisionsRouter.normalizeModelName(slot.model)) ||
                  cfg.modelPool[slot.tier] ||
                  configuredModel;
                const guarded = GeminiDecisionsRouter._applyBillingAndTimeGuards(
                  rawModel,
                  slot.thinkingLevel,
                  cfg,
                  null,
                );
                const norm = GeminiDecisionsRouter.normalizeThinkingConfig(
                  guarded.model,
                  guarded.level,
                  null,
                  cfg.modelCatalog,
                  { allowXHighInGas: cfg.allowXHighInGas },
                );
                if (slot.thinkingLevel && norm.resolvedThinkingLevel && String(slot.thinkingLevel).toUpperCase() !== String(norm.resolvedThinkingLevel).toUpperCase()) {
                  warnings.push(
                    `${modeName}.${comp}.${r}: clamped thinkingLevel '${slot.thinkingLevel}' -> '${norm.resolvedThinkingLevel}' for ${guarded.model}`,
                  );
                }
                table.routes[comp][r] = {
                  tier: slot.tier || "custom",
                  model: guarded.model,
                  thinkingLevel: norm.resolvedThinkingLevel,
                  paidOnly: GeminiDecisionsRouter.isPaidOnlyModel(guarded.model, cfg.modelCatalog),
                };
              });
            });
            return table;
          };

          return {
            version: GeminiDecisionsRouter.VERSION,
            activeMode: cfg.mode,
            configuredModel,
            configuredGenerationConfig: configuredGenConfig
              ? GeminiDecisionsRouter._deepClone(configuredGenConfig)
              : null,
            billingTier: cfg.billingTier,
            decisionModel: cfg.decisionModel,
            allowXHighInGas: cfg.allowXHighInGas,
            maxInputChars: cfg.maxInputChars,
            respectExplicitThinkingConfig: cfg.respectExplicitThinkingConfig,
            logRouting: cfg.logRouting,
            modelPool: GeminiDecisionsRouter._deepClone(cfg.modelPool),
            modelCatalog: GeminiDecisionsRouter._deepClone(cfg.modelCatalog),
            routingMatrix: GeminiDecisionsRouter._deepClone(cfg.routingMatrix),
            modeComparison: {
              fixed: buildModeTable("fixed"),
              efficient: buildModeTable("efficient"),
              quality: buildModeTable("quality"),
            },
            warnings: Array.from(new Set(warnings)),
          };
        }

        /**
         * Dry-run preview: calls Decisions API once for a prompt and compares what
         * fixed, efficient, and quality modes would choose without executing generateContent.
         */
        static previewRouting(params = {}) {
          const baseCfg = GeminiDecisionsRouter.normalizeRoutingConfig(params.modelRouting);
          const role = params.role || "direct";
          const hasTools = Boolean(params.hasTools);
          const configuredModel = GeminiDecisionsRouter.normalizeModelName(
            params.configuredModel || "models/gemini-4-hydrogen",
          );

          const fixedRes = GeminiDecisionsRouter.route({
            ...params,
            modelRouting: { ...baseCfg, mode: "fixed", logRouting: false },
          });
          const effRes = GeminiDecisionsRouter.route({
            ...params,
            modelRouting: { ...baseCfg, mode: "efficient", logRouting: false },
          });
          const qualRes = GeminiDecisionsRouter.route({
            ...params,
            modelRouting: { ...baseCfg, mode: "quality", logRouting: false },
          });

          return {
            version: GeminiDecisionsRouter.VERSION,
            role,
            hasTools,
            configuredModel,
            activeMode: baseCfg.mode,
            comparison: {
              fixed: fixedRes.routingDecision,
              efficient: effRes.routingDecision,
              quality: qualRes.routingDecision,
            },
          };
        }
      };


/**
 * This is for debug.
 */
const forDebug = false; // If this is true, a log is output.
const toLog_ = (kind, text) => {
  const spreadsheetId = "###";
  const sheetName = "rawA2AAppLog";
  const sheet =
    SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (sheet) {
    sheet.appendRow([new Date(), kind, text]);
  }
};

/**
 * Class object for A2AApp.
 * This is used for building both an Agent2Agent (A2A) server and an A2A client with Google Apps Script.
 *
 * ### Usage Example
 * ```javascript
 * const agentCardUrls = [
 *   "https://public.agent.com",
 *   { "secure-agent": { "httpUrl": "https://secure.agent.com", "headers": { "X-Agent-Key": "my-secret" } } }
 * ];
 *
 * const app = new A2AApp({ model: "models/gemini-3.1-flash-lite" });
 * app.setServices({ lock: LockService.getScriptLock() });
 *
 * // --- Chat History Example ---
 * app.setHistory([
 *   { role: "user", parts: [{ text: "Hello, remember that I like apples." }] },
 *   { role: "model", parts: [{ text: "I will remember that you like apples." }] }
 * ]);
 *
 * const response = app.client({
 *   apiKey: "YOUR_GEMINI_API_KEY",
 *   prompt: "Ask the agent what my favorite fruit is.",
 *   agentCardUrls: agentCardUrls
 * });
 * console.log(response.result);
 * ```
 *
 * ### Important Note
 * If this script is used as a server (Web App), you MUST create a "New Deployment"
 * after updating the code. Otherwise, the old cached script will be executed.
 *
 * ### Execution Phases Logged:
 * - [Phase 1: Concurrency Control] LockService limits concurrent overlaps.
 * - [Phase 2: Agent Discovery] Retrieving `.well-known/agent-card.json`.
 * - [Phase 3: Tool Proxying] Dynamic schema conversion to Function Calling formats.
 * - [Phase 4: Planning] Gemini acts as a delegator to determine sequential routing.
 * - [Phase 5: Sequential Execution] Executing functions sequentially with forced routing.
 * - [Phase 6: Data Materialization] Isolating textual output from file blobs.
 * - [Phase 7: Final Synthesis] Generating the ultimate summarized response and Clean History.
 *
 * Author: Kanshi Tanaike
 * Refactored by: Senior Generative AI & MCP Expert
 * Version: 2.10.0 (Gemini Decisions API Dynamic Model & Thinking Routing)
 * GitHub: https://github.com/tanaikech/A2AApp
 * @class
 */
var A2AApp = class A2AApp {
  /**
   * @param {Object} object Configuration object.
   * @param {String} [object.accessKey] Access key for A2A server (optional).
   * @param {Boolean} [object.log] Enable logging to Google Sheets (default: false).
   * @param {String} [object.spreadsheetId] Spreadsheet ID for logs.
   * @param {String} [object.model] Model name (default: "models/gemini-4-hydrogen").
   * @param {String|Object} [object.modelRouting] Dynamic Decisions API routing ("efficient" | "quality" | "fixed" | config object).
   */
  constructor(object = {}) {
    const {
      accessKey = null,
      log = false,
      spreadsheetId,
      model,
      modelRouting,
      remainingMs = null,
      forceMaxCapability = false,
      onRoutingLog = null,
    } = object;

    /** @private */
    this.accessKey = accessKey;

    /** @private */
    this.model = model || "models/gemini-4-hydrogen";

    /** @private */
    this.modelRouting = modelRouting !== undefined ? modelRouting : "efficient";
    this.remainingMs = remainingMs;
    this.forceMaxCapability = Boolean(forceMaxCapability);
    this.onRoutingLog = typeof onRoutingLog === "function" ? onRoutingLog : null;

    /** @private */
    this.jsonrpc = "2.0";

    /** @private */
    this.date = new Date();

    /** @private */
    this.timezone = Session.getScriptTimeZone();

    /** @private */
    this.log = log;

    /** @private Context flag to dynamically adjust log direction values ("server" or "client") */
    this.contextType = "unknown";

    /** @private Chat history initialized array */
    this.history = [];

    if (this.log) {
      const ss = spreadsheetId
        ? SpreadsheetApp.openById(spreadsheetId)
        : SpreadsheetApp.create("Log_A2AApp");
      const targetSheetName = spreadsheetId ? "A2A" : "log";
      const headers = ["Date", "Phase/Method", "ID", "Direction", "Message"];
      /** @private */
      this.sheet = this._getOrCreateSheet(ss, targetSheetName, headers);
    }

    /** @private */
    this.values = [];

    /** @private */
    this.headers = { authorization: `Bearer ${ScriptApp.getOAuthToken()}` };

    /**
     * TaskState Enum
     * Ref: https://google.github.io/A2A/specification/#63-taskstate-enum
     * @private
     */
    this.TaskState = {
      submitted: "submitted",
      working: "working",
      input_required: "input-required",
      completed: "completed",
      canceled: "canceled",
      failed: "failed",
      unknown: "unknown",
    };

    /**
     * Error codes.
     * Ref: https://google.github.io/A2A/specification/#8-error-handling
     * @private
     */
    this.ErrorCode = {
      "Invalid JSON payload": -32700,
      "Invalid JSON-RPC Request": -32600,
      "Method not found": -32601,
      "Invalid method parameters": -32602,
      "Internal server error": -32603,
      "(Server-defined)": -32000,
      "Task not found": -32001,
      "Task cannot be canceled": -32002,
      "Push Notification is not supported": -32003,
      "This operation is not supported": -32004,
      "Incompatible content types": -32005,
      "Streaming is not supported": -32006,
      "Authentication required": -32007,
      "Authorization failed": -32008,
      "Invalid task state for operation": -32009,
      "Rate limit exceeded": -32010,
      "A required resource is unavailable": -32011,
    };

    // Initialize lock service (can be overridden by setServices)
    this.lock = this.lock || LockService.getScriptLock();
    this.properties =
      this.properties || PropertiesService.getScriptProperties();
  }

  /**
   * Safely gets or creates a sheet under a script lock to prevent concurrency errors.
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The spreadsheet object.
   * @param {string} name - The sheet name.
   * @param {Array<string>} headers - Headers to add if creating.
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  _getOrCreateSheet(ss, name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      const lock = LockService.getScriptLock();
      let lockAcquired = false;
      try {
        lockAcquired = lock.tryLock(15000);
        sheet = ss.getSheetByName(name);
        if (!sheet) {
          sheet = ss.insertSheet(name);
          if (headers && headers.length > 0) {
            sheet.appendRow(headers);
            sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
          }
        }
      } catch (e) {
        sheet = ss.getSheetByName(name) || ss.getSheets()[0];
      } finally {
        if (lockAcquired) {
          lock.releaseLock();
        }
      }
    }
    return sheet;
  }

  /**
   * Set services dependent on each script.
   *
   * @param {Object} services Object containing services.
   * @param {GoogleAppsScript.Lock.Lock} services.lock Lock service instance.
   * @param {GoogleAppsScript.Properties.Properties} services.properties Properties service instance.
   * @return {A2AApp}
   */
  setServices(services) {
    const { lock, properties } = services;
    if (lock && lock.toString() === "Lock") {
      this.lock = lock;
    }
    if (properties && properties.toString() === "Properties") {
      this.properties = properties;
    }
    return this;
  }

  /**
   * Sets the conversation history for the agent.
   * This allows the agent to maintain context across multiple interactions in a chat environment.
   *
   * @param {Array<Object>} history - An array of history objects containing 'role' and 'parts'.
   * @returns {A2AApp} This agent instance for chaining.
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      throw new Error(
        "CRITICAL: History must be an array of objects compatible with GeminiWithFiles.",
      );
    }
    this.history = history;
    return this;
  }

  /**
   * Retrieves the current conversation history.
   *
   * @returns {Array<Object>} The current history array.
   */
  getHistory() {
    return this.history || [];
  }

  /**
   * Method for the A2A server side logic.
   *
   * @param {Object} object Parameters object.
   * @param {Object} object.eventObject Event object from doPost/doGet.
   * @param {String} object.apiKey API key for Gemini.
   * @param {Function} object.agentCard Getter function for agent card object.
   * @param {Function} object.functions Getter function for functions object.
   * @return {GoogleAppsScript.Content.TextOutput}
   */
  server(object = {}) {
    this.contextType = "server";
    console.log("--- Server side initialized");
    this.errorProcess_(object);
    let id = "No ID";

    try {
      const { eventObject, agentCardUrls = [], agentCards = [] } = object;
      const obj = eventObject.postData ? this.parseObj_(eventObject) : {};
      id = obj.id || "No ID";

      // [Phase 2: Agent Discovery] Handle Agent Card retrieval logic internally if URLs provided
      if (agentCards.length === 0 && agentCardUrls.length > 0) {
        object.agentCards = this.getAgentCards(agentCardUrls);
      }

      const res = this.createResponse_({ ...object, obj, id });
      this.log_();
      return res;
    } catch (err) {
      console.error(err.stack);
      return this.createErrorResponse_(
        `Internal server error. Error message: ${err.stack}`,
        id,
        "Server Main Process",
      );
    }
  }

  /**
   * Method for the A2A client side logic.
   *
   * @param {Object} object Parameters object.
   * @return {Object} Result object including result, history, and agentCards.
   */
  client(object = {}) {
    this.contextType = "client";
    console.log("--- Client side initialized");

    try {
      // [Phase 2: Agent Discovery] Fetch Agent Cards
      const {
        agentCardUrls = [],
        agentCards = [],
        history = this.history || [],
        directRouting = false,
      } = object;
      object.history = history;
      if (agentCards.length === 0 && agentCardUrls.length > 0) {
        object.agentCards = this.getAgentCards(agentCardUrls);
      }

      let res;
      // [Optimization v2.7.0]: If directRouting is flagged (via LlmAgent), cleanly bypass ALL LLM Mock Orchestration
      // and directly dispatch the JSON-RPC to the network layer.
      if (
        directRouting &&
        object.agentCards &&
        object.agentCards.length === 1
      ) {
        res = this.dispatchDirectRPC_(object);
      } else {
        res = this.processAgents_(object);
      }

      // Safe History Updating
      if (res && res.history) {
        this.history = res.history;
      }
      this.log_();
      return res;
    } catch (err) {
      console.error(err.stack);
      const errObj = {
        error: {
          message: `[A2A Client Error] Internal server error. Error message: ${err.stack}`,
        },
      };
      this.addLog_(
        new Date(),
        "Client Main Process",
        null,
        "client internal",
        JSON.stringify(errObj),
      );
      this.log_();
      return errObj;
    }
  }

  /**
   * Validate required parameters.
   * @private
   */
  errorProcess_(object) {
    if (!object.eventObject) {
      throw new Error("Please set event object from doPost and doGet.");
    }
    if (!object.apiKey) {
      throw new Error("Please set your API key for using Gemini API.");
    }
  }

  /**
   * Helper: Add log entries to the queue seamlessly.
   * @private
   */
  addLog_(date, phaseOrMethod, id, direction, message) {
    if (this.log) {
      this.values.push([
        date,
        phaseOrMethod || "",
        id || "",
        direction || "",
        message,
      ]);
    }
  }

  /**
   * Helper: Create formatted Server Error Response.
   * @private
   */
  createErrorResponse_(message, id, phaseOrMethod) {
    const errObj = {
      jsonrpc: this.jsonrpc,
      error: {
        code: this.ErrorCode["Internal server error"],
        message: `[A2A Server Error] ${message}`,
      },
      id,
    };
    this.addLog_(
      new Date(),
      phaseOrMethod || "Error Response",
      id,
      "server --> client",
      JSON.stringify(errObj),
    );
    this.log_();
    return this.createContent_(errObj);
  }

  /**
   * Create response for the server operations.
   * @private
   */
  createResponse_(object) {
    const {
      eventObject,
      apiKey,
      agentCard,
      functions,
      agentCards = [],
      obj,
      id,
    } = object;
    const { pathInfo, parameter } = eventObject;

    // [Phase 2: Agent Discovery] Handle Discovery (Agent Card request from client)
    if (
      pathInfo === ".well-known/agent.json" ||
      pathInfo === ".well-known/agent-card.json"
    ) {
      this.addLog_(
        new Date(),
        "[Phase 2: Agent Discovery]",
        id,
        "client --> server",
        "Received request for Agent Card.",
      );
      if (typeof agentCard !== "function") {
        throw new Error(
          "[A2A Server Error] Agent card was not found or is not a function.",
        );
      }
      const agentCardObj = agentCard();

      agentCards.forEach(
        ({
          description = "",
          skills = [],
          defaultInputModes = [],
          defaultOutputModes = [],
        }) => {
          if (description) agentCardObj.description += `\n${description}`;
          agentCardObj.skills.push(...skills);
          agentCardObj.defaultInputModes.push(...defaultInputModes);
          agentCardObj.defaultOutputModes.push(...defaultOutputModes);
        },
      );

      // De-duplicate using stringified comparisons for deep objects and Sets for primitives
      const uniqueSkills = new Map(
        agentCardObj.skills.map((s) => [JSON.stringify(s), s]),
      );
      agentCardObj.skills = Array.from(uniqueSkills.values());
      agentCardObj.defaultInputModes = [
        ...new Set(agentCardObj.defaultInputModes),
      ];
      agentCardObj.defaultOutputModes = [
        ...new Set(agentCardObj.defaultOutputModes),
      ];

      this.addLog_(
        new Date(),
        "[Phase 2: Agent Discovery]",
        id,
        "server --> client",
        JSON.stringify(agentCardObj),
      );
      return this.createContent_(agentCardObj);
    }

    if (!obj.method) return null;
    const method = obj.method.toLowerCase();

    // Log incoming payload as client --> server
    this.addLog_(
      new Date(),
      `RPC Method: ${method}`,
      id,
      "client --> server",
      JSON.stringify(obj),
    );

    // 2. Authentication Check
    if (this.accessKey && parameter.accessKey !== this.accessKey) {
      const errMsg = "Invalid accessKey.";
      console.warn(`--- Server Auth Error: ${errMsg}`);
      this.addLog_(new Date(), "Authentication", id, "server internal", errMsg);
      const errObj = {
        jsonrpc: this.jsonrpc,
        error: {
          code: this.ErrorCode["Authorization failed"],
          message: `[A2A Server Error] Authorization failed. ${errMsg}`,
        },
        id,
      };
      this.addLog_(
        new Date(),
        "Authentication",
        id,
        "server --> client",
        JSON.stringify(errObj),
      );
      return this.createContent_(errObj);
    }

    // [Phases 3-7 triggered via processAgents_] Handle 'message/send' and 'tasks/send' seamlessly
    if ((method === "message/send" || method === "tasks/send") && functions) {
      if (typeof functions !== "function") {
        return this.createErrorResponse_(
          "Internal server error. Invalid functions.",
          id,
          method,
        );
      }

      try {
        const { params } = obj;
        const { message, history: clientHistory = [] } = params;
        const prompt = message?.parts?.[0]?.text || "";

        // Trigger the internal orchestration logic on the server side
        const orchestrationRes = this.processAgents_({
          apiKey,
          prompt,
          history: clientHistory,
          functions: functions(),
          fileAsBlob: true,
          agentCards,
        });

        // Guard against internal orchestration failures (e.g., LLM planning crash)
        if (orchestrationRes.error) {
          const errMsg =
            orchestrationRes.error.message ||
            "Internal server orchestration error.";
          console.error(`--- Server Process Error: ${errMsg}`);
          return this.createErrorResponse_(errMsg, id, method);
        }

        const { result, history } = orchestrationRes;
        const artifacts = [];
        const messageParts = [];

        // Distribute generated textual components and file references
        for (let i = 0; i < result.length; i++) {
          const e =
            typeof result[i] === "string"
              ? { type: "text", kind: "text", text: result[i] }
              : result[i];
          const type = e.type;

          if (type === "text") {
            const textPart = {
              type: "text",
              kind: "text",
              text: e[type] || e.text,
            };
            messageParts.push(textPart);
            artifacts.push({ name: "Answer", index: i, parts: [textPart] });
          } else {
            if (type !== "file" && type !== "data") {
              messageParts.push(e);
            } else {
              messageParts.push({
                type: "text",
                kind: "text",
                text: `The data "${e[type]?.name || "file"}" was downloaded.`,
              });
            }
            artifacts.push({ name: "Answer", index: i, parts: [e] });
          }
        }

        const resObj =
          method === "message/send"
            ? {
                jsonrpc: this.jsonrpc,
                result: {
                  kind: "message",
                  messageId: params.messageId,
                  parts: messageParts,
                  role: "agent",
                  history: history, // Provide updated CLEAN history state back to client
                },
                id,
              }
            : {
                jsonrpc: this.jsonrpc,
                result: {
                  kind: "task",
                  id: params.id,
                  sessionId: params.sessionId,
                  status: {
                    state: this.TaskState.completed,
                    message: { role: "agent", parts: messageParts },
                    timestamp: new Date().toISOString(),
                  },
                  artifacts,
                  history: history, // Provide updated CLEAN history state back to client
                },
                id,
              };

        // [Phase 7: Final Synthesis] Returning the final response structure to the calling client.
        this.addLog_(
          new Date(),
          "[Phase 7: Final Synthesis]",
          id,
          "server --> client",
          JSON.stringify(resObj),
        );
        return this.createContent_(resObj);
      } catch (err) {
        console.error(`--- Server Process Error: ${err.stack}`);
        return this.createErrorResponse_(
          `Internal server error. Error message: ${err.stack}`,
          id,
          method,
        );
      }
    }

    return null;
  }

  /**
   * Parse postData contents gracefully.
   * @private
   */
  parseObj_(e) {
    if (e?.postData?.contents) {
      try {
        return JSON.parse(e.postData.contents);
      } catch (err) {
        console.warn("--- Failed to parse postData contents.", err);
      }
    }
    return {};
  }

  /**
   * Create JSON TextOutput context.
   * @private
   */
  createContent_(data) {
    const d = typeof data === "object" ? JSON.stringify(data) : data;
    return ContentService.createTextOutput(d).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  /**
   * Persist queue logs to Google Spreadsheet en-masse.
   * @private
   */
  log_() {
    if (!this.log || !this.sheet || this.values.length === 0) return;
    const lock = this.lock;
    let locked = false;
    try {
      if (lock && typeof lock.tryLock === "function") {
        locked = lock.tryLock(15000);
      }
      const rows = this.values.map((r) =>
        r.map((c) => (typeof c === "string" ? c.substring(0, 40000) : c)),
      );
      this.sheet
        .getRange(this.sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
        .setValues(rows);
      this.values = [];
    } catch (err) {
      console.error("--- Failed to write to log sheet.", err);
    } finally {
      if (locked && lock && typeof lock.releaseLock === "function") {
        lock.releaseLock();
      }
    }
  }

  /**
   * [Direct Routing: Fast-Track JSON-RPC Dispatcher]
   * Radically optimized pipeline for execution when an Orchestrator explicitly assigns a specific target card.
   * Discards the massive overhead of Phase 3 to 7 LLM proxy emulation logic.
   * @private
   */
  dispatchDirectRPCInternal_(object) {
    const { apiKey, prompt, agentCards, history = [] } = object;
    const targetAgent = agentCards[0];

    const phaseTag = "[Direct Routing: Fast-Track JSON-RPC]";
    console.log(
      `${phaseTag} Bypassing internal LLM orchestration to dispatch natively.`,
    );
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "client internal",
      `Target Agent Resolved: ${targetAgent.name || "Unknown Agent"}`,
    );

    const id1 = Utilities.newBlob(new Date().getTime().toString())
      .getBytes()
      .map((byte) => ("0" + (byte & 0xff).toString(16)).slice(-2))
      .join("");
    const id2 = Utilities.getUuid();
    const id3 = Utilities.getUuid();

    const resolvedRoutingMode =
      typeof GeminiDecisionsRouter === "function"
        ? GeminiDecisionsRouter.normalizeRoutingConfig(this.modelRouting).mode
        : typeof this.modelRouting === "string"
          ? this.modelRouting
          : (this.modelRouting && this.modelRouting.mode) || "efficient";

    const resObj = {
      jsonrpc: this.jsonrpc,
      id: id1,
      method: "tasks/send",
      params: {
        id: id2,
        sessionId: id3,
        message: {
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
        acceptedOutputModes: ["text", "text/plain"],
        history: history,
        metadata: {
          gasadkRouting: {
            mode: resolvedRoutingMode,
            maxCapabilityRequested: Boolean(this.forceMaxCapability),
          },
        },
      },
    };

    const combinedHeaders = {
      ...this.headers,
      ...(targetAgent.customHeaders || {}),
    };

    const req = {
      url: targetAgent.url,
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(resObj),
      headers: combinedHeaders,
      muteHttpExceptions: true,
    };

    console.log(`${phaseTag} Dispatching request to: ${req.url}`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "client --> server",
      `JSON-RPC Payload dispatched.`,
    );

    const re = UrlFetchApp.fetch(req.url, req);
    const code = re.getResponseCode();
    const body = re.getContentText();

    console.log(`${phaseTag} Remote agent responded with HTTP Code: ${code}`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "server --> client",
      `Code: ${code}, Body: ${body.substring(0, 1500)}`,
    );

    let results = [];
    if (code === 200) {
      try {
        const oo = JSON.parse(body);
        if (oo.result && oo.result.status?.state === "completed") {
          const sArtifacts = (oo.result.artifacts || []).flatMap(
            ({ parts }) => parts,
          );
          const messageParts = oo.result.status.message?.parts || [];

          const uniqueTexts = new Set();
          const m = [...messageParts, ...sArtifacts].filter((part) => {
            if (part.type === "text") {
              const txt = part.text || "";
              if (uniqueTexts.has(txt)) return false;
              uniqueTexts.add(txt);
            }
            return true;
          });

          results = m.map((part) => part.text || part);
        } else if (oo.error) {
          results.push(
            `Error: Remote agent returned error: ${JSON.stringify(oo.error)}`,
          );
        } else {
          results.push(`Error: Invalid response structure. Body: ${body}`);
        }
      } catch (e) {
        results.push(`Error: Failed to parse JSON response. Body: ${body}`);
      }
    } else {
      results.push(`Error: Remote agent returned HTTP ${code}. Body: ${body}`);
    }

    const historyAnswerText = results
      .map((e) => (typeof e === "string" ? e : "[Binary Data]"))
      .join("\n");
    const cleanHistory = [...history];
    if (prompt) cleanHistory.push({ role: "user", parts: [{ text: prompt }] });
    if (historyAnswerText)
      cleanHistory.push({
        role: "model",
        parts: [{ text: historyAnswerText }],
      });

    console.log(`${phaseTag} Sequence completed successfully.`);
    return { result: results, history: cleanHistory, agentCards };
  }

  /**
   * [Phase 3: Tool Proxying] Prepare client-side functions inclusive of remote agents.
   * Incorporates detailed logging wrappers for introspection and injects custom headers for authenticated routing.
   * @private
   */
  getClientFunctions_(agentCards, addedFunctions, history = []) {
    const phaseTag = "[Phase 3: Tool Proxying]";
    console.log(`${phaseTag} Initiated capabilities mapping.`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      `${this.contextType} internal`,
      "Mapping capabilities into Function Calling schemas.",
    );

    let funcs = {
      params_: {
        without_agent: {
          description:
            "Use this, if the agent and other functions cannot resolve the tasks.",
          parameters: {
            type: "object",
            properties: {
              task: { type: "string", description: "Details of task." },
              response: {
                type: "string",
                description: "Response to the task.",
              },
            },
            required: ["task", "response"],
          },
        },
      },
      without_agent: ({ task, response }) => {
        const msgCall = `--- without_agent invoked. Prompt: ${task}`;
        console.log(msgCall);
        this.addLog_(
          new Date(),
          "[Phase 5: Sequential Execution]",
          null,
          `${this.contextType} internal`,
          msgCall,
        );
        return { task, result: response };
      },
    };

    // Integrate Discovered AI agents via dynamic schema proxying
    if (agentCards.length > 0) {
      agentCards.forEach(
        ({ name, description, url, provider, skills, customHeaders = {} }) => {
          // Add 'customType_' prefix to intentionally bypass GeminiWithFiles automatic loop execution.
          const safeName = "customType_" + name.replace(/ /g, "_");
          const skillStr = skills
            .map((o) => {
              const name = o.name || "no name";
              const description = o.description || "no description";
              const examples =
                o.examples && o.examples.length > 0
                  ? o.examples.join(", ")
                  : "no examples";

              return `id: ${o.id}, name: ${name}, description: ${description}, examples: ${examples}`;
            })
            .join(" | ");

          funcs.params_[safeName] = {
            description: [
              `Agent name: ${safeName}`,
              `Description: ${description}`,
              `URL: ${url}`,
              `Skills: ${skillStr}`,
              provider
                ? `Provider: ${provider.organization}, ${provider.url}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: {
              type: "object",
              properties: {
                agent_name: {
                  type: "string",
                  description: "Agent name you selected.",
                },
                agent_url: { type: "string", description: "URL of the agent." },
                task: {
                  type: "string",
                  description:
                    "Details of task. Give the suitable task to this agent.",
                },
              },
              required: ["agent_name", "agent_url", "task"],
            },
          };

          // Define proxy facade to safely remote trigger specific capabilities
          funcs[safeName] = (args) => {
            const { agent_name, agent_url, task } = args;
            const msgCall = `Agent Call proxy invoked: "${agent_name}" | Assigned Task: "${task}" | URL: ${agent_url}`;
            console.log(`[Phase 5: Sequential Execution] ${msgCall}`);
            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              `${this.contextType} internal`,
              msgCall,
            );

            const id1 = Utilities.newBlob(new Date().getTime().toString())
              .getBytes()
              .map((byte) => ("0" + (byte & 0xff).toString(16)).slice(-2))
              .join("");
            const id2 = Utilities.getUuid();
            const id3 = Utilities.getUuid();

            const resObj = {
              jsonrpc: this.jsonrpc,
              id: id1,
              method: "tasks/send",
              params: {
                id: id2,
                sessionId: id3,
                message: {
                  role: "user",
                  parts: [{ type: "text", text: task }],
                },
                acceptedOutputModes: ["text", "text/plain"],
                history: history, // Injects context state natively into remote protocol requests
              },
            };

            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              "client --> server",
              `JSON-RPC Payload created: ${JSON.stringify(resObj)}`,
            );

            // Apply specific custom headers dynamically extracted from the normalization sequence
            const combinedHeaders = { ...this.headers, ...customHeaders };

            // Wrap response in 'items' pattern to enforce the immediate bypass strategy
            // and forcefully specify 'method' and 'contentType' to avoid invalid generic GET requests.
            return {
              items: {
                functionResponse: {
                  request: {
                    url: agent_url,
                    method: "post",
                    contentType: "application/json",
                    payload: JSON.stringify(resObj),
                    headers: combinedHeaders,
                    muteHttpExceptions: true,
                  },
                  resObj,
                  name: safeName,
                  argsObj: args,
                },
              },
            };
          };
        },
      );
    }

    // Merge User's custom defined implementations with interceptors for granular logging
    if (addedFunctions?.params_) {
      funcs.params_ = { ...funcs.params_, ...addedFunctions.params_ };
      Object.keys(addedFunctions).forEach((k) => {
        if (k !== "params_") {
          const originalFunc = addedFunctions[k];
          funcs[k] = (args) => {
            const msgCall = `Local Function Executed: "${k}" | Args: ${JSON.stringify(args)}`;
            console.log(`[Phase 5: Sequential Execution] ${msgCall}`);
            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              "server internal",
              msgCall,
            );
            try {
              const res = originalFunc(args);
              const strRes = JSON.stringify(res) || "";
              const msgRet = `Function Returned: "${k}" | Data: ${strRes.substring(0, 1000)}`;
              console.log(`[Phase 5: Sequential Execution] ${msgRet}`);
              this.addLog_(
                new Date(),
                "[Phase 5: Sequential Execution]",
                null,
                "server internal",
                msgRet,
              );
              return res;
            } catch (err) {
              const msgErr = `Function Error: "${k}" | Stack: ${err.stack}`;
              console.error(`[Phase 5: Sequential Execution] ${msgErr}`);
              this.addLog_(
                new Date(),
                "[Phase 5: Sequential Execution]",
                null,
                "server internal",
                msgErr,
              );
              throw err;
            }
          };
        }
      });
    }

    return funcs;
  }

  /**
   * Fetch multiple URLs in chunks to avoid AppScript service limits.
   * @private
   */
  fetchAllWithLimitations_(requests, limit = 20) {
    const res = [];
    for (let i = 0; i < requests.length; i += limit) {
      res.push(...UrlFetchApp.fetchAll(requests.slice(i, i + limit)));
    }
    return res;
  }

  /**
   * [Phase 2: Agent Discovery] Retrieve and parse agent cards optimally from given URLs.
   * Handles string URLs as well as structured objects encapsulating custom headers.
   * @param {Array<String|Object>} agentCardUrls Array of strings or objects referring to remote card sources.
   * @return {Array<Object>} Array of sanitized agent card objects.
   */
  getAgentCards(agentCardUrls) {
    const phaseTag = "[Phase 2: Agent Discovery]";
    console.log(`${phaseTag} Initiating agent card retrieval.`);

    if (!agentCardUrls || agentCardUrls.length === 0) {
      console.warn(`${phaseTag} No agent cards URLs provided.`);
      return [];
    }

    // Normalize inputs separating clean string paths and embedded object configurations
    const normalizedUrls = agentCardUrls
      .map((item) => {
        if (typeof item === "string" && item.trim() !== "") {
          return { url: item.trim(), headers: {}, original: item };
        } else if (typeof item === "object" && item !== null) {
          const key = Object.keys(item)[0];
          const val = item[key];
          if (val && val.httpUrl) {
            return {
              url: val.httpUrl.trim(),
              headers: val.headers || {},
              original: item,
            };
          }
        }
        return null;
      })
      .filter(Boolean);

    if (normalizedUrls.length === 0) {
      console.warn(`${phaseTag} No valid agent cards configurations parsed.`);
      return [];
    }

    this.addLog_(
      new Date(),
      phaseTag,
      null,
      `${this.contextType} internal`,
      `Target URLs Processed: ${normalizedUrls.length}`,
    );

    const requests = normalizedUrls.map((norm) => {
      const { url, queryParameters } = this.parseQueryParameters_(norm.url);
      const path = url.split("/").pop();
      const targetUrl = ["exec", "dev"].includes(path)
        ? `${url.trim()}/.well-known/agent-card.json`
        : url.trim();

      // Merge native authentication scopes with the provided dynamic context headers
      const combinedHeaders = { ...this.headers, ...norm.headers };

      this.addLog_(
        new Date(),
        phaseTag,
        null,
        "client --> server",
        `Requesting well-known agent configuration from: ${targetUrl}`,
      );

      return {
        url: this.addQueryParameters_(targetUrl, queryParameters || {}),
        headers: combinedHeaders,
        muteHttpExceptions: true,
      };
    });

    const ress = this.fetchAllWithLimitations_(requests);
    const agentCards = ress.reduce((acc, res, i) => {
      if (res.getResponseCode() === 200) {
        try {
          const o = JSON.parse(res.getContentText());
          o.url = o.url || normalizedUrls[i].url;
          o.customHeaders = normalizedUrls[i].headers; // Inject mapping context downstream

          if (o.name) {
            o.name = o.name.replace(/ /g, "_");
          }
          acc.push(o);
          this.addLog_(
            new Date(),
            phaseTag,
            null,
            "server --> client",
            `Successfully retrieved card for agent: ${o.name}`,
          );
        } catch (e) {
          console.warn(
            `${phaseTag} Failed to parse agent card from "${normalizedUrls[i].url}".`,
          );
        }
      } else {
        console.warn(
          `${phaseTag} Didn't get agent card from "${normalizedUrls[i].url}". HTTP Status: ${res.getResponseCode()}`,
        );
      }
      return acc;
    }, []);

    if (agentCards.length === 0) {
      console.warn(`${phaseTag} No valid agent cards found.`);
    }

    console.log(`${phaseTag} Agent card retrieval complete.`);
    return agentCards;
  }

  /**
   * Core execution orchestration engine for handling prompt assignments dynamically.
   * Runs sequentially through Phase 4, 5, 6, 7.
   * @private
   */
  processAgents_(object) {
    const {
      apiKey,
      agentCards,
      prompt = "",
      history = [],
      fileAsBlob = false,
      functions,
    } = object;

    // [Phase 3: Tool Proxying]
    const addedFunctions = functions ? { ...functions } : null;
    const createdFunctions = this.getClientFunctions_(
      agentCards,
      addedFunctions,
      history,
    );

    // [Phase 4: Planning]
    const phase4Tag = "[Phase 4: Planning]";
    console.log(`${phase4Tag} Analyzing prompt and selecting optimal routing.`);

    let agents = agentCards.map(({ name, description, url, skills }) => {
      const skillStr = skills.map(
        (e) =>
          `Skill name: ${e.name || "no name"}, Description of skill: ${e.description || "no description"}, Examples: ${e.examples && e.examples.length ? e.examples.join(",") : "no examples"}`,
      );
      return `- Name: "${name}", Description: "${description}", URL: "${url}", skills: "${skillStr}"`;
    });
    if (agents.length === 0) agents = ["No agents."];

    let functionCallings = Object.entries(createdFunctions.params_).map(
      ([k, v]) => `- Name: "${k}", Details: ${JSON.stringify(v)}`,
    );
    if (functionCallings.length === 0) functionCallings = ["No functions."];

    const msgAnalyze = `Available Remote Agents: ${agentCards.length} | Available Local Functions/Proxies: ${Object.keys(createdFunctions.params_).length}`;
    console.log(`${phase4Tag} ${msgAnalyze}`);
    this.addLog_(
      new Date(),
      phase4Tag,
      null,
      `${this.contextType} internal`,
      msgAnalyze,
    );

    // Construct the guiding System Instruction layout dynamically
    const systemInstructionText = [
      "You are an expert delegator capable of assigning user requests to appropriate remote agents. You create the suitable order for processing agents and functions.",
      "<Agents>",
      "The following agents are the available agent list.",
      ...agents,
      "</Agents>",
      "<Functions>",
      "The following functions are the available function list. The JSON schema of the value of 'Details' is the same with the schema for the function calling. From 'Details', understand the functions.",
      ...functionCallings,
      "</Functions>",
      "<Mission>",
      "- Understand the agents and the tasks that the agents can do.",
      "- Understand the functions and the tasks that the functions can do.",
      "- Understand requests of the user's prompt.",
      "- For actionable tasks that the agents and the functions can do, select a suitable one of the given agents and functions for accurately resolving requests of the user's prompt in the suitable order. Always include the remote agent's name and the function name when responding to the user.",
      "- If multiple processes can be run with a single agent or a function, create a suitable prompt including those processes in it.",
      "- If the suitable agent and functions cannot be found, directly answer without using them.",
      "</Mission>",
      "<Important>",
      "- Do not fabricate responses.",
      "- If you are unsure, ask the user for more details.",
      "- Suggest the suitable order of the agents and the functions to resolve the user's prompt.",
      "- When the requests include both the agent can resolve and the agent cannot resolve, suggest the order by including the agents, functions, and 'without_agent'.",
      "- Do not fabricate or invent any agent names or function names. Use ONLY the ones explicitly provided.",
      `- Don't include some code in the response value like "tool_code".`,
      `- Don't suggest some code in the response value like "tool_code".`,
      `- If you are required to know the current date time, it's "${Utilities.formatDate(this.date, this.timezone, "yyyy-MM-dd HH:mm:ss")}". And, timezone is ${this.timezone}.`,
      "</Important>",
    ].join("\n");

    const responseSchema = {
      title: "Order of agents and functions for resolving the user's prompt.",
      description:
        "Suggest the suitable order of the agents and the functions to resolve the user's prompt.",
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { description: "Agent name or function name.", type: "string" },
          task: {
            description:
              "For actionable tasks that the agents and the functions can do, select a suitable one of the given agents and functions to accurately resolve requests of the user's prompt in the suitable order. Here, don't include the agent URL.",
            type: "string",
          },
        },
      },
    };

    // Initial Orchestration invocation
    const g = new GeminiWithFiles({
      apiKey,
      systemInstruction: {
        parts: [{ text: systemInstructionText }],
        role: "model",
      },
      model: this.model,
      responseMimeType: "application/json",
      responseSchema,
      modelRouting: this.modelRouting,
      routingRole: "a2a_planner",
      routingPrompt: prompt,
      remainingMs: this.remainingMs,
      forceMaxCapability: this.forceMaxCapability,
      onRoutingLog: this.onRoutingLog,
    });
    if (this.hookManager) g.setHookManager(this.hookManager);
    g.history = [...history, ...(g.history || [])];

    const textPrompt = `User's prompt is as follows.\n<UserPrompt>${prompt}</UserPrompt>`;
    const orderArTemp = g.generateContent({ q: textPrompt });
    const orderAr = Array.isArray(orderArTemp) ? orderArTemp : [];

    const msgOrder = `Determined Execution Order: ${JSON.stringify(orderAr)}`;
    console.log(`${phase4Tag} ${msgOrder}`);
    forDebug && toLog_("orderAr", JSON.stringify(orderAr));
    this.addLog_(
      new Date(),
      phase4Tag,
      null,
      `${this.contextType} internal`,
      msgOrder,
    );

    if (!Array.isArray(orderAr) || orderAr.length === 0) {
      const errObj = {
        error: {
          code: this.ErrorCode["Internal server error"],
          message:
            "[A2A Client Error] Internal server error. Execution Order Generation Failed.",
        },
        jsonrpc: this.jsonrpc,
        id: null,
      };
      console.error(`${phase4Tag} Execution Order Generation Failed.`);
      this.addLog_(
        new Date(),
        phase4Tag,
        null,
        `${this.contextType} internal`,
        JSON.stringify(errObj),
      );
      return errObj;
    }

    // [Phase 5: Sequential Execution]
    const phase5Tag = "[Phase 5: Sequential Execution]";
    console.log(
      `${phase5Tag} Initiating sequential execution based on planning phase.`,
    );
    let tempHistory = [...g.history];
    const results = [];

    // Evaluate the sequential path sequentially
    for (const { name, task } of orderAr) {
      const msgExec = `Delegating to Tool/Agent: "${name}" | Task Details: "${task}"`;
      console.log(`${phase5Tag} ${msgExec}`);
      this.addLog_(
        new Date(),
        phase5Tag,
        null,
        `${this.contextType} internal`,
        msgExec,
      );

      const funcCall = {
        params_: { [name]: createdFunctions.params_[name] },
        [name]: createdFunctions[name],
      };

      const gg = new GeminiWithFiles({
        apiKey,
        model: this.model,
        functions: funcCall,
        history: tempHistory,
        modelRouting: this.modelRouting,
        routingRole: "a2a_executor",
        routingPrompt: task,
        remainingMs: this.remainingMs,
        forceMaxCapability: this.forceMaxCapability,
        onRoutingLog: this.onRoutingLog,
        toolConfig: {
          functionCallingConfig: { mode: "any", allowedFunctionNames: [name] },
        },
      });
      if (this.hookManager) gg.setHookManager(this.hookManager);

      const q = [
        `Your task is as follows.`,
        `<Task>${task}</Task>`,
        `<Important>`,
        `- If you do not have enough information to resolve "Task", ask the user for more details without generating content forcefully.`,
        `</Important>`,
      ].join("\n");

      const res = gg.generateContent({ q });

      const msgResType = `Result received from Gemini node for "${name}" | Type: [${typeof res}] | Content preview: ${typeof res === "string" ? res : JSON.stringify(res).substring(0, 500)}`;
      console.log(`${phase5Tag} ${msgResType}`);
      this.addLog_(
        new Date(),
        phase5Tag,
        null,
        `${this.contextType} internal`,
        msgResType,
      );
      forDebug && toLog_("In task loop", JSON.stringify(res));

      // Check if bypassed via customType_ return mechanism
      const funcRes =
        res.functionResponse ||
        (res.items && res.items.functionResponse
          ? res.items.functionResponse
          : undefined);

      // Handle the resulting operation appropriately whether standard Function or A2A
      if (typeof res === "string") {
        results.push({ type: "text", text: res });
      } else if (res.text) {
        results.push({ type: "text", text: res.text });
      } else if (Array.isArray(res)) {
        // Handle array responses naturally
        const texts = res.map((r) =>
          typeof r === "string" ? r : r.text || JSON.stringify(r),
        );
        results.push({ type: "text", text: texts.join("\n") });
      } else if (funcRes?.request) {
        const req = funcRes.request;
        const msgReq = `Dispatching JSON-RPC request to remote agent: ${req.url}`;
        console.log(`${phase5Tag} ${msgReq}`);
        this.addLog_(new Date(), phase5Tag, null, "client --> server", msgReq);

        const re = UrlFetchApp.fetch(req.url, req);
        const code = re.getResponseCode();
        const body = re.getContentText();

        const msgRes = `Remote agent responded with HTTP Code: ${code}`;
        console.log(`${phase5Tag} ${msgRes}`);
        this.addLog_(
          new Date(),
          phase5Tag,
          null,
          "server --> client",
          `Code: ${code}, Body: ${body.substring(0, 1500)}`,
        );

        if (code === 200) {
          const oo = JSON.parse(body);
          if (oo.result) {
            const {
              id: id1,
              params: { id: id2, sessionId: id3 },
            } = funcRes.resObj;

            if (
              oo.result.status?.state === "completed" &&
              oo.id === id1 &&
              oo.result.id === id2 &&
              oo.result.sessionId === id3
            ) {
              const sArtifacts = (oo.result.artifacts || []).flatMap(
                ({ parts }) => parts,
              );
              const messageParts = oo.result.status.message?.parts || [];

              // Deduplicate redundant text blocks natively spawned from separate artifact schemas
              const uniqueTexts = new Set();
              const m = [...messageParts, ...sArtifacts].filter((part) => {
                if (part.type === "text") {
                  const txt = part.text || "";
                  if (uniqueTexts.has(txt)) return false;
                  uniqueTexts.add(txt);
                }
                return true;
              });

              results.push(...m);

              // Emulate structural knowledge block representation for tracking context effectively
              let bkHistory = m.filter((mm) => mm.type === "text");
              if (bkHistory.length === 0 && m.length > 0) {
                const sss = m
                  .map(
                    (mm) =>
                      `Name: ${mm[mm.type]?.name}, MimeType: ${mm[mm.type]?.mimeType}`,
                  )
                  .join("\n");
                bkHistory = [
                  { type: "text", text: `Data is as follows.\n${sss}` },
                ];
              }

              // Manually patch the history array while preserving Gemini 3/4 thoughtSignature.
              if (funcRes.name && funcRes.argsObj) {
                const matchedPart = Array.isArray(gg._lastModelParts)
                  ? gg._lastModelParts.find(
                      (p) => p?.functionCall?.name === funcRes.name,
                    )
                  : null;
                const modelFcPart = matchedPart
                  ? { ...matchedPart }
                  : {
                      functionCall: {
                        name: funcRes.name,
                        args: funcRes.argsObj,
                      },
                      thoughtSignature: "skip_thought_signature_validator",
                    };
                gg.history.push({
                  role: "model",
                  parts: [modelFcPart],
                });
                gg.history.push({
                  role: "user",
                  parts: [
                    {
                      functionResponse: {
                        name: funcRes.name,
                        response: { name: funcRes.name, content: bkHistory },
                      },
                    },
                  ],
                });
              } else {
                const lastHistory = gg.history[gg.history.length - 1];
                if (lastHistory?.parts?.[0]?.functionResponse?.response) {
                  lastHistory.parts[0].functionResponse.response.content =
                    bkHistory;
                }
              }
            } else {
              const errMsg = `Error: Remote agent ${name} did not complete successfully. Task: ${task}`;
              console.error(`${phase5Tag} ${errMsg}`);
              results.push({ type: "text", text: errMsg });
            }
          } else if (oo.error) {
            const errMsg = `Error: Remote agent ${name} returned error: ${JSON.stringify(oo.error)}`;
            console.error(`${phase5Tag} ${errMsg}`);
            results.push({ type: "text", text: errMsg });
          }
        } else {
          const errMsg = `Error: Remote agent ${name} returned HTTP ${code}. Task: ${task}`;
          console.error(`${phase5Tag} ${errMsg}`);
          results.push({ type: "text", text: errMsg });
        }
      } else if (funcRes?.result) {
        let text = funcRes.result;
        if (funcRes.result?.content?.[0]?.text) {
          text = funcRes.result.content[0].text;
        }
        results.push({ type: "text", text });
      } else if (funcRes?.a2a?.result) {
        results.push({ type: "text", text: funcRes.a2a.result });
      } else {
        // Enforce standard object output architecture so subsequent file evaluation map skips over this payload properly.
        const errMsg = `Error: Name: ${name}, Task: ${task}, Unhandled Result Type: ${JSON.stringify(res)}`;
        console.error(`${phase5Tag} ${errMsg}`);
        results.push({
          type: "text",
          text: errMsg,
        });
      }
      tempHistory = gg.history;
    }

    // [Phase 6: Data Materialization]
    const phase6Tag = "[Phase 6: Data Materialization]";
    console.log(
      `${phase6Tag} Isolating textual structural outcomes and physical blobs.`,
    );
    let finalResults = results.map((o) => {
      const type = o.type;
      if (type === "text") {
        this.addLog_(
          new Date(),
          phase6Tag,
          null,
          `${this.contextType} internal`,
          "Result materialized as pure text.",
        );
        return o[type] || o.text;
      }

      this.addLog_(
        new Date(),
        phase6Tag,
        null,
        `${this.contextType} internal`,
        "Result materialized as binary file content.",
      );
      const data = o[type];
      let fileBlob;
      if (data?.bytes) {
        fileBlob = Utilities.newBlob(
          Utilities.base64Decode(data.bytes),
          data.mimeType,
          data.name,
        );
      }

      if (fileBlob) {
        if (fileAsBlob) {
          return fileBlob;
        } else {
          let fileUrl = "";
          if (data.bytes) {
            const file = DriveApp.createFile(fileBlob);
            fileUrl = file.getUrl();
          }
          return `The file was created as an answer. The file URL is "${fileUrl}".`;
        }
      }
      return `The type of file was returned. But, the file content was not included in the response.`;
    });

    forDebug && toLog_("finalResults1", JSON.stringify(finalResults));

    // [Phase 7: Final Synthesis]
    const phase7Tag = "[Phase 7: Final Synthesis]";
    console.log(`${phase7Tag} Synthesizing final aggregate outputs.`);
    const strResults = finalResults.filter((e) => typeof e === "string");
    if (strResults.length > 0) {
      if (strResults.length === 1 && finalResults.length === 1) {
        // Optimization: Skip unnecessary summarization if only one string outcome exists
        this.addLog_(
          new Date(),
          phase7Tag,
          null,
          `${this.contextType} internal`,
          "Bypassing extra synthesis step due to singular text outcome.",
        );
      } else {
        this.addLog_(
          new Date(),
          phase7Tag,
          null,
          `${this.contextType} internal`,
          "Aggregating multiple textual blocks via LLM abstraction.",
        );
        const gg = new GeminiWithFiles({
          apiKey,
          model: this.model,
          history: tempHistory,
          modelRouting: this.modelRouting,
          routingRole: "a2a_synthesizer",
          routingPrompt: prompt,
          remainingMs: this.remainingMs,
          forceMaxCapability: this.forceMaxCapability,
          onRoutingLog: this.onRoutingLog,
        });
        if (this.hookManager) gg.setHookManager(this.hookManager);
        const res3 = gg.generateContent({
          parts: [
            { text: `Summarize answers by considering the question.` },
            { text: `<Question>${prompt}</Question>` },
            { text: `<Answers>${strResults.join("\n")}</Answers>` },
          ],
        });
        finalResults = [
          res3,
          ...finalResults.filter((e) => typeof e !== "string"),
        ];
      }
    } else {
      this.addLog_(
        new Date(),
        phase7Tag,
        null,
        `${this.contextType} internal`,
        "No string components required synthesis.",
      );
    }

    this.addLog_(
      new Date(),
      phase7Tag,
      null,
      `${this.contextType} internal`,
      `Finalized payload synthesis completed: ${JSON.stringify(finalResults).substring(0, 1000)}`,
    );

    console.log(`${phase7Tag} Completed.`);
    forDebug && toLog_("finalResults2", JSON.stringify(finalResults));

    // [Refactoring: Clean History Construction]
    // Eliminate massive internal intermediate LLM reasoning steps (functionCall, thoughtSignature, etc.) from the propagated history.
    this.addLog_(
      new Date(),
      phase7Tag,
      null,
      `${this.contextType} internal`,
      "Constructing clean history to prevent token bloat.",
    );

    const historyAnswerText = finalResults
      .map((e) => (typeof e === "string" ? e : "[Binary Data]"))
      .join("\n");

    const cleanHistory = [...history];
    if (prompt) {
      cleanHistory.push({ role: "user", parts: [{ text: prompt }] });
    }
    if (historyAnswerText) {
      cleanHistory.push({
        role: "model",
        parts: [{ text: historyAnswerText }],
      });
    }

    return { result: finalResults, history: cleanHistory, agentCards };
  }

  /**
   * Helper: Parse URL query parameters recursively dynamically.
   * @private
   */
  parseQueryParameters_(url) {
    if (typeof url !== "string") {
      throw new Error(
        "Please provide a valid URL (String) including query parameters.",
      );
    }
    const qIdx = url.indexOf("?");
    if (qIdx === -1) {
      return { url, queryParameters: null };
    }
    const baseUrl = url.slice(0, qIdx);
    const query = url.slice(qIdx + 1);
    if (!query) {
      return { url: baseUrl, queryParameters: null };
    }
    const safeDecode = (s) => {
      try {
        return decodeURIComponent(s);
      } catch (e) {
        return s;
      }
    };
    const queryParameters = query.split("&").reduce((acc, param) => {
      if (!param) return acc;
      const eqIdx = param.indexOf("=");
      const keyRaw = eqIdx === -1 ? param : param.slice(0, eqIdx);
      const valRaw = eqIdx === -1 ? "" : param.slice(eqIdx + 1);
      const k = safeDecode(keyRaw.trim());
      if (!k) return acc;
      const v = safeDecode(valRaw.trim());
      if (acc[k]) {
        acc[k].push(v);
      } else {
        acc[k] = [v];
      }
      return acc;
    }, {});
    return {
      url: baseUrl,
      queryParameters:
        Object.keys(queryParameters).length > 0 ? queryParameters : null,
    };
  }

  /**
   * Helper: Map JSON definitions as parameter endpoints uniformly.
   * @private
   */
  addQueryParameters_(url, obj) {
    if (typeof url !== "string" || typeof obj !== "object" || obj === null) {
      throw new Error(
        "Please provide a valid URL (String) and query parameter object.",
      );
    }
    const entries = Object.entries(obj);
    if (entries.length === 0) return url;

    const queryString = entries
      .flatMap(([k, v]) =>
        Array.isArray(v)
          ? v.map((e) => `${encodeURIComponent(k)}=${encodeURIComponent(e)}`)
          : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
      )
      .join("&");

    return url.includes("?")
      ? `${url}&${queryString}`
      : `${url}?${queryString}`;
  }

  setHookManager(hookManager) {
    this.hookManager = hookManager;
    return this;
  }

  dispatchDirectRPC_(object) {
    if (this.hookManager) {
      const beforeToolRes = this.hookManager.execute("BeforeTool", {
        toolName: (object && object.method) || "remote_call",
        arguments: (object && object.params) || {},
        source: "a2a_client"
      });

      if (beforeToolRes.decision === "deny") {
        return {
          result: `[Hook Blocked] Tool execution denied by BeforeTool hook. Reason: ${beforeToolRes.reason || "Unspecified"}`
        };
      }
    }

    let res = this.dispatchDirectRPCInternal_(object);

    if (this.hookManager) {
      const afterToolRes = this.hookManager.execute("AfterTool", {
        toolName: (object && object.method) || "remote_call",
        result: (res && res.result) || res,
        source: "a2a_client"
      });
      if (afterToolRes.result !== undefined) {
        res = { result: afterToolRes.result };
      }
    }

    return res;
  }
};


/**
 * Class object for MCP (Model Context Protocol).
 * Author: Kanshi Tanaike
 * Refactored by: Senior Generative AI & MCP Expert
 * Version: 2.5.0 (Gemini Decisions API Dynamic Model & Thinking Routing)
 * Date: 2026-11-27
 * GitHub: https://github.com/tanaikech/MCPApp
 * @class
 */
var MCPApp = class MCPApp {
  /**
   * @param {Object} object - Object used to initialize this script.
   * @param {string} [object.accessKey=null] - Default is null. Used for accessing the Web Apps.
   * @param {boolean}[object.log=false] - Default is false. When true, the log between the MCP client and server is stored in Google Sheets.
   * @param {string} [object.spreadsheetId] - Spreadsheet ID. Logs are stored in the "MCP" sheet of this spreadsheet if provided, otherwise "log" sheet.
   * @param {boolean} [object.lock=true] - Default is true. By default, the script runs with LockService to prevent concurrency issues.
   * @param {string|Object} [object.modelRouting="efficient"] - Dynamic Decisions API model routing ("efficient" | "quality" | "fixed" | config object).
   * @return {MCPApp}
   */
  constructor(object = {}) {
    const {
      accessKey = null,
      log = false,
      spreadsheetId = null,
      lock = true,
      model,
      modelRouting,
      remainingMs = null,
      forceMaxCapability = false,
      onRoutingLog = null,
    } = object;

    /** @private */
    this.model = model || "models/gemini-4-hydrogen";

    /** @private */
    this.modelRouting = modelRouting !== undefined ? modelRouting : "efficient";
    this.remainingMs = remainingMs;
    this.forceMaxCapability = Boolean(forceMaxCapability);
    this.onRoutingLog = typeof onRoutingLog === "function" ? onRoutingLog : null;

    /** @private */
    this.accessKey = accessKey;

    /**
     * Standard JSON-RPC error codes.
     * @see https://modelcontextprotocol.io/docs/concepts/architecture#error-handling
     * @private
     */
    this.ErrorCode = {
      ParseError: -32700,
      InvalidRequest: -32600,
      MethodNotFound: -32601,
      InvalidParams: -32602,
      InternalError: -32603,
    };

    /** @private */
    this.protocolVersion = "2024-11-05";

    /** @private */
    this.jsonrpc = "2.0";

    /** @private */
    this.date = new Date();

    /** @private */
    this.timezone = Session.getScriptTimeZone();

    /** @private */
    this.log = log;

    if (this.log) {
      const ss = spreadsheetId
        ? SpreadsheetApp.openById(spreadsheetId)
        : SpreadsheetApp.create("Log_MCPApp");
      const targetSheetName = spreadsheetId ? "MCP" : "log";
      const headers = ["Date", "Method", "ID", "Direction", "Message"];

      /** @private */
      this.sheet = this._getOrCreateSheet(ss, targetSheetName, headers);
    }

    /** @private */
    this.values = [];

    /** @private */
    this.useLock = lock;

    this.lock = LockService.getScriptLock();

    /** @private */
    this.clientObject = {};
  }

  /**
   * ### Description
   * Thread-safe helper to retrieve or create a log sheet with custom headers under concurrent lock.
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The Google Spreadsheet instance.
   * @param {string} name - The target sheet name.
   * @param {string[]} [headers] - Optional headers for a newly created sheet.
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   * @private
   */
  _getOrCreateSheet(ss, name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      const lock = LockService.getScriptLock();
      let lockAcquired = false;
      try {
        lockAcquired = lock.tryLock(15000);
        sheet = ss.getSheetByName(name);
        if (!sheet) {
          sheet = ss.insertSheet(name);
          if (headers && headers.length > 0) {
            sheet.appendRow(headers);
            sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
          }
        }
      } catch (e) {
        sheet = ss.getSheetByName(name) || ss.getSheets()[0];
      } finally {
        if (lockAcquired) {
          lock.releaseLock();
        }
      }
    }
    return sheet;
  }

  /**
   * ### Description
   * Sets services dependent on each script environment, such as LockService and PropertiesService.
   * Set these services if utilizing MCPApp as a library.
   *
   * @param {Object} services - Object containing the services you want to use.
   * @param {GoogleAppsScript.Lock.Lock} [services.lock] - Instance of LockService (e.g., getScriptLock()).
   * @param {GoogleAppsScript.Properties.Properties}[services.properties] - Instance of PropertiesService.
   * @return {MCPApp}
   */
  setServices(services = {}) {
    const { lock, properties } = services;
    if (lock && lock.toString() === "Lock") {
      this.lock = lock;
    }
    if (properties && properties.toString() === "Properties") {
      this.properties = properties;
    }
    return this;
  }

  /*****************************************************************************************************
   * SERVER METHODS
   *****************************************************************************************************/

  /**
   * ### Description
   * Main entry method for the MCP server.
   *
   * @param {Object} object - Execution object.
   * @param {Object} object.eventObject - Event object from the doPost function.
   * @param {Object} [object.serverResponse] - Object structured for the server response.
   * @param {Object} [object.functions] - Functions mapped for usage via tools/call.
   * @param {Array}  [object.items] - Items including server responses and functions.
   * @return {GoogleAppsScript.Content.TextOutput}
   */
  server(object = {}) {
    this.errorProcessForServer_(object);

    const obj = this.parseObj_(object.eventObject);
    const lockedMethods = [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "prompts/list",
      "resources/list",
    ];

    if (
      (obj?.method && lockedMethods.includes(obj.method)) ||
      this.useLock === true
    ) {
      return this.lockedMethod_(object);
    }

    try {
      return this.serverMain_(object);
    } catch (error) {
      throw new Error(
        `Server Execution Error: ${error.stack || String(error)}`,
      );
    }
  }

  /**
   * ### Description
   * Core server logic execution.
   *
   * @param {Object} object
   * @return {GoogleAppsScript.Content.TextOutput}
   * @private
   */
  serverMain_(object) {
    const res = this.createResponse_(object);
    if (this.log) {
      this.log_();
    }
    return res;
  }

  /**
   * ### Description
   * Executes the server logic under a lock state to prevent concurrency overlaps.
   *
   * @param {Object} object
   * @return {GoogleAppsScript.Content.TextOutput}
   * @private
   */
  lockedMethod_(object) {
    const lock = this.lock;
    if (!lock.tryLock(350000)) {
      throw new Error("Timeout: Could not acquire lock.");
    }
    try {
      return this.serverMain_(object);
    } catch (error) {
      throw new Error(
        `Locked Execution Error: ${error.stack || String(error)}`,
      );
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * ### Description
   * Validates the initialization parameters for the server.
   *
   * @param {Object} object
   * @return {void}
   * @private
   */
  errorProcessForServer_(object) {
    if (!object.eventObject) {
      throw new Error(
        "Missing 'eventObject'. Please pass the event object from doPost().",
      );
    }
    if (!object.serverResponse && !object.items) {
      throw new Error(
        "Missing 'serverResponse' or 'items'. Please set your server object configurations.",
      );
    }
  }

  /**
   * ### Description
   * Replaces variables mapped in arguments into the target message content.
   *
   * @param {Array} messages - Message array to modify.
   * @param {Object} args - Arguments dictionary containing keys and replacement values.
   * @private
   */
  replaceTemplateVariables_(messages, args) {
    if (!messages || !args) return;
    Object.entries(args).forEach(([key, value]) => {
      messages.forEach((msg) => {
        if (msg.content?.text) {
          msg.content.text = msg.content.text.replaceAll(
            `{{${key}}}`,
            String(value),
          );
        }
      });
    });
  }

  /**
   * ### Description
   * Handles batch processing of individual JSON-RPC calls.
   *
   * @param {Object} object
   * @return {Object|null}
   * @private
   */
  batchProcess_(object) {
    const { obj, serverResponse, functions } = object;
    if (!obj || !("method" in obj)) return null;

    const method = obj.method.toLowerCase();
    const id = obj.id ?? "No ID";
    this.values.push([
      this.date,
      method,
      id,
      "client --> server",
      JSON.stringify(obj),
    ]);

    let retObj;

    // Handle standard server responses
    if (serverResponse && method in serverResponse) {
      if (serverResponse[method].result) {
        try {
          retObj = serverResponse[method];
          this.replaceTemplateVariables_(
            retObj.result?.messages,
            obj.params?.arguments,
          );
        } catch (error) {
          retObj = {
            error: {
              code: this.ErrorCode.InternalError,
              message: `[MCP Server Error] ${error.stack || String(error)}`,
            },
            jsonrpc: this.jsonrpc,
          };
        }
        retObj.id = id;
        this.values.push([
          this.date,
          method,
          id,
          "server --> client",
          JSON.stringify(retObj),
        ]);
        return retObj;
      }

      // Handle named prompt execution
      const resName = obj.params?.name;
      if (resName && serverResponse[method][resName]) {
        retObj = serverResponse[method][resName];
        retObj.id = id;
        this.replaceTemplateVariables_(
          retObj.result?.messages,
          obj.params?.arguments,
        );
      } else {
        retObj = {
          error: {
            code: this.ErrorCode.InvalidParams,
            message: `[MCP Server Error] No prompt found with name "${resName}".`,
          },
          jsonrpc: this.jsonrpc,
          id,
        };
      }

      this.values.push([
        this.date,
        method,
        id,
        "server --> client",
        JSON.stringify(retObj),
      ]);
      return retObj;
    }

    // Handle function executions via Tools
    if (functions && method in functions) {
      const funcGroup = functions[method];
      try {
        const paramName = obj.params?.name;
        const paramUri = obj.params?.uri;

        if (paramName && funcGroup[paramName]) {
          retObj = funcGroup[paramName](obj.params?.arguments || null);

          // --- Smart response wrapper ---
          if (typeof retObj === "string") {
            retObj = {
              jsonrpc: this.jsonrpc,
              result: {
                content: [{ type: "text", text: retObj }],
                isError: false,
              },
            };
          } else if (
            retObj?.result &&
            typeof retObj.result === "string" &&
            Object.keys(retObj).length === 1
          ) {
            retObj = {
              jsonrpc: this.jsonrpc,
              result: {
                content: [{ type: "text", text: retObj.result }],
                isError: false,
              },
            };
          } else if (retObj?.mcp) {
            retObj = retObj.mcp;
          } else if (retObj && !retObj.jsonrpc && !retObj.error) {
            retObj = { jsonrpc: this.jsonrpc, result: retObj };
          }
        } else if (paramUri && funcGroup[paramUri]) {
          retObj = funcGroup[paramUri]();
        } else {
          retObj = {
            error: {
              code: this.ErrorCode.MethodNotFound,
              message: `[MCP Server Error] Method or Function "${method}" could not be executed.`,
            },
            jsonrpc: this.jsonrpc,
          };
        }
      } catch (error) {
        retObj = {
          error: {
            code: this.ErrorCode.InternalError,
            message: `[MCP Server Error] ${error.stack || String(error)}`,
          },
          jsonrpc: this.jsonrpc,
        };
      }

      retObj.id = id;
      this.values.push([
        this.date,
        method,
        id,
        "server --> client",
        JSON.stringify(retObj),
      ]);
      return retObj;
    }

    // Fallback if no processor found
    this.values.push([
      this.date,
      method,
      id,
      "server --> client",
      `No return value mapped for ID ${id}.`,
    ]);
    return null;
  }

  /**
   * ### Description
   * Helper to evaluate and return the larger JSON object string, preventing overwrites of expanded data.
   *
   * @param {Object} currentObj
   * @param {Object} newObj
   * @return {Object}
   * @private
   */
  updateResultIfLarger_(currentObj, newObj) {
    if (!currentObj) return newObj;
    return JSON.stringify(currentObj).length < JSON.stringify(newObj).length
      ? newObj
      : currentObj;
  }

  /**
   * ### Description
   * Constructs the text output response for the MCP client.
   *
   * @param {Object} object
   * @return {GoogleAppsScript.Content.TextOutput|null}
   * @private
   */
  createResponse_(object) {
    let {
      eventObject,
      serverResponse = null,
      functions = {},
      items = [],
    } = object;

    // Access Key Validation
    const reqAccessKey = eventObject.parameter?.accessKey;
    if (this.accessKey && reqAccessKey !== this.accessKey) {
      const errMsg = "Invalid accessKey provided.";
      this.values.push([this.date, null, null, "At server", errMsg]);
      const retObj = {
        error: { code: this.ErrorCode.InvalidRequest, message: errMsg },
        jsonrpc: this.jsonrpc,
      };
      return ContentService.createTextOutput(
        JSON.stringify(retObj),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // Dynamic Items Construction
    if (
      items.length > 0 &&
      !serverResponse &&
      Object.keys(functions).length === 0
    ) {
      const lockedTypes = [
        "initialize",
        "prompts/list",
        "prompts/get",
        "resources/list",
      ];
      const duplicateChecked = [];
      const itemSet = new Set();

      // Deduplicate items
      items.forEach((e) => {
        const type = e.type;
        const name = e.value?.name;
        if (!lockedTypes.includes(type) && name && itemSet.has(name)) {
          console.warn(
            `System warning: Item "${name}" is duplicated and will be ignored.`,
          );
        } else {
          if (name) itemSet.add(name);
          duplicateChecked.push(e);
        }
      });

      // Construct maps
      const generated = duplicateChecked.reduce(
        (acc, e) => {
          const type = e.type;
          const rootKey = type.split("/")[0];

          if (!lockedTypes.includes(type) && acc.serverResponse[type]) {
            acc.serverResponse[type].result[rootKey].push(e.value);
          } else {
            let tempObj = {};
            if (type === "initialize" || type === "resources/list") {
              const existingRes = acc.serverResponse[type]?.result;
              tempObj = {
                jsonrpc: this.jsonrpc,
                result: this.updateResultIfLarger_(existingRes, e.value),
              };
            } else if (type === "prompts/list") {
              let resultObj = acc.serverResponse[type]?.result || {
                prompts: [],
              };
              if (e.value.prompts && Array.isArray(e.value.prompts)) {
                resultObj.prompts.push(...e.value.prompts);
                resultObj.prompts.sort((a, b) => (a.name > b.name ? 1 : -1));
              }
              tempObj = { jsonrpc: this.jsonrpc, result: resultObj };
            } else if (type === "prompts/get") {
              if (acc.serverResponse[type]) {
                if (acc.serverResponse[type].result) {
                  const existingRes = acc.serverResponse[type].result;
                  tempObj = {
                    jsonrpc: this.jsonrpc,
                    result: this.updateResultIfLarger_(existingRes, e.value),
                  };
                } else {
                  Object.entries(e.value).forEach(([k, v]) => {
                    acc.serverResponse[type][k] = {
                      jsonrpc: this.jsonrpc,
                      result: v,
                    };
                  });
                  tempObj = acc.serverResponse[type];
                }
              } else {
                if (e.value.messages) {
                  tempObj = { jsonrpc: this.jsonrpc, result: e.value };
                } else {
                  Object.entries(e.value).forEach(([k, v]) => {
                    tempObj[k] = { jsonrpc: this.jsonrpc, result: v };
                  });
                }
              }
            } else {
              tempObj = {
                jsonrpc: this.jsonrpc,
                result: { [rootKey]: [e.value] },
              };
            }
            acc.serverResponse[type] = tempObj;
          }

          // Functions injection
          if ("function" in e) {
            const callKey = `${rootKey}/call`;
            acc.functions[callKey] = acc.functions[callKey] || {};

            // Safely extract function name
            const funcName = e.value?.name || e.function?.name;
            if (funcName) {
              acc.functions[callKey][funcName] = e.function;
            } else {
              console.warn(
                `System warning: Function name could not be resolved for type ${type}.`,
              );
            }
          }
          return acc;
        },
        { serverResponse: {}, functions: {} },
      );

      serverResponse = generated.serverResponse;
      functions = generated.functions;
    }

    // Evaluate parsed request bodies
    const reqObj = this.parseObj_(eventObject);
    let finalResponse = null;

    if (Array.isArray(reqObj)) {
      finalResponse = reqObj
        .map((o) => this.batchProcess_({ obj: o, serverResponse, functions }))
        .filter(Boolean);
      if (finalResponse.length === 0) return null;
    } else {
      finalResponse = this.batchProcess_({
        obj: reqObj,
        serverResponse,
        functions,
      });
    }

    if (finalResponse) {
      const dataStr = JSON.stringify(finalResponse);
      if (Array.isArray(finalResponse)) {
        this.values.push([
          this.date,
          "batch process",
          null,
          "server --> client",
          dataStr,
        ]);
      }
      return ContentService.createTextOutput(dataStr).setMimeType(
        ContentService.MimeType.JSON,
      );
    }

    return null;
  }

  /*****************************************************************************************************
   * CLIENT METHODS
   *****************************************************************************************************/

  /**
   * ### Description
   * Prepares the MCP client environment and internal configuration.
   *
   * @param {Object} object - Configuration parameters.
   * @param {string} object.apiKey - API key for the Gemini API.
   * @param {string} object.prompt - Input prompt targeting the agent.
   * @param {Array<string|Object>} [object.mcpServerUrls=[]] - Valid URLs or custom Header objects targeting MCP servers.
   * @param {boolean}[object.batchProcess=false] - If true, enables high-speed concurrent network requests bypassing JSON-RPC array routing limitations.
   * @param {Object}[object.functions] - Custom client-side tools/functions.
   * @param {Array} [object.history] - Chat history array for continuous conversation.
   * @param {Array} [object.mcpServerObj] - MCP Servers installed directly as libraries.
   * @return {MCPApp}
   */
  client(object = {}) {
    this.errorProcessForClient_(object);
    if (!Array.isArray(object.mcpServerUrls)) {
      object.mcpServerUrls = [];
    }

    this.clientInfo = { name: "MCPApp_client", version: "1.0.0" };
 
    /** @private */
    this.model = object.model || this.model || "models/gemini-4-hydrogen";

    /** @private */
    this.id = 0;

    /** @private */
    this.headers = { authorization: `Bearer ${ScriptApp.getOAuthToken()}` };

    this.prepareClient_(object);
    return this;
  }

  /**
   * ### Description
   * Main execution sequence for communicating with the configured MCP servers and local logic.
   * It analyzes the user prompt using the Gemini model to decide tool ordering and sequential execution.
   *
   * @return {Object} An object containing the final results array and generation history.
   */
  callMCPServers() {
    console.log("--- start: Call MCP servers or functions (client --> server)");

    if (!this.functions?.params_) {
      this.functions = { params_: {} };
    }

    let functionCallings = Object.entries(this.functions.params_).map(
      ([key, val]) => `- Name: "${key}", Details: ${JSON.stringify(val)}`,
    );
    if (functionCallings.length === 0) {
      functionCallings = ["No accessible functions currently available."];
    }

    const serverInfoArr = (this.mcpServerObj || []).reduce((acc, obj) => {
      const serverInfo = obj.initialize?.result?.serverInfo;
      if (serverInfo)
        acc.push(`Name: ${serverInfo.name}, Version: ${serverInfo.version}`);
      return acc;
    }, []);

    const mcpServerDescriptions = [
      "The available connected MCP servers are listed below:",
      ...serverInfoArr,
    ];

    const currentTimestamp = Utilities.formatDate(
      this.date,
      this.timezone,
      "yyyy-MM-dd HH:mm:ss",
    );

    const systemInstructionText = [
      "You are an expert autonomous delegator capable of assigning user requests to appropriate Model Context Protocol (MCP) server functions.",
      "You construct the optimal logical order for processing tasks leveraging available functions.",
      "<Functions>",
      "The functions available are listed below. The JSON schema defining 'Details' reflects standard function-calling schemas.",
      ...functionCallings,
      "</Functions>",
      "<Mission>",
      "- Fully analyze the purpose and utility of the provided functions.",
      "- Comprehend the nuanced requirements within the user's prompt.",
      "- Assign tasks accurately to appropriate functions in sequential execution order.",
      "- If multiple independent actions map to a single function, merge the logic within the prompt configuration for that function.",
      "- If no combination of functions can fulfill the user's prompt, resolve using your intrinsic knowledge.",
      `- Fall back to the "without_function" action exclusively to provide the final conversational response.`,
      `- If a task requires conditional halting verification between execution steps, inject the "check_process" function following that step.`,
      "</Mission>",
      "<Important>",
      "- Never fabricate responses. Output strictly factual resolutions based on functions or core knowledge.",
      "- DO NOT invent or hallucinate function names. Use EXACTLY the names provided in the <Functions> list.",
      "- Ask the user for clarification if the request is irreconcilably vague.",
      "- Do NOT output or suggest executable code (e.g., 'tool_code' blocks). Only provide the requested format.",
      `- Keep each allocated "task" description concise (1-2 sentences). NEVER copy large raw data payloads or file lists from <UserPrompt> into the "task" string.`,
      `- Ensure all allocated tasks are terminal. Do not instruct the model to verify task completion or delivery status.`,
      `- If you require the current datetime context, use: "${currentTimestamp}" operating within timezone ${this.timezone}.`,
      "</Important>",
    ].join("\n");

    const responseSchema = {
      title: "Function Execution Ordering Strategy",
      description:
        "Define the ordered list of functions needed to resolve the task.",
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            description: "Exact name of the selected function.",
            type: "string",
          },
          task: {
            description:
              "The specific sub-task or instruction allocated to this function.",
            type: "string",
          },
        },
      },
    };

    let totalTokenCount = 0;
    let llmCallCount = 0;
    const unwrapTelemetry = (raw) => {
      if (raw && typeof raw === "object" && raw.returnValue !== undefined) {
        totalTokenCount += raw.totalTokenCount || 0;
        llmCallCount += raw.llmCallCount || 1;
        return raw.returnValue;
      }
      llmCallCount += 1;
      return raw;
    };

    const isFixedRouting =
      typeof GeminiDecisionsRouter !== "function" ||
      GeminiDecisionsRouter.normalizeRoutingConfig(this.modelRouting).mode === "fixed";
    const isThinkingLevelModel = /(?:^|\/)gemini-[34](?:[-.]|$)/i.test(
      this.model,
    );
    const lowThinkingGenConfig =
      isFixedRouting && isThinkingLevelModel
        ? { generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } } }
        : {};

    const setupObj = {
      apiKey: this.clientObject.apiKey,
      systemInstruction: {
        parts: [{ text: systemInstructionText }],
      },
      model: this.model,
      responseMimeType: "application/json",
      responseSchema,
      exportTotalTokens: true,
      modelRouting: this.modelRouting,
      routingRole: "mcp_orchestrator",
      routingPrompt: this.clientObject.prompt,
      remainingMs: this.remainingMs,
      forceMaxCapability: this.forceMaxCapability,
      onRoutingLog: this.onRoutingLog,
      ...lowThinkingGenConfig,
    };

    const geminiOrchestrator = new GeminiWithFiles(setupObj);
    const orchestratorPrompt = `User's input prompt:\n<UserPrompt>${this.clientObject.prompt}</UserPrompt>`;
    const executedOrders = unwrapTelemetry(
      geminiOrchestrator.generateContent({
        q: orchestratorPrompt,
      }),
    );

    if (!Array.isArray(executedOrders) || executedOrders.length === 0) {
      const errObj = {
        error: {
          code: this.ErrorCode.InternalError,
          message:
            "[MCP Client Error] Internal planning error. The model returned no execution strategy.",
        },
        jsonrpc: this.jsonrpc,
        id: this.id,
      };
      this.values.push([
        this.date,
        null,
        null,
        "Client side",
        JSON.stringify(errObj),
      ]);
      return errObj;
    }

    const orderLog = executedOrders
      .map((e, i) => `${i + 1}: [${e.name}] -> ${e.task}`)
      .join("\n");
    console.log(`Planned Execution Pipeline:\n${orderLog}`);
    console.log("--- start: Sequence Execution.");

    let conversationHistory = this.clientObject.history || [];

    const executionSystemInstruction = [
      "You are an expert executor responsible for completing a SINGLE step within a larger orchestration pipeline.",
      "<Mission>",
      "- Evaluate the required function syntax and current objective.",
      "- Construct appropriate function arguments extrapolating from the specific task instructions.",
      `- You must ONLY focus on the "Current execution objective". Do not attempt to complete the entire user request unless your specific objective tells you to do so.`,
      `- If your specific objective requires generating the final text response to the user, invoke "without_function" exclusively.`,
      `- Once you have generated a response using "without_function", finish the process immediately.`,
      `- If executing "check_process", thoroughly evaluate previous results to determine whether processing should halt or proceed.`,
      "</Mission>",
      "<Important>",
      "- Maintain strict adherence to factual outputs.",
      `- The current operating datetime is "${currentTimestamp}" (Timezone: ${this.timezone}).`,
      "- Readily utilize information from these available server pools:",
      "<MCPServers>",
      ...mcpServerDescriptions,
      "</MCPServers>",
      "</Important>",
    ].join("\n");

    const generationResults = [];

    for (const step of executedOrders) {
      const { name, task } = step;
      console.log(`--- Executing function: "${name}" | Objective: "${task}"`);

      const funcCallWrapper = {
        params_: {},
      };

      if (this.functions.params_[name] && typeof this.functions[name] === "function") {
        funcCallWrapper.params_[name] = this.functions.params_[name];
        funcCallWrapper[name] = this.functions[name];
      }

      if (
        name !== "without_function" &&
        this.functions.params_["without_function"]
      ) {
        funcCallWrapper.params_["without_function"] =
          this.functions.params_["without_function"];
        funcCallWrapper["without_function"] =
          this.functions["without_function"];
      }

      // Only expose check_process when the planned step is explicitly "check_process",
      // preventing models from prematurely halting the pipeline on normal tool steps.
      const allowedTools = Object.keys(funcCallWrapper.params_);

      const executeObj = {
        apiKey: this.clientObject.apiKey,
        model: this.model,
        functions: funcCallWrapper,
        systemInstruction: {
          parts: [{ text: executionSystemInstruction }],
        },
        history: conversationHistory,
        exportTotalTokens: true,
        modelRouting: this.modelRouting,
        routingRole: "mcp_executor",
        routingPrompt: task,
        remainingMs: this.remainingMs,
        forceMaxCapability: this.forceMaxCapability,
        onRoutingLog: this.onRoutingLog,
        ...lowThinkingGenConfig,
        toolConfig: {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: allowedTools,
          },
        },
      };

      const geminiExecutor = new GeminiWithFiles(executeObj);
      const executionPrompt = `Current execution objective:\n<Task>${task}</Task>`;

      // Execute inner sequence. Returns standard text OR intercepts _gemini_halt signals safely.
      const res = unwrapTelemetry(
        geminiExecutor.generateContent({ q: executionPrompt }),
      );

      // Cleaned up, robust Halt Signal evaluation
      if (res && typeof res === "object" && res._gemini_halt) {
        if (res.handler === "check_process" && res.result?.stopProcess) {
          const compiledMessage = `Process Halted. Task: ${res.task || task}. Reason: ${res.result.reason}`;
          generationResults.push(compiledMessage);
          console.log(compiledMessage);
          break; // Stop sequential pipeline entirely
        } else if (res.handler === "without_function") {
          const compiledMessage =
            typeof res.result === "string"
              ? res.result
              : JSON.stringify(res.result);
          generationResults.push(compiledMessage);
          break; // Stop sequential pipeline entirely
        }
      } else if (res) {
        console.log(
          `Execution Info: Model resolved task to standard conversational text (No further function calls).`,
        );
        const fallbackText =
          typeof res === "string" ? res : res.text || JSON.stringify(res);
        generationResults.push(fallbackText);

        const lastHistoryParts =
          geminiExecutor.history[geminiExecutor.history.length - 1]?.parts || [];
        const targetTextPart = lastHistoryParts.find(
          (p) => p && !p.thought && !p.functionResponse && p.text !== undefined,
        );
        if (targetTextPart) {
          targetTextPart.text = fallbackText;
        }
      } else {
        generationResults.push(
          "System warning: Received completely empty response from the executor.",
        );
      }

      conversationHistory = geminiExecutor.history;
    }

    let finalOutputs = generationResults.flatMap((output) => {
      if (output?.type === "text") return output.text;
      if (typeof output === "string") return output;
      if (output?.data) {
        const fileBlob = Utilities.newBlob(
          Utilities.base64Decode(output.data),
          output.mimeType || "application/octet-stream",
          "downloaded_file",
        );
        return [
          fileBlob,
          `Attachment payload successfully loaded (MIME type: ${output.mimeType}).`,
        ];
      }
      return [
        "System Warning: Received a file attachment signature, but content payload was missing.",
      ];
    });

    const standardTextResults = finalOutputs.filter(
      (e) => typeof e === "string",
    );

    // Final summarization phase if text results exist (skip if caller opted out on single result)
    if (
      standardTextResults.length > 0 &&
      !(this.clientObject.skipFinalSummary && standardTextResults.length === 1)
    ) {
      const geminiSummarizer = new GeminiWithFiles({
        apiKey: this.clientObject.apiKey,
        model: this.model,
        history: conversationHistory,
        exportTotalTokens: true,
        modelRouting: this.modelRouting,
        routingRole: "mcp_summarizer",
        routingPrompt: this.clientObject.prompt,
        remainingMs: this.remainingMs,
        forceMaxCapability: this.forceMaxCapability,
        onRoutingLog: this.onRoutingLog,
      });
      const finalSummary = unwrapTelemetry(
        geminiSummarizer.generateContent({
          parts: [
            {
              text: "Synthesize the results strictly answering the user's initial prompt.",
            },
            { text: `<Question>${this.clientObject.prompt}</Question>` },
            { text: `<Answers>\n${standardTextResults.join("\n")}\n</Answers>` },
          ],
        }),
      );
      geminiOrchestrator.history = geminiSummarizer.history;
      finalOutputs = [
        finalSummary,
        ...finalOutputs.filter((e) => typeof e !== "string"),
      ];
    }

    this.values.push([
      this.date,
      null,
      null,
      "Client side",
      JSON.stringify(finalOutputs),
    ]);
    console.log("--- end: Sequence Execution completed.");

    return {
      result: finalOutputs,
      history: geminiOrchestrator.history,
      totalTokenCount,
      llmCallCount,
    };
  }

  /**
   * ### Description
   * Validates core properties required for MCP Client execution.
   *
   * @param {Object} object
   * @private
   */
  errorProcessForClient_(object) {
    if (!object.apiKey) {
      throw new Error(
        "Missing requirement: Gemini API Key configuration is necessary.",
      );
    }
    if (!object.prompt) {
      throw new Error(
        "Missing requirement: An operational Prompt string must be provided.",
      );
    }
  }

  /**
   * ### Description
   * Utility to safely merge function parameter dictionaries without overwriting core states.
   *
   * @param {Object} funcDictA
   * @param {Object} funcDictB
   * @return {Object} Merged function object mapping.
   * @private
   */
  mergeFunctions_(funcDictA, funcDictB) {
    const mergedParams = { ...funcDictA.params_, ...funcDictB.params_ };
    const extractFuncs = Object.keys(funcDictB.params_).reduce((acc, k) => {
      acc[k] = funcDictB[k];
      return acc;
    }, {});

    return { ...funcDictA, ...extractFuncs, params_: mergedParams };
  }

  /**
   * ### Description
   * Instantiates fundamental tools and orchestrates them alongside user-configured and server-provided tools.
   *
   * @param {Object} serverProvidedFuncs
   * @param {Object} userCustomFuncs
   * @return {Object} Unified toolkit.
   * @private
   */
  getClientFunctions_(serverProvidedFuncs, userCustomFuncs) {
    let baseToolkit = {
      params_: {
        without_function: {
          description:
            "Use this exclusively to provide the final conversational response to the user when other tools cannot resolve the task. Do NOT use this to confirm task completion. Output only the final answer.",
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "Detailed description of the task requirements.",
              },
              response: {
                type: "string",
                description:
                  "The final answer or conversational response to the user.",
              },
            },
            required: ["task", "response"],
          },
        },
        check_process: {
          description:
            "Inspect conversational history logs and decide whether the orchestration must halt prematurely due to errors or achieved states.",
          parameters: {
            type: "object",
            properties: {
              stopProcess: {
                type: "boolean",
                description:
                  "Return True to entirely halt processing, False to proceed to the next operation.",
              },
              task: {
                type: "string",
                description: "The task being evaluated.",
              },
              reason: {
                type: "string",
                description:
                  "The descriptive cause backing the halt or continuation decision.",
              },
            },
            required: ["stopProcess", "task", "reason"],
          },
        },
      },
      // INJECTS: _gemini_halt to force GeminiWithFiles loop break cleanly.
      without_function: ({ task, response }) => {
        console.log(
          `--- Executing intrinsic handler: without_function | Prompt: ${task}`,
        );
        return {
          _gemini_halt: true,
          handler: "without_function",
          task,
          result: response,
        };
      },
      check_process: ({ stopProcess, task, reason }) => {
        console.log(
          `--- Check Process Triggered | Task: ${task} | Halting: ${stopProcess} | Reason: ${reason}`,
        );
        return {
          _gemini_halt: stopProcess,
          handler: "check_process",
          task,
          result: { stopProcess, reason },
        };
      },
    };

    if (
      serverProvidedFuncs?.params_ &&
      Object.keys(serverProvidedFuncs).length > 1
    ) {
      baseToolkit = this.mergeFunctions_(baseToolkit, serverProvidedFuncs);
    }

    if (userCustomFuncs?.params_ && Object.keys(userCustomFuncs).length > 1) {
      baseToolkit = this.mergeFunctions_(baseToolkit, userCustomFuncs);
    }

    return baseToolkit;
  }

  /**
   * ### Description
   * Constructs network requests properly routing standard URLs vs GAS Web Apps with customizable headers.
   *
   * @param {Object} object
   * @param {string} object.u - URL to request.
   * @param {Object|string} object.obj - JSON payload to send.
   * @param {Object} [object.customHeaders={}] - Specific headers bound to the MCP server.
   * @return {Object} Valid configurations for UrlFetchApp.
   * @private
   */
  createRequest_({ u, obj, customHeaders = {} }) {
    const rawUrl = u.trim();
    const { url, queryParameters } = this.parseQueryParameters_(rawUrl);
    const urlSegment = url.split("/").pop();
    const fullUrl = this.addQueryParameters_(url.trim(), queryParameters || {});

    const requestConfig = {
      url: fullUrl,
      payload: obj,
      muteHttpExceptions: true,
      contentType: "application/json",
    };

    let activeHeaders = {};

    // Authenticate if connecting to GAS-deployed executions
    if (["exec", "dev"].includes(urlSegment)) {
      activeHeaders = { ...this.headers };
    }

    // Merge explicitly provided custom server headers
    if (customHeaders && Object.keys(customHeaders).length > 0) {
      activeHeaders = { ...activeHeaders, ...customHeaders };
    }

    // Streamable HTTP MCP compatibility: add default Accept header if not explicitly provided
    const hasAcceptHeader = Object.keys(activeHeaders).some(
      (k) => k.toLowerCase() === "accept",
    );
    if (!hasAcceptHeader) {
      activeHeaders["Accept"] = "application/json, text/event-stream";
    }

    if (Object.keys(activeHeaders).length > 0) {
      requestConfig.headers = activeHeaders;
    }

    return requestConfig;
  }

  /**
   * ### Description
   * Parses a JSON-RPC 2.0 response from either standard `application/json` or
   * Streamable HTTP SSE (`text/event-stream`) payloads.
   *
   * @param {GoogleAppsScript.URL_Fetch.HTTPResponse} response
   * @return {Object|null}
   * @private
   */
  parseJsonRpcResponse_(response) {
    const bodyText = (response.getContentText() || "").trim();
    if (!bodyText) return null;

    try {
      return JSON.parse(bodyText);
    } catch (jsonErr) {
      // Fallback for Streamable HTTP SSE (text/event-stream): extract last valid JSON data frame
      const dataLines = bodyText
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== "[DONE]");

      for (let i = dataLines.length - 1; i >= 0; i--) {
        try {
          return JSON.parse(dataLines[i]);
        } catch (e) {
          // Continue scanning prior SSE frames
        }
      }
      return null;
    }
  }

  /**
   * ### Description
   * Dispatches targeted capability requests to all bound MCP Servers.
   *
   * @param {string} method - Request capability standard method (e.g., resources/list).
   * @return {Object[]} List of crafted Request Objects.
   * @private
   */
  getRequest_(method) {
    this.id++;
    const payloadStr = JSON.stringify({
      method,
      params: {},
      jsonrpc: this.jsonrpc,
      id: this.id,
    });
    return this.mcpServerObj.map(({ serverUrl, headers }) =>
      this.createRequest_({
        u: serverUrl,
        obj: payloadStr,
        customHeaders: headers,
      }),
    );
  }

  /**
   * ### Description
   * Executes network fetches to synchronize capability lists from bound MCP Servers.
   *
   * @param {Object} object
   * @private
   */
  getLists_({ method, requests }) {
    this.fetch_(requests).forEach((response, index) => {
      const code = response.getResponseCode();
      const parsedRes = this.parseJsonRpcResponse_(response);
      if (parsedRes?.result && !parsedRes?.error) {
        if (code !== 200) {
          console.warn(
            `[MCPApp] ${method} returned HTTP ${code} with valid JSON-RPC result; accepting payload.`,
          );
        }
        this.mcpServerObj[index][method] = parsedRes;
        this.fetchRemainingPages_(index, method, parsedRes);
      } else if (code !== 200 && method === "tools/list") {
        console.warn(
          `[MCPApp] ${method} returned HTTP ${code}: ${(response.getContentText() || "").slice(0, 200)}`,
        );
      }
    });
  }

  /**
   * ### Description
   * Follows MCP `nextCursor` pagination for `tools/list`, `resources/list`, and `prompts/list`.
   *
   * @param {number} serverIndex
   * @param {string} method
   * @param {Object} initialParsed
   * @private
   */
  fetchRemainingPages_(serverIndex, method, initialParsed) {
    const subKey = method.split("/")[0];
    let cursor = initialParsed?.result?.nextCursor;
    let pages = 0;
    const maxPages = 10;
    const serverEntry = this.mcpServerObj[serverIndex];
    if (!serverEntry) return;

    while (cursor && pages < maxPages) {
      pages++;
      const payloadStr = JSON.stringify({
        method,
        params: { cursor },
        jsonrpc: this.jsonrpc,
        id: ++this.id,
      });
      const req = this.createRequest_({
        u: serverEntry.serverUrl,
        obj: payloadStr,
        customHeaders: serverEntry.headers,
      });
      const resp = this.fetch_([req])[0];
      if (!resp || resp.getResponseCode() !== 200) break;
      const nextParsed = this.parseJsonRpcResponse_(resp);
      const nextItems = nextParsed?.result?.[subKey];
      if (Array.isArray(nextItems) && nextItems.length > 0) {
        if (!Array.isArray(initialParsed.result[subKey])) {
          initialParsed.result[subKey] = [];
        }
        initialParsed.result[subKey].push(...nextItems);
      }
      cursor = nextParsed?.result?.nextCursor;
    }
  }

  /**
   * ### Description
   * Parses server arrays dynamically using high-speed concurrent processing for execution efficiency.
   * Modified to use independent requests instead of JSON-RPC arrays to ensure stable routing compatibility.
   *
   * @param {Object} object
   * @private
   */
  parseBatchProcess_({ mcpServerUrls, reqs }) {
    const requestPool = [];
    const metadata = [];

    reqs.forEach(({ method, requests }) => {
      requests.forEach((reqConfig, serverIndex) => {
        requestPool.push(reqConfig);
        metadata.push({ method, serverIndex });
      });
    });

    if (requestPool.length > 0) {
      this.fetch_(requestPool).forEach((response, i) => {
        const { method, serverIndex } = metadata[i];
        const code = response.getResponseCode();
        const parsedObj = this.parseJsonRpcResponse_(response);
        if (parsedObj?.result && !parsedObj?.error) {
          if (code !== 200) {
            console.warn(
              `[MCPApp] ${method} returned HTTP ${code} with valid JSON-RPC result; accepting payload.`,
            );
          }
          this.mcpServerObj[serverIndex][method] = parsedObj;
          this.fetchRemainingPages_(serverIndex, method, parsedObj);
        } else if (code !== 200 && method === "tools/list") {
          console.warn(
            `[MCPApp] ${method} returned HTTP ${code}: ${(response.getContentText() || "").slice(0, 200)}`,
          );
        }
      });
    }
  }

  /**
   * ### Description
   * Converts MCP Server resources and tools into dynamically bound JavaScript functions executable by Gemini API.
   * Ensures function contexts correctly align back to the server requests.
   *
   * @private
   */
  createFunctions_() {
    const routingMap = {
      "resources/list": "resources/read",
      "prompts/list": "prompts/get",
      "tools/list": "tools/call",
    };
    const validEndpoints = Object.keys(routingMap);

    const fetchWrapper = ({ payload, serverUrl, customHeaders }) => {
      const responseArray = this.fetch_([
        this.createRequest_({
          u: serverUrl,
          obj: JSON.stringify(payload),
          customHeaders,
        }),
      ]);
      const resp = responseArray[0];
      const statusCode = resp.getResponseCode();
      const rawText = resp.getContentText();
      const parsed = this.parseJsonRpcResponse_(resp);
      if (statusCode < 200 || statusCode >= 300) {
        if (parsed && parsed.result && !parsed.error) {
          console.warn(
            `[MCPApp] Tool call returned HTTP ${statusCode} with valid JSON-RPC result; accepting payload.`,
          );
          return JSON.stringify(parsed);
        }
        throw new Error(`[MCP HTTP ${statusCode}] ${rawText}`);
      }
      return parsed ? JSON.stringify(parsed) : rawText;
    };

    const aggregatedServerTools = this.mcpServerObj.reduce(
      (accumulator, serverEntry) => {
        const { serverUrl, headers } = serverEntry;

        validEndpoints.forEach((endpointKey) => {
          const subKey = endpointKey.split("/")[0];
          const resourceResult =
            serverEntry[endpointKey]?.result ?? serverEntry[endpointKey];
          const toolArray = resourceResult?.[subKey] ?? [];

          toolArray.forEach((definition) => {
            const { name, description, uri, inputSchema } = definition;
            const cleanName = name.replaceAll(" ", "_").trim();
            let toolMetadata = null;
            let executionCallback = null;

            if (subKey === "resources") {
              toolMetadata = { title: name, description };
              executionCallback = () => {
                console.log(`--- Fetching Resource Execution: ${cleanName}`);
                const dispatchPayload = {
                  method: routingMap[endpointKey],
                  params: { uri },
                  jsonrpc: this.jsonrpc,
                  id: ++this.id,
                };
                return fetchWrapper({
                  payload: dispatchPayload,
                  serverUrl,
                  customHeaders: headers,
                });
              };
            } else if (subKey === "prompts") {
              const propMap = (definition.arguments || []).reduce(
                (mapAcc, argObj) => {
                  mapAcc[argObj.name.replaceAll(" ", "_").trim()] = {
                    type: "string",
                    description: argObj.description,
                  };
                  return mapAcc;
                },
                {},
              );

              toolMetadata = {
                title: name,
                description,
                parameters: {
                  type: "object",
                  properties: propMap,
                  required: Object.keys(propMap),
                },
              };
              executionCallback = (params) => {
                console.log(`--- Generating Prompt Logic: ${cleanName}`);
                const dispatchPayload = {
                  method: routingMap[endpointKey],
                  params: {
                    name: name,
                    arguments:
                      params && typeof params === "object" ? params : {},
                  },
                  jsonrpc: this.jsonrpc,
                  id: ++this.id,
                };
                return fetchWrapper({
                  payload: dispatchPayload,
                  serverUrl,
                  customHeaders: headers,
                });
              };
            } else if (subKey === "tools") {
              toolMetadata = {
                title: name,
                description,
                parameters: inputSchema,
                ...(definition.annotations
                  ? { annotations: definition.annotations }
                  : {}),
              };
              executionCallback = (params) => {
                if (this.hookManager) {
                  const beforeRes = this.hookManager.execute("BeforeTool", {
                    toolName: cleanName,
                    arguments: params,
                    source: "mcp_server"
                  });
                  if (beforeRes.decision === "deny") {
                    throw new Error(`[Hook Blocked] Server tool '${cleanName}' execution denied by BeforeTool hook. Reason: ${beforeRes.reason || "Unspecified"}`);
                  }
                  if (beforeRes.tool_input?.execution_prompt !== undefined) {
                    params = beforeRes.tool_input.execution_prompt;
                  } else if (beforeRes.arguments !== undefined) {
                    params = beforeRes.arguments;
                  }
                }

                console.log(`--- Activating Tool Service: ${cleanName}`);
                const dispatchPayload = {
                  method: routingMap[endpointKey],
                  params: {
                    name: name,
                    arguments:
                      params && typeof params === "object" ? params : {},
                  },
                  jsonrpc: this.jsonrpc,
                  id: ++this.id,
                };
                let result = fetchWrapper({
                  payload: dispatchPayload,
                  serverUrl,
                  customHeaders: headers,
                });

                if (this.hookManager) {
                  const afterRes = this.hookManager.execute("AfterTool", {
                    toolName: cleanName,
                    result: result,
                    source: "mcp_server"
                  });
                  if (afterRes.result !== undefined) {
                    result = afterRes.result;
                  }
                }

                return result;
              };
            }

            if (toolMetadata && executionCallback) {
              accumulator.params_[cleanName] = {
                title: name,
                description,
                ...toolMetadata,
              };
              accumulator[cleanName] = executionCallback;
            }
          });
        });
        return accumulator;
      },
      { params_: {} },
    );

    let finalUserTools = null;
    if (
      this.clientObject.functions?.params_ &&
      Object.keys(this.clientObject.functions).length > 1
    ) {
      finalUserTools = { ...this.clientObject.functions };
    }

    const integratedToolkit = this.getClientFunctions_(
      aggregatedServerTools,
      finalUserTools,
    );

    if (integratedToolkit.params_) {
      console.log(
        `Capabilities mapped: ${Object.keys(integratedToolkit.params_).length} distinct operations loaded.`,
      );
    }

    /** @private */
    this.functions = integratedToolkit;
  }

  /**
   * ### Description
   * Initiates the protocol handshakes for server discovery, caching supported models, tools, and capabilities.
   *
   * @param {Object} object
   * @return {MCPApp}
   * @private
   */
  prepareClient_(object) {
    this.clientObject = object;
    const {
      mcpServerUrls,
      batchProcess = false,
      mcpServerObj,
      cachedMcpServerObj,
    } = this.clientObject;

    // Fast-path: Reuse already-discovered MCP server metadata (from LlmAgent cache)
    if (Array.isArray(cachedMcpServerObj) && cachedMcpServerObj.length > 0) {
      this.mcpServerObj = cachedMcpServerObj;
      this.createFunctions_();
      return this;
    }

    // Load pre-installed Server Object library boundaries
    if (Array.isArray(mcpServerObj) && mcpServerObj.length > 0) {
      const flatLibTools = mcpServerObj.flat().reduce(
        (acc, entry) => {
          if (entry.type === "tools/list") {
            const schemaKey = entry.value.name;
            acc[schemaKey] = entry.function;
            acc.params_[schemaKey] = {
              name: schemaKey,
              description: entry.value.description,
              parameters: entry.value.inputSchema,
            };
          }
          return acc;
        },
        { params_: {} },
      );

      if (
        this.clientObject.functions?.params_ &&
        Object.keys(this.clientObject.functions).length > 1
      ) {
        this.clientObject.functions = this.mergeFunctions_(
          this.clientObject.functions,
          flatLibTools,
        );
      } else {
        this.clientObject.functions = flatLibTools;
      }
    }

    // Dynamic normalization validating both traditional raw strings and object configurations
    const validServers = (mcpServerUrls || []).reduce((acc, item) => {
      if (typeof item === "string" && item.trim() !== "") {
        acc.push({ serverUrl: item.trim(), headers: {}, original: item });
      } else if (typeof item === "object" && item !== null) {
        const key = Object.keys(item)[0];
        const val = item[key];
        if (val && val.httpUrl) {
          acc.push({
            serverUrl: val.httpUrl.trim(),
            headers: val.headers || {},
            original: item,
          });
        }
      }
      return acc;
    }, []);

    if (validServers.length > 0) {
      // Execute Protocol Initializations
      const methodInit = "initialize";
      console.log(`--- Executing Handshake: ${methodInit} (Client --> Server)`);

      const payloadInit = {
        method: methodInit,
        params: {
          protocolVersion: this.protocolVersion,
          capabilities: {},
          clientInfo: this.clientInfo,
        },
        jsonrpc: this.jsonrpc,
        id: ++this.id,
      };

      const requestsInit = validServers.map((n) =>
        this.createRequest_({
          u: n.serverUrl,
          obj: JSON.stringify(payloadInit),
          customHeaders: n.headers,
        }),
      );

      this.mcpServerObj = this.fetch_(requestsInit).reduce(
        (acc, response, idx) => {
          if (response.getResponseCode() === 200) {
            const bodyText = response.getContentText();
            this.values.push([
              this.date,
              methodInit,
              this.id,
              "server --> client",
              bodyText,
            ]);
            const parsedInit = this.parseJsonRpcResponse_(response);
            const serverHeaders = { ...validServers[idx].headers };
            const respHeaders =
              typeof response.getAllHeaders === "function"
                ? response.getAllHeaders() || {}
                : {};
            const sessionKey = Object.keys(respHeaders).find(
              (k) => k.toLowerCase() === "mcp-session-id",
            );
            if (sessionKey && respHeaders[sessionKey]) {
              const rawSess = respHeaders[sessionKey];
              serverHeaders["Mcp-Session-Id"] = Array.isArray(rawSess)
                ? rawSess[0]
                : rawSess;
            }
            const negotiatedVersion = parsedInit?.result?.protocolVersion;
            if (negotiatedVersion && String(negotiatedVersion) >= "2025-06-18") {
              serverHeaders["MCP-Protocol-Version"] = negotiatedVersion;
            }
            if (parsedInit) {
              acc.push({
                serverUrl: validServers[idx].serverUrl,
                headers: serverHeaders,
                original: validServers[idx].original,
                [methodInit]: parsedInit,
              });
            } else {
              console.warn(
                `Critical Format Error. Payload from "${validServers[idx].serverUrl}" is not standard MCP JSON. Snippet: ${bodyText.substring(0, 50)}...`,
              );
              acc.push({
                serverUrl: validServers[idx].serverUrl,
                headers: serverHeaders,
                original: validServers[idx].original,
                [methodInit]: null,
              });
            }
          }
          return acc;
        },
        [],
      );

      // Commit Connection Registrations
      const methodNotifyInit = "notifications/initialized";
      const methodNotifyCancel = "notifications/cancelled";
      console.log(
        `--- Confirming Connections: ${methodNotifyInit} / ${methodNotifyCancel}`,
      );

      const payloadNotifyInit = {
        method: methodNotifyInit,
        jsonrpc: this.jsonrpc,
      };
      const payloadNotifyCancel = {
        method: methodNotifyCancel,
        params: {
          requestId: this.id,
          reason: `Halted: Integration failure. InternalError code ${this.ErrorCode.InternalError}`,
        },
        jsonrpc: this.jsonrpc,
      };

      const categorizedReqs = this.mcpServerObj.reduce(
        (acc, serverObj) => {
          const payloadStr = JSON.stringify(
            serverObj[methodInit] ? payloadNotifyInit : payloadNotifyCancel,
          );
          const configTarget = serverObj[methodInit]
            ? acc.notifiedReqs
            : acc.canceledReqs;
          configTarget.push(
            this.createRequest_({
              u: serverObj.serverUrl,
              obj: payloadStr,
              customHeaders: serverObj.headers,
            }),
          );
          return acc;
        },
        { notifiedReqs: [], canceledReqs: [] },
      );

      if (categorizedReqs.notifiedReqs.length === 0) {
        this.values.push([
          this.date,
          methodNotifyInit,
          this.id,
          "At client",
          "Fatal: No servers responded to initialized capability.",
        ]);
        return this;
      }

      if (categorizedReqs.canceledReqs.length > 0) {
        const cancelledLogs = this.fetch_(categorizedReqs.canceledReqs).map(
          (res) => res.getContentText(),
        );
        console.log(`Connection Removals Triggered:`, cancelledLogs);
      }

      this.fetch_(categorizedReqs.notifiedReqs);

      // Mapping Server Tool Capabilities
      const resourceMethods = ["resources/list", "prompts/list", "tools/list"];
      const capabilityJobs = resourceMethods.map((m) => ({
        method: m,
        requests: this.getRequest_(m),
      }));

      if (batchProcess) {
        console.log(
          "--- Extracting Tool Lists (Concurrent Transmission Protocol)",
        );
        this.parseBatchProcess_({ mcpServerUrls, reqs: capabilityJobs });
      } else {
        console.log("--- Extracting Tool Lists (Linear Transmission Protocol)");
        capabilityJobs.forEach((job) => this.getLists_(job));
      }

      this.createFunctions_();
    } else {
      console.log("--- Status Warning: No remote MCP Server URLs assigned.");
      this.values.push([
        this.date,
        null,
        null,
        "At client",
        "No MCP Server URLs provided.",
      ]);

      let manualFunctions = null;
      if (
        this.clientObject.functions?.params_ &&
        Object.keys(this.clientObject.functions).length > 1
      ) {
        manualFunctions = { ...this.clientObject.functions };
      }

      const localToolkit = this.getClientFunctions_(null, manualFunctions);
      if (localToolkit.params_) {
        console.log(
          `Locally executing capabilities. Distinct operations mapped: ${Object.keys(localToolkit.params_).length}`,
        );
      }

      /** @private */
      this.functions = localToolkit;
    }

    return this;
  }

  /*****************************************************************************************************
   * TOOLS & UTILITIES
   *****************************************************************************************************/

  /**
   * ### Description
   * Exposes configured and dynamically imported tools configured in the agent network.
   *
   * @return {Object} Dictionary mappings containing tool executors.
   */
  get getFunctions() {
    return this.functions;
  }

  /**
   * ### Description
   * Bulk execution framework wrapping GAS UrlFetchApp mechanism.
   *
   * @param {Object[]} requests - UrlFetchApp payload configuration objects.
   * @return {GoogleAppsScript.URL_Fetch.HTTPResponse[]}
   * @private
   */
  fetch_(requests) {
    return UrlFetchApp.fetchAll(requests);
  }

  /**
   * ### Description
   * Extrapolates request mapping content correctly, accounting for raw text parsing.
   *
   * @param {Object} e - DoPost Google Event payload.
   * @return {Object|null}
   * @private
   */
  parseObj_(e) {
    if (e?.postData?.contents) {
      return JSON.parse(e.postData.contents);
    }
    return null;
  }

  /**
   * ### Description
   * Analyzes an endpoint path returning distinct query object separations.
   *
   * @param {string} url - Valid string path.
   * @return {Object|null}
   * @private
   */
  parseQueryParameters_(url) {
    if (typeof url !== "string") {
      throw new Error(
        "Invalid format. Provided URL definition must be a string format.",
      );
    }

    const qIdx = url.indexOf("?");
    if (qIdx === -1) return { url, queryParameters: null };

    const baseUrl = url.slice(0, qIdx);
    const query = url.slice(qIdx + 1);
    if (!query) return { url: baseUrl, queryParameters: null };

    const safeDecode = (s) => {
      try {
        return decodeURIComponent(s);
      } catch (e) {
        return s;
      }
    };

    const queryParameters = query.split("&").reduce((acc, paramBlock) => {
      if (!paramBlock) return acc;
      const eqIdx = paramBlock.indexOf("=");
      const keyRaw = eqIdx === -1 ? paramBlock : paramBlock.slice(0, eqIdx);
      const valRaw = eqIdx === -1 ? "" : paramBlock.slice(eqIdx + 1);
      const key = safeDecode(keyRaw.trim());
      if (!key) return acc;
      const valueStr = safeDecode(valRaw.trim());

      if (acc[key]) acc[key].push(valueStr);
      else acc[key] = [valueStr];

      return acc;
    }, {});

    return {
      url: baseUrl,
      queryParameters:
        Object.keys(queryParameters).length > 0 ? queryParameters : null,
    };
  }

  /**
   * ### Description
   * Applies parameterized attributes sequentially building valid REST URLs.
   *
   * @param {string} url - Unformatted base endpoint.
   * @param {Object} obj - Parameters tree schema.
   * @return {string}
   * @private
   */
  addQueryParameters_(url, obj) {
    if (typeof url !== "string" || !obj) {
      throw new Error(
        "Validation mismatch. Valid string URL and object config must be supplied.",
      );
    }
    const params = Object.entries(obj);
    if (params.length === 0) return url;

    const queryString = params
      .flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map(
              (entry) =>
                `${encodeURIComponent(key)}=${encodeURIComponent(entry)}`,
            )
          : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join("&");

    return `${url}${url.includes("?") ? "&" : "?"}${queryString}`;
  }

  /**
   * ### Description
   * Transmits generated diagnostic arrays effectively truncating data to enforce GAS row integrity limits (Max 50k chars).
   *
   * @return {void}
   * @private
   */
  log_() {
    if (!this.sheet || this.values.length === 0) return;
    const sanitizedData = this.values.map((row) =>
      row.map((cell) =>
        typeof cell === "string" ? cell.substring(0, 40000) : cell,
      ),
    );
    this.sheet
      .getRange(
        this.sheet.getLastRow() + 1,
        1,
        sanitizedData.length,
        sanitizedData[0].length,
      )
      .setValues(sanitizedData);
  }

  setHookManager(hookManager) {
    this.hookManager = hookManager;
    return this;
  }
};


/**
 * MCPA2Aserver: Class Object for Consolidating Generative AI Protocols
 * Author: Tanaike
 * v2.4.0 (Gemini Decisions API Dynamic Model & Thinking Routing)
 * GitHub: https://github.com/tanaikech/MCPA2Aserver-GAS-Library
 *
 * Refactored Version with Explicit Override, Integrated Sheet Logging, Directional Traffic Tracking,
 * and Seamless Server-Side Chat History Injection for A2A Protocols.
 *
 * ### Description
 * This class provides a consolidated server solution for Model Context Protocol (MCP) and Agent-to-Agent (A2A) communication directly within your Google Apps Script project.
 * It strictly tracks the flow of data: Client -> Server, Internal processing, and Server -> Client, ensuring high observability.
 *
 * ### Detailed Usage Instructions
 *
 * #### 1. Initialization
 * Instantiate the class and inject the `LockService` from your Google Apps Script environment.
 * ```javascript
 * const mcpA2A = new MCPA2Aserver();
 * mcpA2A.setServices({ lock: LockService.getScriptLock() });
 * ```
 *
 * #### 2. Configuration & History Injection
 * Configure your server credentials. You can now inject a "Base History" (e.g., System Persona or absolute facts)
 * that the remote A2A server will always prepend to the incoming client history.
 * ```javascript
 * mcpA2A.apiKey = "YOUR_GEMINI_API_KEY";
 * mcpA2A.model = "models/gemini-3.1-flash-lite";
 * mcpA2A.setHistory([
 *   { role: "user", parts: [{ text: "System Context: You are a financial expert." }] },
 *   { role: "model", parts: [{ text: "Understood. I will act as a financial expert." }] }
 * ]);
 * ```
 *
 * #### 3. Context Definition & Tool Routing
 * Create a `context` object containing `functions` (tool logic & schema) and `agentCard` (agent metadata for A2A).
 * The server intelligently routes tools based on the `type` property defined within `functions.params_[tool_name].type`:
 * - `type: "mcp"` (or "MCP"): The tool is exclusively bundled into the MCP Server payload.
 * - `type: "a2a"` (or "A2A"): The tool is exclusively bundled into the A2A Server payload.
 * - `type: undefined`: The tool is registered to BOTH servers automatically.
 *
 * #### 4. Manual Server Overrides (Optional)
 * You can bypass auto-detection and force the server behavior using explicit boolean flags:
 * ```javascript
 * mcpA2A.a2a = true;  // Force A2A server activation
 * mcpA2A.mcp = false; // Force MCP server deactivation
 * ```
 *
 * #### 5. Execution
 * Execute the main dispatcher within your `doGet` or `doPost` functions.
 * ```javascript
 * const response = mcpA2A.main(e, context, logCallback);
 * return response;
 * ```
 * */
var MCPA2Aserver = class MCPA2Aserver {
  /**
   * Initializes the MCPA2Aserver properties.
   */
  constructor() {
    /** @type {String} API key for using Gemini API. */
    this.apiKey = "";

    /** @type {String} Model version to be used for generative AI. */
    this.model = "models/gemini-4-hydrogen";

    /** @type {String|Object} Dynamic Decisions API routing ("efficient" | "quality" | "fixed" | config object). */
    this.modelRouting = "efficient";

    /** @type {Boolean} Security boundary: opt-in to trust client A2A params.metadata.gasadkRouting hints (default false). */
    this.allowClientRoutingHints = false;

    /** @type {String} Access key to restrict access to the Web Apps. */
    this.accessKey = "";

    /** @type {String} Google Sheets ID used for storing logs. */
    this.logSpreadsheetId = "";

    /** @type {Boolean} If true, tools from ToolsForMCPServer library are integrated automatically. */
    this.useToolsForMCPServer = false;

    /** @type {String} The URL of the deployed Web App. */
    this.webAppsUrl = "";

    /** @type {Boolean|null} Explicitly enable/disable MCP Server routing. Null implies auto-detection. */
    this.mcp = null;

    /** @type {Boolean|null} Explicitly enable/disable A2A Server routing. Null implies auto-detection. */
    this.a2a = null;

    /** @type {GoogleAppsScript.Lock.Lock|null} LockService instance injected from the executing environment. */
    this.lock = null;

    /** @type {Array<Object>} Base history array for A2A context injection. */
    this.history = [];

    /** @private @type {Array<Object>} Internal log storage */
    this.logs = [];

    /** @private @type {Function|null} Real-time logging callback */
    this.logCallback = null;

    /** @private @type {String} Unique execution identifier */
    this.execId = "";

    /** @private */
    this.CONFIG = {
      API_KEY: this.apiKey,
      MODEL: this.model,
      WELL_KNOWN_PATHS: [
        ".well-known/agent-card.json",
        ".well-known/agent.json",
      ],
      METHODS: {
        A2A: ["tasks/send", "message/send", "SendMessage", "GetTask"],
        MCP: [
          "initialize",
          "notifications/initialized",
          "notifications/cancelled",
          "ping",
          "resources/list",
          "resources/read",
          "prompts/list",
          "prompts/get",
          "tools/list",
          "tools/call",
        ],
      },
    };
  }

  /**
   * Injects dependencies such as LockService from the calling context.
   *
   * @param {Object} services - Object containing the services.
   * @param {GoogleAppsScript.Lock.Lock} services.lock - The lock instance from the executing client context.
   * @return {MCPA2Aserver}
   */
  setServices(services = {}) {
    const { lock } = services;
    if (lock && lock.toString() === "Lock") {
      this.lock = lock;
    }
    return this;
  }

  /**
   * Sets the base conversation history for the server.
   * This history will be prepended to the client's history during A2A execution.
   *
   * @param {Array<Object>} history - An array of history objects containing 'role' and 'parts'.
   * @returns {MCPA2Aserver} This instance for chaining.
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      throw new Error(
        "CRITICAL: History must be an array of objects compatible with GeminiWithFiles.",
      );
    }
    this.history = history;
    return this;
  }

  /**
   * Retrieves the current base conversation history configured on the server.
   *
   * @returns {Array<Object>} The current base history array.
   */
  getHistory() {
    return this.history;
  }

  /**
   * Thread-safe helper to fetch or create a spreadsheet sheet with strict lock control.
   * Prevents parallel-process insertion failures in high-volume environments.
   *
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The targeted spreadsheet.
   * @param {String} name - Name of the required sheet.
   * @param {Array<String>} [headers] - Optional header array to inject if generating new.
   * @return {GoogleAppsScript.Spreadsheet.Sheet}
   */
  _getOrCreateSheet(ss, name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      const lock = LockService.getScriptLock();
      let lockAcquired = false;
      try {
        lockAcquired = lock.tryLock(15000);
        sheet = ss.getSheetByName(name); // Double check inside the lock boundary
        if (!sheet) {
          sheet = ss.insertSheet(name);
          if (headers && headers.length > 0) {
            sheet.appendRow(headers);
            sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
          }
        }
      } catch (e) {
        // Fallback gracefully in case of race condition or parallel writes
        sheet = ss.getSheetByName(name) || ss.getSheets()[0];
      } finally {
        if (lockAcquired) {
          lock.releaseLock();
        }
      }
    }
    return sheet;
  }

  /**
   * Serializes a generic Apps Script Event Object safely, stripping read-only properties
   * and cyclical references that trigger standard JSON.stringify errors.
   *
   * @private
   * @param {EventObject} e - Event object received from doGet/doPost.
   * @return {String} Serialized representation.
   */
  serializeEvent_(e) {
    if (!e) return "null";
    try {
      const clone = {
        queryString: e.queryString || "",
        parameter: e.parameter || {},
        parameters: e.parameters || {},
        contextPath: e.contextPath || "",
        contentLength: e.contentLength || -1,
        pathInfo: e.pathInfo || "",
        postData: e.postData
          ? {
              length: e.postData.length,
              type: e.postData.type,
              contents: e.postData.contents,
              name: e.postData.name,
            }
          : null,
      };
      return JSON.stringify(clone);
    } catch (err) {
      return "Error serializing event: " + err.message;
    }
  }

  /**
   * Main Dispatcher Method
   * Analyzes context, routes the request, and flushes execution logs to the specified Google Sheet.
   *
   * @param {EventObject} e - The event object from doGet/doPost
   * @param {Object} context - Custom context containing { functions, agentCard }.
   * @param {Function} [callback=null] - Optional callback function for real-time logging.
   * @return {ContentService.TextOutput} The JSON response
   */
  main(e, context = null, callback = null) {
    this.execId = Utilities.getUuid();
    this.logs = [];
    this.logCallback = callback;
    let route = null; // Declared early to avoid reference issues in catch block

    // Setup sheet requirements and log raw requests instantly to raw sheet
    if (this.logSpreadsheetId) {
      try {
        const ss = SpreadsheetApp.openById(this.logSpreadsheetId);
        this._getOrCreateSheet(ss, "raw", ["Timestamp", "Event Object"]);
        this._getOrCreateSheet(ss, "MCP", [
          "Date",
          "Method",
          "ID",
          "Direction",
          "Message",
        ]);
        this._getOrCreateSheet(ss, "A2A", [
          "Date",
          "Phase/Method",
          "ID",
          "Direction",
          "Message",
        ]);
        this._getOrCreateSheet(ss, "MCPA2Aserver_log", [
          "Timestamp",
          "Execution ID",
          "Direction",
          "Level",
          "Message",
        ]);

        const rawSheet = ss.getSheetByName("raw");
        const serializedEvent = this.serializeEvent_(e);
        rawSheet.appendRow([new Date().toISOString(), serializedEvent]);
      } catch (err) {
        console.error(
          "Failed to initialize multi-channel logging: " + err.stack,
        );
      }
    }

    this.addLog_("Main dispatcher initiated.", "INFO", "Internal");

    const incomingReqInfo = this.extractRequestInfo_(e);
    this.addLog_(
      `Incoming Request: ${incomingReqInfo}`,
      "INFO",
      "Client -> Server",
    );

    let response = null;

    try {
      if (!this.lock) {
        throw new Error(
          "Fatal: LockService is required. Set it using setServices({ lock: LockService.getScriptLock() }).",
        );
      }
      if (!this.apiKey) {
        throw new Error("Set your API key for using Gemini API.");
      }
      if (this.useToolsForMCPServer === true && !this.webAppsUrl) {
        throw new Error("When you use ToolsForMCPServer, set webAppsUrl.");
      }

      this.CONFIG.API_KEY = this.apiKey;
      this.CONFIG.MODEL = this.model;

      this.webAppsUrl =
        this.accessKey &&
        this.webAppsUrl &&
        !this.webAppsUrl.includes("accessKey=")
          ? `${this.webAppsUrl}?accessKey=${this.accessKey}`
          : this.webAppsUrl;

      let targetContext = context;
      if (this.useToolsForMCPServer === true) {
        this.addLog_(
          "Generating server context dynamically from ToolsForMCPServer.",
          "INFO",
          "Internal",
        );
        targetContext = this.createServerContext_();
      } else if (this.useToolsForMCPServer === false && !targetContext) {
        throw new Error("No context or tools provided.");
      }

      const processedServers = this.parseContext_(targetContext);
      route = this.determineRoute_(e);
      this.addLog_(`Route determined as: ${route.type}`, "INFO", "Internal");

      let targetEvent = e;

      if (
        route.type === "A2A" &&
        this.a2a === true &&
        processedServers.processedA2AObj
      ) {
        // Safe History Injection for A2A payloads
        if (
          this.history &&
          this.history.length > 0 &&
          e.postData &&
          e.postData.contents
        ) {
          try {
            const postObj = JSON.parse(e.postData.contents);
            if (
              postObj.params &&
              (postObj.method === "message/send" ||
                postObj.method === "tasks/send")
            ) {
              postObj.params.history = [
                ...this.history,
                ...(postObj.params.history || []),
              ];
              targetEvent = this.cloneEvent_(e);
              targetEvent.postData.contents = JSON.stringify(postObj);
              this.addLog_(
                `Injected ${this.history.length} base history elements into incoming A2A payload.`,
                "INFO",
                "Internal",
              );
            }
          } catch (err) {
            this.addLog_(
              `Failed to inject history into payload: ${err.message}`,
              "WARN",
              "Internal",
            );
          }
        }
        response = this.handleA2ARequest_(
          targetEvent,
          processedServers.processedA2AObj,
        );
      } else if (
        route.type === "MCP" &&
        this.mcp === true &&
        processedServers.processedMCPObj
      ) {
        // MCP protocol is purely functional and operates without chat history context.
        response = this.handleMCPRequest_(
          targetEvent,
          processedServers.processedMCPObj,
        );
      } else {
        this.addLog_(
          `Unhandled routing or disabled server. Route Type: ${route.type}, A2A Enabled: ${this.a2a}, MCP Enabled: ${this.mcp}`,
          "WARN",
          "Internal",
        );
        response = ContentService.createTextOutput("{}").setMimeType(
          ContentService.MimeType.JSON,
        );
      }
    } catch (err) {
      const processTag = route ? `[${route.type}]` : "[Routing]";
      this.addLog_(
        `Execution Error ${processTag}: ${err.message}`,
        "ERROR",
        "Internal",
      );
      response = ContentService.createTextOutput(
        JSON.stringify({ error: `[MCPA2Aserver Error] ${err.message}` }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    this.addLog_("Execution completed.", "INFO", "Internal");

    const outgoingResInfo =
      response && typeof response.getContent === "function"
        ? response.getContent()
        : "Unknown Content";
    this.addLog_(
      `Outgoing Response: ${outgoingResInfo}`,
      "INFO",
      "Server -> Client",
    );

    this.flushLogsToSheet_();

    return response;
  }

  /**
   * Safely clones the Google Apps Script Event Object to allow payload mutations.
   * GAS Event Objects are often read-only or contain prototype getters that fail standard destructuring.
   *
   * @private
   * @param {EventObject} e
   * @return {Object} Cloned Event Object
   */
  cloneEvent_(e) {
    if (!e) return e;
    return {
      queryString: e.queryString,
      parameter: e.parameter,
      parameters: e.parameters,
      contextPath: e.contextPath,
      contentLength: e.contentLength,
      pathInfo: e.pathInfo,
      postData: e.postData
        ? {
            length: e.postData.length,
            type: e.postData.type,
            contents: e.postData.contents,
            name: e.postData.name,
          }
        : null,
    };
  }

  /**
   * Helper to format incoming EventObject payload for clear logging.
   *
   * @private
   * @param {EventObject} e
   * @return {String}
   */
  extractRequestInfo_(e) {
    if (!e) return "No Event Object provided.";
    const method = e.postData ? "POST" : "GET";
    const path = e.pathInfo ? `/${e.pathInfo}` : "/";
    const payload =
      e.postData && e.postData.contents
        ? e.postData.contents
        : JSON.stringify(e.parameters || {});
    return `[${method}] Path: ${path} | Payload: ${payload}`;
  }

  /**
   * Retrieves the comprehensive execution logs.
   *
   * @return {Array<Object>} Array of log objects { timestamp, execId, direction, level, message }
   */
  getLogs() {
    return this.logs || [];
  }

  /**
   * Centralized internal logging utility with directional tracking.
   *
   * @private
   * @param {String} msg - Log message
   * @param {String} level - Log level (INFO, WARN, ERROR)
   * @param {String} direction - Data flow direction (Client -> Server, Server -> Client, Internal)
   */
  addLog_(msg, level = "INFO", direction = "Internal") {
    const logEntry = {
      timestamp: new Date().toISOString(),
      execId: this.execId,
      direction,
      level,
      message: msg,
    };
    this.logs.push(logEntry);
    if (typeof this.logCallback === "function") {
      try {
        this.logCallback(logEntry);
      } catch (err) {
        // Silently catch callback errors
      }
    }
  }

  /**
   * Flushes the accumulated execution logs to the designated Google Sheet via batch processing.
   *
   * @private
   */
  flushLogsToSheet_() {
    if (!this.logSpreadsheetId || this.logs.length === 0) return;

    let lockAcquired = false;
    try {
      if (this.lock) {
        this.lock.waitLock(10000);
        lockAcquired = true;
      }

      const ss = SpreadsheetApp.openById(this.logSpreadsheetId);
      const sheetName = "MCPA2Aserver_log";
      const headers = [
        "Timestamp",
        "Execution ID",
        "Direction",
        "Level",
        "Message",
      ];
      const sheet = this._getOrCreateSheet(ss, sheetName, headers);

      const data = this.logs.map((log) => [
        log.timestamp,
        log.execId,
        log.direction,
        log.level,
        log.message,
      ]);

      const insertRow = sheet.getLastRow() + 1;
      sheet.getRange(insertRow, 1, data.length, data[0].length).setValues(data);
    } catch (err) {
      console.error(`Failed to flush logs to Google Sheet: ${err.stack}`);
    } finally {
      if (lockAcquired && this.lock) {
        this.lock.releaseLock();
      }
    }
  }

  /**
   * Parses the context to determine enabled servers and routes functions appropriately.
   * Respects explicit manual overrides if `this.a2a` or `this.mcp` are provided.
   *
   * @private
   * @param {Object} context - The context object containing { functions, agentCard }.
   * @return {Object} Parsed A2A and MCP objects ready for handlers.
   */
  parseContext_(context) {
    const { functions, agentCard } = context;
    const hasFunctions = !!functions;
    const hasAgentCard = !!agentCard;

    if (this.a2a === null) {
      this.a2a = hasFunctions && hasAgentCard;
      this.addLog_(`Auto-detected A2A status: ${this.a2a}`, "INFO", "Internal");
    } else {
      this.addLog_(
        `Explicit A2A override status: ${this.a2a}`,
        "INFO",
        "Internal",
      );
    }

    if (this.mcp === null) {
      this.mcp = hasFunctions;
      this.addLog_(`Auto-detected MCP status: ${this.mcp}`, "INFO", "Internal");
    } else {
      this.addLog_(
        `Explicit MCP override status: ${this.mcp}`,
        "INFO",
        "Internal",
      );
    }

    if (this.a2a && (!hasFunctions || !hasAgentCard)) {
      throw new Error(
        "Invalid Context: A2A server requires both 'functions' and 'agentCard'.",
      );
    }
    if (this.mcp && !hasFunctions) {
      this.addLog_(
        "MCP server enabled but no 'functions' provided. Running with empty tools.",
        "WARN",
        "Internal",
      );
    }

    const a2aFunctions = { params_: {} };
    const mcpTools = [];

    if (hasFunctions && functions.params_) {
      Object.keys(functions.params_).forEach((f) => {
        const typeRaw = functions.params_[f].type;
        const typeStr = typeRaw ? String(typeRaw).toLowerCase() : null;

        if (this.mcp && (!typeStr || typeStr === "mcp")) {
          mcpTools.push({
            type: "tools/list",
            function: functions[f],
            value: {
              name: f,
              description: functions.params_[f].description,
              inputSchema: functions.params_[f].parameters,
            },
          });
        }

        if (this.a2a && (!typeStr || typeStr === "a2a")) {
          a2aFunctions.params_[f] = functions.params_[f];
          a2aFunctions[f] = functions[f];
        }
      });
      this.addLog_(
        `Functions parsed efficiently. MCP tools: ${mcpTools.length}, A2A functions: ${Object.keys(a2aFunctions.params_).length}`,
        "INFO",
        "Internal",
      );
    }

    const serverInfo = agentCard
      ? {
          name: agentCard.name || "Server",
          version: agentCard.version || "1.0.0",
        }
      : { name: "MCP Server", version: "1.0.0" };

    const processedMCPObj = this.mcp
      ? [
          {
            type: "initialize",
            value: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: { listChanged: false } },
              serverInfo: serverInfo,
            },
          },
          ...mcpTools,
        ]
      : null;

    const processedA2AObj = this.a2a
      ? {
          functions: () => a2aFunctions,
          agentCard: () => agentCard,
        }
      : null;

    return { processedA2AObj, processedMCPObj };
  }

  /**
   * Creates the base context object using ToolsForMCPServer library logic.
   *
   * @private
   * @return {Object} The generic context object { functions, agentCard }.
   */
  createServerContext_() {
    try {
      const m = ToolsForMCPServer;
      m.apiKey = this.CONFIG.API_KEY;
      m.model = this.CONFIG.MODEL;

      const tools = m.getTools();
      const functions = [...tools]
        .filter((e) => e.type === "tools/list")
        .reduce(
          (acc, tool) => {
            const funcName = tool.value.name;
            acc.params_[funcName] = {
              description: tool.value.description,
              parameters: tool.value.inputSchema,
            };
            acc[funcName] = tool.function;
            return acc;
          },
          { params_: {} },
        );

      // This dynamically binds the runtime resolved Web App URL to the local context object.
      const agentCard = {
        ...agentCard_ToolsForMCPServer,
        url: this.webAppsUrl,
      };
      this.addLog_(
        "ToolsForMCPServer context generated successfully.",
        "INFO",
        "Internal",
      );

      return {
        functions: functions,
        agentCard: agentCard,
      };
    } catch (err) {
      this.addLog_(
        `Error generating context from ToolsForMCPServer: ${err.stack}`,
        "ERROR",
        "Internal",
      );
      throw new Error("Failed to create context from ToolsForMCPServer.");
    }
  }

  /**
   * Determines the routing type based on the event object.
   *
   * @private
   * @param {EventObject} e - The event object from doGet/doPost
   * @return {Object} An object containing the route type ("A2A", "MCP", or "UNKNOWN").
   */
  determineRoute_(e) {
    if (e.pathInfo && this.CONFIG.WELL_KNOWN_PATHS.includes(e.pathInfo)) {
      return { type: "A2A" };
    }
    if (e.postData && e.postData.contents) {
      try {
        const obj = JSON.parse(e.postData.contents);
        if (obj.method) {
          if (this.CONFIG.METHODS.A2A.includes(obj.method)) {
            return { type: "A2A" };
          }
          if (this.CONFIG.METHODS.MCP.includes(obj.method)) {
            return { type: "MCP" };
          }
        }
      } catch (err) {
        this.addLog_(
          `Invalid JSON payload received: ${err.message}`,
          "WARN",
          "Internal",
        );
      }
    }
    return { type: "UNKNOWN" };
  }

  /**
   * Handles requests destined for the A2A Server.
   *
   * @private
   * @param {EventObject} e - The event object from doGet/doPost
   * @param {Object} A2AObj - The processed A2A context object.
   * @return {ContentService.TextOutput} The evaluated response.
   */
  handleA2ARequest_(e, A2AObj) {
    this.addLog_("Executing A2A Request Handler.", "INFO", "Internal");
    try {
      const { agentCard, functions } = A2AObj;
      const object = {
        eventObject: e,
        agentCard: agentCard,
        functions: functions,
        apiKey: this.apiKey,
        agentCardUrls: [],
      };

      let effectiveRouting = this.modelRouting !== undefined ? this.modelRouting : "efficient";
      let forceMaxCapability = false;
      const allowHints =
        this.allowClientRoutingHints === true ||
        (effectiveRouting &&
          typeof effectiveRouting === "object" &&
          effectiveRouting.allowClientRoutingHints === true);
      if (allowHints && e && e.postData && e.postData.contents) {
        try {
          const parsedReq = JSON.parse(e.postData.contents);
          const hint = parsedReq?.params?.metadata?.gasadkRouting;
          if (hint && typeof hint === "object") {
            const allowedModes = ["efficient", "quality", "fixed"];
            if (typeof hint.mode === "string" && allowedModes.includes(hint.mode)) {
              effectiveRouting =
                typeof effectiveRouting === "object" && effectiveRouting !== null
                  ? { ...effectiveRouting, mode: hint.mode }
                  : hint.mode;
            }
            if (typeof hint.maxCapabilityRequested === "boolean") {
              forceMaxCapability = hint.maxCapabilityRequested;
            }
          }
        } catch (_) {
          // Ignore malformed client hint safely
        }
      }

      const o = {
        model: this.CONFIG.MODEL,
        modelRouting: effectiveRouting,
        forceMaxCapability,
      };
      if (this.accessKey) o.accessKey = this.accessKey;
      if (this.logSpreadsheetId) {
        o.log = true;
        o.spreadsheetId = this.logSpreadsheetId;
      }
      const appInstance = new A2AApp(o).setServices({ lock: this.lock });
      if (this.hookManager) appInstance.setHookManager(this.hookManager);
      const res = appInstance.server(object);
      this.addLog_("A2A Request handled successfully.", "INFO", "Internal");
      return res;
    } catch (err) {
      this.addLog_(
        `[A2A Server Process Error] A2A Handle Error: ${err.stack}`,
        "ERROR",
        "Internal",
      );
      return ContentService.createTextOutput(
        JSON.stringify({ error: `[A2A Server Error] ${err.message}` }),
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }

  /**
   * Handles requests destined for the MCP Server.
   *
   * @private
   * @param {EventObject} e - The event object from doGet/doPost
   * @param {Array<Object>} MCPObj - The processed MCP array object.
   * @return {ContentService.TextOutput} The evaluated response.
   */
  handleMCPRequest_(e, MCPObj) {
    this.addLog_("Executing MCP Request Handler.", "INFO", "Internal");
    try {
      const object = { eventObject: e, items: MCPObj };
      const o = {};
      if (this.accessKey) o.accessKey = this.accessKey;
      if (this.logSpreadsheetId) {
        o.log = true;
        o.spreadsheetId = this.logSpreadsheetId;
      }
      const appInstance = new MCPApp(o).setServices({ lock: this.lock });
      if (this.hookManager) appInstance.setHookManager(this.hookManager);
      const res = appInstance.server(object);
      this.addLog_("MCP Request handled successfully.", "INFO", "Internal");
      return res;
    } catch (err) {
      this.addLog_(
        `[MCP Server Process Error] MCP Handle Error: ${err.stack}`,
        "ERROR",
        "Internal",
      );
      return ContentService.createTextOutput(
        JSON.stringify({ error: `[MCP Server Error] ${err.message}` }),
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }

  /**
   * Sets the hook manager for integrating hooks system.
   *
   * @param {GasHookManager} hookManager - Hook manager instance.
   * @returns {MCPA2Aserver} This instance for chaining.
   */
  setHookManager(hookManager) {
    this.hookManager = hookManager;
    return this;
  }
};


/**
 * FileSearchApp: This is used with Gemini API.
 * (required) An API key for using the Gemini API
 * Author: Kanshi Tanaike
 * https://github.com/tanaikech/FileSearchApp
 *
 * Updated on 20261127
 * version 1.1.0 (Gemini Decisions API Dynamic Model & Thinking Routing)
 */

/**
 * Main entry point to interact with the FileSearch class.
 *
 * @param {object} options - The configuration object.
 * @param {string} options.method - The name of the FileSearch method to call (e.g., 'create', 'list', 'media_upload').
 * @param {string} options.apiKey - The Gemini API key.
 * @param {string} [options.model] - The Gemini model name.
 * @param {object} [options.config] - The configuration object specific to the method being called.
 * @returns {any} The result from the called method.
 */
// function fileSearchEntryPoint(options = {}) {
//   const { method, config = {}, ...constructorOptions } = options;
//   if (!method) {
//     throw new Error("A 'method' property must be specified in the options.");
//   }

//   const fileSearch = new FileSearch(constructorOptions);

//   if (typeof fileSearch[method] !== "function") {
//     throw new Error(
//       `Method '${method}' does not exist on the FileSearch class.`
//     );
//   }

//   return fileSearch[method](config);
// }

/**
 * A class for interacting with the Google AI File Search API.
 */
var FileSearch = class FileSearch {
  /**
   * @param {object} params - The parameters.
   * @param {string} params.apiKey - The Gemini API key.
   * @param {string} [params.model="models/gemini-4-hydrogen"] - The Gemini model name.
   */
  constructor({
    apiKey,
    model = "models/gemini-4-hydrogen",
    modelRouting = "efficient",
    generationConfig = null,
    onRoutingLog = null,
  }) {
    if (!apiKey) {
      throw new Error("API key is required.");
    }
    this.apiKey = apiKey;
    this.model = model;
    this.modelRouting = modelRouting !== undefined ? modelRouting : "efficient";
    this.generationConfig = generationConfig || null;
    this.onRoutingLog = typeof onRoutingLog === "function" ? onRoutingLog : null;
    this._lastRoutingDecision = null;

    // Define base URLs as instance properties
    this.apiBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
    this.uploadApiBaseUrl =
      "https://generativelanguage.googleapis.com/upload/v1beta";
  }

  // --- File Search Store Methods ---

  /**
   * Creates a new File Search Store.
   * @param {object} params - The parameters.
   * @param {string} params.displayName - The display name for the new store.
   * @returns {object} The created FileSearchStore object.
   */
  create({ displayName }) {
    const endpoint = "/fileSearchStores";
    const payload = {
      displayName: displayName || `sampleFileSearchStore-${Date.now()}`,
    };
    return this._request(endpoint, {
      method: "post",
      payload: JSON.stringify(payload),
    });
  }

  /**
   * Deletes a File Search Store.
   * @param {object} params - The parameters.
   * @param {string} params.fileSearchStoreName - The name of the store to delete.
   * @returns {string} A confirmation message.
   */
  remove({ fileSearchStoreName }) {
    if (!fileSearchStoreName) throw new Error("Provide fileSearchStoreName.");
    const endpoint = `/${fileSearchStoreName}`;
    const query = { force: "true" };
    this._request(endpoint, { method: "delete" }, query);
    return `"${fileSearchStoreName}" was successfully deleted.`;
  }

  /**
   * Gets information about a specific File Search Store.
   * @param {object} params - The parameters.
   * @param {string} params.fileSearchStoreName - The name of the store to retrieve.
   * @returns {object} The FileSearchStore object.
   */
  get({ fileSearchStoreName }) {
    if (!fileSearchStoreName) throw new Error("Provide fileSearchStoreName.");
    const endpoint = `/${fileSearchStoreName}`;
    return this._request(endpoint, {}, { fields: "*" });
  }

  /**
   * Lists all File Search Stores.
   * @returns {object[]} An array of all FileSearchStore objects.
   */
  list() {
    const endpoint = "/fileSearchStores";
    const results = [];
    let pageToken = "";
    do {
      const query = { pageSize: 20, pageToken };
      const response = this._request(endpoint, {}, query);
      if (response.fileSearchStores && response.fileSearchStores.length > 0) {
        results.push(...response.fileSearchStores);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
    return results;
  }

  // --- Document Methods ---

  /**
   * Uploads files from various sources to a File Search Store.
   * @param {object} params - The parameters.
   * @returns {string} A confirmation message with the document name.
   */
  media_upload({
    fileSearchStoreName,
    displayName,
    text,
    mimeType,
    fileIds = [],
    folderId,
    urls = [],
    customMetadata = [],
    chunkingConfig = [],
  }) {
    // ref: https://ai.google.dev/gemini-api/docs/file-search#supported-files
    const supportedMimeTypes = [
      "application/dart",
      "application/ecmascript",
      "application/json",
      "application/ms-java",
      "application/msword",
      "application/pdf",
      "application/sql",
      "application/typescript",
      "application/vnd.curl",
      "application/vnd.dart",
      "application/vnd.ibm.secure-container",
      "application/vnd.jupyter",
      "application/vnd.ms-excel",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
      "application/x-csh",
      "application/x-hwp",
      "application/x-hwp-v5",
      "application/x-latex",
      "application/x-php",
      "application/x-powershell",
      "application/x-sh",
      "application/x-shellscript",
      "application/x-tex",
      "application/x-zsh",
      "application/xml",
      "application/zip",
      "text/1d-interleaved-parityfec",
      "text/RED",
      "text/SGML",
      "text/cache-manifest",
      "text/calendar",
      "text/cql",
      "text/cql-extension",
      "text/cql-identifier",
      "text/css",
      "text/csv",
      "text/csv-schema",
      "text/dns",
      "text/encaprtp",
      "text/enriched",
      "text/example",
      "text/fhirpath",
      "text/flexfec",
      "text/fwdred",
      "text/gff3",
      "text/grammar-ref-list",
      "text/hl7v2",
      "text/html",
      "text/javascript",
      "text/jcr-cnd",
      "text/jsx",
      "text/markdown",
      "text/mizar",
      "text/n3",
      "text/parameters",
      "text/parityfec",
      "text/php",
      "text/plain",
      "text/provenance-notation",
      "text/prs.fallenstein.rst",
      "text/prs.lines.tag",
      "text/prs.prop.logic",
      "text/raptorfec",
      "text/rfc822-headers",
      "text/rtf",
      "text/rtp-enc-aescm128",
      "text/rtploopback",
      "text/rtx",
      "text/sgml",
      "text/shaclc",
      "text/shex",
      "text/spdx",
      "text/strings",
      "text/t140",
      "text/tab-separated-values",
      "text/texmacs",
      "text/troff",
      "text/tsv",
      "text/tsx",
      "text/turtle",
      "text/ulpfec",
      "text/uri-list",
      "text/vcard",
      "text/vnd.DMClientScript",
      "text/vnd.IPTC.NITF",
      "text/vnd.IPTC.NewsML",
      "text/vnd.a",
      "text/vnd.abc",
      "text/vnd.ascii-art",
      "text/vnd.curl",
      "text/vnd.debian.copyright",
      "text/vnd.dvb.subtitle",
      "text/vnd.esmertec.theme-descriptor",
      "text/vnd.exchangeable",
      "text/vnd.familysearch.gedcom",
      "text/vnd.ficlab.flt",
      "text/vnd.fly",
      "text/vnd.fmi.flexstor",
      "text/vnd.gml",
      "text/vnd.graphviz",
      "text/vnd.hans",
      "text/vnd.hgl",
      "text/vnd.in3d.3dml",
      "text/vnd.in3d.spot",
      "text/vnd.latex-z",
      "text/vnd.motorola.reflex",
      "text/vnd.ms-mediapackage",
      "text/vnd.net2phone.commcenter.command",
      "text/vnd.radisys.msml-basic-layout",
      "text/vnd.senx.warpscript",
      "text/vnd.sosi",
      "text/vnd.sun.j2me.app-descriptor",
      "text/vnd.trolltech.linguist",
      "text/vnd.wap.si",
      "text/vnd.wap.sl",
      "text/vnd.wap.wml",
      "text/vnd.wap.wmlscript",
      "text/vtt",
      "text/wgsl",
      "text/x-asm",
      "text/x-bibtex",
      "text/x-boo",
      "text/x-c",
      "text/x-c++hdr",
      "text/x-c++src",
      "text/x-cassandra",
      "text/x-chdr",
      "text/x-coffeescript",
      "text/x-component",
      "text/x-csh",
      "text/x-csharp",
      "text/x-csrc",
      "text/x-cuda",
      "text/x-d",
      "text/x-diff",
      "text/x-dsrc",
      "text/x-emacs-lisp",
      "text/x-erlang",
      "text/x-gff3",
      "text/x-go",
      "text/x-haskell",
      "text/x-java",
      "text/x-java-properties",
      "text/x-java-source",
      "text/x-kotlin",
      "text/x-lilypond",
      "text/x-lisp",
      "text/x-literate-haskell",
      "text/x-lua",
      "text/x-moc",
      "text/x-objcsrc",
      "text/x-pascal",
      "text/x-pcs-gcd",
      "text/x-perl",
      "text/x-perl-script",
      "text/x-python",
      "text/x-python-script",
      "text/x-r-markdown",
      "text/x-rsrc",
      "text/x-rst",
      "text/x-ruby-script",
      "text/x-rust",
      "text/x-sass",
      "text/x-scala",
      "text/x-scheme",
      "text/x-script.python",
      "text/x-scss",
      "text/x-setext",
      "text/x-sfv",
      "text/x-sh",
      "text/x-siesta",
      "text/x-sos",
      "text/x-sql",
      "text/x-swift",
      "text/x-tcl",
      "text/x-tex",
      "text/x-vbasic",
      "text/x-vcalendar",
      "text/xml",
      "text/xml-dtd",
      "text/xml-external-parsed-entity",
      "text/yaml",
    ];

    const convMimeType_ = (fileBlob, targetFileId = null) => {
      if (!supportedMimeTypes.includes(fileBlob.getContentType()) && targetFileId) {
        return UrlFetchApp.fetch(
          `https://drive.google.com/thumbnail?sz=w1000&id=${targetFileId}`,
          { headers: { authorization: "Bearer " + ScriptApp.getOAuthToken() } },
        ).getBlob();
      }
      return fileBlob;
    };

    const upload_ = ({ fileId, text, url }) => {
      let fileBlob;
      if (fileId) {
        fileBlob = DriveApp.getFileById(fileId).getBlob();
      } else if (text) {
        fileBlob = Utilities.newBlob(
          text,
          mimeType || MimeType.PLAIN_TEXT,
          displayName || `doc-${Date.now()}`,
        );
      } else if (url) {
        fileBlob = UrlFetchApp.fetch(url).getBlob();
        if (fileBlob.getName().toLocaleLowerCase() == "undefined.html") {
          fileBlob.setName(`doc-${Date.now()}`);
        }
      } else {
        throw new Error("Provide one of 'text', 'fileId', or 'url'.");
      }
      const metadata = {
        displayName: fileBlob.getName(),
        mimeType: fileBlob.getContentType(),
        ...(customMetadata.length > 0 && { customMetadata }),
        ...(chunkingConfig.length > 0 && { chunkingConfig }),
      };
      const payload = {
        metadata: Utilities.newBlob(
          JSON.stringify(metadata),
          "application/json",
        ),
        file: convMimeType_(fileBlob, fileId),
      };
      const endpoint = `/${fileSearchStoreName}:uploadToFileSearchStore`;
      const operation = this._request(
        endpoint,
        { method: "post", payload },
        {},
        true,
      );
      const finalOperation = this._pollOperation(operation);
      return `Processing complete for: ${metadata.displayName}\nDocument name is "${finalOperation.name}".`;
    };

    let res = [];
    if (text) {
      res.push(upload_({ text }));
    } else if (folderId) {
      const folder = DriveApp.getFolderById(folderId);
      const files = folder.getFiles();
      fileIds = [];
      while (files.hasNext()) {
        const file = files.next();
        fileIds.push(file.getId());
      }
      if (fileIds.length > 0) {
        res.push(...fileIds.map((fileId) => upload_({ fileId })));
      }
    } else if (fileIds && fileIds.length > 0) {
      res.push(...fileIds.map((fileId) => upload_({ fileId })));
    } else if (urls && urls.length > 0) {
      res.push(...urls.map((url) => upload_({ url })));
    }
    if (res.length > 0) {
      return res.join("\n");
    }
    return "No files were uploaded.";
  }

  /**
   * Imports a file from File Service to a FileSearchStore.
   * @param {object} params - The parameters.
   * @returns {object} The operation object.
   */
  import_file({
    fileSearchStoreName,
    fileName,
    customMetadata = [],
    chunkingConfig = [],
  }) {
    if (!fileName) throw new Error("Provide fileName.");
    const endpoint = `/${fileSearchStoreName}:importFile`;
    const payload = {
      fileName,
      ...(customMetadata.length > 0 && { customMetadata }),
      ...(chunkingConfig.length > 0 && { chunkingConfig }),
    };
    const operation = this._request(endpoint, {
      method: "post",
      payload: JSON.stringify(payload),
    });
    const finalOperation = this._pollOperation(operation);
    return `Processing complete for: ${fileName}\nDocument name is "${finalOperation.name}".`;
  }

  /**
   * Gets a specific document.
   * @param {object} params - The parameters.
   * @param {string} params.documentName - The name of the document to retrieve.
   * @returns {object} The Document object.
   */
  documents_get({ documentName }) {
    if (!documentName) throw new Error("Provide documentName.");
    const endpoint = `/${documentName}`;
    return this._request(endpoint, {}, { fields: "*" });
  }

  /**
   * Deletes a document.
   * @param {object} params - The parameters.
   * @param {string} params.documentName - The name of the document to delete.
   * @returns {string} A confirmation message.
   */
  documents_remove({ documentName }) {
    if (!documentName) throw new Error("Provide documentName.");
    const endpoint = `/${documentName}`;
    this._request(endpoint, { method: "delete" }, { force: "true" });
    return `"${documentName}" was successfully deleted.`;
  }

  /**
   * Lists all documents in a File Search Store.
   * @param {object} params - The parameters.
   * @param {string} params.fileSearchStoreName - The name of the store.
   * @returns {object[]} An array of Document objects.
   */
  documents_list({ fileSearchStoreName }) {
    if (!fileSearchStoreName) throw new Error("Provide fileSearchStoreName.");
    const endpoint = `/${fileSearchStoreName}/documents`;
    const results = [];
    let pageToken = "";
    do {
      const query = { pageSize: 20, pageToken };
      const response = this._request(endpoint, {}, query);
      if (response.documents && response.documents.length > 0) {
        results.push(...response.documents);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
    return results;
  }

  /**
   * Performs semantic search over a Document.
   * @param {object} params - The parameters.
   * @param {string} params.name - The resource name of the document to search (e.g., 'fileSearchStores/my-store/documents/my-doc').
   * @param {string} params.query - The query to search for.
   * @param {number} [params.resultsCount] - The number of results to return.
   * @param {object[]} [params.metadataFilters] - Filters to apply to the search.
   * @returns {object} The search results.
   */
  documents_query({ name, query, resultsCount, metadataFilters = [] }) {
    if (!name || !query) {
      throw new Error(
        "Provide both 'name' (the document resource name) and 'query'.",
      );
    }
    const endpoint = `/${name}:query`;
    const payload = { query };
    if (resultsCount) {
      payload.resultsCount = resultsCount;
    }
    if (metadataFilters && metadataFilters.length > 0) {
      payload.metadataFilters = metadataFilters;
    }
    return this._request(endpoint, {
      method: "post",
      payload: JSON.stringify(payload),
    });
  }

  // --- RAG Content Generation ---

  /**
   * Generates content using File Search Stores as a RAG tool.
   * @param {object} params - The parameters for content generation.
   * @returns {string} The generated text content.
   */
  generate_content({
    fileSearchStoreNames = [],
    prompt,
    metadataFilter = null,
    generationConfig = null,
    modelRouting = undefined,
    remainingMs = null,
    forceMaxCapability = false,
  }) {
    let activeModel = this.model;
    let activeGenConfig = generationConfig || this.generationConfig || null;
    if (typeof GeminiDecisionsRouter === "function") {
      const routed = GeminiDecisionsRouter.route({
        apiKey: this.apiKey,
        prompt,
        role: "file_search",
        configuredModel: this.model,
        configuredGenerationConfig: activeGenConfig,
        hasTools: fileSearchStoreNames.length > 0,
        modelRouting: modelRouting !== undefined ? modelRouting : this.modelRouting,
        remainingMs,
        forceMaxCapability,
        onLog: this.onRoutingLog,
        consoleLogFallback: !this.onRoutingLog,
      });
      activeModel = routed.model;
      activeGenConfig = routed.generationConfig;
      this._lastRoutingDecision = routed.routingDecision;
    }
    const normModel = activeModel.startsWith("models/") ? activeModel : `models/${activeModel}`;
    const endpoint = `/${normModel}:generateContent`;
    const tools = [
      {
        fileSearch: {
          fileSearchStoreNames,
          ...(metadataFilter && { metadataFilter }),
        },
      },
    ];
    const payload = {
      contents: [{ parts: [{ text: prompt }], role: "user" }],
      ...(fileSearchStoreNames.length > 0 && { tools }),
      ...(activeGenConfig && Object.keys(activeGenConfig).length > 0
        ? { generationConfig: activeGenConfig }
        : {}),
    };
    const response = this._request(endpoint, {
      method: "post",
      payload: JSON.stringify(payload),
    });
    const parts = response?.candidates?.[0]?.content?.parts || [];
    return parts
      .filter((p) => p && typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("");
  }

  // --- Private Helper Methods ---

  /**
   * Polls a long-running operation until it's complete.
   * @param {object} operation - The initial operation object.
   * @param {number} [maxAttempts=30] - Maximum poll attempts to prevent infinite loops.
   * @returns {object} The completed operation object.
   */
  _pollOperation(operation, maxAttempts = 30) {
    let currentOperation = operation;
    let attempts = 0;
    while (currentOperation && !currentOperation.done) {
      if (++attempts > maxAttempts) {
        throw new Error(
          `[FileSearch Error] Operation polling timed out after ${maxAttempts} attempts: ${currentOperation.name}`,
        );
      }
      Utilities.sleep(1500); // Wait before polling again
      const endpoint = `/${currentOperation.name}`;
      currentOperation = this._request(endpoint);
    }
    return currentOperation;
  }

  /**
   * Centralized method for making API requests.
   * @param {string} endpoint - The API endpoint path.
   * @param {object} options - The options for UrlFetchApp.
   * @param {object} queryParams - The query parameters.
   * @param {boolean} useUploadUrl - Whether to use the upload base URL.
   * @returns {object} The JSON response.
   */
  _request(endpoint, options = {}, queryParams = {}, useUploadUrl = false) {
    const baseUrl = useUploadUrl ? this.uploadApiBaseUrl : this.apiBaseUrl;
    const allQueryParams = { key: this.apiKey, ...queryParams };
    const queryString = Object.entries(allQueryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const url = `${baseUrl}${endpoint}?${queryString}`;
    const fetchOptions = {
      muteHttpExceptions: true,
      contentType: "application/json",
      ...options,
    };

    const response = UrlFetchApp.fetch(url, fetchOptions);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode >= 200 && responseCode < 300) {
      // For empty success responses (e.g., DELETE)
      if (responseBody === "") {
        return {};
      }
      return JSON.parse(responseBody);
    } else {
      throw new Error(`API Error: ${responseCode} - ${responseBody}`);
    }
  }
};
