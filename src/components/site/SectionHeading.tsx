import { Reveal } from "@/components/motion/Reveal";

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  intro?: string;
  align?: "left" | "center";
}

export function SectionHeading({ eyebrow, title, intro, align = "center" }: SectionHeadingProps) {
  const alignCls = align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <Reveal className={`max-w-2xl ${alignCls}`}>
      <p className="text-eyebrow">{eyebrow}</p>
      <h2 className="text-title mt-4 text-cream-50">{title}</h2>
      {intro && <p className="mt-5 leading-relaxed text-cream-400">{intro}</p>}
      <span
        aria-hidden
        className={`mt-6 block h-px w-16 bg-gradient-to-r from-brass-500 to-transparent ${
          align === "center" ? "mx-auto bg-gradient-to-r from-transparent via-brass-500 to-transparent" : ""
        }`}
      />
    </Reveal>
  );
}
