type BrandIconProps = {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  bare?: boolean;
};

export function BrandIcon({
  src,
  alt,
  className = "",
  imageClassName = "",
  bare = false,
}: BrandIconProps) {
  const resolvedImageClassName =
    imageClassName ||
    (src.includes("google-favicon") || src.includes("slack-favicon") || src.includes("fathom-official")
      ? "h-8 w-8"
      : "h-7 w-7");

  return (
    <span
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.08] shadow-[0_10px_30px_rgba(0,0,0,0.2)] ${bare ? "border-transparent bg-transparent shadow-none" : ""} ${className}`}
    >
      <img
        src={src}
        alt={alt}
        className={`object-contain ${resolvedImageClassName}`}
        loading="lazy"
        draggable={false}
      />
    </span>
  );
}
