"use client";

import {
  Activity,
  ArrowUpRight,
  Bookmark,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Command,
  Copy,
  Database,
  ExternalLink,
  Eye,
  Filter,
  GithubLogo,
  Globe2,
  Inbox,
  Languages,
  LayoutDashboard,
  ListFilter,
  Menu,
  Newspaper,
  Radio,
  RefreshCw,
  Rss,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  X,
  Zap,
} from "@/app/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  signals as demoSignals,
  sourceCoverage,
  topicOptions,
} from "@/shared/signals";
import type { Signal, SignalCategory } from "@/shared/signals";
import { personalizedSignals, signalMatchesInterest } from "@/shared/ranking";

type View = "today" | "radar" | "tracking" | "brief" | "settings";
type Segment = "selected" | "rising" | "latest" | "confirmed";

const RISING_TREND_THRESHOLD = 50;
const REPOSITORY_URL = "https://github.com/summerchaserwwz/pulse-ai-radar";

const segmentOptions: Array<[Segment, string]> = [
  ["selected", "为你精选"],
  ["rising", "正在上升"],
  ["latest", "最新"],
  ["confirmed", "已确认"],
];

const defaultInterests = ["基础模型", "Agent", "AI Coding", "开源模型"];
const defaultTracked = ["mcp", "deepseek-r1", "copilot-workspace"];

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}> = [
  { id: "today", label: "今日", icon: LayoutDashboard, badge: "10" },
  { id: "radar", label: "雷达", icon: Radio },
  { id: "tracking", label: "追踪", icon: Target, badge: "3" },
  { id: "brief", label: "速报", icon: Newspaper },
];

const categories: Array<"全部" | SignalCategory> = [
  "全部",
  "模型发布",
  "开源生态",
  "公司动态",
  "开发工具",
  "研究突破",
  "政策监管",
  "安全治理",
];

const viewCopy: Record<View, { eyebrow: string; title: string; subtitle: string }> = {
  today: {
    eyebrow: "个人情报",
    title: "今日信号",
    subtitle: "只看与你相关、值得现在知道的 AI 变化。",
  },
  radar: {
    eyebrow: "全球信号雷达",
    title: "全球雷达",
    subtitle: "跨官方、研究与开发者生态，发现正在形成的趋势。",
  },
  tracking: {
    eyebrow: "实体追踪清单",
    title: "持续追踪",
    subtitle: "把事件变成时间线，关注真正发生变化的公司、模型与协议。",
  },
  brief: {
    eyebrow: "个性化速报",
    title: "五分钟速报",
    subtitle: "把今天最值得关注的变化压缩成一份可追溯摘要。",
  },
  settings: {
    eyebrow: "雷达控制台",
    title: "雷达设置",
    subtitle: "定义你关心什么、屏蔽什么，以及何时收到情报。",
  },
};

function statusClass(status: Signal["status"]) {
  if (status === "已确认") return "status-confirmed";
  if (status === "多源确认") return "status-multi";
  if (status === "有冲突") return "status-conflict";
  return "status-unverified";
}

function getInitials(name: string) {
  const latin = name.match(/[A-Za-z0-9]/g)?.join("") ?? "";
  return latin.slice(0, 2).toUpperCase() || name.slice(0, 1);
}

function getSignalCopy(signal: Signal, autoTranslate: boolean) {
  if (autoTranslate || !signal.originalTitle) {
    return { title: signal.title, summary: signal.summary, language: "中文" };
  }
  return {
    title: signal.originalTitle,
    summary: signal.originalSummary || signal.summary,
    language: signal.originalLanguage?.toUpperCase() || "原文",
  };
}

function signalMatchesTrackingInterest(signal: Signal, interest: string) {
  const needle = interest.trim().toLowerCase();
  if (!needle) return false;
  return (
    signalMatchesInterest(signal, interest) ||
    `${signal.originalTitle || ""} ${signal.originalSummary || ""} ${signal.entities.join(" ")}`
      .toLowerCase()
      .includes(needle)
  );
}

