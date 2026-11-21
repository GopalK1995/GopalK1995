// Five stars, filled to the rating. The accessible name is the label; the glyphs are decoration.
import { Star } from "lucide-react";

export function StarRating({ rating, label }: { rating: number | null; label: string }) {
  return (
    <span className="inline-flex items-center" role="img" aria-label={label} data-rating={rating ?? ""}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} aria-hidden className={`size-3.5 ${rating !== null && i <= rating ? "fill-current text-warn" : "text-ink-3"}`} />)}
    </span>
  );
}
