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
