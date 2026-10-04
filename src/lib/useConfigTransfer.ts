import { useCallback, useState } from 'react';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import {
  importMunicipalities,
  importStops,
  municipalityKey,
} from '../data/tripTicketsStore';
import { readTransferFile, transferFileName, writeTransferFile } from './transferFile';
import {
  parseTransferFile,
  transferCountLine,
  transferFileCounts,
  type TransferIssue,
} from './transferState';
import { transferScopeNote, type TransferRegistry } from './transferRegistry';

/**
 * The one owner of a Configuration screen's Import / Export state and flow.
 *
 * Both screens used to carry their own copy of this: the same four-field state
 * object, the same seven `setTransfer` shape-updates, and the same parse-then-
 * write orchestration, differing only in a registry name and a collection.
 * Fifty-three of ~a hundred lines were byte-identical. This hook is that one
 * copy — the screen now supplies a `TransferRegistry` and its live rows and
 * holds nothing.
 *
 * WHY A HOOK AND NOT A COMPONENT: the sheet already is a component
 * (`ConfigTransferSheet`), so the state lives here, next to the flow that
 * mutates it, rather than being threaded into the sheet as props the sheet
 * does not own. The screen's `Overlay` union stays for its OWN sheets.
 *
 * THE FLOW, and the order it runs in:
 *
 *   1. `readTransferFile` — a cancelled picker is not an error and changes
 *      nothing.
 *   2. `parseTransferFile` — pure, and run to COMPLETION before any write, so
 *      a malformed file costs one sentence and never a half-written registry.
 *   3. `importMunicipalities` (only when the registry owns them), then
 *      `importStops`. A failed municipality write STOPS here: continuing
 *      would write every stop with a null link, which is the one row the
 *      editor's own validator refuses.
 *
 * Data flows one way: rows in from the screen's store read, through the pure
 * parser, out to the store's writers. Nothing here holds a copy of the
 * registry — the screens repaint through `subscribeToTrips`, so there is no
 * second source of truth to fall out of step.
 */
type TransferUiState = {
  /** `null` when idle, otherwise which action is running. */
  busy: 'export' | 'import' | null;
  /** The write's one-line answer, or null before anything has happened. */
  notice: string | null;
  /** Everything the import refused, phrased by `transferState`. */
  issues: TransferIssue[];
  /** Where the last export landed, in full. */
  exportedName: string | null;
};

const INITIAL: TransferUiState = { busy: null, notice: null, issues: [], exportedName: null };

export function useConfigTransfer(input: {
  registry: TransferRegistry;
  /** This registry's live municipalities, and the live stops it exports. */
  municipalities: MunicipalityRowRecord[];
  stops: TerminalRowRecord[];
}) {
  const { registry, municipalities, stops } = input;
  const [transfer, setTransfer] = useState<TransferUiState>(INITIAL);

  /** Writes the device's whole registry to a dated JSON file. Offline. */
  const exportNow = useCallback(async () => {
    setTransfer((current) => ({ ...current, busy: 'export', issues: [] }));
    const file = registry.build(municipalities, stops, Date.now());
    const result = await writeTransferFile(transferFileName(registry.kind, new Date()), file);
    const counts = transferFileCounts(file);
    setTransfer((current) => ({
      ...current,
      busy: null,
      exportedName: result.kind === 'written' ? result.fileName : current.exportedName,
      notice:
        result.kind === 'written'
          ? `Exported ${transferCountLine(counts.municipalities, counts.stops, registry.kind)}.`
          : result.message,
    }));
  }, [registry, municipalities, stops]);

  /**
   * Reads a picked file, validates it, then writes what it accepts.
   *
   * `municipalityIdByName` is the one thing the two registries genuinely
   * disagree about, and the registry's flag decides it: a barangay file's
   * municipalities are CREATED here and their store-assigned ids come back;
   * a terminal file's are only looked up among what this device already
   * lists, so a stop naming an unknown town stays honestly `Not linked`
   * rather than minting a municipality this screen does not own.
   */
  const importNow = useCallback(async () => {
    const read = await readTransferFile();
    if (read.kind === 'cancelled') return;
    if (read.kind === 'failed') {
      setTransfer((current) => ({ ...current, busy: null, notice: read.message }));
      return;
    }
    setTransfer((current) => ({ ...current, busy: 'import', issues: [] }));

    const parsed = parseTransferFile({
      text: read.text,
      kind: registry.kind,
      existingMunicipalities: municipalities,
      // Only THIS registry's rows: a terminal is not a duplicate of a
      // barangay, and treating it as one would refuse half a legal file.
      existingTerminals: stops,
    });
    if (parsed.fatal !== null) {
      setTransfer((current) => ({ ...current, busy: null, notice: parsed.fatal }));
      return;
    }

    const municipalityIdByName = new Map<string, number>();
    if (registry.createsMunicipalities) {
      const written = await importMunicipalities(parsed.municipalities);
      if (written.failed) {
        // Stop rather than continue: the ids the stops need are exactly the
        // ones this failure cost, so continuing would write every stop
        // unlinked — the one row the Barangay Editor refuses to create.
        setTransfer((current) => ({
          ...current,
          busy: null,
          issues: parsed.issues,
          notice: 'Could not save the municipalities, so the stops were not imported.',
        }));
        return;
      }
      for (const row of parsed.municipalities) {
        const id = written.idsByName.get(municipalityKey(row.name, row.province));
        if (id !== undefined) municipalityIdByName.set(row.name.toLowerCase(), id);
      }
    } else {
      for (const row of municipalities) {
        municipalityIdByName.set(row.name.toLowerCase(), row.id);
      }
    }

    const writtenStops = await importStops(
      parsed.stops.map((stop) => ({
        // The composed column is rebuilt the way the editor composes it: the
        // place, then the municipality the file named.
        name:
          stop.municipalityName === null
            ? stop.name
            : `${stop.name}, ${stop.municipalityName}`,
        km_marker: stop.km_marker,
        is_active: stop.is_active,
        municipality_id:
          stop.municipalityName === null
            ? null
            : (municipalityIdByName.get(stop.municipalityName.toLowerCase()) ?? null),
      })),
      registry.storeKind,
    );

    const issues: TransferIssue[] = [
      ...parsed.issues,
      ...writtenStops.skipped.map((row) => ({
        index: 0,
        label: row.label,
        message: row.reason,
      })),
    ];
    setTransfer((current) => ({
      ...current,
      busy: null,
      issues,
      notice: writtenStops.failed
        ? 'That import could not be completed. Nothing was changed.'
        : `Imported ${writtenStops.inserted} ${registry.stopsNoun}.`,
    }));
  }, [registry, municipalities, stops]);

  /** The props the shared sheet needs, so neither screen repeats them. */
  const sheetProps = {
    sheetTitle: registry.sheetTitle,
    subtitle: registry.subtitle,
    stopsLabel: registry.stopsLabel,
    stopsSingular: registry.stopsSingular,
    note: transferScopeNote(registry),
    counts: { municipalities: municipalities.length, stops: stops.length },
    busy: transfer.busy,
    notice: transfer.notice,
    issues: transfer.issues,
    exportedName: transfer.exportedName,
    onExport: () => void exportNow(),
    onImport: () => void importNow(),
  };

  /**
   * The whole surface, and it is deliberately narrow: the sheet's props and
   * the trigger's line. The raw state and the two commands are NOT returned —
   * no caller wants them, and a wider return would invite a screen to render
   * the sheet's fields itself, which is the duplication this hook exists to
   * end. `sheetProps` already closes over all four state fields.
   */
  return { sheetProps, triggerLabel: registry.triggerLabel };
}
