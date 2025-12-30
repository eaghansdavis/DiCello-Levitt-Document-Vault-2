'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Data models
interface DocumentItem {
  id: string;
  fileName: string;
  source: string;
  custodian: string;
  docType: string;
  dateRange: string;
  size: number;
  status: 'Not processed' | 'In queue' | 'Completed' | 'Error';
  include: boolean;
  createdAt: string;
}

interface ColumnItem {
  id: string;
  name: string;
  question: string;
  responseType: 'excerpt' | 'summary' | 'yesno' | 'classification' | 'numeric' | 'date';
  rules?: string;
}

interface CellItem {
  docId: string;
  columnId: string;
  value: string;
  citation: string;
  confidence: number;
  needsVerification: boolean;
}

interface AuditEvent {
  id: string;
  type: 'upload' | 'selection' | 'run' | 'schema' | 'export';
  detail: string;
  user: string;
  ts: string;
}

const storageKey = 'vault-review-state-v1';

const stageOrder = ['Upload', 'Vault', 'Select', 'Columns', 'Run', 'Table', 'Export'] as const;
type Stage = (typeof stageOrder)[number];

const initialState = {
  documents: [] as DocumentItem[],
  columns: [] as ColumnItem[],
  cells: [] as CellItem[],
  audit: [] as AuditEvent[],
  currentStage: 'Upload' as Stage,
  confirmations: {
    uploads: false,
    selection: false,
    runScope: false,
    schema: false,
  },
  runStatus: 'idle' as 'idle' | 'running' | 'paused' | 'completed',
  runProgress: {} as Record<string, number>,
};

const formatSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

const randomId = () => crypto.randomUUID();

function createCell(doc: DocumentItem, column: ColumnItem): CellItem {
  const confidence = Number(Math.random().toFixed(2));
  const needsVerification = confidence < 0.45;
  const citation = `p. ${Math.floor(Math.random() * 12) + 1}`;
  const base = `${column.responseType} for ${doc.fileName}`;
  const value =
    column.responseType === 'yesno'
      ? Math.random() > 0.5
        ? 'Yes (needs legal review)'
        : 'No (needs legal review)'
      : column.responseType === 'numeric'
        ? (Math.random() * 1000).toFixed(2)
        : column.responseType === 'date'
          ? new Date().toISOString().slice(0, 10)
          : `${base} — placeholder summary/excerpt.`;
  return { docId: doc.id, columnId: column.id, value, citation, confidence, needsVerification };
}

