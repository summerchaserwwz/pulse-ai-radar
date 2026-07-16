export type SignalStatus = "已确认" | "多源确认" | "待核实" | "有冲突";

export type SignalCategory =
  | "模型发布"
  | "开源生态"
  | "研究突破"
  | "公司动态"
  | "开发工具"
  | "政策监管"
  | "安全治理";

export type SignalSource = {
  name: string;
  type: string;
  url: string;
  authority: "一手" | "研究" | "社区";
};

export type Signal = {
  id: string;
  slug?: string;
  category: SignalCategory;
  title: string;
  summary: string;
  whyItMatters: string;
  newFacts: string[];
  recommendationReason: string;
  sources: SignalSource[];
  publishedAt: string;
  displayTime: string;
  trend: number;
  momentum: string;
  confidence: number;
  status: SignalStatus;
  region: string;
  tags: string[];
  evidenceCount: number;
  entities: string[];
  readMinutes: number;
  dataMode?: "demo" | "live";
  originalTitle?: string;
  originalSummary?: string;
  originalLanguage?: string;
  translationState?: "translated" | "original_zh" | "pending";
};

export const topicOptions = [
  "基础模型",
  "Agent",
  "AI Coding",
  "开源模型",
  "多模态",
  "AI 安全",
  "政策监管",
  "AI for Science",
  "企业落地",
  "推理优化",
  "数据基础设施",
  "机器人",
];

