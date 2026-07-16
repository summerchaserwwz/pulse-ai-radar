import type { Signal } from "./signals";

const interestAliases: Record<string, string[]> = {
  基础模型: ["模型", "GPT", "Claude", "Llama", "Qwen", "DeepSeek"],
  Agent: ["Agent", "MCP", "工具调用"],
  "AI Coding": ["AI Coding", "Copilot", "开发工具", "代码"],
  开源模型: ["开源", "开放权重", "自托管", "本地部署"],
  多模态: ["多模态", "视觉", "语音"],
  "AI 安全": ["安全", "风险", "红队", "NIST"],
  政策监管: ["政策", "监管", "合规", "AI Act"],
  "AI for Science": ["Science", "AlphaFold", "研究", "生物"],
  企业落地: ["企业", "产品", "工作流", "成本"],
  推理优化: ["推理", "量化", "蒸馏"],
  数据基础设施: ["数据", "协议", "基础设施"],
  机器人: ["机器人", "具身"],
};

export function signalMatchesInterest(signal: Signal, interest: string) {
  const haystack = `${signal.title} ${signal.summary} ${signal.category} ${signal.tags.join(" ")}`.toLowerCase();
  return textMatchesInterest(haystack, interest);
}

export function textMatchesInterest(text: string, interest: string) {
  const haystack = text.toLowerCase();
  return (interestAliases[interest] ?? [interest]).some((keyword) =>
    haystack.includes(keyword.toLowerCase()),
  );
}

export function preferenceMatchCount(text: string, interests: string[]) {
  return interests.filter((interest) => textMatchesInterest(text, interest)).length;
}

export function rankByPreferences<T>(
  items: T[],
  options: {
    interests: string[];
    hidden?: string[];
    verifiedOnly?: boolean;
    limit?: number;
    id: (item: T) => string;
    text: (item: T) => string;
    baseScore: (item: T) => number;
    evidenceCount: (item: T) => number;
    status: (item: T) => string;
  },
) {
  const hidden = new Set(options.hidden ?? []);
  const ranked = items
    .filter((item) => !hidden.has(options.id(item)))
    .filter((item) => {
      if (!options.verifiedOnly) return true;
      const status = options.status(item);
      return status === "已确认" || status === "多源确认";
    })
    .map((item) => {
      const matches = preferenceMatchCount(options.text(item), options.interests);
      const evidenceBoost = Math.min(options.evidenceCount(item), 8);
      const status = options.status(item);
      const authorityBoost = status === "已确认" ? 8 : status === "多源确认" ? 5 : 0;
      return {
        item,
        score: options.baseScore(item) + matches * 9 + evidenceBoost + authorityBoost,
      };
    })
    .sort((a, b) => b.score - a.score || options.baseScore(b.item) - options.baseScore(a.item))
    .map(({ item }) => item);

  return typeof options.limit === "number" ? ranked.slice(0, options.limit) : ranked;
}

export function personalizedSignals(
  inputSignals: Signal[],
  options: {
    interests: string[];
    hidden?: string[];
    verifiedOnly?: boolean;
    limit?: number;
  },
) {
  return rankByPreferences(inputSignals, {
    ...options,
    id: (signal) => signal.id,
    text: (signal) =>
      `${signal.title} ${signal.summary} ${signal.category} ${signal.tags.join(" ")}`,
    baseScore: (signal) => signal.trend,
    evidenceCount: (signal) => signal.evidenceCount,
    status: (signal) => signal.status,
  });
}
