"use client";

import { Check, Share2 } from "@/app/icons";
import { useEffect, useState } from "react";
import styles from "./event.module.css";

type ShareButtonProps = {
  title: string;
};

export default function ShareButton({ title }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title, url: window.location.href });
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCopied(false);
    }
  }

  return (
    <button className={styles.shareButton} type="button" onClick={share}>
      {copied ? <Check aria-hidden="true" size={15} /> : <Share2 aria-hidden="true" size={15} />}
      <span aria-live="polite">{copied ? "链接已复制" : "分享事件"}</span>
    </button>
  );
}
