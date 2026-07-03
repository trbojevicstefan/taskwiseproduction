type BrandIconProps = {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
};

export function BrandIcon({ src, alt, className = "", imageClassName = "" }: BrandIconProps) {
  return (
    <span
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.08] shadow-[0_10px_30px_rgba(0,0,0,0.2)] ${className}`}
    >
      <img
        src={src}
        alt={alt}
        className={`h-7 w-7 object-contain ${imageClassName}`}
        loading="lazy"
        draggable={false}
      />
    </span>
  );
}
