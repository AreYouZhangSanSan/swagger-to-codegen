const CRUD_RULES = [
  { role: "list", methods: ["GET"], words: ["page", "list", "query", "search"] },
  { role: "detail", methods: ["GET"], words: ["detail", "get", "info"] },
  { role: "create", methods: ["POST"], words: ["create", "add", "save"] },
  { role: "update", methods: ["PUT", "PATCH", "POST"], words: ["update", "edit", "modify"] },
  { role: "delete", methods: ["DELETE", "POST"], words: ["delete", "remove"] },
];

/**
 * 将 OpenAPI 端点转为可审计的生成计划。
 * 每个角色都带证据和置信度，避免把 LLM 猜测直接当作事实。
 */
export function analyzeContract(groups) {
  const modules = Object.entries(groups).map(([tag, endpoints]) => ({
    tag,
    endpointCount: endpoints.length,
    operations: endpoints.map(classifyEndpoint),
    coverage: calculateCoverage(endpoints.map(classifyEndpoint)),
  }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    modules,
    summary: {
      moduleCount: modules.length,
      endpointCount: modules.reduce((sum, item) => sum + item.endpointCount, 0),
      averageCoverage: modules.length
        ? Number((modules.reduce((sum, item) => sum + item.coverage, 0) / modules.length).toFixed(2))
        : 0,
    },
  };
}

function classifyEndpoint(endpoint) {
  const evidenceText = `${endpoint.operationId || ""} ${endpoint.summary || ""} ${endpoint.path}`.toLowerCase();
  let best = { role: "custom", score: 0, evidence: [] };

  for (const rule of CRUD_RULES) {
    let score = rule.methods.includes(endpoint.method) ? 0.35 : 0;
    const evidence = rule.methods.includes(endpoint.method) ? [`HTTP ${endpoint.method}`] : [];
    for (const word of rule.words) {
      if (evidenceText.includes(word)) {
        score += 0.2;
        evidence.push(`命中关键词 ${word}`);
      }
    }
    if (rule.role === "detail" && /\{[^}]+\}/.test(endpoint.path)) {
      score += 0.25;
      evidence.push("路径包含资源标识");
    }
    if (score > best.score) best = { role: rule.role, score, evidence };
  }

  return {
    method: endpoint.method,
    path: endpoint.path,
    operationId: endpoint.operationId || null,
    inferredRole: best.role,
    confidence: Number(Math.min(best.score, 1).toFixed(2)),
    evidence: best.evidence,
    requiresReview: best.score < 0.55,
  };
}

function calculateCoverage(operations) {
  const expected = new Set(["list", "detail", "create", "update", "delete"]);
  const found = new Set(operations.filter(x => !x.requiresReview).map(x => x.inferredRole));
  return Number(([...expected].filter(x => found.has(x)).length / expected.size).toFixed(2));
}
