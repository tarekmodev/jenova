/**
 * `@jenova/ui/next` — the Next.js App Router entry.
 *
 * Kept out of the main entry so non-Next consumers (Storybook, Vitest)
 * never resolve `next/*` modules. Next apps mount `JenovaNextProvider`
 * in their root layout; everything else imports from `@jenova/ui`.
 */

export { JenovaNextProvider, type JenovaNextProviderProps } from "./JenovaNextProvider";
