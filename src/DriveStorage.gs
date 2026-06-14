function saveRawJson_(folderName, fileName, data) {
  const rootFolder = DriveApp.getFolderById(getRawFolderId_());
  const folder = getOrCreateFolder_(rootFolder, folderName);

  const blob = Utilities.newBlob(
    jsonString_(data),
    'application/json',
    fileName
  );

  const file = folder.createFile(blob);

  appendRows_(CONFIG.SHEETS.RAW_LOG, [[
    hash_(`${folderName}/${fileName}/${nowChile_()}`),
    nowChile_(),
    folderName,
    fileName,
    file.getUrl(),
    safe_(data.results),
    'OK'
  ]]);

  return file.getUrl();
}

function getOrCreateFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}