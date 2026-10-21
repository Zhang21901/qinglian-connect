# 知遇

面向青年社群的协作伙伴匹配平台。

GitHub Pages 会从 `main` 分支根目录发布此静态站点。

## AI 匹配

AI 匹配由 Supabase Edge Function 调用 Gemini，API Key 不会出现在前端代码中。默认每位成员每天可请求 15 次。

1. 在 Google AI Studio 创建 Gemini API Key。
2. 在 Supabase Dashboard 的 Edge Functions Secrets 中新增 `GEMINI_API_KEY`。
3. 部署 `supabase/functions/ai-match`，并在 Supabase SQL Editor 执行 `supabase/schema.sql` 新增的配额表和函数。

本地部署命令：

```bash
npx supabase functions deploy ai-match --project-ref heypnvpgfhgilqtqcrnc --no-verify-jwt
```
