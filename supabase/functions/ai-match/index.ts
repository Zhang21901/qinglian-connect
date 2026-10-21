import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://zhang21901.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

async function generateWithRetry(url: string, init: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, init);
    if (response.status !== 503 || attempt === 2) return response;
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw new Error("Gemini request did not complete");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "请先登录" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return json({ error: "AI 服务尚未配置，请联系管理员添加 GEMINI_API_KEY。" }, 503);

  const admin = createClient(url, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "登录状态已失效，请重新登录" }, 401);

  let payload: { query?: unknown };
  try { payload = await req.json(); } catch { return json({ error: "请求格式不正确" }, 400); }
  const query = String(payload.query || "").trim();
  if (query.length < 2 || query.length > 300) return json({ error: "请输入 2 到 300 个字的匹配需求" }, 400);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: candidates, error: candidatesError }, { data: intentCandidates, error: intentsError }] = await Promise.all([
    userClient.rpc("ai_match_candidates"),
    userClient.rpc("ai_match_intent_candidates"),
  ]);
  if (candidatesError || intentsError) return json({ error: "暂时无法读取社群匹配资料" }, 500);

  const modelListResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": geminiKey },
  });
  if (!modelListResponse.ok) return json({ error: `无法读取 Gemini 可用模型（HTTP ${modelListResponse.status}）。` }, 502);
  const modelList = await modelListResponse.json();
  const availableModels = (modelList.models || []).filter((model: { supportedGenerationMethods?: string[] }) =>
    model.supportedGenerationMethods?.includes("generateContent"),
  );
  const preferredModels = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"];
  const selectedModel = preferredModels.find((name) => availableModels.some((model: { name?: string }) => model.name === `models/${name}`))
    || availableModels.find((model: { name?: string }) => model.name?.includes("flash"))?.name?.replace(/^models\//, "");
  if (!selectedModel) return json({ error: "此 Gemini API Key 没有可用的文本生成模型。" }, 502);

  const { data: remaining, error: quotaError } = await admin.rpc("consume_ai_match_quota", {
    p_user_id: userData.user.id,
    p_daily_limit: 15,
  });
  if (quotaError) return json({ error: quotaError.message.includes("已用完") ? quotaError.message : "今日 AI 匹配次数已用完" }, 429);
  const refundQuota = () => admin.rpc("refund_ai_match_quota", { p_user_id: userData.user.id });

  const matches = (candidates || []).map((person) => ({
    id: person.id,
    display_name: person.display_name,
    school: person.school,
    role_title: person.role_title,
    focus: person.focus,
    skills: person.skills || [],
  }));
  const context = (candidates || []).map((person, index) => [
    `#${index + 1} ${person.display_name}｜${person.school}｜${person.role_title}`,
    `方向：${person.focus}`,
    `技能：${(person.skills || []).join("、") || "未填写"}`,
    `经历：${String(person.experiences || "未填写").slice(0, 180)}`,
    `协作：${(person.collaboration_roles || []).join("、") || "未填写"}；${person.weekly_hours || "时间待补充"}；${(person.availability || []).join("、") || ""}`,
    `简介：${String(person.bio || "").slice(0, 120)}`,
  ].join("\n")).join("\n\n");
  const intentContext = (intentCandidates || []).map((intent, index) => [
    `#${index + 1} ${intent.title}`,
    `发起人：${intent.author_name}｜${intent.author_school}｜${intent.author_role_title}`,
    `需要角色：${(intent.needed_roles || []).join("、") || "未填写"}`,
    `内容：${String(intent.description || "").slice(0, 300)}`,
  ].join("\n")).join("\n\n");

  const prompt = `你是“知遇”青年社群的协作匹配助手。用户需求：${query}\n\n以下是成员公开资料摘要（不包含联系方式）：\n${context || "目前没有其他完成资料的成员。"}\n\n以下是正在招募的协作意向：\n${intentContext || "目前没有开放的协作意向。"}\n\n请用中文作答，总长度控制在 350 个汉字以内。先用 1-2 句说明匹配判断；随后必须完整输出“适合认识的成员”和“值得参与的协作意向”两个小节。成员最多 5 位，格式为“姓名（学校/机构，角色）：匹配理由”；意向最多 5 项，格式为“意向标题（发起人）：匹配理由”。没有匹配项时写“暂无匹配项”。只依据给出的资料，不要编造信息，不要输出联系方式。最后一行必须是“匹配完成。”。`;
  const thinkingConfig = selectedModel.startsWith("gemini-3")
    ? { thinkingLevel: "minimal" }
    : selectedModel.startsWith("gemini-2.5")
      ? { thinkingBudget: 0 }
      : undefined;
  const geminiResponse = await generateWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.35, maxOutputTokens: 1600, ...(thinkingConfig ? { thinkingConfig } : {}) } }),
  });
  if (!geminiResponse.ok) {
    const providerError = await geminiResponse.text();
    console.error("Gemini error", geminiResponse.status, providerError);
    await refundQuota();
    const error = geminiResponse.status === 400 || geminiResponse.status === 401 || geminiResponse.status === 403
      ? "Gemini API Key 无效或尚未启用，请管理员检查 Edge Functions Secret。"
      : geminiResponse.status === 429
        ? "Gemini 免费额度暂时用完，请稍后再试。"
        : "Gemini 服务暂时繁忙，已自动重试，请稍后再试。";
    return json({ error }, 502);
  }
  const gemini = await geminiResponse.json();
  const answer = gemini.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim();
  if (!answer) {
    await refundQuota();
    return json({ error: "AI 未返回有效结果，请稍后再试" }, 502);
  }
  return json({ answer, matches: matches.slice(0, 5), remaining });
});
