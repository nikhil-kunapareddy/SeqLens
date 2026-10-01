import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
/**
 * Merges class names, letting later Tailwind utilities win over earlier ones.
 *
 * `clsx` handles conditionals; `twMerge` resolves conflicts, so a component's
 * default `px-3` is genuinely overridden by a caller's `px-6` instead of both
 * landing in the class list and the outcome depending on stylesheet order.
 */
export const cn = (...inputs) => twMerge(clsx(inputs));
