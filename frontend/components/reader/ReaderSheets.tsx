"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Flag, Images, Lightbulb, LockKeyhole, Minus, Plus, X } from "lucide-react";
import type { Book, Chapter } from "@/lib/api";
import { READING_SIZES, READING_THEMES, ReadingSize, ReadingTheme } from "@/lib/prefs";
import { useDialog } from "./useDialog";
import { ChapterKnowledge } from "./ChapterKnowledge";
import styles from "./reader-drawer.module.css";

type TocProps = {
  open: boolean;
  onClose: () => void;
  book: Book;
  title: string;
  current: number;
  chapterNo: number | null;
  isEnding: boolean;
  disabled: boolean;
  onPick: (no: number) => void;
  canFinalize: boolean;
  onFinalize: () => void;
  chapter: Chapter | null;
  view: "chapters" | "knowledge";
  onView: (view: "chapters" | "knowledge") => void;
};

/** 目录抽屉：书的进度、章节列表、结局画廊、就此完结（二次确认）。 */
export function TocDrawer({ open, onClose, book, title, current, chapterNo, isEnding, disabled, onPick, canFinalize, onFinalize, chapter, view, onView }: TocProps) {
  const ref = useDialog<HTMLDivElement>(open, onClose, true);
  const [confirming, setConfirming] = useState(false);
  if (!open) return null;
  const count = Math.max(current, chapterNo ?? 0);
  const planned = book.planned_chapters;
  return (
    <div className="sheet-layer" onClick={onClose}>
      <div id="reader-library-panel" className={`toc ${styles.drawer}`} ref={ref} role="dialog" aria-modal="true" aria-label="目录与知识点" onClick={(event) => event.stopPropagation()}>
        <div className="toc-head">
          <div>
            <p className="toc-title">{title}</p>
            <p className="toc-sub">{book.genre} · 学习「{book.topic}」</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭侧栏"><X size={20} /></button>
        </div>
        <div className="toc-progress">
          <div className="toc-track"><span style={{ width: (book.status === "completed" ? 100 : Math.min(100, (current / Math.max(1, planned)) * 100)) + "%" }} /></div>
          <span>{book.status === "completed" ? "已完结" : `已通关 ${current} / ${planned} 章`}</span>
        </div>
        <div className={styles.switcher} role="group" aria-label="侧栏内容">
          <button type="button" aria-pressed={view === "chapters"} onClick={() => onView("chapters")}><BookOpen size={16} />章节目录</button>
          <button type="button" aria-pressed={view === "knowledge"} onClick={() => onView("knowledge")}><Lightbulb size={16} />知识点</button>
        </div>
        {view === "knowledge" ? <div className={styles.knowledgeBody}>{chapter ? <ChapterKnowledge key={`${book.id}:${chapter.chapter_no}`} bookId={book.id} chapter={chapter} compact onNavigate={onClose} /> : <p className="toc-empty">章节生成后，就能在这里查看知识点。</p>}</div> : <>
        <ol className="toc-list">
          {Array.from({ length: count }, (_, i) => i + 1).map((no) => {
            const here = no === chapterNo;
            return (
              <li key={no}>
                <button type="button" aria-current={here} disabled={here || disabled} onClick={() => { onPick(no); onClose(); }}>
                  <span>{here && isEnding ? "大结局" : `第 ${no} 章`}</span>
                  {no <= current || book.status === "completed" ? <Check size={15} aria-label="可阅读" /> : <LockKeyhole size={14} className="toc-lock" aria-label="待闯关" />}
                </button>
              </li>
            );
          })}
          {count === 0 && <li className="toc-empty">还没有章节</li>}
        </ol>
        <div className="toc-foot">
          <Link className="button button-light" href={`/book/${book.id}/gallery`}><Images size={16} />结局画廊</Link>
          {canFinalize && !confirming && (
            <button type="button" className="toc-finish" onClick={() => setConfirming(true)}><Flag size={15} />就此完结这本书</button>
          )}
          {canFinalize && confirming && (
            <div className="confirm-box" role="group" aria-label="确认完结">
              <strong>确定就此完结吗？</strong>
              <p>悦读会根据已读的 {current} 章写出大结局，完结后不能再续写新章节，生成会产生模型用量费用。</p>
              <div>
                <button type="button" className="button button-primary" onClick={() => { setConfirming(false); onClose(); onFinalize(); }}>确认完结</button>
                <button type="button" className="button button-light" onClick={() => setConfirming(false)}>再想想</button>
              </div>
            </div>
          )}
        </div>
        </>}
      </div>
    </div>
  );
}

type SettingsProps = {
  open: boolean;
  onClose: () => void;
  size: ReadingSize;
  onSize: (delta: 1 | -1) => void;
  theme: ReadingTheme;
  onTheme: (theme: ReadingTheme) => void;
};

/** 阅读设置：字号与背景（纸白 / 护眼 / 夜间），只保存在这台设备上。 */
export function SettingsSheet({ open, onClose, size, onSize, theme, onTheme }: SettingsProps) {
  const ref = useDialog<HTMLDivElement>(open, onClose);
  if (!open) return null;
  const sizeIndex = READING_SIZES.findIndex((item) => item.key === size);
  return (
    <div className="sheet-layer is-light" onClick={onClose}>
      <div className="settings" ref={ref} role="dialog" aria-modal="true" aria-label="阅读设置" onClick={(event) => event.stopPropagation()}>
        <div className="settings-row">
          <span>字号</span>
          <div className="size-stepper">
            <button type="button" onClick={() => onSize(-1)} disabled={sizeIndex <= 0} aria-label="字号调小"><Minus size={16} /></button>
            <b>{READING_SIZES[sizeIndex]?.label ?? "标准"}</b>
            <button type="button" onClick={() => onSize(1)} disabled={sizeIndex >= READING_SIZES.length - 1} aria-label="字号调大"><Plus size={16} /></button>
          </div>
        </div>
        <div className="settings-row">
          <span>背景</span>
          <div className="theme-picker" role="radiogroup" aria-label="阅读背景">
            {READING_THEMES.map((item) => (
              <button type="button" role="radio" aria-checked={theme === item.key} key={item.key} className={"theme-swatch theme-" + item.key} onClick={() => onTheme(item.key)}>
                <i aria-hidden="true" />{item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
