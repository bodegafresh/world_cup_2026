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