export default function HomePage() {
  const [documents, setDocuments] = useState<DocumentItem[]>(initialState.documents);
  const [columns, setColumns] = useState<ColumnItem[]>(initialState.columns);
  const [cells, setCells] = useState<CellItem[]>(initialState.cells);
  const [audit, setAudit] = useState<AuditEvent[]>(initialState.audit);
  const [currentStage, setCurrentStage] = useState<Stage>(initialState.currentStage);
  const [confirmations, setConfirmations] = useState(initialState.confirmations);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'paused' | 'completed'>(initialState.runStatus);
  const [runProgress, setRunProgress] = useState<Record<string, number>>(initialState.runProgress);
  const [columnForm, setColumnForm] = useState<Partial<ColumnItem>>({});
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [rerunColumnId, setRerunColumnId] = useState<string | null>(null);

  const runner = useRef<NodeJS.Timeout | null>(null);

  // Load persisted state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setDocuments(parsed.documents || []);
        setColumns(parsed.columns || []);
        setCells(parsed.cells || []);
        setAudit(parsed.audit || []);
        setCurrentStage(parsed.currentStage || 'Upload');
        setConfirmations(parsed.confirmations || initialState.confirmations);
        setRunStatus(parsed.runStatus || 'idle');
        setRunProgress(parsed.runProgress || {});
      } catch (err) {
        console.error('Failed to parse saved state', err);
      }
    }
  }, []);

  // Persist state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = { documents, columns, cells, audit, currentStage, confirmations, runStatus, runProgress };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [documents, columns, cells, audit, currentStage, confirmations, runStatus, runProgress]);

  // Auto-start run when entering Run stage if idle
  useEffect(() => {
    if (currentStage === 'Run' && runStatus === 'idle' && documents.some((d) => d.include) && columns.length > 0) {
      startRun();
    }
  }, [currentStage, runStatus, documents, columns]);

  // Clear interval on unmount
  useEffect(() => () => runner.current && clearInterval(runner.current), []);

  const includedDocuments = useMemo(() => documents.filter((d) => d.include), [documents]);

  const addAudit = (type: AuditEvent['type'], detail: string) => {
    const event: AuditEvent = {
      id: randomId(),
      type,
      detail,
      user: 'Current User',
      ts: new Date().toISOString(),
    };
    setAudit((prev) => [event, ...prev]);
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files?.length) return;
    const newDocs: DocumentItem[] = Array.from(files).map((file) => ({
      id: randomId(),
      fileName: file.name,
      source: 'Upload',
      custodian: 'Unassigned',
      docType: 'Uncategorized',
      dateRange: '',
      size: file.size,
      status: 'Not processed',
      include: true,
      createdAt: new Date().toISOString(),
    }));
    setDocuments((prev) => [...newDocs, ...prev]);
    addAudit('upload', `Uploaded ${newDocs.length} file(s).`);
  };

  const updateDocumentField = (id: string, field: keyof DocumentItem, value: string | boolean) => {
    setDocuments((prev) => prev.map((doc) => (doc.id === id ? { ...doc, [field]: value } : doc)));
  };

  const handleConfirm = (key: keyof typeof confirmations) => {
    setConfirmations((prev) => ({ ...prev, [key]: true }));
    if (key === 'selection') addAudit('selection', 'Confirmed document selection.');
    if (key === 'uploads') addAudit('upload', 'Confirmed uploads for review.');
    if (key === 'runScope') addAudit('run', 'Confirmed run scope.');
    if (key === 'schema') addAudit('schema', 'Confirmed schema.');
  };

  const isNextEnabled = () => {
    if (currentStage === 'Upload') return confirmations.uploads;
    if (currentStage === 'Vault') return confirmations.selection;
    if (currentStage === 'Select') return confirmations.runScope;
    if (currentStage === 'Columns') return confirmations.schema;
    if (currentStage === 'Run') return runStatus === 'completed';
    return true;
  };

  const goToStage = (stage: Stage) => setCurrentStage(stage);

  const goNext = () => {
    const idx = stageOrder.indexOf(currentStage);
    if (idx < stageOrder.length - 1 && isNextEnabled()) setCurrentStage(stageOrder[idx + 1]);
  };

  const goBack = () => {
    const idx = stageOrder.indexOf(currentStage);
    if (idx > 0) setCurrentStage(stageOrder[idx - 1]);
  };

  const restart = () => {
    setDocuments(initialState.documents);
    setColumns(initialState.columns);
    setCells(initialState.cells);
    setAudit(initialState.audit);
    setConfirmations(initialState.confirmations);
    setCurrentStage('Upload');
    setRunStatus('idle');
    setRunProgress({});
    if (typeof window !== 'undefined') window.localStorage.removeItem(storageKey);
  };

  const addOrUpdateColumn = () => {
    if (!columnForm.name || !columnForm.question || !columnForm.responseType) return;
    if (editingColumnId) {
      setColumns((prev) => prev.map((c) => (c.id === editingColumnId ? { ...c, ...columnForm } as ColumnItem : c)));
      addAudit('schema', `Edited column ${columnForm.name}.`);
    } else {
      const newCol: ColumnItem = {
        id: randomId(),
        name: columnForm.name,
        question: columnForm.question,
        responseType: columnForm.responseType as ColumnItem['responseType'],
        rules: columnForm.rules,
      };
      setColumns((prev) => [...prev, newCol]);
      addAudit('schema', `Added column ${newCol.name}.`);
    }
    setColumnForm({});
    setEditingColumnId(null);
  };

  const deleteColumn = (id: string) => {
    setColumns((prev) => prev.filter((c) => c.id !== id));
    setCells((prev) => prev.filter((cell) => cell.columnId !== id));
    addAudit('schema', 'Deleted a column.');
  };

  const startRun = () => {
    if (!includedDocuments.length || !columns.length) return;
    setRunStatus('running');
    setRunProgress(Object.fromEntries(includedDocuments.map((d) => [d.id, 0])));
    setDocuments((prev) => prev.map((d) => (d.include ? { ...d, status: 'In queue' } : d)));

    runner.current && clearInterval(runner.current);
    runner.current = setInterval(() => {
      setRunProgress((prev) => {
        const next: Record<string, number> = { ...prev };
        Object.keys(next).forEach((docId) => {
          next[docId] = Math.min(100, next[docId] + Math.random() * 20);
        });
        const allDone = Object.values(next).every((val) => val >= 100);
        if (allDone) {
          clearInterval(runner.current as NodeJS.Timeout);
          runner.current = null;
          finalizeRun();
        }
        return next;
      });
    }, 1200);
  };

  const finalizeRun = () => {
    const newCells: CellItem[] = [];
    includedDocuments.forEach((doc) => {
      columns.forEach((col) => {
        newCells.push(createCell(doc, col));
      });
    });
    setCells(newCells);
    setRunStatus('completed');
    setDocuments((prev) => prev.map((d) => (d.include ? { ...d, status: 'Completed' } : d)));
    addAudit('run', `Ran ${includedDocuments.length} document(s) across ${columns.length} column(s).`);
  };

  const pauseRun = () => {
    runner.current && clearInterval(runner.current);
    runner.current = null;
    setRunStatus('paused');
  };

  const resumeRun = () => {
    if (runStatus === 'paused') {
      setRunStatus('running');
      runner.current = setInterval(() => {
        setRunProgress((prev) => {
          const next: Record<string, number> = { ...prev };
          Object.keys(next).forEach((docId) => {
            next[docId] = Math.min(100, next[docId] + Math.random() * 15);
          });
          const allDone = Object.values(next).every((val) => val >= 100);
          if (allDone) {
            clearInterval(runner.current as NodeJS.Timeout);
            runner.current = null;
            finalizeRun();
          }
          return next;
        });
      }, 1000);
    }
  };

  const rerunFailed = () => {
    const failedDocs = new Set(cells.filter((c) => c.needsVerification).map((c) => c.docId));
    if (!failedDocs.size) return;
    setRunStatus('running');
    setRunProgress(Object.fromEntries(Array.from(failedDocs).map((id) => [id, 0])));
    runner.current && clearInterval(runner.current);
    runner.current = setInterval(() => {
      setRunProgress((prev) => {
        const next: Record<string, number> = { ...prev };
        Object.keys(next).forEach((docId) => {
          next[docId] = Math.min(100, next[docId] + Math.random() * 25);
        });
        const allDone = Object.values(next).every((val) => val >= 100);
        if (allDone) {
          clearInterval(runner.current as NodeJS.Timeout);
          runner.current = null;
          const rerunCells: CellItem[] = [];
          includedDocuments
            .filter((doc) => failedDocs.has(doc.id))
            .forEach((doc) => columns.forEach((col) => rerunCells.push(createCell(doc, col))));
          setCells((prev) => [
            ...prev.filter((c) => !failedDocs.has(c.docId)),
            ...rerunCells,
          ]);
          setRunStatus('completed');
        }
        return next;
      });
    }, 1000);
  };

  const rerunColumn = () => {
    const columnId = rerunColumnId || columns[0]?.id;
    if (!columnId) return;
    const rerunCells: CellItem[] = [];
    includedDocuments.forEach((doc) => rerunCells.push(createCell(doc, columns.find((c) => c.id === columnId)!)));
    setCells((prev) => [
      ...prev.filter((c) => c.columnId !== columnId),
      ...rerunCells,
    ]);
    addAudit('run', `Re-ran column ${columns.find((c) => c.id === columnId)?.name || 'Column'}.`);
  };

  const filteredDocs = useMemo(() => {
    const docs = includedDocuments
      .map((doc) => ({
        ...doc,
        cells: columns.map((col) => cells.find((c) => c.docId === doc.id && c.columnId === col.id)),
      }))
      .filter((doc) => {
        if (!searchTerm.trim()) return true;
        const inDoc = doc.fileName.toLowerCase().includes(searchTerm.toLowerCase());
        const inCells = doc.cells.some((c) => c?.value.toLowerCase().includes(searchTerm.toLowerCase()));
        return inDoc || inCells;
      });
    return docs.sort((a, b) => (sortAsc ? a.fileName.localeCompare(b.fileName) : b.fileName.localeCompare(a.fileName)));
  }, [includedDocuments, columns, cells, searchTerm, sortAsc]);

  const exportCsv = () => {
    const header = ['File name', ...columns.map((c) => c.name)];
    const rows = includedDocuments.map((doc) => {
      const vals = columns.map((col) => {
        const cell = cells.find((c) => c.docId === doc.id && c.columnId === col.id);
        if (!cell) return '';
        return `${cell.value} [${cell.citation}] (conf ${cell.confidence})`;
      });
      return [doc.fileName, ...vals];
    });
    const csv = [header, ...rows].map((r) => r.map((val) => `"${val}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'review-table.csv';
    link.click();
    addAudit('export', 'Exported CSV with citations.');
  };

  const exportExcel = () => {
    alert('Excel export stubbed. CSV includes citations.');
    addAudit('export', 'Exported Excel (stub).');
  };

  const StageNav = () => (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="text-sm text-slate-600">Persistent steps: Upload → Vault → Select → Columns → Run → Table → Export</div>
      <div className="flex gap-2">
        <button
          onClick={goBack}
          disabled={stageOrder.indexOf(currentStage) === 0}
          className="rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Back
        </button>
        <button onClick={restart} className="rounded border px-3 py-2 text-sm font-semibold">
          Restart
        </button>
        <button
          onClick={goNext}
          disabled={!isNextEnabled()}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );

  const ProgressBar = ({ value }: { value: number }) => (
    <div className="h-2 w-full rounded-full bg-slate-200">
      <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );

  const confirmationState = (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className={confirmations.uploads ? 'text-green-700' : ''}>Uploads confirmed</span>
      <span>•</span>
      <span className={confirmations.selection ? 'text-green-700' : ''}>Selection confirmed</span>
      <span>•</span>
      <span className={confirmations.runScope ? 'text-green-700' : ''}>Run scope confirmed</span>
      <span>•</span>
      <span className={confirmations.schema ? 'text-green-700' : ''}>Schema confirmed</span>
    </div>
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
      <header className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document Vault + Review Table</div>
        <h1 className="text-3xl font-bold">Vault workflow</h1>
        {confirmationState}
      </header>

      <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-600">
        {stageOrder.map((stage) => (
          <button
            key={stage}
            onClick={() => goToStage(stage)}
            className={`rounded-full border px-3 py-1 ${currentStage === stage ? 'border-blue-600 text-blue-700' : 'border-slate-200'}`}
          >
            {stage}
          </button>
        ))}
      </nav>

      <StageNav />

      <section className="table-card p-6 space-y-4">
        {currentStage === 'Upload' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="rounded-lg border border-dashed border-blue-400 bg-blue-50 px-6 py-4 text-blue-700 font-semibold cursor-pointer">
                Upload files
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />
              </label>
              <div className="text-sm text-slate-600">Files appear in the Vault immediately after choosing them.</div>
            </div>
            <button
              onClick={() => handleConfirm('uploads')}
              className="rounded bg-emerald-600 px-4 py-2 text-white font-semibold"
            >
              Confirm uploads
            </button>

            {documents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Vault preview</h3>
                  <span className="text-xs text-slate-600">{documents.length} file(s) ready</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="p-2 text-left">File name</th>
                        <th className="p-2 text-left">Size</th>
                        <th className="p-2 text-left">Status</th>
                        <th className="p-2 text-left">Included</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => (
                        <tr key={doc.id} className="border-b">
                          <td className="p-2 font-semibold">{doc.fileName}</td>
                          <td className="p-2 text-slate-600">{formatSize(doc.size)}</td>
                          <td className="p-2">{doc.status}</td>
                          <td className="p-2">{doc.include ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-600">Files are already in the Vault table below—confirm to proceed.</p>
              </div>
            )}
          </div>
        )}

        {currentStage === 'Vault' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Vault library</h2>
              <div className="flex gap-2 text-sm">
                <button
                  className="rounded border px-3 py-1"
                  onClick={() => setDocuments((prev) => prev.map((d) => ({ ...d, include: true })))}
                >
                  Include all
                </button>
                <button
                  className="rounded border px-3 py-1"
                  onClick={() => setDocuments((prev) => prev.map((d) => ({ ...d, include: false })))}
                >
                  Exclude all
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 text-left">File name</th>
                    <th className="p-2 text-left">Source</th>
                    <th className="p-2 text-left">Custodian</th>
                    <th className="p-2 text-left">Doc type</th>
                    <th className="p-2 text-left">Date range</th>
                    <th className="p-2 text-left">Size</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Include</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-b">
                      <td className="p-2 font-semibold">{doc.fileName}</td>
                      <td className="p-2">
                        <input
                          value={doc.source}
                          onChange={(e) => updateDocumentField(doc.id, 'source', e.target.value)}
                          className="w-full rounded border px-2 py-1"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={doc.custodian}
                          onChange={(e) => updateDocumentField(doc.id, 'custodian', e.target.value)}
                          className="w-full rounded border px-2 py-1"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={doc.docType}
                          onChange={(e) => updateDocumentField(doc.id, 'docType', e.target.value)}
                          className="w-full rounded border px-2 py-1"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          value={doc.dateRange}
                          onChange={(e) => updateDocumentField(doc.id, 'dateRange', e.target.value)}
                          className="w-full rounded border px-2 py-1"
                        />
                      </td>
                      <td className="p-2 text-slate-600">{formatSize(doc.size)}</td>
                      <td className="p-2">{doc.status}</td>
                      <td className="p-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={doc.include}
                            onChange={(e) => updateDocumentField(doc.id, 'include', e.target.checked)}
                          />
                          Include in Review Table
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => handleConfirm('selection')}
              className="rounded bg-emerald-600 px-4 py-2 text-white font-semibold"
            >
              Confirm selection
            </button>
          </div>
        )}

        {currentStage === 'Select' && (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold">Select documents to process</h2>
            <p className="text-slate-700">Included documents: {includedDocuments.length}</p>
            <button
              onClick={() => {
                setDocuments((prev) => prev.map((d) => (d.include ? { ...d, status: 'In queue' } : d)));
                addAudit('selection', 'Queued included documents.');
              }}
              className="rounded bg-blue-700 px-4 py-2 text-white font-semibold"
            >
              Run Selected
            </button>
            <div>
              <button
                onClick={() => handleConfirm('runScope')}
                className="rounded bg-emerald-600 px-4 py-2 text-white font-semibold"
              >
                Confirm run scope
              </button>
            </div>
          </div>
        )}

        {currentStage === 'Columns' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Columns / schema</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Name</span>
                <input
                  value={columnForm.name || ''}
                  onChange={(e) => setColumnForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded border px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Response type</span>
                <select
                  value={columnForm.responseType || ''}
                  onChange={(e) => setColumnForm((prev) => ({ ...prev, responseType: e.target.value as ColumnItem['responseType'] }))}
                  className="w-full rounded border px-3 py-2"
                >
                  <option value="">Select</option>
                  <option value="excerpt">Excerpt</option>
                  <option value="summary">Summary</option>
                  <option value="yesno">Yes/No</option>
                  <option value="classification">Classification</option>
                  <option value="numeric">Numeric</option>
                  <option value="date">Date</option>
                </select>
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-semibold">Prompt / question</span>
                <textarea
                  value={columnForm.question || ''}
                  onChange={(e) => setColumnForm((prev) => ({ ...prev, question: e.target.value }))}
                  className="w-full rounded border px-3 py-2"
                  rows={2}
                />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-semibold">Validation / formatting rules (optional)</span>
                <textarea
                  value={columnForm.rules || ''}
                  onChange={(e) => setColumnForm((prev) => ({ ...prev, rules: e.target.value }))}
                  className="w-full rounded border px-3 py-2"
                  rows={2}
                />
              </label>
              <div className="md:col-span-2 flex gap-2">
                <button onClick={addOrUpdateColumn} className="rounded bg-blue-700 px-4 py-2 text-white font-semibold">
                  {editingColumnId ? 'Update' : 'Add'} column
                </button>
                {editingColumnId && (
                  <button
                    onClick={() => {
                      setEditingColumnId(null);
                      setColumnForm({});
                    }}
                    className="rounded border px-4 py-2"
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {columns.map((col) => (
                <div key={col.id} className="rounded border px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{col.name}</div>
                      <div className="text-sm text-slate-600">{col.question}</div>
                      <div className="text-xs text-slate-500">Type: {col.responseType}{col.rules ? ` • Rules: ${col.rules}` : ''}</div>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <button
                        className="rounded border px-3 py-1"
                        onClick={() => {
                          setEditingColumnId(col.id);
                          setColumnForm(col);
                        }}
                      >
                        Edit
                      </button>
                      <button className="rounded border px-3 py-1" onClick={() => deleteColumn(col.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => handleConfirm('schema')}
              className="rounded bg-emerald-600 px-4 py-2 text-white font-semibold"
            >
              Confirm schema
            </button>
          </div>
        )}

        {currentStage === 'Run' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Run extraction (simulated)</h2>
            <div className="flex gap-2">
              <button onClick={pauseRun} className="rounded border px-3 py-2">Pause</button>
              <button onClick={resumeRun} className="rounded border px-3 py-2">Resume</button>
              <button onClick={rerunFailed} className="rounded border px-3 py-2">Re-run failed</button>
              <button onClick={rerunColumn} className="rounded border px-3 py-2">Re-run column</button>
              <select
                value={rerunColumnId || ''}
                onChange={(e) => setRerunColumnId(e.target.value || null)}
                className="rounded border px-2"
              >
                <option value="">Select column</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {includedDocuments.map((doc) => (
                <div key={doc.id} className="rounded border px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{doc.fileName}</div>
                      <div className="text-xs text-slate-600">Status: {doc.status}</div>
                    </div>
                    <span className="badge bg-slate-100 text-slate-700">{Math.round(runProgress[doc.id] || 0)}%</span>
                  </div>
                  <ProgressBar value={runProgress[doc.id] || 0} />
                  <div className="mt-2 text-xs text-slate-500">{columns.length} column(s) × 1 document</div>
                </div>
              ))}
            </div>
            {runStatus === 'completed' && <div className="text-sm text-emerald-700 font-semibold">Run complete. You may proceed.</div>}
          </div>
        )}

        {currentStage === 'Table' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Review Table</h2>
                <p className="text-sm text-slate-600">Rows = included documents, Columns = schema</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filter by filename or value"
                  className="rounded border px-3 py-2"
                />
                <button className="rounded border px-3 py-2" onClick={() => setSortAsc((s) => !s)}>
                  Sort {sortAsc ? '▼' : '▲'}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 text-left">Document</th>
                    {columns.map((col) => (
                      <th key={col.id} className="p-2 text-left">{col.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((doc) => (
                    <tr key={doc.id} className="border-b align-top">
                      <td className="p-2 font-semibold">{doc.fileName}</td>
                      {columns.map((col) => {
                        const cell = cells.find((c) => c.docId === doc.id && c.columnId === col.id);
                        return (
                          <td key={col.id} className="p-2 space-y-1">
                            {cell ? (
                              <>
                                <div className="font-medium">{cell.value}</div>
                                <div className="text-xs text-slate-600">Citation: {cell.citation}</div>
                                <div className="text-xs">Confidence: <span className="badge bg-slate-100 text-slate-700">{cell.confidence}</span></div>
                                {cell.needsVerification && (
                                  <div className="badge bg-amber-100 text-amber-800">Needs verification</div>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-400">Pending</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {currentStage === 'Export' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Export & Audit</h2>
            <div className="flex gap-2">
              <button onClick={exportCsv} className="rounded bg-blue-700 px-4 py-2 text-white font-semibold">Export CSV</button>
              <button onClick={exportExcel} className="rounded border px-4 py-2">Export Excel</button>
            </div>
            <div className="rounded border p-3">
              <div className="font-semibold mb-2">Audit log</div>
              <ul className="space-y-2 text-sm">
                {audit.map((event) => (
                  <li key={event.id} className="flex justify-between border-b pb-1">
                    <div>
                      <div className="font-semibold capitalize">{event.type}</div>
                      <div className="text-slate-600">{event.detail}</div>
                    </div>
                    <div className="text-xs text-slate-500 text-right">
                      <div>{event.user}</div>
                      <div>{new Date(event.ts).toLocaleString()}</div>
                    </div>
                  </li>
                ))}
                {!audit.length && <li className="text-slate-500">No audit events yet.</li>}
              </ul>
            </div>
          </div>
        )}
      </section>

      <StageNav />
    </main>
  );
}
