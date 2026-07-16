import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Globe2,
  Layers3,
  Radar,
  ShieldCheck,
} from "@/app/icons";
import ShareButton from "./ShareButton";
import {
  eventCanonicalPath,
  eventCanonicalUrl,
  loadPublicSignal,
  safeSourceUrl,
} from "./data";
import { requestAbsoluteUrl } from "@/app/request-origin";
import styles from "./event.module.css";

type EventPageProps = {
  params: Promise<{ slug: string }>;
};

function formatPublishedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function confidenceLabel(confidence: number) {
  if (confidence >= 95) return "高置信";
  if (confidence >= 80) return "可信";
  return "待补充证据";
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { slug } = await params;
  const signal = await loadPublicSignal(slug);

  if (!signal) {
    return {
      title: "事件未找到",
      description: "该事件不存在、尚未公开，或已从雷达移除。",
      robots: { index: false, follow: false },
    };
  }

  const [canonical, socialImage] = await Promise.all([
    requestAbsoluteUrl(eventCanonicalPath(slug)),
    requestAbsoluteUrl("/og.png"),
  ]);
  return {
    title: signal.title,
    description: signal.summary,
    keywords: [...signal.tags, ...signal.entities, signal.category],
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      locale: "zh_CN",
      siteName: "PULSE/AI",
      title: signal.title,
      description: signal.summary,
      url: canonical,
      publishedTime: signal.publishedAt,
      tags: signal.tags,
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: `${signal.title} · PULSE/AI`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: signal.title,
      description: signal.summary,
      images: [socialImage],
    },
  };
}