function Toggle({
  active,
  onClick,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      className="setting-row"
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
    >
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className={`toggle ${active ? "toggle-on" : ""}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function SignalCard({
  signal,
  autoTranslate,
  selected,
  bookmarked,
  tracked,
  onSelect,
  onBookmark,
  onTrack,
  onHide,
}: {
  signal: Signal;
  autoTranslate: boolean;
  selected: boolean;
  bookmarked: boolean;
  tracked: boolean;
  onSelect: (opener: HTMLButtonElement) => void;
  onBookmark: () => void;
  onTrack: () => void;
  onHide: () => void;
}) {
  const copy = getSignalCopy(signal, autoTranslate);

  return (
    <article className={`signal-card ${selected ? "signal-card-selected" : ""}`}>
      <button
        className="signal-card-open"
        type="button"
        onClick={(event) => onSelect(event.currentTarget)}
        aria-label={`查看事件：${copy.title}`}
        aria-describedby="event-detail-help"
      />
      <div className="signal-main">
        <div className="signal-meta-row">
          <span className={`status-pill ${statusClass(signal.status)}`}>
            <CheckCircle2 size={12} />
            {signal.status}
          </span>
          <span className="signal-category">{signal.category}</span>
          <span className="signal-time">
            <Clock3 size={12} />
            {signal.displayTime}
          </span>
          <span className={signal.dataMode === "live" ? "live-data-label" : "demo-label"}>
            {signal.dataMode === "live" ? "真实采集" : "演示数据"}
          </span>
        </div>

        <h2>{copy.title}</h2>
        <p className="signal-summary">{copy.summary}</p>

        <div className="impact-line">
          <Sparkles size={14} />
          <span>
            <strong>为什么重要</strong>
            {signal.whyItMatters}
          </span>
        </div>

        <div className="signal-footer">
          <div className="source-stack" aria-label={`${signal.sources.length} 个来源`}>
            {signal.sources.slice(0, 3).map((source) => (
              <span className="source-avatar" key={source.name} title={source.name}>
                {getInitials(source.name)}
              </span>
            ))}
          </div>
          <span className="evidence-count">{signal.evidenceCount} 条证据</span>
          <span className="recommendation-reason">
            <Zap size={12} />
            {signal.recommendationReason}
          </span>
        </div>
      </div>

      <div className="signal-side">
        <div className="trend-number">
          <span>{signal.momentum}</span>
          <small>趋势动量</small>
        </div>
        <div className="confidence-meter" aria-label={`置信度 ${signal.confidence}%`}>
          <span style={{ width: `${signal.confidence}%` }} />
        </div>
        <small className="confidence-copy">置信度 {signal.confidence}%</small>
        <div className="signal-actions">
          <button
            className={tracked ? "action-active" : ""}
            type="button"
            aria-label={tracked ? "取消追踪" : "追踪事件"}
            title={tracked ? "取消追踪" : "追踪"}
            onClick={(event) => {
              event.stopPropagation();
              onTrack();
            }}
          >
            <Target size={16} />
          </button>
          <button
            className={bookmarked ? "action-active" : ""}
            type="button"
            aria-label={bookmarked ? "取消收藏" : "收藏事件"}
            title={bookmarked ? "取消收藏" : "收藏"}
            onClick={(event) => {
              event.stopPropagation();
              onBookmark();
            }}
          >
            <Bookmark size={16} weight={bookmarked ? "fill" : "regular"} />
          </button>
          <button
            type="button"
            aria-label="减少此类内容"
            title="少看此类"
            onClick={(event) => {
              event.stopPropagation();
              onHide();
            }}
          >
            <Eye size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

function DetailPanel({
  signal,
  autoTranslate,
  tracked,
  bookmarked,
  onClose,
  onTrack,
  onBookmark,
  modal = false,
}: {
  signal: Signal;
  autoTranslate: boolean;
  tracked: boolean;
  bookmarked: boolean;
  onClose: () => void;
  onTrack: () => void;
  onBookmark: () => void;
  modal?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const copy = getSignalCopy(signal, autoTranslate);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [signal.id]);

  return (
    <aside
      ref={panelRef}
      className="context-panel detail-panel"
      role="dialog"
      aria-modal={modal}
      aria-labelledby="event-detail-title"
      aria-describedby="event-detail-summary"
      onKeyDown={(event) => {
        if (!modal || event.key !== "Tab") return;
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="context-header">
        <div>
          <span className="section-kicker">事件情报</span>
          <h3 id="event-detail-title">事件详情</h3>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭事件详情">
          <X size={17} />
        </button>
      </div>

      <div className="detail-scroll">
        <div className="detail-status-row">
          <span className={`status-pill ${statusClass(signal.status)}`}>
            <CheckCircle2 size={12} />
            {signal.status}
          </span>
          <span>{signal.category}</span>
          <span>{signal.region}</span>
        </div>

        <h2 className="detail-title">{copy.title}</h2>
        <p id="event-detail-summary" className="detail-summary">{copy.summary}</p>

        <section className="detail-section original-section">
          <div className="detail-section-title">
            <Languages size={15} />
            <h4>{autoTranslate ? "原文" : "中文译文"}</h4>
          </div>
          {autoTranslate && signal.originalTitle ? (
            <div className="original-copy">
              <span>{signal.originalLanguage?.toUpperCase() || "原文"}</span>
              <strong>{signal.originalTitle}</strong>
              {signal.originalSummary ? <p>{signal.originalSummary}</p> : null}
            </div>
          ) : !autoTranslate && signal.originalTitle ? (
            <div className="original-copy translated-copy">
              <span>ZH · 自动翻译</span>
              <strong>{signal.title}</strong>
              <p>{signal.summary}</p>
            </div>
          ) : (
            <p className="recommendation-copy">
              该历史公开样例未保存原文副本，当前继续显示中文编辑摘要；可通过下方一手来源核对原文。
            </p>
          )}
        </section>

        <div className="detail-callout">
          <Sparkles size={16} />
          <div>
            <span>为什么值得关注</span>
            <p>{signal.whyItMatters}</p>
          </div>
        </div>

        <section className="detail-section">
          <div className="detail-section-title">
            <CheckCheck size={15} />
            <h4>新增事实</h4>
          </div>
          <ol className="fact-list">
            {signal.newFacts.map((fact, index) => (
              <li key={fact}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{fact}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="detail-section">
          <div className="detail-section-title">
            <Database size={15} />
            <h4>来源矩阵</h4>
            <span className="detail-count">{signal.evidenceCount} 条证据</span>
          </div>
          <div className="source-list">
            {signal.sources.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                <span className="source-avatar">{getInitials(source.name)}</span>
                <span>
                  <strong>{source.name}</strong>
                  <small>
                    {source.type} · {source.authority}来源
                  </small>
                </span>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-section-title">
            <Bot size={15} />
            <h4>推荐依据</h4>
          </div>
          <p className="recommendation-copy">{signal.recommendationReason}</p>
          <div className="tag-row">
            {signal.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </section>
      </div>

      <div className="detail-actions">
        <a
          className="secondary-button"
          href={`/events/${encodeURIComponent(signal.slug ?? signal.id)}`}
          aria-label="打开可分享的公开事件页"
        >
          <ExternalLink size={15} /> 公开页
        </a>
        <button className="secondary-button" type="button" onClick={onBookmark}>
          <Bookmark size={16} weight={bookmarked ? "fill" : "regular"} />
          {bookmarked ? "已收藏" : "收藏"}
        </button>
        <button className="primary-button" type="button" onClick={onTrack}>
          <Target size={16} />
          {tracked ? "正在追踪" : "追踪事件"}
        </button>
      </div>
    </aside>
  );
}

function PulsePanel({
  interests,
  signals,
  rssPath,
  dataMode,
  signalCount,
  sourceCount,
  onEditInterests,
  onCopyRss,
}: {
  interests: string[];
  signals: Signal[];
  rssPath: string | null;
  dataMode: "demo" | "live";
  signalCount: number;
  sourceCount: number;
  onEditInterests: () => void;
  onCopyRss: () => void;
}) {
  const demoSpark = [32, 44, 38, 58, 52, 71, 64, 82, 76, 92, 84, 98];
  const averageTrend = signals.length
    ? Math.round(signals.reduce((total, signal) => total + signal.trend, 0) / signals.length)
    : 0;
  const liveSpark = signals
    .slice(0, 12)
    .reverse()
    .map((signal) => Math.max(18, Math.min(100, signal.trend)));
  const spark = dataMode === "live" && liveSpark.length > 1 ? liveSpark : demoSpark;
  const interestCounts = interests.map((interest) => ({
    interest,
    count: signals.filter((signal) => signalMatchesTrackingInterest(signal, interest)).length,
  }));
  const sourceTotal = signals.reduce((total, signal) => total + signal.sources.length, 0);
  const liveCoverage = (["一手", "研究", "社区"] as const).map((authority) => {
    const count = signals.reduce(
      (total, signal) => total + signal.sources.filter((source) => source.authority === authority).length,
      0,
    );
    return {
      label: `${authority}来源`,
      value: sourceTotal ? Math.round((count / sourceTotal) * 100) : 0,
    };
  });
  const coverage = dataMode === "live" ? liveCoverage : sourceCoverage;

  return (
    <aside className="context-panel pulse-panel" aria-label="今日脉搏">
      <div className="context-header">
        <div>
          <span className="section-kicker">你的脉搏</span>
          <h3>今日脉搏</h3>
        </div>
        <span className="live-indicator">
          <span /> {dataMode === "live" ? "真实采集" : "演示"}
        </span>
      </div>

      <section className="pulse-chart-card">
        <div className="pulse-chart-head">
          <span>{dataMode === "live" ? "当前平均趋势分" : "历史样例趋势分"}</span>
          <strong>{averageTrend}<small>/100</small></strong>
        </div>
        <div className="spark-bars" aria-label="信号强度趋势图">
          {spark.map((height, index) => (
            <span
              key={`${height}-${index}`}
              style={{ height: `${height}%` }}
              className={index >= spark.length - 3 ? "spark-active" : ""}
            />
          ))}
        </div>
        <div className="chart-axis">
          <span>00:00</span>
          <span>现在</span>
        </div>
      </section>

      <section className="context-section">
        <div className="context-section-head">
          <h4>你的关注</h4>
          <button type="button" onClick={onEditInterests}>
            编辑
          </button>
        </div>
        <div className="interest-cloud">
          {interestCounts.map(({ interest, count }) => (
            <span key={interest} className={count > 0 ? "interest-hot" : ""}>
              {interest}
              <small>{count} 条</small>
            </span>
          ))}
        </div>
      </section>

      <section className="context-section">
        <div className="context-section-head">
          <h4>来源覆盖</h4>
          <span>
            {dataMode === "live"
              ? `${signalCount} 个事件 · ${sourceTotal} 条证据源`
              : "历史样例构成 · 示意"}
          </span>
        </div>
        <div className="coverage-list">
          {coverage.map((item) => (
            <div key={item.label}>
              <div>
                <span>{item.label}</span>
                <small>{item.value}%</small>
              </div>
              <div className="coverage-track">
                <span style={{ width: `${item.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="delivery-card">
        <div className="delivery-icon">
          <Rss size={17} />
        </div>
        <div>
          <span>私有 RSS</span>
          <strong>{rssPath ? "已连接" : "尚未生成"}</strong>
          <small>{sourceCount} 个来源，随兴趣设置自动排序</small>
        </div>
        <button
          type="button"
          onClick={onCopyRss}
          aria-label={rssPath ? "复制 RSS 地址" : "生成 RSS 地址"}
          title={rssPath ? "复制 RSS" : "生成 RSS"}
        >
          {rssPath ? <Copy size={15} /> : <ArrowUpRight size={15} />}
        </button>
      </section>

      <div className={`pipeline-strip ${dataMode === "live" ? "pipeline-live" : ""}`}>
        <span><Check size={11} /> 采集</span>
        <ChevronRight size={12} />
        <span><Check size={11} /> 翻译</span>
        <ChevronRight size={12} />
        <span><Check size={11} /> 聚类</span>
        <ChevronRight size={12} />
        <span><Check size={11} /> 排序</span>
      </div>
    </aside>
  );
}

export default function RadarApp() {
  const [activeView, setActiveView] = useState<View>("today");
  const [segment, setSegment] = useState<Segment>("selected");
  const [category, setCategory] = useState<(typeof categories)[number]>("全部");
  const [query, setQuery] = useState("");
  const [interests, setInterests] = useState(defaultInterests);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [tracked, setTracked] = useState(defaultTracked);
  const [hidden, setHidden] = useState<string[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [syncedAt, setSyncedAt] = useState("刚刚");
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  const [denseMode, setDenseMode] = useState(true);
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [rssPath, setRssPath] = useState<string | null>(null);
  const [radarSignals, setRadarSignals] = useState<Signal[]>([]);
  const [dataMode, setDataMode] = useState<"demo" | "live">("demo");
  const [radarError, setRadarError] = useState(false);
  const [nextRadarCursor, setNextRadarCursor] = useState<string | null>(null);
  const [hasMoreSignals, setHasMoreSignals] = useState(false);
  const [totalSignalCount, setTotalSignalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [customInterest, setCustomInterest] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const customInterestRef = useRef<HTMLInputElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const mobileNavWasOpenRef = useRef(false);
  const detailIsModal = isMobile || activeView === "brief" || activeView === "settings";

  const openDetail = useCallback((id: string, opener: HTMLElement) => {
    detailTriggerRef.current = opener;
    opener.blur();
    setSelectedSignalId(id);
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedSignalId(null);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus({ preventScroll: true }));
  }, []);

  const loadRadar = useCallback(async (
    signal?: AbortSignal,
    options: { cursor?: string | null; append?: boolean } = {},
  ) => {
    const params = new URLSearchParams({ limit: "24" });
    if (options.cursor) params.set("cursor", options.cursor);
    const response = await fetch(`/api/radar?${params}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("雷达数据服务不可用");
    const data = (await response.json()) as {
      signals?: Signal[];
      mode?: "demo" | "live";
      page?: {
        nextCursor?: string | null;
        hasMore?: boolean;
        total?: number;
      };
    };
    const nextSignals = Array.isArray(data.signals) ? data.signals : [];
    setRadarSignals((current) => {
      if (!options.append) return nextSignals;
      const merged = new Map(current.map((item) => [item.id, item]));
      for (const item of nextSignals) merged.set(item.id, item);
      return Array.from(merged.values());
    });
    setNextRadarCursor(data.page?.nextCursor ?? null);
    setHasMoreSignals(Boolean(data.page?.hasMore));
    setTotalSignalCount(Math.max(0, Number(data.page?.total ?? nextSignals.length)));
    setDataMode(data.mode === "live" && (nextSignals.length > 0 || options.append) ? "live" : "demo");
    setRadarError(false);
    return nextSignals.length;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadRadar(controller.signal).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataMode("demo");
        setRadarError(true);
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadRadar]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/preferences", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("偏好服务不可用");
        const data = (await response.json()) as {
          profile: {
            interests: string[];
            bookmarks: string[];
            tracked: string[];
            hidden: string[];
            autoTranslate: boolean;
            verifiedOnly: boolean;
            denseMode: boolean;
            instantAlerts: boolean;
            rssPath: string | null;
          };
        };
        setInterests(data.profile.interests);
        setBookmarks(data.profile.bookmarks);
        setTracked(data.profile.tracked);
        setHidden(data.profile.hidden);
        setAutoTranslate(data.profile.autoTranslate);
        setVerifiedOnly(data.profile.verifiedOnly);
        setDenseMode(data.profile.denseMode);
        setRssPath(data.profile.rssPath);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProfileError(true);
      } finally {
        if (!controller.signal.aborted) setProfileReady(true);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!profileReady || profileError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/preferences", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            interests,
            bookmarks,
            tracked,
            hidden,
            autoTranslate,
            verifiedOnly,
            denseMode,
            instantAlerts: false,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("偏好保存失败");
        setSyncedAt("刚刚");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProfileError(true);
        setSyncedAt("偏好未同步");
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    autoTranslate,
    bookmarks,
    denseMode,
    hidden,
    interests,
    profileError,
    profileReady,
    tracked,
    verifiedOnly,
  ]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        closeDetail();
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [closeDetail]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let focusTimer = 0;
    if (mobileNavOpen) {
      focusTimer = window.setTimeout(() => mobileCloseRef.current?.focus(), 0);
    } else if (mobileNavWasOpenRef.current) {
      window.requestAnimationFrame(() => mobileMenuRef.current?.focus({ preventScroll: true }));
    }
    mobileNavWasOpenRef.current = mobileNavOpen;
    return () => window.clearTimeout(focusTimer);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen && !(selectedSignalId && detailIsModal)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [detailIsModal, mobileNavOpen, selectedSignalId]);

  const allSignals = radarSignals.length > 0 ? radarSignals : demoSignals;

  const filteredSignals = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    let next = allSignals;

    if (normalizedQuery) {
      next = next.filter((signal) =>
        [
          signal.title,
          signal.summary,
          signal.originalTitle || "",
          signal.originalSummary || "",
          signal.category,
          signal.region,
          ...signal.tags,
          ...signal.entities,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      );
    }

    if (category !== "全部") {
      next = next.filter((signal) => signal.category === category);
    }

    if (segment === "rising") {
      next = next.filter((signal) => signal.trend >= RISING_TREND_THRESHOLD);
    }

    if (segment === "selected") {
      return personalizedSignals(next, {
        interests,
        hidden,
        verifiedOnly,
      });
    }

    next = next
      .filter((signal) => !hidden.includes(signal.id))
      .filter(
        (signal) =>
          !(verifiedOnly || segment === "confirmed") ||
          signal.status === "已确认" ||
          signal.status === "多源确认",
      );
    return [...next].sort((a, b) =>
      segment === "latest"
        ? Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
        : b.trend - a.trend,
    );
  }, [allSignals, category, hidden, interests, query, segment, verifiedOnly]);

  const briefSignals = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const ranked = personalizedSignals(allSignals, {
      interests,
      hidden,
      verifiedOnly: true,
    });
    return ranked
      .filter((signal) =>
        !normalizedQuery ||
        `${signal.title} ${signal.summary} ${signal.originalTitle || ""} ${signal.originalSummary || ""} ${signal.category} ${signal.tags.join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 5);
  }, [allSignals, hidden, interests, query]);

  const trackedSignals = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return allSignals
      .filter(
        (signal) =>
          (tracked.includes(signal.id) || interests.some((interest) => signalMatchesTrackingInterest(signal, interest))) &&
          !hidden.includes(signal.id) &&
          (!normalizedQuery ||
            `${signal.title} ${signal.summary} ${signal.originalTitle || ""} ${signal.entities.join(" ")}`
              .toLowerCase()
              .includes(normalizedQuery)),
      )
      .sort((a, b) => {
        const explicitDifference = Number(tracked.includes(b.id)) - Number(tracked.includes(a.id));
        return explicitDifference || b.trend - a.trend;
      });
  }, [allSignals, hidden, interests, query, tracked]);

  const trackedEntities = useMemo(() => {
    const trackedSignalEntities = allSignals
      .filter((signal) => tracked.includes(signal.id))
      .flatMap((signal) => signal.entities);
    const names = Array.from(new Set([...interests, ...trackedSignalEntities]));

    return names.map((name, index) => {
      const matches = allSignals
        .filter(
          (signal) =>
            signal.entities.some((entity) => entity.toLowerCase() === name.toLowerCase()) ||
            signalMatchesTrackingInterest(signal, name),
        )
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
      const categories = Array.from(new Set(matches.map((signal) => signal.category))).slice(0, 3);
      const isSignalEntity = trackedSignalEntities.some(
        (entity) => entity.toLowerCase() === name.toLowerCase(),
      );
      return {
        name,
        type: isSignalEntity ? "事件实体" : "关注项",
        meta: categories.length ? categories.join(" · ") : "等待匹配信号",
        change: matches[0]
          ? getSignalCopy(matches[0], autoTranslate).title
          : "尚未发现匹配事件，采集后会自动补充时间线。",
        count: matches.length,
        tone: matches.length >= 3 ? "green" : matches.length > 0 ? "blue" : index % 2 ? "amber" : "blue",
        hasLiveMatch: dataMode === "live" && matches.some((signal) => signal.dataMode === "live"),
      };
    });
  }, [allSignals, autoTranslate, dataMode, interests, tracked]);

  const selectedSignal = allSignals.find((signal) => signal.id === selectedSignalId) ?? null;
  const relevantCount = allSignals.filter((signal) =>
    interests.some((interest) => signalMatchesInterest(signal, interest)),
  ).length;
  const risingCount = allSignals.filter(
    (signal) => signal.trend >= RISING_TREND_THRESHOLD,
  ).length;
  const confirmedCount = allSignals.filter(
    (signal) => signal.status === "已确认" || signal.status === "多源确认",
  ).length;
  const sourceCount = new Set(allSignals.flatMap((signal) => signal.sources.map((source) => source.name))).size;
  const aiCodingCount = allSignals.filter((signal) => signalMatchesTrackingInterest(signal, "AI Coding")).length;
  const briefFocus = Array.from(new Set(briefSignals.map((signal) => signal.category)))
    .slice(0, 3)
    .join("、");
  const today = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  const showToast = (message: string) => setToast(message);

  const toggleBookmark = (id: string) => {
    setBookmarks((current) => {
      const exists = current.includes(id);
      showToast(exists ? "已取消收藏" : "已加入收藏");
      return exists ? current.filter((item) => item !== id) : [...current, id];
    });
  };

  const toggleTrack = (id: string) => {
    setTracked((current) => {
      const exists = current.includes(id);
      showToast(exists ? "已停止追踪" : "已加入持续追踪");
      return exists ? current.filter((item) => item !== id) : [...current, id];
    });
  };

  const hideSignal = (id: string) => {
    setHidden((current) => (current.includes(id) ? current : [...current, id]));
    if (selectedSignalId === id) setSelectedSignalId(null);
    showToast("已减少此类内容，可在设置中恢复");
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const count = await loadRadar();
      setSyncedAt("刚刚");
      showToast(
        count > 0
          ? `雷达已刷新，载入 ${count} 个真实事件`
          : "雷达已刷新；生产数据尚未接入，继续显示历史样例",
      );
    } catch {
      showToast("刷新失败，已保留当前可追溯内容");
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadMore = async () => {
    if (!nextRadarCursor || loadingMore || !hasMoreSignals) return;
    setLoadingMore(true);
    try {
      const count = await loadRadar(undefined, { cursor: nextRadarCursor, append: true });
      showToast(count > 0 ? `继续载入 ${count} 个事件` : "已加载全部事件");
    } catch {
      showToast("更多事件加载失败，请稍后重试");
    } finally {
      setLoadingMore(false);
    }
  };

  const createRss = async () => {
    try {
      const response = await fetch("/api/rss", {
        method: "POST",
      });
      const data = (await response.json()) as {
        rss?: { rssPath: string; message: string };
        error?: string;
      };
      if (!response.ok || !data.rss) {
        throw new Error(data.error ?? "RSS 地址生成失败");
      }
      setRssPath(data.rss.rssPath);
      return data.rss.rssPath;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "RSS 地址生成失败");
      return null;
    }
  };

  const copyRss = async () => {
    const selectedPath = rssPath ?? (await createRss());
    if (!selectedPath) return;
    const url = `${window.location.origin}${selectedPath}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(rssPath ? "私有 RSS 地址已复制" : "私有 RSS 已生成并复制");
    } catch {
      showToast(url);
    }
  };

  const shareApp = async () => {
    const shareData = {
      title: "PULSE/AI · 个人 AI 情报雷达",
      text: "全球 AI 信号，中文摘要，证据优先。",
      url: window.location.origin,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(shareData.url);
      showToast("网站地址已复制");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showToast("分享失败，请复制浏览器地址");
    }
  };

  const toggleInterest = (interest: string) => {
    setInterests((current) => {
      if (current.includes(interest)) {
        if (current.length === 1) {
          showToast("至少保留一个关注主题");
          return current;
        }
        return current.filter((item) => item !== interest);
      }
      return [...current, interest];
    });
  };

  const addCustomInterest = () => {
    const value = customInterest.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!value) {
      showToast("请输入公司、人物、主题或关键词");
      return;
    }
    if (interests.includes(value)) {
      showToast("该关注项已存在");
      return;
    }
    setInterests((current) => [...current, value]);
    setCustomInterest("");
    showToast(`已关注 ${value}`);
  };

  const openInterestEditor = () => {
    changeView("settings");
    window.setTimeout(() => customInterestRef.current?.focus(), 0);
  };

  const changeView = (view: View) => {
    if (mobileNavOpen && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setActiveView(view);
    setMobileNavOpen(false);
    setSelectedSignalId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderSignalList = () => (
    <>
      <div className={`signal-list ${denseMode ? "signal-list-dense" : ""}`}>
        {filteredSignals.length ? (
          filteredSignals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              autoTranslate={autoTranslate}
              selected={selectedSignalId === signal.id}
              bookmarked={bookmarks.includes(signal.id)}
              tracked={tracked.includes(signal.id)}
              onSelect={(opener) => openDetail(signal.id, opener)}
              onBookmark={() => toggleBookmark(signal.id)}
              onTrack={() => toggleTrack(signal.id)}
              onHide={() => hideSignal(signal.id)}
            />
          ))
        ) : (
          <div className="empty-state">
            <Inbox size={24} />
            <h3>没有匹配的信号</h3>
            <p>调整关键词、分类或确认级别后再试。</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("全部");
                setVerifiedOnly(false);
              }}
            >
              清除筛选
            </button>
          </div>
        )}
      </div>
      {dataMode === "live" && radarSignals.length > 0 ? (
        <div className="feed-progress" aria-live="polite">
          <div>
            <span>
              已载入 <strong>{radarSignals.length}</strong> / {totalSignalCount || radarSignals.length} 个可读事件
            </span>
            <div className="feed-progress-track" aria-hidden="true">
              <span
                style={{
                  width: `${Math.min(100, (radarSignals.length / Math.max(1, totalSignalCount)) * 100)}%`,
                }}
              />
            </div>
          </div>
          {hasMoreSignals ? (
            <button
              className="secondary-button"
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              <RefreshCw size={14} className={loadingMore ? "spin" : ""} />
              {loadingMore ? "载入中" : "继续加载"}
            </button>
          ) : (
            <span className="feed-complete"><Check size={13} /> 已加载全部</span>
          )}
        </div>
      ) : null}
    </>
  );

  const renderFeedToolbar = () => (
    <div className="feed-toolbar">
      <div className="segment-control" role="tablist" aria-label="雷达排序">
        {segmentOptions.map(([id, label], index) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={segment === id}
            tabIndex={segment === id ? 0 : -1}
            className={segment === id ? "segment-active" : ""}
            onClick={() => setSegment(id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const delta = event.key === "ArrowRight" ? 1 : -1;
              const nextIndex = (index + delta + segmentOptions.length) % segmentOptions.length;
              setSegment(segmentOptions[nextIndex][0]);
              const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
              tabs?.[nextIndex]?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar-actions">
        <div className="category-select-wrap">
          <Filter size={14} />
          <select
            aria-label="按分类筛选"
            value={category}
            onChange={(event) => setCategory(event.target.value as (typeof categories)[number])}
          >
            {categories.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
        <button
          type="button"
          className={`icon-text-button ${denseMode ? "button-selected" : ""}`}
          aria-pressed={denseMode}
          onClick={() => setDenseMode((value) => !value)}
        >
          <ListFilter size={15} />
          紧凑
        </button>
      </div>
    </div>
  );

  const renderToday = () => (
    <>
      <div className={`demo-notice ${dataMode === "live" ? "live-notice" : ""}`}>
        <ShieldCheck size={15} />
        <span>
          {dataMode === "live"
            ? "当前展示自动采集并通过质量门禁的真实信号；每条事件均保留原始证据。"
            : radarError
              ? "实时接口暂时不可用，当前保留可追溯的历史公开样例。"
              : "当前展示可追溯的历史公开样例。实时采集、翻译、聚类与排序 Worker 已就绪。"}
        </span>
        <button type="button" onClick={() => changeView("settings")}>查看接入状态</button>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-card-accent">
          <div><Zap size={16} /><span>与你相关</span></div>
          <strong>{relevantCount}</strong>
          <small>命中当前兴趣</small>
        </div>
        <div className="stat-card">
          <div><TrendingUp size={16} /><span>正在上升</span></div>
          <strong>{risingCount}</strong>
          <small>趋势分达到 {RISING_TREND_THRESHOLD} 以上</small>
        </div>
        <div className="stat-card">
          <div><CheckCircle2 size={16} /><span>一手确认</span></div>
          <strong>{confirmedCount}</strong>
          <small>拥有官方或研究来源</small>
        </div>
        <div className="stat-card">
          <div><Globe2 size={16} /><span>全球来源</span></div>
          <strong>{sourceCount}</strong>
          <small>{dataMode === "live" ? "原始来源可追溯" : "当前为历史公开样例"}</small>
        </div>
      </div>

      <div className="section-heading-row">
        <div>
          <span className="section-kicker">自上次访问以来</span>
          <h2>值得现在知道</h2>
        </div>
        <span className="section-count">
          当前显示 {filteredSignals.length} · 全库 {totalSignalCount || allSignals.length}
        </span>
      </div>
      {renderFeedToolbar()}
      {renderSignalList()}
    </>
  );

  const renderRadar = () => (
    <>
      <div className="radar-overview-card">
        <div className="radar-overview-copy">
          <span className="section-kicker">
            {dataMode === "live" ? "真实信号场" : "演示信号场"}
          </span>
          <h2>完整历史，持续积累</h2>
          <p>
            页面按游标逐页读取 D1 中的可见事件，不再截断在前 100 条；继续加载即可回看完整历史。
          </p>
        </div>
        <div className="radar-overview-metrics" aria-label="雷达数据概览">
          <div><span>可读事件</span><strong>{totalSignalCount || allSignals.length}</strong><small>持续积累</small></div>
          <div><span>当前载入</span><strong>{allSignals.length}</strong><small>按需分页</small></div>
          <div><span>信息来源</span><strong>{sourceCount}</strong><small>原文可追溯</small></div>
          <div><span>采集周期</span><strong>5m</strong><small>Cloudflare Cron</small></div>
        </div>
      </div>

      <div className="category-chip-row" aria-label="快速分类筛选">
        {categories.map((item) => (
          <button
            type="button"
            key={item}
            className={category === item ? "chip-active" : ""}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {renderFeedToolbar()}
      {renderSignalList()}
    </>
  );

  const renderTracking = () => (
    <>
      <div className="tracking-toolbar">
        <div>
          <span>{trackedEntities.length} 个关注实体 · {tracked.length} 个手动追踪事件</span>
          <small>
            {dataMode === "live"
              ? "实体卡与关联数量来自当前真实信号"
              : "当前使用历史公开样例匹配，等待生产数据接入"}
          </small>
        </div>
        <button className="primary-button" type="button" onClick={openInterestEditor}>
          <Target size={16} /> 添加追踪
        </button>
      </div>

      <div className="entity-grid">
        {trackedEntities.map((entity) => (
          <article className="entity-card" key={entity.name}>
            <div className="entity-head">
              <span className={`entity-mark entity-${entity.tone}`}>{getInitials(entity.name)}</span>
              <span>
                <strong>{entity.name}</strong>
                <small>{entity.type} · {entity.meta}</small>
              </span>
              <button
                type="button"
                aria-label={`${interests.includes(entity.name) ? "取消关注" : "关注"} ${entity.name}`}
                aria-pressed={interests.includes(entity.name)}
                title={interests.includes(entity.name) ? "从关注项移除" : "加入关注项"}
                onClick={() => toggleInterest(entity.name)}
              >
                {interests.includes(entity.name) ? <X size={17} /> : <Target size={17} />}
              </button>
            </div>
            <div className="entity-change">
              <span className="live-indicator">
                <span /> {entity.hasLiveMatch ? "真实事件更新" : dataMode === "live" ? "等待真实事件" : "历史样例匹配"}
              </span>
              <p>{entity.change}</p>
            </div>
            <div className="entity-footer">
              <span>{entity.count} 个关联事件</span>
              <button type="button" onClick={() => setQuery(entity.name)}>
                查看时间线 <ChevronRight size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="section-heading-row tracking-events-heading">
        <div>
          <span className="section-kicker">关注项关联 + 手动追踪</span>
          <h2>你的事件时间线</h2>
        </div>
        <span className="section-count">{trackedSignals.length} 个</span>
      </div>
      <div className="signal-list signal-list-dense">
        {trackedSignals.length > 0 ? (
          trackedSignals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              autoTranslate={autoTranslate}
              selected={selectedSignalId === signal.id}
              bookmarked={bookmarks.includes(signal.id)}
              tracked={tracked.includes(signal.id)}
              onSelect={(opener) => openDetail(signal.id, opener)}
              onBookmark={() => toggleBookmark(signal.id)}
              onTrack={() => toggleTrack(signal.id)}
              onHide={() => hideSignal(signal.id)}
            />
          ))
        ) : (
          <div className="empty-state">
            <Target size={24} />
            <h3>暂无匹配的追踪事件</h3>
            <p>从雷达中追踪事件，或添加公司、人物和关键词。</p>
            <button className="secondary-button" type="button" onClick={openInterestEditor}>
              添加关注项
            </button>
          </div>
        )}
      </div>
    </>
  );

  const renderBrief = () => (
    <div className="brief-layout">
      <section className="brief-document">
        <div className="brief-document-head">
          <div>
            <span className="section-kicker">PULSE 速报 · {today}</span>
            <h2>你的 AI 五分钟速报</h2>
            <p>基于 {interests.slice(0, 4).join("、")} 生成</p>
          </div>
          <span className="brief-status">
            <Check size={12} /> {dataMode === "live" ? "已生成" : "演示简报"}
          </span>
        </div>

        <div className="brief-summary-band">
          <Sparkles size={17} />
          <p>
            当前排序最值得关注的方向是 <strong>{briefFocus || "你的关注主题"}</strong>。
            以下事件均按你的兴趣、趋势强度和来源证据自动排序；历史样例不会冒充实时信息。
          </p>
        </div>

        <ol className="brief-items">
          {briefSignals.map((signal, index) => {
            const copy = getSignalCopy(signal, autoTranslate);
            return (
            <li key={signal.id}>
              <span className="brief-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <div className="brief-item-meta">
                  <span>{signal.category}</span>
                  <span>{signal.status}</span>
                  <span>{signal.readMinutes} 分钟</span>
                </div>
                <h3>{copy.title}</h3>
                <p>{signal.whyItMatters}</p>
                <button
                  type="button"
                  aria-describedby="event-detail-help"
                  onClick={(event) => openDetail(signal.id, event.currentTarget)}
                >
                  查看 {signal.evidenceCount} 条证据 <ArrowUpRight size={13} />
                </button>
              </div>
            </li>
            );
          })}
        </ol>

        <div className="brief-footer-note">
          <ShieldCheck size={15} />
          <p>所有结论均保留来源链接；低置信度和冲突证据不会进入默认速报。</p>
        </div>
      </section>

      <aside className="brief-settings-card rss-control-card">
        <div className="brief-settings-head">
          <Rss size={18} />
          <div>
            <strong>实时 RSS</strong>
            <small>跟随你的兴趣与质量门槛</small>
          </div>
          <span className="live-indicator">
            <span /> {rssPath ? "已启用" : "未生成"}
          </span>
        </div>
        <div className="rss-block rss-primary-block">
          <div>
            <Rss size={17} />
            <span><strong>私有订阅地址</strong><small>令牌只显示在你的设备中</small></span>
          </div>
          <code>{rssPath ? "/rss.xml?token=••••••••" : "尚未生成私有令牌"}</code>
          <button className="primary-button full-button" type="button" onClick={copyRss}>
            {rssPath ? <Copy size={15} /> : <ArrowUpRight size={15} />}
            {rssPath ? "复制地址" : "生成并复制"}
          </button>
        </div>

        <div className="brief-divider" />

        <div className="brief-source-rules">
          <h4>订阅规则</h4>
          <div><span>更新频率</span><strong>最长 5 分钟</strong></div>
          <div><span>显示语言</span><strong>{autoTranslate ? "优先中文" : "优先原文"}</strong></div>
          <div><span>质量门槛</span><strong>{verifiedOnly ? "仅已确认" : "高信号优先"}</strong></div>
        </div>
      </aside>
    </div>
  );

  const renderSettings = () => (
    <div className="settings-layout">
      <section className="settings-card settings-card-wide">
        <div className="settings-card-head">
          <div className="settings-icon"><SlidersHorizontal size={18} /></div>
          <div>
            <h2>兴趣模型</h2>
            <p>你的选择会同时影响网站与私有 RSS。</p>
          </div>
          <span>{interests.length} 个已选</span>
        </div>
        <form
          className="custom-interest-form"
          onSubmit={(event) => {
            event.preventDefault();
            addCustomInterest();
          }}
        >
          <label htmlFor="custom-interest">添加公司、人物、主题或关键词</label>
          <div>
            <Search size={15} />
            <input
              ref={customInterestRef}
              id="custom-interest"
              value={customInterest}
              onChange={(event) => setCustomInterest(event.target.value)}
              placeholder="例如：Anthropic、Andrej Karpathy、推理成本"
              maxLength={80}
            />
            <button className="primary-button" type="submit">添加关注</button>
          </div>
        </form>
        <div className="topic-grid">
          {Array.from(new Set([...topicOptions, ...interests])).map((interest) => {
            const active = interests.includes(interest);
            return (
              <button
                type="button"
                key={interest}
                className={active ? "topic-active" : ""}
                aria-pressed={active}
                onClick={() => toggleInterest(interest)}
              >
                <span>{active ? <Check size={14} /> : <CircleDot size={14} />}</span>
                {interest}
              </button>
            );
          })}
        </div>
        {hidden.length > 0 ? (
          <div className="hidden-preferences">
            <span>
              <strong>已减少 {hidden.length} 条内容</strong>
              <small>这些事件不会进入网站或 RSS 的默认排序。</small>
            </span>
            <button className="secondary-button" type="button" onClick={() => setHidden([])}>
              恢复全部
            </button>
          </div>
        ) : null}
      </section>

      <section className="settings-card">
        <div className="settings-card-head compact-head">
          <div className="settings-icon"><Languages size={18} /></div>
          <div><h2>语言与质量</h2><p>控制翻译和证据门槛。</p></div>
        </div>
        <div className="setting-list">
          <Toggle
            active={autoTranslate}
            onClick={() => setAutoTranslate((value) => !value)}
            label={autoTranslate ? "优先显示中文译文" : "优先显示原文"}
            description="切换会实际改变事件标题与摘要；原文、译文和来源始终保留"
          />
          <Toggle
            active={verifiedOnly}
            onClick={() => setVerifiedOnly((value) => !value)}
            label="优先显示已确认"
            description="未证实内容仍可在雷达中手动查看"
          />
          <Toggle
            active={denseMode}
            onClick={() => setDenseMode((value) => !value)}
            label="紧凑信息密度"
            description="一次查看更多事件和证据状态"
          />
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head compact-head">
          <div className="settings-icon"><Rss size={18} /></div>
          <div><h2>订阅与刷新</h2><p>网站和 RSS 共用一套排序规则。</p></div>
        </div>
        <div className="setting-list">
          <div className="setting-static-row">
            <span>
              <strong>雷达采集周期</strong>
              <small>Cloudflare 后台独立运行，不依赖浏览器</small>
            </span>
            <span className="fixed-setting-value">最长 5 分钟</span>
          </div>
          <div className="setting-static-row">
            <span>
              <strong>页面数据</strong>
              <small>打开页面或点击刷新时同步，历史可持续加载</small>
            </span>
            <span className="fixed-setting-value">游标分页</span>
          </div>
          <div className="setting-static-row">
            <span><strong>速报生成</strong><small>按兴趣、趋势和证据自动重排</small></span>
            <span className="fixed-setting-value">实时</span>
          </div>
          <div className="setting-static-row">
            <span><strong>私有 RSS</strong><small>令牌可随时轮换</small></span>
            <button type="button" onClick={copyRss}>
              {rssPath ? "复制地址" : "生成地址"} {rssPath ? <Copy size={14} /> : <ArrowUpRight size={14} />}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card settings-card-wide integration-card">
        <div className="settings-card-head">
          <div className="settings-icon"><Database size={18} /></div>
          <div>
            <h2>自动化数据面</h2>
            <p>独立 Cloudflare Worker 负责全球采集、翻译、聚类与质量排序。</p>
          </div>
          <span className="environment-badge">
            {dataMode === "live" ? "生产数据已接入" : "演示环境"}
          </span>
        </div>
        <div className="integration-grid">
          {[
            ["来源采集", "Cron + Queues", dataMode === "live" ? "运行中" : "待生产绑定"],
            ["中文翻译", "Workers AI", dataMode === "live" ? "运行中" : "待生产绑定"],
            ["事件聚类", "D1 + Vectorize", dataMode === "live" ? "运行中" : "待生产绑定"],
            ["质量门禁", "Evidence Gate", dataMode === "live" ? "运行中" : "待生产绑定"],
            ["原始快照", "R2", dataMode === "live" ? "运行中" : "待生产绑定"],
            ["私有订阅", "RSS Token", rssPath ? "令牌已生成" : "等待生成"],
          ].map(([label, stack, state]) => (
            <div key={label}>
              <span className={state === "运行中" || state === "令牌已生成" ? "integration-ok" : "integration-wait"}>
                {state === "运行中" || state === "令牌已生成" ? <Check size={12} /> : <Clock3 size={12} />}
              </span>
              <span><strong>{label}</strong><small>{stack}</small></span>
              <em>{state}</em>
            </div>
          ))}
        </div>
        <div className="integration-note">
          <ShieldCheck size={15} />
          <p>密钥只保存在 Cloudflare Secret；采集文本按不可信输入处理，不镜像原文全文。</p>
        </div>
      </section>
    </div>
  );

  const renderView = () => {
    if (activeView === "today") return renderToday();
    if (activeView === "radar") return renderRadar();
    if (activeView === "tracking") return renderTracking();
    if (activeView === "brief") return renderBrief();
    return renderSettings();
  };

  return (
    <div className="app-shell">
      <p id="event-detail-help" className="sr-only">
        选择事件会打开“事件详情”；其中包含中文译文或原文、推荐依据、新增事实和可追溯来源，按 Escape 可关闭。
      </p>
      <aside
        id="primary-sidebar"
        className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}
        role={isMobile ? "dialog" : undefined}
        aria-label={isMobile ? "移动导航菜单" : undefined}
        aria-modal={isMobile && mobileNavOpen ? true : undefined}
        aria-hidden={
          selectedSignal && detailIsModal
            ? true
            : isMobile && !mobileNavOpen
              ? true
              : undefined
        }
        onKeyDown={(event) => {
          if (mobileNavOpen && event.key === "Escape") {
            event.preventDefault();
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            setMobileNavOpen(false);
            return;
          }
          if (!mobileNavOpen || event.key !== "Tab") return;
          const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true"><i /><i /></span>
          <span className="brand-name">PULSE<span>/AI</span></span>
          <span
            className={`brand-live ${dataMode === "live" ? "brand-live-active" : ""}`}
            title={dataMode === "live" ? "真实雷达在线" : "历史样例模式"}
          />
          <button
            ref={mobileCloseRef}
            className="mobile-close"
            type="button"
            onClick={(event) => {
              event.currentTarget.blur();
              setMobileNavOpen(false);
            }}
            aria-label="关闭菜单"
          >
            <X size={18} />
          </button>
        </div>

        <div className="workspace-switcher">
          <span className="workspace-icon"><Globe2 size={16} /></span>
          <span>
            <strong>全球 AI 信号</strong>
            <small>{autoTranslate ? "优先中文译文" : "优先显示原文"}</small>
          </span>
          <ChevronDown size={14} />
        </div>

        <nav className="main-nav" aria-label="主导航">
          <span className="nav-label">工作台</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                className={activeView === item.id ? "nav-active" : ""}
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={() => changeView(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.badge ? (
                  <small>{item.id === "today" ? allSignals.length : trackedEntities.length}</small>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-section">
          <span className="nav-label">快捷视图</span>
          <button type="button" onClick={() => { setSegment("rising"); changeView("radar"); }}>
            <TrendingUp size={16} /><span>正在上升</span><small>{risingCount}</small>
          </button>
          <button type="button" onClick={() => { setSegment("confirmed"); changeView("radar"); }}>
            <ShieldCheck size={16} /><span>一手确认</span><small>{confirmedCount}</small>
          </button>
          <button type="button" onClick={() => { setQuery("AI Coding"); changeView("radar"); }}>
            <Bot size={16} /><span>AI Coding</span><small>{aiCodingCount}</small>
          </button>
        </div>

        <div className="sidebar-bottom">
          <div className="source-health">
            <div>
              <span><Activity size={14} /> 数据管线</span>
              <small>{dataMode === "live" ? "运行中" : "待接入"}</small>
            </div>
            <div className="health-track"><span style={{ width: dataMode === "live" ? "100%" : "24%" }} /></div>
            <p>
              {dataMode === "live"
                ? "真实采集、翻译与证据聚类已接入。"
                : "自动化闭环代码已就绪，等待生产资源与密钥。"}
            </p>
          </div>
          <button
            type="button"
            className={activeView === "settings" ? "nav-active" : ""}
            aria-current={activeView === "settings" ? "page" : undefined}
            onClick={() => changeView("settings")}
          >
            <Settings2 size={17} /><span>设置</span>
          </button>
          <a
            className="account-row repository-link"
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="查看 PULSE/AI GitHub 公开仓库"
          >
            <span className="avatar"><GithubLogo size={17} weight="fill" /></span>
            <span><strong>公开仓库</strong><small>GitHub 查看源码</small></span>
            <ArrowUpRight size={15} />
          </a>
        </div>
      </aside>

      {mobileNavOpen ? <button className="sidebar-backdrop" type="button" onClick={() => setMobileNavOpen(false)} aria-label="关闭菜单" /> : null}

      <div
        className="app-main"
        aria-hidden={mobileNavOpen || (selectedSignal && detailIsModal) ? true : undefined}
      >
        <header className="topbar">
          <button
            ref={mobileMenuRef}
            className="mobile-menu"
            type="button"
            onClick={(event) => {
              event.currentTarget.blur();
              setMobileNavOpen(true);
            }}
            aria-label="打开菜单"
            aria-expanded={mobileNavOpen}
            aria-controls="primary-sidebar"
          >
            <Menu size={19} />
          </button>
          <div className="mobile-brand"><span className="brand-mark"><i /><i /></span>PULSE<span>/AI</span></div>
          <label className="global-search">
            <Search size={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索事件、公司、人物或关键词"
              aria-label="全局搜索"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="清除搜索">
                <X size={14} />
              </button>
            ) : (
              <kbd><Command size={11} />K</kbd>
            )}
          </label>
          <div className="topbar-status">
            <span>
              <CircleDot size={13} /> {dataMode === "live"
                ? `${radarSignals.length} / ${totalSignalCount || radarSignals.length} 个真实事件`
                : `${allSignals.length} 个演示样例`}
            </span>
            <span className="topbar-divider" />
            <span>{profileError ? "偏好同步异常" : `同步于 ${syncedAt}`}</span>
          </div>
          <button className="topbar-icon" type="button" onClick={shareApp} aria-label="分享 PULSE/AI" title="分享网站">
            <Share2 size={17} />
          </button>
          <button className="topbar-avatar" type="button" onClick={() => changeView("settings")} aria-label="打开个人设置">P</button>
        </header>

        <main className="content-shell">
          <div className="page-head">
            <div>
              <span className="page-eyebrow">{viewCopy[activeView].eyebrow}</span>
              <div className="page-title-row">
                <h1>{viewCopy[activeView].title}</h1>
                {activeView === "today" ? <span>{today}</span> : null}
              </div>
              <p>{viewCopy[activeView].subtitle}</p>
            </div>
            <div className="page-actions">
              <button className="secondary-button" type="button" onClick={() => changeView("settings")}>
                <SlidersHorizontal size={15} /> 编辑兴趣
              </button>
              <button className="primary-button" type="button" onClick={handleRefresh} disabled={refreshing}>
                <RefreshCw size={15} className={refreshing ? "spin" : ""} />
                {refreshing ? "同步中" : "刷新雷达"}
              </button>
            </div>
          </div>

          <div className={`content-grid ${activeView === "brief" || activeView === "settings" ? "content-grid-wide" : ""}`}>
            <div className="primary-column">{renderView()}</div>
            {activeView !== "brief" && activeView !== "settings" ? (
              selectedSignal && !detailIsModal ? (
                <DetailPanel
                  signal={selectedSignal}
                  autoTranslate={autoTranslate}
                  tracked={tracked.includes(selectedSignal.id)}
                  bookmarked={bookmarks.includes(selectedSignal.id)}
                  onClose={closeDetail}
                  onTrack={() => toggleTrack(selectedSignal.id)}
                  onBookmark={() => toggleBookmark(selectedSignal.id)}
                />
              ) : (
                <PulsePanel
                  interests={interests}
                  signals={allSignals}
                  rssPath={rssPath}
                  dataMode={dataMode}
                  signalCount={allSignals.length}
                  sourceCount={sourceCount}
                  onEditInterests={() => changeView("settings")}
                  onCopyRss={copyRss}
                />
              )
          ) : null}
          </div>
          {profileError ? (
            <div className="profile-warning" role="status">
              <ShieldCheck size={14} /> 偏好服务暂时不可用，本次操作尚未同步到 D1。
            </div>
          ) : null}
        </main>
      </div>

      {selectedSignal && detailIsModal ? (
        <div
          className="detail-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetail();
          }}
        >
          <DetailPanel
            signal={selectedSignal}
            autoTranslate={autoTranslate}
            tracked={tracked.includes(selectedSignal.id)}
            bookmarked={bookmarks.includes(selectedSignal.id)}
            onClose={closeDetail}
            onTrack={() => toggleTrack(selectedSignal.id)}
            onBookmark={() => toggleBookmark(selectedSignal.id)}
            modal
          />
        </div>
      ) : null}

      <nav
        className="mobile-bottom-nav"
        aria-label="移动端导航"
        aria-hidden={mobileNavOpen || (selectedSignal && detailIsModal) ? true : undefined}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              className={activeView === item.id ? "mobile-nav-active" : ""}
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => changeView(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {toast ? (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}
