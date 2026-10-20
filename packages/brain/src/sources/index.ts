// Ingestion sources: the verified reader (#88), the vault watcher and change planning (#93).
export {
  createSourceReader,
  isSafeRelativePath,
  isWithin,
  SourceScanError,
  UnsupportedSourceError,
  type OpenResult,
  type RefusalReason,
  type SourceFile,
  type SourceReader,
  type SourceReaderOptions,
} from './source-reader.ts';
export {
  planChanges,
  type ChangePlan,
  type SourceObservation,
  type PlanOptions,
} from './change-plan.ts';
export { observePaths, scanSource, type ScanResult } from './observe.ts';
export {
  createVaultWatcher,
  type FileSignature,
  type ResyncReason,
  type VaultWatcher,
  type VaultWatcherOptions,
  type WatchEventSource,
} from './vault-watcher.ts';