export const signals: Signal[] = [
  {
    id: "deepseek-r1",
    category: "开源生态",
    title: "DeepSeek-R1 发布，开放权重推理模型进入主流视野",
    summary:
      "DeepSeek 发布 R1 系列模型、技术说明及蒸馏版本，重点展示强化学习驱动的推理能力。",
    whyItMatters:
      "高性能推理出现更多开放获取路径，直接改变模型选型、蒸馏训练与推理成本的讨论。",
    newFacts: [
      "官方同步开放模型权重、技术报告与多种蒸馏版本。",
      "推理过程与强化学习训练方法成为开发者讨论焦点。",
      "社区快速出现本地部署、量化与推理服务适配。",
    ],
    recommendationReason: "你关注推理模型、开源生态与中国 AI 团队",
    sources: [
      {
        name: "DeepSeek",
        type: "官方仓库",
        url: "https://github.com/deepseek-ai/DeepSeek-R1",
        authority: "一手",
      },
      {
        name: "Hugging Face",
        type: "模型仓库",
        url: "https://huggingface.co/deepseek-ai",
        authority: "一手",
      },
      {
        name: "arXiv",
        type: "技术报告",
        url: "https://arxiv.org/abs/2501.12948",
        authority: "研究",
      },
    ],
    publishedAt: "2025-01-20T09:00:00Z",
    displayTime: "历史样例 · 2025-01-20",
    trend: 98,
    momentum: "+84%",
    confidence: 98,
    status: "已确认",
    region: "中国",
    tags: ["推理模型", "开源模型", "强化学习"],
    evidenceCount: 8,
    entities: ["DeepSeek", "R1", "Hugging Face"],
    readMinutes: 3,
  },
  {
    id: "mcp",
    category: "开发工具",
    title: "Model Context Protocol 开放：Agent 工具连接开始形成通用协议层",
    summary:
      "Anthropic 开放 MCP 规范与 SDK，为 AI 应用连接本地数据、服务和工具提供通用接口。",
    whyItMatters:
      "协议化能减少应用与数据源之间的重复集成，推动 Agent 工具生态形成更清晰的互操作层。",
    newFacts: [
      "规范覆盖 Host、Client 与 Server 三层角色。",
      "官方提供 TypeScript、Python 等 SDK 与参考实现。",
      "本地数据与远程工具可通过统一资源、提示和工具原语接入。",
    ],
    recommendationReason: "你持续阅读 Agent 基础设施与工具协议",
    sources: [
      {
        name: "Anthropic",
        type: "官方公告",
        url: "https://www.anthropic.com/news/model-context-protocol",
        authority: "一手",
      },
      {
        name: "MCP",
        type: "协议规范",
        url: "https://modelcontextprotocol.io/",
        authority: "一手",
      },
      {
        name: "GitHub",
        type: "代码仓库",
        url: "https://github.com/modelcontextprotocol",
        authority: "一手",
      },
    ],
    publishedAt: "2024-11-25T16:00:00Z",
    displayTime: "历史样例 · 2024-11-25",
    trend: 97,
    momentum: "+72%",
    confidence: 99,
    status: "已确认",
    region: "全球",
    tags: ["MCP", "Agent", "工具调用"],
    evidenceCount: 7,
    entities: ["Anthropic", "MCP", "Agent"],
    readMinutes: 4,
  },
  {
    id: "gpt-4o",
    category: "模型发布",
    title: "GPT-4o 发布：文本、视觉与语音进入统一实时交互",
    summary:
      "OpenAI 发布 GPT-4o，展示单一模型处理文本、图像与音频输入输出的能力，并降低 API 延迟与成本。",
    whyItMatters:
      "多模态交互从能力拼接走向统一模型，直接扩展语音助手、客服、教育和实时协作产品的边界。",
    newFacts: [
      "文本、视觉与音频由同一模型端到端处理。",
      "实时语音演示显著缩短轮次延迟。",
      "API 定价与吞吐策略同步调整。",
    ],
    recommendationReason: "你关注多模态模型与 AI 产品交互",
    sources: [
      {
        name: "OpenAI",
        type: "官方公告",
        url: "https://openai.com/index/hello-gpt-4o/",
        authority: "一手",
      },
      {
        name: "OpenAI Docs",
        type: "技术文档",
        url: "https://platform.openai.com/docs/models/gpt-4o",
        authority: "一手",
      },
      {
        name: "System Card",
        type: "安全报告",
        url: "https://openai.com/index/gpt-4o-system-card/",
        authority: "研究",
      },
    ],
    publishedAt: "2024-05-13T17:00:00Z",
    displayTime: "历史样例 · 2024-05-13",
    trend: 96,
    momentum: "+66%",
    confidence: 99,
    status: "已确认",
    region: "全球",
    tags: ["多模态", "实时语音", "API"],
    evidenceCount: 6,
    entities: ["OpenAI", "GPT-4o"],
    readMinutes: 3,
  },
  {
    id: "eu-ai-act",
    category: "政策监管",
    title: "欧盟《人工智能法案》正式生效，合规义务进入分阶段落地",
    summary:
      "法案围绕风险等级、通用 AI 模型、透明度与禁止用途设置分阶段义务。",
    whyItMatters:
      "面向欧洲市场的模型与应用团队，需要把风险分类、技术文档、透明度和供应链责任纳入产品设计。",
    newFacts: [
      "高风险系统、通用 AI 模型与禁止用途适用不同节奏。",
      "透明度、版权政策与模型评估成为关键合规任务。",
      "企业需要建立从模型供应商到应用方的证据链。",
    ],
    recommendationReason: "你关注全球 AI 监管与企业合规",
    sources: [
      {
        name: "European Commission",
        type: "监管机构",
        url: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
        authority: "一手",
      },
      {
        name: "EUR-Lex",
        type: "法律文本",
        url: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
        authority: "一手",
      },
    ],
    publishedAt: "2024-08-01T00:00:00Z",
    displayTime: "历史样例 · 2024-08-01",
    trend: 95,
    momentum: "+61%",
    confidence: 100,
    status: "已确认",
    region: "欧盟",
    tags: ["EU AI Act", "合规", "监管"],
    evidenceCount: 5,
    entities: ["European Commission", "EU AI Act"],
    readMinutes: 5,
  },
  {
    id: "llama-31",
    category: "开源生态",
    title: "Llama 3.1 405B 开放权重，前沿模型部署选择增加",
    summary:
      "Meta 发布 Llama 3.1 系列并提供 405B 参数版本、模型权重及配套工具生态。",
    whyItMatters:
      "企业获得更多自托管与定制路径，也让开放权重模型和闭源 API 的能力、成本、治理更可比较。",
    newFacts: [
      "系列覆盖多个参数规模与长上下文版本。",
      "官方同步发布参考系统、评估与安全工具。",
      "许可证允许广泛商用，但不等同于标准 OSI 开源许可。",
    ],
    recommendationReason: "你关注可私有部署的大模型",
    sources: [
      {
        name: "Meta AI",
        type: "官方公告",
        url: "https://ai.meta.com/blog/meta-llama-3-1/",
        authority: "一手",
      },
      {
        name: "Llama GitHub",
        type: "代码仓库",
        url: "https://github.com/meta-llama/llama-models",
        authority: "一手",
      },
      {
        name: "Hugging Face",
        type: "模型仓库",
        url: "https://huggingface.co/meta-llama",
        authority: "一手",
      },
    ],
    publishedAt: "2024-07-23T15:00:00Z",
    displayTime: "历史样例 · 2024-07-23",
    trend: 94,
    momentum: "+58%",
    confidence: 99,
    status: "多源确认",
    region: "全球",
    tags: ["开放权重", "Llama", "自托管"],
    evidenceCount: 7,
    entities: ["Meta", "Llama"],
    readMinutes: 4,
  },
  {
    id: "copilot-workspace",
    category: "开发工具",
    title: "GitHub Copilot Workspace 展示从需求到代码的 Agent 工作流",
    summary:
      "Copilot Workspace 尝试将 issue、方案规划、代码修改与验证串成一条可编辑的开发流程。",
    whyItMatters:
      "AI 编程从补全与聊天转向任务级执行，开发工具的竞争焦点转向上下文、计划与验证闭环。",
    newFacts: [
      "工作流从 GitHub issue 直接生成可编辑计划。",
      "开发者可在每个阶段检查和修改 Agent 产物。",
      "代码执行与验证被纳入统一工作区。",
    ],
    recommendationReason: "你经常阅读 AI Coding 与 Agent 工程内容",
    sources: [
      {
        name: "GitHub",
        type: "官方公告",
        url: "https://github.blog/news-insights/product-news/github-copilot-workspace/",
        authority: "一手",
      },
      {
        name: "GitHub Next",
        type: "产品研究",
        url: "https://githubnext.com/",
        authority: "研究",
      },
    ],
    publishedAt: "2024-04-29T15:00:00Z",
    displayTime: "历史样例 · 2024-04-29",
    trend: 93,
    momentum: "+55%",
    confidence: 98,
    status: "多源确认",
    region: "全球",
    tags: ["AI Coding", "Agent", "GitHub"],
    evidenceCount: 5,
    entities: ["GitHub", "Copilot"],
    readMinutes: 3,
  },
  {
    id: "claude-artifacts",
    category: "模型发布",
    title: "Claude 3.5 Sonnet 与 Artifacts：模型输出成为可操作工作区",
    summary:
      "Anthropic 推出 Claude 3.5 Sonnet 与 Artifacts，让代码、文档和可视化结果可在对话旁直接迭代。",
    whyItMatters:
      "AI 助手的竞争从回答质量扩展到成果交付界面，聊天产品开始向协作工作台演进。",
    newFacts: [
      "Artifacts 将结果从消息流分离为持久工作区。",
      "代码与可视化可直接预览并继续修改。",
      "模型能力与产品交互在同次发布中被共同强调。",
    ],
    recommendationReason: "你追踪 AI 原生工作流与开发者产品",
    sources: [
      {
        name: "Anthropic",
        type: "官方公告",
        url: "https://www.anthropic.com/news/claude-3-5-sonnet",
        authority: "一手",
      },
      {
        name: "Claude Docs",
        type: "产品文档",
        url: "https://docs.anthropic.com/",
        authority: "一手",
      },
    ],
    publishedAt: "2024-06-20T14:00:00Z",
    displayTime: "历史样例 · 2024-06-20",
    trend: 92,
    momentum: "+49%",
    confidence: 99,
    status: "已确认",
    region: "美国",
    tags: ["Claude", "Artifacts", "AI 工作台"],
    evidenceCount: 5,
    entities: ["Anthropic", "Claude"],
    readMinutes: 3,
  },
  {
    id: "alphafold-3",
    category: "研究突破",
    title: "AlphaFold 3 扩展到蛋白质、DNA、RNA 与小分子相互作用",
    summary:
      "Google DeepMind 与 Isomorphic Labs 公布 AlphaFold 3，用统一框架预测多类生物分子的结构与相互作用。",
    whyItMatters:
      "基础模型的价值进一步延伸到药物发现和生命科学，展示 AI 从内容生成走向科学工具的路径。",
    newFacts: [
      "预测范围从蛋白质结构扩展到多类分子相互作用。",
      "官方同步提供研究服务入口。",
      "同行评审论文披露模型设计与评估结果。",
    ],
    recommendationReason: "你关注 AI for Science 与产业落地",
    sources: [
      {
        name: "Google DeepMind",
        type: "研究公告",
        url: "https://deepmind.google/discover/blog/alphafold-3-predicts-the-structure-and-interactions-of-all-lifes-molecules/",
        authority: "一手",
      },
      {
        name: "Nature",
        type: "同行评审",
        url: "https://www.nature.com/articles/s41586-024-07487-w",
        authority: "研究",
      },
    ],
    publishedAt: "2024-05-08T15:00:00Z",
    displayTime: "历史样例 · 2024-05-08",
    trend: 91,
    momentum: "+43%",
    confidence: 99,
    status: "已确认",
    region: "英国 / 全球",
    tags: ["AI for Science", "生物医药", "研究"],
    evidenceCount: 4,
    entities: ["Google DeepMind", "AlphaFold"],
    readMinutes: 4,
  },
  {
    id: "nist-genai",
    category: "安全治理",
    title: "NIST 发布生成式 AI 风险管理框架配套指南",
    summary:
      "NIST AI 600-1 Generative AI Profile 为组织识别、评估和缓解生成式 AI 风险提供实践框架。",
    whyItMatters:
      "指南可直接映射到企业模型评估、内容溯源、红队测试、供应商管理与上线门禁。",
    newFacts: [
      "风险主题覆盖真实性、隐私、信息安全与滥用。",
      "建议与既有 AI RMF 治理流程对齐。",
      "为采购、开发和部署团队提供共同控制语言。",
    ],
    recommendationReason: "你关注模型安全、评估与工程治理",
    sources: [
      {
        name: "NIST",
        type: "政府标准",
        url: "https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence",
        authority: "一手",
      },
      {
        name: "NIST AI 600-1",
        type: "正式出版物",
        url: "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf",
        authority: "研究",
      },
    ],
    publishedAt: "2024-07-26T14:00:00Z",
    displayTime: "历史样例 · 2024-07-26",
    trend: 89,
    momentum: "+38%",
    confidence: 100,
    status: "已确认",
    region: "美国 / 全球参考",
    tags: ["AI 安全", "NIST", "风险管理"],
    evidenceCount: 4,
    entities: ["NIST", "AI RMF"],
    readMinutes: 5,
  },
  {
    id: "qwen2",
    category: "开源生态",
    title: "Qwen2 系列开放权重，多语言与不同参数规模同步覆盖",
    summary:
      "Qwen2 在多个参数规模上提供开放权重模型，并强化多语言与长文本能力。",
    whyItMatters:
      "更完整的模型尺寸梯度让团队可按设备、成本和延迟选择部署方案，也丰富中文场景供给。",
    newFacts: [
      "系列覆盖从轻量到大参数的多个版本。",
      "多语言与长上下文能力同步升级。",
      "官方提供模型仓库、代码与部署说明。",
    ],
    recommendationReason: "你关注中文模型与本地部署",
    sources: [
      {
        name: "Qwen",
        type: "官方博客",
        url: "https://qwenlm.github.io/blog/qwen2/",
        authority: "一手",
      },
      {
        name: "QwenLM",
        type: "代码仓库",
        url: "https://github.com/QwenLM/Qwen2",
        authority: "一手",
      },
      {
        name: "Hugging Face",
        type: "模型仓库",
        url: "https://huggingface.co/Qwen",
        authority: "一手",
      },
    ],
    publishedAt: "2024-06-07T08:00:00Z",
    displayTime: "历史样例 · 2024-06-07",
    trend: 88,
    momentum: "+34%",
    confidence: 98,
    status: "多源确认",
    region: "中国",
    tags: ["Qwen", "开放权重", "本地部署"],
    evidenceCount: 6,
    entities: ["Alibaba Cloud", "Qwen"],
    readMinutes: 3,
  },
];

export const sourceCoverage = [
  { label: "官方与研究", value: 72 },
  { label: "开发者生态", value: 58 },
  { label: "公司与产品", value: 46 },
  { label: "政策与安全", value: 34 },
];
