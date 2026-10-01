/**
 * Core domain types for SeqLens.
 *
 * These types are deliberately free of React and IndexedDB concerns so that the
 * algorithms in `src/bio` and the persistence layer in `src/storage` can be
 * tested and reused independently of the UI.
 */
export const APP_VERSION = '1.0.0';
