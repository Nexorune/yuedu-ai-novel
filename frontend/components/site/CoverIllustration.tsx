/** 本地矢量封面插画；固定配色与构图，不依赖图片下载或模型生成。 */
export function CoverIllustration({ variant }: { variant: number }) {
  return <svg viewBox="0 0 120 96" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
    {variant === 0 && <>
      <circle cx="86" cy="24" r="16" fill="#dfc690" />
      <path d="M-10 79 33 24 75 80 107 47 135 91V110H-10Z" fill="#8d9b7b" />
      <path d="m8 99 40-46 44 47 25-35 24 40" fill="#c4c6a3" />
      <path d="m33 24 9 17-9-5-8 5Z" fill="#eee4c5" />
      <path d="M0 87c25-8 45-1 66 5s39 6 60-1" stroke="#f4e5b5" strokeWidth="1" />
    </>}
    {variant === 1 && <>
      <circle cx="61" cy="39" r="30" stroke="#eddbad" strokeWidth=".7" />
      <circle cx="61" cy="39" r="23" stroke="#eddbad" strokeWidth=".5" />
      <path d="M36 20c0 14 25 15 25 25S36 56 36 71h50c0-15-25-16-25-26s25-11 25-25Z" fill="#e9d7ad" fillOpacity=".65" />
      <path d="M33 19h56M33 73h56M45 67l16-13 16 13" stroke="#f3e6c7" />
      <path d="M-5 84c32-10 44 8 70 0s40-4 60 0" stroke="#e4c994" />
    </>}
    {variant === 2 && <>
      <circle cx="87" cy="22" r="15" fill="#e2d7ae" />
      <path d="M0 69c25-24 47-25 69-4s33 12 61-2v40H0Z" fill="#91aaa6" />
      <path d="M0 84c20-17 46-21 68-7s39 11 62-4v30H0Z" fill="#c0c8b5" />
      <path d="M50 62c-21 9-11 16 9 19s18 10-8 20" stroke="#f6e8c6" strokeWidth="7" />
      <path d="m25 35 7-3 7 3m8-13 5-2 5 2" stroke="#d1d4bd" />
    </>}
    {variant === 3 && <>
      <circle cx="67" cy="34" r="25" fill="#f0d3ab" fillOpacity=".8" />
      <path d="M15 101c7-35 29-52 72-76M43 58C24 55 19 43 21 35c15 1 24 9 22 23Zm16-14c-5-17 1-31 11-35 7 12 3 25-11 35Zm-3 7c21-7 34-3 39 8-17 6-30 3-39-8ZM31 74c-16-3-26-13-26-25 17 0 27 8 26 25Z" fill="#684f4a" />
      <path d="M32 79c18-9 36-9 44 1-17 9-33 10-44-1Z" fill="#e5c2a2" />
      <path d="M15 101c7-35 29-52 72-76" stroke="#f1d8b9" strokeWidth="1.2" />
    </>}
    {variant === 4 && <>
      <circle cx="82" cy="28" r="18" fill="#d4c38f" />
      <path d="M5 96V55h15V39h20v57m5 0V63h17V50h18v46m6 0V35h16V20h11v76" fill="#b8b99a" />
      <path d="M10 63h5m10-15h9m-9 9h9m-9 9h9m-9 9h9m25-7h8m-8 9h8m32-35h8m-8 9h8m-8 9h8m-8 9h8" stroke="#eee2bb" strokeWidth="2" />
      <path d="M0 91c38-12 73-10 120-3v15H0Z" fill="#42594e" />
    </>}
    {variant === 5 && <>
      <circle cx="61" cy="44" r="27" stroke="#ddc7a4" strokeWidth=".7" />
      <ellipse cx="61" cy="44" rx="43" ry="13" transform="rotate(-32 61 44)" stroke="#d2b98f" />
      <circle cx="61" cy="44" r="18" fill="#c6af9f" />
      <path d="M61 26a18 18 0 0 0 0 36c-9-12-9-24 0-36Z" fill="#e6d4b5" />
      <circle cx="25" cy="64" r="4" fill="#e6d4b5" />
      <path d="m92 10 0 8m-4-4h8M19 23v6m-3-3h6m83 44v6m-3-3h6" stroke="#ddc7a4" />
      <path d="M13 89h94" stroke="#d2b98f" strokeWidth=".5" />
    </>}
  </svg>;
}
