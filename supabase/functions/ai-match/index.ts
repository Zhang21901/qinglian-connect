import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://zhang21901.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

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
  const { data: candidates, error: candidatesError } = await userClient.rpc("ai_match_candidates");
  if (candidatesError) return json({ error: "暂时无法读取成员资料" }, 500);

  const { data: remaining, error: quotaError } = await admin.rpc("consume_ai_match_quota", {
    p_user_id: userData.user.id,
    p_daily_limit: 15,
  });
  if (quotaError) return json({ error: quotaError.message.includes("已用完") ? quotaError.message : "今日 AI 匹配次数已用完" }, 429);

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

  const prompt = `你是“知遇”青年社群的协作匹配助手。用户需求：${query}\n\n以下是成员公开资料摘要（不包含联系方式）：\n${context || "目前没有其他完成资料的成员。"}\n\n请用中文回答：先用 1-2 句说明匹配判断；然后列出最合适的至多 5 位成员，按“姓名（学校/机构，角色）：匹配理由”格式。只能依据给出的资料，不要编造信息，不要输出联系方式；没有合适人选时明确说明。`;
  const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.35, maxOutputTokens: 700 } }),
  });
  if (!geminiResponse.ok) {
    console.error("Gemini error", await geminiResponse.text());
    return json({ error: "AI 服务暂时不可用，请稍后再试" }, 502);
  }
  const gemini = await geminiResponse.json();
  const answer = gemini.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim();
  if (!answer) return json({ error: "AI 未返回有效结果，请稍后再试" }, 502);
  return json({ answer, matches: matches.slice(0, 5), remaining });
});
