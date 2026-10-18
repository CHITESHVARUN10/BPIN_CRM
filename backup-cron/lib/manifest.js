const sum = (list, key) => list.reduce((acc, x) => acc + (x[key] || 0), 0)

export function buildManifest(run, items) {
  const dbItems = items.filter((i) => i.type === 'db')
  const mediaItems = items.filter((i) => i.type === 'media')
  return {
    version: 1,
    kind: 'bpin-crm-backup',
    runId: String(run._id),
    status: run.status,
    startedAt: run.startedAt,
    cutoffAt: run.cutoffAt,
    completedAt: run.completedAt || null,
    retention: { keep: run.keep },
    db: {
      database: 'BPIN (MongoDB Atlas)',
      collections: dbItems
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((i) => ({
          name: i.key,
          file: i.fileName,
          docs: i.docs ?? null,
          bytes: i.bytes ?? null,
          sha256: i.sha256 ?? null,
          status: i.status,
        })),
    },
    media: {
      store: 'vercel-blob (private)',
      files: mediaItems
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((i) => ({
          pathname: i.key,
          file: i.fileName,
          url: `/api/files?path=${encodeURIComponent(i.key)}`,
          contentType: i.contentType || i.meta?.contentType || null,
          storeSize: i.meta?.size ?? null,
          storeUploadedAt: i.meta?.uploadedAt ?? null,
          bytes: i.bytes ?? null,
          sha256: i.sha256 ?? null,
          driveFileId: i.driveFileId ?? null,
          referenced: (i.refs || []).length > 0,
          refs: i.refs || [],
        })),
      totals: { files: mediaItems.length, bytes: sum(mediaItems, 'bytes') },
    },
    checks: {
      items: items.length,
      done: items.filter((i) => i.status === 'done').length,
      failed: items.filter((i) => i.status === 'failed').length,
      dbDocs: sum(dbItems, 'docs'),
    },
  }
}

export function buildIndex(runs) {
  return {
    kind: 'bpin-crm-backup-index',
    updatedAt: new Date().toISOString(),
    note: 'Every backup is a full cumulative snapshot up to its cutoff time. Only the newest BACKUP_KEEP backups are kept.',
    backups: runs.map((r) => ({
      runId: String(r._id),
      folder: r.drive?.folderName || null,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt || null,
      rotatedAt: r.rotatedAt || null,
      collections: r.totals?.dbCollections ?? null,
      dbDocs: r.totals?.dbDocs ?? null,
      mediaFiles: r.totals?.mediaFiles ?? null,
      mediaBytes: r.totals?.mediaBytes ?? null,
    })),
  }
}
