function saveRawJson_(folderName, fileName, data) {
  const rootFolder = DriveApp.getFolderById(getRawFolderId_());
  const folder = getOrCreateFolder_(rootFolder, folderName);

  const blob = Utilities.newBlob(
    jsonString_(data),
    'application/json',
    fileName
  );

  const file = folder.createFile(blob);
  const fileUrl = file.getUrl();

  appendRows_(CONFIG.SHEETS.RAW_LOG, [[
    hash_(`${folderName}/${fileName}/${nowChile_()}`),
    nowChile_(),
    folderName,
    fileName,
    fileUrl,
    safe_(data.results || data.count || ''),
    'OK',
    ''
  ]]);

  return fileUrl;
}

function getOrCreateFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

/**
 * Verifica si ya existe un archivo raw en Drive sin crearlo.
 * Útil para el backfill: saltar llamadas a la API si ya se guardó el raw.
 *
 * @param {string} folderPath - Ruta relativa desde la carpeta raíz (puede tener subcarpetas con /)
 * @param {string} fileName - Nombre del archivo
 * @returns {{ exists: boolean, url: string }}
 */
function rawFileCheck_(folderPath, fileName) {
  try {
    const rootFolder = DriveApp.getFolderById(getRawFolderId_());
    const parts = folderPath.split('/').filter(Boolean);

    let folder = rootFolder;
    for (const part of parts) {
      const sub = folder.getFoldersByName(part);
      if (!sub.hasNext()) return { exists: false, url: '' };
      folder = sub.next();
    }

    const files = folder.getFilesByName(fileName);
    if (!files.hasNext()) return { exists: false, url: '' };

    return { exists: true, url: files.next().getUrl() };
  } catch (e) {
    return { exists: false, url: '' };
  }
}

/**
 * Versión de saveRawJson_ que no duplica si ya existe el archivo.
 * Si existe, devuelve la URL existente sin crear uno nuevo.
 */
function saveRawJsonOnce_(folderName, fileName, data) {
  const check = rawFileCheck_(folderName, fileName);
  if (check.exists) return check.url;
  return saveRawJson_(folderName, fileName, data);
}