export default async function EventPage({ params }: EventPageProps) {
  const { slug } = await params;
  const signal = await loadPublicSignal(slug);
  if (!signal) notFound();

  const canonical = eventCanonicalUrl(slug);
  const sources = signal.sources.flatMap((source) => {
    const url = safeSourceUrl(source.url);
    return url ? [{ ...source, url }] : [];
  });
  const isDemo = signal.dataMode !== "live";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: signal.title,
    description: signal.summary,
    datePublished: signal.publishedAt,
    dateModified: signal.publishedAt,
    inLanguage: "zh-CN",
    articleSection: signal.category,
    keywords: signal.tags.join(", "),
    ...(canonical.startsWith("https://") ? { mainEntityOfPage: canonical } : {}),
    publisher: { "@type": "Organization", name: "PULSE/AI" },
    citation: sources.map((source) => source.url),
  };

  return (
    <div className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />

      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="返回 PULSE/AI 雷达">
          <span className={styles.brandMark} aria-hidden="true">
            <i />
            <i />
          </span>
          <span>PULSE<span>/AI</span></span>
        </Link>
        <div className={styles.topbarMeta}>
          <span><i /> 全球信号在线</span>
          <span className={styles.topbarDivider} aria-hidden="true" />
          <span>公开事件档案</span>
        </div>
      </header>

      <main className={styles.shell}>
        <nav className={styles.breadcrumb} aria-label="面包屑">
          <Link href="/"><ArrowLeft aria-hidden="true" size={14} /> 返回个人雷达</Link>
          <span aria-hidden="true">/</span>
          <span>{signal.category}</span>
        </nav>

        <article>
          <header className={styles.hero}>
            <div className={styles.eyebrowRow}>
              <span className={styles.liveBadge} data-demo={isDemo ? "true" : "false"}>
                <i aria-hidden="true" />
                {isDemo ? "历史公开样例" : "LIVE · 真实采集"}
              </span>
              <span>{signal.category}</span>
              <span>{signal.region}</span>
            </div>

            <div className={styles.heroGrid}>
              <div>
                <h1>{signal.title}</h1>
                <p className={styles.lede}>{signal.summary}</p>
                <div className={styles.heroActions}>
                  <ShareButton title={signal.title} />
                  {sources[0] ? (
                    <a className={styles.primarySource} href={sources[0].url} target="_blank" rel="noreferrer">
                      查看首要信源 <ArrowUpRight aria-hidden="true" size={15} />
                    </a>
                  ) : null}
                </div>
              </div>

              <aside className={styles.scoreCard} aria-label="事件可信度">
                <div className={styles.scoreRing} style={{ "--score": `${signal.confidence * 3.6}deg` } as React.CSSProperties}>
                  <span>{signal.confidence}</span>
                  <small>/ 100</small>
                </div>
                <div>
                  <strong>{confidenceLabel(signal.confidence)}</strong>
                  <span>{signal.status} · {signal.evidenceCount} 条证据</span>
                </div>
              </aside>
            </div>

            <dl className={styles.metricStrip}>
              <div>
                <dt><Activity aria-hidden="true" size={14} /> 趋势分</dt>
                <dd>{signal.trend}<small>{signal.momentum}</small></dd>
              </div>
              <div>
                <dt><Layers3 aria-hidden="true" size={14} /> 证据矩阵</dt>
                <dd>{signal.evidenceCount}<small>个信号源</small></dd>
              </div>
              <div>
                <dt><Clock3 aria-hidden="true" size={14} /> 阅读时间</dt>
                <dd>{signal.readMinutes}<small>分钟</small></dd>
              </div>
              <div>
                <dt><Globe2 aria-hidden="true" size={14} /> 发布时间</dt>
                <dd className={styles.dateValue}>
                  <time dateTime={signal.publishedAt}>{formatPublishedAt(signal.publishedAt)}</time>
                </dd>
              </div>
            </dl>
          </header>

          {isDemo ? (
            <aside className={styles.demoNotice}>
              <Radar aria-hidden="true" size={17} />
              <div>
                <strong>这是历史公开样例，不是实时新闻</strong>
                <p>用于展示事件雷达的信息结构。日期、结论和来源均保留原始历史语境，请通过下方链接核验。</p>
              </div>
            </aside>
          ) : null}

          <div className={styles.contentGrid}>
            <div className={styles.storyColumn}>
              <section className={styles.panel}>
                <span className={styles.sectionIndex}>01 / IMPACT</span>
                <h2>为什么重要</h2>
                <p className={styles.impact}>{signal.whyItMatters}</p>
                <div className={styles.reason}>
                  <Radar aria-hidden="true" size={16} />
                  <div><span>雷达推荐理由</span><p>{signal.recommendationReason}</p></div>
                </div>
              </section>

              <section className={styles.panel}>
                <span className={styles.sectionIndex}>02 / NEW FACTS</span>
                <h2>这次新增了什么</h2>
                <ol className={styles.factList}>
                  {signal.newFacts.map((fact, index) => (
                    <li key={`${signal.id}-fact-${index}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{fact}</p>
                    </li>
                  ))}
                </ol>
              </section>

              {signal.originalTitle || signal.originalSummary ? (
                <section className={styles.panel}>
                  <span className={styles.sectionIndex}>03 / ORIGINAL</span>
                  <h2>原始信息</h2>
                  <div className={styles.originalBlock}>
                    <div>
                      <span>原始语言</span>
                      <strong>{signal.originalLanguage?.toUpperCase() ?? "未标注"}</strong>
                    </div>
                    <h3>{signal.originalTitle ?? signal.title}</h3>
                    {signal.originalSummary ? <p>{signal.originalSummary}</p> : null}
                    <small>{signal.translationState === "translated" ? "已自动翻译为中文 · 请以原文为准" : "原文内容"}</small>
                  </div>
                </section>
              ) : null}
            </div>

            <aside className={styles.evidenceColumn}>
              <section className={styles.evidencePanel}>
                <div className={styles.evidenceHead}>
                  <div>
                    <span className={styles.sectionIndex}>EVIDENCE</span>
                    <h2>来源证据</h2>
                  </div>
                  <ShieldCheck aria-label="已校验来源协议" size={19} />
                </div>
                <p className={styles.evidenceIntro}>所有结论均可回溯至原始页面；PULSE/AI 只提供摘要与分析，不镜像全文。</p>
                <div className={styles.sourceList}>
                  {sources.map((source, index) => (
                    <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                      <span className={styles.sourceNumber}>{String(index + 1).padStart(2, "0")}</span>
                      <span className={styles.sourceCopy}>
                        <strong>{source.name}</strong>
                        <small>{source.type} · {source.authority}</small>
                      </span>
                      <ArrowUpRight aria-hidden="true" size={15} />
                    </a>
                  ))}
                </div>
                <div className={styles.integrityNote}>
                  <CheckCircle2 aria-hidden="true" size={15} />
                  <span>证据可追溯率 <strong>100%</strong></span>
                </div>
              </section>

              <section className={styles.topicPanel}>
                <span className={styles.sectionIndex}>TOPICS</span>
                <h2>关联主题</h2>
                <div className={styles.tagList}>
                  {signal.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <div className={styles.entityList}>
                  <span>关键实体</span>
                  <p>{signal.entities.join(" · ")}</p>
                </div>
              </section>
            </aside>
          </div>
        </article>
      </main>

      <footer className={styles.footer}>
        <span>PULSE/AI · 全球 AI 信号，中文抵达</span>
        <span>页面永久链接 · 证据优先</span>
      </footer>
    </div>
  );
}
