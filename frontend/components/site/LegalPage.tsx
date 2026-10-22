"use client";

import { useAccount } from "@/lib/account";
import { SiteFooter, SiteHeader } from "@/components/site/SiteHeader";

/** 用户协议 / 隐私政策的公共版式；任何人都能看，不要求登录。 */
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { heading: string; body: string[] }[] }) {
  const { user, ready } = useAccount();
  return (
    <div className="site-shell">
      <SiteHeader user={user} ready={ready} />
      <main className="legal-main">
        <h1>{title}</h1>
        <p className="legal-updated">更新日期：{updated}</p>
        {sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((text) => <p key={text}>{text}</p>)}
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
