/**
 * WorldCupSmokeTests.gs
 */

function smokeTestWorldCupCleanJobsDryRun() {
  const props = PropertiesService.getScriptProperties();
  const previous = props.getProperty('POOLTEAM_DRY_RUN');
  props.setProperty('POOLTEAM_DRY_RUN', 'true');
  try {
    const bootstrap = setupWorldCup2026InitialData();
    const live = runWorldCupLiveRefresh();
    const health = validateWorldCupDataHealth();
    return { ok: true, bootstrap: bootstrap, live: live, health: health };
  } finally {
    if (previous === null || previous === undefined) props.deleteProperty('POOLTEAM_DRY_RUN');
    else props.setProperty('POOLTEAM_DRY_RUN', previous);
  }
}

