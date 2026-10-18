// 可插拔的联网搜索（市场 Agent 使用）。SEARCH_PROVIDER 选择服务：zhipu（默认）/ tavily
// 未配置 Key 时返回不可用，Agent 会改用模拟的市场数据。

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  date?: string;
}

const provider = () => (process.env.SEARCH_PROVIDER || (process.env.TAVILY_API_KEY && !process.env.SEARCH_API_KEY ? "tavily" : "zhipu")).toLowerCase();
const key = () => process.env.SEARCH_API_KEY || (provider() === "tavily" ? process.env.TAVILY_API_KEY : "");

export function webSearchConfigured() {
  return Boolean(key());
}

export function webSearchProvider() {
  return webSearchConfigured() ? (provider() === "tavily" ? "Tavily" : "智谱 Web Search") : null;
}

async function zhipu(query: string): Promise<WebResult[]> {
  const res = await fetch(process.env.SEARCH_BASE_URL || "https://open.bigmodel.cn/api/paas/v4/web_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      search_query: query.slice(0, 78), // 智谱限制查询长度
      search_engine: process.env.SEARCH_ENGINE || "search_pro_quark",
      count: 6,
      search_recency_filter: "oneYear",
      content_size: "medium",
    }),
  });
  if (!res.ok) throw new Error(`智谱搜索返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.search_result ?? []).map((r: any) => ({
    title: String(r.title ?? ""),
    url: String(r.link ?? r.url ?? ""),
    snippet: String(r.content ?? "").slice(0, 300),
    source: r.media ? String(r.media) : undefined,
    date: r.publish_date ? String(r.publish_date) : undefined,
  }));
}

async function tavily(query: string): Promise<WebResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({ query, max_results: 5 }),
  });
  if (!res.ok) throw new Error(`Tavily 返回 ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: String(r.content ?? "").slice(0, 300) }));
}

export async function webSearch(query: string): Promise<{ available: boolean; results: WebResult[]; error?: string }> {
  if (!key() || !query) return { available: false, results: [] };
  try {
    const results = provider() === "tavily" ? await tavily(query) : await zhipu(query);
    return { available: true, results: results.filter((r) => r.title || r.snippet) };
  } catch (e) {
    return { available: false, results: [], error: e instanceof Error ? e.message : String(e) };
  }
}
