import { Lightbulb } from "lucide-react";
import type { KnowledgePoint } from "@/lib/api";
import { knowledgeTitle } from "@/lib/chapter";

/** 本章收获：每个知识点一张卡片，核心知识在前。 */
export function KnowledgeCards({ points, heading, note }: { points: KnowledgePoint[]; heading: string; note?: string }) {
  if (points.length === 0) return null;
  const ordered = [...points].sort((a, b) => Number(b.role === "core") - Number(a.role === "core"));
  return (
    <section className="kcards" aria-label={heading}>
      <div className="kcards-head">
        <span className="kcards-icon"><Lightbulb size={18} /></span>
        <div>
          <h3>{heading}</h3>
          {note && <p>{note}</p>}
        </div>
      </div>
      <div className="kcards-list">
        {ordered.map((point, i) => (
          <article className={"kcard" + (point.role === "core" ? " is-core" : "")} key={i} style={{ animationDelay: i * 90 + "ms" }}>
            <span className="kcard-tag">{point.role === "core" ? "核心知识" : "拓展知识"}</span>
            <h4>{knowledgeTitle(point.point)}</h4>
            <p>{point.point}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
