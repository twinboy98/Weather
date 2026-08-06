type WeatherGlyphProps = {
  condition?: string;
  size?: "xs" | "sm" | "md" | "lg";
};

const sizeClass = {
  xs: "h-7 w-7 text-base",
  sm: "h-9 w-9 text-xl",
  md: "h-12 w-12 text-2xl",
  lg: "h-20 w-20 text-4xl"
};

export function WeatherGlyph({ condition = "", size = "md" }: WeatherGlyphProps) {
  const normalized = condition.toLowerCase();
  let glyph = "☀️";
  let label = "맑음";
  let tone = "from-amber-100 to-orange-200";

  if (/thunder|lightning|번개|뇌우/.test(normalized)) {
    glyph = "⛈️";
    label = "뇌우";
    tone = "from-violet-200 to-slate-300";
  } else if (/snow|sleet|눈|진눈깨비/.test(normalized)) {
    glyph = "🌨️";
    label = "눈";
    tone = "from-sky-100 to-blue-200";
  } else if (/rain|drizzle|shower|비|소나기/.test(normalized)) {
    glyph = "🌧️";
    label = "비";
    tone = "from-blue-100 to-indigo-200";
  } else if (/fog|mist|안개/.test(normalized)) {
    glyph = "🌫️";
    label = "안개";
    tone = "from-slate-100 to-slate-300";
  } else if (/cloud|overcast|흐림|구름/.test(normalized)) {
    glyph = "☁️";
    label = "흐림";
    tone = "from-slate-100 to-blue-100";
  }

  return (
    <span
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-[1.1rem] bg-gradient-to-br shadow-sm ${tone} ${sizeClass[size]}`}
      role="img"
    >
      {glyph}
    </span>
  );
}
